# 47 回复行动条加「引用」；运行中那一行没有旁白时用 summary

Status: done（2026-10-19 JC 真机：行动条五个按钮、整条引用、运行中那一行跟着步骤 summary 走及其口吻，通过。裁决 99、100；2026-10-19 快进合入 main，提交 `3a887520`；JC 在 dev 里看行动条五个按钮、整条引用、运行中那一行跟着步骤的 summary 走及其口吻）

来源：主聊天 PRD 裁决 99、100（2026-10-19 JC 真机走查票 38 与喝水提醒时提出）。依赖 38（已合入，`ab4b0783`）。只改 GUI 与设计文档；Core、runner、提示词不动。

## 一、回复的行动条加「引用」（裁决 99）

- 助手的对话里，回复下的行动条（`gui/src/components/conversation/MessageActions.tsx`，`assistant` 分支）变成：**复制 · 引用 · 保存 · 过程 · ⋯**。过程照旧只在两步以上的回复出现；`processOnly`（漏出工具调用标记、没东西可复制）时也不出引用。
- 引用按钮做的事与消息菜单里的「引用」**完全相同**：整条放进输入框上方的引用条，长的截断（`wholeMessageQuote`，见 `lib/message-menu.ts` 与 `docs/design/conversation.md`「消息菜单」的「引用整条」）。共用同一个动作，不另写一份。
- 外观照行动条现有的 chip（`ActionChip`：24px、14px thin 图标、`tabIndex={-1}`）；图标用 Phosphor `Quotes`（菜单与选区浮动工具条已用它）；提示与读屏名复用现有的「引用」文案，不新增 i18n 键（真需要新键就中英各加，写理由）。点了之后要不要闪对勾：引用条出现、光标进输入框本身就是回执，**不闪对勾**；如果你认为需要，写理由。
- 工作台的行动条不变。你的气泡照旧不加悬停按钮（裁决 73）。
- 菜单的项与顺序不变（复制、引用、保存、展开过程 ── 删除）。

## 二、运行中那一行没有旁白时用 summary（裁决 100）

- `gui/src/lib/assistant-conversation.ts` 的 `assistantLineSentence`（约第 140–158 行）：现在正在流出的第一行优先，否则从最新一步往回找第一条有旁白（`finalAnswer ?? preamble`）的步。改为：从最新一步往回找第一个**有字**的步，这一步旁白优先，没有旁白就用这一步的 `summary`（同样取第一行，走 `assistantFirstLine` 或等价的清洗）。正在流出的第一行照旧最优先。
- 效果：模型每步只写 summary 时，那一行跟着步骤走（「本机时间为10月19日10:34；先检查是否已有喝水提醒，避免重复。」）；第 1 步写了旁白、第 2 步只写 summary 时，那一行换成第 2 步的 summary，不停在旧旁白上。
- 查清 `assistantLineSentence` 的所有调用方（主区那一行、侧栏卡片等）与它的缓存（`sentenceCache`），确认 summary 变化能刷新。顶栏按裁决 87 在跑时只写「思考中」，不动。
- summary 里可能带的标记、换行按现有清洗处理；如果发现 summary 需要额外清洗（比如带 `<summary>` 标签残留），写清楚怎么处理的。
- 诊断依据（T02，2026-10-19）：那一行只读旁白是裁决 68 第 4 条的设计；10-19 喝水那轮四个工具步只有 summary，整轮显示「思考中」。

## 三、文档

- `docs/design/conversation.md`：行动条那几处（约第 116 行「行动条照旧在回复下面…里面只有图标：复制、保存…」、第 124 行、「消息菜单」一节提到行动条的地方、「Message Actions」一节助手对话的说明）写成新的五个按钮与顺序，引用裁决 99。
- 同文件里描述运行中那一行取字规则、以及「summary 是 agent 的工作记忆，不写给读者」（约第 123 行附近）的地方，改成裁决 100 的规则，写明部分推翻裁决 68 第 4 条的理由。
- 代码注释里描述这两处规则的（`MessageActions.tsx` 顶部注释、`assistant-conversation.ts`）同步改。
- **不要改** `.scratch/main-chat/PRD.md`（裁决已由主会话写好）。

