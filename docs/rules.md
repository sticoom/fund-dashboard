# 开发规范

> 本文件存放代码、命名、提交、部署等**规范性约定**。属于"代码怎么写、事情怎么做"的规范性内容。
>
> 修改代码、提 PR、走部署前必读。

---

## 部署门控（强约束，不可绕过）

1. **仅在用户明确说"满意了 / 上线 / 部署吧"** 时才能走部署流程
2. 部署前必须用 ASCII 文本向用户展示前端效果
3. 部署必须按 fund-dashboard-maint SKILL.md「分支 D」的两段式顺序执行
4. ECS 部署目标路径：`/opt/fund-dashboard`（**不是** `/root/fund-dashboard`）
   - 权威判据：`grep ExecStart /etc/systemd/system/fund-dashboard.service` 输出应含 `/opt/fund-dashboard`
   - 详见 [memory.md](memory.md) #11
5. ECS 重启服务：`systemctl restart fund-dashboard`（不是 `pkill + nohup`，详见 [memory.md](memory.md) #10）
6. ECS Python 由 systemd 自动选 `/usr/bin/python3.11`，**禁止手动 `python server.py`**（详见 [memory.md](memory.md) #12）
7. 部署后必检：
   - `curl http://120.25.100.51:8000/` 返回 200
   - `systemctl status fund-dashboard` 显示 active
   - 服务端 bundle hash（`curl -s http://120.25.100.51:8000/ | grep -oE 'index-[A-Za-z0-9]+\.js'`）与本地 `npm run build` 输出**一致**
8. 远程部署优先用 aliyun CLI（无需 SSH/密码），DNS 抖动重试即可——详见 [memory.md](memory.md) #13

---

## 代码规范

### Excel 处理

- openpyxl 读取公式文本必须用 `data_only=False`
- 取公式计算值时另开一次 `data_only=True` workbook
- 解密后必须双开 workbook（一次取值、一次取公式）

### 配置管理

- 新增子表布局时，**先**在 `config.py` 加 `*_KEYWORDS` 检测，**再**加列映射
- 币种识别失败时按汇率阈值推断（rate>5 → USD），不要硬编码账户名
- 密码、API key 必须走环境变量（如 `EXCEL_PASSWORD`），不能硬编码

### 代码风格

- Python：函数命名 `snake_case`，私有函数 `_leading_underscore`
- TypeScript/React：组件 `PascalCase`，hooks `useXxx`
- 复杂业务逻辑必须配 docstring 注释「为什么这么写」

---

## 命名规范

- 历史纪要文件命名：`管理周会纪要MMDD.md`（如 `管理周会纪要0615.md`）
- Excel 文件日期格式：`YYYY年M月资金流动表M.DD.xlsx`
- 部署 commit：`<feat/fix/docs/refactor>: <简短说明>`

---

## 提交规范

- commit message 格式：`<feat/fix/docs/refactor>: <简短说明>`
- 部署后向用户展示 commit hash 和 GitHub 仓库链接（`https://github.com/sticoom/fund-dashboard`）
- 不要把密码、密钥、个人信息 commit 到 git

---

## 前端展示规范

- 改完前端**必须用 ASCII/Markdown 文本**展示页面布局（表格、卡片结构）
- 不能只描述「我改完了，刷新看看」
- 改完即展示，方便用户对比验收

---

## 待人工确认项

> 以下基于 2026-05-13 的单个 Excel 样本，部分边界场景需后续验证。

| # | 待确认项 | 当前假设 | 验证方法 |
|---|---------|---------|---------|
| 1 | 子表布局是否只有标准和 Pingpong 两种 | 当前只识别这两种 | 新增账户类型时检查列布局是否匹配 |
| 2 | 文件名日期格式是否只有 `YYYY年M月资金流动表M.DD.xlsx` | 正则仅匹配此格式 | 如文件名格式变化需调整 `_extract_filename_date()` |
