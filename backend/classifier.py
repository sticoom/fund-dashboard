"""Transfer classifier: identify internal transfers using keyword matching
and cross-sheet amount pairing.

Two-layer detection:
  Layer 1: Keyword matching - catches obvious cases (往来, etc.)
  Layer 2: Cross-sheet pairing - matches expenses in one sheet to equal
           income in another sheet on the same date, regardless of category.
"""

from parser import Transaction, ParsedSheet

# Layer 1: Category keywords that are ALWAYS internal transfers
TRANSFER_CATEGORIES = ["往来"]

# Categories that are SUSPECTED to be internal transfers
# These are flagged for review but not auto-classified by keyword alone
SUSPECTED_CATEGORIES = ["投资收益", "投资款"]

# Summary keywords indicating transfer-like activity (for suspected detection)
TRANSFER_SUMMARY_PATTERNS = ["转入", "转出", "提回", "划转", "调拨", "提现到"]


def is_transfer(txn: Transaction) -> bool:
    """Check if a transaction is definitively an internal transfer (Layer 1).

    Priority: category (D column) first, summary (C column) only as fallback
    when category is empty. Does NOT check row_text to avoid false positives.
    """
    category = (txn.category or "").strip()
    summary = (txn.summary or "").strip()

    for keyword in TRANSFER_CATEGORIES:
        # Primary: category contains transfer keyword
        if keyword in category:
            return True

    # Fallback: only check summary when category is empty
    if not category:
        for keyword in TRANSFER_CATEGORIES:
            if keyword in summary:
                return True

    return False


def is_suspected_transfer(txn: Transaction) -> bool:
    """Check if a transaction is suspected to be an internal transfer.

    Returns True if the transaction has transfer-like characteristics
    but isn't explicitly marked as 往来/利润提回.
    """
    if is_transfer(txn):
        return False

    # Category-based suspicion
    category = (txn.category or "").strip()
    if category in SUSPECTED_CATEGORIES:
        return True

    # Summary-based suspicion: transfer verbs + large amount
    summary = txn.summary or ""
    if any(kw in summary for kw in TRANSFER_SUMMARY_PATTERNS):
        if txn.income > 100 or txn.expense > 100:
            return True

    return False


def _round_amount(amount: float) -> float:
    """Round to 2 decimal places for amount matching."""
    return round(amount, 2)


def find_cross_sheet_pairs(
    all_txns: list[Transaction], tolerance: float = 0.5
) -> list[dict]:
    """Layer 2: Find matching transaction pairs across sheets by amount.

    An expense in one sheet paired with an equal income in another sheet
    on the same date indicates an internal transfer, regardless of category.

    Returns list of pair dicts with both transactions and metadata.
    """
    # Separate into expenses and income pools
    expenses = []  # (txn_index, amount, txn)
    incomes = []   # (txn_index, amount, txn)

    for i, txn in enumerate(all_txns):
        if txn.expense > tolerance:
            expenses.append((i, _round_amount(txn.expense), txn))
        if txn.income > tolerance:
            incomes.append((i, _round_amount(txn.income), txn))

    # Try to pair expenses with matching incomes
    used_expense = set()
    used_income = set()
    pairs = []

    for e_idx, e_amt, e_txn in expenses:
        for i_idx, i_amt, i_txn in incomes:
            if i_idx in used_income:
                continue
            # Same date, different sheet, matching amount
            if (e_txn.date == i_txn.date
                    and e_txn.sheet_name != i_txn.sheet_name
                    and abs(e_amt - i_amt) < tolerance):
                pairs.append({
                    "expense_sheet": e_txn.sheet_name,
                    "expense_summary": e_txn.summary,
                    "expense_category": e_txn.category,
                    "amount": e_amt,
                    "income_sheet": i_txn.sheet_name,
                    "income_summary": i_txn.summary,
                    "income_category": i_txn.category,
                    "expense_txn": e_txn,
                    "income_txn": i_txn,
                    "expense_is_transfer": is_transfer(e_txn),
                    "income_is_transfer": is_transfer(i_txn),
                })
                used_expense.add(e_idx)
                used_income.add(i_idx)
                break

    return pairs


