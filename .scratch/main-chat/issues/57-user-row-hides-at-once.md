# 57 你的消息下那一行离开即收起

Status: needs-dogfood（2026-10-19 快进合入 main，`b813e64d`；主会话复跑门禁：typecheck、lint、两个时区各 1864 条、diff-check 全过）

来源：主聊天 PRD 裁决 109（2026-10-19）。只改 GUI 与设计文档。不上切换器。

## 现状

- 回复的行动条：悬停区是 `MessageAgent.tsx` 的 `group/answer`（气泡加它下面的行动条，行动条在文档流里，中间 6px 也在这个区里），CSS 悬停，一离开就收起。
- 你的消息下那一行（`gui/src/components/conversation/MessageUser.tsx`）：外层 `div` 用 `onMouseEnter={showActions}` / `onMouseLeave={scheduleHideActions}`（约第 344 行），那一行是 `absolute top-full mt-1.5`，挂在下外边距 `mb-7.5` 里。外边距不算外层 `div` 的盒子，指针从气泡往下穿过 6px 空隙就触发离开，所以 `scheduleHideActions` 等 `ACTION_HIDE_DELAY_MS = 600`（约第 151、275–280 行）才收起。

## 要改的

- 让悬停区连续：气泡这一行加上它下面 30px 那条带子都算在区内（比如外层 `div` 加一个看不见的伪元素或命中区，`top-full`、整行宽、高 30px，不占版面）。不改 `mb-7.5`、不改 30px 的间距与外边距合并（票 53 的规则），不挡下一条消息（带子只在外边距里）。
- 离开即收起：删掉 600ms 延迟（`ACTION_HIDE_DELAY_MS` 与相应的计时器），行为同回复的行动条。是继续用 JS 的进出状态（钉住规则在里面）还是改成 CSS 悬停，你定，写理由；钉住常显的规则不变：复制后对勾 1.5 秒、「⋯」菜单开着时常显、选中工具条为这条消息出现时让位（票 56）。菜单关掉时：指针不在区内就立刻收起（现在是排一次 600ms 收起，`MessageUser.tsx` 约第 310 行）。
- 工作台与主对话共用，两边一起变（工作台那一行只有复制一颗，加长消息的「展开 / 收起」）。

## 文档

- `docs/design/conversation.md` 第 562 行附近「共享整行的悬停区，离开后 600ms 才隐，指针从气泡走到 chip 不会追丢」改成新规则（悬停区连上下面 30px 的带子，离开即收起，同回复的行动条），带裁决 109；第 98 行附近「你的在右」那条若提到延迟一并改。全角标点。

## 别动

- 那一行的内容、几何、间距（票 53），选中工具条与让位（票 56），回复的行动条。
- 在跑的票 55 的文件（`MainView.tsx`、`AssistantParts.tsx`、`useLiveLineHandoff.ts`、`live-line-handoff.ts`、`AssistantIdentity.tsx`、`SidebarAssistant.tsx`、`lib/assistant*.ts` 与它新加的切换器文件）。
- `gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now()` 都是 error；工具函数别从组件文件导出。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`。
- `TZ=UTC pnpm --dir gui test` 与 `TZ=America/Los_Angeles pnpm --dir gui test`。
- 单测：离开后立刻收起（没有计时器）；指针在气泡下的带子里时照旧显示；钉住的三种情况照旧；菜单关掉且指针不在区内时立刻收起。
- 自查：临时页里用 playwright 把指针从气泡中心一步步移到最左那颗按钮（每步 2px），证明这一路那一行一直显示；移出带子的下一帧就收起。结果写进回报，截图放 scratchpad、文件名带 `t57-` 前缀，截完删临时页。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 实现说明带 `file:line`：命中区怎么做、用 JS 还是 CSS 悬停及理由、钉住规则怎么保留。
3. 验证命令与结果原样（测试条数、两个时区），指针移动自查的结果。
4. 看到但没改的问题。

## 给 JC 的真机步骤（主会话合入后补全）

1. 主对话里悬停你的一条，再把鼠标移开：那一行和回复的行动条一样立刻收起。
2. 从你的气泡往下移到按钮上：一路不断，能点到。
3. 工作台里你的消息同样。

## Comments

- 2026-10-19（实现）：命中区用 `MessageUser.tsx` 里一个空的 `span`（`absolute inset-x-0 top-full h-7.5`，`aria-hidden`），正好盖住下外边距 `mb-7.5`，在 chip 行之前、被 chip 行（`z-10`）压在下面；没用伪元素，静态渲染的测试看得到它。悬停仍用 JS 进出状态（`hovered`），删掉 `ACTION_HIDE_DELAY_MS` 与它的计时器，离开即 `setHovered(false)`；钉住规则原样（对勾、菜单开着、让位），显示判断挪到 `lib/user-row-hover.ts`（`userRowChipsShown`）。菜单关掉时用浏览器自己的 `:hover` 判断指针在不在区内（`pointerInRegion`），不在就立刻收起。顺手去掉 `handleCopy` 里的 `showActions()`：复制是异步的，指针在剪贴板回来前离开会把行钉住不收。不选 CSS 悬停：要么改 `ActionChip` 的 `revealed`（隐藏时 `aria-hidden`、逐颗 `pointer-events-none`）和 `MessageMenu` 两颗按钮的接口与测试，范围超出本票。自查（Chrome 无头，临时页已删）：两种对话从气泡中心每步 2px 移到最左那颗，0 步隐藏；往下移出带子的第一个像素当场收起。
