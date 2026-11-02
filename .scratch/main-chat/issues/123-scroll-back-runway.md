# 123 往回翻不撞墙、不跳页：垫层接住补页，提前十屏补

Status: done（2026-11-02 JC 在 tauri dev 里用只记录的探针又甩了五遍，主会话据此补了三处，见裁决 172 第 7 条，提交 `ccdd3e2a`、`1ba8b0f6`、`eaf4cb07`；最后一遍途中补的 3 页总高不变、没有写 `scrollTop`，翻过最开头那一句只露 700px 一两帧，JC 没报问题；探针已撤。以下是合入记录：2026-11-02 快进合入 `54cece1a`…`8cd9e39b`。主会话验收：rebase 到 `094bc395`（含票 124）后 typecheck、lint 退出码 0，`TZ=UTC` 全量 vitest 244 个文件 2714 条过，`diff --check` 干净；读过 `scroll-runway.ts` 与 `useEarlierTurns.ts` 的改动。垫层从探针验证过的 `margin-top` 改成了对话列的 `padding-top`（报告第 1 条的理由成立：margin 会让交接与气泡动效读成列顶上移），这个版本还没真机甩过；等 JC 在 tauri dev 里用只记录的探针（第五遍）再甩一遍）

来源：[主对话 PRD](../PRD.md) 裁决 170（诊断）与裁决 172（做法，修正 170 第 2 条）。只改 GUI 的对话分页滚动、它的测试与设计文档；不动 Core、CLI、Agent API、迁移、页大小（`MESSAGE_TURN_PAGE` 照旧 50）。所有对话一条分页路径：主对话、工作台、内置与外置运行时都生效；没有更早的页的对话零变化。

## 为什么（探针实测，dev 版，主对话两周约 30,480px、6 页）

- 现在离已加载内容的顶一屏才读上一页（`gui/src/hooks/useEarlierTurns.ts:13`），且要等第一次滚动（`:66` 的 `scrolled`）。
- 读一页 12–74ms；渲染一页时主线程停 150–280ms。macOS（WKWebView）的滚动不归主线程管，这段时间画面照样在滚；JC 往回甩每秒一万到三万多像素，起手那一下到五万。
- 补页后，`useLayoutEffect` 写 `scrollTop`，把读者那一行放回原位（`lib/scroll-anchor.ts` 的 `holdScrollAnchor`）。**惯性滚动途中这一笔会被 WebKit 的滚动线程按它自己的位置盖掉**：
  - 撞顶时 3 次都丢，画面落在新页的顶上，等于跳过一页；
  - 提前到离顶 6 屏补、不撞顶时，途中补的几次也全乱了：或闪一两帧更早的内容再跳回，或干脆跳过一页。
  - 停手时写 `scrollTop` 都没丢。
- **验证过的做法**：已加载内容上面垫一段空白（两万像素），补页时新页多高、垫层就缩多高，内容在文档里的位置不变，不写 `scrollTop`。途中补的 3 次，总高一像素没变、位置逐帧连续；失败的 2 次正好是不得不写 `scrollTop` 的两处（一页比垫层剩下的还高；最后收垫层）。
- 探针在主树里（`gui/src/zz-probe-t123.ts`，临时、不提交，你那边没有），垫层是它在内层栏 `firstElementChild` 上用 `style.marginTop` 模拟的。注意：第一次误把垫层加成滚动容器自己的 `padding-top`，滚动容器是 `absolute inset-0`、`border-box`，内边距一大整个盒子被撑高到两万多像素、画面全白——别加在滚动容器的内边距上。

## 要做到

