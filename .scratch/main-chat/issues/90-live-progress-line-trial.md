# 90 在跑时的进展：临时切换器（现状 / 新）

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 134（2026-10-23；JC：「1，卡片用『正在工作…』；2，按你推荐，先试试 S1；3，按你推荐」）。只改 GUI，做一个临时切换器给 JC 真机比；定档、拆切换器与改设计文档另开一张票，这张不改设计文档。

## 为什么

- v0.7.0 的用户反馈：主对话跑一个耗时的活（没派子任务）时，用户只看到对话末尾的三点气泡和侧栏卡片上一直挂着的「正在输入…」，没注意顶栏身份行第二行那句进展，以为软件卡死了，等了好几分钟。
- 原因是位置：用户的眼睛在对话末尾，顶栏那句在左上角、11px、只在一步做完时换。所以进展挪到三点气泡下面，顶栏在跑时不再说进展，卡片换词并只替屏上说看不到的那部分。

## 要做的

只在「新」档生效；「现状」档与改前逐字节一致。范围只是**主对话**（`MainView` 的 `isMainChat`）里**你发起的一轮**（不是叫醒的一轮，判定同三点气泡：`lib/subtasks.ts` 的 `inReportRound`，`lib/assistant-conversation.ts` 里的 `cachedReportRound`）。

### 1. 对话里：三点气泡下面一行小字

- **何时在**：与三点气泡同进同出（`typingBubbleShown` 为真、且不是叫醒的一轮）。从发出那一刻起就在，没有门槛。它在问你时三点不画，这一行也不画。
- **放在哪**：`TypingBubble` 根节点里、气泡下面，左缘与气泡左缘对齐，上间距 6px。放在同一个根节点里，贴底跟随（`useStickyScroll`、`assistantFollowTop`）把它当成这一行的一部分；它恒为一行高，换字不改高度。
- **写法**：`{在做什么} · {用时}`。12px，`text-ink-soft`，`tabular-nums`，不扫光、不加动画。在做什么那段 `min-w-0` 渐隐截断（照顶栏身份行的做法：`truncate-fade` + `truncationFadeRef`，悬停 `syncTruncatedTitle` 给全文）；` · ` 与用时 `shrink-0`，永远不截。
- **在做什么**（这一轮的「这一段」：从你最后一条消息起，你答完它的提问则从答完起；同 `assistantSettledSentence` 的取段）：
  1. 这一段里还没有任何一步出现过工具派发：写「思考中」。
  2. 当前这一步的流（`inFlightContent`）里已出现工具派发标记（`gui/src/lib/ipc/ga-output-cleaning.ts` 的 `modelReplyEnd(...) !== -1`），且派发之前有一个闭合的 `<summary>…</summary>`（不在没闭合的 `<thinking>` 里）：写这个 summary 的后半句（规则见下）。
  3. 否则，这一段里最新一个调了工具的已落定步（`turn.role === "agent"`、不是收口的回答 `isFinalAnswerTurn`、`turn.summary` 可用）：写它的 summary 的后半句。即两步之间留着上一句，落定后与流里读到的是同一句、不跳。
  4. 当前这一步正在写字（`assistantWriting(inFlightContent)` 为真）时，以上都让位，写「正在写回复」。写字停下、出现派发，按第 2 条换句。
  - 没有派发就不换句：收口那一步（只有 summary 与回复、没有工具）的 summary 永远不上屏，回复的结论不会先被剧透。
  - **后半句**：summary 先照 `assistantSummaryLine` 同一套清洗（`cleanSessionSummary` 那一路；`isProtocolFailureSummary` 的不算，当作没有）；按**最后一个**「；」或「;」切开取后面那段，去掉首尾空白和结尾的「。」「.」；没有分隔就用整句；切出来是空的也用整句。不再往下截（例如不按逗号截），长了交给 CSS 截断。
  - 例（库里真实 summary）：「提醒规则已确认；我读取当前时间并检查是否已有喝水提醒。」→「我读取当前时间并检查是否已有喝水提醒」；「我先核对当前时间和提醒命令，设置三分钟后的喝水提醒。」→ 整句去掉句号。
  - 派发标记、`<summary>` 在流里的样子以 `ga-output-cleaning.ts` 现有的判定与测试夹具为准；不同模型、原生工具调用与 GA 文本协议两种流都要对。若发现某种流里 summary 在派发之后才出现或根本不在 `inFlightContent` 里，退到第 3 条（落定后才换），并在回报里写明是哪种。