def classify_all_transactions(
    sheets: list[ParsedSheet], tolerance: float = 0.5
) -> dict:
    """Classify all transactions across all sheets with both layers.

    Returns dict with:
        - transfer_income/expense: keyword-matched transfers (Layer 1)
        - real_income/expense: non-transfer transactions
        - cross_sheet_pairs: amount-matched pairs (Layer 2)
        - warnings: suspected transfers and mismatches
        - unpaired_transfers: Layer 1 transfers without a matching pair
        - paired_non_transfers: Layer 2 pairs where neither side was keyword-matched
    """
    all_txns = []
    for sheet in sheets:
        all_txns.extend(sheet.transactions)

    # Layer 1: Keyword classification
    transfer_income = 0.0
    transfer_expense = 0.0
    real_income = 0.0
    real_expense = 0.0
    transfer_count = 0

    for txn in all_txns:
        if is_transfer(txn):
            transfer_income += txn.income
            transfer_expense += txn.expense
            transfer_count += 1
        else:
            real_income += txn.income
            real_expense += txn.expense

    # Layer 2: Cross-sheet pairing
    pairs = find_cross_sheet_pairs(all_txns, tolerance)

    # Generate warnings
    warnings = []

    # Warn about suspected transfers not caught by Layer 1
    for txn in all_txns:
        if is_suspected_transfer(txn):
            warnings.append({
                "type": "suspected_transfer",
                "sheet": txn.sheet_name,
                "category": txn.category,
                "summary": txn.summary,
                "income": txn.income,
                "expense": txn.expense,
                "message": f"[{txn.category}] {txn.summary} 疑似内部往来但未标记为往来",
            })

    # Warn about Layer 2 pairs where neither side was keyword-matched
    for pair in pairs:
        if not pair["expense_is_transfer"] and not pair["income_is_transfer"]:
            warnings.append({
                "type": "unmarked_pair",
                "amount": pair["amount"],
                "expense": f"[{pair['expense_sheet']}] [{pair['expense_category']}] {pair['expense_summary']}",
                "income": f"[{pair['income_sheet']}] [{pair['income_category']}] {pair['income_summary']}",
                "message": (
                    f"跨sheet配对: {pair['expense_sheet']}支出 {pair['amount']:.2f} "
                    f"↔ {pair['income_sheet']}收入 {pair['amount']:.2f}，"
                    f"双方均未标记为往来"
                ),
            })

    # Warn about Layer 1 transfers that have no matching pair
    paired_expense_sheets = {p["expense_sheet"] for p in pairs}
    paired_income_sheets = {p["income_sheet"] for p in pairs}
    for txn in all_txns:
        if is_transfer(txn):
            has_pair = False
            for p in pairs:
                if (p["expense_txn"] is txn or p["income_txn"] is txn):
                    has_pair = True
                    break
            if not has_pair and (txn.income > tolerance or txn.expense > tolerance):
                direction = "收入" if txn.income > 0 else "支出"
                warnings.append({
                    "type": "unpaired_transfer",
                    "sheet": txn.sheet_name,
                    "category": txn.category,
                    "summary": txn.summary,
                    "amount": txn.income if txn.income > 0 else txn.expense,
                    "message": (
                        f"[{txn.sheet_name}] [{txn.category}] {txn.summary} "
                        f"{direction}{txn.income if txn.income > 0 else txn.expense:.2f} "
                        f"已标记往来但未找到配对"
                    ),
                })

    return {
        "transfer_income": transfer_income,
        "transfer_expense": transfer_expense,
        "transfer_count": transfer_count,
        "real_income": real_income,
        "real_expense": real_expense,
        "cross_sheet_pairs": pairs,
        "warnings": warnings,
    }


def classify_sheet_transactions(sheet: ParsedSheet) -> dict:
    """Classify all transactions in a sheet into transfer vs real (single-sheet)."""
    result = {
        "real_income": 0.0,
        "real_expense": 0.0,
        "transfer_income": 0.0,
        "transfer_expense": 0.0,
        "transfer_count": 0,
    }

    for txn in sheet.transactions:
        if is_transfer(txn):
            result["transfer_income"] += txn.income
            result["transfer_expense"] += txn.expense
            result["transfer_count"] += 1
        else:
            result["real_income"] += txn.income
            result["real_expense"] += txn.expense

    return result


def get_transfer_list(sheets: list[ParsedSheet]) -> list[dict]:
    """Get a list of all transfer transactions for review."""
    transfers = []
    for sheet in sheets:
        for txn in sheet.transactions:
            if is_transfer(txn):
                transfers.append({
                    "sheet_name": txn.sheet_name,
                    "currency": txn.currency,
                    "date": txn.date,
                    "summary": txn.summary,
                    "category": txn.category,
                    "income": txn.income,
                    "expense": txn.expense,
                    "balance": txn.balance,
                })
    return transfers
