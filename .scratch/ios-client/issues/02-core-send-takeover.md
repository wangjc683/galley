# 02 — Core 接管发送 + 所有写入都广播

Status: ready-for-agent（2026-10-09 JC 裁决全按推荐，见「裁决」；02a 起按序做，02e 暂缓到 P1）

来源：PRD 裁决 7。调研 2026-10-09（子代理只读调研，主会话逐条复核了标 ✓ 的事实）。

## 关键发现

1. ✓ 历史回放完全靠 GUI 驱动：runner 报 `ready` 后，GUI 读库并发 `load_history`（`gui/src/lib/ipc-handlers.ts:168-180`、
   `gui/src/lib/ipc/history-replay.ts:47-85`）；Core 里只有命令类型（`core/src/ipc.rs:403`、`:435`），没有发送方。
2. ✓（2026-10-09 已复现，见 Comments）Goal 冷启动不回放：Core 拉起 runner 的路径（`core/src/socket_listener/session_cmds.rs:813-860`）不回放，
   Goal 引擎拉起后立即派发（`core/src/goal_engine.rs:455-484`）；runner 在运行中拒绝 `load_history`（`runner/workbench_bridge.py:1782-1791`）。
   结果是有历史的冷会话上开 Goal，GA 在空历史上开工。
3. ✓ ADR-0002（`docs/adr/0002-do-not-unify-session-write-handlers.md`）否决合并 socket 写入为一个 `deliver_turn`：各命令失败语义是冻结契约。
4. ✓ `RunnerManager::spawn` 会先关掉同会话的旧进程（`core/src/runner_manager/manager.rs:169-187`）：GUI 打开会话与 Core 发送并发时，会杀掉刚派发的运行。
5. ✓ 自动标题 watcher 只挂在 GUI 的 `spawn_runner` 上（`core/src/runner_commands.rs:434-444`）。
6. ✓ GUI 空闲发送不经 `queue_offer` 预留，派发成功后才开闸（`manager.rs:407-418`）：拉起和回放的几秒里 CLI send 可插入，可能两次 `put_task`。
7. 外部写入的标题派生是「收到事件 → GUI 写库」（`gui/src/stores/messages.ts:655`），违反 `core/src/notify.rs:21-22`。
8. `applyExternalSessionUpdated` 用 `??` 合并，`SessionBrief` 跳过 None 字段（`core/src/api/session.rs:69-125`），清空的字段传不过去。
9. ~~疑似：socket `session stop` 只看 `agent_running` 会误报~~ 核实后撤销：`agent_running` 在 `turn_start` 置真、`turn_end` / `run_complete` 置假
   （`core/src/runner_manager/process.rs:272-276`），但 bridge 在非最终 `turn_end` 的同一处理里立即预发下一步 `turn_start`，最终 `turn_end` 后紧跟
   `run_complete`（`runner/workbench_bridge.py:1610-1632`），「假」只是两条事件之间的一瞬。

## GUI 发送变体清单

| 变体 | TS 侧步骤 | Tauri 命令 / Core 步骤 | 本地乐观改动 |
|---|---|---|---|
| 空闲普通消息（`useMessageSend.ts:192-298`） | 取 `pendingAskUser` 快照 → `appendUserTurn` → `ensureBridgeThenSend`（47-94）→ `markReplyNotifyPending` | `persist_user_message`（不广播）；`list_live_runners` / `spawn_runner`（GUI 拼参数，`bridge.ts:198-209`）；`send_to_runner(load_history)`；`send_to_runner(user_message)` | 追加用户轮；`agentRunning`；`sendPhase`；`turnIndexOffset`；派生标题 `rename_session` |
| 带图片 | 图片闸门在 TS（`useMessageSend.ts:216-233`） | Core 解码落盘（`commands/session.rs:217-231`），GUI 再把附件路径发给 runner | 先 dataUrl 显示，再替换为持久化附件 |
| 首条消息（`useMessageSend.ts:342-403`） | `createSessionPersisted` → `appendUserTurn` → `ensureBridgeThenSend` | `create_session` + 同上 | 先插侧栏行，失败回滚 |
| `/btw`（`useMessageSend.ts:234-241`） | 瞬时用户轮，不落库；仍激活会话并回放 | `send_to_runner(user_message "/btw…")`，不开闸 | 瞬时用户轮 |
| 回答 `ask_user` | `appendUserTurn` → `ensureBridgeThenSend(ask_user_response)`，跳过回放 | `persist_user_message`；`send_to_runner(ask_user_response)` | 同普通消息 |
| 运行中排队（`useMessageSend.ts:252-263`） | 无本地回显，只发文本 | `queue_or_dispatch_user_message`（已完全在 Core） | 无 |
| 停止（`useMessageSend.ts:301-327`） | 乐观 `setStopping` | `send_to_runner(abort)`，无事件 | `isStopping` |
| Goal 启动（`useGoalActions.ts:62-136`） | 需要时先建会话 | `start_session_goal` → `GoalEngine::start`（不回放） | 合并返回的 goal |

## 非发送写入清单

