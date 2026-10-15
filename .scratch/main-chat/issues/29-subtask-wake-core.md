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