- **用时**：这一轮开跑起的整秒，各段相加、等你回答的时间不算，取法与工作台右下角计时 `RunElapsedHud` 完全一样（`MainView` 里的开跑时刻与 `liveRunElapsedBaseMs(turns)`），格式也一样：60 秒以内 `copy.conversation.seconds`（「12 秒」），以上 `minutesSeconds`（「1 分 12 秒」）。不到 1 秒时只写在做什么、不带「 · 用时」。每秒更新只重渲染这一行；渲染期不读 `Date.now()`（React 编译器 lint），照 `RunElapsedHud` 用计时器写状态。
- **读屏**：三点的根节点是 `role="status"`（礼貌朗读）。每秒跳的用时不能在朗读区里（`aria-hidden`，或把这一行放到朗读区外再单独处理在做什么），否则读屏每秒播一次；在做什么换句时可以朗读。
- **交接**：回复或它的提问落地、三点让位时（`hooks/useTypingBubbleHandoff.ts`、`lib/typing-bubble-handoff.ts`），这一行与三个点的拷贝一样在原位淡出（同一时长、同一曲线），不进版面；回复照旧从三点气泡的框撑开，几何不变。停止、出错时与三点一起直接消失。

### 2. 顶栏

在跑（`AssistantState.kind === "running"`）时身份行没有第二行（`line` 为 null），与静止时一样。等你回复、出错、子任务在问你或出错照旧。不改优先级：在跑时子任务的状态原来就被在跑盖住，现在照旧不显示。

### 3. 侧栏卡片

只改你发起的一轮在跑时的第二行（`lib/assistant.ts` 的 `assistantCardLine` 的 running 分支）；叫醒的一轮照旧（它写字时「正在输入…」，否则最后一句）。

| | 主对话在屏上（卡片现有的 `open`） | 不在屏上 |
|---|---|---|
| 它在写字（`assistantWriting`） | 正在工作… | 正在输入… |
| 其余，不满 1 分钟 | 正在工作… | 正在工作… |
| 其余，满 1 分钟 | 正在工作… | 正在工作 · N 分钟（N 为整分钟，向下取整） |

- 「在屏上」用卡片现有的 `open`（`SidebarAssistant.tsx:198`：主对话本身开着、它的对话在屏上）。与 `lib/todo-open.ts` 的 `mainChatOnScreen` 对一下，口径不一致（例如设置页盖着时）就在回报里写明，不要自己改 `open` 的定义。
- 分钟数用同一个用时来源，只在跨整分钟时更新卡片，不按秒重渲染。
- 色调同现在的 running（brand）。头像那张脸不动。

### 4. 文案（新键，zh / en 逐字）

- 卡片：「正在工作…」/ `Working…`
- 卡片满 1 分钟：「正在工作 · {n} 分钟」/ `Working · {n} min`
- 小字开头：「思考中」/ `Thinking`
- 小字写字时：「正在写回复」/ `Writing the reply`
- 用时沿用 `conversation.seconds` / `conversation.minutesSeconds`，分隔符「 · 」。

键放在 `assistant` 命名空间（`typing` 旁边），名字你定。

### 5. 切换器的壳

照票 85 的 pill（`git show 13092922 -- gui/src/components/todo/todo-variants/TodoVariantsPill.tsx`，票 86 已拆掉：常驻可点击，portal 到 `<body>`、`pointer-events: auto`，只在 dev 构建出现，两处判 `import.meta.env.DEV`，选择只记在内存里，默认「现状」）。档名写死：「临时 · 在跑」「现状」「新」。位置照票 85（窗口水平居中、顶栏下 52px）。切档要能在一轮跑着的时候即时生效（JC 会在同一轮里来回切比）。拆法写在新的变体文件头（删哪些、接入点在哪、定「新」后保留哪几行、定「现状」后删哪几行），每个接入点标「TEMP variant switcher (main chat 90)」。