1. **垫层**：会话还有更早的页（messages store 里这个会话的 `earlier` 不为 null）时，滚动容器里、已加载内容之上有一段空白垫层；从这一页渲染起就在（第一次渲染就带着，别等装好后再写 `scrollTop` 挪过去）。放在哪由你读 `MainView.tsx`（滚动容器 `:634` 起，内层栏 `:657` 起；主对话的内层栏是 `mt-auto`）与 `Conversation.tsx` 后定：不能成为 `[data-role="conversation"]` 的子元素（锚点按它的子元素找行）。高度改动要在补页那次提交的 layout 阶段同步生效（绘制前），所以按 ref 直接改样式，别走 React state 的重渲染。
2. **凡是靠写 `scrollTop` 把视口放回原位的，有垫层时改成缩放垫层**：
   - 补页那一次（`useEarlierTurns.ts` 的 `useLayoutEffect`）；
   - 补页后 1.5 秒内的晚到排版（同一处的 `settle`）；
   - 删除消息让上面变矮（`useRemovedTurnsAnchor.ts` → `holdFirstScrollAnchor`）。

   修正量照现有的 `anchorCorrection` 算：上面长高了 `d`，垫层缩 `d`；上面变矮了，垫层长回 `d`。
   - 垫层不够缩（`d` 大于垫层高度）：垫层缩到 0，剩下的照旧写 `scrollTop`。
   - 没有垫层（没有更早的页）：照旧写 `scrollTop`，行为与现在一模一样。

   建议把「放回原位」收成一个函数，由它决定缩垫层还是写 `scrollTop`，三处共用；接口放 `lib/scroll-anchor.ts` 或新文件，你定。
3. **离顶十屏就补，打开稳定后不等滚动**：触发条件改成「视口顶离已加载内容的顶（扣掉垫层）不到 10 屏」（10 个 `clientHeight`）。打开对话稳定后（会话切换后的贴底、恢复读完；照 `useEarlierTurns.ts` 现有注释说的原因，用现成信号判断，别另造计时），不等第一次滚动就按这条检查一次。主对话打开后会因此先补一页。
   - 照旧一次只读一页、读完再看（现在 `.then(() => requestAnimationFrame(check))` 的连锁）；
   - 照旧不在 `restoring` 时读；
   - 补页落在气泡动效途中的处理（`settleBubbleMotion`）照旧。
4. **停手时把垫层补回目标高度**：200ms 没有滚动事件（惯性结束也就不再有滚动事件）、还有更早的页、垫层低于目标时，把垫层补回目标，同时写 `scrollTop` 加上补的量，让内容不动。停手时写是可靠的。
   - 目标：20,000px 与「这个对话本次挂载里见过的最高一页的两倍」取大。一页的高度就是补那一页时垫层缩掉的量。
   - 只在不跟随底部时补；在底部本来就没事，补了也不影响贴底，你核一下。
5. **最后一页插上后收掉垫层**：`earlier` 变成 null 后，等停手（同第 4 条的 200ms），把垫层收到 0，同时写 `scrollTop` 减掉同样的量，让内容不动。读者正停在垫层里（视口顶在内容之上）时，收掉后落到最顶。
6. **用到滚动长度或 `scrollTop` 的地方都要对垫层核一遍**：`grep -rn "scrollTop\|scrollHeight" gui/src --include='*.ts' --include='*.tsx'`（不要用 `rg`），逐个判断要不要扣掉垫层，报告里列一张表（文件:行、做什么、要不要扣、改了没有）。已知要改的：
   - 工作台的问题轨（`components/conversation/UserQuestionRail.tsx` 约 `:314`）：按 `scrollHeight` 的比例摆点，要改成按已加载内容摆；
   - `useEarlierTurns.ts` 自己的「页太短」判断。

   已知不受影响：贴底、跟随、「回到底部」，这些按离底距离算；⌘K 定位、⌥↑ / ⌥↓，这些按元素位置算。也请核实。
7. **页大小、Core、CLI 不动**。170 第 2 条第③条「顶端不回弹」不做。

## 别动

