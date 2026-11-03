# 136 插话改道：主对话跑着时你说的话，下一步就送到它面前

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 186 第 2 条（「少规矩、多手」的第一只手）。只在内置运行时的主对话；工作台会话、子任务、IM 渠道照旧排队；外置零变化（外置没有主对话）。

## 为什么

- 主对话一次只能做一件事。它跑着的时候（含叫醒、到点提醒、巡看那几轮），你发的话进 Core 的队列，等这一轮跑完才一条一轮地发出（裁决 71 第 4 条；`core/src/message_queue.rs` 文件头）。连发三句是三轮三条回复；「上海的」「算了，查后天」这类补充与纠正，要等前一件做完它才看到。
- 方向（裁决 186）：不再靠条款限制它做什么来避免占住主对话，而是让你随时够得着它，由它自己决定怎么办。真人助理在 IM 上就是这样：你补一句、改一句，它下一刻就看到。

## 要做到（行为）

1. **送进正在跑的那一轮**：主对话有一轮在跑时，你发的文字不进队列，经 runner 设上游的 `intervene`（`managed-ga/code/ga.py:594`：每一步结束时读 `self.parent.intervene`，以 `[MASTER] …` 拼进下一步的提示，读完清空），这一轮的下一步就看到。
2. **送进去的那段话**要让模型知道这是用户在它干活时新发的话，由它决定接着做、改方向，还是把手上的交给子任务、先回他。只写这个意思，不加规则；一两句，英文，与入口层的写法一致。
3. **同一步里到了几句**：按发出顺序合成一段，同一次送进去。
4. **送不进去就退回**：这一轮在它读到之前就结束了（比如正在写最后的回复），这句照旧作为下一轮发出；不丢、不重复、不漏进下一轮的第一步（runner 在一轮结束时清掉没读的 `intervene`，并告诉 Core 哪几句没送到）。
5. **照旧的**：带图片的发送、`/btw`、有待回答的 `ask_user` 时的发送（那是回答）、停止键、停止中的排队，行为不变。
6. **所有走 Core 发送的入口一致**：GUI、CLI（`galley session send` 发给主对话）、手机。`session send` 的返回值如有变化只能加不能改（宪法 Rule 3；`docs/agent-api/stability-and-versioning.md:105` 的 `dispatch` 取值，`queued` 当年是按加法加进来的）。
7. **界面照 IM**：
   - 你发出去的话马上作为你的气泡落在对话底部，不进输入框上方的队列条；
   - 它做事的进展小字（裁决 135）挪到你这句下面，接着跑；
   - 这一轮的回复落在你这句之后，一条回复回应全部；过程卡片仍挂在这条回复下，含插话前后的所有步骤（一轮一张）；
   - 退回作为下一轮时看起来一样：你的气泡已经在，下一轮的回复跟在后面；
   - 工作台会话的队列条与排队照旧。
8. **落库与回放**：对话里的顺序是你发出的顺序。冷启动回放给模型的历史要和它当时看到的一致（插话出现在它读到的那一步之后），不能拼成接口不接受的形状（比如连着两条 user 消息）。手机端（`remote-protocol/`）收到的消息形状若受影响一并处理。

## 怎么做

- **先读**：`AGENTS.md`（宪法，尤其 Rule 1、3、5）；`docs/architecture.md`「How a user message is sent」与队列、运行闸门各节；`docs/ipc-protocol.md`；`docs/adr/0003-gui-and-phone-send-through-core.md`；`docs/agent-api/session-commands.md` §5.5a 与 `stability-and-versioning.md`；`core/src/session_send.rs`、`core/src/message_queue.rs`、`runner_manager` 的队列；runner 里用户消息怎么到 GA、轮次结束的钩子（`runner/ga_session.py`、`runner/handlers.py` 里主对话的 `GALLEY_MAIN_CHAT` 标记是现成的识别办法）；`managed-ga/code/ga.py:585-600`；GUI 主对话的画法（`gui/src/lib/assistant-conversation*`、`run-groups`、队列条）。
- **先设计再实现**：在本文件写「## 设计」一节（数据流、落库与顺序、回放、退回的竞态、Agent API 与 IPC 的改动、GUI 画法），然后直接实现，不用等主会话。遇到下面任一情况先停下回报，不要自己定：
  - 要改 Agent API 已有字段的含义（只加不改）；
  - 第 7 条的画法做不到，或做到要牺牲别处已定的画法（`docs/design/` 里主对话一节）。
