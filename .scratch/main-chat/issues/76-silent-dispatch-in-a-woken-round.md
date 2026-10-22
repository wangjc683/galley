# 76 叫醒的那一轮只派了子任务：对话里什么都不画

Status: needs-dogfood（2026-10-22 合入 `598c0402`；主会话机器验收：rebase 到 main 后 `pnpm --dir gui typecheck`、`lint`、`git diff --check` 通过，`TZ=UTC` vitest 197 个文件 2084 条全过；代理另在洛杉矶时区跑过全量。代理用只读库核对过 10-21 21:27 那一轮：改前三行平铺，改后整段不画）

来源：[主聊天 PRD](../PRD.md) 裁决 125 第 1 条（2026-10-22，JC 真机走查票 75 第 2 步：「巡看触发后开始显示进度调用轮次，而不是在顶栏，这和主对话的设计有问题」；主会话推荐 A，JC：「按你推荐，开始修巡看功能」）。只改 GUI。依赖票 73、75（已合入）。

## 为什么

票 73 起，巡看只派了子任务、还没有结果时，模型的回复是子任务标签加 `<no-reply/>`（`docs/managed-ga-runtime/galley-assistant-manual/wake.md:71`、Core 巡看叫醒措辞）。2026-10-21 21:27 真机上模型照做了（库里主对话 turn 33：`<subtask>…</subtask>\n<no-reply/>`，`tool_calls` 只有 `no_tool`，`final_answer` 为空）。

界面这边：

- `isSilentReply`（`gui/src/lib/ipc/ga-output-cleaning.ts:58-65`）排除带 `<subtask>` 的回复，10-16 票 29/31 的测试写明「派了活的，卡片必须显示」（`gui/src/stores/messages/rowsToTurns.test.ts:405`、`gui/src/lib/ipc/ga-output-cleaning.test.ts:239`）。
- 不算静默，剥完标签又没有正文，就不是收尾的一步（`gui/src/lib/run-groups.ts:179-184`）。这一轮既没答完也不静默，跑完后 `assistantLinePlan` 走 `flat` 分支，按工作台样式平铺：01、02、03 三步带「运行代码」，子任务卡挂在第 3 步下（主会话截了 JC 的窗口）。
- 同一个原因，静默的叫醒轮本该压掉的未读标记、通知没压住（`gui/src/lib/ipc-handlers.ts:444-455`）。

裁决 A：被叫醒的那一轮（开头是 Core 写的 `galley-report` 行：子任务回报、巡看都是）只派了子任务、以 `<no-reply/>` 收尾时，对话里什么都不画。子任务只在待办面板「Galley 在办」里出现（已经有了），回来时那一轮叫醒照常开口交代。这推翻了 10-16「派了活的，卡片必须显示」在叫醒轮里的那一半；用户自己发起的那一轮不动。

## 要做的

1. **判定**：叫醒轮里，收尾回复带 `<no-reply/>`、剥掉标签后没有正文时，算静默，不管有没有 `<subtask>` 标签。具体落在 `isSilentReply` 还是 `isSilentReport` 一层，你按代码定；要求是下面每条都成立，并且用户自己发起的那一轮画法、通知与现在逐一相同（`<subtask>` 回复照旧挂卡片；裸的 `<no-reply/>` 照旧当「只有标签的回复」）。改之前先把 `silent`、`isSilentReply`、`isSilentReport`、`endsInSilentReport`、`hiddenReportTurns` 的全部使用处列出来，回报里附上。
2. **跑完以后**：这一轮的步骤、子任务卡都不画（它问用户的问题与用户的回答照旧画，同现有静默轮规则）；不留未读标记、不发通知、上一条回复的下一步建议照旧留着；侧栏助理卡片的最后一条消息跳过它；它不算时间分隔（`userTimeMarks` 的 `skip`）。
3. **跑的过程中**：照现有叫醒轮规则，顶栏第二行说最近一步的句子；打字气泡只在写字时出现。核对子任务标签流式输出时不会让「在写字」成立（`assistantWriting` 读的是 `cleanPartialContent`，看它对没收尾的 `<subtask>` 的处理），不成立就照现有清洗规则补上。
4. **子任务卡**：核对这一轮派出的子任务卡在对话里任何地方都不出现（`useSubtaskDispatchesByMessage` 按回复的 message id 挂卡，静默回复不画，卡也就没有落脚处；确认不会挂到别的回复下面）。核对待办面板「Galley 在办」那一行能不能点开子任务，能不能都只回报，不改。
5. **注释与测试**：`ga-output-cleaning.ts:49-56` 的注释、`types/conversation.ts:304-311` 的 `silent` 注释、`lib/subtasks.ts` 静默轮注释跟着改；上面两处「卡片必须显示」的测试改成新规则，并补：
   - 用真实形状的行（叫醒行 `created_via: system`、`supervisor: galley-report`；两步 `code_run`；收尾 `<subtask>…</subtask>\n<no-reply/>`、`no_tool`、`final_answer: null`、带 `summary`）经 `rowsToTurns` 到 `assistantLinePlan`，这一轮什么都不画；
   - 实时路径：同样内容的 `turn_end` 不发通知、不标未读；
   - 用户自己发起的一轮，回复是 `<subtask>…</subtask>` 加或不加 `<no-reply/>`，画法与改前相同。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- `core/`、`runner/`、`cli/`、`managed-ga/`、手册、评测脚本。Core 的搜索已经排除剥完为空的 `<no-reply/>` 回复（`core/src/db/search.rs:8-13`），不用动。
