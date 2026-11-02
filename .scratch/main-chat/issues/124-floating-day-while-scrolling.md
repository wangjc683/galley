# 124 往回翻主对话时，顶上浮一颗日期胶囊

Status: needs-review

来源：[主对话 PRD](../PRD.md) 裁决 171；落实 deferred「滚动时浮动日期（主对话往回翻）」（`docs/devlog/deferred.md:840`）。只改 GUI 的主对话、它的测试与文档；不动 Core、CLI、Agent API、迁移；工作台会话零变化；外置运行时没有主对话，零变化。

## 为什么

主对话是一条没有尽头的对话，时间只在断点画成两条消息中间居中的一行（第一条、隔 60 分钟以上、跨天）。往回翻时要找到时间行才知道翻到了哪天。JC 往回翻了两周的主对话，定现在做。

## 要做到

1. **写什么**：视口最上面那一行属于哪天。文字用 `formatPastDay`（`gui/src/lib/message-time.ts:450`），日子的字照备忘页现成的取法（`gui/src/lib/memo.ts:167` 的 `memoDayLabel` 用 `copy.todo.dayToday` / `dayYesterday`；你可以复用它，或者照它的取法，别复制字符串）：昨天、10月28日，别的年份带年份；不写星期、不写钟点。英文照 `formatPastDay` 的英文。
2. **「最上面那一行」怎么定**：对话的行是 `[data-role="conversation"]` 的子元素（`gui/src/lib/scroll-anchor.ts` 的 `ROWS_SELECTOR`；`firstRowBelow` 已导出，按二分找视口顶边穿过的那一行）。行上现在没有时刻：在 `Conversation.tsx` 生成行的地方给有消息的行带上它的时刻（比如 `data-at`，毫秒），没有自己时刻的行（时间行、间隔、过程窗口等）取它下面最近一个有时刻的行。哪条消息的时刻代表一行、取 `created_at` 还是别的，读代码后按「这一行画的是哪天说的话」定，在报告里说明。只读不写滚动位置。
3. **什么时候出现**：
   - 主对话的滚动容器（`MainView.tsx` 里 `data-conversation-backdrop` 那个）有滚动事件就出现，停手 1000ms 后淡出；滚动中日子变了就换字。
   - **最上面那一行是今天时不出现**（正在显示时滑回今天就照常淡出）。比今天还晚的时刻（时钟偏差）按今天算，同 `formatPastDay`。
   - 打开主对话、切会话、从工作台回到主对话那一下贴底不算滚动。怎么区分请读 `gui/src/hooks/useStickyScroll.ts`（会话切换后有 500ms 的窗口，`:874` 附近的注释）与 `useEarlierTurns.ts` 现在怎么判「已滚动」，取一个现成信号，不另造计时；报告里说明用了哪个。
   - ⌘K 定位、⌥↑ / ⌥↓、点「回到底部」引起的滚动照样算：落在旧日子上就出现（落到底是今天，自然不出现）。
   - 「今天」用 `useDayStamp()`（跨午夜照它重读）。
4. **在哪、什么样**：
   - 位置：对话区（`MainView.tsx:633`，`data-conversation-area` 那个 `relative` 容器）顶部正中，`absolute inset-x-0 top-3 z-10 flex justify-center pointer-events-none`，与底部的「回到底部」（`MainView.tsx` 约 `:982`，`bottom-4`）上下对称。只在 `isMainChat` 时渲染。
   - 外观同「回到底部」那颗的材质：`border border-line bg-elevated/92 shadow-[var(--shadow-float)] backdrop-blur-md`，`rounded-full`，高 24px（`h-6`），左右内边距 10px（`px-2.5`），字 12px、`leading-none` 或对齐到 24px 居中、`text-ink-soft`、`tabular-nums`、不换行。不可点、不抢焦点，`aria-hidden="true"`（对话里的时间行照旧给读屏）。
5. **动效**：只动透明度。出现 `--motion-fast` 淡入，消失 `--motion-slow` 淡出（`duration-(--motion-fast)` 这类写法，见 `globals.css:292` 附近的说明）。不位移、不缩放。减少动态效果下照留淡入淡出（`docs/design/foundations.md` §2.7「只淡不移」），不另加分支。
6. **性能**：滚动时每帧最多读一次（rAF 合并），二分找行；字没变不 setState。`gui/` 有 React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都是 error；状态归零用 guarded setState-in-render，工具函数别从组件文件导出。
7. 纯逻辑放 `gui/src/lib/`（比如给定最上面那一行的时刻、今天零点、语言与字，返回要写的字或 `null`），接线放 hook，画法放组件；命名照附近文件的习惯。

