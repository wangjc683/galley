# 150 主对话滚动时气泡跟手有一点弹性（一根弹簧，最远 6px）

Status: needs-dogfood（2026-11-06 代理已 rebase 到 `91d80ac8`，快进合入 `6f502877`（实现 `95dd7603`）。主会话验收：读过弹簧模块的常量与 `scrollTop` 访问器（只装在主对话的滚动元素上、脱开还原、装不上退成只看人的输入）；worktree 复跑 typecheck、lint 过，`TZ=UTC` vitest 259 个文件 2,927 条全过，`check-docs-links` 494 个文件过，`git diff --check` 干净，新增行没有本机路径。要真窗口量：帧间隔（流式回复时滚动、程序写 `scrollTop` 多两次读）、触控板惯性期间 `wheel` 是否不断、手感（代理提醒：滚动快于约 35px/s 时远处就封顶 6px，可能读成「整屏略沉」而不是灵动）、文字在动时清不清楚、与发出 / 交接 / 先说的话叠加；Open risks 1–12 见报告）

真窗口探针（2026-11-06，主会话代测，Quartz 合成触控板滚动事件，带惯性相位）：原样实现下远处的行从约 35px/s 起就一直顶在 6px，滚动全程整屏远处沉 6px、快慢无别；主会话加速度增益（`LAG_GAIN`，由 `FULL_LAG_SPEED_PX_S` = 1,500px/s 反推）并修掉因此暴露的「慢滚每帧被判回位」，`55dc0a28`，裁决 201 第 8 条。改后：慢读约 235px/s 最远 1px、停手 200ms 归位；触控板一推带惯性约 485px/s 最远 3px；快滑约 1,765px/s 顶到 6px、停手 400ms 归位；相邻错位峰值 2px；帧间隔中位 17ms，约 580 帧里两帧过 25ms（手势起点 52ms、惯性尾巴 36ms，孤例）；程序滚动（交接、先说的话的跟随同步）全程偏移 0。WebKit 惯性期间持续收到 `wheel`（Open risk 1 在合成事件下不成立）。S2：在底部继续往下推，截图与静止时逐像素同位，合成事件下看不到原生回弹，待 JC 用触控板推一下确认。

来源：[主对话 PRD](../PRD.md) 裁决 201（JC 2026-11-06：「不做切换器，直接按建议推进」）。只改 GUI 与设计文档；只影响内置运行时的主对话（`MainView` 的 `isMainChat`）；工作台、从助手点开的子任务、外置运行时零变化。不碰 Core、库、CLI、runner。落地回弹（票 151）不在本票，但它要用本票定的弹簧：弹簧做成可复用的一处。

## 为什么

JC 嫌主对话的气泡「死板」，要上下滚动时有「非常轻微的动效」。iPhone 信息 App 滚动时，手指下的气泡跟手，远处的略微落后、停下时弹回，气泡之间的距离有一点伸缩。这里压到很轻：静止时与现在一模一样，一停全部归位。

## 要做到

### 1. 弹簧（可复用的一处）

- 新建一个模块（例如 `gui/src/lib/bubble-spring.ts`，名字你定）：阻尼比 **0.8**（过冲约为位移的 1.5%），约 **350ms** 内从任何起点回到 0.5px 以内；最远落后 **6px**；相邻两行相对错位上限 **2px**。这几个数是常量、集中在这里，注释写清各自表达什么、来自裁决 201。
- 积分器按帧推进（rAF），时间步长用真实帧间隔，掉帧时不爆、不抖；给票 151 留一个「给这一行一个冲量」的入口（它会用：落定时冲过最多 1.5px）。纯函数部分（一步积分、封顶、相邻夹取）放 `lib/`、有单测。

### 2. 滚动时的跟手弹性

