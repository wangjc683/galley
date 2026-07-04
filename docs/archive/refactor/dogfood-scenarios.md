# Dogfood scenarios · B1+B2 累积 regression suite

> **用途**：(1) B2 ship 后 JC 走一遍验证未发现 regression — 是 [B3 M2 启动门](./B3-store-slice.md#prerequisites--必须先完成) 的必跑清单；(2) B3 M2-M6 每个 milestone 完都用这个清单跑 regression。
>
> **用法**：每项一行 ✓/✗，跑过填日期 + 一句话 note。**先跑 A + B（必 cover），C/D 优先级递减**。发现 regression → 加 inline note + 必要时开 GitHub issue。
>
> **来源**：[project status](../../project-status.md) compact phase state + [B2 完成 devlog](../../devlog/2026-05-19-b2-bridge-ownership-complete.md) Open Questions + B2 dogfood fixes `b087f22` 抓的 3 个 bug + v0.1 七件事 polish 沉淀的高频 user path。

---

## A. v0.1 七件事（必 cover · 8 项）

- [ ] **A1 端到端真跑** — 新建 session、attach GA、选 LLM、发 "写一个 fib(10) 的 python 函数"，verify chunked streaming + UI typewriter 平滑可见、turn_end commit、文本可选可复制
- [ ] **A2 审批拦截 + 审计持久化** — 关 YOLO，发一条触发 file_patch 的需求，verify Approval Card 弹 → 选 Approve → tool 执行 → DB `tool_events` 表有新 row（`sqlite3 ~/Library/Application\ Support/app.galley/galley.db 'select * from tool_events order by id desc limit 3'`）
- [ ] **A3 审批 Reject 路径** — 同 A2 但选 Reject，verify tool 跳过 + agent 继续不卡死
- [ ] **A4 Multi-session N-active** — 同时开 3 个 session，每个发不同任务，verify 三 session 并行流式输出不互相阻塞 / TopBar pill 切换正确
- [ ] **A5 Multi-session per-session LLM** — 3 session 各选不同 LLM，verify TopBar pill / Composer footer / 实际 LLM 调用一致（look at GA stderr `_record_usage` 行）
- [ ] **A6 Session Restore** — 跑完一个 session 关 Galley 重开，verify 列表里在、点进去 history 渲染、send 新消息能继续 turn 编号
- [ ] **A7 LRU 5 alive + active 保护** — 开 6 个 session 都进过、第 6 个 active，verify 最早 idle 的被 suspend（status pill 变 `sleeping` 或 stderr 静默 SIGTERM）+ 第 6 个仍 active
- [ ] **A8 Onboarding fresh** — `rm ~/Library/Application\ Support/app.galley/galley.db` 后启动，verify Onboarding 5 步全跑通（Welcome → Attach → Python 内置 → Health Check 5 项 → Done → MainView）

---

## B. B2 新加 capability（必 cover · 9 项）

- [ ] **B1 CLI session send happy path** — 启动 Galley GUI，另一终端 `galley session list` 拿 id，`galley session send <id> "hello" --supervisor=jc --reason=test`，verify GUI 内 session 收到 user message + agent 响应；DB `messages` 表 `created_via='cli'`, `supervisor='jc'`, `origin_note='test'`
- [ ] **B2 CLI session send dispatch=persisted_only** — `pkill -9 workbench_bridge` 干掉该 session 的 bridge 进程，立即跑同样命令，verify response JSON `dispatch: "persisted_only"`、GUI 仍显示 message 但 agent 不响应
- [ ] **B3 CLI session watch** — 终端 `galley session watch <id>`，GUI 内发一条消息，verify watch stream 收到 NDJSON 事件 (turn_start / turn_progress / turn_end)；Ctrl-C 干净退出（socket 文件 unlink 干净）
- [ ] **B4 内置 Python spawn (PROD)** — 装 `.dmg` 后启动、prefs `useExternalPython=false`、`pgrep -fl workbench_bridge` 应该看到 spawn 走 `/Applications/Galley.app/Contents/Resources/python/bin/python3`
- [ ] **B5 外部 Python escape hatch** — Settings → Runtime → "使用外部 Python..." 切到 external、spawn 一个 session，verify bridge 走 user-picker python 路径
- [ ] **B6 Socket race detection** — 第一个 Galley 跑着、双击 .app 启动第二个，verify 第二个启动失败 / 跳过 socket bind / 不影响第一个 socket / 不互相干扰 stdin
- [ ] **B7 Socket stale unlink** — `pkill -9 desktop`（强杀 Galley 主进程），再启动 Galley，verify stale `$TMPDIR/galley-$UID.sock` 自动清理 + 新 socket bind 成功
- [ ] **B8 Bridge crash + abnormal exit toast** — `pkill -9 workbench_bridge`（kill 某 session 的 bridge），verify GUI toast 出 + 显示最后 stderr lines（M2 pull-mode `runner_stderr_tail` 关键 regression 检查）
- [ ] **B9 LRU eviction silent UX** — 同 A7 但留意：第 6 session active 时 LRU evict 第 1 session — user 不应感到突兀（GUI 内 session 仍在 sidebar、点进去能 respawn）

---

## C. Polished UX（强 cover · 12 项）

- [ ] **C1 Streaming partial rendering** — 长答案 (300+ tokens worth of content)，verify GA chunked partials 经 UI typewriter 后观感连续、不卡、fence filter 正常（工具 stdout 不溢出对话区）
- [ ] **C2 Thinking placeholder** — verify「第 N 步 · 思考中···」单行 italic serif 12px 出 + ≥5s 自动显 elapsed counter
- [ ] **C3 /btw side question** — 主 agent 跑长任务中（关 YOLO 让它停在 approval），发 `/btw 时间是几点`，verify SystemMessageBubble 黄色出 + 不计入主 turn 编号
- [ ] **C4 ask_user 阻塞** — agent 调 ask_user（提一个需要澄清的需求），verify AskUserBubble + Sidebar 第四态 "⏸ 等你回复" + 输入回复后继续
- [ ] **C5 长对话导航 (dot rail + ⌥↑↓)** — 长 session（10+ user msg），⌥↑/⌥↓ 跨 user-msg 跳；右侧 dot rail 显示 + hover 序号显 preview
- [ ] **C6 长 user msg 折叠 + resend** — 粘 800+ 字消息发出去，verify 自动折 + "展开（共 N 行）" 按钮 + hover ↻ resend prefill Composer
- [ ] **C7 Project 分组 + filter** — 创建 project "demo"、分配两 session 进去、filter 切换 verify sidebar 只显该 project 的 session、filter 状态 New Chat 加入该 project
- [ ] **C8 Archive + Unarchive bulk** — 右键 archive 一个 session、EarlierDialog 月分组检查、bulk select 3 个 unarchive
- [ ] **C9 Manual rename** — 右键 session ✏️ inline edit + Enter commit + Esc revert
- [ ] **C10 YOLO mode toggle** — TopBar pill 切 YOLO 开/关，verify open 时 ApprovalForm 不出 + 关时出（不影响正在跑的 turn）
- [ ] **C11 Settings → Health Check revisit** — Settings → Runtime → Re-run Health Check，verify 进 Onboarding StepHealth revisit 模式跳过 Welcome/Attach、Back 返回 Settings
- [ ] **C12 Settings GA Path 手动输入** — Settings → Runtime → GA Path 框直接键入路径，verify 300ms debounce validate + Enter commit + Esc revert（alpha.2 加的，[devlog](../../devlog/2026-05-15-v0.1-alpha.2-windows-attach-fixes.md)）

---

## D. Edge cases / B2 regression hotspot（兜底 · 6 项）

- [ ] **D1 Socket 90s idle timeout** — `galley session watch <id>` 不发任何消息挂 90s+，verify socket 自动 close + 不影响 GUI 主连接 / 不影响其它 CLI 客户端
- [ ] **D2 Origin tracking GUI 写入** — GUI 发一条消息，verify DB `messages.created_via='gui'`, `supervisor IS NULL`, `origin_note IS NULL`
- [ ] **D3 availableLLMs 序列化回归** (`b087f22` 抓过) — 启动后 New Chat 看 LLM picker，verify 列出 mykey.py 全部 LLM（不是 `[]`）— acronym serde bug 不复发
- [ ] **D4 Python capability alias 翻译** (`b087f22` 抓过) — Settings → Runtime → Python 选 brew arm64 alias、spawn 一个 session，verify bridge 起来不报 `no such file: 'python-brew-arm'`
- [ ] **D5 spawn 错误信息带 path** (`b087f22` 抓过) — 故意把 gaConfig.python 改成 `/nonexistent`、verify stderr toast 显示 `no such file: '/nonexistent' (set Settings → Python or check PATH)`（不是空 errKind）
- [ ] **D6 GUI quit cleanup** — Galley 跑着 3 个 session、退出 app（Cmd+Q），verify `pgrep -fl workbench_bridge` 没残留 + socket 文件 unlink + DB 没 dangling lock

---

## E. 未实施 / 推迟（不需要跑，参考用）

- E1 `session.watch --from=<idx>` backlog — 推 B4 supervisor SOP 落地时再考虑
- E2 conda/pyenv/asdf/uv Python 探测 — 推后续 Rust-side spawn 命令解决
- E3 Socket 0600 TOCTOU hardening (`umask(0o077)` before bind) — 推 B4 hardening 列表
- E4 CLI happy-path integration test — 推 B4 polish
- E5 Multi-Galley-process on same machine — 推 race detection 的 B6 验证暂代

---

## Update log

- 2026-05-19 — created (B3 M1 启动门 prereq 落地 · 详 [devlog](../../devlog/2026-05-19-b3-prereq-relaxation.md))
