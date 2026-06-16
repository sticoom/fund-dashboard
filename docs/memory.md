# 踩坑记录 (Memory)

> 本文件按时间顺序记录历史踩过的坑、根因、修复方法。**属于"以前出过什么事"的历史性内容**。
>
> 排障时按需查阅对应编号。新坑追加在末尾，**不删除已有记录**——历史踩坑是后续调试的关键参考。

---

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
- **⚠️ 注意**：本条已过时，实际部署用 systemd 管理，见 #10。`fuser -k` 只在临时调试时用
- **验证日期**：2026-05-22

### 8. 复合子账户交易重复（pingpong沃尔玛收款等共享 sheet）
- **症状**：pingpong沃尔玛收款有 6 个子账户共享同一张物理 sheet，但每个子账户都显示全部 10 笔交易（应各显示 2 笔），第 6 个子账户（Ordora）因收入=0 被跳过
- **原因**：日报汇总下区每个子账户有独立的 SUMIF 公式，包含各自的行范围（如 `B3:B19` vs `B24:B34`），但 verify.py 没有提取行范围来过滤交易
- **解决**：① parser.py 增加 `data_row_start`/`data_row_end` 参数 ② verify.py 从 SUMIF 公式中提取行范围（`_get_sumif_row_range`），传入 `parse_sheet` 做行范围过滤 ③ 收入=0 的复合子账户也纳入（有 SUMIF 行范围即视为活跃子账户）
- **验证日期**：2026-05-28

### 9. 非 SUMIF 公式账户的往来检测遗漏
- **症状**：往来差额巨大（5.20 文件差 178 万，5.25 文件差 20.5 万），远超汇损金额
- **原因**：当上区公式是直接单元格引用（`direct_ref`，如子公司公账-工商银行）或下区公式是直接引用（如 `=深圳主体对公美元户!J6`）时，`_eval_sumif` 不被调用，往来金额硬编码为 0，但交易列表中实际有往来交易（category="往来"）
- **解决**：泛化往来检测——如果公式层面的往来金额为 0，检查交易列表是否有标记为往来的交易，如有则从交易列表计算。覆盖所有非 SUMIF 公式场景
- **验证日期**：2026-05-28

### 10. ECS 实际部署是 systemd 管的，不是裸 nohup（杀进程会"打地鼠"）
- **症状**：SSH 上 ECS 后 `kill -9 <pid>` 杀掉 server 进程，几秒后端口又被**新 pid** 占用；反复 kill 反复重生
- **原因**：服务器上配置了 `fund-dashboard.service`（systemd），`Restart=always` 自动拉起。**所有"杀进程"操作无效**
- **正确做法**：
  - 重启：`systemctl restart fund-dashboard`
  - 状态：`systemctl status fund-dashboard`
  - 日志：`journalctl -u fund-dashboard -n 50 --no-pager`（不是 server.log）
- **完整部署流程**：
  ```bash
  cd /opt/fund-dashboard && git pull origin main
  cd frontend && npm run build && cd ..
  systemctl restart fund-dashboard
  ```
- **本地无 SSH 时可用阿里云 CLI 远程执行**（无需密码）：
  ```bash
  aliyun ecs RunCommand \
    --RegionId cn-shenzhen \
    --InstanceId.1 i-wz90ysqk7qpy6r3tdap7 \
    --Type RunShellScript \
    --CommandContent "systemctl restart fund-dashboard"
  # 查结果：
  aliyun ecs DescribeInvocationResults --RegionId cn-shenzhen --InvokeId <返回的InvokeId>
  ```
- **实例 ID 容易记错**：用户口述的 `i-wz90ysqk7qpy6r3tdap7q` 实际是 `i-wz90ysqk7qpy6r3tdap7`（**少一个 q**）。验证方式：`aliyun ecs DescribeInstances --RegionId cn-shenzhen`
- **验证日期**：2026-06-16

### 11. ECS 部署目标必须选对（曾有两个副本，现已清理）
- **历史症状**：ECS 上曾同时存在 `/opt/fund-dashboard` 和 `/root/fund-dashboard` 两份代码，往 `/root` 部署后页面不更新
- **历史原因**：`/root/fund-dashboard` 是历史副本，**没有 `.git`**，`git pull` 拉不动；`/opt/fund-dashboard` 才是正式 clone（有 `.git`）
- **正确部署目标**：`/opt/fund-dashboard`
- **现状（2026-06-16 已清理）**：

  | 路径 | 状态 |
  |------|------|
  | `/opt/fund-dashboard` | ✅ **唯一活的部署**（有 .git + systemd 管） |
  | `/root/fund-dashboard` | ❌ 已删除（曾是无 .git 的历史副本） |
  | `/root/fund-dashboard.zip` | ❌ 已删除（48 MB 早期 SCP 上传压缩包） |
- **判断方法（最权威，避免被路径名迷惑）**：直接读 systemd 配置文件：
  ```bash
  grep -E 'ExecStart|WorkingDirectory' /etc/systemd/system/fund-dashboard.service
  # 应输出：
  # WorkingDirectory=/opt/fund-dashboard/backend
  # ExecStart=/usr/bin/python3.11 /opt/fund-dashboard/backend/server.py --prod
  ```
- **验证日期**：2026-06-16（清理后再次确认只剩 /opt）

### 12. ECS 部署连接信息与 Python 环境固化
- **连接信息**：
  - 实例 ID：`i-wz90ysqk7qpy6r3tdap7`（注意：用户首次口述时多念了一个 q，正确是 7q 结尾；ECS hostname 为 `iZwz90ysqk7qpy6r3tdap7Z`）
  - 公网 IP：`120.25.100.51`
  - SSH：`ssh root@120.25.100.51`
  - 密码：`470320936@Zeng`
  - 项目路径：`/opt/fund-dashboard`
