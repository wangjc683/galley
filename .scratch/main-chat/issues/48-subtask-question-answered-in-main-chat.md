# 48 子任务提问只在主对话里答，卡片只写状态；别处答掉后主对话里的提问怎么收尾

Status: done（2026-10-19 JC 真机：子任务提问时卡片只写「等你回复」、由 Galley 在主对话里问，通过；第二节的修法见票 49。裁决 101；2026-10-19 第一节合入 main；第二节已查明「别处答掉后主对话里转述的提问收不了尾」，修法待 JC 定，另开票，见 Comments）

来源：主聊天 PRD 裁决 101（2026-10-19 JC 真机第 5 站）。依赖 06a（卡片）、29（Core 叫醒）、31（叫醒的界面）。外置运行时没有主对话、没有子任务，零变化。

## 背景（已查库核实，别重查）

主对话 `s-mvbu2ofu-vgao8ozm`，子任务 `s-mveoqugj-d33hpvqy`（「整理下载文件夹，先问分类，再只列方案」）：

| 时间（UTC） | 主对话轮 | 事 |
|---|---|---|
| 03:19:12 | 18 | Galley 派活，`<subtask>` 里写明第一步用 `ask_user` 问分类 |
| 03:19:18 | 19 | 子任务提问；Core 叫醒主对话（`created_via=system`、`supervisor=galley-report`），叫醒消息带问题原文与四个选项，并写「用户已告诉过你就 `session send … --ensure-runner` 替答并以 `<no-reply/>` 结尾；涉及钱、对外、不可逆或只有用户有的东西，就问用户，并把回答照样转过去」 |
| 03:19:25 | 19 | Galley 判断要问用户，用 `ask_user` 在主对话里再问一遍（同样四个选项） |
| 同时 | — | 子任务卡片按 06a 画着子任务自己的提问：「等你回复」、问题正文、四个候选、「回复…」输入框 |
| 03:20:32 | 20 | JC 在主对话里答「按用途／项目…」 |
| 03:20:47 | 21 | Galley `session send` 转给子任务；22 轮 `<no-reply/>` |
| 03:21:00 | 23 | 子任务完成，叫醒；24 轮 Galley 核对后交代 |

界面上同一个问题出现两份（JC 截图：上面是卡片里的，下面是主对话的提问气泡与候选）。

## 一、实现：卡片只写状态（裁决 101 第 1 条）

- 内置主对话里，子任务处在「在问你」时，`gui/src/components/conversation/SubtaskCards.tsx` 的卡片**只写状态**（现有的「等你回复」那一行与琥珀色样式照旧），**不画**问题正文、候选按钮和「回复…」输入框。
- **兜底**：这个子任务的这次提问，叫醒没送到助手（Core 发了 `subtask-report-undelivered`，载荷 `{ mainChatId, subtaskIds }`，见 `gui/src/lib/subtasks.ts`、`gui/src/lib/ipc-handlers.ts`、`gui/src/lib/subtask-notify.ts`）时，卡片照旧画完整的提问与输入框，你在卡片里答。
  - 「这次提问」的界定你来定并写理由：比如收到 undelivered 之后到子任务再次开跑之前算兜底态；子任务回到在跑、或换了新问题就清掉。
  - 兜底态放在 store，不挂组件上（切走再回来还在）。页面重载后 undelivered 的内存状态丢失怎么办：写清现状与代价（例如重载后只写状态，你可从「打开」进子任务答），不必为此加持久化，除非你发现很便宜。
- 侧栏助手卡片、顶栏的「子任务在问你」与通知的规则不动（通知已按助手 PRD 跟着助手的消息走，送不出去才退回子任务自己的通知）；如果你发现它们和新规则矛盾，报出来。
- 「打开」进子任务后，子任务自己会话里的提问照旧可答（这是第二节要查的路径之一），本节不动它。
- 文档：`docs/design/conversation.md` 子任务卡片一节（在问你时的画法）改成裁决 101；`docs/design/onboarding-and-cards.md` 如有子任务卡片在问你时的描述，一并改。代码注释同步。i18n 只删不再用的键时要中英一起删；有键还在别处用就留着。

## 二、先查：别处答掉后，主对话里转述的提问怎么收尾（只查、不改）

