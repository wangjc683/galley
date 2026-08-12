# waku 前端细节通读：取一条，其余归档

日期：2026-08-12
关联：`ToastHost.tsx`、`lib/toast-timing.ts`、
[design/onboarding-and-cards.md](../design/onboarding-and-cards.md)

## 背景

[markdown 那一轮](./2026-08-12-inline-code-warm-ink.md)之后，把
[egoist/waku](https://github.com/egoist/waku) 的 `src/app/` + `src/ui/`
通读了一遍，专门找设计与动效细节。结论：**只有一条是真缺陷**，落地了；其余
要么是取向、要么 Galley 已经持平或更好。本文把结论存下来，免得日后重扫一遍。

## 落地的一条：toast 倒计时悬停暂停

`ToastHost` 原本是一个平的 `setTimeout(dismiss, 6000)`，没有任何暂停。

waku（`app.rs:118-122`，注释说抄的 Zed）：悬停暂停倒计时，离开后保证至少
`MINIMUM_TOAST_RESUME_DURATION = 800ms`。

**对 Galley 这不是打磨是缺陷**——toast 带 `重启 Channels` / `查看项目` /
`查看 Goal` / `重启更新` 这类 CTA，鼠标伸向按钮的路上 toast 消失就点空了。
慢读的人更容易触发。

实现：`held`（悬停 **或** 焦点在内部）暂停计时并把剩余时间存进 ref，恢复时
从剩余时间继续。焦点也算，因为动作按钮 Tab 得到——只认 hover 会让键盘用户
的按钮从 Tab 下面被抽走。`onBlurCapture` 用
`currentTarget.contains(relatedTarget)` 排除 toast 内部两个控件之间的移动。

下限 `Math.min(800, total)`：调用方要 300ms 就给 300ms，不能因为指针蹭了
一下就变 800ms。计时规则抽成纯函数 `lib/toast-timing.ts` 单测（waku 自己在
scrollbar 里也是这么做的——"Pure, so the timing is testable"）。

## 学到但没做的手法

- **入场从 0.4 起而不是 0 起**。waku toast：150ms `ease_out_quint`，位移
  8px，opacity **0.4→1**。Galley `fade-in`：160ms，位移 2px，opacity 0→1。
  时长几乎一样但两个参数是反的——waku 读作「本来就在，正在落位」，Galley
  读作「凭空出现」。150ms 尺度上从 0 淡入容易读成闪烁。**取向问题，未改**，
  但 toast 上值得试。
- **reduce-motion 的静止帧应该被设计，而不只是被关掉**。waku 三点波浪在
  reduce-motion 下停在循环第一帧——首点亮尾点暗，读作有方向的省略号。
  Galley 是一次性把 8 个 class 设成 `animation:none; opacity:1`，三点等亮。
  结果可接受，**未改**；但原则值得记：关动画时要问「停在哪一帧」。
- **三点动画的相位**：waku 用正弦波 + 相位偏移，Galley 用 keyframes +
  `animation-delay`。视觉接近，CSS 那条更简单。**不用改。**

## 待实机确认（没动，也不该盲改）

- **展开/折叠时的阅读位置**。waku `transcript_view.rs:671`：重新测量行会改
  高度，而底部对齐的列表跨这个变化保持像素偏移，结果视口落到内容末尾之后
  什么都看不见；解法是变化前记逻辑位置、变化后恢复。Galley 的 ToolCallout
  可折叠 + `useStickyScroll` 有 sticky-bottom，浏览器 `overflow-anchor` 默认
  会处理，但**和自定义 sticky-bottom 同时存在时容易打架**。测法：滚到对话
  中间，展开一个视口上方的 tool callout，看视图跳不跳。
- **菜单打开时输入框保留视觉焦点**。waku `transcript_view.rs:900`：菜单打开
  时 composer 保持*视觉*焦点，"opening one never looks like it defocused the
  input"。Galley 用 Radix，焦点会真的移走、焦点环消失。在 composer 常驻焦点
  的产品里体感明显。
- **陈旧滚动位置泄漏**。waku 的 model picker 打开时把当前模型行滚进视野，
  **找不到就回顶部**，免得上次打开的滚动偏移漏进新列表。Galley 的
  CommandPalette / 模型选择器值得对一下这个 case。

## Galley 已经持平或更好（勿重复提议）

- 队列 chips 点击取回编辑：`ComposerQueueStrip` 已有
- rail 的 hover-intent（延迟进、立即出）+ `preventMouseFocus` + 聚簇标记 +
  百分比截断：`UserQuestionRail` 比 waku 的 rail 更细，waku 只做了
  keyboard-focus 门控
- 工作指示在提交瞬间出现（不等第一个 token）：两边都有
- rename / archive 不 bump 排序时间：`core/src/api.rs:191` 早有明确契约
- Escape 作用域：Galley 没有 document 级 Escape→stop 绑定，不存在 waku 要防
  的 fall-through
- 滚动条：Galley 在 macOS 保留原生 overlay scrollbar（`globals.css:507` 那段
  注释写了为什么绝不能加 `scrollbar-width`），waku 手写 overlay scrollbar
  的经验用不上

## 被否的：侧栏相对时间

waku 每行显示 `3m` / `15h` / `3d`。JC 看过后决定**不做**。

补一条当时没查清的事实：waku 那个时间不是单纯「最后活跃」。
`sidebar.rs:168` 写的是——**running 时显示当前 turn 已经跑了多久，settled 时
显示 agent 上次回复距今多久，从没回复过则不显示**。所以它本身就是「卡住的
running session」的停滞信号，不是装饰性的近期列。

决定不变（Galley 的行副栏已经用来放 `第 N 步 · {recap}`，信息密度更高，
没有空位）。日后如果真收到「看不出某个 session 卡住了」的反馈，正确修法是
**条件信号**（只在 running 且超阈值时显示 elapsed），不是常驻列。
