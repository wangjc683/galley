# 56 选中工具条：一个浮起的壳装同款图标；有选区时悬停行让位

Status: done（2026-10-19 JC 真机：「票 56 真机看了，没问题」。合入 `9dff5b45`）

来源：主聊天 PRD 裁决 108（2026-10-19，JC 真机票 53 后提：选中文字时出现的两颗图标与悬停行风格割裂）。只改 GUI 与设计文档；Core、runner 不动。不上切换器。

## 现状

- 选中工具条：`gui/src/components/conversation/SelectionCopyToolbar.tsx`。portal 到页面，放在选区所在消息旁边的侧沟（右边放得下放右边，否则左边，再不行贴视口左缘 12px，`toolbarSide`），复制在上、中线对着选区最后一行，引用在下隔 4px。每颗是 `ActionChip` 的 `floating` 变体（`gui/src/components/conversation/ActionChip.tsx`：28px、实底 `bg-elevated`、边框、投影），所以是两个各自带边框的方块。
- 悬停行：回复的行动条（`MessageActions.tsx`）与你的气泡下那一行（`MessageUser.tsx`，票 53）是 `inline` 变体：裸图标，24px，悬停才有淡底。
- 拖选时指针还在气泡上，悬停行照样亮着；两套同时出现，两个「复制」两个「引用」，一套管整条、一套管选中的那段。悬停行的代码不知道有选区。
- 规则出处：`docs/design/conversation.md`「复制入口统一（`ActionChip`）」与其下「两条正交的规则」。

## 要改的

### 一、外壳

- 工具条改成**一个**浮起的小壳，里面两颗按钮用 `inline` 变体（与悬停行同款：24px、14px thin 图标、`ink-muted`、悬停 `bg-hover` 提墨、复制后闪对勾 1.5 秒、`tabIndex={-1}`、tooltip 同现在）。
- 壳的材质：实底浮起的底色（`bg-elevated`，不做毛玻璃，08-10 的「非 glassmorphism」）、1px `border-line`、浮起投影（`--shadow-float`，与「回到底部」按钮同一个 token）；圆角取界面里其他小浮层（tooltip、菜单）用的那一档，写理由；内边距让两颗按钮之间与四周的留白看起来同悬停行的节奏（悬停行里 chip 间距是 `gap-1`），写数值。
- 照旧竖排、照旧在侧沟，位置规则不变（离消息 10px、离视口 12px、复制那颗的中线对着选区最后一行、贴视口上下各留 12px）。壳的宽高变了，`TOOLBAR_WIDTH`、`CHIP_SIZE`、`CHIP_GAP`、高度这些常量跟着重算，让「复制那颗的中线对着最后一行」仍然成立。只有复制一颗时（没传 `onQuote`）壳里就一颗。
- `ActionChip` 的 `floating` 变体改完后如果没人用了，删掉，文档注释改成「装甲在外壳上」；还有别处在用就留着，写清楚哪里。

### 二、让位

- 选中工具条为哪条消息出现，那条消息的悬停行就不出现：回复的行动条、你的气泡下那一行（主对话与工作台都是）。工具条一收起（选区取消、选到别处、点了引用或复制后收起），悬停照常。
- 判定照工具条自己的条件，不另起一套：工具条出现的范围不变（工作台只在选中回复时，主对话选中回复或你的气泡都出现，`gui/src/lib/selection-copy.ts`；选区要起止在同一条消息里）。所以工作台里选中你的消息时没有工具条，悬停复制照旧。
- 做法你定（比如工具条把它服务的那条消息标出来，行读这个标记；或一个很小的订阅），要求：不让每条消息在 `selectionchange` 时都重渲染，只有受影响的那一两条变；不改动悬停行本身的显隐动画与占位（隐藏仍是 `opacity` 占位，不跳）。
- 悬停行自己钉住常显的时候（「已复制」闪现、「⋯」菜单开着、过程展开）遇到选区怎么办：你定一个最不意外的规则，写理由。

## 文档

- `docs/design/conversation.md`「复制入口统一」里「触发浮现 → 选中」那条：改成一个壳、壳里同款图标，带裁决 108；「两条正交的规则」第 2 条「穿哪身皮」：装甲从每颗按钮挪到外壳，原则不变。补一条让位规则（行动条那几处、你的气泡那一行各一句或集中一处引用）。
- 全角标点；devlog 主会话写。