- 要新开迁移可以，记得 `core/tests` 4 处、`cli/tests` 2 处手写的迁移列表都要补，验证必须 `--workspace`。
- **宪法 Rule 1**：`intervene` 是 GA 自己的属性，只在内置运行时的主对话里设；外置永远不设。写进设计一节。
- 更新 `docs/architecture.md`、`docs/ipc-protocol.md`、`gui/src/types/ipc.ts` 镜像（Core 侧新增的 IPC 命令、事件也要进镜像）、Agent API 文档（若 `session send` 的返回有新值）。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
.venv/bin/python -m pytest
.venv/bin/python -m mypy runner
.venv/bin/ruff check runner
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui exec vitest run
node scripts/check-docs-links.mjs
git diff --check
```

测试至少覆盖：主对话跑着时发送 → 发给 runner、不进队列；同一步几句合成一段；没送到的退回、恰好跑一次；工作台会话照旧排队；带图片照旧；runner 一轮结束清掉没读的 `intervene` 并上报；GUI 的顺序与进展小字的位置。真模型真机我在合入后的 dev 里走，代理不跑 `tauri dev`。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树，改主树的 `core/` 会让它重编、重启 Core）。不跑 `tauri dev`。
  ```bash
  cd <主树>
  git worktree add -b t136-interject-mid-run <scratchpad>/wt-136 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  pnpm --dir <wt>/gui install
  ```
- 不写 Galley 的真实数据库，不写内置 / 外置 GA 的状态；真实数据库只读。
- Core 不是 rustfmt-clean：只对自己改过的 Rust 文件跑 `rustfmt --check`。GUI 不是 prettier-clean：旧文件只格式化自己的 hunk，新文件可整篇。Windows CI 检出是 CRLF：Rust 原始字符串里的提示词，contains 断言别跨行。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t136-` 前缀命名。票面与文档里不写本机用户目录、worktree 路径、服务商名、接口主机。

## 回报

写在本文件末尾的「## 报告」一节，并在最后一条消息里给主会话：设计要点；改了哪些文件；测试与验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。

## 设计

（2026-11-03，执行代理写于实现之前。）

### 一句话

插话 = 主对话跑着时进了 Core 队列、同时交给正在跑的那一轮的一句话。它在队里占着位置，直到 runner 报「送到了」（这时才落库、出队）；一轮结束还没送到，它就是普通的排队项，照旧作为下一轮发出。「恰好一次」靠的是同一个事实：只有 `interject_delivered` 能把它移出队列落库，drain 只发队里的项。

### 数据流

