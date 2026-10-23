# 91 在跑时的进展定「新」：写死、拆切换器、改设计文档

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 135（2026-10-23；JC 真机比完票 90：「选『新』，体验会好很多」）。只改 GUI 与设计文档。

## 为什么

票 90 做了临时切换器（现状 / 新）。JC 定「新」：主对话在跑时，对话里三点气泡下面一行「{在做什么} · {用时}」，顶栏身份行在跑时没有第二行，侧栏卡片写「正在工作…」（不在屏上时它写字写「正在输入…」，满 1 分钟起「正在工作 · N 分钟」）。这张票把「新」写成唯一画法，拆掉切换器和现状那一档，删掉已经没人读的顶栏那句，并把设计文档改成定稿。

## 要做的

1. **照拆法做**：`gui/src/components/conversation/live-progress-variants/live-progress-variants.ts` 文件头写着完整拆法（「Removal, after the ruling」一段，按「新 wins」那一列）。要点：
   - 删整个 `live-progress-variants/` 目录（含 pill、两份测试、快照）；`App.tsx` 里 pill 的 import 与那一行；`MainView`、`AssistantIdentity`、`SidebarAssistant` 里的 `useLiveProgressVariant`。
   - 删测试前先把「新」要留的测试挪走：pill 测试里交接那一半挪到 `useTypingBubbleHandoff` 旁边；`live-progress-variants.test.tsx` 里「新」的 describe 挪进 `MainView.assistant`、`MainHeader.identity`、`Sidebar.main-chat` 三处，这三处原来断言现状的地方改成新的说法（顶栏在跑时无第二行、卡片「正在工作…」、三点下面有那一行）。
   - 表里「新 wins: keep」那一列全部留下，去掉 `TEMP variant switcher (main chat 90)` 标记；`MainView` 的 `progressDoing` 不再判档：`typingShown ? assistantDoing(…) : null`。
   - 拆完 `grep -rn "main chat 90" gui/src` 为空。
2. **删顶栏那句**（拆法最后一段）：`assistantSettledSentence`、`assistantCachedSettledSentence`、`useAssistantSettledSentence`、`useAssistantState` 的 `header`、`AssistantStateInput.sentence`、`assistantState` 里 running 分支的文字。删之前 `grep` 确认没有别处在读（过程卡片、IM、CLI 若有读到就别删，回报里写明）。running 时 `AssistantState.line` 直接为 null，`AssistantIdentity` 里不再需要 `quiet` 判断。相关测试跟着删或改。
3. **注释跟上**：`lib/assistant.ts`、`lib/assistant-conversation.ts`（文件头「process」那一段：顶栏写那句、卡片「正在输入…」都改成现在的分工）、`TypingBubble.tsx`、`AssistantIdentity.tsx`、`SidebarAssistant.tsx`、`useAssistantSentence.ts`、`useAssistantState.ts`、`lib/assistant-progress.ts`、`hooks/useAssistantProgress.ts` 里描述在跑时分工的注释改成定稿说法，引用裁决 134、135；不再提「切换器」「现状档」。
4. **设计文档改成定稿**：
   - `docs/design/conversation.md`「助手的对话」里「在跑时：三点气泡」一节：三样东西分在三处 → 两处（对话里三点加一行，卡片），顶栏在跑时留空。写清那一行的规则（写法、在做什么的四条优先级与后半句的切法、用时、叫醒的一轮不画、读屏、交接时随三点淡出）、卡片的表、为什么（裁决 134 第 1、2 条的理由，简述）、历史（10-19 起顶栏写那句不计时，10-23 用户反馈后挪进对话，裁决 134、135，票 90、91）、已知代价（裁决 135 第 3 条三点）。原来「顶栏写做完的那一步的那句话」「卡片写『正在输入…』」两小节改写，不留旧规则当现行。该节开头那段历史概述里「顶栏第二行是做完的那一步的那句话」也改。同文件里其他提到在跑时顶栏那句的地方（`grep -n "顶栏" docs/design/conversation.md` 逐条看）一并对齐。
   - `docs/design/layout-and-chrome.md` §4.1「开着助手时是身份行」：在跑时第二行留空，顶栏只说要你处理的状态；§4.2「助手卡片」：在跑时的第二行按卡片的表。
   - 文档是中文，标点一律全角；引用代码用反引号。

## 别动

- 主工作树：只在你的 worktree 里做（路径在派单里），不碰主树，不跑 `tauri dev`。
- 「新」的行为：那一行、卡片、交接的现有实现与测试断言不改（只挪位置、去标记）。
- 工作台对话、从助手点开的子任务、外置运行时；三点气泡本身与交接几何；过程卡片。
- `core/`、`runner/`、`managed-ga/`、提示词、手册；`.scratch/` 下的 PRD（主会话维护）。
- `gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk，新文件可整篇格式化。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都报错；工具函数别从组件文件导出。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；删文件用 `git rm <文件…>`。提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- `grep -rn "main chat 90\|useLiveProgressVariant\|LiveProgressVariant" gui/src` 为空
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint` 通过
- `CI=true pnpm --dir gui test` 与 `TZ=UTC CI=true pnpm --dir gui test` 全过
- `git diff --check`

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 删掉的文件与符号清单；第 2 条每个符号删之前 `grep` 的结果。
3. 挪走的测试：从哪到哪、几条。
4. 两份设计文档改动的 diff 原样。
5. 验证命令与结果原样。
6. 看到但没改的问题、没验证到的地方。

## Comments
