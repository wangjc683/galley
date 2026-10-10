# 02 — Core 接管发送 + 所有写入都广播

Status: in-progress（02a `0df5de5c`、02b `1ab69b51`、02c `8d9bd79e` 已合入 main，2026-10-10；下一张 02d；02e 暂缓到 P1）

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
- 2026-10-10 02a 完成（执行代理，worktree `ios-02a-ensure-runner`，未提交）。
  - 实现：共享模块 `core/src/session_runner/`——`ensure_session_runner`（按会话单飞；临界区内先看 `live_pid`，活着就返回 pid 与 ready 快照，
    绝不在存活 runner 上 spawn）、`spawn_and_attach`（spawn → subscribe → emit task → 自动标题 watcher → `runner-spawned-external`）、
    `spawn_config.rs`（两套参数解析合一，GUI 规则优先）。错误用 `SessionRunnerError`；socket 层在 `common.rs` 的
    `SocketResponseLite::from_session_runner` 逐字节还原旧 tag 与文案（`core/tests/session_runner_test.rs` 钉住），Goal 记录的失败文案也不变。
    `socket_listener/spawn_config.rs` 删除；socket `session new` 与 Goal 派发都走共享模块。
  - ready 缓存：`core/src/runner_manager/ready.rs`，stdout 读取任务在广播前折叠 `ready` / `llm_changed` / `reasoning_effort_changed`，
    子进程退出即清空。`list_live_runners` 每行加 `ready`（只加字段）；新 Tauri 命令 `ensure_session_runner` 返回
    `{ pid, spawned, ready }`，`spawned: false` 时带快照。GUI 用 `applyReadySnapshot` 只更新 store，不触发回放。
  - `RunnerPort` 只加默认方法：`live_pid`（排除已崩溃仍登记的 runner）、`ready_snapshot`、`command_sink`（自动标题 watcher 的窄 trait
    `RunnerCommandSink`）。既有假实现不用改。自动标题 watcher 挂到所有 Core 拉起的 runner，模块注释已改写。
  - GUI：`activateSession` 的 spawn 分支改调 `runtimeStore.ensureSessionRunner`（先挂监听再 invoke）；`spawnBridge` 动作删除，
    `warmupLLMList` 仍用 `spawn_runner`。自己的 ensure 进行中收到 `runner-spawned-external` 时复用 `_attachesInFlight` 去重；
    `spawned: false` 立即置 connected，不等 ready。`attachExternalBridge` / `reattachLiveRunners` 用快照补模型列表。
  - Python 别名表一致性：共享 fixture `core/tests/fixtures/python-aliases.json`，cargo 与 vitest 各断言一遍。
  - 偏离：（1）Tauri 命令多一个过渡参数 `gaConfig`：`setGAConfig` 先改内存再写库、写失败只告警（`gui/src/stores/prefs.ts:407`、`:419`），
    GUI 可能持有未落库的 gaConfig，故按票面允许的过渡方案传内存值；等 Settings 写入经 Core 后删掉。（2）GUI 今天从不传
    `activeSessionId`（`gui/src/lib/bridge.ts:198-209`），保持不传，socket 仍保护自身；代价是全部其他 runner 都在跑时 LRU 会回收刚拉起的
    这个，原样保留。（3）Rust 的路径判定对齐 TS（`C:python` 直通、`1:\x` 不直通）。（4）Tauri 命令对 `NotFound` 的会话行最多等 1 秒，
    兜住 `createSession` 的火后不管写入（`useMessageSend.ts:156` 建会话后立即激活）。（5）socket `ensure` 遇到已崩溃仍登记的 runner 会重拉
    （旧实现只看 `pid`，会直接向死进程派发）。
  - 留给 02b：回放仍由 GUI 在真实 `ready` 上发（`ipc-handlers.ts` 未动）；`ensure_session_runner` 的 `spawned: true` 分支是挂 Core 回放的位置；
    发送路径对已存活 runner 仍会经 `ensureHistoryReplayComplete` 回放一次（与今天的 attach 路径相同）；Goal 冷启动 bug 未修。
  - 验证：cargo test --workspace 627 通过 0 失败（基线 604 / 0）；vitest 934 / 0（基线 906 / 0）；typecheck、lint、三个门禁脚本、
    `git diff --check` 通过。未真机 dogfood。
