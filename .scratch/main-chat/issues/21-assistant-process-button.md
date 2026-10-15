# 21 助手回复的过程按钮：步数、用时、token 收进展开区，卡片与顶栏说主区那一句

Status: done（2026-10-15 合入 main，`dfd43968`–`294c27cc`；同日 JC 真机验收通过：图标留 `Footprints`，按下态与气泡同底、顶栏与主区同屏说同一句都照现状）

来源：主聊天 PRD 裁决 68（2026-10-15，JC：「按你推荐和建议推进」）。依赖 20。只改 GUI，不碰 Rust。

## 目标

助手的回复下面平时什么都不常显；鼠标移上去出现复制、保存、过程三个图标。点过程，在下面展开这一轮的步骤，展开区第一行写步数、用时与 token。上下文百分比在助手的对话里不画。助手在跑时，侧栏卡片和顶栏说的是主区那一行的同一句话。

工作台的会话、从助手点开的子任务、外置运行时，与本票开工时的 main 逐像素一致。

## 一、行动条与过程按钮

- **现状**：`AssistantRunEntry`（`gui/src/components/conversation/AssistantParts.tsx`）作为 `MessageActions` 的 `leading` 常显在行动条最前面；复制、保存与 token、上下文（`AnswerTelemetry`）悬停才出现。
- **改成**：助手的回复，行动条里只有图标：复制、保存，两步以上的回复再加一个「过程」，放在最后。三个同一族（`ActionChip` 的尺寸、墨色、悬停底、`tabIndex={-1}`）。行动条里不再有任何数字。
- **过程按钮**：
  - 悬停提示用现有的 `foldExpand`「展开过程」/ `foldCollapse`「收起过程」，不加新文案，不带数字。
  - 展开时呈按下态，做法你定（比如常显 `bg-hover` 底并提墨）；不要换成对勾，对勾是复制、保存的「已完成」。`aria-expanded` 照旧。
  - 展开期间整条行动条常显（同「已复制」闪现期间保持可见的做法），收起后回到悬停才出现。
  - 图标默认 `Footprints`。另出一张对照图：同一条回复的悬停行，`Footprints` 与 `ListChecks` 各一张（浅、深），给 JC 真机验收时选。
- **一步就答完的回复**：只有复制、保存，与今天一样什么都不常显。
- **版面**：行动条隐藏时照旧保留占位（opacity），分组间距（`assistantRowGap`）与回复下面那 30px 不变；前后各量一次，写进 Comments。
- **键盘**：今天的入口能 Tab 到、Enter / Space 展开；行动条的 chip 是 `tabIndex={-1}`（06-29 指针优先规则）。过程按钮跟 chip 走，这点损失写进 Comments。确认 ⌥↑ / ⌥↓ 跳转不受影响。

## 二、展开区的第一行

- 展开后，步骤区最上面一行写这一轮的概括：「4 步 · 用时 45 秒 · ↑33k ↓1.1k」。
  - 步数、用时的文字与今天的入口相同（`foldSteps`、`foldDurationSeconds` / `foldDurationMinutes`）；字 `ink-muted`、数字 `ink-soft`，字号同今天的入口（`--conversation-step-size`）。
  - ↑ ↓ 用 `AnswerTelemetry` 现有的 `Metric` 与它们的悬停说明（含缓存的拆分照旧）；上下文的 `Gauge` 不画。
  - 用时缺（某段没有 telemetry）时照今天的规则只写步数；token 缺就不写那一段。
- 这一行不可点、没有悬停底、不画 caret。放在竖线（rail）上面还是与步骤同一缩进，你定，以读起来是「这一区的头」为准；截图里要有。
- 展开 / 收起的动画照旧（`ExpandSection`）；展开区与行动条之间的间距重新量，写进 Comments。

## 三、上下文与 token

- 助手的对话里，回复下面任何地方都不画上下文百分比；token 只在展开区第一行出现。
- 工作台的回复照旧：行动条悬停出现复制、保存 | ↑ ↓ 与上下文。不带助手参数时 `MessageActions` 的输出最好逐字节不变。
- `MessageActions` 的 `leading` 参数若不再有人用就删掉；新加的参数按助手的叫法起名。

