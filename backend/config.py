"""Configuration for fund dashboard data pipeline."""
import os

# Excel file password (set via EXCEL_PASSWORD env var, defaults to delamu)
EXCEL_PASSWORD = os.environ.get("EXCEL_PASSWORD", "delamu")

# Sheet names to skip (not detail sheets)
SKIP_SHEETS = ["本月支出汇总表", "总支出项汇总", "日报汇总"]

# Transfer detection keywords
TRANSFER_KEYWORDS = ["往来"]

# Columns to check for transfer keywords (by layout type)
# Standard layout: D=分类(category)
# Pingpong layout: E=备注(remark)
# Both layouts: C=摘要(summary) as safety net

# Account type classification rules
# (keyword_list, type_name)
ACCOUNT_TYPE_RULES = [
    (["pingpong", "光子易", "虚拟信用卡"], "Pingpong"),
    (["寻汇"], "寻汇"),
    (["Citibank"], "Citibank"),
    (["汇丰"], "汇丰"),
    (["FT账户"], "FT账户"),
    (["供应链"], "供应链"),
    (["工行", "中信", "中行", "招行", "公账", "建行"], "国内公账"),
    (["paypal", "PayPal"], "PayPal"),
    (["P卡"], "P卡"),
    (["万里汇"], "万里汇"),
    (["钱海"], "钱海"),
    (["现金"], "现金"),
    (["沃尔玛", "TK"], "其他"),
    (["领头羊"], "领头羊"),
]

# Currency mapping from Chinese suffix
CURRENCY_MAP = {
    "美元": "USD",
    "人民币": "CNY",
    "欧元": "EUR",
    "英镑": "GBP",
    "加元": "CAD",
    "日元": "JPY",
    "港币": "HKD",
    "港元": "HKD",
    "澳元": "AUD",
    "墨西哥币": "MXN",
    "新加坡元": "SGD",
    "新西兰元": "NZD",
}

# Pingpong layout detection keywords
PINGPONG_KEYWORDS = ["pingpong", "光子易", "虚拟信用卡"]

# Standard layout: A=户名, B=日期, C=摘要, D=分类, E=收入, F=支出, G=余额
# Pingpong layout: A=账户, B=创建时间, C=店铺所在地区, D=店铺名称, E=备注, F=收入, G=支出, H=余额

# Layout column mappings
STANDARD_COLS = {
    "date": 2,       # B
    "summary": 3,    # C
    "category": 4,   # D
    "income": 5,     # E
    "expense": 6,    # F
    "balance": 7,    # G
}

PINGPONG_COLS = {
    "date": 2,       # B
    "summary": 5,    # E (备注)
    "category": 5,   # E (备注, same as summary for pingpong)
    "income": 6,     # F
    "expense": 7,    # G
    "balance": 8,    # H
}

# Database
DB_PATH = "~/Desktop/fund-dashboard/data/fund.db"

# Export
DATA_DIR = "~/Desktop/fund-dashboard/frontend/public/data"
