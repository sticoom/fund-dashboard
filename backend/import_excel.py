#!/usr/bin/env python3
"""Import fund data directly from the encrypted Excel file.

Reads 日报汇总 sheet for authoritative balances.
Reads sub-sheets for transaction details, excluding 往来.
Cross-verifies data integrity.

Usage:
    python import_excel.py <excel_file>
"""

import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from parser import (
    decrypt_excel,
    extract_account_sheet_mapping,
    extract_daily_accounts,
    extract_report_date,
    parse_all_sheets,
    safe_float,
    safe_str,
    DailyAccount,
)
from classifier import is_transfer
from config import CURRENCY_MAP
from database import get_db_path, init_db
from exporter import export_all


def decrypt_excel_with_formulas(filepath: str):
    """Decrypt Excel and return workbook with formulas (not resolved values)."""
    import io
    from pathlib import Path
    import msoffcrypto
    import openpyxl
    from config import EXCEL_PASSWORD

    source_path = Path(filepath).expanduser()
    with open(source_path, "rb") as f:
        file = msoffcrypto.OfficeFile(f)
        file.load_key(password=EXCEL_PASSWORD)
        decrypted = io.BytesIO()
        file.decrypt(decrypted)
        decrypted.seek(0)
        wb = openpyxl.load_workbook(decrypted, data_only=False)
    return wb


def _extract_currency_from_name(account_name: str) -> str:
    """Determine currency code from account name."""
    for suffix, code in CURRENCY_MAP.items():
        if account_name.endswith(suffix) or suffix in account_name:
            return code
    return "CNY"


