# 148 主对话的气泡按 IM 排：同一边 4px、换边 16px，悬停按钮贴到气泡外侧

Status: done（2026-11-06 JC 真机：「真机看了，效果不错」）

验收记录：（2026-11-06 rebase 到含裁决 199 第 8 条的 main 后快进合入 `200dbeda`。主会话验收：worktree 里复跑 typecheck、lint 过，`TZ=UTC` vitest 255 个文件 2,854 条全过，`check-docs-links` 494 个文件过，`git diff --check` 干净；新增行没有本机路径，全角标点只在一处英文注释里命中（不算）。合入后 dev 真窗口截图按像素量（2 倍图）：你 → 它 16px，它 → 它 4px，气泡 → 待办框 4px，待办框 → 下一条回复 4px，一行气泡 43px，到上限的回复宽 627px（规则 626），最后一条到输入框约 24px。要真机看：悬停按钮贴在两边外侧、从气泡横着走到按钮不断；你的三颗挂在气泡左边读不读得出归属；待办框夹在两条回复中间时读成上面那条的；三点撑成回复时不跳、按钮不闪；末尾离输入框 24px 是否太贴；Open risks 1–8 见报告）

来源：[主对话 PRD](../PRD.md) 裁决 199（JC 2026-11-06：「不做切换器，直接按你推荐的乙+B 做」）。只改 GUI 与设计文档；只影响内置运行时的主对话（`MainView` 的 `isMainChat`）；工作台、从助手点开的子任务、外置运行时零变化（外置没有主对话）。不碰 Core、库、CLI、runner。

## 为什么

- 主对话里任意两条气泡之间都是 30px：回复的行动条（复制 · 引用 · 保存 · 过程 · ⋯）与你的气泡下面那一行（复制 · 引用 · ⋯）隐藏时照旧占位，气泡下 6px + 24px chip（`gui/src/components/conversation/MessageActions.tsx:198` 的 `mt-1.5`，`MessageUser.tsx:369-370` 的 `mb-7.5`）。`lib/assistant-conversation.ts` 的 `endsWithActionRow` / `assistantRowGap` 把这 30px 当作间距，下一条不再加。
- 途中先说的话（票 137、裁决 191）与回复是同一个部件（`MessageAgent`，`showActions` 默认 `true`），每句下面也是 30px。11-04 以来相邻的两条气泡里 45% 是它连着它，一行的气泡才 43px，空隙是它的七成。Telegram Web A 组内 6px、组末 10px（气泡高的 19% / 32%），悬停按钮绝对定位在气泡外侧、不占竖向空间。

## 要做到

### 1. 间距（只在主对话）

- 同一边连着（它 → 它、你 → 你，含途中先说的话、叫醒那一轮的回复、它问你的问题、你在跑时插的话、「中途停下 · N 步」那一行、三点气泡）：**4px**。
- 换边（它 → 你、你 → 它）：**16px**。
- 时间条照旧上 16px、下 20px；「紧接在回复 / 你的气泡下面时上面不再加」这条例外删掉（那是因为上面已有 30px 占位）。中间隔着时间条、整段平铺的运行（`/btw`、只剩派活标签的运行）时，下一条的上边距照现有规则（从 20px 起）。
- 距离从上一行的最下沿量：回复下有卡片框（文件、子任务、待办、提醒、备忘，离气泡 4px）就从卡片框底量；你的长消息下面常显的「展开 / 收起」就从那一行底量。
- 「中途停下 · N 步」那一行下面自带的 24px（当行动条用的）去掉，照上面的规则。
- 三点气泡：现在没有上边距、靠上一行的 30px 站位（`TypingBubble.tsx:37` 注释，裁决 110）。改成照上面的规则拿上边距（跟在你的气泡后 16px，叫醒那一轮跟在上一条回复后 4px，跟在途中先说的话后 4px），接替它的回复拿同一个值，**交接时站在同一个位置**这条不变（`lib/typing-bubble-handoff.ts`）。
- 过程卡片（回复行动条的「过程」打开的那张，`AssistantProcessCard.tsx:137` 现在是行动条下面 `mt-1.5`）：改成回复这一行（气泡或卡片框）下面 4px，同回复下的卡片框。
- 贴底与滚动：凡是按「回复下面有行动条的 30px」算的（文档 `conversation.md`「滚动：贴底」里「只让出行动条的 30px」，以及代码里对应的常量或假设），改到新几何。对话末尾到输入框的距离：去掉 30px 占位后照现有的底部内边距，**不补**；改前改后的数值写进报告。
- 删除的动效（`lib/bubble-motion-play` 的 `data-hover-row` 等）、发出那一下的动效，照旧能用。