- `MESSAGE_TURN_PAGE`、Core 的分页读法、`loadEarlierTurns` 的读法与去重。
- 贴底、跟随、落地动画（裁决 138）、`animateScroll` 的规则。
- 票 124 在并行做「主对话往回翻时顶上浮一颗日期胶囊」：它在 `MainView.tsx` 对话区顶部加一个浮层，给 `Conversation.tsx` 的行带上时刻，会用到 `firstRowBelow`。你别改 `firstRowBelow` 的签名与语义，`MainView.tsx` 的改动尽量局部，方便之后 rebase。
- 主工作树（JC 的 `tauri dev` 在那里跑着）。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
pnpm --dir gui exec vitest run src/hooks src/lib/scroll-anchor src/components/conversation src/stores/messages
TZ=UTC pnpm --dir gui exec vitest run src/hooks src/lib/scroll-anchor src/components/conversation src/stores/messages
pnpm --dir gui test        # 全量 vitest，收尾前跑一次
git diff --check
```

- **测试**（jsdom 不排版，量法做成可注入或 mock `getBoundingClientRect` / `scrollHeight`，参照现有 `useEarlierTurns`、`scroll-anchor` 的测试与 `src/test/scroll-frames.ts`）：
  - 放回原位：有垫层时只缩垫层、`scrollTop` 不被写（断言 setter 没被调用）；垫层不够时缩到 0、剩下的写 `scrollTop`；上面变矮时垫层长回；没有垫层时与现在一致。
  - 触发：离已加载内容的顶（扣垫层）9 屏触发、11 屏不触发；打开稳定后不滚动也会补；`restoring` 时不补。
  - 停手补回与收掉：假时钟下 199ms 不动、200ms 动；补回时 `scrollTop` 同步加；`earlier` 变 null 后停手收掉、`scrollTop` 同步减；读者在垫层里时落到 0。
  - 问题轨扣掉垫层后点位不变。
  - 没有更早的页的对话：DOM 里没有垫层，行为与现在逐项一致。
- 真机由主会话做：合入后 JC 在 tauri dev 里用同一个探针再甩一遍对比。你不跑 `tauri dev`。
- 中文（报告、设计文档）用全角标点，收尾前自己扫新增行（脚本放 scratchpad，用 `t123-` 前缀）。`gui/` 不是 prettier-clean：旧文件只格式化自己的 hunk。React 编译器 lint：effect 里同步 setState、渲染期 `Date.now` 都是 error；状态归零用 guarded setState-in-render，工具函数别从组件文件导出。

## 文档

`docs/design/conversation.md`「长对话按轮分页（2026-10-13）」一节的「往上翻自动加载」（`:869`）改写：10 屏、打开后先补、垫层（为什么：探针数据与 WebKit 惯性滚动途中盖掉 `scrollTop` 的事实，写数不写本机路径）、停手补回与收掉、单页高过垫层的退路、滚动条多算的代价；「真机看出停顿再议」改成已在 2026-11-02 再议（裁决 170、172，票 123）。如果「不做：虚拟列表」那条要补一句为什么垫层不算虚拟列表，就补。

## 环境与边界

- 只在主会话建好的 worktree 里做（路径见派单），先 `pnpm --dir gui install`。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push。
- 引用匹配行用 `grep`，不要用 `rg`。本文件在开源仓库里：不写本机用户名路径、worktree 路径，报告里 scratchpad 写成 `<scratchpad>/…`。

## 回报

写在本文件末尾「## 报告」一节（开头 `Status:` 改成 `needs-review`），并在最后一条消息里给主会话：

1. 改了哪些文件、哪几处；垫层放在哪、为什么；「放回原位」的函数接口。
2. 第 6 条的表。
3. 门禁命令与结果行。
4. 设计文档改了哪几条。
5. 主会话真机复测时该盯的点（你认为最可能出问题的两三处）。
6. 看到但没改的（Open risks），原样列出。

## 报告

（2026-11-02，执行代理。只在 worktree 分支 `t123-scroll-back-spacer` 上改，没碰主工作树、没跑 `tauri dev`。代码、测试与文档在提交 `20c439f9`，行号按这个提交。）

### 1. 改了什么；垫层放哪；「放回原位」的接口

- `gui/src/lib/scroll-runway.ts`（新）：垫层的全部 DOM 操作：`RUNWAY_ATTR`（`data-scroll-runway`）、`RUNWAY_MIN_PX`（20,000）、`hasRunway`、`runwayHeight`、`layRunway`、`keepInPlace`、`resizeRunway`。
- `gui/src/lib/scroll-anchor.ts`：拆出 `scrollAnchorDrift`（`:84`，锚点行被上面的排版挪了多少），`holdScrollAnchor`（`:98`）改为把这个量交给 `keepInPlace`。删除消息的 `holdFirstScrollAnchor` 经它走，`useRemovedTurnsAnchor.ts` 本身没改。
- `gui/src/hooks/useEarlierTurns.ts`：
  - 返回对话列的 callback ref（`:147`）：首次显示更早的页的那次提交就垫上 20,000px。
  - 冷启动恢复后才有更早的页时，在那次提交的 layout 阶段垫上，`scrollTop` 同加（`:161`）；最后一页插上后叫醒停手检查。
  - 停手检查（`:178`）：200ms 没有滚动事件、不在底部、低于目标（20,000 与见过的最高一页的两倍取大）就补回；没有更早的页就收掉。平滑滚动、气泡动效在跑或三点气泡在屏上时，过 200ms 再看。缩放后重读 settle 记着的锚点，再同步派一次 `scroll` 事件。
  - 触发（`:225`）：`scrollTop − 垫层 < 10 × clientHeight`；挂载与每次 `turnsLength` 变化的下一帧都看一次，不再等第一次滚动。原先的「页太短」判断并进这一条。
  - 补页 commit（`:280`）：用 `scrollAnchorDrift`（没有锚点时用 `scrollHeight` 增量）算出量交给 `keepInPlace`，记最高一页，叫醒停手检查；settle 照旧走 `holdScrollAnchor`。
- `gui/src/components/screens/MainView.tsx`：两处：`const runwayRef = useEarlierTurns(...)`（`:572`，注释改一行）与对话列 `ref={runwayRef}`（`:659`）。调用位置没挪。
- `gui/src/components/conversation/UserQuestionRail.tsx`：摆点扣垫层（`:320` 起）与头注释。
- `gui/src/lib/bubble-motion.ts`：加 `bubbleMotionRunning`（`:311`），停手检查用。
- 测试：`lib/scroll-runway.test.ts`（新，9 条）、`hooks/useEarlierTurns.test.tsx`（新，16 条）、`components/conversation/UserQuestionRail.runway.test.tsx`（新，1 条）、`lib/scroll-anchor.test.ts`（加 1 条：删除时垫层长回）。新测试做过变异检查：把 `keepInPlace` 改回写 `scrollTop`、去掉等三点气泡、去掉底部不补、触发改回 1 屏、去掉停手后重读锚点、问题轨不扣垫层，每一种都有测试变红。
- 没动：`Conversation.tsx`、`useStickyScroll.ts`、`live-tail.ts`、`firstRowBelow`、messages store、`MESSAGE_TURN_PAGE`、Core、CLI。

**垫层放在对话列（滚动容器的第一个子元素，MainView `:658` 的 div）的 `padding-top`**，带标记 `data-scroll-runway`。为什么：

- 不进 `[data-role="conversation"]`（锚点按它的子元素找行）；不用滚动容器自己的内边距（探针踩过）。
- 不做成空元素：对话列被一串 ResizeObserver 盯着（跟随贴底、切会话的 500ms 窗口、交接、问题轨、settle）。空元素变高变矮改的是对话列的内容盒，而 settle 本身就是 RO 回调，在回调里改会报 ResizeObserver loop。内边距不改内容盒（RO 默认看 content-box）：补页时内容盒的变化与原先一样，settle 缩垫层也不再惊动谁。
- 不用探针的 `margin-top`：交接（`useTypingBubbleHandoff` 的 `columnTopOf` → `columnLift`）和气泡动效（`useBubbleMotion` 的 `track.columnTop`）记着对话列的顶在滚动内容里的位置。margin 为一页缩时列顶跟着上移一页高，若下一次提交正好是交接，会读成「列上移了几千像素」，把整列平移再滑回来。内边距下列顶不动，垫层下面每样东西离列顶的距离也不变。主对话列的 `mt-auto` 也不会被行内样式盖掉。
- 代价：列的 border-box 含垫层，所以必须首次提交就垫好：`useStickyScroll` 挂载时记下列盒（票 72 的 `placedBoxRef`），RO 首报的 border-box 要与它相等，才不会多走一次 `assistantFollowBottom`。callback ref 在页面所有 layout effect 之前挂上，满足这一点（测试 `is laid in the first commit…` 断言）。工作台 live tail 的 `min-height`（border-box）也含垫层，所以 `resizeRunway` 停手缩放时把它同挪；补页时垫层缩、内容长，二者相抵，不用挪。

**「放回原位」**：`keepInPlace(container: HTMLElement, delta: number): void`（`lib/scroll-runway.ts:74`）。`delta` = 读者上面长高的量（负数 = 变矮）。有垫层：垫层缩 `delta`（变矮则长回），不写 `scrollTop`；垫层不够：缩到 0，剩下的写 `scrollTop`；没有垫层：`scrollTop += delta`，与原先一样（`|delta| < 1` 不动，同原先的 `holdScrollAnchor`）。三处共用：补页 commit 直接调，settle 与删除经 `holdScrollAnchor` / `holdFirstScrollAnchor`。停手时的补回与收掉是另一个函数 `resizeRunway(container, height): number`（`:99`）：垫层改到 `height`，`scrollTop` 同挪，为 0 时连标记一起去掉。

### 2. 第 6 条的表

`grep -rn "scrollTop\|scrollHeight" gui/src --include='*.ts' --include='*.tsx'`，测试文件除外；行号按 `20c439f9`。

| 位置 | 做什么 | 要扣垫层吗 | 改了没有 |
|---|---|---|---|
| `hooks/useEarlierTurns.ts:233` | 触发：视口顶离已加载内容的顶 | 要 | 改了（原 `:65–66` 的一屏与「页太短」并成 10 屏这一条） |
| `hooks/useEarlierTurns.ts:62` | 停手检查：在不在底部 | 不用，离底距离 | 新加 |
| `hooks/useEarlierTurns.ts:268, 288` | 补页前后 `scrollHeight` 的差（没有锚点时的退路） | 不用，同一垫层高度下的差 | 改为交给 `keepInPlace` |
| `lib/scroll-anchor.ts:21, 56, 78, 92, 138` | 锚点读数：行离视口顶、`scrollTop` 的差 | 不用，都是差值 | 写入处（原 `:90`）改为 `keepInPlace` |
| `components/conversation/UserQuestionRail.tsx:114, 321, 332, 335` | 问题轨按比例摆点 | 要 | 改了 |
| `components/conversation/UserQuestionRail.tsx:404` | 点点跳转：元素位移 | 不用 | 没改 |
| `hooks/useStickyScroll.ts:88–94, 118` | 交接落地的目标：离底、回复开头离视口 | 不用 | 没改 |
| `hooks/useStickyScroll.ts:136, 379, 404, 523, 628, 644` | 贴底、跟随、切会话：`scrollTop = scrollHeight` | 不用，到底 | 没改 |
| `hooks/useStickyScroll.ts:330, 496, 565` | 离底距离（at-bottom） | 不用 | 没改 |
| `hooks/useStickyScroll.ts:741, 820–821, 853` | 发出停靠、⌥↑ / ⌥↓：元素位移 | 不用 | 没改 |
| `hooks/useStickyScroll.ts:936–942, 980` | ⌘K 定位与重停：元素位移、与停靠位置比 | 不用；停手缩放时比出超过 4px，当成用户滚走而松手，不会拉回 | 没改 |
| `lib/assistant-conversation.ts:475–491, 528–562` | 主对话跟随上限、钉底：离底、回复开头 | 不用 | 没改 |
| `lib/chase-bottom.ts:41–75` | 「回到底部」追底：离底、帧间 `scrollTop` 的差 | 不用；它跑着动画，停手缩放会等 | 没改 |
| `lib/animate-scroll.ts:162, 269, 282–305` | 平滑滚动：绝对目标，别人挪了就放手 | 不用；垫层接住时不写 `scrollTop`，动画不再被补页打断，停手缩放等它 | 没改 |
| `lib/live-tail.ts:78, 96, 102, 335, 377–443` | 工作台留白：绝对的 `parkTop`、border-box 的 `min-height` | 量的时候一致，不用扣；停手缩放会让它记的数过期 | `live-tail.ts` 没改；`resizeRunway` 把 `min-height` 同挪 |
| `lib/viewport-resize.ts:27–65` | 视口变高变矮时钉底 | 不用 | 没改 |
| `hooks/useBubbleMotion.ts:43–63, 150, 200` | 列顶（内容坐标）减 `scrollTop` | 不用，内边距下列顶不动 | 没改；停手缩放等动效、等三点气泡，并同步派 `scroll` 事件 |
| `hooks/useTypingBubbleHandoff.ts:100, 247` | 交接：列顶在内容里的位置 | 不用，同上 | 没改 |
| `lib/bubble-motion-play.ts:383, 747` | 动效拷贝层的内容原点 | 不用 | 没改（动效在跑时不缩放） |
| `lib/scroll-runway.ts:78–119` | 垫层自己的写入 | — | 新文件 |
| `Composer.tsx`、`composer-grow.ts`、`diff/GitReviewPane.tsx`、`LocalFileWorkspace.tsx`、`MessageQuotes.tsx`、`ProcessCard.tsx`、`Sidebar.tsx`、`SidebarProjectGroup.tsx`、`TodoSubitems.tsx`、`TodoTextEditor.tsx`、`ui/scroll-fade.tsx`、`lib/scroll-edges.ts`、`useTodoPanelFlash.ts` | 别的滚动容器或文本框 | 无关 | 没改 |

票面说不受影响的几项都核过：贴底、跟随、「回到底部」按离底距离算；⌘K 定位、⌥↑ / ⌥↓、问题轨跳转按元素位置算。

### 3. 门禁

```
pnpm --dir gui typecheck    → tsc --noEmit，无输出
pnpm --dir gui lint         → eslint src --max-warnings 0，无输出
pnpm --dir gui exec vitest run src/hooks src/lib/scroll-anchor src/components/conversation src/stores/messages
                            → Test Files  54 passed (54)；Tests  438 passed (438)
