---
version: "2.0"
last_verified: "2026-05-22"
tags: [finance, excel, reconciliation, fastapi, react]
dependencies:
  - python >= 3.10
  - node >= 20
  - openpyxl >= 3.1
  - msoffcrypto-tool >= 4.12
  - fastapi >= 0.100
  - react >= 19
---

# 资金核对看板

> **TL;DR** — 用户每日上传加密 Excel 资金流动表，系统解密 → 解析公式 → 核对各子账户收支 → 验证余额平衡 → 卡片式看板展示。无历史存储，每次上传覆盖上一次。

## 触发条件

当用户需要：
- 对每日资金报表做自动化收支核对
- 验证"期初 + 收入 - 支出 = 期末"余额平衡
- 区分"实际收支"和"往来（内部转账）"
- 按账户类型分组展示（收款/付款/收支）

## 架构概述

```
用户上传 .xlsx
    ↓
server.py [/api/upload]
    ↓
verify.py ← 核心引擎
    ├── parser.py      解密 + 解析子表交易
    ├── config.py      币种/列映射/关键词
    └── classifier.py  往来识别
    ↓
verification.json → 前端 fetch 读取
```

**数据流**：Excel → 解密 → 双 workbook（取值+取公式）→ 公式解析 → 核对 → JSON → 前端渲染

**关键约束**：
- 无数据库，核对结果是瞬态的（JSON 文件）
- 前端同时写入 `public/data/`（dev）和 `dist/data/`（prod）两个目录
- 生产模式 `python server.py --prod` 由 FastAPI 直接托管前端静态文件

## 快速启动

```bash
# 开发
cd backend && pip install -r requirements.txt && python server.py        # :8000
cd frontend && npm install && npm run dev                                 # :5173 (代理 /api → :8000)

# 生产
cd frontend && npm run build
cd backend && EXCEL_PASSWORD=xxx python server.py --prod                  # :8000

# Docker
docker build -t fund-dashboard .
docker run -e EXCEL_PASSWORD=xxx -p 8000:8000 fund-dashboard
```

## 核心业务逻辑

### 日报汇总的双区结构（⚠️ 最关键的知识点）

这是整个核对引擎的基础。日报汇总 sheet 分为上下两区，通过公式关联：

```
┌─────────────────────────────────────────────────────────────┐
│ 上区 (rows 5 ~ 总计行-1)    → RMB 人民币值                  │
│   D=昨日余额(¥)  E=本日收款(¥)  F=本日付款(¥)  G=本日余额(¥) │
│                                                              │
│   外币账户:  =D{下区行}*$L${下区行}  (本币×汇率=RMB)        │
│   CNY账户:   直接 SUMIF 引用子表列                           │
├─────────────────────────────────────────────────────────────┤
│ 总计行: A列含"总计"（日报汇总中只有一行总计）                │
│   D=期初余额总计  G=期末余额总计  ← 权威数据源               │
├─────────────────────────────────────────────────────────────┤
│ 下区 (rows 总计行+1 ~ 末尾)  → 原始币种值 + 汇率            │
│   B=账户名  D=昨日余额(本币)  E=本日收款(本币)  F=本日付款   │
│   L=汇率 (1.0=CNY)                                           │
│   E/F列公式: SUMIF(子表!列, 日期, 子表!金额列)              │
└─────────────────────────────────────────────────────────────┘
```

**核对链路**：
```
子表交易明细 → SUMIF聚合(下区) → ×汇率(上区) → RMB值
     ↓              ↓                  ↓
  逐笔核对     本币金额核对       人民币金额核对
```

### 子表两种布局

由 `config.py` 中 `PINGPONG_KEYWORDS` 检测，决定列映射：

| 布局 | 日期 | 摘要 | 分类 | 收入 | 支出 | 余额 |
|------|------|------|------|------|------|------|
| 标准 | B | C | D | E | F | G |
| Pingpong | B | E(备注) | E(备注) | F | G | H |

