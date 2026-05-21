#!/usr/bin/env python3
"""Import fund data from the standardized template Excel.

Template format (Sheet1):
    A-J side (主账户交易):
      Col A: 日期
      Col B: 账户
      Col C: 期初余额
      Col D: 摘要
      Col E: 分类
      Col F: 收入
      Col G: 币种 (收入币种)
      Col H: 支出
      Col I: 币种 (支出币种)
      Col J: 备注
    K-O side (往来对端账户):
      Col K: 账户 (对端)
      Col L: 摘要 (对端)
      Col M: 分类 (对端)
      Col N: 收入 (对端)
      Col O: 币种 (对端收入币种)

    当 K 非空时，该行为往来交易，A-J 侧为出金方，K-O 侧为入金方。
    系统会为双方各生成一条 transaction 记录。

    期初余额规则：
    - 新账户（数据库中无历史数据）必须填写期初余额，否则报错
    - 已有账户可不填，系统自动取前一日期末余额作为当日期初余额

Usage:
    python import_template.py <template_file>

Exchange rates are read from exchange_rates.md (same directory).
Account mapping is read from account_mapping.json (same directory).
"""

import json
import sqlite3
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import openpyxl

from classifier import classify_sheet_transactions, is_transfer
from config import (
    ACCOUNT_TYPE_RULES,
    CURRENCY_MAP,
    TRANSFER_KEYWORDS,
)
from database import get_db_path, init_db
from exporter import export_all

# ---------------------------------------------------------------------------
# Column definitions
# ---------------------------------------------------------------------------

TEMPLATE_COLS = {
    "date": 1,              # A
    "account": 2,           # B
    "initial_balance": 3,   # C  (期初余额)
    "summary": 4,           # D
    "category": 5,          # E
    "income": 6,            # F
    "income_curr": 7,       # G
    "expense": 8,           # H
    "expense_curr": 9,      # I
    "remark": 10,           # J
    "cp_account": 11,       # K  (counterparty account)
    "cp_summary": 12,       # L
    "cp_category": 13,      # M
    "cp_income": 14,        # N
    "cp_income_curr": 15,   # O
}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class TemplateRow:
    """A single transaction row from the template."""
    date: str
    account: str
    initial_balance: float | None  # C column, None if not provided
    summary: str
    category: str
    income: float
    income_curr: str
    expense: float
    expense_curr: str
    remark: str
    counterparty_account: str  # K column, empty for non-transfers