1. **入口**（GUI 的 `send_user_message`、手机、socket `session.send`，都经 Core）：文字、非 `/btw`、不带图、不是 `--jump`。目标会话是主对话（`sessions.main_chat`）且是内置运行时，Core 用 `queue_offer_interjection`：一轮开着、Core 没在停止（发出 `abort` 到这一轮的 RunComplete 之间算停止）、队里没有非插话项，就入队并标 `interjected: true`，返回 `Interjected { queueId, position }`；否则与 `queue_offer` 完全相同（排队，或立即发出，或作为回答）。工作台、子任务、外置运行时只走 `queue_offer`，零变化。
2. **交给 runner**：Core 发 IPC 命令 `interject { items: [{ id, text }], preamble }`（`id` 是队列 id）。发不出去只记日志，项仍在队里。
3. **runner 写 `intervene`**（`runner/interject.py` 管账，`ga_session.py` 管 GA 的属性）：只在一轮在跑、内置运行时、`GALLEY_MAIN_CHAT=1` 三者都成立时接受；把还没送到的几句按发出顺序拼成一段：`preamble`、空行、各句（句与句之间空行），写进 `agent.intervene`。不接受的立刻发 `interject_returned { ids }`。按 id 去重。
4. **送到**：GA 每一步结束时在 `turn_end_callback` 里读 `intervene`，拼成 `[MASTER] …` 接进下一步的提示，清空，然后调 `_turn_end_hooks`（`ga.py:594-598`）。runner 的钩子读 `ctx["injprompt"]`：等于自己写过的某一段，且这一轮还会继续（`exit_reason` 为空、没到步数上限），那一段里的几句就送到了。先发这一步的 `turn_end`，再发 `interject_delivered { ids, turnIndex, absoluteTurnIndex }`（`absoluteTurnIndex` = 读到它的这一步的）。剩下的（GA 读完到清空之间新到的）重新写回 `intervene`。
5. **退回**：一轮结束的所有出口（自然结束、`ask_user`、步数上限、停止、`DONE_WITHOUT_EXIT`、斜杠命令），在发 `run_complete` 之前，清掉 `intervene`，把没送到的发 `interject_returned { ids }`。GA 的结束回调也会读走 `intervene`（`agent_loop.py:105`，这时下一步的提示被丢掉），钩子见 `exit_reason` 非空就不算送到——上游自己的 TUI 也按这一条判（`frontends/tuiapp_v2.py` `_install_intervene_replay_hook`）。
6. **Core 落库**（runner watcher，同一个有序消费者，这一步的 `turn_end` 已落库）：收到 `interject_delivered`，按 id 把这些项移出队列，在一个事务里落成 user 行（见下），广播 `user-message-persisted`（`dispatch: "interjected"`，带 `queueId` 与发送方的 `clientRequestId`），再广播队列快照。`interject_returned` 只记日志：队列本来就是权威。
7. **退回的那句怎么发出**：RunComplete 后 drain 照常取队首。队首是插话项、而这一轮停在 `ask_user` 上，它作为回答发出（`ask_user_response`；「上海的」正是这种）；否则作为下一轮的 `user_message`。发出（不论哪条路）后，队里剩下的插话项再交给 runner 一次，送进这一新轮。

### 落库与顺序

- **插话行**：`role = 'user'`，`turn_index` = 读到它的那一步的 `turn_index`，`sequence` = 2、3、…（同一步送到的几句按发出顺序），id `msg_{session}_{turn}_user_{sequence}`。按 `(turn_index, sequence)` 排：第 k 步 `(t, 1)`、插话 `(t, 2…)`、第 k+1 步 `(t+1, 1)`。不新占 `turn_index`，不动 `turn_count`：`--after-turn`、`NEXT_TURN_INDEX_SQL`、回放的 `turn_index > turn_count` 过滤都不受影响。不新开迁移。
- **一轮的开头 = `sequence = 0` 的 user 行**，插话行（`sequence > 0`）是这一轮中间的话。凡是「最新一条 user 行 = 这一轮的开头」的查询都加 `sequence = 0`：`latest_user_turn_index`（turn 落库的兜底、CLI 写入记在哪一轮）、待办 / 备忘 / 定时的 settle、`latest_run_replies` / `latest_run_last_reply`（子任务派发读回复）、分页的 `run_opener_at_or_before`。删除一条消息（`message_delete.rs`）把插话行算作这一轮的成员（同 `ask_user` 的回答）。carry 不改：它本来就让每条 user 行（含 `ask_user` 的回答）开一个 turn。
- **对话里的顺序**：送到的那句在读到它的那一步之后；画面上步骤不显示，所以就是「你的上一句、这一句、它的回复」。退回的那句是下一轮的开头行，在上一轮的回复之后（那条回复写的时候它还没看到这句）。

### 回放

不改转换规则，只靠顺序：…第 k 步（assistant）、插话（user）、第 k+1 步（assistant）… 交替；同一步送到的几句是相邻的 user 行，按既有规则合成一条（空行隔开），正是模型当时看到的那一段（回放里不带 `preamble`：那是给它的提示，不是对话）。退回的那句在上一轮回复之后，也是它看到的顺序。不会出现两条相邻 user 消息（相邻的已合并），也不会以 user 结尾之外的新形状。