- **谁在动**：对话里的每一行作为一个整体（气泡连同它下面的卡片框、过程卡片；时间条；「中途停下」那一行；三点气泡与下面那一行），只动视口里（含上下各留一点余量）的行。
- **怎么动**：人滚动时，这一帧内容滚了 Δ，每一行的显示偏移按「离锚点的距离 ÷ 视口半高（封顶 1）」的比例落后 Δ 的那一部分，再由弹簧拉回 0；偏移封顶 6px，相邻两行的相对错位封顶 2px（同一边只隔 4px，不能叠在一起）。锚点：指针在对话栏上就是指针的纵坐标；不在（键盘翻页、拖滚动条、指针在别处）就是视口中线。效果：滚动时远处的行略微落后，停下时弹回；离指针近的行几乎不动。
- **只在人滚时**：触控板（含惯性那一段）、滚轮、拖滚动条、键盘翻页。程序滚动一律不动：贴底跟随（含回复交接的跟随同步）、发出那一下、跳到搜索命中、「回到底部」、分页加载的保位、删除合拢。按着鼠标拖选文字时不动。你来查清楚这几种在代码里怎么分辨（`lib/animate-scroll.ts`、钉底的写法、WKWebView 惯性滚动会不会发 `wheel`），报告里写明用的判据。
- **不抢别人的 `transform`**：发出时整栏滑（`lib/bubble-motion.ts` 的 `columnSlide`，动的是对话栏里的内容）、删除的拷贝、回复交接的 `clip-path`、待办飞向顶栏、票 149 的先说的话长出来，都已经在用 `transform` / `clip-path`。弹簧的偏移挂在一个没人用的层上（例如每一行外面多一层，或用独立的 `translate` 属性），并保证两者叠加时量位置的代码（`getBoundingClientRect`）不被弹簧偏移带歪：既有那几处在量之前要么先把弹簧归零，要么扣掉偏移，你选并写明。
- **性能**：只写 `transform`（或 `translate`），不进 React 状态、不触发重渲染；滚动与回位期间才提层（`will-change`），静止后撤掉；静止时没有任何 rAF 在跑。
- **减少动态**：完全不动（§2.7「只淡不移」），系统设置实时读。
- **只在主对话**：工作台、子任务、外置运行时一个像素不变，加测试钉住。

### 3. 文档

- `docs/design/conversation.md`「助手的对话」里加一条「滚动时的弹性」（规则、数值、只在人滚时、守的线，引裁决 201）；「滚动：贴底」里注明程序滚动不触发。
- `docs/design/foundations.md` §2.7：这是滚动这一人触发交互的 A 类反馈（有始有终、静止归零），在豁免或说明里写一句它为什么不是 B 类环境噪动；Motion tokens 一节注明弹簧参数不在时长刻度里、在哪个模块。

## 别动

- 既有动效的时长、曲线与行为（发出、交接、叫醒进场、删除与放回、三点、换句与扫光、待办飞行）。
- 滚动本身：不改滚动速度、惯性、`scrollTop`，不写 `scrollTop`。
- 间距（票 148）、气泡样子、行动条。

## 验证

- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`（React 编译器规则：effect 体内同步 setState、渲染期 `Date.now()` 都是 error；组件文件只导出组件）
- `TZ=UTC pnpm --dir gui test`（全量 vitest，跑完照抄条数）
- `node scripts/check-docs-links.mjs`、`git diff --check`
- 单测：积分器收敛（350ms 内到 0.5px 以内、过冲约 1.5%、大帧间隔不发散）；封顶 6px；相邻夹取 2px；锚点距离比例；人滚 / 程序滚的判据；减少动态下不动；工作台不挂。
- jsdom 不排版也不滚动：报告里写明哪些只能真窗口看（手感、掉帧、文字在动时的清晰度、与既有动效叠加）。主会话合入后在 dev 真窗口用帧间隔探针量。

## 环境与边界

- 只在自建 worktree 里做：`git worktree add -b t150-scroll-spring <scratchpad>/wt150 main`（从本地 main 起：本票与裁决 201 只在本地提交里），进去先 `pnpm --dir gui install`。纯 GUI，不用克隆 Rust target。绝不碰主工作树，不跑 `tauri dev`。
- 票 149（先说的话从三点大小的框长出来）在另一个 worktree 并行做，会碰 `useTypingBubbleHandoff.ts`、`typing-bubble-handoff.ts`、`bubble-motion*`、可能 `Conversation.tsx` / `MainView.tsx`。你尽量不改那几处的既有逻辑，只在需要「量之前归零弹簧」时加最小的调用，报告里列出碰过的行，主会话合入时处理冲突。
- gui 不是 prettier-clean：别对整个已有文件跑 prettier，只保证自己写的 hunk 风格一致；新文件可整篇格式化。
- 在分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行（脚本放 scratchpad，文件名用 `t150-` 前缀）。报告里不写绝对路径。
- 长命令（全量测试）前台跑，跑完再往下；别交给后台任务或分叉代理，也别留后台等待循环。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：按上面三节逐条对应 file:line；弹簧模块的接口（给票 151 用的冲量入口）；人滚 / 程序滚的判据；偏移挂在哪一层、量位置的代码怎么处理；改了哪些文件（与票 149 可能重叠的行单列）；验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；只能真窗口看的；看到但没改的（Open risks），原样列出。

## 报告

2026-11-06，worktree 分支 `t150-scroll-spring`。开工后主会话告知票 149 已合入本地 main，我在提交前把分支快进到本地 main `91d80ac8`（含 149 的 `7a3e1420`、`0b1f5024`），无冲突；本票提交 `95dd7603` 在其上，合入时不必再 rebase。

### 1. 弹簧（可复用的一处）

- 常量与注释：`gui/src/lib/bubble-spring.ts:27`（`MAX_LAG_PX = 6`）、`:32`（`MAX_NEIGHBOUR_STEP_PX = 2`）、`:36`（`DAMPING_RATIO = 0.8`）、`:42-43`（`SETTLE_MS = 350`、`SETTLE_WITHIN_PX = 0.5`）、`:47`（`MAX_KICK_PX = 1.5`，票 151 用），每条注释写它表达什么、引裁决 201。刚度不手写：`:137` `naturalFrequency` 按「从 6px 放手、350ms 内回到 0.5px 以内」算出，`:148` `SPRING_OMEGA` 约 8.84 rad/s（时间按 1/ω 缩放，取 ω = 10 的一根求它的稳定时间再换算；采样取偏保守的那一侧）。改 350 或 0.8，刚度跟着变。
- 积分：`:66` `springStep` 用阻尼振子的解析解按真实帧间隔走一步（欠阻尼、临界、过阻尼三种都写了），一帧 16ms、100ms、250ms 或忽长忽短，走到同一处，不发散、不抖。页面上每帧用 rAF 的时间戳之差（`gui/src/lib/bubble-spring-play.ts:375` 起），静止后第一帧按 1/60 秒，最长按 1 秒算。
- 纯函数都在 `lib/` 并有单测：`lagShare`（`:200`）、`anchorDistance`（`:185`）、`lag`（`:212`，顶到 6px 停住、速度归零）、`holdNeighbours`（`:231`，从锚点那一行往外逐行夹 2px，被夹住的行跟着它夹向的那一行的速度走）、`anchorIndex`（`:252`）、`paintedOffsets`（`:275`，画到设备像素格上，格上照样守 6px 与 2px）、`atRest`（`:304`）、`humanScroll`（`:336`）、`kickVelocity` / `kickPeak`（`:177`、`:154`）。
- 给票 151 的冲量入口：`gui/src/lib/bubble-spring-play.ts:533` `kickBubbleRow(container, el, peakPx): boolean`：`el` 是这一行里的任意元素（往上找到行；过程卡片归它的回复），`peakPx` 是要冲过原位的距离（带符号，负数往上，封顶 `MAX_KICK_PX`），由同一根弹簧拉回；不是主对话（没挂弹簧）、减少动态、找不到行时返回 false、什么都不动。`:543` `bubbleSpringScrolling(container)`：人的滚动刚在推这些行（150ms 内），151 用它判「落定时人正在滚动就不加」。冲量只推这一行，邻居不动（测试钉住）。

### 2. 滚动时的跟手弹性

- **谁在动**：`gui/src/lib/bubble-spring-play.ts:115` `readGroups`：对话的每个子元素是一行，`MainView` 在对话栏里画在对话后面的（三点气泡与下面那一行、在问你的提问、步数上限那一行）各是一行；只取视口与上下各 160px（`:62` `BAND_PX`）里的行，二分找起点。回复下面展开的过程卡片是对话里的另一个兄弟元素，不在回复里：给 `ExpandSection` 加了可选的 `role`（`gui/src/components/conversation/ExpandSection.tsx:95`），`AssistantProcessCard` 标上 `assistant-process-card`（`AssistantProcessCard.tsx:145`），弹簧把它并进上面的回复，同一个偏移。
- **怎么动**：`:402` 起找锚点那一行，`:429` 弹簧走一步，`:432` 加上这一帧人的位移乘以「离锚点的距离 ÷ 视口半高（封顶 1）」，`:442` 相邻夹 2px，`:444` 画到像素格上。距离量到行的近边（锚点落在行上为 0，这一行跟手）。锚点 `:395`：滚轮、触控板、触摸时是指针的纵坐标（指针已离开滚动区就用中线），键盘与滚动条时是视口中线。新滚进来或新画出来的行（`:408`）从它旁边已在动的那一行的状态起；从静止起步（第一次滚、只有冲量）每一行都从原位起。
- **人滚 / 程序滚的判据**（`:244` 起的监听、`:313` `count`）：
  - 人的：容器上的 `wheel`（WebKit 把触控板松手后的惯性也作为一串 `wheel` 送来）、`touchstart` / `touchmove`、在容器本身（不是内容）上按下的 `pointerdown`（滚动条，同 `lib/animate-scroll.ts` 的认法）直到松开、文档上的滚动键（与 `animateScroll` 被打断用同一个判断，抽成 `gui/src/lib/animate-scroll.ts:182` `isUserScrollKey`，行为不变：输入框里的键、已被处理的键不算）。滚轮、触摸、松开滚动条后 150ms（`WHEEL_GRACE_MS`），滚动键后 600ms（`KEY_GRACE_MS`）内的位移算人的。
  - 程序的：应用写的每一次 `scrollTop` 都经过一个装在这个滚动容器自己身上的访问器（`:154` `watchWrites`、`:226`）：写之前把到此为止的位移照常记账，写之后把基准挪到新位置，这一下不计。代码里所有程序滚动都是写这个容器的 `scrollTop`（贴底跟随与它的钉底、交接与先说的话的跟随同步、发出那一下、跳到搜索命中、「回到底部」、⌥↑ / ⌥↓、分页保位与 1.5 秒的保持、删除的锚点、输入框长高的钉底；`grep` 过，主对话滚动容器上没有 `scrollTo` / `scrollBy` / `scrollIntoView`），所以人的惯性途中插进一次程序写，也只扣掉那一下。另外 `animateScroll` 在这个容器上跑着时（`scrollDestination` 非空，`:319`）整段不计。
  - 不动：按着鼠标在内容里按下（拖选文字）到松开之间，人的输入也不算（`:277`；鼠标在窗外松开丢了 `pointerup` 时，下一次 `buttons === 0` 的 `pointermove` 复位）。
- **偏移挂在哪一层**：行自己的 `translate`（独立属性，`:479`），不加外层。发出时整栏滑、删除时其余的行合拢、交接的「按住对话栏」与票 149 的 `holdColumn` 都在对话栏的子元素与行上动 `transform`，长出来动 `clip-path`；`translate` 与 `transform` 相加，谁也不抢谁。偏离原位时才加 `will-change: transform`（`:474`），全部回位时撤掉。`will-change` 用 `transform` 而不是 `translate`：WebKit 认 `transform` 一定提层，`translate` 是变换的一部分，层照样只动矩阵；没在 WKWebView 里核实过 `will-change: translate`。
- **量位置的代码怎么处理**：选「扣掉偏移」，不选「先归零」：分页保位在你往上滚、正要加载时发生，归零会在滚动途中把远处的行一下拉回 6px。偏移登记在 `gui/src/lib/bubble-spring.ts:347`，`:358` `bubbleSpringShift(el)` 往上找到行、读它当前画的偏移。
  - 要版面位置的，扣掉：贴底跟随读回复的开头（`gui/src/lib/assistant-conversation.ts:691`）、落地跟随（含先说的话的那次）读回复的开头（`gui/src/hooks/useStickyScroll.ts:120`）、⌥↑ / ⌥↓ 与提交、定位的停靠（`gui/src/lib/conversation-anchor.ts:72`、`:76`）、分页与删除的锚点（`gui/src/lib/scroll-anchor.ts:21` `layoutBox`，用在 `:82`、`:89`、`:102`、`:140`、`:148`）。最要紧的是分页后 1.5 秒的保持：它在每个滚动事件里隔帧重读锚点行，不扣的话弹簧回位会被读成版面漂移、被滚走。
  - 量「看上去在哪」的，照量，不改：交接与票 149 先说的话的起点（`measureTyping`、`playToldLine` 的 `boxInColumn`、`rowPush` 都是同一帧或相邻两次提交的视觉位置，起点就停在看见它的地方）、删除前拷贝的位置、三点离开的拷贝。拷贝是 `cloneNode` 出来的，会带上行内的 `translate`，所以 `copyOf` 去掉弹簧的样式（`gui/src/lib/bubble-motion-play.ts:368` 调 `clearBubbleSpringStyle`，`gui/src/lib/bubble-spring.ts:368`），拷贝停在看见它的地方、不叠两次偏移。票 149 的 `useTypingBubbleHandoff.ts` 一行没改。
- **性能**：只写 `translate` 与 `will-change`；画出来的值没变就不写（按设备像素格量化，持续滚动时顶在 6px 的行每帧不写）；不进 React 状态，`MainView.mount-commits.test.tsx` 的「提交一次」照过；`:465` 全部 `atRest`（偏离小于 0.25px、速度小于 6px/s）就撤样式、停 rAF。从 6px 放手到停 rAF 约 393ms（单测里的数，画面在 350ms 前已到 0.5px 以内）。
- **减少动态**：每个滚动事件与每帧都读 `prefersReducedMotion()`：开着时人的滚动不记账、冲量返回 false；中途打开，下一帧全部归位、停 rAF。
- **只在主对话**：`gui/src/components/screens/MainView.tsx:629` `useScrollSpring({ enabled: isMainChat, scrollContainerRef })`，`gui/src/hooks/useScrollSpring.ts:13`；关着什么都不挂（滚动容器上没有访问器、没有监听）。`MainView.scroll-spring.test.tsx` 真挂载钉住：主对话的行在人的滚轮滚动后落后；工作台同样的滚动后行的 `style` 前后完全相同、没有 `will-change`、滚动容器上没有访问器。子任务与外置运行时走的是同一个 `isMainChat === false`。

### 3. 文档

- `docs/design/conversation.md:297`：「滚动：贴底」末尾加一条：这些都是程序滚动，不触发弹性。
- `docs/design/conversation.md:298-308`：新增「滚动时的弹性」（谁在动、怎么动、数值、只在人滚时、不抢别人的、量位置、减少动态、只在主对话、落地回弹用同一根弹簧、代码与没在真窗口看过的），引裁决 201、票 150、151。
- `docs/design/foundations.md:629-633`：§2.7 加「滚动时的弹性是 A 类」：人触发、只在滚动与回位约 350ms 里动、有始有终、静止时逐像素相同、没有循环与自走，所以不是 B 类环境噪动；减少动态下不动。
- `docs/design/foundations.md:726-730`：Motion tokens 一节加「弹簧也不在这个刻度里」，数值与所在模块。

### 改了哪些文件

新文件：`gui/src/lib/bubble-spring.ts`、`gui/src/lib/bubble-spring.test.ts`、`gui/src/lib/bubble-spring-play.ts`、`gui/src/lib/bubble-spring-play.test.ts`、`gui/src/hooks/useScrollSpring.ts`、`gui/src/components/screens/MainView.scroll-spring.test.tsx`。

改动：`gui/src/lib/animate-scroll.ts`（抽出 `isUserScrollKey`，`:182`、`:240`）、`gui/src/lib/assistant-conversation.ts`（`:1`、`:691`）、`gui/src/lib/conversation-anchor.ts`（`:1`、`:66-78`）、`gui/src/lib/scroll-anchor.ts`（`:10`、`:16-25`、上列五处）、`gui/src/components/conversation/ExpandSection.tsx`（`role` 参数）、`gui/src/components/conversation/AssistantProcessCard.tsx`（`:141-146`）。

与票 149 可能重叠的行（149 改过的文件，或在它的 `bubble-motion*` 范围里）：

- `gui/src/components/screens/MainView.tsx:45`（import）、`:627-629`（`useScrollSpring` 一行与注释，接在 `useRemovedTurnsAnchor` 后面）。
- `gui/src/hooks/useStickyScroll.ts:16`（import）、`:116-121`（`startLanding` 的 `startY` 扣掉偏移）。
- `gui/src/lib/bubble-motion-play.ts:48`（import）、`:367-368`（`copyOf` 去掉弹簧样式；149 没改这个文件）。
- `docs/design/conversation.md:297-308`、`docs/design/foundations.md:629-633`、`:726-730`（都是新加的段落，没改 149 的字）。
- `useTypingBubbleHandoff.ts`、`typing-bubble-handoff.ts`、`bubble-motion.ts` 没碰。已在 149 之上提交，合入无冲突。

### 票面前提与代码对不上的

- 过程卡片不在回复的 DOM 里，是对话里的下一个兄弟元素，没有任何标记：只能加一个 `data-role` 才能让它跟回复一起动（上面 `ExpandSection` 的 `role`）。
- 「指针在对话栏上」我按整个滚动区算（含两侧留白），不是只算 760px 那一栏：两侧留白里滚轮照样滚对话，锚点取指针高度。
- 其余与票面一致；没有扩范围。

### 验证（命令输出照抄）

- `pnpm --dir gui typecheck`：`tsc --noEmit`，无输出，退出 0。
- `pnpm --dir gui lint`：`eslint src --max-warnings 0`，无输出，退出 0。
- `TZ=UTC pnpm --dir gui test`：`Test Files  259 passed (259)`，`Tests  2927 passed (2927)`。其中本票新增 54 条：`bubble-spring.test.ts` 25、`bubble-spring-play.test.ts` 27、`MainView.scroll-spring.test.tsx` 2。
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 494 files checked.`
- `git diff --check`（及提交前 `git diff --cached --check`）：无输出。
- 新文件整篇 prettier；改过的旧文件跑 prettier 与原文逐行相同（0 行差），没对整篇写回。
- 全角标点：scratchpad 里的 `t150-cjk-punct.py` 扫新增行，`checked 2172 added lines; 24 half-width hits`：全是 Markdown 链接的 `](…)` 后面紧跟中文，或代码注释、测试名里英文句子引用中文词（如 `(ruling 201 第 2 条)`），同仓库现有写法；中文句子里没有半角标点。
- 单测覆盖票面要的：350ms 内到 0.5px 以内并保持、过冲 1.4%–1.6%、大帧间隔与不均匀帧间隔不发散且与细步同解、6px 封顶、相邻 2px（含任意像素比 1 / 1.25 / 1.5 / 2 / 3 量化后）、锚点距离比例、离锚点近的行不动、人滚（滚轮、触摸、按键、滚动条）与程序滚（访问器写入、写在人滚途中只扣那一下、`animateScroll`、没有输入、拖选文字、输入框里的键）、减少动态下不动与中途打开即归位、视口外的行不动、回复与过程卡片同一个偏移、只在偏离时提层、静止后没有 rAF 与样式、冲量只推一行且回位、脱开后访问器与监听都撤掉、分页锚点在弹簧回位时漂移为 0、停靠与跟随按版面位置、删除拷贝不带弹簧样式、工作台不挂。