- 2026-10-10 02b 完成（执行代理，worktree `ios-02b-core-replay`，未提交）。
  - 实现：回放内容移植到 `core/src/session_runner/replay.rs`（`rows_to_conversation_messages`，规则逐条照搬 GUI）。共享样例
    `core/tests/fixtures/history-replay-cases.json` 共 19 条，先用临时 vitest 证明当时的 TS 实现逐条通过（改一条期望值即变红），
    再由 cargo test 读同一份；TS 函数与临时 vitest 已删，样例留作 Rust 的 golden。行数据复用 `session_message_rows` 的同一查询
    （`persisted_message_rows`），已完成轮次取会话行的 `turn_count`。
  - ensure 的新语义：成功＝runner 存活且历史已确认。新起的 runner 在会话有已完成轮次时：等 `ready`（订阅后查 ready 缓存，30 秒）→
    读库转换 → 发 `load_history` → 从发出起 8 秒内等 `history_loaded`；`context: "load_history"` 且 severity 非 `warning` 的
    error、进程退出、超时算失败。失败就静默重启一次（同一份 args），仍失败返回新变体 `SessionRunnerError::HistoryReplay`
    （socket 渲染为 `runner_error`「{via}: history replay failed: …」，只有 Goal 路径会遇到；Tauri 命令返回
    `{"error":"history_replay","detail"}`）。「已确认」记在 `RunnerProcess` 上，随进程消亡。已存活未确认的 runner：空闲就回放（失败同样
    重启一次），在跑就不碰、照旧返回。整个回放持有单飞槽。每次发送前后经 `Notifier` 广播 `runner-history-replay`
    `{ sessionId, phase }`。`session.new`（`spawn_and_attach`）新建的会话没有历史，拉起即确认。
  - 静默：进程级「关闭闸」。ensure 回放期间 hold 住 runner 的关闭（新起的用 `spawn_held`，从第一刻起；已存活的用 `hold_close`），
    主动替换时 `retire`。这两种关闭在 `BroadcastItem::Closed` 上带 `quiet: true`：runner watcher 不发 `RunSignal::Closed`，GUI 发射任务
    不发 `runner-closed`。hold 期间退出且没被替换的，ensure 放手时（`release_close`）补发两者。
  - GUI：`ready` 只更新 store；删掉 `case "ready"` 末尾的回放触发和 `error` / `history_loaded` 里的 `finishHistoryReplay`。
    `ensureBridgeThenSend` 对 `user_message` 改调新动作 `confirmSessionHistory`（本页已挂监听就直接调 Core ensure，否则走完整的
    `ensureSessionRunner`），Core 报 `history_replay` 时抛 `restoreTimeoutMessage`；GUI 自己的重启逻辑删除。`restoring` 只由
    `runner-history-replay` 的 `started` 驱动（`agentRunning` 为真时）。`history-replay.ts` 只剩这个事件的处理；
    `messages.ts` 里只给 GUI 回放读的行缓存（`remember…` / `getCached…` / `invalidate…`）一并删除，grep 核实无其他读者。
  - 偏离：（1）新起 runner 只在有已完成轮次时等 `ready`；没有历史就不等，新会话首条消息的时延与 02a 一致，也免得假 runner 都要发
    `ready`。（2）`EnsureOptions` 加 `holds_run_gate`：Goal 先预留闸门再 ensure，按票面「`open_run || agent_running` 为假才算空闲」，
    Goal 自己的预留会让存活未确认的 runner 永远不回放；调用方持有闸门时只看 `agent_running` 和别人开的运行。Goal 传 true，GUI 传 false，
    02c 统一 send 先预留后应传 true。（3）存活未确认的 runner 回放失败也重启一次（GUI 旧策略如此），重启前再查一次是否有人派发了运行，
    有就不重启、直接报错，不杀别人的运行。（4）没用 `expected_close`：它只把退出码改成 0，watcher 照样发 `Closed`；改为上面的关闭闸，
    同时盖住「回放中崩溃→重启」和「ensure 主动替换」两种关闭，也避免 GUI 收到 `runner-closed` 后拆掉正在等这次 ensure 的监听。
    （5）`activateSession` 返回 ensure 失败（成功为 `null`），发送路径在激活失败时直接报错，不再立刻重试，一次发送最多两次回放尝试，
    与旧 GUI 相同；激活阶段的 `history_replay` 失败静默（会话置 `idle`、无 bridge 失败 toast），与旧的尽力回放一致。
    （6）顺手修 GUI 潜在 bug：旧 `case "error"` 对任何 `context: "load_history"` 的 error 都判回放失败，未验证 backend 的 warning
    （随后照样 `history_loaded`）会让冷会话首发必然「恢复超时」；Core 现在把 warning 当非致命。
  - 「存活但未确认」入口核实：`RunnerManager::spawn` 只有两个调用点——`runner_commands::spawn_runner`（`runner_commands.rs:430`，
    只剩 GUI 预热，会话 id 固定 `__warmup__`，`gui/src/stores/runtime/llm-slice.ts:450`，不是真实会话，从不走 ensure）和
    `session_runner::attach_spawned`（ensure 与 `spawn_and_attach`，前者按上面的规则确认，后者拉起即确认）。scheduler 走 socket
    `session.new`。02b 之后剩下的未确认存活 runner 只有：两次回放都失败后留下的、以及从未确认过且一直在跑的，下次空闲 ensure 时回放。
  - 闸门与 Goal 竞态核实（02b 前）：watcher 对任何 `Closed` 都发 `RunSignal::Closed`（HEAD `manager.rs:253-259`），
    `queue_take_next` 收到就把 `open_run` 置假（HEAD `manager.rs:648`），drain 随后调 `on_runner_closed`（`message_queue.rs:180`）把
    Active 的 goal 判 Paused（`goal_engine.rs:361-366`）；`expected_close` 只改退出码（HEAD `process.rs:331`）。Goal 在 ensure 前已预留
    闸门（`goal_engine.rs:164`、`:401`，ensure 在 `:463`），而 drain 异步处理信号，旧 runner 的 `Closed` 可能在 Goal 派发后才到，
    放掉正在跑的运行的闸门。真进程测试复现了这一点：把关闭闸改回旧行为，`a_goal_survives_the_quiet_restart_of_its_runner` 收到
    `[Closed, UserRunStarted]` 而失败。修后同一测试断言无 `Closed`、闸门仍开、goal 仍 Active、此时的用户消息排队。
  - 留给 02c 的口子：socket `session send`（冻结）不走单飞，在 Core 回放新 runner 的几秒里，若 runner 已登记它就直接派发；派发早于
    `load_history` 时回放被拒，ensure 见到别人开的运行不重启、报 `HistoryReplay`，那条运行跑在空历史上。Goal 持闸时 socket send 会排队，
    GUI 发送不预留闸门（发现 6），所以 GUI 路径仍有这个窗口；02c 统一 send 先 `queue_offer` 再 ensure（`holds_run_gate: true`）可关掉
    GUI 与手机这一侧。ensure 持单飞槽贯穿回放，最坏约 2×（30＋8）秒，同会话的激活与发送会等。
  - 验证：cargo test --workspace 646 通过 0 失败（基线 627 / 0）；vitest 944 / 0（基线 934 / 0）；typecheck、lint、三个门禁脚本、
    `git diff --check` 通过。抽查：去掉「先回放再派发」，Goal 顺序测试变红；把关闭闸改回旧行为，两条真进程测试变红；均已还原。未真机 dogfood。