裁决 101 之后，子任务的提问还可能在这些地方被答掉，而此时 Galley 可能已经在主对话里用 `ask_user` 转述、正在等你：

1. 卡片兜底态里答（叫醒没送到时，主对话里本来就不会有转述，按理不冲突，核实）；
2. 「打开」子任务，在它自己的会话里直接答；
3. CLI / 别的 supervisor 往子任务 `session send`；
4. 手机端（远程模块）。

要回答：

- 每条路径下，**现在实际会怎样**：主对话里挂着的 `ask_user` 会不会一直挂着；挂着时子任务完成的叫醒是不是送不出去（助手 PRD「它在等你回答时不发」，`.scratch/assistant/PRD.md:125-126`），退回子任务自己的通知；你下一句话会不会被当成那个旧问题的回答。给 file:line 因果链（Core：`core/src/` 里叫醒、送达、undelivered 的代码；runner：主对话 `ask_user` 等待与取消的机制）。
- Core 发叫醒前「重读现状，问题已被你在卡片上答掉的丢掉」（助手 PRD 第 126 行）的实现在哪、覆盖了哪些路径。
- 修法 2～3 个，带推荐，各写对外置运行时的影响（应为零）与要不要改 Core / runner（runner 只能改内置运行时的部分，见 `docs/managed-ga-runtime/README.md`）。例如：别处答掉时 Core 替主对话那个挂着的提问收尾（以系统身份结束它、助手这一轮不出声）；或主对话转述期间子任务会话里不让直接答；或界面把主对话那条提问标成「已在别处回答」。

只读代码与现有测试推断；**不要编译 Rust**（这个 worktree 没有克隆 `core/target`，全量编译很慢），需要跑 Rust 实验就写清要验证什么，由主会话安排。

## 验收（第一节）

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、全量 gui 测试两遍（本机时区与 `TZ=UTC`）、`git diff --check`、`.github/workflows/check.yml` 里的门禁脚本、`node scripts/check-docs-links.mjs`、新增中文行的标点扫描。
- 测试：在问你且未收到 undelivered → 卡片只有状态行，没有问题正文、候选、输入框；收到 undelivered → 画完整提问与输入框，回答照旧送进子任务；子任务回到在跑或换了问题 → 兜底态清掉；工作台（非主对话）里的子任务卡片如有，行为写明。

## Comments

### 2026-10-19 实现与调查回报（子代理）

#### 1. 第一节：卡片只写状态（已实现，未提交）

改动文件：

- `gui/src/lib/subtasks.ts`：卡片的「在问你」状态多一个 `inCard`；新增纯函数 `answeredInCard`（判定兜底）与 `sameQuestion`；`subtaskCardLine` 在问你时写侧栏会话行的「等你回复」（`copy.sidebar.waitingForYou`），兜底时不写（气泡自己写）。
- `gui/src/stores/subtasks.ts`：新增 `askInCard`（按子任务 id 记 Core 说没送到时它在问的那个问题，页面还没见到问题时记 null）与 `markAskInCard`、`clearAskInCard`；`forgetSessions`（重置主对话）一并清掉。
- `gui/src/lib/ipc-handlers.ts`：收到 `subtask-report-undelivered` 时先记兜底再补发通知；子任务 `turn_start` 时清掉；叫醒行 `user-message-persisted` 为 `dispatched` 时按行备注（`origin.reason` 里逗号分隔的子任务 id）清掉。
- `gui/src/components/conversation/SubtaskCards.tsx`：只在 `state.inCard` 时画 `SubtaskAnswer`（问题、候选、输入框）；否则只有状态行；头注释改成裁决 101。
- `gui/src/components/conversation/AskUserBubble.tsx`、`gui/src/i18n/locales/zh.ts`：只改注释。i18n 没删键：`replyPlaceholder`、`send` 兜底时还在用，状态行借用已有的 `sidebar.waitingForYou`，没加新键。
- `docs/design/conversation.md`：子任务卡片一节的表格「在问你」一行与「在问你时……」条目改成裁决 101（含兜底、界定、重载后），「通知只剩一个声音」补一句。`docs/design/onboarding-and-cards.md` 里没有子任务卡片的描述，没改。
- 测试：`lib/subtasks.test.ts`、`SubtaskCards.test.tsx`、`lib/ipc-handlers.subtask.test.ts`、`stores/subtasks.test.ts`。

