# 29 子任务叫醒助手（Core）

Status: ready-for-agent

来源：[助手 PRD](../../assistant/PRD.md) 裁决 2（闭环）、8（第 1 步执行定稿）；[主对话 PRD](../PRD.md) 裁决 80、82。
同批：[30](./30-assistant-manual-and-entry-layer.md)（入口层与助手手册，另一个 worktree）、[31](./31-subtask-wake-gui.md)（界面，与本票同一个 worktree，按目录分域）。

## 背景

- **主对话**：内置运行时那条一直在的会话（`sessions.main_chat = 1`），界面上是助手「Galley」。它在回复末尾写 `<subtask>要做的事</subtask>`，
  Core 在这一轮结束后开**子任务**（`core/src/subtask.rs`，头注释把机制讲全了：哪些回复、一个标签一个子任务、回放标记、升级）。
- **子任务**：`parent_session_id` 指向主对话、`promoted_at` 为空的普通会话。用户在里面说过话（不是回答它的提问）就升级成普通对话，不再是子任务。
- **今天派完就不管**：结果只显示在卡片上；入口层让助手「用户问起再查」（`core/src/managed_prompt.rs:300-301`）。
- **本票**：子任务一次运行结束时，Core 叫醒主对话一轮（下称**叫醒**），由助手验收、打回或给用户交代。助手看到的指令在叫醒消息里（下面「措辞草稿」）；
  常驻的入口层与手册是票 30 的事。

## 要做的

### 1. 触发

挂在排队任务上：`core/src/message_queue.rs:170-181` 对每个会话的 `RunSignal::RunComplete` 调 `subtask::after_run_complete`，`Closed` 也经过这里。
会话是未升级的子任务时，按这次怎么结束生成一条**待报**（归它的主对话）：

| 结束方式 | 怎么认 | 待报 |
|---|---|---|
| 完成 | `last_exit` 为 `CURRENT_TASK_DONE` 或下面以外的值 | Done：带最终回答 |
| 停在提问 | `ask_pending` | Asking：问题原文与候选（同 CLI `MessageBrief.askUser` 的来源，`core/src/db/session.rs:12-18`） |
| 停在步数上限 | `MAX_TURNS_EXCEEDED` | StepLimit：最后一段看得见的文字 |
| 出错 | `DONE_WITHOUT_EXIT`，或 `RunSignal::Closed`（runner 退出） | Error：拿得到的错误说明 |
| 被停掉 | `ABORTED` | **不报**（是人或助手自己停的） |

另：主对话派活失败（`subtask_dispatches.failure` 为 `empty` / `unclosed` / `start_failed`，`subtask.rs` 的 `dispatch_tag` / `settle`）也生成 NotStarted 待报，带原因。

去重：同一子任务的同一次结束只报一次。只记在内存里即可：子任务跑在 Galley 进程里，Galley 退出它也停；唯一会丢的是「报告排着队时 Galley 退出」，接受（裁决 8）。

### 2. 什么时候发

每个主对话一份待报集合：

- **主对话空闲**（run gate 没被占、用户排队的消息为空、不在等用户回答）→ 立刻发。
- **主对话在跑** → 等这一轮 `run_complete`；用户排队的消息先发完（`queue_take_next` 先走），之后才发叫醒。
- **主对话在等用户回答**（它自己的 `ask_pending`）→ 不发：这时派任何 `user_message` 都会被当成那个问题的回答（`core/src/runner_manager/manager.rs:868` 一带的语义，SOP 里「answer with a plain session send」也是这条）。
  这种情况算「送不出去」（第 7 条），同时留在集合里，等用户答完、那一轮结束后照常发。
- **发之前重读现状**：子任务已经又跑起来、它的问题已被回答（`ask_pending` 已清）、已升级、已删除 → 丢掉这一件。剩下的几件**合成一条**叫醒。
- **叫醒不进用户看得见的队列**（输入框上方的队列条）：先抢 run gate（`queue_try_reserve`），再持久化、派发，参照 `subtask.rs` 的 `run_instructions`，或 Core send 已持有 gate 时的那段（`core/src/session_send.rs` 的 `send_reserved`）。
  走同一条确保 runner 的路（`ensure_session_runner`），主对话的切段、新段带最近几轮照常生效。

### 3. 叫醒那条消息