## 四、卡片与顶栏在跑时说同一句

- `assistantState`（`gui/src/lib/assistant.ts`，`input.status === "running"` 那一段）在跑时不再用 `lastStepIndex` 与 `summary`，改用主区那一行同一个函数 `assistantLineSentence(turns, visiblePartial)` 的结果，没有就写 `copy.sidebar.thinking`「思考中」。
- `useAssistantState` 从消息缓存里取主对话的 turns 与 `inFlightContent`（主对话启动就打开，裁决 65 卡片的「最后一句」就是这么取的）。先确认主对话不在屏上时 `appendAgentTurn` / `appendInFlightDelta` 照样写进它的缓存，写进 Comments。
- **性能**：`inFlightContent` 每个 chunk 都变。卡片和顶栏不能跟着每个 chunk 重渲染：选择器只返回那句话的字符串（相同就不更新），`cleanPartialContent` 只在需要时算。做法写进 Comments，量一下流式时卡片渲染多少次。
- 取句的边角与主区一致：你答完它的提问后回到「思考中」。优先级照裁决 65 第 3 条（出错 > 在问你 > 在跑 > 草稿 > 最后一句），在问你时不显示这句。
- 截断、shimmer、品牌色照今天卡片与顶栏在跑时的样式。
- **不动**：子任务卡片里的「第 N 步」（`gui/src/lib/subtasks.ts`）、工作台会话行（`SidebarSessionRow`）的「第 N 步 · 摘要」、`copy.sidebar.stepSummary` 文案（工作台还在用）。
- `assistant.ts` 头部那张表（running「第 N 步 · 摘要」）与 `AssistantIdentity.tsx` 的注释跟着改。

## 五、文档

- `docs/design/conversation.md`「助手的对话」一节：行动条（三个图标、过程按钮的按下态、展开期间常显）、过程（入口改为按钮、展开区第一行）、上下文不画与 token 的位置，各写理由（引裁决 68）。写着入口「常显」的几处改掉；「Message Actions」一节里指向助手的那句跟着改。
- 写着助手卡片与顶栏在跑状态的段落（`docs/design/layout-and-chrome.md` 等，grep「第 N 步」「思考中」，中英两种写法都搜）改成「主区那一行的同一句」，并写清子任务卡片与工作台会话行照旧。
- `MessageActions.tsx` 头部注释与 `AnswerTelemetry` 的注释：加一句助手的对话不走这条（数字在展开区）。
- 不写 devlog（主会话写），不改 PRD，不改各票的 Status 行。

## 不做

- 删过程入口；一步的回复也给入口。
- 工作台、子任务、外置运行时的任何变化；子任务卡片的步数。
- 新文案键（过程按钮用现有的展开 / 收起过程；确实需要新键时先停下来，在 Comments 里说明）。
- 手机端；输入框；回复字体。

## 验收

- 跑这几项：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`TZ=UTC pnpm --dir gui test`，再用 `TZ=America/Los_Angeles` 全量跑一遍；`git diff --check`；全角标点自查（扫新增行）。gui 只格式化自己改的 hunk，新文件可以整篇格式化。
- **测试**至少覆盖：
  - 助手的回复：平时行动条里没有数字；两步以上有过程按钮、一步的没有；展开后第一行有步数、用时、↑ ↓，没有上下文；展开时过程按钮按下、行动条常显；提问与回答照旧留在外面、展开区里不重复。
  - 工作台的回复照旧有 ↑ ↓ 与上下文。
  - 卡片与顶栏：在跑时说主区那一行的句子；流出的第一行优先；没有就「思考中」；答完提问回到「思考中」；不再出现「第 N 步」；子任务卡片与工作台会话行仍有「第 N 步」。