兜底态的界定：从 Core 发 `subtask-report-undelivered`（载荷里有这个子任务）起，到下面任一件为止：

- 子任务再开跑（`turn_start`）：你答了，或别处让它跑了；换了新问题也在这里清掉，因为换问题必然先开跑；
- 之后有一次叫醒带着它送到了助理（叫醒行 `dispatched`）：助理拿到了，会在主对话里问，卡片回到只写状态，免得又是两份。只认 `dispatched`：`pending` 之后派发失败（`persisted_only`）时 Core 不会再说一次没送到（`subtask_report.rs` 的 `mark_announced` 只报没报过的），在 `pending` 就清会丢掉兜底；
- 渲染时还核一次：兜底记下的问题与子任务此刻的问题不同（`sameQuestion`），就不在卡片里答。这是防漏掉 `turn_start` 的保险；记的是 null（Core 的话先于 `ask_user` 事件到）时认它此刻问的那个。

理由：按 Core 的送达状态判断（裁决 101 第 2 条），而且这两个事件页面都已在听，不加新事件；「这次提问」就是 Core 说没送到的那份汇报对应的那一问，开跑或送达都意味着这份汇报失效（Core 那边 `is_still_due` 也是以「又跑起来」丢弃汇报，`subtask_report.rs:1477`）。

放在 store、不挂组件，切走再回来还在。工作台没有子任务卡片：`MainView` 只在主对话时把父会话传给 `useSubtaskDispatchesByMessage`（`MainView.tsx:227-229`），外置运行时没有主对话，零变化。

页面重载后：兜底只在内存里，Core 每份汇报只说一次没送到，重载后不会再说，卡片回到只写状态。代价是多一步：从「打开」进子任务，在它自己的对话里答（重载后子任务的提问照旧从历史里恢复，`derivePendingAskUser`）。提问不会丢：Core 那份汇报还在等，主对话下一次跑完、不在等你回答时送到助理（`message_queue.rs:257`），由它转述。没加持久化：要么得让 Core 提供查询，要么用 sessionStorage，后者在 Galley 重启后会留下 Core 已经不认的旧状态，不便宜。

侧栏、顶栏、通知：没有硬矛盾，规则都没动。观察两点：

- 子任务刚问、叫醒那一轮还在跑时，侧栏助手卡片与顶栏写「子任务在问你」（`lib/assistant.ts:108-133`：问你的优先级高过在跑），卡片上却没有可点的东西；如果助理替你答了（`<no-reply/>`），你其实没被需要。这是裁决 101 第 3 条的代价，但持续时间是叫醒那一轮的长度，不止「几秒」。请在 dev 里看。
- 助理转述后，主对话自己的提问优先，侧栏写「等你回复：……」；兜底时子任务自己补发「子任务在问你」通知，卡片里也正好能答，两者一致。状态只写时通知跟着助理的 `ask_user` 走（`noteSubtaskReportPersisted` 置位，主对话 `ask_user` 事件发「等你回复」）。

#### 2. 第一节验证

- `pnpm --dir gui typecheck`：通过。`pnpm --dir gui lint`：通过（0 warning）。
- 全量 gui 测试：本机时区 167 个文件 1761 个用例全过；`TZ=UTC` 再跑一遍，同样 1761 个全过。
- `check.yml` 门禁：`check-ipc-protocol-drift`、`check-supervisor-sop-drift`、`check-docs-links`（450 个文件）、`check-version-consistency`、`check-managed-ga-payload`、`check-ga-baseline-drift` 全部 exit 0。没新增 IPC 事件，`ipc.ts` 不用跟。
- `git diff --check`：干净。
- prettier：HEAD 时就是 prettier-clean 的三个测试文件整篇格式化；`ipc-handlers.ts`、`zh.ts` 本来就不干净，只核对了自己的 hunk。
- 标点扫描（scratchpad `t04-cjk-punct.py`，扫 diff 新增行）：中文行 0 处；5 处命中都是英文注释里引用「等你回复」「打开」的英文标点，属于误报。
- 测试覆盖：没收到 undelivered 时只有状态行，没有问题、候选、输入框；收到后画出完整提问与输入框（回答走的 `answerSubtask` 没改，`subtask-answer.test.ts` 照旧覆盖「送进子任务」）；`turn_start`、换问题、`dispatched` 叫醒都会清掉兜底，`pending` 与 `persisted_only` 不清；兜底只清叫醒行列名的子任务；回到在跑后不再画输入框。

