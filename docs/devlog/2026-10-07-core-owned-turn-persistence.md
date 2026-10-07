# 运行步骤改由 Core 落库：页面重载不再整轮丢失

Date: 2026-10-07
Status: 已实施，静态门禁与测试全绿，`tauri dev` 真机复现三项通过；unreleased
Related: [票面](../../.scratch/core-owned-turn-persistence/PRD.md)、
[架构：Runner events and turn persistence](../architecture.md)、
[IPC 协议 §4.7 `turn_end`](../ipc-protocol.md)、
[07-11 AgentTurn 单一归宿](./2026-07-11-agent-turn-single-home.md)、
[并发审计 CONC-8](../audits/concurrency-audit-2026-07-04/README.md)

## 起因

v0.6.1 发版前用 CLI 在 `tauri dev` 里跑提示词回归，dev 窗口两次整页重载，重载前后跑着的会话丢步骤：
一个 4 步任务引擎日志里有 5 次响应，库里只有第 1 步；重载后 4 秒由 CLI 新建的会话跑了 20 次响应，
库里只有用户那一行；同批 9 个没撞上重载的会话全部完整。`session wait --until-idle` 照常返回
`completed`，把最后一条已落库的步骤当结果交给 supervisor。自 v0.2 起就有，不是 v0.6.1 的回归。
JC 裁决「现在就修」。

## 机制

- assistant 行只有一个写入点，触发方却是页面：GUI 收到 `runner-event` 的 `turn_end` 才调
  `persist_assistant_message`；`turn_count` / `summary` 也是 GUI 调 `bump_session_after_turn`。
  写入代码在 Rust，写不写由前端决定，违背宪法第 5 条的本意。
- Core 把 runner 事件广播成 Tauri 事件后发完即弃；`notify.rs` 的注释假设「GUI 漏事件可从 DB 补」，
  而 assistant 行恰恰只有 GUI 能写。
- 页面重载清掉全部监听，hydrate 不重挂；CLI 新建会话靠一次性的 `runner-spawned-external` 挂接，
  重载那几秒新建的会话会错过它。
- 附带：重载后点开还在跑的会话会走 spawn，`RunnerManager::spawn` 先关旧进程，等于杀掉这一轮。
- 发布版暴露面（推断）：macOS WebContent 崩溃自动重载、Windows WebView2 的 F5 / Ctrl+R、
  启动时补跑的定时任务早于页面挂好监听（可能就是「定时任务补跑两次没产生会话」的根因，待验证）。

## 方案

1. **Core 自己落库**。`RunnerManager::spawn` 原先挂的队列 forwarder 改成 runner watcher：一个按事件
   顺序处理的消费者，先写 `turn_end`（assistant 行 + 可见步骤的会话 bump），再做队列记账
   （ask_user 挂起、RunComplete 结算、发信号给 drain）。所以一轮的行在它的 `run_complete` 关闭运行
   之前已经在库里，`session wait --until-idle` 不会再把中间步骤当结果。broadcast 由单独的 pump 抽进
   无界队列，慢写不会让订阅者滞后跳事件。`app_setup` 在 socket 监听启动前调 `set_turn_store`，
   所有 spawn 路径（GUI、CLI、Goal、定时任务）都覆盖。
2. **行内容与 GUI 逐字段一致**。`thinking` / `finalAnswer` / `preamble` / `summary` / `toolCalls` /
   `toolResults` / `telemetry` / `visibility` 的推导移植到 Rust（`core/src/turn_persistence/derive.rs`，
   非测试部分 436 行，去掉注释与空行约 310 行），按 ECMAScript 语义逐条复刻：`\s` 与 `trim` 用 JS 空白集（含 U+FEFF、不含
   U+0085），`m` 标志下 `^` / `$` 认四种行终止符（`\n`、`\r`、U+2028、U+2029，`regex` crate 只认
   `\n`，这四个行锚定模式手写匹配），`JSON.stringify` 的整数键排序与数字格式（`30.0` 写成 `30`、
   `1e21` 写成 `1e+21`）。行 id、绝对轮次（缺 `absoluteTurnIndex` 时按 runner 的公式取最近 user 行）、
   upsert 语义沿用原写入函数（改名 `persist_assistant_message`）。
3. **共享黄金样例**。`core/tests/fixtures/turn-persistence-cases.json`（手写 29 例，含 CRLF、U+2028、
   浮点、整数键、未闭合标签、ask_user、步数上限、internal）与 `turn-persistence-rows.json`（由 GUI
   现行推导生成，`GALLEY_UPDATE_TURN_GOLDEN=1 pnpm --dir gui test turn-persistence`）；vitest 与
   cargo test 断言同一份。键序按 Core 的序列化顺序归一（生产构建的 serde_json 没有
   `preserve_order`，按键字节排序；工作区构建会被 galley-cli 打开，两边测试都做了归一）。