- **反向检查**：改坏几处，确认测试会挂；恢复后逐字节一致。例如：行动条里又出现步数、助手的回复画了上下文、一步的回复出了过程按钮、展开区第一行丢了 token、卡片又写「第 N 步」、工作台的回复丢了上下文。
- **逐像素**：工作台的会话、子任务、外置运行时，与开工时的 main 比，静止、在跑、在问你，浅色与深色，要全部一致。
- **自查截图**（Chrome harness，可以复用上一个会话草稿目录里 `s20/harness/`、`s20/shoot/` 的脚本，复制到新目录再改，不进仓库）：
  - 回复静止（行动条不可见）、悬停（三个图标）、展开（按下态、第一行、步骤）、一步的回复悬停；
  - 卡片与顶栏在跑：思考中、有旁白、流出中，各一张，与主区那一行同屏；
  - 图标对照：`Footprints` / `ListChecks`，浅与深；
  - 浅色与深色、中英文；出总览图。截完把 harness 从工作树删掉。
- **JC 在 tauri dev 里走一遍**：
  1. 打开助手，看旧回复下面什么都不常显；
  2. 鼠标移到一条多步的回复上，看三个图标，停在过程上看提示；
  3. 点过程，看展开区第一行与按下态；鼠标移开行动条还在，再点收起；
  4. 发一句要查一会儿的话，看侧栏卡片、顶栏与主区那一行说的是同一句；
  5. 打开一个工作台会话和一个子任务，看 token、上下文与「第 N 步」都还在；
  6. 两个图标里挑一个。

## Comments

2026-10-15 实现（子代理，分支 `assistant-process-21`，基于 `7015474f`，未合入）：

提交：`dfd43968` 代码与测试；`52ad0791` 设计文档；本条记录随后单独提交。

**一、行动条与过程按钮**

- `MessageActions` 的 `leading` 删掉，换成按助手叫法起名的 `assistant?: { process?, processOnly? }`。不带它就是工作台的行动条（复制、保存 | ↑ ↓ 与上下文），输出与 `7015474f` 逐字节一致（见「验证」）。`MessageAgent` 的 `leading` 改为 `process`，`bubble` 时把 `assistant` 交给行动条；`AgentTurnView` 的 `entry` 改为 `process`；`AssistantRunEntry` 删掉。类型 `AssistantProcessToggle` 放在 `lib/assistant-conversation.ts`。
- 过程按钮就是一个 `ActionChip`：给它加了 `expanded`（`aria-expanded` 与按下态），复制、保存不传，输出不变。所以尺寸、墨色、悬停底、`tabIndex={-1}`、按下的 1px 位移都与复制、保存同一族，测试里比的是 class 整串相同。图标 `Footprints`（14px thin），悬停提示用现有的 `foldExpand`「展开过程」/ `foldCollapse`「收起过程」，没有新文案键。
- **按下态（我定）**：常显 `bg-hover` 底，墨提到 `ink`（静息 `ink-muted`，悬停 `ink-soft` 加 `bg-hover`）。实测浅色底 `rgb(240, 240, 240)`、字 `rgb(33, 31, 28)`。理由：底用悬停的那一档，读作「按住了」；墨比悬停再高一档，鼠标在别处时也和「只是悬停」分得开；不换对勾。可能的问题：浅色下这块底与它的气泡底同值（都是 `#F0F0F0`），像气泡色的一小块，真机看。
- 展开期间整条行动条常显：隐藏条件里加 `!process?.open`，与「已复制」闪现同一处；收起后回到悬停才出现。
- **版面**：前后各量一次（1480 窗口，演示对话的 9 条回复，`7015474f` 对本票）：气泡下 6px、行动条高 24px、回复到下一条 30px，带子任务卡片的那条 172.8px，前后完全一样；隐藏时照旧 `opacity` 占位。
- **键盘**：原来的入口是 `role="button"`、`tabIndex={0}`，能 Tab 到、回车 / 空格展开；过程按钮跟 chip 走（06-29 指针优先规则），键盘到不了，按票接受。⌥↑ / ⌥↓ 在 harness 里试过：点开过程后按 ⌥↑ 两次、⌥↓ 一次，滚动位置 2161 → 1525 → 2161，与 `7015474f` 点开入口后完全一样；点完焦点回到 body（chip 的 `preventMouseFocus` 与 `blurAfterClick`），`7015474f` 的入口点完焦点留在入口上。
- 补了一处票里没写的：回复只剩泄漏的工具调用标记（#22 的说明框）时，没有可复制、保存的东西，悬停行里只有过程按钮（`processOnly`）。票 20 是把入口常显在说明框下面。