- 主对话里一条 `role = 'user'` 的行：`created_via = 'system'`，`supervisor = 'galley-report'`（新常量 `SUBTASK_REPORT_SUPERVISOR`，放在 `core/src/api/origin.rs` 的 `SUBTASK_STORED_SUPERVISOR` 旁；
  问候 `galley-greeting` 与子任务 `galley-subtask` 是同一做法，所以**不加迁移**），`visibility = 'visible'`（不是 `internal`：`internal` 会把整轮的事件都藏掉，助手的回复要看得见），`client` 为 NULL。
- `origin_note` 写这次覆盖的子任务 id，逗号分隔（以后「交代带卡片」要用）。
- 广播照 `user-message-persisted` 的现有做法（GUI 据来源藏起它，票 31）。
- 内容是给模型看的英文，由新函数生成；建议新模块 `core/src/subtask_report.rs`，措辞常量放在里面。每件写：子任务 id、标题、第几轮（`1 + send_backs`）、怎么结束的，加上该怎么做（措辞草稿）。
  Done 带最终回答，超过 3,000 字截断并注明用 `session show <id> --tail=1` 看全文；Asking 带问题与候选；StepLimit、Error、NotStarted 带说明。

### 4. 打回次数 `send_backs`

- 定义：子任务里 `supervisor = 'galley-assistant'` 的用户消息中，**前一条助手回复不是以提问（ask_user）收尾**的条数。回答子任务的提问不算；全部从库里数，确定、重启后照样对。
- 叫醒里写第几轮；`send_backs ≥ 2` 时该件的指令换成「不要再打回，把现有结果和缺的部分告诉用户」。Core 不拦任何发送：用户开口让它再试，照发。
- Core 给界面的子任务读模型 `SubtaskDispatch`（与它的事件 `SUBTASK_DISPATCHED_EVENT`）加字段 `send_backs`（wire `sendBacks`），变化时重发这条记录的事件。
  序列化时总是写出（0 也写）。GUI 的镜像在 `gui/src/lib/subtasks.ts`（`SubtaskDispatch`），由票 31 加 `sendBacks`；如果 IPC 漂移门禁在 31 落地前报缺，属预期，合入前主会话统一核对。
- 如果 `SubtaskDispatch` 也出现在 CLI 的 JSON 里，只加不改（宪法 Rule 3），并在 `docs/agent-api/` 的变更记录里补一行。

### 5. 不出声的回复 `<no-reply/>`

- 叫醒那一轮，助手只是打回、或替用户回答了子任务的提问时，最终回答写 `<no-reply/>`（叫醒措辞里会说）。
- Core 的回合推导把它剥掉：`core/src/turn_persistence/derive.rs:81-114` 剥 `<subtask>` 的同一处，把 `no-reply` 加进那组标签（自闭合写法 `<no-reply/>` 要认得，大小写、前后空白宽容）。
  剥完为空的回复，照「回复只剩派活标签、没有正文」那种处理。GUI 的镜像剥离在 `gui/src/lib/ipc/ga-output-cleaning.ts`，由票 31 改；两边要剥成一样（有 golden 夹具的照夹具补）。
- 原始 `content` 保留标签（同 `<subtask>`），回放时模型看得到自己写过它。

### 6. 回放与新段带过来的几轮

主对话的历史回放（`core/src/session_runner/replay.rs`）和新段带最近几轮（`core/src/session_runner/carry.rs`）里，叫醒行压成一行（多件多行）：

```
[Galley: subtask <id> "<title>" finished — details: session show <id>]
```

（结束方式照实写：finished / is asking / stopped at the step limit / failed / could not be started）。照 `subtask::mark_replay_rows` 把派活说明换成标记的做法。`<no-reply/>` 回复原样留着，user / assistant 成对。

### 7. 送不出去

叫醒派发失败（runner 起不来、派发报错），或到达时主对话在等用户回答 → 广播新事件 `subtask-report-undelivered`，载荷 `{ mainChatId, subtaskIds }`（camelCase；TS 镜像由票 31 加在 `gui/src/lib/subtasks.ts`）。
GUI 据此退回子任务自己的通知（票 31）。派发失败的几件留在集合里，主对话下一次 `run_complete` 后再试一次；等用户回答而按住的，那一轮结束后照常发。

### 8. 搜索

Core 给界面用的搜索（`core/src/db/search.rs`：⌘K 与「查找聊天记录」）排除叫醒行，以及剥完为空的 `<no-reply/>` 回复。
CLI 的 `sessions search` 尽量不动（契约不变；助手查历史时看得到叫醒里的结果也无害）。如果两者共用同一个查询、分不开，就一起排除，并在 Comments 里写明。