| 写入 | GUI 乐观 | Core 今天广播 |
|---|---|---|
| `create_session` | 是 | 否（socket 版有 `session-created-external`） |
| `rename_session`、`set_session_pinned`、`set_session_reasoning_effort`、未读 | 是 | 否 |
| archive / unarchive | 是 | 否（socket 版有事件） |
| delete 及批量 | invoke 后才改 | 否，连事件名都没有 |
| `assign_session_to_project` | 是 | 否（socket 版有 `session-moved-external`） |
| `set_session_llm`（GUI 另直接发 `set_llm`） | 是 | 否 |
| 项目 create / update / delete | 是 | 否；update 没有事件名 |
| 定时任务 | 收事件后重拉 | 是，但走 `app.emit` 不走 `Notifier` |
| goal start / extend / stop | 合并返回值 | 是（`goal-updated`） |
| 队列 | 否 | 是 |

## 拆分（按顺序，每张单独可上线，GUI 行为不变）

### 02a — Core 统一「确保 runner」
- 把 `spawn_config.rs` 与 `ensure_session_runner` 从 `socket_listener` 挪到共享模块；按会话单飞；挂 emit task 与自动标题 watcher；emit `runner-spawned-external`。
- 新增 Tauri 命令 `ensure_session_runner`；GUI `activateSession` 的 spawn 分支（`lifecycle-slice.ts:365-432`）改为先挂监听再 invoke。`warmupLLMList` 仍用 `spawn_runner`。
- Core 缓存每个 runner 最近一次 `ready`（模型列表、`imagesSupported`、推理强度），挂接时补发（裁决 6）。
- 外置模式 Python 别名表两份（`spawn_config.rs:180-205`、`python-probe.ts`）加一致性测试；dev 模式 Python 回退差异（`spawn_config.rs:33-52`）未核实。
- 风险：参数不一致、丢自动标题、监听挂两次、错过 `ready`。
- 验证：spawn 参数一致性单测；`core/tests/runner_manager_test.rs` mock bridge 单飞测试；`socket_write_handlers_test` session_new 系列；vitest `sessions.activate`、`runtime.live-runners`、`bridge`；两种运行时 dogfood。

### 02b — Core 历史回放（依赖 02a）
- 把 `rowsToConversationMessages`（`history-replay.ts:191-226`）移植到 Rust，与 `turn_persistence` 一样用 `core/tests/fixtures` 共享 golden fixture。
- ensure 时 `turn_count > 0` 就回放，等 `HistoryLoaded` / `Error{context:load_history}` / `Closed` / 8 秒超时；按 pid 记已确认；失败静默重启一次。
- **同一改动**删掉 GUI `ready` 里的回放触发（`ipc-handlers.ts:177-179`），`ensureBridgeThenSend` 的回放步骤改调 Core。Goal 与 `session new` 随之修好（发现 2）。
- 风险：回放内容不一致；超时起算点；静默重启产生的 `Closed` 关闸竞态（`manager.rs:619-628`，未核实）。
- 验证：两侧 golden；mock bridge 加 `history_loaded` / `error` 分支；更新 `useMessageSend.test.ts:58-150`。runner 不改。

### 02c — Core 统一 send，供 GUI 与手机（依赖 02b）
- 新模块 `core/src/session_send.rs`，不依赖 Tauri `State`，远程模块可直接调：可写检查 → `queue_offer` 预留（或排队，只收文本）→ 带附件落库 → ensure + 回放 → 派发 `UserMessage` / `AskUserResponse` → 失败释放闸门 → 广播。
- 新 Tauri 命令 `send_user_message`，合并 `queue_or_dispatch_user_message`，`persist_user_message` 退役。
- `/btw` 分支：按文本前缀识别（与 `manager.rs:426-431` 同规则），不落库、不预留闸门，确保 runner 后直接派发；另一端只看得到回答（P0 接受）。
- 标题派生（截断首条消息、`seed` → `derived`）搬进 Core：新 send 落库时做，socket `session send` / `session new` 共用同一个 helper（只改库里标题，
  不改 socket 返回）；删掉 GUI 收到外部事件后写库的 `maybeDeriveTitle`（`gui/src/stores/messages.ts:655`，修发现 7）。
- 图片能力闸门：新 send 落库前读 02a 的 `ready` 缓存，不支持就拒绝；只对桌面外置模式有意义（手机只服务内置，内置恒支持）。
- GUI 保留乐观回显，在 `appendUserTurnExternal` 按 `clientRequestId` 认领；判为排队时撤回显。发送阶段可见文案只有三档（`MainView.tsx:733-746`），用 invoke 起止推断。
- 停止改走 Core，条件用 `open_run || agent_running`。
- socket `session send` 不动（裁决 1），另写 ADR-0003。
- 风险：消息显示两次、`turnIndexOffset` 时序、附件替换、排队竞态。
- 验证：`socket_listener/ctx.rs` 假 `RunnerPort` + 记录型 Notifier 覆盖 dispatched / persisted_only / queued / 回答提问 / 图片 / 拉起失败 / 回放失败；vitest 认领逻辑；两种运行时 dogfood。