## 别动

- `gui/src/hooks/useEarlierTurns.ts`、`gui/src/lib/scroll-anchor.ts` 的逻辑：票 123（补页跑道）在并行改它们。只读、可以 import 已导出的函数，不改。
- 工作台会话的任何行为与样子；时间行本身（`MessageTimeDivider`）的规则与样子；「回到底部」按钮。
- 主工作树（JC 的 `tauri dev` 在那里跑着）。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui exec vitest run <你新增和改到的测试文件> src/components/conversation src/lib/message-time
TZ=UTC pnpm --dir gui exec vitest run <同上>
TZ=America/Los_Angeles pnpm --dir gui exec vitest run <同上>
pnpm --dir gui test        # 全量 vitest，收尾前跑一次
git diff --check
```

- 测试：纯逻辑（今天 → 不出现；昨天；今年更早；别的年份；比今天晚 → 不出现；中英）；行的时刻（有时刻的行、没有时刻的行取下面最近的）；出现与淡出的时序（假时钟：滚动后显示、1000ms 后隐去、滚动中日子变了换字、最上面是今天不显示、贴底那一下不显示）；只在主对话渲染、工作台不渲染。jsdom 不排版，位置相关的用可注入的量法或 mock `getBoundingClientRect`。
- **真 CSS 看一次**：一次性静态预览（真 Tailwind 产物、真字体，playwright 无头浏览器；文件放 scratchpad、用 `t124-` 前缀，不进仓库、不放 `gui/` 下）。内容全部虚构。截：胶囊压在你的气泡上、压在回复气泡上、压在时间行附近各一张，浅色与深色，2 倍像素；量出胶囊的宽高与离对话区顶的距离。报告给截图路径。
- 中文（报告、设计文档、deferred）用全角标点，收尾前自己扫新增行（脚本放 scratchpad，用 `t124-` 前缀）。`gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk，新文件可以整篇格式化。

## 文档

- `docs/design/conversation.md`「助手的对话」里，靠近「时间：居中」（`:243`）加一条「浮动日期」：写什么、什么时候、在哪、样子、动效、只主对话，标 2026-11-02、裁决 171、票 124；写明与时间行「不加胶囊底」不冲突的理由（浮在滚动内容上没底读不出），以及「当天第一条的时间行滑到顶上时会和胶囊同写一天，先不处理」。
- `docs/devlog/deferred.md:840` 那一条：状态改成已做（2026-11-02，裁决 171、票 124），写明与原方案的两处不同（最上面是今天不出现；减少动态下照留淡入淡出），原记录保留。

## 环境与边界

- 只在主会话建好的 worktree 里做（路径见派单），先 `pnpm --dir gui install`。不跑 `tauri dev`。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push。
- 引用匹配行时用 `grep`，不要用 `rg`（本机 `rg` 输出会改写搜索词）。本文件在开源仓库里：不写本机用户名路径、worktree 路径，报告里 scratchpad 写成 `<scratchpad>/…`。

## 回报

写在本文件末尾「## 报告」一节（同时把开头 `Status:` 改成 `needs-review`），并在最后一条消息里给主会话：

1. 改了哪些文件、哪几处；行的时刻怎么带、取哪条消息的时刻；「贴底那一下不算」用了哪个现成信号。
2. 截图路径（scratchpad），胶囊实测宽高与离顶距离。
3. 门禁命令与结果行（含两个时区）。
4. 设计文档与 deferred 改了哪几条。
5. 看到但没改的（Open risks），原样列出。

## 报告

（2026-11-02，执行代理。只在 worktree 分支 `t124-floating-day` 上改，没碰主工作树、没跑 `tauri dev`。行号按本分支的提交。）

### 1. 改了什么

**新文件**

