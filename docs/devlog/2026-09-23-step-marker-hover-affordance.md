# 步骤 marker：可展开行补回 hover 应答与键盘可达

Date: 2026-09-23
Status: implemented; static gates green; JC does the live visual acceptance;
unreleased
Related: [conversation design §TurnMarker](../design/conversation.md),
[foundations §2.6 光标政策](../design/foundations.md),
[旁白回声步（同日）](./2026-09-23-step-heading-narration-echo.md)

## 起因

JC 真机测试时看到一个带推理的步（揭阳那个 session，「03 扫描到的是监控页
而非Google结果页，需切换到新开的搜索标签页id=1267225408」）：这行点了能
展开推理，但鼠标放上去没有任何反应，用户看不出它能点。

## 现状：不是设计，是一行死样式

`TurnMarker` 的行上写着 `hasDetail && "cursor-default hover:text-ink"`，
但行里三个看得见的元素都自带墨色（summary `text-ink-soft`、序号
`text-ink-muted`、caret `text-ink-muted`），父级 `hover:text-ink` 继承不
下去，hover 时画面零变化。两次各自合理的改动叠起来把 affordance 清零：

- 2026-05-15 原设计：整行 hover + `cursor-pointer`。
- 2026-06-09（`caf1c1a4`）：summary 有了自己的墨色——ink lift 从这天就
  失效，但小手还在撑着。
- 2026-07-16（`bbd2e4a0`，native-feel 轮）：按 foundations §2.6 禁
  `cursor-pointer` 改 `cursor-default`，最后一个信号没了。

同一过程区另两个折叠头都有应答：工具 pill 行是 `<button>`、RunFoldHeader
是 `role=button` + Tab + Enter/Space + `aria-expanded`，两者 hover 都是
`bg-hover` + 提墨。TurnMarker 是唯一一个无 hover、键盘不可达、无
`aria-expanded` 的。回声步之后 marker 常是一两行旁白，11px thin caret 挂
在长句末尾，静止态本来就弱。

## 裁决（JC 全按推荐，不开真机切换器——同族一致的理由已够硬）

1. **A：对齐同族。** 有 detail 的行变成 `role=button` 披露控件（Tab 可达、
   Enter/Space、`aria-expanded`，不设 `aria-label`，可访问名取「第 N 步」
   + summary）；hover / focus-visible 在**内容列**（summary + caret）画
   `bg-hover` 并提墨到 ink，hover 即时、不做颜色过渡。否掉的 B：只修提墨
   ——12px ink-soft → ink 变化太弱，且会成为同族里第三种手感。
2. **序号不进框。** 与裸步合并的 pill 一致（序号在 button 外，hover 目标
   是内容区）；但整行仍可点，悬停序号也点亮内容框（`group-hover`）。框
   左缘落在内容列 −10px，和 inline pill 的 hover 框同一条边，负 margin
   抵消、文字 x 不动；上下不外溢，框就是行框（`-my-0.5 py-0.5` 试过：
   live 窗口的 ExpandSection 裁剪框顶边贴着 marker 行，上沿 2px 被切平）。
3. **拖选文字不触发展开。** summary 保留 `select-text`（回声步的 marker
   就是旁白原文，复制有用）；拖选在行内起止时 click 仍会派发，点击处理里
   选区非空且落在本行就不切换。否掉的：去掉 `select-text`。

不做：恢复小手（违反 §2.6）；静止态放大 caret 或改前置三角（08-06 起
TurnMarker 的展开是辅助细节、故意尾 caret 低调，RunFoldHeader 注释有记；
缺的是 hover 应答，不是静止态）。

## 教训

子元素自带颜色时，父级 `hover:text-*` 是死代码，而且不会报错。给一行
加 hover 提墨，提墨要落在真正显色的那层（`group-hover`），改子元素墨色
的人也要回头看父级有没有依赖继承。

纯前端渲染，内置 / 外置两种运行时模式零差异。