### 02d — 所有写入都在 Core 广播（02c 之后）
- 上表每个 Tauri 写入经 `Notifier` 广播，事件名与 socket 对应命令一致；新增 `session-deleted-external`、`project-updated-external`；其余会话字段走 `session-updated-external`。
- `set_session_llm` 由 Core 转发 SetLlm，GUI 不再直接发 `set_llm`。socket 与 Tauri 共用写入 + 通知函数，避免发两次。
- 清空字段用 Tauri 专用载荷显式带 null，**不改** `SessionBrief` 序列化（那是 CLI JSON 输出）。定时任务改走 `Notifier`。
- 验证：Rust 测试逐个写入命令断言只发一次；`socket_write_handlers_test.rs:859` 保持通过；vitest。

### 02e — GUI 自己的写入统一按事件应用（依赖 02c、02d；暂缓到 P1）
- 乐观首帧 + 以事件为准，按 `clientRequestId` 压掉过时回声；可选让 `turn_persistence` 广播会话更新（同时改 `bumpSessionAfterTurn` 防加两次）。
  标题派生已提前到 02c。

每张票顺手更新 `docs/architecture.md`、`docs/ipc-protocol.md`（`load_history` 改由 Core 发）、`CONTEXT.md`。

## 契约影响

- Agent API / socket 协议：不变（socket send 保持冻结时）。
- runner IPC 协议：不变，`load_history` 的发送方从 GUI 换成 Core。
- DB：不变（`client` 列在票 03）。
- 只新增 Tauri 内部命令和事件，载荷只加字段。
- 外置 GA：回放仍经 `load_history` 写 `backend.history`（宪法允许的接入点），载荷不变；不碰 GA 文件、venv、环境变量。

## 裁决（JC，2026-10-09，全按推荐）

1. socket `session send` 保持冻结：runner 不在时只落库、返回 `persisted_only`，发完即返回（`docs/agent-api/session-commands.md:225-232`）。
   新 send 只给 GUI 与手机；「确保 runner + 回放」三方共用（Goal、`session new` 随之修好）。以后 supervisor 要「冷会话也跑」就加可选参数（只加不删）。
   写 ADR-0003 说明这条分界，引用 ADR-0002。
2. 02e 暂缓到 P1；其中「标题派生搬进 Core」提前到 02c——手机建的会话不能靠桌面网页层写标题，且它违反 `notify.rs:21-22`。
   本机 CLI / supervisor 建的 42 个会话里 23 个的标题经这条路派生（`title_source = derived`）。
3. 自动标题 watcher 挂在所有由 Core 拉起的 runner 上（02a）。它只改 `seed` / `derived`，`user` 永不动（`core/migrations/038_session_title_source.sql:5-10`、
   `core/src/db/session.rs:775-776`）；`auto_title.rs:16-18`「CLI / Goal 会话本来就有真标题」与数据不符——CLI 建的 22 个里 19 个是截断标题，
   因 `session new` 用默认标题「新对话」（`session_new_cmds.rs:18`、`db/helpers.rs:289-293`）。代价：每个 agent 建的会话首次跑完多一次短模型调用。
4. 落库后先广播一次 `user-message-persisted`（`dispatch: "pending"`），派发后同一条消息再发 `dispatched` / 失败值；按消息 id 去重。
   理由：冷启动拉起 + 回放（超时 8 秒，`gui/src/lib/ipc/history-replay.ts:20`）期间另一端看不到消息。Tauri 内部事件，不碰 socket 契约。
5. `/btw` 进新 send，走不落库、不开闸的分支（见 02c）。手机 P0 不做专门按钮，打字即可。
6. Core 缓存每个 runner 最近一次 `ready`，`llm_changed` 时更新（`docs/ipc-protocol.md` §4.1、§4.12）；修 GUI 漏收 `ready`、供手机显示当前模型。
   图片闸门随之进 Core，只对桌面外置模式有意义。
7. Goal 冷启动 bug（发现 2）先复现再修，由主会话用 CLI 跑：建测试会话记暗号 → 重启 Galley 让 runner 变冷 → 对它启动 Goal 问暗号。
8. 发现 9 核实后撤销，不开票、不进 deferred；02c 新的停止照计划用 `open_run || agent_running`。

## 未核实

dev 模式两端 Python 是否一致；外置模式 `pendingLLMIndex` 语义；`Closed` 关闸竞态；发送失败 toast 是否确实没接重试。

## Comments

- 2026-10-09 复现发现 2（主会话，Galley v0.6.2 打包版 + CLI，JC 授权）：CLI 新建会话让它记住「蓝鲸 4721」→ 回「好」；退出并重启 Galley，
  该会话 `runnerAlive: false`；`goal start` 问暗号 → 回答「当前可见对话中没有暗号记录。不知道。」。GA 记忆里没有写入暗号（`memory/` 无匹配），
  排除凭记忆作答的干扰。坐实：Goal 冷启动在空历史上开工。测试会话 `s-mv0sqb9j-5l4w0q5e` 已归档，Galley 已退出恢复原状。
  顺带：退出后 IM 渠道进程短暂存活，几秒内被 `GALLEY_CORE_PID` 看门狗清掉，不是孤儿。
