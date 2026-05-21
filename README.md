# 资金核对看板

每日上传加密资金报表 Excel，自动核对各账户收支数据，验证余额平衡。

## 功能

- 上传加密 Excel（.xlsx），自动解密并核对
- 按账户分组显示收款/付款/收支
- 自动汇率换算（外币 → 人民币）
- 余额平衡验证：期初 + 收入 - 支出 = 期末
- 展开查看每笔交易明细

## 技术栈

- **后端**: Python / FastAPI / openpyxl / msoffcrypto
- **前端**: React / TypeScript / Vite

## 本地开发

```bash
# 1. 后端
cd backend
pip install -r requirements.txt
python server.py

# 2. 前端（新终端）
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

## 生产部署

```bash
# 构建前端
cd frontend
npm run build

# 启动（后端同时托管前端静态文件）
cd backend
EXCEL_PASSWORD=your_password python server.py --prod
```

访问 http://localhost:8000

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `EXCEL_PASSWORD` | Excel 文件解密密码 | `delamu` |

## 项目结构

```
fund-dashboard/
├── backend/
│   ├── server.py       # FastAPI 服务
│   ├── verify.py       # 核心核对逻辑
│   ├── parser.py       # Excel 解析
│   ├── config.py       # 配置
│   └── classifier.py   # 往来分类
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   └── pages/
│   │       ├── Summary.tsx   # 核对总表
│   │       └── Detail.tsx    # 详情页
│   └── vite.config.ts
└── README.md
```
