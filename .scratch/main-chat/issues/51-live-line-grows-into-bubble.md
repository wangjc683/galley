# 51 运行中那一行在落地时长成气泡

Status: ready-for-agent

来源：主聊天 PRD 裁决 103（2026-10-19，JC 问主对话等回复时没有气泡合不合 IM 习惯；主会话给 A 现状、B 三点气泡、C 句子气泡、D 一行长成气泡，JC 选 D）。依赖 47（已合入，`3a887520`）。只改 GUI 与设计文档；Core、runner、提示词不动。

## 要的效果

等的时候不变：对话末尾、它那一边照旧是那一行 12px 灰字（`AssistantLiveLine`，内容规则见 `docs/design/conversation.md`「过程：一行」）。

变的是交接那一下。今天：这一轮有了收口的回复，那一行当即卸载，回复气泡整条瞬间出现，没有入场动效。改成：

- **气泡从那一行的位置长出来**：气泡的底色（`bg-assistant-tint`，四角 12px）从那一行的字框（它的左缘、顶边、宽、高）展开到气泡最终的尺寸；那一行连同计时淡出；气泡里的字淡入。时长 `--motion-slow`（240ms），缓动 `--ease-pop`，只放一次。具体的淡入淡出分段（比如那一行在前半程淡完、字在后半程淡入）你定，写理由。
- **气泡下面跟着的东西**（子任务卡片、提醒卡片等紧贴回复的部件，行动条隐藏时照旧透明占位）不能比气泡先冒出来：在展开的后半程淡入，或者用别的不抢在气泡前面的办法，你定。
- **版面从第一帧起就是最终的**：用 `clip-path`、`transform`、透明度这类不改布局的属性做，不动画 `height` / `width` / `margin`。原因：跟随滚动（`assistantFollowTop`）和「回到底部」靠读真实高度。
- **跟随滚动要和展开同步走完**：回复落地时在跟随（`atBottom`），今天是一次瞬时钉底，屏幕上内容会先跳上去，气泡就从离那一行很远的地方长出来，连续感没了。改成：落地那一次的跟随滚动用与展开同样的时长平滑走到 `assistantFollowTop` 算出的同一个目标（`gui/src/lib/animate-scroll.ts` 的 `animateScroll` 是现成的程序发起平滑滚动，现在的时长策略是 `SCROLL_MIN_MS` 起，需要指定时长就加一个参数，不改别处调用的行为）。效果：短回复读作贴着输入框往上长出来（气泡底边留在那一行的位置附近，顶边往上走）；长回复一边往上走一边往下展开，顶边停在视口顶部下方 32px，跟随照规则放开、「回到底部」照常出现。用户在动画中途滚动就放手，照 `animateScroll` 现有的「中途接手」语义。往回翻着、没在跟随时不滚，气泡在原地长出来。
- **它的提问也一样**：那一行被它的提问气泡接替时（它在问你，那一行本来就不显示），提问气泡同样从那一行的位置长出来。只有气泡本身长，下面的候选与回答框照「气泡下面跟着的东西」处理。
- **减少动态**（`prefers-reduced-motion`，实时读）：只淡不移（foundations §2.7「减少动态的底线」）：那一行淡出、气泡淡入，不展开、不平滑滚动（跟随照旧瞬时）。
- **只放在眼前发生的那次交接上**：这一刻主区开着主对话，并且上一帧那一行在 DOM 里。切会话、整页重载、从工作台回到主对话、翻历史、长对话分页加载、删除后放回时都不放。不出声的回复（`<no-reply/>`）照旧：那一行直接消失，什么都不长。
- 那一行在视口外（往上翻得很远）时放不放都行，看不见；不要为此写特殊分支，除非不写会出错。

## 改哪些文件（起点，按实际需要增减）

- `gui/src/components/screens/MainView.tsx`：约第 646 行渲染 `AssistantLiveLine`（`isRunning && isMainChat && !lineRoundSettled`）；`lineRoundSettled` 在约第 434 行。交接时那一行要么多留一帧取到它的位置，要么平时就在布局后记下它相对内容列的矩形，你定。
- `gui/src/components/conversation/AssistantParts.tsx`：`AssistantBubble`（约第 56 行）、`AssistantLiveLine`（约第 72 行）。
- `gui/src/components/conversation/MessageAgent.tsx`（约第 108 行把回复装进 `AssistantBubble`）、`gui/src/components/conversation/AskUserBubble.tsx`（用 `AssistantBubble` 的两处，哪一处是在问你时的你查）。
- `gui/src/hooks/useStickyScroll.ts`（主对话的跟随，约第 162 行附近的说明）、`gui/src/lib/assistant-conversation.ts`（`assistantFollowTop` 约第 392 行）、`gui/src/lib/animate-scroll.ts`（约第 178 行）。
- `gui/src/globals.css`：要加 keyframes 就加在这里，时长与缓动只用 token（foundations「Motion tokens」：新代码禁止写时长、缓动字面量）。用 Web Animations API 也行，同样从 CSS 变量读 token。
- `docs/design/conversation.md`「助手的对话」里「过程：一行」的「**消失**」一条：改写成交接时长成气泡的规则，带上裁决 103 与本票号；「Sticky-bottom」一节里主对话那条补一句落地那次是平滑的。其余文档不动，devlog 主会话写。

