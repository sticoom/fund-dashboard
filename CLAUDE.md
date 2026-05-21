# CLAUDE.md — 资金核对看板

## 项目概述

每日资金核对看板。用户上传加密 Excel 资金流动表，系统自动解密、解析公式、核对各子账户收支数据，验证余额平衡后以卡片式看板展示。

**核心场景**：财务人员每日上传资金报表 → 自动核对 → 查看结果，不做历史存储。

## 技术栈

- **后端**: Python 3 / FastAPI / openpyxl / msoffcrypto-tool
- **前端**: React 19 / TypeScript / Vite
- **无数据库**：核对结果直接写入 JSON 文件，前端 fetch 读取

## 项目结构

```
fund-dashboard/
├── backend/
│   ├── server.py          # FastAPI 服务：上传接口 + 静态文件托管
│   ├── verify.py          # 核心核对引擎（公式感知）
│   ├── parser.py          # Excel 解析工具：解密、日期提取、子表解析
│   ├── config.py          # 配置：密码、列映射、币种、往来关键词
│   ├── classifier.py      # 分类器：判断交易是否为"往来"（内部转账）
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # 主布局：顶部导航 + 上传按钮
│   │   ├── pages/
│   │   │   ├── Summary.tsx    # 核对总表（按收款/付款/收支分组）
│   │   │   └── Detail.tsx     # 详情页（按子表展开、按分类分组）
│   │   ├── App.css / index.css
│   │   └── pages/*.css
│   ├── public/data/           # JSON 输出目录（运行时生成）
│   └── vite.config.ts         # 开发模式代理 /api → :8000
└── CLAUDE.md
```

## 运行方式

### 开发

```bash
# 后端
cd backend && pip install -r requirements.txt && python server.py
# 前端（新终端）
cd frontend && npm install && npm run dev
# 访问 http://localhost:5173
```

### 生产

```bash
cd frontend && npm run build
cd backend && EXCEL_PASSWORD=xxx python server.py --prod
# 访问 http://localhost:8000
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `EXCEL_PASSWORD` | Excel 解密密码 | `delamu` |

## 核心业务逻辑（重要）

### Excel 文件结构

上传的 Excel 是加密的 `.xlsx` 文件，密码通过环境变量配置。文件包含：

1. **日报汇总** sheet — 汇总所有账户数据，分为上下两个区域
2. **子表**（如 "德拉姆pingpong-美元"、"工行基本户" 等）— 各账户的交易明细

### 日报汇总的双区结构（最关键的知识点）

```
上区 (rows 5 ~ 总计行-1)：RMB 人民币值
  D列=昨日余额(¥), E列=本日收款(¥), F列=本日付款(¥), G列=本日余额(¥)
  外币账户公式: =D{下区行号}*$L${下区行号}  （本币 × 汇率 = RMB）
  CNY账户公式: 直接 SUMIF 引用子表列

下区 (rows 总计行+1 ~ 末尾)：原始币种值 + 汇率
  B列=账户名, D列=昨日余额(本币), E列=本日收款(本币), F列=本日付款(本币)
  L列=汇率（1.0 表示 CNY）
  E/F列公式: SUMIF(子表!列, 日期, 子表!金额列) 或直接引用子表单元格

总计行: A列含"总计", D列=期初余额总计, G列=期末余额总计
```

### 核对链路

```
子表交易明细 → SUMIF 聚合（下区）→ × 汇率（上区）→ RMB 值
     ↓                ↓                    ↓
  逐笔核对       本币金额核对          人民币金额核对