**二、展开区的第一行**

- `AssistantRunSummary`（`AssistantParts.tsx` 内部组件）：「4 步 · 用时 45 秒 · ↑33k ↓1.1k」。步数、用时用 `foldSteps`、`foldDurationSeconds` / `foldDurationMinutes`；↑ ↓ 用新抽出来的 `TokenMetrics`：`AnswerTelemetry` 里原来那两个 `Metric` 和它们的悬停说明（含缓存拆分），工作台的 `AnswerTelemetry` 改为调用它，输出逐字节不变；`Metric` 加了 `valueClassName`，第一行用它把数字提一档。
- 墨色：字 `ink-muted`、数字 `ink-soft`，字号 `--conversation-step-size`，一行 24px（原入口的高）。token 数整个算数字（「33k」连 k 一起 `ink-soft`），没有按位拆，「1.1k」拆成三截读起来碎。用时缺时照折叠头的规则只写步数；token 缺就不写那一段（演示里有提问的那一轮，提问那一段没有 token，于是只写「4 步 · 用时 45 秒」）。
- 不可点、没有悬停底、没有 caret、不可选中（同折叠头），不是 `role="button"`。
- **位置（我定）：在竖线上面**，左缘与气泡左缘对齐（x = 0，原入口文字的位置），竖线（x = 5）从它下面 2px 挂下来（`StepRegion` 的 `railFrom="header"`），第一步在它下面 12px。理由：这就是工作台折叠头到第一步的几何（折叠头的 `mb-2.5` 加区里的 `-mt-5.5`，头到第一步 12px，竖线从头下面接下来），读起来是「这一区的头」；放进步骤的缩进，会被竖线并进明细。x = 5 恰好是复制图标的左缘，竖线与上面那排图标对齐。截图见总览 `02`。
- **间距（重新量）**：行动条底到第一行 4px（`ExpandSection` 的 `mt-1`，收起时 0，跟着行一起动画），第一行 24px，到第一步 12px，竖线顶在第一行下面 2px。票 20 是入口到第一步 8px。展开 / 收起的动画照旧。

**三、上下文与 token**：助手的回复下面哪里都不画上下文（行动条只在不带 `assistant` 时画 `AnswerTelemetry`）；token 只在展开区第一行。工作台照旧，测试里两边都比了。

**四、卡片与顶栏在跑时说同一句**

