# 53 你的气泡悬停时下面出现「复制 · 引用 · ⋯」

Status: ready-for-agent
Blocked by: 51（会碰对话末尾那一行的上边距，`AssistantParts.tsx` 是 51 在改的文件；51 合入后从最新的 main 起分支）

来源：主聊天 PRD 裁决 105（2026-10-19，JC 问你的气泡要不要像回复一样悬停出图标、放哪；主会话给 A 不动、B 下方右对齐、C 气泡里角上「⌄」，JC 选 B）。推翻裁决 73 第 1、2 条的「不挂悬停按钮」。只改 GUI 与设计文档；Core、runner 不动。

## 要的效果

- **主对话里你的气泡**悬停时，下方 6px 出现一行 chip：**复制 · 引用 · ⋯**，右缘对齐气泡右缘，顺序同消息菜单，「⋯」收尾（裁决 99）。外观照回复的行动条（`ActionChip`：24px、14px thin 图标、`tabIndex={-1}`、悬停 `bg-hover` 提墨；「⋯」菜单开着时整条常显、它呈按下态，同回复那颗）。
- **三颗做的事与菜单完全相同**，共用同一个动作，不另写：
  - 复制：你的气泡复制发出去的原文（开头的引用也在），同菜单（`lib/message-menu.ts`）；点了闪对勾，同回复。
  - 引用：跑菜单的「引用」（整条进输入框上方的引用条，`wholeMessageQuote`；回复那颗是 `MessageQuoteButton`，看能不能直接复用），不闪对勾。
  - ⋯：打开你的气泡那份菜单（复制、引用 ── 删除），与右键同一份清单、同一个组件（`MessageMenu.tsx`）。删除灰掉的条件与原因行照旧。
- **只有图片、没有字的气泡**：只有「⋯」（菜单本来只剩删除）。
- **长消息的「展开 / 收起」**：照工作台的做法放在这一行最右，chip 在它左边（`MessageUser.tsx` 约第 380–395 行那段注释说的理由：一直在、守住气泡的边）。今天主对话里它在气泡下面 `mt-1` 单独一行，改成与 chip 同一行。
- **出现与隐藏**：悬停你的气泡（或这一行本身）时出现，离开稍等再隐藏，同工作台的 `showActions` / `scheduleHideActions`。隐藏时用 `opacity` 保留占位。
- **选中弹浮动复制**（`SelectionCopyToolbar`，范围 `user-message`）与右键菜单照留。
- **它的提问你答了的那条**（你的回答）如果也画成你这边的气泡、也有右键菜单，同样加这一行；如果它是另一个部件、没有菜单，照现状，写清楚是哪种。Supervisor / CLI 发进主对话、靠右的消息同样加。

## 间距

- 这一行照工作台：放在你这一行的下外边距里（工作台是 `mb-7.5` 加 `absolute top-full mt-1.5` 的那一行），隐藏时照旧占位。你的气泡下面就是 30px，由这一行占着，下一样东西的上边距并进来、不再叠加。
- 于是：你 → 它 20px 变 30px；它 → 你照旧 30px（回复的行动条占着）；你的两条连着时也是 30px，不再是 4px 的分组（罕见，不另做一套）。
- 规则在 `gui/src/lib/assistant-conversation.ts` 的 `assistantRowGap`（约第 79 行，`AssistantRowSide` 约第 69 行）：现在只有 `agent-bar` 让下一条 `mt-0`，加上你这边带行的那一种。调用处在 `gui/src/components/conversation/Conversation.tsx`（约第 570、669 行）。
- **对话末尾那一行**（`AssistantLiveLine`，`AssistantParts.tsx` 里写死了 `mt-5`）跟在你的气泡后面时，也不能再加 20px：总共 30px。叫醒那一轮没有你的气泡，那一行前面照旧。
- **时间条**紧接在你的气泡下面时，上面不再加（同「紧接在回复下面时上面不再加」）。
- 量：改完在 1480 窗口、标准字号下量你的气泡底到下一样东西（回复、那一行、时间条、它的提问、你的下一条）的距离，回报里列出来。

## 改哪些文件（起点）

- `gui/src/components/conversation/MessageUser.tsx`：`selectionCopy` 分支（约第 371 行）现在什么 chip 都不画；工作台分支（约第 395 行）是现成的几何。主对话要的是同一个几何、三颗 chip。`selectionCopy` 这个名字如果不再贴切就改名，注释里裁决 73 的说法同步改成 105。
- `gui/src/components/conversation/MessageActions.tsx`：回复的行动条，看「引用」「⋯」两颗怎么接菜单，能复用就复用。
- `gui/src/lib/message-menu.ts`、`gui/src/components/conversation/MessageMenu.tsx`：你的气泡那份清单。
- `gui/src/lib/assistant-conversation.ts`、`gui/src/components/conversation/Conversation.tsx`：间距。
- `gui/src/components/conversation/AssistantParts.tsx`：那一行的上边距。
- `docs/design/conversation.md`：「助手的对话」里「你的在右」那条的「**没有悬停复制**」整段改写（带裁决 105、推翻 73 第 1、2 条、写清连发 0 次的依据与 30px 的代价）；「分组间距」那条改成你 → 它 30px；第 71 行「助手的对话里没有悬停复制」、第 490 行附近「用户气泡没有悬停复制」、「消息菜单」里「你的气泡不加悬停按钮（裁决 73），只能右键」对齐新规则。全角标点。devlog 主会话写。

## 别动

- 工作台、子任务、外置运行时：你的消息照旧只有一颗复制，逐像素零变化。门照旧是 `isMainChat` 传下来的那个参数。
- 回复的行动条、过程卡片、菜单的项与顺序。
- 不加新 i18n 文案（复制、引用、更多都有现成的提示与读屏名；真要新键，中英各加并写理由）。
- `gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now()` 都是 error；工具函数别从组件文件导出。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`。
- `TZ=UTC pnpm --dir gui test` 与 `TZ=America/Los_Angeles pnpm --dir gui test`。
- 单测：`assistantRowGap` 的新情形；你的气泡在主对话里有三颗、只有图片时只有「⋯」、工作台里照旧一颗。
- 自查截图（不进仓库，放 scratchpad，文件名带 `t53-` 前缀）：主对话里你的气泡静止、悬停、菜单开着、复制后的对勾、只有图片、长消息带「展开」、你的两条连着、你的气泡后面接那一行 / 回复 / 时间条 / 它的提问；工作台与外置运行时同一画面改前改后对照（证明零变化）；浅色深色、中英文。截完把临时页从工作树删掉。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 实现说明带 `file:line`：chip 怎么接菜单的动作、间距规则怎么改、那一行与时间条怎么并进 30px、你的回答那条是哪种。
3. 量得的间距表。
4. 验证命令与结果原样（测试条数、两个时区）。
5. 截图的绝对路径与每张一句话。
6. 看到但没改的问题。

## 给 JC 的真机步骤（主会话合入后补全）

1. 主对话里悬停你的一条：下面右侧出现复制、引用、⋯，右缘对齐气泡。各点一下：复制有对勾、引用进引用条、⋯ 弹菜单。
2. 看几轮来回：你 → 它的间距变大了 10px，密度能不能接受。
3. 发一条带图片、不带字的：只有「⋯」。
4. 切到工作台会话：你的消息照旧只有一颗复制。

## Comments