### 9. 范围

只在内置运行时、只对主对话的子任务。外置运行时没有主对话，零变化；普通会话、工作台零变化。CLI 命令与 Agent API 不加命令；叫醒行在 `session show` 里就是已有的 `via: "system"`，只多了数据。

## 措辞草稿

放进 `subtask_report.rs`。票 30 用真模型评测这一版，可能改字，结构不变。`{…}` 是填空，引号里的命令照写。

开头（每条叫醒一次）：

> [Galley — not a message from the user] A subtask you started has an update. Act on it, then reply to the user. Do not mention this note.

Done：

> Subtask `{id}` "{title}" (round {round}) finished. Its final answer:
> <<<
> {answer}
> >>>
> Check it against what you asked for in its instructions (`session show {id} --tail=40` shows them and its steps). If it holds, tell the user the result in a sentence or two and name the evidence (a confirmation number, a file path, a link). If something is missing or wrong, send it back with `session send {id} "<what is missing>" --supervisor=galley-assistant --reason="send back"` and end your reply with exactly <no-reply/> and nothing else.

Done，已打回两次（替换最后一句）：

> It has been sent back {send_backs} times already: do not send it back again. Tell the user what it found and what is still missing.

Asking：

> Subtask `{id}` "{title}" is asking: "{question}"{ Options: "a", "b"}.
> If the user already told you the answer, or it plainly follows from what they asked for, answer with `session send {id} "<answer>" --supervisor=galley-assistant --reason="answer"` and end your reply with exactly <no-reply/>. If it involves money, sending something to someone, anything that cannot be undone, or something only the user has (a code sent to their phone, a password), ask the user in a sentence, and pass their answer on the same way when they reply.

StepLimit：

> Subtask `{id}` "{title}" (round {round}) paused at the engine's step limit, mid-work. If it is getting somewhere, send it "continue" the same way and end your reply with exactly <no-reply/>; this counts as a round. Otherwise tell the user how far it got.

Error：

> Subtask `{id}` "{title}" stopped on an error: {detail}. Tell the user in a sentence what failed and what you suggest. Do not start it again unless they ask.

NotStarted：

> The subtask "{title}" could not be started: {why}. Tell the user in a sentence, and offer to try again.

几件合在一条里时，开头一次，各件依次排，末尾加一句：

> Reply once, covering all of them.

## 验证

在 worktree 里跑：

```bash
cargo test --manifest-path core/Cargo.toml --workspace
cargo check --manifest-path core/Cargo.toml --workspace
rustfmt --edition 2021 --check <你动过的 .rs 文件>   # core 不是 rustfmt-clean，只查自己的文件
pnpm --dir gui exec vitest run <IPC 漂移门禁相关测试>   # 若有覆盖 Core 事件名 / 字段的门禁；31 未落地时报缺属预期，写进 Comments
git diff --check
```

新测试至少覆盖：

- 触发矩阵：完成、提问、步数上限、出错、runner 退出、被停掉、已升级、派活失败；
- 时机：空闲立刻发；在跑时等这一轮且用户排队的先发；在等回答时按住，并发出「送不出去」；
- 合并与丢弃：两件合一条；又跑起来的、问题已被答掉的丢掉；
- `send_backs` 计数：回答提问不算；
- `<no-reply/>` 推导剥离；
- 回放与带过来的几轮里压成一行；
- 搜索排除；
- 派发失败广播「送不出去」，下一次 `run_complete` 再试。

注意：

- 时间相关的测试用 `TZ=UTC` 再跑一遍，CI 在 UTC。
- 别在 Rust 原始字符串里跨行做 `contains`：Windows CI 检出是 CRLF。

## 别动

- `core/src/managed_prompt.rs` 与助手手册（票 30）；整个 `gui/`（TS 镜像与界面行为都归票 31，它和你在同一个 worktree 里并行，目录分开）。
- 不加迁移，不加 CLI 命令，不改 Agent API 已有字段。
- 只在 worktree 里工作：绝不碰主工作树 `/Users/inkstone/Documents/genericagent-webui`（JC 的 `tauri dev` 在那里跑），不跑 `tauri dev`，不 `git commit`。
- 不对整个文件跑 `cargo fmt` / `prettier --write`，只格式化自己写的部分。