**触发关键词**：子表名含 `pingpong` / `光子易` / `虚拟信用卡` → 使用 Pingpong 布局。

### 其他业务规则

- **总计行定位**：搜索 A 列含"总计"的行（日报汇总中只有一行总计），该行 D 列 = 期初余额，G 列 = 期末余额
- **日期来源**：以上传文件名中的日期为准（如 `2026年5月资金流动表5.13.xlsx` → `2026-05-13`），K2 单元格做交叉验证（`date_mismatch` 标记不一致）
- **期初余额**：直接读取"公司货币资金       总计"行 D 列，**不是**各子表求和
- **币种与汇率**：以下区 L 列公式中涉及的汇率为准。子表名含"美元"→ USD 等（`CURRENCY_MAP`），汇率=1.0 → CNY，无关键词时按汇率推断
- **往来识别（两层检测）**：
  - Layer 1 关键词匹配：`category` 或 `summary` 含"往来"或"利润提回" → 标记为内部转账
  - Layer 1.5 疑似检测：分类为"投资收益"/"投资款" 或 摘要含"转入/转出/提回/划转"等动词 → 标记为疑似往来（输出 warning）
  - Layer 2 跨 sheet 金额配对：如果 A sheet 支出 = B sheet 收入（同日同额），自动识别为往来对；若双方均未标记往来则输出 warning
  - 所有 warning 写入 `verification.json` 的 `warnings` 字段，前端可展示提醒
- **日期过滤**：子表含多日交易，只取 `report_date` 当天的（`txn.date != date` 跳过）
- **浮点容差**：`TOLERANCE = 0.5`，避免汇率连乘精度差异
- **公式以实际表格为准**：核对逻辑依赖日报汇总中的公式结构（SUMIF、直接引用、`=D{row}*$L${row}` 等），如报表模板变更需重新确认公式

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
      "sheet_name": "子表名",
      "summary_name": "日报汇总中的账户名",
      "currency": "CAD",
      "exchange_rate": 5.0224,
      "local_income": 34445.93,
      "rmb_income": 173001.24,
      "reported_income": 173001.24,
      "income_ok": true,
      "all_ok": true,
      "real_income": 34445.93,
      "transfer_income": 0.0,
      "transactions": [
        { "summary": "平台收入", "category": "平台收入", "income": 7066.54, "expense": 0, "balance": 14670.95, "is_transfer": false }
      ]
    }
  ]
}
```

## 踩坑记录

### 1. Excel 公式只能用 data_only=False 读取文本
- **症状**：openpyxl `data_only=True` 时，公式单元格返回 `None` 或计算值，无法拿到公式字符串
- **原因**：openpyxl 的设计：`data_only=True` 只返回缓存的计算值，不返回公式文本
- **解决**：必须解密两次，分别用 `data_only=True`（取值）和 `data_only=False`（取公式）打开 workbook
- **验证日期**：2026-05-13

### 2. pingpong虚拟信用卡 是 USD 但名称无币种关键词
- **症状**：pingpong虚拟信用卡的收入/支出金额很小（income=6.86, expense=2858.76），和子表原始值（1.00, 416.96）不匹配
- **原因**：该子表是 USD 账户但名称中不含"美元"，日报汇总下区 L 列的汇率 6.8562 才是真实线索
- **解决**：verify.py 先通过下区汇率判断是否外币（rate != 1.0），再用 `CURRENCY_MAP` 匹配币种名；无法匹配时按汇率阈值推断（rate>5 → USD）
- **验证日期**：2026-05-13

### 3. 日期正则误解析 "5.13" 为 month=5 day=5
- **症状**：文件名 `2026年5月资金流动表5.13.xlsx` 解析为 `2026-05-05` 而非 `2026-05-13`
- **原因**：正则 `(\d+)\.(\d+)` 的 group 索引错误，`m.group(3)` 捕获了月而非日
- **解决**：修正正则为 `r'(\d{4})年(\d+)月.*?表(\d+)\.(\d+)'`，日期取 `m.group(4)`（点后部分）
- **验证日期**：2026-05-13

### 4. 前端首次加载 404 导致白屏崩溃
- **症状**：部署后浏览器打开页面白屏，Console 报 `Uncaught TypeError: a is not iterable`
- **原因**：服务器上尚无 `verification.json`，fetch 返回 404 的 HTML 响应，`.json()` 解析 HTML 后得到非预期对象，React 解构 `{ summary, sheets }` 失败
- **解决**：① 部署时预置空 JSON 文件（`sheets: []`）② 前端 fetch 应检查 `r.ok` 再解析
- **验证日期**：2026-05-22

### 5. 上传 API 写入目录和生产模式读取目录不一致
- **症状**：上传 Excel 后核对成功，但页面刷新仍显示旧数据
- **原因**：server.py 只写了 `public/data/`（开发目录），但生产模式从 `dist/data/` 读取静态文件
- **解决**：server.py 同时写两个目录 `for d in [DATA_DIR, DIST_DATA_DIR]`
- **验证日期**：2026-05-13

### 6. CentOS 7 自带 Python 3.6 无法运行 fastapi
- **症状**：`pip install fastapi>=0.100.0` 报 `No matching distribution found`
- **原因**：fastapi >= 0.100 要求 Python >= 3.8，CentOS 7 默认 Python 3.6.8；阿里云内部 PyPI 镜像包版本滞后
- **解决**：安装 Miniconda → `conda create -n fund python=3.12` → 使用清华 PyPI 镜像 `-i https://pypi.tuna.tsinghua.edu.cn/simple`
- **验证日期**：2026-05-22