- `gui/src/lib/floating-day.ts`（纯逻辑与读行）：`floatingDayLabel(atMs, todayStartMs, language, words)`（`:102`）今天、比今天晚、没有时刻都返回 `null`，其余走 `formatPastDay`；`timedRowAt`（`:49`）一行没有时刻就往下找最近有时刻的行，不往上找；`topRowAt(container, probe)`（`:77`）用 scroll-anchor 导出的 `firstRowBelow` 二分找行，只读不写；`rowAt(iso)`（`:37`）把 ISO 时刻转成毫秒；`ROW_AT_ATTRIBUTE = "data-at"`（`:20`）；`FLOATING_DAY_PROBE_PX = 36`（`:33`，见第 6 条）。`ROWS_SELECTOR` 在 `scroll-anchor.ts` 里没导出、那个文件归票 123，所以这里另写了一份同值常量（`:16`）。
- `gui/src/hooks/useFloatingDay.ts`（接线）：容器上挂一个被动滚动监听，rAF 合并，每帧最多读一次（`topRowAt`）；日子没变不 setState（闭包里记着上次设的值）；第一次读到才 `setScrolling(true)`，每次读都重设 1000ms 计时（`FLOATING_DAY_IDLE_MS`，`:9`），到点 `setScrolling(false)`。日子存成当地零点，字在渲染时按 `useDayStamp()` 与语言算，跨午夜自己重算；淡出时字留在最后一次的日子上（渲染期带守卫的 setState）。`shown = scrolling && !atBottom && label !== null`（`:99`）。
- `gui/src/components/conversation/FloatingDay.tsx`（画法，`memo`）：外层 `pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center`、`aria-hidden="true"`、`data-role="floating-day"`；胶囊 `h-6 rounded-full border border-line bg-elevated/92 px-2.5 shadow-[var(--shadow-float)] backdrop-blur-md`、`text-ui-meta leading-none whitespace-nowrap text-ink-soft tabular-nums select-none`；显示时 `opacity-100 duration-(--motion-fast) ease-firm`，隐去时 `opacity-0 duration-(--motion-slow) ease-exit`，只有 `transition-opacity`，没有减少动态分支。一开始就挂着（空、透明），第一次出现也是淡入。
- 测试：`gui/src/lib/floating-day.test.ts`（17 条：今天、今天零点与 23:59、比今天晚、昨天两端、今年更早含两天前也写日期、别的年份、跨午夜换戳、中英；`rowAt`；`timedRowAt` 有时刻、取下面、不往上、无行；`topRowAt` 假排版：顶边量、时间行取下面、胶囊下沿量、400 行只量 ≤10 行且不写 `scrollTop`）、`gui/src/components/conversation/FloatingDay.test.tsx`（7 条，假时钟连 rAF：挂上时透明且不挡指针、滚动后显示、停手 1000ms 后隐去且字留着、滚动中换日子、时间行取下面、最上面是今天不显示、滑回今天淡出、贴底不显示、离开底部显示、回到底部收起、多个滚动事件一帧只读一次且不写滚动位置、英文）、`gui/src/components/conversation/Conversation.floating-day.test.tsx`（3 条：主对话每行的 `data-at` 按顺序核对，过程卡片打开时也核；时刻在行本身上；工作台的行一个 `data-at` 都没有）。

**改的旧文件**

- `gui/src/components/conversation/Conversation.tsx`：`AgentTurnView` 加 `at` 参数（`:1217`、`:1263`），写在它的根 `div` 上（`:1405`）；`userRow` 给 `MessageUser` 传 `at`（`:602`，只主对话）；`renderItem` 给 `AgentTurnView` 传 `at`（`:661`，只主对话，管主对话里照工作台画的那几种行）；`renderLineRow` 给答过的提问（`:736`）与回复、问候（`:766`）传 `at`；`renderStoppedRun` 给「中途停下」那一行传 `at`（`:822`）。
- `MessageUser.tsx`（`:222-225`、`:378`）、`AskUserBubble.tsx` 的 `AnsweredAskUser`（`:345-348`、`:398`，气泡那一支）、`AssistantProcessCard.tsx` 的 `AssistantStoppedRun`（`:216-219`、`:252`）：各加一个可选 `at`，写成根元素的 `data-at`。没传时 React 不写这个属性，工作台的 DOM 一字不变。
- `gui/src/components/screens/MainView.tsx`：一行 import（`:33`），「回到底部」那块前面加 `{isMainChat && <FloatingDay scrollContainerRef={scrollContainerRef} atBottom={atBottom} />}`（`:969-977`）。别的没动，`useEarlierTurns.ts`、`scroll-anchor.ts` 没动。
- `gui/src/components/screens/MainView.assistant.test.tsx`：加一条（`:538`），主对话有且只有一颗、位置与料子的类名、静止时透明；工作台没有。

**行的时刻取哪条消息**：按「这一行画的是哪天说的话」：

- 你的话：`UserTurn.createdAt`（库里是 `messages.created_at`，乐观发送时是本机时钟）。
- 回复、问候、它问你的问题（答过的）、「中途停下」那一行：那一步的 `AgentTurn.settledAt`。恢复时是那一行的 `created_at`（`rowsToTurns.ts:100`），在跑时是 `turn_end` 的 `timestamp`（`ipc-handlers.ts:789`）。回复画的是收口那一步说的话，所以取它落定的时刻，不取你那句的时刻：零点前问、零点后答的回复算第二天（测试里有这一条）。问候 `settledAt` 缺了退回 `createdAt`。「中途停下」取最后一步落定的时刻。
- 没有自己时刻的行：时间行、过程卡片、系统行、主对话里照工作台画的步骤区，取下面最近一个有时刻的行（票面规则）。