### 2. 悬停按钮贴到气泡外侧（只在主对话）

- **回复**（回复、途中先说的话、问候、叫醒那一轮的回复，凡是现在有行动条的）：行动条在**气泡右边**，离气泡右缘 6px，**底边与气泡底边对齐**；回复下有卡片框时，照样贴着气泡（在卡片框上方那一截的右边），不贴卡片框。
- **你的气泡**：复制 · 引用 · ⋯ 在**气泡左边**，离气泡左缘 6px，底边与气泡底边对齐。
- 从左到右的顺序不变（回复：复制 · 引用 · 保存 · 过程 · ⋯；你的：复制 · 引用 · ⋯）。chip 外观照旧（`ActionChip`：24px、14px thin 图标、chip 之间 2px、`tabIndex={-1}`、裸的，不加壳）。
- **不占版面**：绝对定位，不进文档流；隐藏照旧用 `opacity-0` + `pointer-events-none`、不卸载；悬停不引起任何位移。
- **悬停区**：这一行（气泡、卡片框）连上旁边的按钮，6px 空隙要有看不见的命中区，指针从气泡横着走到按钮一路不断；离开即收起（裁决 109，无延迟）。
- 出现、钉住常显（已复制 / 已保存 1.5 秒、过程展开、⋯ 菜单开着）、让位于选中工具条（裁决 108）、右键菜单、`chip-roots` 首次悬停才挂 tooltip 与菜单（票 72），规则全不变。tooltip 不被窗口或滚动容器裁掉。
- **回复气泡上限**：`AssistantParts.tsx:23` 的 `ASSISTANT_BUBBLE_MAX`（`max-w-[88%]`）改成「栏宽减 134px」（五颗 128px + 离气泡 6px），用常量算出来、注释写清来历；回复下的卡片框、过程卡片用的是同一个常量，跟着变。760 栏 669 → 626px，1200 栏 1056 → 1066px。不设像素上限（裁决 79 照旧）。
- **你的气泡上限**照旧 `min(80%, 560px)`（左边至少 20%，放得下三颗）。
- **没有气泡的回复**（主对话里的 ChatGPT 套餐错误提示 `ChatGptPlanErrorNotice`、协议失败提示 `ProtocolFailureNotice`，它们也带行动条）：给它们同一个上限，行动条照样贴在右边。做不到或代价大就停下来写进报告，别自行另起规则。
- 你的长消息的「展开 / 收起」不是悬停动作：照旧在气泡下面、靠右、常显，离气泡 6px；它不再与 chip 同一行（chip 去了左边）。

### 3. 文档

- `docs/design/conversation.md`「助手的对话」里所有说到 30px、行动条在气泡下面、你的气泡下面那一行、`mb-7.5`、三点气泡不要上边距、时间条紧接时不加、回复上限 88% 的地方，按本票改写，引裁决 199；「分组间距」一条整段重写（两级：4 / 16）。「Message Actions」一节里说到助手的对话的地方同步。旧做法与理由一句话带过、指向裁决 199，不重述。
- `lib/assistant-conversation.ts` 顶部的大注释（`bubbles` 一段）与各函数注释同步。别处注释里「30px」「reserved row」之类说主对话的，grep 一遍改掉（工作台的照旧）。

## 别动

- 工作台的一切：回复的行动条（带 token 与上下文那一种）仍在回复下面占位，工作台你的消息下面的悬停复制仍在 `mb-7.5` 里，间距一律不变。`MessageActions`、`MessageUser`、`MessageAgent` 是两边共用的，只改主对话那一支。
- 行动条与菜单的内容、顺序、图标、文案；选中工具条；右键菜单；过程卡片里面；回复下卡片框本身（离气泡的距离例外，改成 4px）；气泡的颜色、圆角、内边距、字号行高。不加组内小圆角。
- Core、库、CLI、runner、IM、外置运行时。

## 验证

- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`（React 编译器规则：effect 体内同步 setState、渲染期 `Date.now()` 都是 error；组件文件只导出组件）
- `TZ=UTC pnpm --dir gui test`（全量 vitest，跑完照抄条数）
- `node scripts/check-docs-links.mjs`、`git diff --check`
- 现有测试里钉着 30px、`mt-0` / `mt-5` / `mb-7.5`、行动条在下面的，按新规则改；`lib/assistant-conversation.test.ts` 的 `assistantRowGap` 用例覆盖四种相邻（它 → 它、你 → 你、它 → 你、你 → 它）与时间条、三点气泡、「中途停下」那一行；加一条测试钉住工作台的间距与行动条位置不变。
- jsdom 不排版：几何（贴在外侧、底边对齐、上限算式）在测试里只能查类名与样式，报告里写明哪些只能真机看。主会话合入后在 dev 真窗口截图核对。

## 环境与边界

- 只在自建 worktree 里做：`git worktree add -b t148-im-spacing-actions-beside-bubble <scratchpad>/wt148 main`（从本地 main 起，本票与裁决 199 只在本地提交里），进去先 `pnpm --dir gui install`。纯 GUI，不用克隆 Rust target。绝不碰主工作树，不跑 `tauri dev`。
- gui 不是 prettier-clean：**别对整个文件跑 prettier**（`pnpm --dir gui format` / `prettier --write`），只保证自己写的 hunk 风格一致；新文件可整篇格式化。
- 在分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行（脚本放 scratchpad，文件名用 `t148-` 前缀）。报告里不写绝对路径。
- 长命令（全量测试）前台跑，跑完再往下；别交给后台任务或分叉代理，也别留后台等待循环。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：改了什么（按上面三节逐条对应 file:line）；改前改后的数（各种相邻的间距、对话末尾到输入框、回复上限在 760 / 1200 栏）；改了哪些文件；验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；哪些几何只能真机看；看到但没改的（Open risks），原样列出。

## 报告

2026-11-06，代理在分支 `t148-im-spacing-actions-beside-bubble` 上做完（从本地 main `402a31f4` 起），未 push、未合入。中途主会话转来 JC 的改数（裁决 199 第 8 条）：回复下的卡片框离气泡 12 → 4px，过程卡片（回复下的、「中途停下」那一行点开的）离上一样东西 4px；票面上面三处已照改。

### 改了什么

**1. 间距（只在主对话）**

- 规则：`gui/src/lib/assistant-conversation.ts:150` `assistantRowGap`：同一边 `mt-1`（4px），换边 `mt-4`（16px），上一行为空（中间隔着整段平铺的运行、系统行，或什么都没有）`mt-5`（20px）；时间条下面的那一行照旧由调用处给 `mt-5`。`:125` `AssistantRowSide` 去掉 `user-bar`，主对话只记 `user` / `agent`；`agent-bar` 只剩工作台的回复。`:131` `endsWithActionRow` 只认 `agent-bar`（工作台）。
- 对话循环记边：`gui/src/components/conversation/Conversation.tsx:1033`–`1046`（你的记 `user`，它的、答完的提问、「中途停下」那一行都记 `agent`；还在等你回答、只画出时间条的提问记成空，`:695` `waitingQuestion`）；`:1111` 主对话里平铺运行的回答之后记成空（下一条从 20px 起），工作台照旧 `agent-bar`。
- 你的这一行去掉 `mb-7.5`：`gui/src/components/conversation/MessageUser.tsx:373`。
- 时间条：主对话不再出现 `afterActionRow`（`endsWithActionRow` 在主对话恒为假），一律 `my-4`（上 16、下 20 由下一条的 `mt-5` 合并）；`MessageTimeDivider.tsx:61` 未改，注释改了。
- 「中途停下 · N 步」那一行去掉自带的 `pb-6` 与它的过渡：`gui/src/components/conversation/AssistantProcessCard.tsx:254`。
- 三点气泡与等你回答的提问拿上边距：对话根元素带 `peer` 与 `data-last-side`（`Conversation.tsx:1210`，`assistantLastSide` 在 `assistant-conversation.ts:166`），`ASSISTANT_TAIL_GAP`（`assistant-conversation.ts:187`，`peer-data-[last-side=user]:mt-4` / `agent:mt-1` / `other:mt-5`，测试钉住它等于 `assistantRowGap(last, "agent")`）挂在 `TypingBubble.tsx:63` 与 `MainView.tsx:905`（主对话的 `AskUserBubble`）。接替的回复由 `assistantRowGap` 拿同一个值，交接时站在同一个位置。
- 回复下的卡片框 `mt-3` → `mt-1`：`gui/src/components/conversation/ReplyCards.tsx:30`。
- 过程卡片 `mt-1.5` + 内部 `pb-5` → `mt-1`、没有自己的下边距：`AssistantProcessCard.tsx:141`。
- 你的长消息的「展开 / 收起」：主对话里移出 chip 那一行，放在气泡下面一行、靠右、常显、在文档流里（`mt-1.5`）：`MessageUser.tsx:514`。
- 贴底与滚动：代码里没有按 30px 写死的常量或假设（`assistantFollowTop`、`useStickyScroll`、交接的 `bubbleGrowInsets` / `columnLift` 都是量出来的），不用改；文档里「只让出行动条的 30px」改写。
- 交接与删除的动效：行动条现在是回复气泡的子元素，交接给气泡的子元素淡入时，透明度是悬停显示的那一层改成淡入它里面的按钮（`gui/src/hooks/useTypingBubbleHandoff.ts:170` `fadeParts`，`:381`），否则行动条会在交接的 240ms 里闪出来；`followersOf` 同用这一条。删除的拷贝照旧按 `data-hover-row` 藏起悬停行（`bubble-motion-play.ts` 未改，两边的悬停行都还带 `data-hover-row`）。

**2. 悬停按钮贴到气泡外侧（只在主对话）**

- 回复：`gui/src/components/conversation/MessageActions.tsx:213`，主对话一支是 `absolute bottom-0 left-full flex w-max items-center pl-1.5`（6px 是它自己的左内边距，指针横着走过去就已经在它上面；`w-max` 一行不折）；工作台一支一字不改。放在气泡里当最后一个子元素：`gui/src/components/conversation/MessageAgent.tsx:221`–`229`；气泡加 `relative` 当包含块：`AssistantParts.tsx:55`。回复下有卡片框时行动条照样贴着气泡（框在气泡外、气泡下）。
- 没有气泡的两种回复（ChatGPT 套餐错误提示、协议失败提示）：主对话里装进 `relative` + 同一个上限的框，行动条挂在框右边、底边对齐提示框：`MessageAgent.tsx:114`、`:171`。做得到，代价小，没停。
- 你的：`MessageUser.tsx:474`，`absolute right-full bottom-0 flex w-max items-center gap-0.5 pr-1.5`，气泡的最后一个子元素（气泡本来就是 `relative`，而且它得留在这一行的直接子元素：`timeLineAbove`、`assistantReplyStart` 都按「气泡的父元素就是这一行」读）。工作台的悬停复制、它的命中带（`:540`）、`mb-7.5` 照旧。
- 悬停区：两边都是这一行（栏宽的整行），气泡与按钮之间的 6px 在里面；主对话不再需要 30px 的命中带（留着会盖住下一条），只留给工作台。离开即收起、钉住常显、让位、右键菜单、`chip-roots` 首次悬停才挂，代码路径没动。
- 回复气泡上限：`AssistantParts.tsx:27` `max-w-[calc(100%-134px)]`；134 由 `assistant-conversation.ts:199` `ASSISTANT_BAR_ROOM_PX = 5 × 24 + 4 × 2 + 6` 算出，Tailwind 要字面类名，所以类名里写出数字，测试钉住两者相等（`assistant-conversation.test.ts:188`）。卡片框外层、过程卡片、三点下面那一行用的是同一个常量，跟着变。
- 你的气泡上限照旧 `min(80%, 560px)`。

**3. 文档与注释**

- `docs/design/conversation.md`「助手的对话」：你的在右（118）、它的在左的上限（123）、回复下的卡片（137）、行动条与新加的「位置」（138–143）、「分组间距」整段重写成两级（145–152，含对话末尾到输入框）、三点气泡的「样子」（171）、交接里跟着淡入的东西（175）、跟随同步（177）、点开过程（221）、过程卡片宽度与间距（229、241）、「中途停下」那一行的样子与间距（258、261）、时间：居中（270）、浮动日期的旧理由（275）、消息菜单入口（298）；该节以外：杏沙气泡两条（89、91）、发送时间（106）、「回复下的卡片（一框列表）」的框与「为什么」（400、413）、子任务卡片（430）、Message Actions（746 起：总述、行动条、让位、工作台你的悬停复制、两条正交规则、间距注意标成工作台、视觉的位置 846）、会话里的输入框（1078）。旧做法一句带过、指向裁决 199。
- 代码注释：`assistant-conversation.ts` 顶部大注释的 `bubbles` 与 `process` 两段、各函数注释；`MessageActions`、`MessageAgent`、`MessageUser`、`AssistantParts`、`AssistantProcessCard`、`TypingBubble`、`ReplyCards`、`MessageTimeDivider`、`MessageMenu`、`ActionChip`、`Conversation` 里说主对话 30px / 气泡下面那一行的注释；`lib/user-row-hover.ts`、`lib/message-menu.ts`、`lib/selection-copy.ts`、`lib/chip-roots.ts`、`lib/floating-day.ts`（旧理由改成过去时）。工作台的照旧。

### 改前改后的数（主对话，按类名算；竖向与窗口宽无关）

| 相邻 | 改前 | 改后 |
|---|---|---|
| 它 → 它（回复、途中先说的话、叫醒那一轮的回复相连） | 30 | 4 |
| 答完的提问（候选底）→ 它 | 4 | 4 |
| 你 → 你 | 30 | 4 |
| 它 → 你 | 30 | 16 |
| 答完的提问（候选底）→ 你的回答 | 20 | 16 |
| 你 → 它 | 30 | 16 |
| 气泡 → 时间条（上） | 30（行动条或你那一行当间距，上面不加） | 16 |
| 时间条 → 下一条 | 20 | 20 |
| 你 →「中途停下」那一行 / 它的回复 → 那一行 | 30 / 30 | 16 / 4 |
| 那一行 → 你（从行框底量） | 24 | 16 |
| 你 → 三点气泡 / 上一条回复或先说的话 → 三点 | 30 / 30 | 16 / 4 |
| 气泡 → 回复下的卡片框 | 12 | 4 |
| 卡片框 → 下一条 | 30（框下面是行动条） | 4 / 16 |
| 气泡或卡片框 → 展开的过程卡片 | 36（行动条 30 + 6） | 4 |
| 过程卡片 → 下一条 | 20 | 4 / 16（时间条 16） |
| 你的长消息：气泡 → 「展开」→ 下一条 | 气泡到下一条 30（「展开」在那 30px 里） | 气泡到「展开」6，「展开」24 高，再 4 / 16（气泡到下一条 34 / 46） |
| 平铺运行的回答 → 下一条 | 30 | 20 |
| 你 → 平铺运行（第一步的标记） | 30（你那一行的 `mb-7.5` 吞掉标记的 `mt-6`） | 24（标记自己的 `mt-6`） |

- 对话末尾到输入框（最后一行的底到输入框上缘）：滚动区底内边距 24px（`py-6`）不补。最后一条是回复或你的气泡：54 → 24；「中途停下」那一行：48 → 24；三点气泡（含下面那一行）24 不变；等你回答的提问：44 不变（它自己的 `my-5` 下半）。
- 回复气泡上限：760 栏 669 → 626px，1200 栏 1056 → 1066px。

### 工作台零变化的核对

- 用同一组工作台夹具（多轮、提问、长消息、套餐错误、协议失败、途中先说的话、卡片、在跑、等你回答，展开与不展开各一遍，外加 `MessageActions`、`MessageAgent`、`MessageUser`、`AskUserBubble` 单独渲染）在 `402a31f4` 与本分支各渲染一遍静态标记，逐字节相同（462,964 字节）；临时测试与临时 worktree 已删，没提交。
- 提交了一条钉住的测试：`Conversation.assistant.test.tsx:228`（你的行 `mt-5 mb-7.5`、悬停复制在气泡下面、命中带、回复行动条在回答下面且在文档流里、没有并排的类、没有 `peer` / `data-last-side`、时间条紧接回复时 `mb-4`）；`MessageActions.test.tsx:117` 钉住工作台回复的行动条类名。

### 验证（照抄）

- `pnpm --dir gui typecheck`：exit 0
- `pnpm --dir gui lint`：exit 0
- `TZ=UTC pnpm --dir gui test`：`Test Files  255 passed (255)`，`Tests  2854 passed (2854)`（改前基线 255 / 2842）
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 494 files checked.`
- `git diff --check`：无输出，exit 0
- 新增与改动的测试：`assistant-conversation.test.ts:120`（四种相邻、20px、「中途停下」与先说的话算它那一边、工作台的 `agent-bar`）、`:161`（三点与提问的上边距等于 `assistantRowGap`）、`:188`（上限算式）；`Conversation.assistant.test.tsx:318`（4 / 16 的实际类名）、`:454`（你的三颗在气泡里、右边贴着、不在下面）、`:547`（命中带只剩工作台）、`:568`（「展开」在气泡下面一行）、`:622`（时间条一律 `my-4`，工作台照旧）、`:872`（「中途停下」那一行的上下与展开的卡片）；`MessageActions.test.tsx:150`、`:277`（行动条在气泡里、贴右边、底边对齐；两种提示框）；`MainView.assistant.test.tsx:671`（三点与提问按最后一行取上边距，工作台没有）；`ReplyCards`、`SelectionCopyToolbar`、`MainView` 里钉着 `mt-3`、88%、旧行类名的照新值改。
- Tailwind 产物（`vite build` 到 scratchpad）里 `peer-data-[last-side=…]:mt-*`、`max-w-[calc(100%-134px)]`、`left-full`、`right-full`、`w-max` 都生成了。
- WebKit 量具（系统 `swift` 起不上屏的 WKWebView，加载真 Tailwind 产物的静态页）：气泡里挂一个绝对定位的块级子元素（本票的做法），「预约11月8日上午9点的体检」「制作76人赛季战况网页」等五句，两边气泡宽高与不挂时逐一相同（如 215.11 × 43），不折行；对照组（绝对定位元素在字的行内，即票 132b 的坑）同一句缩到 204.09、折成两行，量具能抓到这个坑。行动条盒子左缘就是气泡右缘、底边差 0、宽 134px；你的那一排右缘就是气泡左缘、底边差 0、宽 82px。字体用的是系统字体，不是 app 的字体组合。