def save_daily_report(
    date: str,
    daily_accounts: list[DailyAccount],
    sub_sheets: list,
    rates: dict[str, float],
) -> dict:
    """Save daily report data to database.

    Uses 日报汇总 for authoritative balances.
    Uses sub-sheets for real income/expense (excluding 往来).
    """
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    init_db()

    conn = sqlite3.connect(str(db_path))
    c = conn.cursor()

    # Delete existing data for this date
    c.execute("DELETE FROM daily_snapshots WHERE date = ?", (date,))
    c.execute("DELETE FROM account_snapshots WHERE date = ?", (date,))
    c.execute("DELETE FROM transactions WHERE date = ?", (date,))

    # Build real income/expense from sub-sheets (in local currency)
    sheet_data: dict[str, dict] = {}  # sheet_name -> {currency, real_inc, real_exp, xfer_inc, xfer_exp}

    for sheet in sub_sheets:
        name = sheet.sheet_name
        real_inc = 0.0
        real_exp = 0.0
        xfer_inc = 0.0
        xfer_exp = 0.0

        for txn in sheet.transactions:
            # Only process transactions matching the report date
            if txn.date and txn.date != date:
                continue

            if is_transfer(txn):
                xfer_inc += txn.income
                xfer_exp += txn.expense
            else:
                real_inc += txn.income
                real_exp += txn.expense

            # Save transaction
            c.execute(
                """INSERT INTO transactions
                   (date, sheet_name, account_name, currency, account_type,
                    summary, category, income, expense, balance, is_transfer)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    date,
                    name,
                    name,
                    txn.currency,
                    txn.account_type,
                    txn.summary,
                    txn.category,
                    txn.income,
                    txn.expense,
                    txn.balance,
                    is_transfer(txn),
                ),
            )

        sheet_data[name] = {
            "currency": sheet.currency,
            "real_inc": real_inc,
            "real_exp": real_exp,
            "xfer_inc": xfer_inc,
            "xfer_exp": xfer_exp,
        }

    # --- Daily totals: sum each unique sub-sheet ONCE in RMB ---
    agg_real_income_rmb = 0.0
    agg_real_expense_rmb = 0.0
    agg_transfer_in_rmb = 0.0
    agg_transfer_out_rmb = 0.0

    for name, data in sheet_data.items():
        rate = rates.get(data["currency"], 1.0)
        agg_real_income_rmb += data["real_inc"] * rate
        agg_real_expense_rmb += data["real_exp"] * rate
        agg_transfer_in_rmb += data["xfer_inc"] * rate
        agg_transfer_out_rmb += data["xfer_exp"] * rate

    # --- Per-account snapshots from 日报汇总 (authoritative balances) ---
    total_balance_rmb = 0.0

    for acct in daily_accounts:
        # Find matching sub-sheet(s) for per-account real income/expense
        real_inc_rmb = 0.0
        real_exp_rmb = 0.0

        if acct.source_sheets:
            for src_sheet in acct.source_sheets:
                if src_sheet in sheet_data:
                    data = sheet_data[src_sheet]
                    rate = rates.get(data["currency"], 1.0)
                    real_inc_rmb += data["real_inc"] * rate
                    real_exp_rmb += data["real_exp"] * rate

        total_balance_rmb += acct.balance

        c.execute(
            """INSERT OR REPLACE INTO account_snapshots
               (date, sheet_name, account_name, currency, account_type,
                balance, balance_rmb, daily_income, daily_expense,
                real_income, real_expense, exchange_rate)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                date,
                acct.name,
                acct.name,
                "",
                "",
                acct.balance,
                acct.balance,  # Already in RMB from 日报汇总
                acct.income,
                acct.expense,
                real_inc_rmb,
                real_exp_rmb,
                acct.exchange_rate if acct.exchange_rate else 1.0,
            ),
        )

    # Save daily snapshot with aggregate totals
    c.execute(
        """INSERT INTO daily_snapshots
           (date, total_balance_rmb, total_income, total_expense,
            real_income, real_expense, transfer_in, transfer_out)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (date, total_balance_rmb, 0, 0, agg_real_income_rmb, agg_real_expense_rmb,
         agg_transfer_in_rmb, agg_transfer_out_rmb),
    )

    conn.commit()
    conn.close()

    return {
        "date": date,
        "total_balance_rmb": total_balance_rmb,
        "real_income": agg_real_income_rmb,
        "real_expense": agg_real_expense_rmb,
    }


def main():
    if len(sys.argv) < 2:
        print("Usage: python import_excel.py <excel_file>")
        sys.exit(1)

    filepath = str(Path(sys.argv[1]).expanduser())
    if not Path(filepath).exists():
        print(f"Error: File not found: {filepath}")
        sys.exit(1)

    print(f"Importing: {filepath}")

    # Step 1: Decrypt Excel - two versions needed
    print("\n[1/4] Reading Excel...")
    wb_data = decrypt_excel(filepath)  # data_only=True for values
    wb_formulas = decrypt_excel_with_formulas(filepath)  # data_only=False for formulas

    # Step 2: Extract 日报汇总 data
    print("[2/4] Parsing 日报汇总...")
    date = extract_report_date(wb_data)
    if not date:
        print("  WARNING: Could not extract date, using today")
        from datetime import datetime
        date = datetime.now().strftime("%Y-%m-%d")
    print(f"  Report date: {date}")

    # Get account data (values) from data workbook
    daily_accounts, _ = extract_daily_accounts(wb_data)

    # Get account-to-sub-sheet mapping from formula workbook
    sheet_mapping = extract_account_sheet_mapping(wb_formulas)
    matched = 0
    for acct in daily_accounts:
        if acct.name in sheet_mapping:
            acct.source_sheets = sheet_mapping[acct.name]
            matched += 1

    total_balance = sum(a.balance for a in daily_accounts)
    print(f"  {len(daily_accounts)} accounts, {matched} with sub-sheet mapping, total balance: {total_balance:,.2f}")

    # Step 3: Parse sub-sheets for transaction details (also gets correct exchange rates)
    print("[3/4] Parsing sub-sheets for transactions...")
    sheets, rates = parse_all_sheets(filepath)
    print(f"  {len(sheets)} sheets parsed, exchange rates: {rates}")

    # Step 4: Save to database
    print("[4/4] Saving to database and exporting...")
    summary = save_daily_report(date, daily_accounts, sheets, rates)
    export_all()

    print(f"\nDone! Date: {date}")
    print(f"  Total balance: {summary['total_balance_rmb']:,.2f}")
    print(f"  Real income:   {summary['real_income']:,.2f}")
    print(f"  Real expense:  {summary['real_expense']:,.2f}")


if __name__ == "__main__":
    main()