- `assistantState` 的输入去掉 `lastStepIndex`、`summary`，加 `sentence`；在跑时写 `sentence`，没有就写 `copy.sidebar.thinking`。优先级不动（出错 > 在问你 > 在跑 > 草稿 > 最后一句），在问你时照旧写「等你回复：……」。`copy.sidebar.stepSummary`、`lib/subtasks.ts`、`SidebarSessionRow` 没动。`assistant.ts` 头部那张表与 `AssistantIdentity.tsx` 的注释跟着改了。
- `useAssistantState` 取 `useAssistantSentence(mainChat.id, running)`。它放在单独的 `hooks/useAssistantSentence.ts`：静态渲染读不到 store 塞的值，侧栏与顶栏的测试要 `vi.mock` 它，同模块内部调用 mock 不到。选择器 `selectAssistantSentence`：不在跑直接返回 null，不看流；在跑时调 `assistantCachedSentence(turns, inFlightContent)`。
- `assistantCachedSentence`（`lib/assistant-conversation.ts`）：照 MainView 清洗流（`cleanPartialContent(...).trim()`），再交给主区那一行同一个 `assistantLineSentence`，边角一致：流出的第一行优先，没有就是你最后一条消息之后最新一步的旁白，答完提问回到「思考中」。
- **性能做法**：选择器只返回那句话的字符串，相同就不更新（`useSyncExternalStore` 按 `Object.is` 比）；清洗只在在跑时做，并按（turns 引用，流字符串）缓存最近一对。zustand 的选择器在每次 store 写入时都跑（任何会话的写入、每个 chunk），卡片和顶栏读的是同一对，所以每个 chunk 清洗一次，别的会话的写入不清洗。测试数过 `cleanPartialContent` 的调用次数。
- **流式时的渲染次数（实测）**：harness 里在 React 加载前装一个替身 DevTools hook，每次提交时看组件的 hooks 链是不是换成了新对象，换了才算真渲染（只看 `PerformedWork` 标记会把 React 跳过的子树也算进去）。流 33 个 chunk（第一行分 3 个 chunk 流完，后面 30 个是正文），40ms 一个：
  - 本票、开着助手：卡片 3 次、顶栏 3 次，就是第一行长出来的那三次，后面 30 个 chunk 一次都没有；作对照的 `MainViewContent` 34 次。一步落地时卡片、顶栏各 1 次。
  - 本票、开着工作台会话：卡片 3 次，一步落地 1 次。
  - `7015474f`：流的时候卡片、顶栏 0 次（那时它们不读流），一步落地各 1 次。
  多出来的渲染就是句子真的变了的那几次。代价：第一行还在长的时候，卡片第二行的轻跳（`sidebar-step-tick`，换字时 key 变了重挂）会跟着跳；GA 一个 chunk 约 50 字，第一行多半一两个 chunk 就完。真机嫌闪的廉价出口：在跑时 key 不带句子。
- **主对话不在屏上时缓存照样写入**（确认过）：`lib/ipc-handlers.ts` 的 `turn_end` 调 `appendAgentTurn(event.sessionId, …)`，`turn_progress` 调 `appendInFlightDelta(event.sessionId, …)`，都按事件的会话写，不看哪个会话开着；`patchMessages` 遇到没有条目的会话就新建；切换会话不清别的会话的缓存（`clearSessionMessages` 只在删除时用）。`useAssistantSentence.test.ts` 最后一条照这个测：开着别的会话，派发主对话的 `turn_end` 与 `turn_progress`，选择器读到旁白与流出的第一行，开着的那个会话什么都没收到。harness 里开着工作台会话时，卡片也跟着流换句（总览 `03` 第三、四行）。
- 截断、渐隐、品牌色、轻跳照今天（同一个组件，只换了字）。顶栏与主区那一行同屏说同一句，真机看嫌不嫌重（退路是顶栏在跑时只写「思考中」）。

**五、文档**（`52ad0791`）：`docs/design/conversation.md`「助手的对话」写了行动条只有图标、过程按钮（同一族、图标二选一、提示词、按下态、展开期间常显）、展开区第一行（内容、墨色、位置与量得的间距）、为什么是按钮、键盘的损失、泄漏标记那一种，另起「上下文与 token」一条，各引裁决 68；「Turn 结构」与「Message Actions」两处指向、写着入口常显的几处、子任务卡片表格的在跑一格都跟着改。`docs/design/layout-and-chrome.md`：身份行在跑时那句、卡片第二行的优先级、新加「在跑时说什么」（同一个函数、理由、子任务卡片与工作台会话行照旧）、「数据只在界面里取」加上那一句的来源与性能、会话行的 running 那条注明这是工作台的。中英两种写法都搜过（第 N 步、思考中、Step N、stepSummary、lastStepIndex），别的设计文档没有写助手在跑的段落。`MessageActions.tsx` 头部注释与 `AnswerTelemetry` 的注释各加一段：助手的对话不走这条。没写 devlog，没改 PRD 与各票的 Status。

**验证**