### 退回的竞态

- 命令（命令线程）与一轮结束（agent 线程或命令线程）共用 `_run_complete_lock`；送到的记账（钩子，agent 线程）与写入共用 `_interject_lock`。锁序固定：先 `_run_complete_lock` 后 `_interject_lock`。
- GA 读完 `intervene` 到清空之间写进来的会被清掉：钩子按「还没送到的」重写，所以不会丢。
- 命令晚到（runner 已发 `run_complete`）：runner 立刻退回；Core 的项还在队里，RunComplete 之后作为下一轮发出。
- 不漏进下一轮第一步：结束时清；新一轮 `put_task` 前再清一次（防御）；只在一轮在跑时接受。
- 不重复：送到才出队落库；drain 只发队里的项；runner 按 id 去重（第 7 步会把剩下的插话项再交一次）。

### Agent API 与 IPC

- IPC（加法）：命令 `interject`；事件 `interject_delivered`、`interject_returned`。`docs/ipc-protocol.md`、`runner/ipc.py`、`core/src/ipc.rs`、`gui/src/types/ipc.ts` 同步。
- `session send`（加法）：主对话跑着时 `dispatch: "interjected"`，`message: null`，`queue: { queueId, position }`；`queued` 的含义不变（插话以外的排队照旧）。`stability-and-versioning.md` 的 `dispatch` 表加这个取值；`--jump` 不插话。
- 事件（加法）：`session-queue:changed` 的项加 `interjected: true`（只在为真时写）与 `clientRequestId`（有才写）；`user-message-persisted` 加 `dispatch: "interjected"` 与 `queueId`。Tauri `send_user_message` 的 `outcome` 加 `"interjected"`（带 `queue`）。手机（`remote-protocol/`）：`SendOutcome::Interjected`、`Dispatch::Interjected`、`QueuedMessage.interjected`，原有的 `Unknown` 兜底照旧；Swift 包同步。
- 不改已有字段的含义。

### 宪法 Rule 1

`intervene` 是 GA 自己的属性。只有 Core 判为「内置运行时的主对话」才发 `interject`；runner 再按 `_main_chat_refuses` 同一组条件（`GALLEY_MAIN_CHAT=1` 且 `is_managed_runtime()`）把关，外置永远不写。读 `ctx["injprompt"]`、`ctx["exit_reason"]` 是读 GA 钩子的局部变量，只读；写 `intervene` 与读这两项都收在 `runner/ga_session.py`（升级基线时的复核面），作为耦合点写进它的文件头。

### GUI 画法

- 队列里标了 `interjected` 的项不进输入框上方的队列条，作为你的气泡放在对话末尾（消息 store 里一条待送的 user 轮，`queueId`、`interjected`），出现时放发送动效（`userSubmitTick`，滚到底）。CLI、手机发来的插话同样画（出自队列快照）。
- 待送气泡一直在末尾：等它的时候落下的步骤、回复插在它前面。送到（`dispatch: "interjected"`）时原地认领（拿到 messageId 与库里的时间），之后的步骤接在后面。
- 三点与进展小字在对话末尾，也就是你这句下面；进展小字跨过插话接着说上一步在做什么（`settledStepHalf` 跳过插话），用时不重置。
- 回复落在你这句之后，一条回复回应全部；`buildRunGroups` 把插话当这一轮的成员（同 `ask_user` 的回答），过程卡片挂在回复下、含插话前后所有步骤；`segmentClosers` 不在插话处切段（GA 没有重开循环），用时与 token 照算。
- 退回：这一轮的回复落在你这句之上（它写那条回复时没看到你这句），你的气泡留在原处不动，下一轮开始时认领为下一轮的开头，回复跟在后面。这时回复不在对话末尾，不做「三点长成回复」的过渡，三点原地淡出。
- 叫醒的轮次（子任务汇报、到点提醒、巡看）里你插了话：从这一刻起按「你开的一轮」画三点与进展小字（原来只在它写字时出三点），因为你在等它了。
- 工作台的队列条与排队、带图片的发送、`/btw`、回答提问、停止键、停止中的排队，都不变。
