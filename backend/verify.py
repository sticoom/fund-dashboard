"""Formula-aware reconciliation engine.

Parses 日报汇总 formulas to trace exact data flow:
  Lower section (rows 98+): SUMIF referencing sub-sheet columns → original currency values
  Upper section (rows 5-96): =E{lower}*$L${lower} → RMB-converted values
  Exchange rate in column L of lower section determines actual currency.

Verification chain:
  sub-sheet transactions → SUMIF result (lower section) → × exchange rate → RMB (upper section)
"""

import io
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import msoffcrypto
import openpyxl

from parser import (
    extract_report_date,
    parse_sheet,
    safe_float,
    safe_str,
)
from classifier import is_transfer
from config import EXCEL_PASSWORD, SKIP_SHEETS, CURRENCY_MAP

TOLERANCE = 0.5


def _decrypt(filepath: str, data_only: bool) -> openpyxl.Workbook:
    source_path = Path(filepath).expanduser()
    with open(source_path, "rb") as f:
        file = msoffcrypto.OfficeFile(f)
        file.load_key(password=EXCEL_PASSWORD)
        buf = io.BytesIO()
        file.decrypt(buf)
        buf.seek(0)
        return openpyxl.load_workbook(buf, data_only=data_only)


def _parse_sumif(formula: str):
    """Extract sheet_name, date_col_range, sum_col_range from SUMIF formula.

    e.g. =SUMIF('德拉姆pingpong-加元'!$B:$B,$K$2,'德拉姆pingpong-加元'!F:F)
    returns ('德拉姆pingpong-加元', 'B:B', 'F:F')
    """
    if not formula or not str(formula).startswith("=SUMIF"):
        return None
    formula = str(formula)
    # Match SUMIF(sheet!col_range, criteria, sheet!col_range) or direct cell ref
    m = re.match(
        r"=SUMIF\('([^']+)'!\$(\w+):\$(\w+),.*?'[^']+'!(\w+):(\w+)\)",
        formula,
    )
    if m:
        sheet = m.group(1)
        sum_col = m.group(4)
        return sheet, sum_col
    m = re.match(r"=SUMIF\('([^']+)'!\$(\w+):\$(\w+),.*?[^']+'!(\w+):(\w+)\)", formula)
    if m:
        return m.group(1), m.group(3)
    m = re.match(r"=SUMIF\((\w+)!\$(\w+):\$(\w+),.*?\1!(\w+):(\w+)\)", formula)
    if m:
        return m.group(1), m.group(4)
    m = re.match(r"=SUMIF\('([^']+)'!(\w+):(\w+),.*?'[^']+'!(\w+):(\w+)\)", formula)
    if m:
        return m.group(1), m.group(4)
    # range variant e.g. pingpong沃尔玛收款!B3:B19
    m = re.match(r"=SUMIF\('([^']+)'!(\w+\d+:\w+\d+),.*?'[^']+'!(\w+\d+:\w+\d+)\)", formula)
    if m:
        return m.group(1), m.group(3).split(":")[0][:1]
    m = re.match(r"=SUMIF\((\w+)!(\w+):(\w+),.*?\1!(\w+):(\w+)\)", formula)
    if m:
        return m.group(1), m.group(4)
    return None


def _parse_direct_ref(formula: str):
    """Parse direct cell reference like =深圳主体对公美元户!I6 or ='子公司公账-工商银行'!I18."""
    if not formula or not str(formula).startswith("="):
        return None
    formula = str(formula)
    m = re.match(r"='([^']+)'!(\w+)(\d+)", formula)
    if m:
        return m.group(1), m.group(2), int(m.group(3))
    m = re.match(r"=(\w+)!(\w+)(\d+)", formula)
    if m:
        return m.group(1), m.group(2), int(m.group(3))
    return None


def _col_letter_to_idx(letter: str) -> int:
    """Convert column letter to 1-based index: A=1, B=2, ..., Z=26, AA=27."""
    result = 0
    for ch in letter.upper():
        result = result * 26 + (ord(ch) - ord("A") + 1)
    return result