## 验收

- `pnpm --dir gui install --frozen-lockfile`（worktree 里没有 node_modules）后跑：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、全量 gui 测试两遍（本机时区与 `TZ=UTC`）、`git diff --check`、`.github/workflows/check.yml` 里的门禁脚本、`node scripts/check-docs-links.mjs`、中文标点扫新增行。
- 测试：
  - 行动条：助手对话下按钮顺序为复制、引用、保存、（过程）、⋯；`processOnly` 没有引用；工作台没有引用；点引用走与菜单同一个动作。
  - `assistantLineSentence`：最新一步只有 summary → 用 summary；最新一步有旁白 → 用旁白；前一步有旁白、最新一步只有 summary → 用最新一步的 summary；正在流出的第一行最优先；遇到用户消息就停（不越过你最后一条消息）。

## Comments

### 2026-10-19 实现回报（子代理）

worktree：`.claude/worktrees/agent-ac01e0d260a659044`，分支 `worktree-agent-ac01e0d260a659044`（基于 `bd28de72`）。未提交。本票文件在主工作树里还没提交，worktree 里原本没有，是照主工作树的版本复制进来再追加本节的。

**1. 改动文件**

- `gui/src/components/conversation/MessageMenu.tsx`：新增 `MessageQuoteButton`，行动条上的「引用」chip，点击跑菜单自己的那一项。
- `gui/src/components/conversation/MessageActions.tsx`：助手行动条在复制与保存之间放引用；顶部注释与 props 注释改成五个按钮。
- `gui/src/lib/assistant-conversation.ts`：`assistantLineSentence` 改为裁决 100 的规则，新增私有 `assistantSummaryLine`；模块注释、缓存注释同步。
- `gui/src/components/screens/MainView.tsx`、`gui/src/lib/assistant.ts`、`gui/src/lib/message-menu.ts`、`gui/src/components/conversation/MessageAgent.tsx`：只改注释，描述新规则或行动条的引用。
- `gui/src/lib/assistant-conversation.test.ts`：新增 7 个用例，覆盖裁决 100 的各条规则。
- `gui/src/hooks/useAssistantSentence.test.ts`：新增 1 个用例，经 `dispatchIPCEvent` 走 turn_end，确认卡片的句子随只写 summary 的一步刷新（缓存）。
- `gui/src/components/conversation/MessageActions.test.tsx`：助手行动条的用例改为套上菜单 wiring（真实情况），断言新顺序；工作台在有菜单的对话里也没有引用。
- `gui/src/components/conversation/Conversation.quote.test.tsx`（新）：点引用走菜单同一动作。
- `docs/design/conversation.md`：行动条、过程一行、落定后、泄漏标记、消息菜单（项、引用整条）、「不用 `AgentTurn.summary`」、Message Actions（说明、表格加 `Quote` 行、复制入口统一、选区引用）、问候的行动条。
- `docs/design/layout-and-chrome.md`：助手卡片「在跑时说什么」照新规则改（它描述的是同一个 `assistantLineSentence`，不改就和代码对不上）。

**2. 实现要点**