#### 3. 第二节：别处答掉后，主对话里转述的提问怎么收尾（只查、没改）

先说机制，后面四条路径都靠它：

- runner 里没有阻塞等待可以取消。GA 的 `do_ask_user` 直接退出循环（`managed-ga/code/ga.py:353-358`），bridge 发 `AskUserEvent` 和 `run_complete` 后就空闲了（`runner/workbench_bridge.py:1560-1570`）；回答就是下一次 `put_task`，和普通消息唯一的区别是不带图（`workbench_bridge.py:1716-1737`）。
- 所谓「挂着」只有三处状态：Core 主对话的 `ask_pending`（`runner_manager/manager.rs:1127` 置位；只有往这个会话派发一条消息才清，`manager.rs:1008`；runner 关闭也不清，`manager.rs:859-877`）、页面的 `pendingAskUser`（`ipc-handlers.ts:661` 置位，`turn_start` 时清，`ipc-handlers.ts:607`），以及模型历史里最后那条提问。
- 子任务被答（任何路径）不会动主对话的这三处。

路径 1，卡片兜底态里答：对这一问本身，主对话里确实没有转述，因为叫醒没送到，不冲突。核实过的例外有两种：

- 竞态：`deliver` 在持闸时读现状（`subtask_report.rs:1268`），读完判定还在问，就写行、派发；如果你恰好在这之后、助理转述之前在卡片里答了，助理收到的就是一个已经答掉的问题，照样转述。窗口很小（一次 SQLite 写加一次派发），但助理那一轮多长，转述就晚多久。
- 叠加：如果没送到的原因是主对话正挂着「S 上一问的陈旧转述」（见路径 2），卡片兜底画的是新问题，主对话里那条旧转述还挂着，界面上一共两个问题。

路径 2，「打开」子任务，在它自己的对话里答：

1. GUI 的 Composer 走 `send_user_message`：S 在 `ask_pending`，排队检查直接放行（`queue.rs:66-69`），`answer=true`（`session_send.rs:238`），作为 `AskUserResponse` 派发（`session_send.rs:316`），不升级（`:280`）；S 的 `ask_pending` 清掉（`manager.rs:1008`）。主对话 M 的 `ask_pending` 不动，转述的提问一直挂着，页面上的气泡、候选、侧栏「等你回复：……」都在。
2. S 这一轮结束：`record_run_end` 新建一份汇报（`subtask_report.rs:1138-1160`，key 换了），`take_due` 发现 M 在 `ask_pending`（`:1226`），就退回：`announce_undelivered`，加上到点的提醒也一并退成通知（`:1227-1236`）。页面上：完成跑满 2 分钟就补发「子任务完成」，出错补发「子任务出错」，又问了就补发「子任务在问你」，按本票还会在卡片里兜底。汇报留在 Core 内存里等，不再重报。
3. 你在主对话里说的下一句：`answer=true`，作为旧问题的回答派发（`session_send.rs:238`、`:316`）。这句不开新段（`:247`；`segment.rs:125` 在 `ask_pending` 时也不开），带图片会被拒（`:239-243`，`images_not_allowed`）。模型在自己的提问后面读到这句，大概率当回答，用 `session send S "<你那句>"` 转给 S。
4. 这次转发：S 在跑时被排队（`session_cmds.rs:104-107`），S 那一轮结束后作为新消息派发，S 被这句话再跑一轮；按 `count_send_backs`（`db/subtask.rs:135-156`），前一行不是 `ask_user`，所以记作一次打回，卡片会出现「第 2 轮」，打回上限也被吃掉一次。如果 S 正在问新问题 Q2，按 galley#30 的规则这条会直接成为 Q2 的回答（`queue.rs:66-69`）。
5. 这一轮跑完、M 不再 `ask_pending`，等着的汇报才送到（`message_queue.rs:257` 到 `deliver`）。