- typecheck、lint、`git diff --check` 通过；`TZ=UTC` 与 `TZ=America/Los_Angeles` 各全量一遍，126 个文件、1224 条全过（`7015474f` 是 124 / 1211；新文件 `MessageActions.test.tsx`、`useAssistantSentence.test.ts`）。
- 全角扫描（扫新增行，CJK 紧邻半角 `,;:!?()` 就报，先用坏例子自测能报出来）：文档 0 处；代码 7 处，都是英文注释或英文测试标题里引用的「……」后面跟着英文标点，属英文句子，不改。
- 测试覆盖：
  - `Conversation.assistant.test.tsx`：静止时每条回复的行动条都隐藏占位、全篇没有步数、用时、↑ ↓、上下文；两步以上的有过程按钮且排在复制、保存之后，一步的只有复制、保存；全展开后第一行有步数、用时、↑ ↓（悬停说明）、数字提一档、没有上下文，在竖线上面，缺 token 的那轮只写步数与用时；提问与回答照旧在外面、展开区不重复（票 20 的用例）；工作台的回复照旧有 ↑ ↓ 与上下文。
  - `MessageActions.test.tsx`（新）：工作台的行动条；助手一步的回复只有复制、保存且没有数字；过程按钮在最后、与复制同一串 class、`tabIndex={-1}`；按下时 `aria-expanded="true"`、提示变「收起过程」、`bg-hover text-ink`、不是对勾，整条行动条不再隐藏；泄漏标记那种只有过程按钮。静态渲染点不了按钮，按下态在 `MessageAgent` 这一层测，展开区内容仍用 `vi.mock` 让 `ExpandSection` 全展开。
  - `useAssistantSentence.test.ts`（新）：清洗与主区一致（`<thinking>` 不进句子，推理没闭合时退回旁白，答完提问回到 null）；不在跑时不看流；同一个 chunk 卡片与顶栏共清洗一次，别的会话写入不清洗；33 个 chunk 只变 3 次；主对话不在屏上时缓存照样写入。
  - `assistant.test.ts`、`Sidebar.main-chat.test.tsx`、`MainHeader.identity.test.tsx`：在跑时说那句，没有就「思考中」，不再出现「第 N 步」（主对话本身带着 `lastStepIndex` 与 `summary` 也不写）；同一屏里在跑的工作台会话行照旧「第 3 步 · …」。子任务卡片的「第 3 步」由原有的 `SubtaskCards.test.tsx`、`subtasks.test.ts` 管着，照旧通过。
- **反向检查** 12 处，都挂了，恢复后 19 个文件 sha256 逐字节一致：助手的行动条又画数字（挂 4 条）、步骤区常开让步数常显（2）、第一行画上下文（1）、一步的回复出过程按钮（5）、第一行丢 token（1）、卡片又写「第 N 步」（5）、工作台的回复丢上下文（2）、按下时没有按下态（1）、展开时行动条照旧隐藏（1）、卡片每次读都清洗（1）、卡片读没清洗的流（2）、过程按钮挪到最前（3）。
- **工作台的 Markup**：在两棵树里各跑一个临时测试，渲染工作台的 `MessageActions`（全量、只有上下文、只有输入、没有 telemetry）、`MessageAgent`（普通与泄漏标记）、一整段工作台对话，7 份输出与 `7015474f` 逐字节一致。临时测试已删。

**逐像素比对**（Chrome harness：真 App 加模拟 Core，沿用票 20 的，复制到会话草稿目录的 `s21/` 再改；`7015474f` 用 `git archive` 放在 `s21/base/`；两个 Vite 各占一个非 1420 的端口；关动画、冻结时钟，1x。harness 已从两棵树删掉，不进仓库）：