def _extract_filename_date(filepath: str) -> str | None:
    """Extract date from filename like '2026年5月资金流动表5.13.xlsx' → '2026-05-13'."""
    name = Path(filepath).stem
    # Match: "2026年5月资金流动表5.13" → year=2026, month=5, day=13
    m = re.search(r'(\d{4})年(\d+)月.*?表(\d+)\.(\d+)', name)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(4)):02d}"
    # Fallback: "5.13" after "表" means month.day
    m = re.search(r'表(\d+)\.(\d+)', name)
    if m:
        ym = re.search(r'(\d{4})年(\d+)月', name)
        if ym:
            return f"{ym.group(1)}-{int(ym.group(2)):02d}-{int(m.group(2)):02d}"
        from datetime import datetime
        return f"{datetime.now().year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    return None


def verify(filepath: str, original_filename: str | None = None) -> dict:
    """Run formula-aware reconciliation.

    Args:
        filepath: Path to the encrypted Excel file.
        original_filename: Original upload filename (for date extraction).
    """
    wb_data = _decrypt(filepath, data_only=True)
    wb_formulas = _decrypt(filepath, data_only=False)

    # Date: K2 (sheet_date) is authoritative, filename_date is cross-check
    fname = original_filename or filepath
    filename_date = _extract_filename_date(fname)
    sheet_date = extract_report_date(wb_data)
    date = sheet_date or filename_date
    if not date:
        from datetime import datetime
        date = datetime.now().strftime("%Y-%m-%d")
    date_mismatch = (filename_date and sheet_date and filename_date != sheet_date)

    ws_data = wb_data["日报汇总"]
    ws_formulas = wb_formulas["日报汇总"]

    # Find total row (公司货币资金 总计)
    total_row = None
    for row in ws_data.iter_rows(min_row=1, max_row=120, values_only=False):
        a_val = str(row[0].value or "").strip()
        if "总计" in a_val:
            total_row = row[0].row
            break
    if total_row is None:
        total_row = 97

    # Read authoritative totals from 公司货币资金 总计 row
    total_prev = safe_float(ws_data.cell(total_row, 4).value)   # D: 昨日余额 = 期初余额
    total_income = safe_float(ws_data.cell(total_row, 5).value)  # E: 本日收款
    total_expense = safe_float(ws_data.cell(total_row, 6).value) # F: 本日付款
    total_balance = safe_float(ws_data.cell(total_row, 7).value) # G: 本日余额

    # ---- Parse lower section (rows total_row+1 to max_row) ----
    # Each row has: name (B), prev_balance (D), income_formula (E), expense_formula (F), rate (L)
    # Upper section rows with =D{lower}*$L${lower} reference these rows
    lower_rows = {}  # row_num -> {name, sheet, income_col, expense_col, rate, prev_local, income_local, expense_local}
    sheet_to_lower = {}  # sub_sheet_name -> lower_row_info

    for r in range(total_row + 1, ws_data.max_row + 1):
        name = safe_str(ws_data.cell(r, 2).value) or safe_str(ws_data.cell(r, 1).value)
        if not name:
            continue
        rate = safe_float(ws_data.cell(r, 12).value)  # L column
        if rate == 0:
            rate = 1.0
        prev_local = safe_float(ws_data.cell(r, 4).value)  # D column (local currency)
        income_local = safe_float(ws_data.cell(r, 5).value)  # E column (SUMIF result)
        expense_local = safe_float(ws_data.cell(r, 6).value)  # F column (SUMIF result)

        # Parse formulas to get sub-sheet and column references
        income_formula = str(ws_formulas.cell(r, 5).value or "")
        expense_formula = str(ws_formulas.cell(r, 6).value or "")

        income_ref = _parse_sumif(income_formula)
        expense_ref = _parse_sumif(expense_formula)

        info = {
            "name": name,
            "row": r,
            "rate": rate,
            "prev_local": prev_local,
            "income_local": income_local,
            "expense_local": expense_local,
            "income_sheet": income_ref[0] if income_ref else None,
            "income_col": income_ref[1] if income_ref else None,
            "expense_sheet": expense_ref[0] if expense_ref else None,
            "expense_col": expense_ref[1] if expense_ref else None,
            "is_cny": rate == 1.0,
        }

        # Also check for direct cell references
        if not income_ref:
            direct = _parse_direct_ref(income_formula)
            if direct:
                info["income_sheet"] = direct[0]
                info["income_col"] = direct[1]
                info["income_row"] = direct[2]
                info["income_is_direct"] = True
        if not expense_ref:
            direct = _parse_direct_ref(expense_formula)
            if direct:
                info["expense_sheet"] = direct[0]
                info["expense_col"] = direct[1]
                info["expense_row"] = direct[2]
                info["expense_is_direct"] = True

        lower_rows[r] = info
        if info["income_sheet"]:
            sheet_to_lower[info["income_sheet"]] = info

    # ---- Parse upper section (rows 5 to total_row-1) ----
    # Upper rows reference lower rows via =D{lower}*$L${lower}
    upper_rows = []
    for r in range(5, total_row):
        name = safe_str(ws_data.cell(r, 2).value) or safe_str(ws_data.cell(r, 1).value)
        if not name:
            continue
        if any(skip in name for skip in ("开户行", "资金汇总")):
            continue

        prev_rmb = safe_float(ws_data.cell(r, 4).value)
        income_rmb = safe_float(ws_data.cell(r, 5).value)
        expense_rmb = safe_float(ws_data.cell(r, 6).value)
        balance_rmb = safe_float(ws_data.cell(r, 7).value)

        # Parse formulas to find lower-section row reference
        d_formula = str(ws_formulas.cell(r, 4).value or "")
        e_formula = str(ws_formulas.cell(r, 5).value or "")
        f_formula = str(ws_formulas.cell(r, 6).value or "")

        # Check if it references a lower row (foreign currency account)
        lower_ref = None
        m = re.match(r"=D(\d+)\*\$", d_formula)
        if m:
            lower_ref = int(m.group(1))
        if not lower_ref:
            m = re.match(r"=D(\d+)\*", d_formula)
            if m:
                lower_ref = int(m.group(1))

        # Check for direct SUMIF (CNY accounts in upper section)
        direct_sumif = _parse_sumif(e_formula) if e_formula.startswith("=SUMIF") else None
        direct_ref = _parse_direct_ref(e_formula) if not direct_sumif and e_formula.startswith("=") else None

        upper_rows.append({
            "row": r,
            "name": name,
            "prev_rmb": prev_rmb,
            "income_rmb": income_rmb,
            "expense_rmb": expense_rmb,
            "balance_rmb": balance_rmb,
            "lower_ref": lower_ref,
            "direct_sumif": direct_sumif,
            "direct_ref": direct_ref,
        })

    # ---- Now compute verification for each active account ----
    active_sheets = []

    for upper in upper_rows:
        if upper["income_rmb"] < 0.01 and upper["expense_rmb"] < 0.01:
            continue

        lower = None
        sheet_name = None
        rate = 1.0
        income_local_reported = 0.0
        expense_local_reported = 0.0
        prev_local_reported = 0.0

        if upper["lower_ref"] and upper["lower_ref"] in lower_rows:
            # Foreign currency account - references lower section
            lower = lower_rows[upper["lower_ref"]]
            sheet_name = lower["income_sheet"] or lower["expense_sheet"] or upper["name"]
            rate = lower["rate"]
            income_local_reported = lower["income_local"]
            expense_local_reported = lower["expense_local"]
            prev_local_reported = lower["prev_local"]
        elif upper["direct_sumif"]:
            sheet_name = upper["direct_sumif"][0]
            income_local_reported = upper["income_rmb"]
            expense_local_reported = upper["expense_rmb"]
            prev_local_reported = upper["prev_rmb"]
        elif upper["direct_ref"]:
            sheet_name = upper["direct_ref"][0]
            income_local_reported = upper["income_rmb"]
            expense_local_reported = upper["expense_rmb"]
            prev_local_reported = upper["prev_rmb"]
        else:
            sheet_name = upper["name"]

        if not sheet_name:
            continue

        # Determine currency from exchange rate
        currency = "CNY"
        if lower and not lower["is_cny"]:
            for kw, code in CURRENCY_MAP.items():
                if kw in (lower["name"] or ""):
                    currency = code
                    break
            else:
                currency = "USD" if rate > 5 else "OTH"

        # Compute from sub-sheet transactions
        calc_local_income = 0.0
        calc_local_expense = 0.0
        real_income = 0.0
        real_expense = 0.0
        transfer_income = 0.0
        transfer_expense = 0.0
        txns = []

        if sheet_name in wb_data.sheetnames and sheet_name not in SKIP_SHEETS:
            ws = wb_data[sheet_name]
            result = parse_sheet(ws, sheet_name)
            for txn in result.transactions:
                if txn.date and txn.date != date:
                    continue
                calc_local_income += txn.income
                calc_local_expense += txn.expense
                if is_transfer(txn):
                    transfer_income += txn.income
                    transfer_expense += txn.expense
                else:
                    real_income += txn.income
                    real_expense += txn.expense
                txns.append({
                    "summary": txn.summary,
                    "category": txn.category,
                    "income": txn.income,
                    "expense": txn.expense,
                    "balance": txn.balance,
                    "is_transfer": is_transfer(txn),
                })

        # Verification
        income_ok = abs(calc_local_income - income_local_reported) < TOLERANCE
        expense_ok = abs(calc_local_expense - expense_local_reported) < TOLERANCE

        # Balance check: prev + income - expense = balance
        expected_balance = upper["prev_rmb"] + upper["income_rmb"] - upper["expense_rmb"]
        balance_ok = abs(upper["balance_rmb"] - expected_balance) < TOLERANCE

        calc_rmb_income = calc_local_income * rate
        calc_rmb_expense = calc_local_expense * rate

        active_sheets.append({
            "sheet_name": sheet_name,
            "summary_name": upper["name"],
            "currency": currency,
            "exchange_rate": rate,
            "prev_local": prev_local_reported,
            "local_income": calc_local_income,
            "local_expense": calc_local_expense,
            "rmb_income": calc_rmb_income,
            "rmb_expense": calc_rmb_expense,
            "reported_income": upper["income_rmb"],
            "reported_expense": upper["expense_rmb"],
            "reported_balance": upper["balance_rmb"],
            "reported_prev": upper["prev_rmb"],
            "income_ok": income_ok,
            "expense_ok": expense_ok,
            "balance_ok": balance_ok,
            "all_ok": income_ok and expense_ok and balance_ok,
            "income_diff": calc_local_income - income_local_reported,
            "expense_diff": calc_local_expense - expense_local_reported,
            "real_income": real_income,
            "real_expense": real_expense,
            "transfer_income": transfer_income,
            "transfer_expense": transfer_expense,
            "transactions": txns,
            "formula_source": "lower_ref" if lower else ("direct_sumif" if upper["direct_sumif"] else "direct_ref" if upper["direct_ref"] else "unknown"),
        })

    wb_data.close()
    wb_formulas.close()

    total_calc_income = sum(s["rmb_income"] for s in active_sheets)
    total_calc_expense = sum(s["rmb_expense"] for s in active_sheets)
    issues = [s for s in active_sheets if not s["all_ok"]]

    return {
        "date": date,
        "filename": Path(filepath).name,
        "filename_date": filename_date,
        "sheet_date": sheet_date,
        "date_mismatch": date_mismatch,
        "summary": {
            "prev_balance": total_prev,
            "income": total_income,
            "expense": total_expense,
            "balance": total_balance,
            "net_flow": total_income - total_expense,
            "calc_income": total_calc_income,
            "calc_expense": total_calc_expense,
            "income_match": abs(total_calc_income - total_income) < TOLERANCE,
            "expense_match": abs(total_calc_expense - total_expense) < TOLERANCE,
            "expected_balance": total_prev + total_income - total_expense,
            "balance_match": abs(total_balance - (total_prev + total_income - total_expense)) < TOLERANCE,
        },
        "active_accounts": len(active_sheets),
        "issues_count": len(issues),
        "sheets": active_sheets,
    }