- 待办面板、子任务卡本身的样子。
- `gui/` 不是 prettier-clean：新文件可以整篇格式化，旧文件只格式化你改的 hunk。
- 提交只点名文件，`git add … && git commit …`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`。
- `pnpm --dir gui test`（vitest 全量），在 `TZ=UTC` 和 `TZ=America/Los_Angeles` 下各跑一遍。
- 中文全角标点。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 第 1 条要求的使用处清单，以及判定落在哪一层、为什么。
3. 改动的 diff 摘要（判定、画法、注释），新测试的名字。
4. 验证命令与结果原样。
5. 看到但没改的问题、没验证到的地方（含第 4 条面板那一行能不能点开）。

## 给 JC 的真机步骤

1. 合入后 dev 热更。打开主对话，滚到 10-21 21:27「把早上那个巡看现在跑一次」那里：「已触发这次巡看……」下面那三步（01、02、03 和挂着的子任务卡）应当整段消失，下一条直接是 21:50 补上 NBA 预测的那条回复。
2. 再放一件做到一半的事，跟它说「把早上那个巡看现在跑一次」。只派出子任务时：跑的过程中顶栏第二行有句子在变，对话里什么都不出现；跑完不弹通知；待办面板「Galley 在办」多一行。子任务回来后，它开口交代。

## Comments

### 2026-10-22 实现回报（票 76 代理）

- **提交**（分支 `ticket-76-silent-dispatch`，未 push、未合入）：代码、测试与本回报在同一个提交里，号以 `git log` 为准。
- **改前的使用处**（行号是改前的）：
  - `isSilentReply`：定义 `gui/src/lib/ipc/ga-output-cleaning.ts:58`；只有两处调用，`gui/src/stores/messages/rowsToTurns.ts:98`（恢复）和 `gui/src/lib/ipc-handlers.ts:893`（`turnFromTurnEnd`，实时），结果交给 `buildAgentTurn`。
  - `silent` 字段：类型 `gui/src/types/conversation.ts:311`；写入只在 `gui/src/lib/agent-turn.ts:200-204`（没有答案、是收尾步才写）；读取只有两处，`gui/src/lib/subtasks.ts:599`（`isSilentReport`，先判 `isReportRound`）和 `gui/src/lib/ipc-handlers.ts:452`（`silentReport`，与 `inReportRound` 相与）。`MainView.tsx:497` 的 `silent: silentReport` 和 `typing-bubble-handoff.ts:57/80` 只是同名，值来自 `endsInSilentReport`。
  - `isSilentReport`：定义 `subtasks.ts:592`；调用 `subtasks.ts:611`（`endsInSilentReport`）、`subtasks.ts:642`（`hiddenReportTurns`）、`assistant-conversation.ts:419`（`assistantLinePlan`）。
  - `endsInSilentReport`：定义 `subtasks.ts:607`；调用 `MainView.tsx:443`（`silentReport`，再进 455 `roundSettled`、497 打字气泡交接、574 回到底部按钮的未读点）、`useAssistantFaceDriver.ts:202`（不演「done」）。
  - `hiddenReportTurns`：定义 `subtasks.ts:636`；调用 `assistant.ts:316`（`lastVisibleMessage`，侧栏助理卡片的最后一条）。
  - 时间分隔：`Conversation.tsx:277-289` 的 `reportSkip` 读 `assistantLinePlan` 的 `reports`，叫醒行在计划里没有条目就进 `skip`。
- **判定落在 `isSilentReply`**：去掉 `!text.includes(SUBTASK_OPEN)`，带 `<no-reply/>`、剥完标签没有正文就是静默回复，不管有没有 `<subtask>`。只在叫醒轮里起作用这一层不动，仍是 `isSilentReport`。理由三条：①`silent` 的读取只有上面两处，都先判是不是叫醒轮，所以用户自己发起的一轮多出 `silent: true` 也没有任何读者，画法、卡片、通知、未读都不变；②落在 `isSilentReport` 就得在那一层拿到原文，要给 `AgentTurn` 再加一个字段，沿 `buildAgentTurn`、`rowsToTurns`、`turnFromTurnEnd` 再接一遍，结果一样、面更大；③与 Core 的搜索一致（`core/src/db/search.rs:8-13`：答案为空、原文带 `no-reply` 的回复就排除，不管有没有子任务标签）。
- **diff 摘要**：
  - 判定：`ga-output-cleaning.ts` 的 `isSilentReply` 一行（见上）。
  - 画法：没有改画法代码。叫醒轮的收尾回复读成 `silent` 以后，`isSilentReport` 成立，现有静默轮规则自动接上：`assistantLinePlan` 不画它的步骤与回复（问用户的问题与回答照旧画），`hiddenReportTurns` 把整轮从侧栏卡片的最后一条里拿掉，`reports` 没有条目所以叫醒行进 `skip`，不算时间分隔；实时路径 `silentReport` 成立，不标未读、不发通知、不改下一步建议；`endsInSilentReport` 成立，回复落地就算这一轮结束，打字气泡不交接、回到底部按钮不点未读、助理的脸不演「done」。
  - 注释：`ga-output-cleaning.ts` 的 `isSilentReply`、`types/conversation.ts` 的 `silent`、`subtasks.ts` 的 `isSilentReport`、`ipc-handlers.ts` 的 `silentReport` 四处跟着改，写明裁决 125、票 76、推翻票 29/31 在叫醒轮里的那一半、子任务在「Galley 在办」、用户发起的一轮照旧挂卡。设计说明 `docs/design/conversation.md`「不出声的回复」一条同样补上（票面没列，它写的正是这条规则，不改就过期了）。
  - 测试改写：`ga-output-cleaning.test.ts` 原「is no silent reply without the tag, or with a dispatch」拆成「is no silent reply without the tag」（光有 `<subtask>` 不静默）和新的「is silent with the tag after a dispatch, unless words are left」；`rowsToTurns.test.ts` 那条改成派了活的也读成 `silent`。
  - 新测试（真实形状的行放在新文件 `gui/src/test/dispatch-round.ts`：叫醒行 `created_via: system`、`supervisor: galley-report`、`origin_note: sched_review`；两步 `code_run` 只写 summary；收尾 `<summary>…</summary>\n<subtask>…</subtask>\n<no-reply/>`、只有 `no_tool`、`final_answer: null`、带 `summary`；前面有一问一答）：
    - `assistant-conversation.test.ts`：「draws nothing of a woken round that only dispatched」（`rowsToTurns` → `assistantLinePlan`：只剩前面的一问一答，`flat`、`steps`、`reports` 都空，`hiddenReportTurns` 是整轮，侧栏卡片最后一条是前面那条回复）；「draws the user's own dispatch as before, with <no-reply/> or without」；「is never writing while a dispatch and its <no-reply/> stream」（收尾回复的每个前缀都不算在写字）。
    - `Conversation.assistant.test.tsx`：「draws nothing of a woken round that only dispatched: no steps, no card, no time」（`renderAfterAnswer` 按收尾行的 id 给卡片，叫醒轮一张都不出现）；「keeps the card under the user's own dispatch, with <no-reply/> or without」（两种回复渲染出的 HTML 逐字相同，卡片一张，挂在回复下面）。
    - `ipc-handlers.subtask.test.ts`：「says nothing when it only dispatched: no notification, no unread, the ghost suggestion stays」；「notifies the user's own dispatch as before (<no-reply/>: false / true)」。
    - `useAssistantSentence.test.ts`：「never shows in a woken round that only dispatched, and the round settles when the reply lands」（按事件逐拍放，标签被切成几段流进来，打字气泡一拍都不出现）；「says each step of a woken round that only dispatched, as of any woken round」（顶栏第二行：思考中 → 第 1 步 → 第 2 步 → 跑完只剩名字）。
  - 「用户那一轮与改前相同」的依据：把 `ga-output-cleaning.ts` 临时换回改前版本跑上面这些测试，正好 6 条失败（判定 2 条、叫醒轮 4 条），用户那一轮的 4 条（含 `it.each` 两条）在新旧规则下都过；跑完换回。
- **第 3 条核对**：`cleanPartialContent` 对子任务标签已经够用，没有补清洗规则。整段 `<subtask>…</subtask>` 由 `GA_TAG_PATTERNS` 去掉；没收尾的 `<subtask>` 在第 2 步从开标签处截断（`GA_TAG_NAMES` 有 `subtask`），所以 `</sub` 这种半截收尾也在截掉的部分里；`<sub` 这种半截开标签由第 3 步按 `PARTIAL_TAG_NAMES` 扣下；`<no-` 由 `NO_REPLY_PARTIAL` 扣下。`assistantWriting` 因此一直为假。
- **第 4 条核对**：子任务卡在对话里不会出现，也不会挂到别的回复下面。Core 只从这一轮运行的最终回复里读标签（`core/src/subtask.rs` 模块注释「Which replies」），派发记录的 `messageId` 就是这条静默的收尾行；`useSubtaskDispatchesByMessage` 按 `messageId` 分组；`Conversation.tsx` 只在画出来的 agent 行上调 `afterAnswer(turn.messageId)`（改前 583、628、641、730 行），没有退到别的回复的分支。面板那一行：按代码能点开。`todoRowTarget` 对子任务返回 `{ kind: "subtask", sessionId }`（`assistant-todo.ts:349`），`todoTitleTarget` 原样放行（`todo-panel.ts:309`），标题是按钮（`TodoPanel.tsx:378`），`goToTodoTarget` 打开那个会话，面板跟着开（`todo-open.ts:116`）。没在真机上点。
- **用真机库核对过**（只读，`sqlite3 -readonly`，结果没写进任何提交的文件）：主对话 10-21 21:27 那一轮，turn 31 是 `galley-report` 叫醒行（`origin_note` 是巡看的 `sched_…`），turn 31、32 两步，turn 33 原文以 `</subtask>\n<no-reply/>` 结尾、`tool_calls` 只有 `no_tool`、`final_answer` 为空。把 turn 28–40 的行喂给 `rowsToTurns` → `assistantLinePlan`（临时测试，跑完删掉）：改前 31、32、33 三行进 `flat`，叫醒行有时间条目；改后三行都不画、叫醒行没有条目，下一条画出来的是 turn 36 那条补上 NBA 预测的回复。跟真机步骤 1 说的一致。

### 看到但没改、没验证到的

1. 助理的脸照旧会动：叫醒轮开始时按 `wakeKind` 演「wakeReminder」（巡看的 `sched_…` 算提醒，`useAssistantFaceDriver.ts:193`），Core 的派发记录一到就演「dispatch」（同文件 267 行）。不发通知、不标未读，但早上 9 点侧栏那张脸会有一下反应。票 65 的规则，裁决 125 没提，没动；要「巡看完全无感」得另开一票。
2. `<no-reply/>` 只出现在 `<subtask>…</subtask>` 指令里面、外面没有自己的标签时，也会读成静默。与 Core 搜索的 `LIKE '%no-reply%'` 一致，没再收窄；模型在给子任务的指令里写这个标签的可能很小。
3. 派发失败（标签没收尾、会话起不来）的叫醒轮也一样什么都不画，「没开始」那张卡也看不到；Core 会为没起来的标签再叫醒一次（`core/src/subtask.rs` 模块注释「Reports」），由那一轮开口。没用真模型验过那一轮怎么说。
4. 测试夹具 `gui/src/test/dispatch-round.ts` 的内容是编的（船票），只借了真机那一轮的形状。
5. 没跑 `tauri dev`，没在真机上看；真机步骤 2（再触发一次巡看）要 JC 做。