```

1. 解密 Excel 两次：`data_only=True`（取值）和 `data_only=False`（取公式）
2. 解析下区公式，得到 SUMIF 引用的子表名和列
3. 解析上区公式，找到 `=D{row}*$L${row}` 引用的下区行号
4. 读取子表当日交易，汇总本币收入/支出
5. 对比：子表汇总 vs 下区 SUMIF 值（本币核对）
6. 对比：本币 × 汇率 vs 上区 RMB 值（汇率核对）
7. 对比：期初 + 收入 - 支出 = 期末（余额平衡核对）

### 日期来源

- **权威来源**：日报汇总 K2 单元格
- **交叉验证**：文件名中的日期（如 `2026年5月资金流动表5.13.xlsx` → 2026-05-13）
- 二者不一致时 `date_mismatch` 为 true，以 K2 为准

### 期初余额

直接读取"公司货币资金 总计"行的 D 列（昨日余额），**不是**各子表求和。

### 往来（内部转账）识别

`classifier.py` 检查交易的 `summary` 和 `category` 字段是否包含"往来"关键词。往来交易单独标记，不纳入实际收支统计。

### 子表布局差异

存在两种列布局，由 `config.py` 中的关键词检测：

- **标准布局**：A=户名, B=日期, C=摘要, D=分类, E=收入, F=支出, G=余额
- **Pingpong 布局**：A=账户, B=创建时间, C=店铺地区, D=店铺名, E=备注, F=收入, G=支出, H=余额

### 币种识别

- 子表名含"美元"→ USD，"欧元"→ EUR，"加元"→ CAD 等（`CURRENCY_MAP`）
- 汇率 = 1.0 → CNY
- 无明确币种关键词时，按汇率推断（rate > 5 → USD）

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/upload` | 上传 Excel → 核对 → 写 JSON → 返回摘要 |
| GET | `/api/status` | 健康检查 |
| GET | `/data/verification.json` | 前端读取核对结果 |

### verification.json 结构

```json
{
  "date": "2026-05-13",
  "filename_date": "2026-05-13",
  "sheet_date": "2026-05-13",
  "date_mismatch": null,
  "summary": {
    "prev_balance": 28950014.54,
    "income": 1301535.52,
    "expense": 4630.09,
    "balance": 30246919.97,
    "net_flow": 1296905.44,
    "income_match": true,
    "expense_match": true,
    "balance_match": true
  },
  "active_accounts": 5,
  "issues_count": 0,
  "sheets": [
    {
      "sheet_name": "德拉姆pingpong-加元",
      "currency": "CAD",
      "exchange_rate": 5.0224,
      "local_income": 34445.93,
      "rmb_income": 173001.24,
      "income_ok": true,
      "all_ok": true,
      "real_income": 34445.93,
      "transfer_income": 0.0,
      "transactions": [...]
    }
  ]
}
```

## 前端页面

### 核对总表 (Summary.tsx)

- 顶部 KPI 行：期初余额、本日收款、本日付款、期末余额、净流入
- 验证条：余额平衡公式 + 收入/支出核对结果
- 按账户类型分组：收款（绿 ↓）、付款（红 ↑）、收支（蓝 ↕）
- 每个账户卡片可展开查看交易明细

### 详情页 (Detail.tsx)

- 按子表名展开，显示本币/RMB 换算
- 交易按分类（category）分组显示
- 支持排除往来交易、搜索子表名

## 注意事项

1. **不要硬编码密码**：使用 `EXCEL_PASSWORD` 环境变量，默认值仅用于本地开发
2. **子表多日数据**：子表包含多日交易，核对时只取 report_date 当天的（`txn.date != date` 跳过）
3. **精度容差**：浮点对比使用 `TOLERANCE = 0.5`，避免汇率计算精度差异
4. **前端双目录写入**：server.py 同时写 `public/data`（开发）和 `dist/data`（生产）
5. **pingpong虚拟信用卡** 是 USD 账户，名称中无币种关键词，需通过汇率推断
6. **修改 verify.py 要特别谨慎**：公式解析依赖日报汇总的具体行列布局，结构变化可能导致解析失败
7. **Excel 公式不能 data_only=True 读取**：必须同时开两次 workbook，一次取值、一次取公式文本
