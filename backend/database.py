"""SQLite database operations for fund dashboard."""

import sqlite3
from pathlib import Path

from config import DB_PATH
from parser import ParsedSheet, Transaction
from classifier import is_transfer, classify_sheet_transactions


def get_db_path() -> Path:
    return Path(DB_PATH).expanduser()


def init_db():
    """Create database tables if they don't exist."""
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    c = conn.cursor()

    c.executescript("""
        CREATE TABLE IF NOT EXISTS daily_snapshots (
            date TEXT PRIMARY KEY,
            total_balance_rmb REAL,
            total_income REAL,
            total_expense REAL,
            real_income REAL,
            real_expense REAL,
            transfer_in REAL,
            transfer_out REAL
        );

        CREATE TABLE IF NOT EXISTS account_snapshots (
            date TEXT,
            sheet_name TEXT,
            account_name TEXT,
            currency TEXT,
            account_type TEXT,
            balance REAL,
            balance_rmb REAL,
            daily_income REAL,
            daily_expense REAL,
            real_income REAL,
            real_expense REAL,
            exchange_rate REAL,
            PRIMARY KEY (date, sheet_name)
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            sheet_name TEXT,
            account_name TEXT,
            currency TEXT,
            account_type TEXT,
            summary TEXT,
            category TEXT,
            income REAL,
            expense REAL,
            balance REAL,
            is_transfer BOOLEAN
        );

        CREATE TABLE IF NOT EXISTS exchange_rates (
            date TEXT,
            currency TEXT,
            rate_to_rmb REAL,
            PRIMARY KEY (date, currency)
        );
    """)

    conn.commit()
    conn.close()


def save_exchange_rates(date: str, rates: dict[str, float]):
    """Save exchange rates for a given date."""
    conn = sqlite3.connect(str(get_db_path()))
    c = conn.cursor()

    for currency, rate in rates.items():
        c.execute(
            """INSERT OR REPLACE INTO exchange_rates (date, currency, rate_to_rmb)
               VALUES (?, ?, ?)""",
            (date, currency, rate),
        )

    conn.commit()
    conn.close()


def get_exchange_rates(date: str) -> dict[str, float]:
    """Get exchange rates for a given date. Defaults to 1.0 for CNY."""
    conn = sqlite3.connect(str(get_db_path()))
    c = conn.cursor()

    c.execute(
        "SELECT currency, rate_to_rmb FROM exchange_rates WHERE date = ?",
        (date,),
    )
    rates = {row[0]: row[1] for row in c.fetchall()}
    conn.close()

    rates["CNY"] = 1.0
    rates["CNH"] = 1.0
    return rates


def save_daily_data(date: str, sheets: list[ParsedSheet], rates: dict[str, float]):
    """Save all parsed data for a given date into the database.

    This replaces any existing data for the same date (idempotent).
    """
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    init_db()
    save_exchange_rates(date, rates)

    conn = sqlite3.connect(str(db_path))
    c = conn.cursor()

    # Delete existing data for this date (idempotent overwrite)
    c.execute("DELETE FROM daily_snapshots WHERE date = ?", (date,))
    c.execute("DELETE FROM account_snapshots WHERE date = ?", (date,))
    c.execute("DELETE FROM transactions WHERE date = ?", (date,))

    total_balance_rmb = 0.0
    total_income = 0.0
    total_expense = 0.0
    real_income = 0.0
    real_expense = 0.0
    transfer_in = 0.0
    transfer_out = 0.0

    for sheet in sheets:
        stats = classify_sheet_transactions(sheet)
        rate = rates.get(sheet.currency, 1.0)
        balance_rmb = sheet.balance_rmb  # From 日报汇总 (authoritative)

        total_balance_rmb += balance_rmb
        total_income += stats["real_income"] * rate + stats["transfer_income"] * rate
        total_expense += stats["real_expense"] * rate + stats["transfer_expense"] * rate
        real_income += stats["real_income"] * rate
        real_expense += stats["real_expense"] * rate
        transfer_in += stats["transfer_income"] * rate
        transfer_out += stats["transfer_expense"] * rate

        # Save account snapshot
        c.execute(
            """INSERT INTO account_snapshots
               (date, sheet_name, account_name, currency, account_type,
                balance, balance_rmb, daily_income, daily_expense,
                real_income, real_expense, exchange_rate)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                date,
                sheet.sheet_name,
                sheet.account_name,
                sheet.currency,
                sheet.account_type,
                sheet.last_balance,
                balance_rmb,
                stats["real_income"] + stats["transfer_income"],
                stats["real_expense"] + stats["transfer_expense"],
                stats["real_income"],
                stats["real_expense"],
                rate,
            ),
        )

        # Save individual transactions
        for txn in sheet.transactions:
            txn_transfer = is_transfer(txn)
            c.execute(
                """INSERT INTO transactions
                   (date, sheet_name, account_name, currency, account_type,
                    summary, category, income, expense, balance, is_transfer)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    txn.date,
                    txn.sheet_name,
                    txn.account_name,
                    txn.currency,
                    txn.account_type,
                    txn.summary,
                    txn.category,
                    txn.income,
                    txn.expense,
                    txn.balance,
                    txn_transfer,
                ),
            )

    # Save daily snapshot
    c.execute(
        """INSERT INTO daily_snapshots
           (date, total_balance_rmb, total_income, total_expense,
            real_income, real_expense, transfer_in, transfer_out)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            date,
            total_balance_rmb,
            total_income,
            total_expense,
            real_income,
            real_expense,
            transfer_in,
            transfer_out,
        ),
    )

    conn.commit()
    conn.close()

    return {
        "date": date,
        "total_balance_rmb": total_balance_rmb,
        "total_income": total_income,
        "total_expense": total_expense,
        "real_income": real_income,
        "real_expense": real_expense,
        "transfer_in": transfer_in,
        "transfer_out": transfer_out,
    }