- **引用按钮复用菜单动作**：`MessageQuoteButton` 读与「⋯」同一个 `MessageMenuContext`，只在 `wiring.has(messageId)` 时出现（与「⋯」同条件：只有主对话、MainView 接上了 `messageMenu`）；点击是 `wiring.model(messageId)?.onSelect("quote")`，也就是 Conversation 里菜单的 `onSelect` 分支：`messageMenuTarget` 的 `quoteText`（`wholeMessageQuote(answer, true)`）交给 `messageMenu.onQuote` → `composerRef.current?.quote`。没有另写一份取字、截断或入口。`MessageActions` 只在 `assistant && messageId && !processOnly` 时放它，位置在复制之后、保存之前；工作台的 `MessageActions` 没有 `assistant`，不出。模型在点击时才建（`model()` 要算删除分组等），渲染时只问便宜的 `has`。
- **`assistantLineSentence` 新规则**：正在流出的第一行照旧最优先；否则从最新一步往回，遇到用户消息就停，每个助手步先取 `assistantFirstLine(finalAnswer ?? preamble)`，没有再取 `assistantSummaryLine(summary)`，第一个有字的步就返回。
- **调用方**：① `MainView` 的 `lineSentence`（主区那一行，`useMemo` 依赖 `turns`、`visiblePartial`）；② `assistantCachedSentence` → `selectAssistantSentence` → `useAssistantSentence` → `useAssistantState`（侧栏助手卡片；顶栏传 `open=true`，按裁决 87 只写「思考中」，不读这句，未改）。`lib/assistant.ts` 只在注释里提到。
- **缓存刷新**：`sentenceCache` 以 `turns` 数组的引用和原始流为键。summary 随 turn_end 进来（`turnFromTurnEnd` → `buildAgentTurn`），`appendAgentTurn` 生成新数组；读回走 `rowsToTurns`，也是新数组。store 里没有原地补写 summary 的路径（`stores/messages.ts` 里没有给 turn 改 summary 的写法），所以新 summary 必然让缓存失效。新用例经真实的 `dispatchIPCEvent` 验证：第 1 步有旁白时卡片说旁白，第 2 步只写 summary 时换成第 2 步的 summary。
- **summary 的清洗**：与旁白同一套 `assistantFirstLine`（取第一行，去块记号，`cleanSessionSummary` 去协议标签、旧「第 N 步 · 」前缀、markdown 记号，GA 的 `...` 省略换成「…」）。查了来源：GA 的 `turn_end_callback` 取的是 `<summary>` 里面的字、去掉换行再 `smart_format`（`managed-ga/code/ga.py:571-577`），runner 再过一遍 `_clean_turn_summary`（`runner/workbench_bridge.py:183`），所以不会有 `<summary>` 标签残留。额外加了一条：回合协议错误的 summary（runner 的固定标记「回合协议错误：工具调用未能送达」，或开头就是 `<invoke` / `<parameter` 的旧行）用 `isProtocolFailureSummary` 挡掉，当作这一步没有字，否则那一行会出现未本地化的标记或清洗后剩下的参数碎片。

**3. 票面留给我定的点**

- **不闪对勾**：照票面。引用条出现、光标进输入框就是回执；对勾在这一族里是复制、保存的「已完成」，引用不是一次性产出。
- **不新增 i18n 键**：提示与读屏名用现有的 `copy.conversation.quoteSelection`（「引用」/「Quote」），菜单与选区浮动工具条用的就是它。
- **图标**：Phosphor `Quotes` 14px thin，与选区工具条的引用 chip 同一参数（菜单里是 13px，菜单项本来就比 chip 小一号）。
- **layout-and-chrome.md 也改了**：票面只点名 conversation.md，但助手卡片「在跑时说什么」描述的是同一个函数，旧文会与代码矛盾。
- **顺手改的两处过时说法**（就在我改的段落里）：conversation.md「在跑时」那段原写「侧栏的助手卡片与顶栏身份行在跑时说的就是这一句」，裁决 87 之后顶栏与开着主对话时的卡片只写「思考中」，改成照实写；`assistant-conversation.ts` 模块注释同一句同样改了。

**4. 验证**

