# 76 叫醒的那一轮只派了子任务：对话里什么都不画

Status: ready-for-agent

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