**「贴底那一下不算」用的信号**：`useStickyScroll` 的 `atBottom`（`:297`，滚动监听里按离底 24px 判，`:331`）。打开、切会话、从工作台回来那一下的贴底（`:629` 写到底并 `setAtBottom(true)`），以及之后 500ms 窗口里的补贴底（`:650`），都在 `atBottom` 为真时发生；回复长出来时的跟随（`:364` 起，`atBottom` 为假就不跟）与输入框长高时保住底部也一样。所以 `atBottom` 为真时的滚动都是 Galley 自己滚的，胶囊不出；你一离开底部 `atBottom` 就是假的。⌘K 定位（硬写 `scrollTop`）、⌥↑ / ⌥↓、点「回到底部」的追底途中都离开了底部，照样出；到了底部就收。没用的两个：500ms 窗口是贴底那个 effect 里的局部计时，没导出，也管不到之后的跟随滚动（早上第一句发出后跟随回复时，屏幕顶上常常还是昨天，会每次闪「昨天」）；`useEarlierTurns` 的「已滚动」其实是「有滚动事件」（`:75`，贴底自己的滚动事件也算），它靠的是位置（离顶近），同样是位置判据。没另加计时。

### 2. 截图与实测

真 Tailwind 产物、真字体（Inter + 苹方），playwright-core 驱动本机 Chrome 无头，2 倍像素，视口 1000×700。页面是一次性的 Vite 预览，渲染真实的 `Conversation`（主对话）放在 `MainView` 对话区同样的类名里，上面是真实的 `FloatingDay`，底部抄了一颗「回到底部」作对照；对话内容全部虚构。文件都在 `<scratchpad>/` 下，带 `t124-` 前缀，不在仓库里：

- 压在你的气泡上：`<scratchpad>/t124-shots/t124-user-light.png`、`<scratchpad>/t124-shots/t124-user-dark.png`（「10月28日」）
- 压在回复气泡上：`<scratchpad>/t124-shots/t124-reply-light.png`、`<scratchpad>/t124-shots/t124-reply-dark.png`（「昨天」）
- 时间行附近（时间行在胶囊下面 10px）：`<scratchpad>/t124-shots/t124-time-light.png`、`<scratchpad>/t124-shots/t124-time-dark.png`（「10月28日」，下面是「昨天 21:14」）
- 加一张：时间行在胶囊底下：`<scratchpad>/t124-shots/t124-time-under-light.png`（「昨天」，同写一天的那种，见第 5 条）
- 量数：`<scratchpad>/t124-shots/t124-measure.json`；预览页与脚本：`<scratchpad>/t124-preview/`、`<scratchpad>/t124-pw/t124-shots.mjs`

实测（浅深一致）：高 24px；宽「10月28日」81.6px、「昨天」46px；离对话区顶 12px；水平居中偏差 0；「回到底部」离对话区底 16px。字 12px、浅色 `rgb(87, 83, 76)`、深色 `rgb(186, 191, 197)`；底 `bg-elevated` 92%、1px `border-line`、`--shadow-float`、`blur(12px)`。过渡：显示时 `opacity 0.12s cubic-bezier(0.2, 0, 0, 1)`，隐去时 `opacity 0.24s cubic-bezier(0.4, 0, 1, 1)`；停手 1.5 秒后量到 `opacity: 0`。

### 3. 门禁

```
pnpm --dir gui typecheck                                   exit 0
pnpm --dir gui lint                                        exit 0
pnpm --dir gui exec vitest run src/lib/floating-day.test.ts src/components/conversation/FloatingDay.test.tsx src/components/conversation/Conversation.floating-day.test.tsx src/components/screens/MainView.assistant.test.tsx src/components/conversation src/lib/message-time
  Test Files  37 passed (37)    Tests  359 passed (359)
TZ=UTC（同上）
  Test Files  37 passed (37)    Tests  359 passed (359)
TZ=America/Los_Angeles（同上）
  Test Files  37 passed (37)    Tests  359 passed (359)
pnpm --dir gui test
  Test Files  241 passed (241)  Tests  2687 passed (2687)
git diff --check                                           无输出
```

