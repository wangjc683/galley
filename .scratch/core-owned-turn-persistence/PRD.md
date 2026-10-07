# 运行步骤落库改由 Core 负责（页面重载后整轮静默丢失）

Status: done（2026-10-07 JC 裁「现在就修」，子代理实施；主会话真机复现 A / B / C 通过，复现中另修 hydrate 清扫删首轮会话；定时任务补跑未用真实任务确认）

来源：2026-10-07 v0.6.1 pre-flight，用 CLI 在 `tauri dev` 里跑提示词回归清单时，dev 窗口两次整页重载（Vite），
重载前后跑着的会话丢步骤。只读诊断由子代理完成，下面的结论都带代码位置。

## 现象（已复现）

- `s-muxfjxb6-k612sfc4`：4 步任务，第 1 步落库后 09:29:59 `touch gui/index.html`。引擎日志
  `model_responses_995185.txt` 有 5 次响应（4 步 + 最终回答），`messages` 只有第 1 步。
- `s-muxf5bww-p4x5yflw`：09:19:39 重载，09:19:42 的最终回答没落库。
- `s-muxfhpa5-628lwyci`：重载后 4 秒由 CLI 新建，引擎跑了 20 次响应（含长期记忆结算），库里只有用户那一行。
- 同批 9 个没撞上重载的会话全部完整。
- `session wait --until-idle` 照常在 RunComplete 后返回 `completed`，把最后一条已落库的步骤当结果，
  等于给 supervisor 一个静默的错答案。

## 机制

- assistant 行只有一个写入点：`persist_gui_assistant_message`（`core/src/db/session.rs:172`），只经 Tauri 命令
  `persist_assistant_message`（`core/src/commands/session.rs:391`）调用。触发方是前端：收到 `turn_end` 后
  `persistTurnEndToMessages`（`gui/src/lib/ipc-handlers.ts:375`，调用在 `:753`）；`turn_count` / `summary` 也是 GUI 调
  `bump_session_after_turn`（`gui/src/stores/sessions/lifecycle-slice.ts:692`）。
- Core 只把 runner 事件广播成 `runner-event`（`core/src/runner_commands.rs:535-548`），发完即弃（`notify.rs:41-43`）；
  `notify.rs:17-19` 的注释假设「GUI 漏事件可从 DB 补」，但 assistant 行恰恰只有 GUI 能写。
- 前端按会话挂 `listen("runner-event")`（`gui/src/lib/bridge.ts:219`、`:325`）。页面重载清掉全部监听，hydrate 不重挂，
  Core 也没有「列出存活 runner」的命令。CLI 建的会话靠一次性事件 `runner-spawned-external` 让 GUI 挂接
  （`useExternalCoreEvents.ts:84-91`），重载后几秒内新建的会话会错过它。
- 附带：重载后点开还在跑的会话会走 spawn，`manager.spawn` 先关掉旧进程（`manager.rs:155-172`），等于杀掉这轮。
- 违背宪法第 5 条的本意（SQLite 写入归 Core）：写入代码在 Rust，但写不写由前端决定。

## 发布版暴露面（推断，未在发布版复现）

- macOS：WebContent 进程崩溃时 tauri-runtime-wry 默认自动重载页面（`tauri-runtime-wry-2.11.1/src/lib.rs:5123-5134`）。
- Windows：wry 在 WebView2 上默认开着浏览器快捷键（`wry/src/lib.rs:1687`），F5 / Ctrl+R 大概率能重载。
- 启动补跑的定时任务：调度器在 setup 阶段启动（`app_setup.rs:35`），首个 tick 立即执行（`scheduler.rs:77-80`），
  可能早于页面挂好监听。**这可能就是 project-status 里「定时任务当天补跑两次都没产生会话、根因未知」的根因**，待验证。
- 不受影响：关窗只是隐藏（`tray.rs:353`），页面仍在，照常落库。

## 修法方向（诊断建议，未裁决）

- **推荐**：在 `RunnerManager::spawn` 里紧挨 `attach_queue_forwarder`（`manager.rs:188`）挂一个持久化订阅者，
  TurnEnd 时按事件自带的 `absolute_turn_index` / visibility 写 assistant 行并更新 `turn_count` / `summary` /
  `last_activity`；先例是 `auto_title.rs`。GUI 去掉写库的那一半，只留渲染与未读。行 id 确定、upsert 幂等，过渡期双写安全。
  主要风险：thinking / preamble / finalAnswer 现在在 TS 里推导（`ga-output-cleaning.ts` + `agent-turn.ts`），
  要么移植到 Rust 并用共享黄金样例让 vitest 与 cargo test 同跑，要么 Core 只写原始列、读时在 TS 补推导。
- **临时止血**（不满足第 5 条）：Core 加 `list_live_runners`，GUI 挂好监听后对存活 runner 重挂；`activateSession`
  遇到 Core 侧存活 runner 改挂接不 spawn。重载那几秒的事件仍会丢。
- **单点缓解**：Windows 关掉 WebView2 浏览器快捷键，只堵 F5 / Ctrl+R 一个入口。

## 验证