- **Python 环境（⚠️ 2026-06-16 实证修正）**：
  - systemd service 实际用的是 **`/usr/bin/python3.11`**（系统级 py3.11，已 pip install 所有依赖，fastapi 0.136.1）
  - 直接 `python server.py` 会拿到系统 Python 3.6 跑不起来——所以**不要手动启动**，让 `systemctl restart fund-dashboard` 自动用 py3.11 启
  - 验证：`grep ExecStart /etc/systemd/system/fund-dashboard.service`
  - 历史遗留的 `/opt/miniconda3`（1.3 GB，py3.12）已于 2026-06-16 删除——确认无 systemd/cron 引用后才动手
- **部署 SOP（✅ 已修正为 systemctl，与 #10 一致）**：
  ```bash
  # 本地 push
  cd C:/Users/13676/Desktop/fund-dashboard
  git add -A && git commit -m "<feat/fix>: xxx" && git push origin main

  # ECS 拉取 + 重建 + 重启
  ssh root@120.25.100.51
  cd /opt/fund-dashboard
  git pull origin main
  cd frontend && npm run build && cd ..
  systemctl restart fund-dashboard        # ← 不是 pkill + nohup（详见 #10）

  # 部署后必检
  curl http://120.25.100.51:8000/                       # 应返回 200
  systemctl status fund-dashboard                       # 应显示 active (running)
  journalctl -u fund-dashboard -n 50 --no-pager         # 查最近日志，无 Traceback
  ```
- **GitHub 仓库**：`https://github.com/sticoom/fund-dashboard`（本地与云端已打通，push 即可触发后续 ECS 拉取）
- **安全建议**：密码硬编码长期不安全，建议后续用 `ssh-copy-id root@120.25.100.51` 配置免密或把密码移到 `~/.env.fund-dashboard`
- **验证日期**：2026-06-16

### 13. 阿里云 CLI 远程部署：DNS 偶发抖动 + 一键模板
- **症状**：执行 `aliyun ecs RunCommand` 偶发报 `dial tcp: lookup ecs.cn-shenzhen.aliyuncs.com: no such host`
- **原因**：本地 DNS 偶发解析失败，不是阿里云 API 的问题
- **解决**：等几秒重试一次；或先 `nslookup ecs.cn-shenzhen.aliyuncs.com` 确认能解析再发
- **适用场景**：本地终端无法输入 SSH 密码（非交互模式）时，用 aliyun CLI 通过云助手远程执行——**无需密码、无需 SSH 客户端**
- **一键部署模板**（本地终端执行）：
  ```bash
  aliyun ecs RunCommand \
    --RegionId cn-shenzhen \
    --InstanceId.1 i-wz90ysqk7qpy6r3tdap7 \
    --Type RunShellScript \
    --CommandContent "cd /opt/fund-dashboard && git pull origin main && cd frontend && npm run build && cd .. && systemctl restart fund-dashboard && echo DEPLOY_OK"

  # 验证（用 InvokeId 查结果，Output 是 base64 编码）：
  aliyun ecs DescribeInvocationResults --RegionId cn-shenzhen --InvokeId <InvokeId>
  ```
- **CLI 参数易错点**（曾踩过）：
  - `--Region` ❌ → `--RegionId` ✅
  - `--InstanceIds` ❌ → `--InstanceId.1`（RepeatList 形式）✅
  - 验证实例 ID：`aliyun ecs DescribeInstances --RegionId cn-shenzhen`
- **部署成功标志**：
  - `ExitCode=0`
  - `InvocationStatus=Success`
  - Output 末尾含 `DEPLOY_OK`
- **额外验证**：`curl http://120.25.100.51:8000/` 返回 200 + bundle hash 与本地 `npm run build` 输出一致（如 `index-BYvqHHyR.js`）
- **验证日期**：2026-06-16

### 14. aliyun CLI 远程命令：bash `&&` 链短路导致后半段不执行
- **症状**：发了一条 `ls file && rm -rf dir && echo done` 命令，`ls` 失败后 `rm` 没跑，但末尾的 `echo '(confirmed)'` 触发了 `||` 分支，让人误以为 `rm` 成功了
- **原因**：bash 中 `A && B && C || D && E` 的优先级——`||` 比 `&&` 低，整个左半边 `&&` 链作为一个整体失败后跳到 `||` 后；中间的所有命令都被跳过
- **解决**：
  - **检查类命令**和**破坏性类命令**不要混在一条 `&&` 链里，分开多次 RunCommand 调用
  - 必须串行时用 `;` 分隔（每条都跑，不管前一条结果）
  - 验证删除是否生效：用 `du -sh /path` 或 `ls /path` 独立命令，**不要**靠链尾的 echo 推断
- **实证案例**：本次清理 `/opt/miniconda3` 时第一次 `ls verify.py.bak && ... && rm -rf /opt/miniconda3 && ...` 短路了，miniconda 实际没被删，但 `(confirmed: no miniconda in /opt)` 误导了判断；改用 `;` 分隔后才真删成功
- **验证日期**：2026-06-16

---

## 如何追加新坑

发现新问题时，按以下格式追加到本文件末尾：

```markdown
### N+1. 简短标题
- **症状**：用户看到的现象
- **原因**：根本原因（不是表象）
- **解决**：具体修复方法（命令、代码、配置）
- **验证日期**：YYYY-MM-DD
```

**追加原则**：
- 不删除已有记录
- 编号连续递增
- 如果新发现修正了旧 pit，在旧 pit 末尾加「⚠️ 已被 #N 修正」标注，但保留原文