### 提交

`95dd7603 Ticket 150: main chat rows lag your own scroll on one spring (6px at most, 2px between neighbours) and spring back`（报告另一提交，见下一条 `git log`）。

### 只能真窗口看的

- 手感：6px、0.8、350ms 合不合适；稳态下远处的行在每秒约 35px 以上的滚动就顶到 6px，看上去更像「整屏略沉、指针附近有 2px 的伸缩」还是「灵动」，要真窗口看。
- WKWebView 触控板松手后的惯性是否一路发 `wheel`、滚动事件离最后一个 `wheel` 是否在 150ms 内；不是的话惯性那段不动（失败方向是不动）。
- 滚动事件晚一帧：内容由合成线程先滚，行的偏移在下一次主线程帧才写上；流式回复正在渲染、主线程忙时，行相对内容会不会一顿一顿。用帧间隔探针量。
- 掉帧与提层的代价：移动中的行各成一层，长回复是大层；动着时字是否清楚（已按设备像素格画）。
- 与发出时整栏滑、交接、先说的话按住对话栏、删除合拢叠在一起时的样子。
- 拖滚动条：WebKit 的浮层滚动条按下是否把 `pointerdown` 发到滚动容器；不发就是拖滚动条时不动。
- Windows（WebView2）的像素比 1.25 / 1.5 下的台阶感与清晰度。