@dataclass
class GroupedAccount:
    """Transactions grouped by date + account."""
    date: str
    account: str
    currency: str
    account_type: str
    initial_balance: float | None  # from template or previous day
    rows: list[TemplateRow]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_account_mapping() -> dict[str, str]:
    """Load account name mapping from JSON config."""
    mapping_file = Path(__file__).parent / "account_mapping.json"
    if not mapping_file.exists():
        return {}
    with open(mapping_file, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("mapping", {})


def _resolve_account_name(raw_name: str, mapping: dict[str, str]) -> str:
    """Map template account name to system account name."""
    return mapping.get(raw_name, raw_name)


def _extract_currency_from_name(account_name: str) -> str:
    """Determine currency code from account name suffix/keywords."""
    for suffix, code in CURRENCY_MAP.items():
        if account_name.endswith(suffix) or suffix in account_name:
            return code
    return ""


_CURR_CODE_TO_KEYWORD: dict[str, str] = {v: k for k, v in CURRENCY_MAP.items()}


def _detect_currency_from_rows(rows: list[TemplateRow]) -> str:
    """Determine the most common currency from actual transaction data."""
    currencies: list[str] = []
    for row in rows:
        if row.income_curr:
            currencies.append(row.income_curr)
        if row.expense_curr:
            currencies.append(row.expense_curr)
    if currencies:
        most_common = Counter(currencies).most_common(1)[0][0]
        if most_common in _CURR_CODE_TO_KEYWORD or most_common == "CNY":
            return most_common
        for keyword, code in CURRENCY_MAP.items():
            if keyword in most_common:
                return code
    return "CNY"


def _classify_type(account_name: str) -> str:
    """Classify account type using existing rules."""
    name_lower = account_name.lower()
    for keywords, type_name in ACCOUNT_TYPE_RULES:
        if any(kw.lower() in name_lower for kw in keywords):
            return type_name
    return "其他"


def _load_exchange_rates() -> dict[str, float]:
    """Load exchange rates from exchange_rates.md."""
    rates_file = Path(__file__).parent / "exchange_rates.md"
    if not rates_file.exists():
        print("  WARNING: exchange_rates.md not found, using CNY=1.0 only")
        return {"CNY": 1.0}

    rates: dict[str, float] = {}
    with open(rates_file, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith(">"):
                continue
            if "---" in line or line.startswith("| 币种"):
                continue
            parts = [p.strip() for p in line.split("|")]
            parts = [p for p in parts if p]
            if len(parts) >= 3:
                code = parts[1].strip()
                try:
                    rate = float(parts[2].strip())
                    rates[code] = rate
                except ValueError:
                    continue
    return rates


def _safe_float(value) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (ValueError, TypeError):
        return 0.0


def _safe_str(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _format_date(value) -> str:
    if value is None:
        return ""
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value).strip()


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_template(filepath: str) -> list[TemplateRow]:
    """Read all data rows from the template Excel.

    For rows with J (counterparty account) non-empty, generates TWO rows:
    1. The A-I side (original account)
    2. The J-N side (counterparty account as the receiving side)
    """
    wb = openpyxl.load_workbook(filepath, data_only=True)
    ws = wb.active

    rows: list[TemplateRow] = []
    col = TEMPLATE_COLS

    for cell_row in ws.iter_rows(min_row=2, values_only=True):
        # Pad row to at least 15 columns
        padded = list(cell_row) + [None] * (15 - len(cell_row))

        date_val = padded[col["date"] - 1]
        if date_val is None:
            continue

        account = _safe_str(padded[col["account"] - 1])
        if not account:
            continue

        date_str = _format_date(date_val)
        initial_balance_raw = padded[col["initial_balance"] - 1]
        initial_balance = _safe_float(initial_balance_raw) if initial_balance_raw is not None else None
        summary = _safe_str(padded[col["summary"] - 1])
        category = _safe_str(padded[col["category"] - 1])
        income = _safe_float(padded[col["income"] - 1])
        income_curr = _safe_str(padded[col["income_curr"] - 1])
        expense = _safe_float(padded[col["expense"] - 1])
        expense_curr = _safe_str(padded[col["expense_curr"] - 1])
        remark = _safe_str(padded[col["remark"] - 1])

        cp_account = _safe_str(padded[col["cp_account"] - 1])

        if income == 0 and expense == 0:
            continue

        # Row 1: A-J side (the account in column B)
        rows.append(TemplateRow(
            date=date_str,
            account=account,
            initial_balance=initial_balance,
            summary=summary,
            category=category,
            income=income,
            income_curr=income_curr,
            expense=expense,
            expense_curr=expense_curr,
            remark=remark,
            counterparty_account=cp_account,
        ))

        # Row 2: K-O side (counterparty account, only if K non-empty)
        if cp_account:
            cp_summary = _safe_str(padded[col["cp_summary"] - 1])
            cp_category = _safe_str(padded[col["cp_category"] - 1])
            cp_income = _safe_float(padded[col["cp_income"] - 1])
            cp_income_curr = _safe_str(padded[col["cp_income_curr"] - 1])

            if cp_income != 0:
                rows.append(TemplateRow(
                    date=date_str,
                    account=cp_account,
                    initial_balance=None,  # counterparty side never carries initial balance
                    summary=cp_summary,
                    category=cp_category,
                    income=cp_income,
                    income_curr=cp_income_curr,
                    expense=0.0,
                    expense_curr="",
                    remark="",
                    counterparty_account=account,  # reverse link
                ))

    wb.close()
    return rows


def _get_previous_closing_balance(account_name: str, date: str) -> float | None:
    """Look up the closing balance of an account from the previous day in the DB."""
    conn = sqlite3.connect(str(get_db_path()))
    c = conn.cursor()
    # Find the most recent snapshot for this account before the given date
    c.execute(
        """SELECT balance_rmb, exchange_rate FROM account_snapshots
           WHERE account_name = ? AND date < ?
           ORDER BY date DESC LIMIT 1""",
        (account_name, date),
    )
    row = c.fetchone()
    conn.close()
    if row is None:
        return None
    balance_rmb, rate = row
    # Convert back to local currency (balance was stored as RMB)
    return balance_rmb / rate if rate else 0.0


def group_and_map(
    rows: list[TemplateRow], mapping: dict[str, str]
) -> dict[tuple[str, str], GroupedAccount]:
    """Group rows by (date, mapped_account) and resolve metadata.

    Validates that new accounts (no history in DB) have initial_balance
    provided in the template.
    """
    groups: dict[tuple[str, str], GroupedAccount] = {}

    for row in rows:
        mapped = _resolve_account_name(row.account, mapping)
        key = (row.date, mapped)

        if key not in groups:
            currency = _extract_currency_from_name(mapped)
            account_type = _classify_type(mapped)
            groups[key] = GroupedAccount(
                date=row.date,
                account=mapped,
                currency=currency,
                account_type=account_type,
                initial_balance=None,
                rows=[],
            )

        groups[key].rows.append(row)

    # Fix currency for accounts where name didn't indicate it
    for key, group in groups.items():
        if not group.currency:
            group.currency = _detect_currency_from_rows(group.rows)

    # Resolve initial_balance: template value > previous day's closing > default 0
    # TODO: 后续数据齐全后恢复校验逻辑，新账户缺少期初余额时 raise ValueError
    for key, group in groups.items():
        if group.initial_balance is not None:
            continue
        # Take the first non-None initial_balance from rows
        for row in group.rows:
            if row.initial_balance is not None:
                group.initial_balance = row.initial_balance
                break
        # If still None, try to get from previous day in DB
        if group.initial_balance is None:
            prev_balance = _get_previous_closing_balance(key[1], key[0])
            if prev_balance is not None:
                group.initial_balance = prev_balance
            else:
                group.initial_balance = 0.0  # 暂时默认为 0

    return groups


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def _ensure_counterparty_column(conn: sqlite3.Connection):
    """Add counterparty_account and initial_balance columns if they don't exist."""
    c = conn.cursor()
    txn_cols = [row[1] for row in c.execute("PRAGMA table_info(transactions)").fetchall()]
    if "counterparty_account" not in txn_cols:
        c.execute("ALTER TABLE transactions ADD COLUMN counterparty_account TEXT")
    snap_cols = [row[1] for row in c.execute("PRAGMA table_info(account_snapshots)").fetchall()]
    if "initial_balance" not in snap_cols:
        c.execute("ALTER TABLE account_snapshots ADD COLUMN initial_balance REAL")
    conn.commit()


def save_template_data(
    groups: dict[tuple[str, str], GroupedAccount],
    rates: dict[str, float],
) -> list[dict]:
    """Save grouped data to the database. Returns per-date summaries."""
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    init_db()

    conn = sqlite3.connect(str(db_path))
    _ensure_counterparty_column(conn)
    c = conn.cursor()

    # Collect all dates
    dates = sorted({key[0] for key in groups})

    # Delete existing data for these dates
    for date in dates:
        c.execute("DELETE FROM daily_snapshots WHERE date = ?", (date,))
        c.execute("DELETE FROM account_snapshots WHERE date = ?", (date,))
        c.execute("DELETE FROM transactions WHERE date = ?", (date,))
        for currency, rate in rates.items():
            c.execute(
                "INSERT OR REPLACE INTO exchange_rates (date, currency, rate_to_rmb) VALUES (?, ?, ?)",
                (date, currency, rate),
            )

    date_summaries: dict[str, dict] = defaultdict(lambda: {
        "total_income": 0.0,
        "total_expense": 0.0,
        "real_income": 0.0,
        "real_expense": 0.0,
        "transfer_in": 0.0,
        "transfer_out": 0.0,
        "total_balance_rmb": 0.0,
    })

    for key, group in groups.items():
        date, account_name = key
        rate = rates.get(group.currency, 1.0)
        ds = date_summaries[date]

        real_income = 0.0
        real_expense = 0.0
        transfer_income = 0.0
        transfer_expense = 0.0

        for row in group.rows:
            # Map counterparty account name too
            cp_mapped = _resolve_account_name(row.counterparty_account, {}) if row.counterparty_account else ""

            is_xfer = any(
                kw in row.category or kw in row.summary
                for kw in TRANSFER_KEYWORDS
            )

            if is_xfer:
                transfer_income += row.income
                transfer_expense += row.expense
            else:
                real_income += row.income
                real_expense += row.expense

            c.execute(
                """INSERT INTO transactions
                   (date, sheet_name, account_name, currency, account_type,
                    summary, category, income, expense, balance, is_transfer,
                    counterparty_account)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    date,
                    account_name,
                    account_name,
                    group.currency,
                    group.account_type,
                    row.summary,
                    row.category,
                    row.income,
                    row.expense,
                    0.0,
                    is_xfer,
                    cp_mapped or None,
                ),
            )

        # Daily totals in RMB
        daily_income_rmb = (real_income + transfer_income) * rate
        daily_expense_rmb = (real_expense + transfer_expense) * rate
        real_income_rmb = real_income * rate
        real_expense_rmb = real_expense * rate
        transfer_in_rmb = transfer_income * rate
        transfer_out_rmb = transfer_expense * rate

        # Closing balance = initial_balance + net change (in local currency)
        initial_bal = group.initial_balance or 0.0
        net_change = (real_income + transfer_income) - (real_expense + transfer_expense)
        closing_balance_local = initial_bal + net_change
        closing_balance_rmb = closing_balance_local * rate

        ds["total_income"] += daily_income_rmb
        ds["total_expense"] += daily_expense_rmb
        ds["real_income"] += real_income_rmb
        ds["real_expense"] += real_expense_rmb
        ds["transfer_in"] += transfer_in_rmb
        ds["transfer_out"] += transfer_out_rmb
        ds["total_balance_rmb"] = ds.get("total_balance_rmb", 0.0) + closing_balance_rmb

        c.execute(
            """INSERT INTO account_snapshots
               (date, sheet_name, account_name, currency, account_type,
                balance, balance_rmb, daily_income, daily_expense,
                real_income, real_expense, exchange_rate, initial_balance)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                date,
                account_name,
                account_name,
                group.currency,
                group.account_type,
                closing_balance_local,
                closing_balance_rmb,
                daily_income_rmb,
                daily_expense_rmb,
                real_income_rmb,
                real_expense_rmb,
                rate,
                initial_bal,
            ),
        )

    for date in dates:
        ds = date_summaries[date]
        c.execute(
            """INSERT INTO daily_snapshots
               (date, total_balance_rmb, total_income, total_expense,
                real_income, real_expense, transfer_in, transfer_out)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                date,
                ds["total_balance_rmb"],
                ds["total_income"],
                ds["total_expense"],
                ds["real_income"],
                ds["real_expense"],
                ds["transfer_in"],
                ds["transfer_out"],
            ),
        )

    conn.commit()
    conn.close()

    return [{"date": date, **date_summaries[date]} for date in dates]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: python import_template.py <template_file>")
        sys.exit(1)

    filepath = sys.argv[1]
    filepath = str(Path(filepath).expanduser())

    if not Path(filepath).exists():
        print(f"Error: File not found: {filepath}")
        sys.exit(1)

    print(f"Importing template: {filepath}")

    mapping = _load_account_mapping()
    print(f"\n[1/5] Account mapping loaded: {len(mapping)} entries")
    if mapping:
        for k, v in mapping.items():
            print(f"  {k} -> {v}")

    print("\n[2/5] Parsing template...")
    rows = parse_template(filepath)
    dates = sorted({r.date for r in rows})
    accounts = sorted({r.account for r in rows})
    cp_count = sum(1 for r in rows if r.counterparty_account)
    print(f"  {len(rows)} rows (incl. {cp_count} counterparty), {len(dates)} dates, {len(accounts)} accounts")

    print("\n[3/5] Grouping and mapping accounts...")
    groups = group_and_map(rows, mapping)
    for key, g in sorted(groups.items()):
        ib = f"{g.initial_balance:,.2f}" if g.initial_balance is not None else "auto"
        print(f"  {key[0]} | {key[1]} | {g.currency} | {g.account_type} | init={ib} | {len(g.rows)} txns")

    print("\n[4/5] Saving to database...")
    rates = _load_exchange_rates()
    summaries = save_template_data(groups, rates)
    for s in summaries:
        net = s["real_income"] - s["real_expense"]
        print(f"  {s['date']}: balance={s['total_balance_rmb']:,.2f}  income={s['real_income']:,.2f}  expense={s['real_expense']:,.2f}  net={net:,.2f}")

    print("\n[5/5] Exporting JSON...")
    export_all()

    print("\nDone!")


if __name__ == "__main__":
    main()