## 别动

- 工具条的位置规则、出现范围、复制与引用做的事（引用条、上限 3 段等）。
- 悬停行的内容、顺序、几何与间距（票 53 刚定）。
- 在跑的票 55 改的文件：`MainView.tsx`、`AssistantParts.tsx`、`useLiveLineHandoff.ts`、`live-line-handoff.ts`、`AssistantIdentity.tsx`、`SidebarAssistant.tsx`、`lib/assistant.ts`、`lib/assistant-conversation.ts` 与它新加的切换器文件，尽量不碰；真要碰写清楚哪一行，好让主会话合入时处理。
- `gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now()` 都是 error；状态归零用 guarded setState-in-render；工具函数别从组件文件导出。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`。
- `TZ=UTC pnpm --dir gui test` 与 `TZ=America/Los_Angeles pnpm --dir gui test`。
- 单测：工具条渲染一个壳、壳里是 `inline` 的 chip；让位：有选区的那条消息悬停行不出现、别的消息不受影响、选区取消后恢复；工作台选中你的消息时悬停复制照旧。
- 自查截图（不进仓库，放 scratchpad，文件名带 `t56-` 前缀）：主对话里选中回复、选中你的气泡（各在悬停状态下，证明悬停行收起）；工作台选中回复；窄窗口贴视口左缘的退路；复制后对勾；浅色深色、中英文；改前改后对照。截完把临时页从工作树删掉。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 实现说明带 `file:line`：壳的结构与数值（圆角、内边距、尺寸）、常量怎么重算、让位怎么判、钉住常显时的规则。
3. `floating` 变体删了还是留了、为什么。
4. 验证命令与结果原样（测试条数、两个时区）。
5. 截图的绝对路径与每张一句话。
6. 看到但没改的问题。

## 给 JC 的真机步骤（主会话合入后补全）

1. 主对话里在它的回复里拖选一段：旁边出现一个小壳，里面复制、引用两颗，和悬停行同款；这条回复下面的行动条不出现。
2. 在你的气泡里选一段：同上，你气泡下的三颗不出现。
3. 点空白取消选区，再悬停：悬停行照常出现。
4. 工作台会话里选中回复的一段：同一个小壳，回复的行动条不出现。

## Comments

- 2026-10-19（实现子代理）：已在分支 `main-chat-56-selection-toolbar-one-shell` 做完，待主会话合入与 JC 真机。壳：`SelectionToolbarShell`（`SelectionCopyToolbar.tsx`）一个 `rounded-md border border-line bg-elevated p-1.5 shadow-[var(--shadow-float)]` 的竖排框，里面两颗裸 `ActionChip`，间距 `gap-0.5`；圆角取菜单那档 12px（同菜单「外圆角 = 里面圆角 + 内边距」：chip 6 + 内边距 6），图标间距与图标到外缘都是 12px。壳 38 × 64（只有复制 38 × 38），常量改为 `CHIP_SIZE 24`、`CHIP_GAP 2`、`SHELL_INSET 7`、`TOOLBAR_WIDTH 38`、复制中线离壳顶 19，临时页实测复制中线与选区最后一行中线逐像素重合。`floating` 变体没人用了，已删（连同 `variant` 参数）。让位：能弹工具条的消息在悬停区挂 `data-selection-yield`（`useId`），工具条记下它服务的键（`lib/selection-copy.ts` 的小订阅，`useSyncExternalStore`），回复的行动条与你的气泡下那一行只问「是不是我」，只有离开与来到的那一两条重渲染；钉住常显（闪对勾、过程展开）时也让位，工具条一收回到原样。票里说悬停行 chip 间距是 `gap-1`，代码里是 `gap-0.5`（`MessageActions.tsx`、`MessageUser.tsx` 的 chip 组），按 2px 做。改了 `MessageAgent.tsx`（票 55 清单外）三处：`useId` 引入、悬停区一个属性、传给行动条一个 prop。设计文档改了「复制入口统一」的选中一条（壳、chip、让位）、「两条正交的规则」第 2 条，「你的在右」「行动条」「Message Actions」开头与「视觉」各补一句引用。截图在主会话 scratchpad 的 `t56-shots/`（改前改后各 18 张，`compare/` 是上下对照）。