## 回报

- 改了哪些文件，每个一句；
- 新常量、事件、字段的确切名字（票 31 要对）；
- 门禁命令的最后输出；
- 票面写错或你改了主意的地方；
- 拿不准、要主会话定的事。

同样的内容写进本票 `## Comments`。

## Comments

### 2026-10-16 实现回报（子代理，worktree `assistant-wake-29-31`，未提交）

**改了哪些文件**

- `core/src/subtask_report.rs`（新）：待报的读出、措辞、内存里的待报集合、叫醒（抢闸门、重读、确保 runner、写行、派发、送不出去）。
- `core/src/subtask.rs`：回放里把叫醒行换成它的那几行（`mark_rows`）；`after_run_complete` 多收一个待报集合，派活失败的记为 NotStarted 并叫醒；新 `announce_send_back`；`is_final_answer` 改 `pub(crate)`；记录字面量补 `send_backs: 0`。
- `core/src/message_queue.rs`：排队任务每个信号的顺序改为：派活 → 记待报（在排队一步之前）→ 排队一步 → 叫醒（刚报到的主对话；本会话没取到排队消息时也试一次）；排队消息派出时若是助手的打回，重发派活记录。
- `core/src/api/origin.rs`：`SUBTASK_REPORT_SUPERVISOR`、`ASSISTANT_SUPERVISOR`、`Origin::subtask_report`、`Origin::is_stored_subtask_report`。
- `core/src/api/subtask.rs`：`SubtaskDispatch.send_backs`；`SUBTASK_REPORT_UNDELIVERED_EVENT`、`SubtaskReportUndeliveredPayload`。
- `core/src/api.rs`：导出上面几个。
- `core/src/db/subtask.rs`：打回次数（`subtask_send_backs`，`subtask_dispatches` 带上）、`subtask_dispatch_for_session`、`latest_run_replies`（`RunReply`）、`persist_subtask_report`。
- `core/src/db/mod.rs`：导出 `RunReply`。
- `core/src/db/session.rs`：`tool_calls_ask_user` 改 `pub(super)` 供打回计数复用。
- `core/src/db/search.rs`：界面搜索（`search_message_hits`）排除叫醒行与剥完为空的 `<no-reply/>` 回复；CLI 的 `search_messages_db` 未动（两者本来就是两条查询）。
- `core/src/runner_manager/queue.rs`、`manager.rs`：记下这一轮最后一条 `severity = "error"` 的 error 事件（开新一轮时清），`RunnerManager::last_run_error`，加一个单测。
- `core/src/socket_listener/ctx.rs`：`RunnerPort::last_run_error`（带默认 `None`，旧假件不用改）及 manager 实现。
- `core/src/socket_listener/session_cmds.rs`：socket `session send` 落库后，助手的消息重发派活记录（只是广播，响应不变）。
- `core/src/turn_persistence/derive.rs`：`GA_TAG_BLOCKS` 末尾加 `no-reply` 标签，加单测。
- `core/src/lib.rs`：`pub mod subtask_report`。
- `core/tests/fixtures/turn-persistence-cases.json`、`turn-persistence-rows.json`：4 个 `<no-reply/>` golden 夹具。
- `core/tests/subtask_report_test.rs`（新）：14 个集成测试。
- `core/tests/main_chat_reset_test.rs`：派活记录字面量补 `send_backs: 0`。
- `docs/managed-ga-runtime/runtime-modes-and-sessions.md`（新节 Subtask Reports）、`docs/architecture.md`、`docs/ipc-protocol.md`：各补一段。

**确切名字（票 31 对照）**