TZ=UTC 同上                 → Test Files  54 passed (54)；Tests  438 passed (438)
pnpm --dir gui test         → Test Files  241 passed (241)；Tests  2686 passed (2686)
git diff --check            → 无输出
```

`src/lib/scroll-runway.test.ts` 不在票面那组路径里，全量那次跑了。新文件整篇 prettier；旧文件只格式化自己的 hunk（`UserQuestionRail.tsx` 里 prettier 会改的几行不是我的）。全角标点用 `<scratchpad>/t123-cjk-punct.py` 扫过新增行：只剩数字的千分位逗号，以及英文注释、代码字符串里的半角。

### 4. 设计文档（`docs/design/conversation.md`）

- 「长对话按轮分页」的「往上翻自动加载」改写成一条加五个子条：10 屏、打开后先补；垫层与为什么（WebKit 惯性途中盖掉 `scrollTop`、探针的数，不写本机路径）；首次显示就在；停手补回与收掉（200ms、目标、在底部不补、等平滑滚动 / 气泡动效 / 三点气泡、live tail 的 `min-height` 同挪）；退路与代价（单页高过垫层、滚动条多算、甩过开头先进空白、打开后先补一页的停顿、问题轨扣垫层、「顶端不回弹」撤掉）；垫层放哪。末尾把「真机看出停顿再议」改成已在 2026-11-02 再议（裁决 170、172，票 123）。
- 同节「不做：虚拟列表」补一句为什么垫层不算虚拟列表。
- 「Right Question Rail」的「只含已加载部分的提问」补一句：按已加载内容的高度摆点、扣掉垫层。
- 「Scroll behaviour」平滑滚动的「谁说了算」里，「往上加载一页的保位」改成「往上加载一页而垫层接不住时的保位」：垫层接住时不写 `scrollTop`，动画不会被它打断。

### 5. 真机复测该盯的点

- **padding 版本没有真机验证过**：探针第四遍验证的是对话列的 `margin-top`，我按上面的理由改成了 `padding-top`。两者在惯性途中都只改内容在文档里的位置、不写 `scrollTop`，理论上一样，但请照第四遍的量法（总高、逐帧位置、途中补的几次）再甩一遍确认。
- **停手补回那一下**：200ms 没有滚动事件就写 `scrollTop`。JC 两次甩之间常隔零点三到零点六秒，补回会落在两次之间；盯下一次甩起手时有没有一帧跳，或补回被盖掉（被盖掉的话垫层高了、内容会往下错一段）。
- **打开主对话与翻到开头**：首次提交就带两万像素垫层，再贴底，再先补一页。盯打开那一下有没有闪白、贴底准不准（票 72 的列盒比较）、dev 下打开后那两三百毫秒的停顿；翻到最开头停手时收垫层（`scrollTop` 一次减两万左右）有没有闪。

### 6. Open risks（看到但没改的）

- 在底部不补回（照票面第 4 条）：打开时先补的页从垫层里扣（主对话一页约五千像素，剩约一万五），停在底部时不补；从底部起手的第一串连甩只有剩下的量。我核过在底部补也不影响贴底（`scrollTop` 与垫层同加，离底距离不变；对话列内容盒不变，跟随的 RO 不触发；有平滑滚动时本来就等）。真机若看到第一串甩就把垫层用完、退回写 `scrollTop`，去掉「不在底部」这个条件即可。
- 停手缩放时交接与气泡动效记着的位置：用「平滑滚动 / 气泡动效在跑、三点气泡在屏上就等」挡住，并同步派一次 `scroll` 事件补上 `useBubbleMotion` 记的 `scrollTop`。挡不住的窄缝：三点气泡刚被交接接走后的 240ms 内若正好收垫层，离场的那颗拷贝会错位一个垫层高（多半在屏外；收垫层每个对话只发生一次）。
- 工作台 live tail：停手缩放时 `min-height` 同挪了，但 `live-tail.ts` 自己记的 `parkTop` / `minHeight` 要到它下次 refresh 才更新；其间「停在线上」读成 false（不会拉回），回到底部时「到内容真正的末尾才重新跟随」可能提前或推后一次。只在工作台、有更早的页、发出后往上翻并停手时出现。
- 读页失败（SQLite 不可用，`loadEarlierTurns` 返回 false）时垫层一直留着，往上能滑进一段两万像素的空白；原先是停在已加载的顶。每次滚动照旧重试读页。
- 在露出的垫层空白上按一下，目标是对话列，不是滚动容器的空白背景（`data-conversation-backdrop`），输入框会失焦（与在行间空处按一样）；探针的 margin 版本那块算背景。
- 停手缩放同步派发的 `scroll` 事件（以及随后真实的那次）会收起划词复制工具条；只在停手 200ms 后、垫层低于目标时发生一次。
- jsdom 不排版：新测试里的布局都是手写模型（行按 `data-h` 叠，`scrollTop` 按范围夹住），WebKit 的真实行为只能真机看。