- `core/tests/runner_manager_test.rs` 用现有 `turn_end` 夹具，无 GUI 跑一轮，断言 assistant 行与 `turn_count` 写入。
- `tauri dev` 实测：运行中途 `touch gui/index.html`；重载后 2 秒内 CLI 新建会话；核对 `messages` 行数 = `model_responses`
  响应次数。定时任务：把一个任务的时间设在启动前，重启后看补跑是否产生完整会话。

## Comments

### 2026-10-07 实施要点（子代理）

- **谁写什么、何时写**：`RunnerManager::spawn` 原先挂的队列 forwarder 改为 runner watcher（`core/src/runner_manager/manager.rs`），
  一个按事件顺序处理的消费者：先 `turn_persistence::persist_turn_end`（assistant 行 upsert；可见步骤再
  `bump_session_after_turn(summary, mark_unread=false)`），再做原有的队列记账。行因此先于该 runner 的
  `run_complete` 关闭运行落库；broadcast 由单独的 pump 抽进无界队列，慢写不会滞后跳事件。
  `app_setup::wire_turn_persistence` 在 socket 监听启动前调 `set_turn_store`。
- **逐字段一致**：`core/src/turn_persistence/derive.rs` 移植 `cleanFinalAnswer` / `extractPreamble` /
  `extractThinking` / `JSON.stringify`，按 ECMAScript 语义（JS 空白集、`m` 标志的四种行终止符、整数键排序、
  JS 数字格式）。非测试部分 436 行（去注释空行约 310 行），未触发 400 行检查点。黄金样例在
  `core/tests/fixtures/turn-persistence-{cases,rows}.json`，vitest（`gui/src/lib/turn-persistence.golden.test.ts`）
  与 cargo test（`turn_persistence::tests`）同跑；rows 由 GUI 推导生成：
  `GALLEY_UPDATE_TURN_GOLDEN=1 pnpm --dir gui test turn-persistence`。
- **键序坑**：生产构建的 serde_json 没有 `preserve_order`（按键字节排序，页面收到的就是这个顺序），
  `cargo test --workspace` 会被 galley-cli 打开 `preserve_order`。两边测试都把输入键序归一到字节序。
- **过渡与幂等**：没有双写期。GUI 的 `persist_assistant_message` / `bump_session_after_turn` 调用与 Tauri
  命令一并删除（`turn_count + 1` 不幂等，双写会加倍）；行 upsert 本身幂等、`created_at` 保留首写。
  未读仍由 GUI 决定，改调新命令 `mark_session_unread`（GalleyApi 新方法，Tauri-only，与
  `clear_session_unread` 同类）。
- **次目标**：Tauri 命令 `list_live_runners`（`[{sessionId, pid, runOpen}]`）；hydrate 末尾
  `reattachLiveRunners`，运行中的会话先恢复历史再挂监听并标运行中；`activateSession` 先
  `attachLiveRunner`，Core 有存活 runner 就挂接不 spawn；`attachExternalBridge` 按会话去重并发挂接。
  崩溃的 runner 仍留在 manager 里且 pid 还在，`RunnerProcess` 加了退出标记（`has_closed`），列表排除它，
  重新点开照旧重启。
  这是 Tauri 命令，不是 runner IPC，`gui/src/types/ipc.ts` 不涉及；漂移门禁照跑通过。
- **无 schema 迁移、无 Agent API 形状变化**。测试辅助 `apply_all_migrations_for_tests` 复用运行时迁移
  列表，没有新增第 7 处手写 `include_str!` 列表。

### 真机复现（交给主会话，`tauri dev`）

1. 重启 `tauri dev`（Core 改了）。
2. 发一个多步任务，第 1 步落库后 `touch gui/index.html`；重载后会话应继续实时渲染，结束后
   `messages` 里 assistant 行数 = 引擎日志 `model_responses_*.txt` 的 `=== Response` 次数，
   `session wait --until-idle` 返回真正的最终回答。
3. 重载后 2 秒内 `galley session new … --content …`：会话完整落库，侧栏能看到运行中。
4. 重载后点开一个还在跑的会话：不 respawn（runner pid 不变、这一轮不被杀），历史完整、继续流式。
5. 定时任务：时间设在启动前，重启后看补跑是否产生完整会话（验证票面「可能的根因」）。

### 真机复现结果（主会话，2026-10-07）

- A 运行中途重载：5 次响应 = 5 行，有最终回答。
- B 重载后 1 秒 CLI 新建：第一次会话整行消失，查出 GUI hydrate 的 `delete_empty_new_sessions` 只看「默认标题 +
  `turn_count = 0`」，把首轮中的 `session.new` 会话连同用户消息一起删掉；改为只删一条消息都没有的会话
  （`core/src/db/search.rs`，回归测试在 `db_writes_test.rs`）。修后 4 次响应 = 4 行。
- C 重载后点开运行中的会话：桥自动重挂，点开前后 Core 子进程 pid 不变，6 次响应 = 6 行。
- 第 5 步（定时任务补跑）没跑：本机没有定时任务，不为测试新建。两条路径都可能造成补跑丢会话，第二条更吻合。