- 叫醒行：`role = 'user'`、`created_via = 'system'`、`supervisor = 'galley-report'`（Rust `SUBTASK_REPORT_SUPERVISOR`）、`visibility = 'visible'`、`client` 为 NULL、`origin_note` 为逗号分隔的子任务 id（无 id 的 NotStarted 不列）、`summary` 为回放那几行。广播 `user-message-persisted`，`dispatch` 先 `pending` 后 `dispatched` / `persisted_only`，`message.origin` 为 `{ via: "system", supervisor: "galley-report", reason: "<ids>" }`。
- 助手写子任务的来源：`supervisor = 'galley-assistant'`（Rust `ASSISTANT_SUPERVISOR`），`created_via` 照 CLI 的 `cli`。
- 打回次数：`SubtaskDispatch.send_backs`，wire `sendBacks`，总是写出（0 也写），反序列化缺省 0；助手往子任务写消息（socket send 或排队派出）时重发 `subtask-dispatched`。
- 送不出去：事件 `subtask-report-undelivered`（Rust `SUBTASK_REPORT_UNDELIVERED_EVENT`），载荷 `{ mainChatId, subtaskIds }`（`SubtaskReportUndeliveredPayload`）。每件待报只报一次，重试再失败不重发。
- 不出声：剥掉任何 `no-reply` 标签，自闭合、开、闭都算，大小写不论，尖括号里可有空白；Rust 正则 `(?i)<\s*/?\s*no-reply\s*/?\s*>`（`\s` 为 JS 空白集）。
- 其他：`VIA_SUBTASK_REPORT = "subtask-report"`（叫醒拉起 runner 时 `runner-spawned-external` 的 `via`）、`REPORT_TEXT_MAX_CHARS = 3_000`、`SEND_BACK_LIMIT = 2`。

**门禁最后输出**

- `cargo test --manifest-path core/Cargo.toml --workspace`：34 组 `test result: ok`，合计 960 passed，0 failed（之后补的 manager 单测与格式修改再跑 `-p galley-core --lib`：442 passed）。
- `TZ=UTC` 重跑 `subtask_report_test`、`main_chat_segment_test`、`subtask_test`：14 / 18 / 9 passed。
- `cargo check --manifest-path core/Cargo.toml --workspace`：`Finished`，唯一警告是 `relay/src/channels.rs:347` 的旧 `fetch_update`。
- `rustfmt --edition 2021 --check`：新文件与 `subtask.rs`、`manager.rs` 等自己的段落干净；`db/session.rs:935`、`session_cmds.rs:102/145`、`lib.rs` 模块顺序等是原有的不干净处，未动。
- `pnpm --dir gui exec vitest run src/lib/turn-persistence.golden.test.ts`：37 passed（票 31 的 TS 剥离已与新夹具一致）。
- `node scripts/check-ipc-protocol-drift.mjs`：aligned（本票没动 runner 协议）；`node scripts/check-docs-links.mjs`：OK；`git diff --check`：干净。

**票面写错或我改了主意的地方**

1. 回放那几行存在叫醒行的 `summary` 列（用户行本来不用这列），回放直接取它；没有时按 `origin_note` 的 id 退成 `[Galley: subtask <id> has an update — details: session show <id>]`。原因：结束方式只在写行时知道，从英文正文反解析会随票 30 改字失效；不加迁移。代价：CLI `session show` 里这行多一个 `summary` 字段（只加不改）。
2. 先确保 runner 再写行（Core 的发送是先写后确保）：runner 起不来时不留孤行，空闲间隔也量到这条之前的最后一条消息，切段照常。只有派发那一步失败才会留下一条 `persisted_only` 的行，下次重试再写一条新的。
3. `SLASH_COMMAND_COMPLETED` 不报（票面「以外的值」都算完成）：这种结束没有干活，报「完成」只会给助手一个空答案。
4. StepLimit 的措辞草稿没有放「最后一段看得见的文字」的位置，而表里要求带上：我在第一句后加了 ` The last thing it said:\n<<<\n…\n>>>`（为空就不加）。`send_backs ≥ 2` 时 StepLimit 的「continue」那句也换成「不要再打回」（continue 也算一轮）。
5. NotStarted 没有标题（空标签）时写 `A subtask could not be started: …`，而不是空引号。
6. 重试时机：不只「主对话下一次 run_complete」，主对话的任何运行信号（含 `Closed`、且没取到排队消息）和新来的待报都会再试；不会紧循环，因为触发都来自外部事件。
7. 「拿得到的错误说明」：Core 原来不记 error 事件，现在在运行闸门状态里记最后一条 `severity = "error"` 的 error（bridge 在 `DONE_WITHOUT_EXIT` 前发的 `task_end` 那条），开新一轮时清；runner 中途退出写固定说明。
8. 「变化时重发」：助手每次往子任务写消息都重发记录；答题不改计数，重发的是同样的值（页面按同一标签替换，无害）。
9. 子任务的新待报会顶掉它还没送出的旧待报（同一子任务只留最新一件）。

**拿不准、要主会话定的事**

