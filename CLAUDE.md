---
version: "3.0"
last_verified: "2026-06-16"
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

## 文档导航

本 CLAUDE.md 只放**强制门控规则**。具体内容按需查阅：

| 想知道什么 | 读哪个文件 |
|----------|-----------|
| 系统怎么工作（业务逻辑、双区结构、公式链路） | [docs/architecture.md](docs/architecture.md) |
| 代码/命名/提交/部署规范 | [docs/rules.md](docs/rules.md) |
| 以前踩过什么坑、根因、修复方法 | [docs/memory.md](docs/memory.md) |

## 强制门控规则（MUST / MUST NOT / MUST DO）

> 以下规则不可绕过。CC 看到本 CLAUDE.md 后必须遵守。

### MUST READ — 进入项目第一件事

- 修改业务逻辑前必读 `docs/architecture.md`
- 改代码或提交前必读 `docs/rules.md`
- 排障时必读 `docs/memory.md` 对应编号的 pit
- 不读对应文档直接动手 = 出错概率 > 80%

### MUST NOT — 禁止行为

- ❌ **禁止往 `/root/fund-dashboard` 部署**，正确目标是 `/opt/fund-dashboard`（见 memory.md #11）
- ❌ **禁止用 `pkill + nohup` 重启服务**，必须用 `systemctl restart fund-dashboard`（见 memory.md #10）
- ❌ **禁止手动 `python server.py`**（系统默认 py3.6 跑不起来）；用 `systemctl restart fund-dashboard`，systemd 自动用 `/usr/bin/python3.11`（见 memory.md #12）
- ❌ **禁止在用户没说"满意了 / 上线"前自动部署**
- ❌ **禁止凭记忆执行凭据/路径**，必须读 `docs/memory.md #12` 拿真实信息

### MUST DO — 强制行为

- ✅ 改完前端必须用 ASCII/Markdown 文本展示给用户看（不能只描述）
- ✅ 部署后必检：`curl http://120.25.100.51:8000/` 返回 200 + `systemctl status fund-dashboard` active
- ✅ 发现新坑必须追加到 `docs/memory.md` 末尾，**不删除已有记录**
- ✅ 走部署前必须先得到用户明确的"满意了 / 上线"指令

## 触发场景

当用户需要：
- 对每日资金报表做自动化收支核对
- 验证"期初 + 收入 - 支出 = 期末"余额平衡
- 区分"实际收支"和"往来（内部转账）"
- 按账户类型分组展示（收款/付款/收支）

## 快速启动（详细命令见对应文档）

```bash
# 开发（详见 docs/architecture.md）
cd backend && pip install -r requirements.txt && python server.py        # :8000
cd frontend && npm install && npm run dev                                 # :5173 (代理 /api → :8000)

# 生产部署（详见 docs/memory.md #12 + docs/rules.md 部署门控）
cd frontend && npm run build
cd /opt/fund-dashboard && git pull && systemctl restart fund-dashboard

# Docker
docker build -t fund-dashboard .
docker run -e EXCEL_PASSWORD=xxx -p 8000:8000 fund-dashboard
```