- `pnpm --dir gui install --frozen-lockfile`：成功。
- `pnpm --dir gui typecheck`：通过。
- `pnpm --dir gui lint`：通过（0 warning）。
- `pnpm --dir gui test`（本机时区）：167 个文件、1747 个用例全过。
- `TZ=UTC pnpm --dir gui test`：167 个文件、1747 个用例全过。
- 新用例先在旧规则上跑过一遍：裁决 100 新增的 8 个里 5 个按预期失败（其余 3 个是旁白优先、流出优先、遇到用户消息就停，旧规则下本来就成立，留作护栏），换回新规则全过。
- `check.yml` 的六个门禁：`check-ipc-protocol-drift`、`check-supervisor-sop-drift`、`check-docs-links`（449 个文件 OK）、`check-version-consistency`、`check-managed-ga-payload`、`check-ga-baseline-drift` 全部通过。文档链接检查不验锚点，新加的 `#hover-tooltip-的内容契约` 已对照标题手核。
- `git diff --check`：干净；新文件无行尾空白、有结尾换行。
- prettier：新文件整篇格式化；旧文件只修了自己的 hunk（`MessageActions.tsx` 里 `AnswerTelemetry` 的签名本来就不是 prettier 格式，没动）。
- 全角标点：自写脚本扫了 diff 新增行与新文件，命中的 18 处都是 markdown 链接的括号或英文注释里的英文标点，中文正文没有半角标点。

**5. 维护者 dev 里看的点**

- 主对话一条回复悬停：顺序是复制、引用、保存、（两步以上的回复才有过程）、⋯；引用与其他 chip 同大小、同墨色。
- 点引用：引用条出现、光标进输入框，长回复截断加「…」，与 ⋯ 菜单里的「引用」结果一样；同一条连点不重复，满 3 段弹提示。
- 只有泄漏工具调用标记的回复：行动条只有过程与 ⋯。工作台的回复：只有复制、保存和数字。
- 让它跑一个多步、不写旁白的任务（比如建喝水提醒）：那一行跟着每一步的 summary 走，不再整轮「思考中」；切到工作台看侧栏助手卡片说的是同一句；顶栏照旧只写「思考中」。
- summary 的口吻读起来是否可接受（裁决 100 第 3 条的代价），不行再上切换器。

**6. worktree 与分支**

`.claude/worktrees/agent-ac01e0d260a659044`，分支 `worktree-agent-ac01e0d260a659044`。

**7. 票外发现（只报不修）**

- 只有图片、没有字的回复（`![](…)`）：`wholeMessageQuote` 去掉图片后是空的，菜单里不出「引用」，可行动条上的引用照条件（有 wiring、不是 processOnly）仍会出现，点了不做事。很少见；要精确就得在渲染时建菜单模型或把取字挪出来，没做。
- `assistantCachedSentence` 的注释仍写「the sidebar card and the header say it…so all three say one sentence (ruling 68)」，裁决 87 之后顶栏不读这句（`useAssistantState` 只在 `!open` 时读，顶栏总是 `open`）。不在本票改的段落里，没动。
- `MessageActions.tsx` 的 `AnswerTelemetry` 函数签名不是 prettier 格式（旧有）。

#### 返工（2026-10-19，主会话验收后）

主会话把上面票外第 1、2 条定为本票的事，在同一个 worktree 里改，仍未提交。

**1. 引用按钮的出现条件与菜单的「引用」用同一个判定**

- `lib/message-menu.ts`：把菜单取字的逻辑拆成两个函数。
  - `bubbleText`（私有）：复制取的字，三个分支照旧：你的话、它的提问、回复或问候，泄漏标记不算。
  - `messageQuoteText(turns, plan, index)`（导出）：`wholeMessageQuote(bubbleText…) || null`。
  - `messageMenuTarget` 的 `quoteText` 改为直接调 `messageQuoteText`，菜单行为不变（原有菜单用例全过）。
