#!/usr/bin/env python3
"""Main entry point: parse Excel -> SQLite -> export JSON.

Usage:
    python update_data.py <excel_file> [date]

    excel_file: Path to the encrypted Excel file
    date: Date string in YYYY-MM-DD format (defaults to today)
"""

import sys
import json
from datetime import datetime
from pathlib import Path

# Add backend dir to path
sys.path.insert(0, str(Path(__file__).parent))

from parser import parse_all_sheets
from database import init_db, save_daily_data
from exporter import export_all


def main():
    if len(sys.argv) < 2:
        print("Usage: python update_data.py <excel_file> [date]")
        print("  excel_file: Path to the encrypted Excel file")
        print("  date: YYYY-MM-DD (defaults to today)")
        sys.exit(1)

    filepath = sys.argv[1]
    if len(sys.argv) >= 3:
        date = sys.argv[2]
    else:
        date = datetime.now().strftime("%Y-%m-%d")

    # Expand user path
    filepath = str(Path(filepath).expanduser())

    if not Path(filepath).exists():
        print(f"Error: File not found: {filepath}")
        sys.exit(1)

    print(f"Processing: {filepath}")
    print(f"Date: {date}")

    # Step 1: Parse Excel
    print("\n[1/4] Parsing Excel...")
    sheets, rates = parse_all_sheets(filepath)
    print(f"  Parsed {len(sheets)} detail sheets")
    print(f"  Exchange rates: {rates}")

    # Step 2: Save to database
    print("\n[2/4] Saving to database...")
    init_db()
    summary = save_daily_data(date, sheets, rates)
    print(f"  Total balance: ¥{summary['total_balance_rmb']:,.2f}")
    print(f"  Real income: ¥{summary['real_income']:,.2f}")
    print(f"  Real expense: ¥{summary['real_expense']:,.2f}")
    print(f"  Net change: ¥{summary['real_income'] - summary['real_expense']:,.2f}")
    print(f"  Transfer in: ¥{summary['transfer_in']:,.2f}")
    print(f"  Transfer out: ¥{summary['transfer_out']:,.2f}")

    # Step 3: Export JSON
    print("\n[3/4] Exporting JSON...")
    export_all()

    # Step 4: Done
    print("\n[4/4] Done! JSON files exported to frontend/src/data/")
    print(f"  To build frontend: cd frontend && npm run build")
    print(f"  To preview: cd frontend && npm run dev")


if __name__ == "__main__":
    main()
