# 子会话提问挂起后队列冻结：CLI 发送按回答派发，supervisor 看得见状态（galley#30）

日期：2026-10-01
关联：[galley#30](https://github.com/wangjc683/galley/issues/30)、`core/src/runner_manager/manager.rs`（`queue_offer`、`RunState`）、
`core/src/runner_manager/queue.rs`（`settle_run`）、`cli/src/session.rs`（`session wait --until-idle`）、`core/src/api/message.rs`
（`askUser`）、[Agent API §5.2 / §5.5a / §5.5d / §5.10](../agent-api/session-commands.md)、[§7.1 变更记录](../agent-api/stability-and-versioning.md)、
[Supervisor SOP](../integrations/galley-supervisor-sop.md)、[消息队列 08-12](./2026-08-12-session-message-queue.md)（决定 5）、
[#29 跑满步数上限](./2026-10-01-max-turns-run-end.md)、[deferred](./deferred.md)「Supervisor 的队列操作面」

## 现象

社区报告（v0.5.3，Windows，内置内核，同一作者的 #29 之后）：supervisor 用 `galley session send --supervisor=…` 给子会话派活，子会话
用 ask_user 提问之后，supervisor 再发的消息全部回执 `dispatch:"queued"`，永远不执行，只能人工在 GUI 里回答。另报两个子现象：run 没收尾时
队列只进不出（即 #29）；supervisor 抢先做完后想叫停子会话，「停下」消息排在长任务后面，也看不到、撤不回队列。

## 核对

死锁属实，但触发条件比 issue 写的窄，三处说法不对：

1. **真实链条**：supervisor 在子会话运行中连发消息 → 入队；这次运行以 ask_user 结束 → `ask_pending`，出队暂停（`manager.rs:608`，
   08-12 决定 5：问之前排的消息不能替用户答题）；之后的 CLI 发送因队列非空继续排队尾（`queue_offer` 只看 `open_run || !items.is_empty()`），
   没有任何东西能解除暂停。
2. **GUI 不卡**：提问挂起时输入框绕开队列直接作为回答发出（`useMessageSend.ts:305`），旧消息等回答那次运行结束后再按序出队。同一状态
   下 GUI 与 CLI 行为不一致，这才是缺口。提问时队列为空的话 CLI 发送今天就会直接派发，所以 issue 的复现第 3 步单做复现不了；
   `session send --jump` 在门关着时直接派发、不中止，今天就能解锁。
3. **说错的三处**：`busy:false` 同时 `queuedCount:6` 在代码上不可能（`busy` 含 `queuedCount > 0`）；`state-seed` 里的
   `supervisor_sop.md` / `subagent.md` 是 GA 上游基于文件的子代理协议，不是 Galley CLI 文档；Goal 停止后的收尾合成在 v2 已删除。
4. 现象 2 与 #29 同根，已随 #29 修好。

## 裁决（JC，2026-10-01，「按你推荐的推进」）

1. **A**：CLI 发送在「有待答提问、没有开着的运行」时直接派发，作为回答，排在旧消息前面，与 GUI 对齐；旧消息仍守决定 5，回答那次运行
   结束后按序出队。否掉：让旧消息充当回答、超时放行队首（都违背决定 5），只改文档教 `--jump`（不一致还在）。
2. **`live.askPending`、`live.lastExit`**（同 schema 增量）。`lastExit` 是 #29 的延伸：撞上限的运行修好后照常收尾，但 supervisor
   分不清做完还是停在上限。issue 提的发送回执 `queueHeldReason` 在 A 之后用不上，不做。
3. **文档**：Agent API §5.5a（入队条件补「队列非空」、提问挂起时的发送、`--jump` 一行去掉「对空闲会话无效」）、§5.10（`already_stopped`
   不放行队列）；SOP 与 skill：`--jump` 也适用于 supervisor 叫停子会话当前工作（停下与收尾要求一次发出），怎么回答挂起的提问。
4. **暂缓**：CLI 队列查看 / 撤回、`--supersede`、`stop --wrap-up`、队列落库，进 deferred。

执行中又冒出三处，前一处直接修，后两处 JC 裁「按建议推进」：

- **`--after-turn` 公式差一**：SOP、reference、两份 SKILL.md 和内置 IM supervisor 提示词（`managed_prompt.rs`）都教
  `--after-turn=<turnCount+1>`。本机数据：第二条用户消息落在 `turn_index` 10，正是发送前的 `turnCount`，这次运行的第一步也是 10；
  判定是 `>=`，所以 `+1` 跳过第一步：一步回复会等到超时，多步运行在第二步返回。五处改成 `<turnCount>`，提示词测试改为拒绝 `turnCount+1`。
- **`session wait` 在半路返回 `completed`**：§5.5d 写明任何一步有内容就算完成，中间步都带 `<summary>`。新增 `--until-idle`：还要求
  Core 报告没有开着、也没在跑的运行（提问挂起算结束；队列还在出队则等到出完）；Core 不可达时退回旧判定。默认不变（规则 3）。wait 的
  `session` 顺带附上 `live`，supervisor 直接从最终帧读 `lastExit` / `askPending`。否掉：改默认语义（要升 schema 3）。
  执行代理验收时报出一个竞态：助手消息行是 GUI 处理 `turn_end` 时经 Core 落库的，比 Core 在 `run_complete` 上关闭运行稍晚，几十毫秒的
  窗口里 `--until-idle` 会判定完成而最后一行还没进库。改为判定完成后宽限 1 秒、重新探 Core 与读库，两次都结束才出最终帧；这次复核也
  顺带挡住 Goal 续跑或排队消息派发之间 `openRun` 短暂为 false 的空档。尽力而为，不是保证，文档写明。
- **CLI 读不到提问原文**：问题和候选只在 `messages.tool_calls` 里，`MessageBrief` 没有这个字段（本机 12 条提问行的 `content` 只有一行
  `<summary>`），`askPending` 看得到却答不了。消息行加 `askUser: {question, candidates}`，读时从已落库的 `tool_calls` 取（重启后也在），
  合并规则照搬桥的 `_extract_ask_user`（grok 拆成多个调用时同题合并候选）。否掉：放进 `live`（只在内存、且 `live` 是运行态不是内容）。

## 没跟的（记录，不修）

- `session stop` 只看 `agentRunning`，恰好落在两步之间的空档会误报 `already_stopped`，run 其实还在跑（文档已写明，并让调用方复查
  `live.openRun`）。
- runner 崩溃后被挂住的消息：CLI 发送排在后面，`--jump` 只得到 `persisted_only`（CLI 不重启 runner），目前只有 GUI 能救回。与 #30 同型，
  留待有报告再做。
- CLI 的回答以 `user_message` 发出，GUI 发 `ask_user_response`；桥对两者一视同仁、都能解除挂起，差别只在审计记录。
- 提问挂起且有旧消息时 `busy` 仍为 true（`queuedCount > 0`），已写进 `askPending` 一行的说明。
- `project follow --until-idle` 同名但机制不同（事件流静默一段时间即结束，并按持久化 `status` 挑会话，而 §5.2 写明该列不会是
  `running`），可能提前退出。与本次不在一条线上，留待有报告再看。
- 两种运行时模式都适用：改动全在 Core、CLI 与文档里，不碰 GA。内置 IM supervisor（Discord / Telegram 等）的提示词随本次一起更新。

## 验证

- Rust：`cargo test --workspace` 551 passed（新增：`queue_offer` 在提问挂起时放行、开着运行时仍排队、`last_exit` 跨下一次运行保留、
  `run_state` 带两个字段；`askUser` 提取 7 例，含 grok 拆分合并、不同问题忽略、坏 JSON；`--until-idle` 判定矩阵、宽限复核两次读的
  判定；集成测试：真 RunnerManager + socket + 模拟桥，首次运行以 ask_user 结束后 `session.send` 回 `dispatched`、旧消息随后出队；
  假 Core 翻转 `openRun` 时继续轮询；宽限期内落库的最后一行进最终帧）。把 `queue_offer` 临时换回旧规则，集成测试与单测转红；宽限期临时
  改成 0，迟到行测试转红。`managed_prompt` 测试改为要求 `--after-turn=<turnCount>`、`--until-idle`、`askUser`，并拒绝 `turnCount+1`。
- 门禁：`check.yml` 的六个脚本（含 supervisor SOP 漂移、文档链接）全绿，`git diff --check` 干净。
- 端到端（dev 版 + 真模型，CLI 以 supervisor 身份驱动）：子会话分两步打印后用 ask_user 提问，运行期间发一条消息 → `queued`；
  `wait --after-turn=0 --until-idle` 在提问后才返回（不是第 1 步），最终帧 `live` 为 `askPending: true`、`queuedCount: 1`、
  `openRun: false`、`lastExit: EXITED`，提问行带 `askUser`（问题与两个候选）。这正是 #30 的死锁现场。随后发回答 → `dispatched`，
  落在第 3 轮（= 发送前的 `turnCount`）；提问前排的那条在第 4 轮执行，模型也没把它当回答；`--until-idle` 等到两次运行都结束才返回，
  最终 `busy: false`、`lastExit: CURRENT_TASK_DONE`。