- **工作台的会话、子任务、外置运行时**：30 个画面全部逐像素一致。三处各自的静止、在跑、在问你 × 浅 / 深（18 个），加英文静止与流式、子任务深色英文在问你、宽屏、960 小窗口在跑、悬停你的气泡、悬停回复（浅、深，子任务、外置各一，行动条的 ↑ ↓ 与上下文都在画面里）、外置深色流式、从助手点开的那个在跑的子任务。
- **主对话**：27 个画面。直接比，4 个一致（只有问候 2 个，开着工作台而助手在想 1 个，960 小窗口 1 个：画面里没有入口），10 个只差在该差的地方，13 个另有极小的差别。差别逐条：
  - **常显的「N 步 · 用时」不在了**：静止、在跑、在问你都有，差别都在 `7015474f` 那几个入口的框里。
  - **在跑时卡片与顶栏**：「思考中」换成主区那一行的句子（旁白「我先查一下周六上午的船班。」、流出的第一行「周六上午还有三班船有票：8:30、9:00 和 9:30。」、英文同理）；开着工作台会话时只有卡片那一行。刚发出、什么都还没写时两边都是「思考中」，逐像素一致。
  - **另外 13 个的极小差别**是不画入口带来的栅格化抖动，不是版面变化：气泡里代码块的两个下圆角上 2 到 10 个像素差 1/255，高窗口里列表圆点、杏沙气泡圆角上几个像素差 1/255，高窗口英文深色那张收据缩略图里 402 个像素差 4 到 8/255。证据：`7015474f` 自己比自己 15 张全等；`7015474f` 把入口用 `visibility:hidden` 画透明（版面不动）再和自己比，这 13 张的差别一个不差地重现（同样的范围、同样的像素数）；本票对「`7015474f` 把入口画透明」，27 张里 18 张逐像素一致，其余 9 张只差在卡片与顶栏那一行（都是在跑的）。
  - 悬停与展开没进逐像素（本来就该变），见自查截图。
- **自查截图**（2x，会话草稿目录的 `s21/shots/`）与总览（`s21/overview/`）：`01-reply-rest-hover-open.png`（静止、悬停、停在过程上的提示、点开、一步的悬停；浅 / 深 × 中 / 英）、`02-open-nine-steps.png`（九步点开，第一行带 ↑ ↓）、`03-running-card-header-line.png`（思考中、旁白、流出中，浅深中英，加开着工作台时只有卡片）、`04-workbench-unchanged.png`（工作台、子任务、外置左右对照，子任务卡片的「第 3 步」）、`05-main-chat-diffs.png`（主对话的两类差别）、`icons-footprints-vs-listchecks.png`（同一条回复的悬停行与按下态，`Footprints` 对 `ListChecks`，浅、深，3x；`ListChecks` 是临时改一行截的，改回后 sha256 与改前一致）。量测在 `s21/measure21.json`，渲染次数在 `s21/renders21.json`，比对结论在 `s21/cmp-result.txt`。

**与票的出入、留意**

1. 泄漏标记那种回复只放过程按钮（`processOnly`），票里没写这一种。
2. token 数整个算数字（`ink-soft`），没有照入口的「按位拆数字」去拆「1.1k」。
3. 按下态的测试在 `MessageAgent` 这一层：`Conversation` 的展开状态是组件内部的 `useState`，静态渲染没法按下。
4. 既有的、本票没动：展开后下一条（时间条或你的气泡）贴着步骤区底（离最后一步只有区里的 `pb-1`），因为回复这一行的「下面那 30px」是行动条，展开的步骤接在行动条下面之后没有再留间距。`7015474f` 点开入口时一模一样。JC 看展开态时会注意到，要改另开一条。
5. harness 的模拟会话没有 `lastStepIndex`，所以 `7015474f` 在 harness 里卡片在跑时写的是「思考中」；真机上 `7015474f` 写的是「第 N 步 · 摘要」。

**给 JC 的真机步骤补充**（票里六步之外）：

- 这票没动 Rust，dev 热更就行；画面没变就 `touch gui/index.html` 整页重载。
- 第 4 步：发一句会流出几行字的话，留意卡片第二行在第一行长出来时会不会因为轻跳而闪；再切到一个工作台会话，看卡片是否还跟着换句。
- 第 6 步的两张图标对照在 `s21/overview/icons-footprints-vs-listchecks.png`；要换 `ListChecks`，改 `MessageActions.tsx` 里的两处图标与一处 import。