## 测试

- **现状逐字不变**：改代码前先记快照（三点气泡在跑时的 DOM、顶栏身份行在跑时、卡片在跑时开着与没开着），改完在「现状」档逐字比。现有 `MainView.assistant.test.tsx`、`Sidebar.main-chat.test.tsx`、`MainHeader.identity.test.tsx`、`assistant.test.ts`、`assistant-conversation.test.ts`、`useAssistantSentence.test.ts` 不改断言、照旧全过。
- **后半句**：有「；」、有「;」、两个分号取最后一个、没有分隔、结尾句号、切出来为空、协议失败的 summary、清洗后为空。
- **在做什么**（纯函数，给 turns 与 `inFlightContent`）：开头「思考中」；流里派发出现后换成流里那个 summary；派发前 summary 已闭合但还没派发时不换；两步之间留上一句；落定后与流里那句相同；写字时「正在写回复」；收口那一步的 summary 永远不出现；答完提问回到「思考中」；叫醒的一轮不画。原生工具调用与 GA 文本协议两种流各至少一例（夹具照 `ga-output-cleaning` 的测试）。
- **用时**：不到 1 秒不带用时；59 秒「59 秒」、60 秒「1 分 0 秒」（与 `RunElapsedHud` 一致）；有答完的提问时各段相加。
- **卡片**：上表六格；叫醒的一轮照旧。
- **顶栏**：「新」档在跑时无第二行，等你回复、出错照旧。
- **读屏**：用时不在 `role="status"` 的朗读区里。
- **pill** 只在 DEV；标记只出现在拆法列出的文件里。
- 时间相关的测试在 `TZ=UTC` 下也跑一遍（CI 跑在 UTC）。

## 别动

- 主工作树：只在 `/Users/inkstone/Documents/genericagent-webui-wt90`（分支 `ticket-90-live-progress-line`，从本地 main 起）里做，不碰主树，不跑 `tauri dev`。
- 工作台对话、从助手点开的子任务、外置运行时：逐像素不变（它们不走 `isMainChat`）。工作台的 `RunElapsedHud`、思考行不动。
- 三点气泡本身的样子与交接几何（票 51、55、58）；过程卡片；回复的行动条；头像的脸。
- `core/`、`runner/`、`managed-ga/`、提示词、手册；设计文档（定档票改）。
- `gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk，新文件可整篇格式化。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都报错；工具函数别从组件文件导出。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test` 全过；`TZ=UTC pnpm --dir gui test` 全过
- `git diff --check`

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. 「在做什么」的判定函数与后半句函数的 diff 原样。
3. 小字的 JSX 与交接改动的 diff 原样。
4. 卡片 running 分支的 diff 原样。
5. 两种流（原生工具调用 / GA 文本协议）里 summary 与派发标记的先后，各贴一段夹具。
6. `open` 与 `mainChatOnScreen` 的口径对比结论。
7. 拆法（文件头那段原样）。
8. 验证命令与结果原样。
9. 看到但没改的问题、没验证到的地方。

## 给 JC 的真机步骤

1. 合入后（纯 GUI，热更新），在 Galley 里问一个要查网页的问题（例如「新赛季 NBA 东部你怎么预测？」，本机这类约 70–110 秒）。
2. pill 在「现状」「新」之间来回切，同一轮里比：三点下面那一行读不读得进、会不会读成工作台的日志、换句的节奏吵不吵、用时跳着焦不焦虑；顶栏空着时找不找得到「它在干嘛」。
3. 跑着的时候切去工作台或设置，看卡片：「正在工作…」，满 1 分钟「正在工作 · 1 分钟」；回到 Galley 看卡片是不是一直「正在工作…」。
4. 再让它记一件事（「明天下午三点提醒我交报告」），看短回合里那一行与回复交接时的样子。浅色、深色各看一遍。
5. 定「新」或「现状」告诉我；定档票按那一档写死、拆切换器、改设计文档。

## Comments