路径 3，CLI 或别的 supervisor 往 S `session send`：

- 排队检查放行（S 在 `ask_pending`），`send_now` 发的是 `UserMessage`（`session_cmds.rs:236`），GA 照样当回答；`via: cli` 不升级。
- 后续与路径 2 第 2 到 5 步相同。
- 特例是助理自己 `session send`：正常流程里那时你已经在 M 里答了，M 不在 `ask_pending`，没有收尾问题。

路径 4，手机（远程模块）：

- 手机看不到没升级的子任务：列表过滤掉（`remote/methods.rs:214-215`、`remote/convert.rs:63-66`），它们的事件也不转发（`remote/events.rs:12-14`、`:397-403`），`subtask-report-undelivered` 不在转发清单里。
- 所以手机只能答 M 里的转述，这是正常流程，不冲突。
- 但叫醒没送到时，手机上完全看不到这个问题（没有卡片兜底），留给 iOS 界面开工时定。
- 协议层，知道 id 的话可以直接 `session.send` 给 S（`managed_session` 只查运行时，`methods.rs:186-200`），走 Core 的 `send_user_message`，后果同路径 2。现在没有界面会这么做。

「发叫醒前重读现状，问题已被你在卡片上答掉的丢掉」：实现在 `deliver` 持闸后调用的 `still_due` 与 `is_still_due`（`subtask_report.rs:1268`、`:1419-1485`）。

- 丢弃条件：主对话换了；S 升级或已删除（`:1471-1475`）；S 又在跑（`open_run`，`:1477`）；汇报是提问而 S 已不在 `ask_pending`（`:1480`）。另外同一子任务的新汇报会替换旧的（`:1001`）。
- 覆盖面：四条路径都覆盖，因为它们都经过往 S 派发，都会清 S 的 `ask_pending`。但只覆盖「汇报还在 Core 里等」的那段，也就是送达之前。
- 送达之后什么都不重读：从读现状到助理转述的窗口（路径 1 的竞态），以及转述之后（路径 2、3 的全部后果），都没人管。

修法（外置运行时都是零影响：外置没有主对话，`report_for_run_end` 只报当前主对话的子任务与内置运行时里定时任务开的会话，`subtask_report.rs:804-812`、`:859-862`）：

- **A（推荐）Core 在子任务的提问被别处答掉时，替主对话收尾。**
  - 记关联：一次带着 S 的「在问」汇报送达的叫醒，它开的那一轮以 `ask_user` 结束（M `ask_pending`），就在内存里记 M 在替 S 问（做法同 `in_flight`）。M 任何一次派发都清掉这条关联。
  - 触发：只放在一个漏斗里，即 `send_command_via` 在 `ask_pending` 下开闸那一处（`manager.rs:1001-1011`），给 drain task 发一个新信号。卡片、打开 S、CLI、手机、队列全覆盖。
  - 收尾：drain task 发现关联还在、M 仍在 `ask_pending`，就造一份新的汇报（「你替 S 问用户的问题已在子任务里答了：<回答>；用户不欠你回答，别再问；以 `<no-reply/>` 结尾」），绕过 `take_due` 的 `ask_pending` 关卡立即送达。这条消息说的正是那个问题，不存在被误当回答的问题。
  - 效果：M 开闸，`ask_pending` 清掉；页面在 `turn_start` 时清掉主对话的提问气泡；这一轮按现有规则不出声；之后的汇报与提醒照常送达；你的下一句不再被当回答。
  - 界面小改：那条转述的回显标「已在子任务里回答」。现在它后面跟的是看不见的叫醒行，回显不勾候选，也不说为什么。
  - 要改的层：Core（`subtask_report`、`runner_manager` 一个信号、`message_queue` 的 drain）与 GUI；runner 不用改（见上面的机制）；叫醒文案多一种，在票 30 的评测范围内。
  - 代价：多一次主对话调用（同叫醒）。关联靠「叫醒轮以提问结束」这条确定式规则；助理那一轮若问的是别的事，收尾消息也只是告诉它子任务答了，它可以再问，新的提问照常挂起。