4. **GUI 不再写库**。`persistTurnEndToMessages` 与它的重试删除；`bumpSessionAfterTurn` 只做内存镜像，
   未读改调新的 `mark_session_unread`（只有页面知道哪个会话在屏幕上）。Tauri 命令
   `persist_assistant_message` 与 `bump_session_after_turn` 注销，不留第二个写入方——两者并存时
   `turn_count` 会被加两次。
5. **重载后重新挂接**。新 Tauri 命令 `list_live_runners`；hydrate 末尾对侧栏里的会话逐个挂接，
   还在跑的先从库恢复历史再挂监听并标为运行中；`activateSession` 先问 Core，有存活 runner 就挂接、
   不 spawn。并发挂接按会话去重，避免一条事件渲染两次。已崩溃的 runner 在被关掉或重启前仍留在
   manager 里（pid 也还在），`RunnerProcess` 新增退出标记，列表把它排除，重新点开仍会重启。

## 否决的替代

- **Core 只写原始列、读时在 TS 补推导**：CLI 直接读库，`galley session show` 的 `finalAnswer` 会变样。
- **独立的持久化订阅者**（票面原推荐，与队列 forwarder 并列）：两个订阅者之间没有先后，行可能晚于
  `run_complete` 落库，CLI 的 1 秒宽限仍是唯一兜底；合成一个有序消费者后，这个先后由构造保证。
- **过渡期双写**：行 upsert 幂等，但 `turn_count = turn_count + 1` 不幂等，双写会加倍计数。
- **只做重挂（票面「临时止血」）**：重载那几秒的事件仍会丢，也不满足第 5 条。
- **关掉 WebView2 浏览器快捷键**：只堵 Windows F5 一个入口。

## 验证

- `cargo test --workspace`：lib 347、db_writes 91（新增 `mark_session_unread` 两例）、runner_manager 21
  （新增 7 例：无 GUI 跑三步一轮并在 RunComplete 信号后立即断言行与 `turn_count`；ask_user、步数上限、
  DONE_WITHOUT_EXIT 同一会话连跑；internal 只写行不 bump；缺绝对轮次的回退；4 个 runner 并发；
  `live_runners` 列出存活的、排除已崩溃的）、其余全绿。单包构建（无 `preserve_order`）同样通过。
- vitest 72 个文件 663 例全绿，含黄金样例 30 例与重挂 4 例；typecheck、lint、IPC 漂移门禁、
  `git diff --check` 通过。

## 真机复现（2026-10-07，tauri dev）

用临时 harness 驱动页面：重载用 `location.reload()`（与 F5 同一路径），点开会话直接调
`activateSession`；核对 `messages` 行数与引擎日志 `=== Response` 次数。

| 场景 | 结果 |
|---|---|
| A 运行中途重载 | 5 次响应 = 5 行，有最终回答，`turn_count` 5 |
| B 重载后 1 秒 CLI 新建会话 | 首次复现**会话整行消失**（见下节）；修后 4 次响应 = 4 行 |
| C 运行中途重载后点开该会话 | 重载后桥自动 `connected`；点开前后 Core 子进程 pid 完全一致，没有重启；6 次响应 = 6 行 |

## 复现中发现的第二条路径：hydrate 清扫删掉首轮中的会话

B 第一次跑时 CLI 拿到了会话 id，几秒后 `galley session brief` 报 `not_found`，引擎日志也没有这条任务。
原因是 GUI hydrate 调的 `delete_empty_new_sessions`：条件只有「标题是默认的『新对话』、`turn_count = 0`、
未归档」。`session.new`（CLI、IM 委派、定时任务）建的会话恰好同时满足——默认标题和第一条用户消息
一起提交，`turn_count` 要到首轮结束才加一——所以页面在这段时间里 hydrate（启动、重载）就把会话连同
用户消息（外键级联）一起删掉。这条从 2026-05-21 起就有，与 Core 落库无关，Core 落库修好后照样复现。

修法：清扫只删一条消息都没有的会话（`AND NOT EXISTS (SELECT 1 FROM messages …)`），GUI 点了
「新对话」却从没发过消息的空行照删。回归测试 `delete_empty_new_sessions_spares_sessions_with_messages`。

这比第一条更像「定时任务当天补跑两次都没产生会话」的根因：调度器在 setup 阶段启动、首个 tick 立即补跑，
建出的「新对话」会话正处在首轮，紧接着页面 hydrate 就把它删了，`last_run_session_id` 指向一个不存在的
会话。本机库里现在没有定时任务，无法用数据确认，记为推断。

## 遗留

- 重载后挂接到的是已在跑的 runner，不会重放 `ready`：该会话的模型列表与图片能力沿用种子值，
  与 CLI 新建会话的挂接相同。
- `list_live_runners` 逐个锁 runner 读 pid，某个 runner 卡在 stdin 写入时最长等 15 秒（与
  `sessions.run_state` 相同）。
- 定时任务补跑丢会话：两条路径都可能造成，第二条更吻合（见上节），未用真实定时任务确认。