- 新增 `canQuoteMessage(turns, plan, index)`：`isMenuBubble && messageQuoteText !== null`。它与「`messageMenuTarget` 非空、且条目里有 quote」等价：`deletableAt` 的门就是 `isMenuBubble`，菜单的条目只看 `quoteText !== null`。
- `MessageMenuWiring` 加 `canQuote(messageId)`，`Conversation` 用 `canQuoteMessage` 实现；`MessageQuoteButton` 改为只看 `wiring.canQuote`。`MessageMenuButton`（⋯）照旧看 `has`，没动。
- **为什么选 wiring 暴露 canQuote，不在 `MessageActions` 里对 `source` 跑 `wholeMessageQuote`**：后者要在组件里重抄菜单的另外几条（答案为空、泄漏标记、这一行算提问还是回复、你的话按纯文本而回复按 markdown）。菜单哪天改规则，按钮就会漂。现在按钮与菜单都只经过 `messageQuoteText` 这一个函数，改一处两边一起变。
- **渲染期不建菜单模型**：`canQuote` 只做 `isMenuBubble`（与 `has` 同价）加 `messageQuoteText`。后者按 turn 对象缓存在模块级 `WeakMap` 里（键是 turn，值记着这一行是否按提问取字）。
  - 为什么要缓存：主区每个流式 chunk 都会让 `Conversation` 重渲染，wiring 是新对象，每条回复的按钮都会重问一次。有缓存后，每条回复的 markdown 只读一次。
  - 为什么按 turn 缓存是安全的：turn 不会原地改。全仓唯一的赋值是 `agent-turn.ts:194`，在 `buildAgentTurn` 构造期间；`withoutHiddenTurns` 也保留原对象。
- **测试**（新增 4 个用例）：
  - `lib/message-menu.test.ts` +2：只有图片的回复，菜单是「复制、保存 ── 删除」（没有引用），`canQuote` 为 false；另一个用例逐条气泡对比 `canQuote` 与菜单条目里有没有 quote，覆盖问候、你的话、提问、步、有过程的回复、图片回复、泄漏标记回复，并重复问一次验证缓存。
  - `MessageActions.test.tsx` +1：wiring 的 `canQuote` 为 false 时，行动条是复制、保存、⋯。
  - `Conversation.quote.test.tsx` +1：整段对话里加一条只有图片的回复，三条回复三个保存、只有两个引用；同一条的菜单目标没有 quote 条目，`quoteText` 为 null。
  - 先把按钮的判定临时换回 `has` 跑过：后两个新用例按预期失败；换回 `canQuote` 后全过。

**2. `assistantCachedSentence` 的注释改成与裁决 87 一致**

现在写：主对话不在屏上时，侧栏卡片说这一句，与主区那一行同一句（裁决 68）；顶栏与开着主对话时的卡片只写「思考中」、不来取（裁决 87；`useAssistantState` 只在主对话没开着时读，顶栏算开着，`AssistantIdentity` 传 `open: true`）。缓存那段的「卡片与顶栏读同一对」也改成只有卡片的选择器。

**文档**：`conversation.md` 行动条一节与 Message Actions 表格的 `Quote` 行，写明按钮只在菜单有「引用」时出现、同一个判定，并写明只有图片的回复两边都没有。

**验证**

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`：通过。
- `pnpm --dir gui test`：167 个文件、1751 个用例全过；`TZ=UTC` 再跑一遍，同样 1751 全过（比上次多 4 个）。
- `git diff --check`：干净。`node scripts/check-docs-links.mjs`：449 个文件 OK。
- prettier：改过的文件里只有 `Conversation.tsx` 报格式，两处都是旧行（第 215、446 行附近），不是我的 hunk。
- 标点扫描：新增命中都是英文注释、测试名里的英文标点，或 markdown 链接的括号。

**还剩的票外（只报不修）**

- `hooks/useAssistantSentence.ts` 的注释仍写「for the sidebar card and the header (ruling 68)」，`useAssistantSentence.test.ts` 的 describe 名「the card's and the header's sentence」也是同一个过时说法（裁决 87 之后顶栏不读）。