- **B（更小）下一份汇报穿过陈旧提问送达。**
  - `take_due` 遇到 M 在 `ask_pending` 时（`subtask_report.rs:1226`），若 M 的提问是 S 某一问的转述、而等着的是 S 更新的汇报，就不退回，照送，汇报前加一段「你替它问的那个问题已在子任务里答了，别再等用户回答」。
  - 只改 `subtask_report`，不需要新信号。
  - 缺点：陈旧提问一直挂到 S 这一轮跑完（可能几分钟），这期间你的下一句仍被当回答，路径 2 的第 3、4 步照旧会发生，提醒也照旧退成通知。
- **C（只改界面）主对话转述期间，子任务自己的对话不让答，或把主对话那条提问标成「已在别处回答」。**
  - 纯 GUI。但 CLI 和 Supervisor 照样能答：Core 不能拒，`session send` 是 Agent API 公共契约（宪法 Rule 3）。
  - M 的 `ask_pending` 不清，叫醒照样堵，下一句照样当回答；「标已答」也不告诉模型。
  - 只能当 A 的界面那一半。

需要 Rust 实验验证（由主会话安排）：

1. 复现路径 2：助理用 `ask_user` 转述后，在 S 里直接答。看 `galley session status M` 的 `askPending` 是否一直为 true；S 跑完后 Core 日志有没有 `[subtask-report M] not delivered: S`；在 M 里随便说一句，是否以 `AskUserResponse` 派发；这一轮之后等着的汇报是否送达。
2. 助理把你那句当回答转给 S 时：S 在跑，CLI 是否返回 `queued`，S 跑完后是否作为新消息再跑一轮，`sendBacks` 是否加 1；S 正在问 Q2 时，这条是否直接成为 Q2 的回答。
3. 子任务的 `ask_user` runner 事件与 `subtask-report-undelivered` 到达页面的先后。本票两种顺序都容错，确认实际是不是先 `ask_user`。
4. 路径 1 的竞态：用慢模型，在叫醒派发后、助理转述前于卡片作答，看是否仍转述。
5. `deliver` 写行成功、派发失败（`persisted_only`）后，那条叫醒行会不会随 M 的历史重放进模型上下文，让模型以后又提起一个已经答掉的问题。
6. M 的 runner 被 LRU 回收或崩溃时，若 `ask_pending` 为 true：它是否一直留着（`queue_take_next` 在 `Closed` 时不清），叫醒是否一直堵到你在 M 里说话。

#### 4. 需要维护者在 dev 里看的点

- 子任务刚问、助理还没转述时：卡片只有「等你回复」那一行（琥珀色），侧栏与顶栏写「子任务在问你」，持续整个叫醒那一轮，看能不能接受。
- 兜底：在主对话的提问挂着时（让 Galley 先用 `ask_user` 问你一件事，不答），派一个会提问的子任务，卡片应画出完整的提问与输入框；在卡片里答完回到在跑。
- 兜底之后先答主对话的问题：主对话跑完后等着的汇报送到，卡片应回到只写状态，助理在主对话里转述。

#### 5. 票外发现（只报，没修）

- Galley 重启后，在子任务里答它恢复出来的提问会让子任务升级进侧栏：Core 的队列状态只在内存（`runner_manager/queue.rs` 头注释），重启后 S 的 `ask_pending` 为 false，`send_user_message` 把这条当普通消息，`!answer` 时升级（`session_send.rs:280-289`）。同理，主对话恢复出来的提问在重启后作答时会按普通消息走，可能开新段（`session_send.rs:247`），模型就看不到自己刚才的问题了。
- 主对话在 `ask_pending` 时，到点的提醒会立即退成通知并消耗掉，不再重试（`subtask_report.rs:1227-1236`）。如果那是一条陈旧转述，提醒就因为它而没有经过助理。修法 A 顺带解决。
- 叫醒文案对「在问」只说「ask the user in a sentence」（`subtask_report.rs:565-586`），没要求用 `ask_user`。助理若用普通一句话转述，M 不会 `ask_pending`，Core 层没有这个问题，但你之后在 M 里的回答照样会被它转给一个已经答掉的 S。