### 7. 端口 8000 被旧进程占用
- **症状**：`nohup python server.py --prod` 立即退出，日志显示 `address already in use`
- **原因**：之前测试启动的进程仍在后台运行
- **解决**：`fuser -k 8000/tcp` 杀旧进程，或 `kill -9 $(ss -tlnp | grep 8000 | grep -o 'pid=[0-9]*' | cut -d= -f2)`
- **验证日期**：2026-05-22

## 待人工确认项

> 以下基于 2026-05-13 的单个 Excel 样本，部分边界场景需后续验证。

| # | 待确认项 | 当前假设 | 验证方法 |
|---|---------|---------|---------|
| 1 | 子表布局是否只有标准和 Pingpong 两种 | 当前只识别这两种 | 新增账户类型时检查列布局是否匹配 |
| 2 | 文件名日期格式是否只有 `YYYY年M月资金流动表M.DD.xlsx` | 正则仅匹配此格式 | 如文件名格式变化需调整 `_extract_filename_date()` |

## 文件结构

```
fund-dashboard/
├── CLAUDE.md
├── Dockerfile
├── README.md
├── .gitignore
├── backend/
│   ├── server.py          # FastAPI: 上传接口 + 静态文件托管
│   ├── verify.py          # 核对引擎: 公式解析 + 余额验证
│   ├── parser.py          # Excel 工具: 解密、日期、子表解析
│   ├── config.py          # 配置: 密码(环境变量)、列映射、币种、关键词
│   ├── classifier.py      # 分类: 往来交易识别
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx         # 主布局: 导航 + 上传
│   │   ├── App.css
│   │   ├── index.css       # CSS 变量、全局样式
│   │   ├── main.tsx
│   │   └── pages/
│   │       ├── Summary.tsx  # 核对总表: KPI + 分组卡片
│   │       ├── Summary.css
│   │       ├── Detail.tsx   # 详情: 子表展开 + 分类分组
│   │       └── Detail.css
│   ├── public/
│   │   ├── data/           # verification.json (运行时生成)
│   │   ├── favicon.svg
│   │   └── icons.svg
│   ├── vite.config.ts      # dev 代理 /api → :8000
│   ├── package.json
│   └── index.html
```