### 看到但没改的（Open risks）

1. 判据依赖 WebKit 惯性期间持续发 `wheel`；若不发或间隔超过 150ms，惯性段不动（安全方向）。真窗口核。
2. 引擎自己改了 `scrollTop`、又没经过 JS 写的情况（内容变短时被夹、Windows 上 Chromium 的滚动锚定），若正落在人输入后的 150ms / 600ms 窗口里，会被当成人的位移，最多让行落后 6px。代码里没找到会这样触发的路径。
3. 以后若有代码对主对话滚动容器用 `scrollTo` / `scrollBy` / 子元素 `scrollIntoView`，访问器看不到，落在人输入的窗口里时会被当成人滚。今天没有。
4. 访问器是给这一个元素装的自有属性（遮住原型上的 `scrollTop`），脱开时还原；装不上（属性不可配置）时退成只看人的输入。测试里在原型上打桩的写法照常可用。
5. 交接正好落在弹簧在动时：新画出的回复这一行在第一帧从邻居的偏移起，交接量它时还是 0，长出来的底色起点与原位淡出的三点拷贝之间最多差 6px。只在回复落地时你正在滚。
6. 三点离开的拷贝放在最后一次读到的位置（每次提交与尺寸变化时读），不是最后一帧画的位置；之间弹簧若又动了，最多差那段位移。
7. 发出时整栏滑、交接与先说的话的「按住对话栏」期间对话栏 `overflow: clip`；若与人的滚动重叠，栏边上落后的那一行最多被裁掉 6px，持续约 300ms。
8. 行移动时 `translate` / `will-change` 让它成为层叠上下文与绝对定位的包含块：主对话里绝对定位的东西都挂在行内的气泡上（`relative`），菜单与对话框走 Portal，没发现受影响的；工作台的 `z-10` 悬停行不受影响（工作台不挂）。
9. 每一行偏离原位时各提一层：一屏 15–30 行、长回复是大层，滚动时的显存与栅格代价没量过。
10. 1x 屏按整像素画，6px 回到 0 约 6 级台阶，可能显得一顿一顿；像素比 1.25 时 2px 的夹取在格上是 1.6px。
11. 搜索命中的定位（`useStickyScroll` 的 `park` 读命中的位置）没扣偏移：从面板选中要好几秒，弹簧早已静止，碰不到；浮动日期读「看上去」最上面那一行，本来就该照看见的算；问题轨只在工作台。
12. 在滚动容器的空白（左右留白）按下也会被当成按住滚动条，松开后 150ms 内的人滚以中线为锚；只影响锚点，不会让程序滚动动起来。