- 2026-10-10 真机 dogfood（主会话，用户的 `tauri dev` + CLI）：
  - 02a：CLI `session new` 建的内置会话首轮跑完，标题自动改为「天空为什么是蓝色」（`title_source = auto`），以前只会截断首条消息；runner 解释器与 `ga_config` 一致。
  - 02b：按 10-09 的复现步骤重跑。CLI 建会话记「蓝鲸 4721」→ 合入 02b 后 dev 重启 Core，会话 `runnerAlive: false` → `goal start` 问暗号 → 回答「蓝鲸 4721」并宣告完成。
    内置记忆目录里没有「4721」，排除凭记忆作答。发现 2 修复确认。两个测试会话已归档。
  - 未在 GUI 里点验（留给 JC）：冷会话点开后发送、运行中 Cmd+R 重载、EmptyState 选模型后首发。
- 2026-10-10 02c-core 完成（执行代理，worktree `ios-02c-core-send`，未提交；GUI 半边由另一代理按同一契约做 02c-gui）。
  - 实现：新模块 `core/src/session_send.rs`（不依赖 Tauri `State`，远程模块可直接调）。顺序：可写检查 → `/btw`（不落库、不碰闸门，ensure 用
    `holds_run_gate: false` 后直接派发；带图报 `images_not_allowed`）→ 闸门（纯文本走 `queue_offer`，排队即广播 `session-queue:changed`、返回
    `queued`；带图走新的 `queue_try_reserve`，不能立即派发就报 `images_not_queueable`，不入队、不改队列状态）→ 持闸后读 `ask_pending`（为真则本次是回答，
    派发 `AskUserResponse`，带图报 `images_not_allowed`）与图片能力（外置运行时 + 存活 runner + 快照 `imagesSupported: false` 报
    `images_not_supported`；内置与冷会话放行）→ 带附件落库 → 广播 `pending` → 标题派生 → ensure（`holds_run_gate: true`）→ 派发 → 广播
    `dispatched`。持闸后任何失败都释放闸门；落库后的失败再广播一次 `persisted_only`，同一消息 id，都带 `clientRequestId`。
  - `/btw` 判断抽成 `runner_manager::is_side_question`，`opens_run_gate` 与新 send 共用；`RunnerManager::queue_try_reserve` 与 `queue_offer` 共用
    `SessionQueueState::may_dispatch_now`，经 `RunnerPort` 暴露（默认 `true`，与默认 offer 一致）。
  - 标题：`core/src/session_title.rs`，截断逐字照搬 `deriveTitleFromText`（UTF-16 码元计数、JS `\s` 集合：含 U+FEFF、不含 U+0085）；fixture
    `core/tests/fixtures/title-derive-cases.json` 共 23 条，期望值由 node 跑 HEAD 的 TS 原函数生成。DB 写入是 CAS `try_apply_derived_title`
    （`WHERE title_source = 'seed'`），成功后广播 `session-updated-external`（`via: "title-derive"`）。接入：新 send、socket `session.send`
    （`send_now`）、socket `session.new`、队列 drain（`dispatch_queued_message`）、Goal 目标行。Goal 目标行核实为 role user、visible
    （`send_message_for_goal` → `insert_user_message_inner`），在 `GoalEngine::start` 里派生，socket `goal.start` 与 Tauri `start_session_goal`
    都经过它；续写行是 internal，不派生。
  - Tauri：新文件 `core/src/commands/send.rs`，`send_user_message`、`stop_session_run`；`persist_user_message`、`queue_or_dispatch_user_message`
    连同注册删除；`await_session_row`、`gui_error_json` 改为 `pub(crate)` 供复用。socket 命令的请求、返回体、错误 tag 与文案未改，既有断言未改。
  - 偏离：（1）socket `session.new` 不单独广播 `session-updated-external`，派生后的行随 `session-created-external` 带出：
    `socket_write_handlers_test.rs` 钉住了事件序列 created → spawned → persisted；返回体仍是创建时的行（标题「新对话」），库里是派生标题。
    （2）新 send 的事件顺序按测试清单取 pending → session-updated-external → dispatched，即落库 → 广播 pending → 派生标题（票面第 5 步写的是先派生
    再广播）。其他路径同样是消息事件在前、标题事件在后。（3）派生依据本次落库的消息文本（与 GUI 的 `maybeDeriveTitle(sid, text)` 一致），不回查库里
    第一条；`seed` 会话只会在第一条消息时派生。空白文本（只有图片）不派生。（4）JS `slice(0, 80)` 切在代理对中间时留下孤立高位代理，Rust 字符串装
    不下，Core 丢掉这半个字符；fixture 单列一条并附 JS 原输出。（5）`SendRequest` 多一个 `timeouts`（回放超时，Tauri 传默认值），供测试缩短。
    （6）ensure 的 `active_session_id` 传发送目标会话本身（LRU 保护）。（7）旧 `queue_or_dispatch_user_message` 的不可写错误是纯文本，新命令按契约
    返回 `{error, message}` JSON。
  - 竞态：`a_socket_send_during_the_replay_window_is_queued` 证明新 send 回放中并发的 socket `session.send` 得到 `queued`，runner 只收到一条
    `user_message` 且在 `history_loaded` 之后。抽查：把闸门改成 ensure 前释放（02c 前的 GUI 行为），该测试变红（socket send 得到
    `dispatched`）；去掉失败时释放闸门，5 条失败路径测试变红；均已还原。
  - 验证：cargo test --workspace 671 通过 0 失败（基线 646 / 0，新增 `core/tests/session_send_test.rs` 22 条与 3 条单元测试）；cargo check、
    三个门禁脚本、`git diff --check` 通过。未真机 dogfood。
  - 留给后续：GUI 删掉 `maybeDeriveTitle` 后，`rename_session` 的 `titleSource: "derived"` 参数无人调用，暂留；`stop_session_run` 在新 send 已预留
    闸门之后、派发之前按下时拦不住这次发送：拉起中没有存活 runner，返回 `already_stopped`；回放中 `abort` 落在还没有运行的 runner 上。
    那次发送随后照常派发，需要真机看是否要处理。
- 2026-10-10 02c 合入（`8d9bd79e`，Core 与 GUI 两张票并行，主会话集成验收）：cargo 671 / 0，vitest 959 / 0，六个门禁脚本通过。
  - 真机（CLI）：`session new` 后库里标题立即为首条消息截断（`title_source = derived`），首轮跑完换成自动标题「秋日散步赏叶品茶」，侧栏随 `session-updated-external` 更新；dev 窗口截图正常。测试会话已归档。
  - GUI 发送路径要在真机里实际发消息，属写操作，留给 JC 验收：冷会话首发不出现两条、首条消息后侧栏标题、EmptyState 选模型后首发、带图、运行中排队、GUI 发送同时 CLI 抢先（GUI 回显撤回、进排队条）、回答提问、运行中 `/btw`、停止（含「准备中」时）。
  - 已知缺口（不比旧行为差）：发送已预留闸门、尚未派发时点停止拦不住这次发送；以前同一时机直接报「停止失败」。是否处理待真机实感再定。
  - `rename_session` 的 `titleSource: "derived"` 参数已无调用方，暂留。