## 别动

- 那一行在等的时候的样子与内容规则（`assistantLineSentence`、shimmer、计时）、侧栏助手卡片、顶栏。
- 工作台、从助手点开的子任务、外置运行时：逐像素零变化。门只有 `MainView` 的 `isMainChat`。
- `animateScroll` 现有调用方（回到底部、⌥↑ / ⌥↓ 等）的行为。
- 不加循环动效；不加新的 i18n 文案（这票应该用不到）。
- `gui/` 不是 prettier-clean：旧文件只格式化你自己的 hunk，不整文件 `prettier --write`；新文件可以整篇格式化。
- React 编译器 lint 规则：effect 里同步 `setState`、渲染期读 `Date.now()` 都是 error；状态归零用 guarded setState-in-render；工具函数别从组件文件导出。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`git diff --check`。
- 全量测试跑两个时区：`TZ=UTC pnpm --dir gui test` 与 `TZ=America/Los_Angeles pnpm --dir gui test`（命令名以 `gui/package.json` 为准）。
- 「放不放」的判断尽量抽成纯函数加单测：眼前的交接放；切会话、重载后首帧、分页加载、`<no-reply/>`、工作台不放；减少动态走只淡。
- **自查帧条**（不进仓库，放 scratchpad，文件名带 `t51-` 前缀）：做一个临时渲染页（Vite 页或 Chrome 无头，Tauri 依赖用桩），把动画停在 0 / 60 / 120 / 180 / 240ms 各截一张（Web Animations 的 `currentTime` 或负的 `animation-delay` 加暂停），拼成帧条。情形：短回复在底部跟随、长回复（停在顶部下方 32px）、往回翻着时、它的提问、带子任务卡片的回复、深色、减少动态。再截一组工作台与外置运行时的落地前后，证明零变化。截完把临时页与脚本从工作树删掉。

## 回报格式

1. 提交列表（`git log --oneline` 原样输出）。
2. 实现说明：用什么做的展开、那一行的位置怎么取、滚动怎么同步、「放不放」的判断在哪里，各一两句带 `file:line`。
3. 你自己定的几处（淡入淡出分段、气泡下面的东西怎么跟、提问气泡）各一句理由。
4. 验证命令与结果原样（测试条数、两个时区）。
5. 帧条的绝对路径与每张一句话描述。
6. 你看到但没改的问题。

## 给 JC 的真机步骤（主会话合入后补全）

1. 主对话发一句一步就能答的（「现在几点」）：看那一行写出回复的第一句后，气泡是不是从它那里长出来。
2. 发一句要跑几步的（「明天早上 9 点提醒我喝水」）：看等的时候和以前一样，落地那一下是否连续。
3. 发一句会得到长回复的：看长到一屏时的快慢、停在顶部下方的位置。
4. 往上翻着等它回：气泡原地长出来，不拉视口，「回到底部」有圆点。
5. 系统设置打开「减少动态效果」再发一句：只淡，不展开。
6. 切到工作台会话再切回来、⌘R 重载：已经在的回复不再放动画。

## Comments

- 2026-10-19（实现子代理）：已在分支 `main-chat-51-line-grows-into-bubble` 做完，待主会话合入与 JC 真机。展开用 Web Animations 的 `clip-path`（那一行的字框 → 气泡，`--motion-slow`、`--ease-pop`），那一行是它最后一帧的拷贝，放在原位、不占版面，用 `--motion-fast` 淡出；字与气泡下面跟着的东西（卡片、候选、行动条里的按钮、汇报回复上方新出现的时间条）从这段的一半淡入到展开结束。那一行的位置在每次有它的提交后与尺寸变化时记下（`hooks/useLiveLineHandoff.ts`）。跟随：`animateScroll` 加了定时模式 `ScrollTiming`（同一个时长与曲线、从第一帧起算、不远跳、改目标不改结束时刻），落地那次走它，旧调用方行为不变；对话不满一屏（贴底 `mt-auto`）时把栏里的内容按回原处、同曲线放上去。放不放的判断在 `lib/live-line-handoff.ts` 的 `liveLineHandoff`，有单测。顺带：提问一到那一行就让位（原来要等 `run_complete`，文档本来就这么写）。自查帧条与工作台、外置运行时的改前改后逐帧相减（全为零）在主会话的 scratchpad，文件名带 `t51-`。设计文档只改了「过程：一行」的交接一条与 Sticky-bottom 的主对话一句；「平滑滚动」一节「走它的四处」现在是五处，按票没动，留给主会话。