1. 手机：远程模块照常转发 `user-message-persisted`，叫醒行会以 `origin { via: system, supervisor: galley-report }` 到手机，iOS 端若不过滤会画成用户气泡。本票没动 `core/src/remote/`。
2. 闭环依赖子任务的 runner 还活着：socket `session send`（ADR-0003 冻结）在 runner 不在时只落库（`persisted_only`）不拉起。子任务 runner 被 LRU 挤掉（上限 20）或 Galley 重启后，助手的打回与代答就不会跑。要不要让 Core 对「`galley-assistant` 写未升级子任务」拉起 runner，或手册里让助手看 `dispatch` 字段，需要主会话定。
3. 叫醒送不出去（或重读后一件不剩）时释放闸门，不经过 run_complete：这期间用户在主对话排队的消息要等下一次手动动作（与 Core 的发送失败、排队派发失败的现有做法一致）。
4. 「主对话在等用户回答」而按住的待报：用户会先收到子任务自己的通知（退路），答完后又收到助手的交代，即两个声音；票面如此，记一下。
5. 叫醒那一轮 GA 的 `<summary>` 照常写进主对话的会话摘要（`sessions.summary`），侧栏卡片的「最后一句」由票 31 处理，Core 未改。

### 2026-10-16 追加：socket `session send` 的 `ensureRunner`（主会话定的路，回应上面待定 2）

**改了哪些文件**

- `core/src/protocol/commands.rs`：`SessionSendArgs.ensure_runner`（wire `ensureRunner`，`#[serde(default)]`，为 false 时不写出，旧线上形状不变），legacy 等价测试补两条。
- `core/src/socket_listener/session_cmds.rs`：`send_now` 多一个 `ensure_runner`；为真且没有活的 runner 时，在调用方已预留的运行闸门下走 `session_runner::ensure_session_runner`（`via: "session.send"`、`holds_run_gate: true`、回放历史），然后照旧写行、派发；`QueueJump::DispatchNow` 那条路也带上。起不来或回放失败：照旧写行、答 `persisted_only`、放闸门，绝不派给没装上历史的 runner。runner 活着、或消息进了队列：与原来完全一样。答待回答问题仍发 `user_message`（galley#30 语义不变）。
- `cli/src/args.rs`、`cli/src/main.rs`、`cli/src/session.rs`：`galley session send <id> "<text>" --ensure-runner`。
- `cli/src/client.rs`：线上形状测试（不给时没有 `ensureRunner` 键，给了是 `true`）；`cli/tests/m1_writes.rs`：clap 接受该参数（无 Core 时 exit 4），拼错仍 exit 2。
- `core/src/subtask_report.rs`：叫醒措辞里两条 `session send … --supervisor=galley-assistant` 都加了 `--ensure-runner`（放在 `--reason=…` 之后），加一个单测逐条核对。
- `core/tests/session_send_ensure_runner_test.rs`（新）：6 个测试。
- 文档：`docs/agent-api/session-commands.md` §5.5a（标题、说明段、参数表、`dispatch` 说明）、`docs/agent-api/stability-and-versioning.md` §7.1 新增「Changes inside `3`」一条、`docs/adr/0003-gui-and-phone-send-through-core.md` Consequences 一句、`docs/managed-ga-runtime/runtime-modes-and-sessions.md` 一句。外部代理 SOP 未动。

**确切名字**：CLI 参数 `--ensure-runner`；socket `session.send` 参数 `ensureRunner: bool`，缺省 `false`；Rust 字段 `SessionSendArgs::ensure_runner`；起 runner 时 `runner-spawned-external` 的 `via` 为 `"session.send"`。响应体不变，只是 `dispatch` 可能从 `persisted_only` 变成 `dispatched`。在 `--schema=1` / `2` 下同样生效（参数只加不改）。

**测试**

- `session_send_ensure_runner_test`：`test result: ok. 6 passed; 0 failed`（冷会话起 runner、先回放后派发；不带参数仍 `persisted_only`；在问的会话冷启动后答题、越过被按住的排队消息；活 runner 照旧；起不来只落库；回放被拒两次不派发）。
- `cargo test --manifest-path core/Cargo.toml --workspace`：35 组 `test result: ok`，合计 970 passed，0 failed，`exit=0`。
- `rustfmt --check`：本次动过的文件干净（`session_cmds.rs:102` 是原有的不干净处）；`check-docs-links`、`check-supervisor-sop-drift`、`git diff --check` 通过。

**注意**：带 `--ensure-runner` 的 send 要等起 runner、回放完才返回，可能要几秒（文档已写）。