### 只能真机看的

- 两边按钮的实际位置：离气泡 6px、底边对齐、长回复与带卡片框的回复上按钮的高度；1200 栏与小窗口（栏宽 699）里右边 134px 放不放得下、看起来空不空。
- 悬停：从气泡横着走到按钮一路不断、离开即收起；tooltip 在窗口边上不被裁掉；回复的「⋯」菜单从最右一颗往右开，气泡到上限时会不会顶到窗口边（靠 Radix 自己避让）；你的「⋯」往左开。
- 交接：三点气泡撑成回复时位置不跳（两种上边距：你的气泡后 16、叫醒那一轮 4），撑开的 240ms 里行动条不闪出来；发出那一下、删除与放回的动效。
- 4 / 16 的节奏、两条灰气泡隔 4px 读不读成一组、你的三颗挂在气泡左边读不读得出归属（裁决 199 第 5、6 条）。
- 贴底跟随落地、对话末尾离输入框 24px 是否显得太贴。

### Open risks

1. 两种提示框（`ChatGptPlanErrorNotice`、`ProtocolFailureNotice`）自带 `my-3`，与行的上边距合并：同一边连着时上面是 12 不是 4，下面的 12 也并进下一条的间距（下一条同一边是 12 不是 4）。是原有的外边距，票面没说，没改。
2. 右键你的气泡旁边那三颗按钮，现在会弹你这条气泡的消息菜单（按钮在带 `data-message-id` 的气泡里）；改前右键那一行按钮什么都不弹。回复的行动条一向在回复的 `data-message-id` 里，现在两边一致；菜单的项与规则没变。
3. 你的气泡里多了按钮的读屏文字（「复制」「引用」「更多」，`sr-only`）：⌘K 全文定位在这条消息里高亮匹配词时，搜这几个词会在看不见的按钮里多出高亮区间（回复一向如此）；选中、复制都不受影响（按钮 `select-none`）。
4. 你的气泡到平铺运行（`/btw` 等）的第一步：30 → 24px（第一步标记自己的 `mt-6`，原来被你那一行的 `mb-7.5` 吞掉）；票面没写这一种，照现状留着。
5. 你的长消息到下一条是 34 / 46px（气泡下 6px +「展开」24px 再加 4 / 16），比普通的 4 / 16 大，是「从那一行底量」的结果。
6. 三点气泡与等你回答的提问的上边距靠 CSS 兄弟选择器（对话根元素是它们前面的 `peer`）：以后有人在 `MainView` 里把它们包进别的容器，上边距会悄悄变成 0（三点）/ 20（提问）；`MainView.assistant.test.tsx:671` 钉着现在的结构。
7. 宽松栏 1200 下回复上限多了 10px（1056 → 1066）。
8. WebKit 量具用的是系统字体，app 里回复是 Newsreader / Inter 加苹方的组合；结构上的结论应当不变，真机截图时顺带看一句中西文混排的短回复有没有提前折行。
