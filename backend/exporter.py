"""Export SQLite data to JSON files for the React frontend."""

import json
import sqlite3
from pathlib import Path

from config import DB_PATH, DATA_DIR


def get_db() -> sqlite3.Connection:
    return sqlite3.connect(str(Path(DB_PATH).expanduser()))


def get_data_dir() -> Path:
    p = Path(DATA_DIR).expanduser()
    p.mkdir(parents=True, exist_ok=True)
    return p


def fmt_wan(value: float) -> str:
    """Format a value in wan (万) units for display."""
    if abs(value) >= 10000:
        return f"¥{value / 10000:,.1f}万"
    return f"¥{value:,.2f}"


def export_latest():
    """Export latest.json with the most recent daily snapshot + previous day for comparison."""
    conn = get_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Get latest snapshot
    c.execute("SELECT * FROM daily_snapshots ORDER BY date DESC LIMIT 2")
    rows = c.fetchall()

    if not rows:
        print("  No data found in database")
        conn.close()
        return

    latest = dict(rows[0])
    previous = dict(rows[1]) if len(rows) > 1 else None

    # Aggregate real balance from account_snapshots for the latest date
    c.execute(
        "SELECT SUM(balance_rmb) as total FROM account_snapshots WHERE date = ?",
        (latest["date"],),
    )
    real_balance_row = c.fetchone()
    total_balance = real_balance_row["total"] if real_balance_row and real_balance_row["total"] else latest["total_balance_rmb"]

    # Calculate changes
    if previous:
        c.execute(
            "SELECT SUM(balance_rmb) as total FROM account_snapshots WHERE date = ?",
            (previous["date"],),
        )
        prev_balance_row = c.fetchone()
        prev_balance = prev_balance_row["total"] if prev_balance_row and prev_balance_row["total"] else previous["total_balance_rmb"]

        balance_change = total_balance - prev_balance
        balance_pct = (
            (balance_change / prev_balance * 100)
            if prev_balance
            else 0
        )
        income_change = latest["real_income"] - previous["real_income"]
        expense_change = latest["real_expense"] - previous["real_expense"]
    else:
        balance_change = 0
        balance_pct = 0
        income_change = 0
        expense_change = 0

    result = {
        "date": latest["date"],
        "previousDate": previous["date"] if previous else None,
        "kpi": {
            "totalBalance": total_balance,
            "totalBalanceDisplay": fmt_wan(total_balance),
            "balanceChange": balance_change,
            "balanceChangeDisplay": fmt_wan(balance_change),
            "balanceChangePct": round(balance_pct, 1),
            "dailyNet": latest["real_income"] - latest["real_expense"],
            "dailyNetDisplay": fmt_wan(latest["real_income"] - latest["real_expense"]),
            "realIncome": latest["real_income"],
            "realIncomeDisplay": fmt_wan(latest["real_income"]),
            "realExpense": latest["real_expense"],
            "realExpenseDisplay": fmt_wan(latest["real_expense"]),
            "transferIn": latest["transfer_in"],
            "transferOut": latest["transfer_out"],
        },
    }

    data_dir = get_data_dir()
    with open(data_dir / "latest.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    conn.close()
    print(f"  -> latest.json (date: {latest['date']}, balance: ¥{total_balance:,.2f})")


def export_history():
    """Export history.json with all daily snapshots for trend charts."""
    conn = get_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.execute(
        """SELECT date, total_balance_rmb, real_income, real_expense,
                  transfer_in, transfer_out
           FROM daily_snapshots ORDER BY date ASC"""
    )
    rows = [dict(r) for r in c.fetchall()]

    # Aggregate real balances from account_snapshots for each date
    c.execute(
        """SELECT date, SUM(balance_rmb) as total_balance
           FROM account_snapshots
           GROUP BY date ORDER BY date ASC"""
    )
    real_balances = {r["date"]: r["total_balance"] for r in c.fetchall()}

    result = {
        "dates": [r["date"] for r in rows],
        "totalBalance": [
            real_balances.get(r["date"], r["total_balance_rmb"]) for r in rows
        ],
        "realIncome": [r["real_income"] for r in rows],
        "realExpense": [r["real_expense"] for r in rows],
        "transferIn": [r["transfer_in"] for r in rows],
        "transferOut": [r["transfer_out"] for r in rows],
    }

    data_dir = get_data_dir()
    with open(data_dir / "history.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    conn.close()
    print(f"  -> history.json ({len(rows)} data points)")


def export_accounts():
    """Export accounts.json with account-level snapshots and transactions."""
    conn = get_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Get latest date
    c.execute("SELECT date FROM daily_snapshots ORDER BY date DESC LIMIT 1")
    row = c.fetchone()
    if not row:
        print("  No data found")
        conn.close()
        return

    latest_date = row[0]

    # Get account snapshots for latest date
    c.execute(
        """SELECT * FROM account_snapshots
           WHERE date = ? ORDER BY balance_rmb DESC""",
        (latest_date,),
    )
    accounts = []
    for r in c.fetchall():
        acct = dict(r)
        acct["balanceDisplay"] = fmt_wan(acct["balance_rmb"])
        acct["dailyIncomeDisplay"] = fmt_wan(acct["daily_income"])
        acct["dailyExpenseDisplay"] = fmt_wan(acct["daily_expense"])
        acct["realIncomeDisplay"] = fmt_wan(acct["real_income"])
        acct["realExpenseDisplay"] = fmt_wan(acct["real_expense"])
        acct["netChange"] = acct["real_income"] - acct["real_expense"]
        acct["netChangeDisplay"] = fmt_wan(acct["netChange"])
        # Include initial_balance if available
        ib = acct.get("initial_balance")
        acct["initialBalanceDisplay"] = fmt_wan(ib) if ib else "—"
        accounts.append(acct)

    # Get all transactions for latest date
    c.execute(
        """SELECT * FROM transactions
           WHERE date = ? ORDER BY sheet_name, id""",
        (latest_date,),
    )
    transactions = [dict(r) for r in c.fetchall()]

    # Group transactions by sheet_name
    txn_by_sheet = {}
    for txn in transactions:
        sheet = txn["sheet_name"]
        if sheet not in txn_by_sheet:
            txn_by_sheet[sheet] = []
        txn_by_sheet[sheet].append(txn)

    # Account type distribution
    c.execute(
        """SELECT account_type, SUM(balance_rmb) as total_balance
           FROM account_snapshots
           WHERE date = ?
           GROUP BY account_type
           ORDER BY total_balance DESC""",
        (latest_date,),
    )
    type_distribution = [
        {"type": r[0], "balance": r[1], "display": fmt_wan(r[1])}
        for r in c.fetchall()
    ]

    result = {
        "date": latest_date,
        "accounts": accounts,
        "transactions": txn_by_sheet,
        "typeDistribution": type_distribution,
    }

    data_dir = get_data_dir()
    with open(data_dir / "accounts.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    conn.close()
    print(f"  -> accounts.json ({len(accounts)} accounts, {len(transactions)} transactions)")


def export_all():
    """Export all JSON files."""
    export_latest()
    export_history()
    export_accounts()
    export_transactions()


def export_transactions():
    """Export transactions.json with all historical transactions for frontend filtering."""
    conn = get_db()
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # All transactions, ordered by date then id
    c.execute(
        """SELECT id, date, sheet_name, account_name, currency, account_type,
                  summary, category, income, expense, balance, is_transfer,
                  counterparty_account
           FROM transactions ORDER BY date ASC, id ASC"""
    )
    all_transactions = [dict(r) for r in c.fetchall()]

    # Filter out rows with invalid dates (non-YYYY-MM-DD format)
    import re
    date_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    transactions = [
        t for t in all_transactions if date_pattern.match(t["date"])
    ]

    # Distinct categories (filter out empty, numeric, and header values)
    c.execute("SELECT DISTINCT category FROM transactions WHERE category != '' ORDER BY category")
    skip_categories = {"分类"}
    categories = [
        r[0] for r in c.fetchall()
        if r[0]
        and r[0] not in skip_categories
        and not r[0].replace(".", "").replace("-", "").isdigit()
    ]

    # Distinct accounts
    c.execute("SELECT DISTINCT account_name FROM transactions ORDER BY account_name")
    accounts = [r[0] for r in c.fetchall()]

    # Distinct dates (only valid YYYY-MM-DD)
    dates = sorted({t["date"] for t in transactions})

    # Daily summaries
    c.execute(
        """SELECT date, total_balance_rmb, total_income, total_expense,
                  real_income, real_expense, transfer_in, transfer_out
           FROM daily_snapshots ORDER BY date ASC"""
    )
    daily_summaries = {}
    for r in c.fetchall():
        d = dict(r)
        if not date_pattern.match(d["date"]):
            continue
        daily_summaries[d["date"]] = {
            "real_income": d["real_income"],
            "real_expense": d["real_expense"],
            "transfer_in": d["transfer_in"],
            "transfer_out": d["transfer_out"],
        }

    result = {
        "transactions": transactions,
        "categories": categories,
        "accounts": accounts,
        "dates": dates,
        "dailySummaries": daily_summaries,
    }

    data_dir = get_data_dir()
    with open(data_dir / "transactions.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    conn.close()
    print(f"  -> transactions.json ({len(transactions)} transactions, {len(dates)} dates)")
