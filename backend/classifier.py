"""Transfer classifier: identify internal transfers using keyword matching."""

from parser import Transaction, ParsedSheet

TRANSFER_KEYWORDS = ["往来"]


def is_transfer(txn: Transaction) -> bool:
    """Check if a transaction is an internal transfer.

    Checks ALL text fields (category, summary, row_text) for transfer keywords.
    This catches 往来 regardless of which column it appears in.
    """
    for keyword in TRANSFER_KEYWORDS:
        # Check structured fields
        if keyword in (txn.category or ""):
            return True
        if keyword in (txn.summary or ""):
            return True
        # Check full row text (catches 往来 in any column)
        if keyword in (txn.row_text or ""):
            return True
    return False


def classify_sheet_transactions(sheet: ParsedSheet) -> dict:
    """Classify all transactions in a sheet into transfer vs real.

    Returns dict with:
        - real_income: sum of non-transfer income
        - real_expense: sum of non-transfer expense
        - transfer_income: sum of transfer income
        - transfer_expense: sum of transfer expense
        - transfer_count: number of transfer transactions
    """
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
    """Get a list of all transfer transactions for review.

    Returns list of dicts with transaction details.
    """
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