新文件用 prettier 整篇格式化过；旧文件只核了自己的 hunk（`Conversation.tsx` 里 prettier 会改的两处是原有的，没动）。中文全角标点用 `<scratchpad>/t124-cjk-punct.py` 扫了新增行：两篇文档与本报告 0 处；代码里报的 7 处都在英文注释里（英文句子引用中文词，标点按英文用半角），照旧。

### 4. 文档

- `docs/design/conversation.md`「助手的对话」里，「时间：居中」及其两条子项之后、「滚动：贴底」之前，新加一条「浮动日期」（`:246` 起，9 行）：写什么（含行的时刻取法）、「最上面」在胶囊下沿量及其理由、什么时候（含 `atBottom` 这个信号与哪些滚动算、哪些不算）、在哪与样子（含实测宽度）、与时间行「不加胶囊底」不冲突的理由、动效、只主对话、先不处理的「同写一天」；标了 2026-11-02、裁决 171、票 124。
- `docs/devlog/deferred.md`「滚动时浮动日期（主对话往回翻）」：状态改为已做（2026-11-02，裁决 171、票 124），写明与原方案的两处不同（最上面是今天不出现；减少动态下照留淡入淡出），并记了样式定为「回到底部」的料子、工作台不跟，指向设计文档；原来的「状态：暂存」改成「原状态：暂存」留着，其余原记录不动。

### 5. 看到但没改的（Open risks）

1. **贴着底部时一律不出**：用 `atBottom` 的代价。早上还没说话时对话的底部就是昨天，这时在离底 24px 以内滚几下不出胶囊；从上面滚回底部时，一进 24px 胶囊就收起，哪怕顶上还是昨天。没真机核过这种时候会不会想看到「昨天」。
2. **恢复慢于 500ms 的打开**：主对话第一次打开要从 SQLite 读一页；读得比贴底的 500ms 窗口慢时，贴底的跟随可能停在最后一条回复的开头（`assistantFollowBottom`，现有行为），`atBottom` 变假；那条回复若是前几天的，打开时胶囊会出现 1 秒。只读代码推出来的，没复现过；本地一页通常几十毫秒。
3. **零点前后的回复落定**：回复比一屏长、落定时停在回复开头（贴底的跟随上限）而不是到底时，`atBottom` 为假，落定那段滚动会读顶上的行；你那句若在零点前，胶囊会写「昨天」。很少见，没处理。
4. **打开的过程卡片取下面一行的日子**（票面规则）：过程卡片压在顶上、它下面一条又是另一天时，胶囊写的是下面那天，不是卡片所属回复那天。卡片要点开才在，跨天又要正好在它后面，没为它改规则。
5. **同写一天**：当天第一条的时间行滑到胶囊底下时，胶囊和时间行写同一天；胶囊「昨天」只有 46px 宽，时间行「昨天 21:14」的头尾会从两边露出来（`t124-time-under-light.png`）。裁决 171 第 5 条定了先不处理。
6. **两天上下叠着**：时间行刚好在胶囊下面时，胶囊写前一天、紧下面的时间行写后一天（`t124-time-light.png`：「10月28日」下面是「昨天 21:14」）。按规则是对的（顶上还是 10 月 28 日那条回复的尾巴），读起来会不会别扭，要真机看。
7. **只在无头 Chrome 和 jsdom 里验过**：没在 Tauri 的 WKWebView 里看过，毛玻璃压在滚动的内容上滚动时的开销、120 / 240ms 淡入淡出的手感、Windows WebView2 都没核。贴底不出是用 `atBottom` 这个参数测的，没有带真实 `useStickyScroll` 贴底的集成测试（jsdom 不排版）。
8. **`ROWS_SELECTOR` 有两份**：`lib/floating-day.ts:16` 抄了 `scroll-anchor.ts` 里没导出的同值常量；票 123 若导出它，可改成 import。

### 6. 与票面不同的地方

- **「最上面那一行」在胶囊下沿量，不在视口顶边**（`FLOATING_DAY_PROBE_PX = 36`，即 `top-3` 加 `h-6`）。票面写的是「视口顶边穿过的那一行」。按顶边量时，预览里当天第一条的时间行滑到胶囊后面的那 40px 左右，压在顶边上的是上一条回复留给行动条的 30px 空白（悬停才显示），胶囊写「10月28日」，正好遮住写着「昨天 21:14」的时间行，屏上露出来的全是昨天的内容。改在下沿量后，时间行一碰到胶囊就换成「昨天」，也就是裁决 171 第 5 条预期的「同写一天」。仍用 `firstRowBelow` 二分，只是那条线往下移了 36px。要退回票面的做法，把这个常量改成 0 就行，测试里另有一条按 0 量的。
