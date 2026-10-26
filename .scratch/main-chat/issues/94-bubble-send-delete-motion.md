# 94 气泡的发出与删除有动效

Status: needs-dogfood

来源：[主聊天 PRD](../PRD.md) 裁决 138（2026-10-26；JC：「都你推荐推进，不用切换器，直接做」）。只改 GUI 与设计文档，不上切换器，JC 在 dev 里看。

## 为什么

主对话（内置运行时、主区开着助手，`MainView` 的 `isMainChat`）里，一条消息从发出到删掉，只有回复从三点气泡撑开那一下有动效（`gui/src/hooks/useTypingBubbleHandoff.ts`，裁决 103、110）。其余全是硬切：

- 发出：你的气泡与三点气泡同一帧出现，对话瞬间钉底（`gui/src/hooks/useStickyScroll.ts:687` 的 `assistantScrollToBottom`），一行字整栏瞬跳约 140px（标准档：你的气泡 43、间距 30、三点 43、三点下面那一行 24）。
- 停止、出错、停在步数上限、回复只剩派活标签：三点气泡瞬间消失。
- 叫醒的那一轮：三点随它写字瞬出瞬收。
- 删除：气泡瞬间藏起，空位瞬间合拢（`gui/src/hooks/useRemovedTurnsAnchor.ts`）；撤销、Core 拒绝后放回瞬间出现。

## 先读

- `docs/design/foundations.md` §2.7（A / B 类、减少动态「只淡不移」）与「Motion tokens」（新代码禁止写 duration / easing 字面量；「时长随距离变的动效」两处例外）。
- `docs/design/conversation.md`「助手的对话」一节里的「在跑时：三点气泡」（尤其「交接」）、「消息菜单」的「删除不弹确认，删完给撤销」，以及「Scroll behaviour」的「滚动贴底」。
- 代码：`gui/src/hooks/useTypingBubbleHandoff.ts` 与 `gui/src/lib/typing-bubble-handoff.ts`（离场拷贝放在零尺寸图层、相位接续、`columnLift`、动画对象收尾的做法，本票照这个路数）；`gui/src/hooks/useRemovedTurnsAnchor.ts` 与 `gui/src/lib/scroll-anchor.ts`（删除时在 store 写入那一刻、React 渲染之前量屏上各行；行是 `[data-role="conversation"]` 的子元素）；`gui/src/stores/message-delete.ts`（待删、撤销、Core 拒绝放回）；`gui/src/hooks/useStickyScroll.ts`（发出时 `userSubmitTick` 那段、贴底跟随、`landingTick`）；`gui/src/stores/messages.ts` 的 `userSubmitTick`、`lastSubmitSource`；`gui/src/lib/animate-scroll.ts`（`scrollDurationMs`、`scrollProgress`、`SCROLL_ANIMATED_MAX_PX`、`prefersReducedMotion`）；`gui/src/components/conversation/TypingBubble.tsx`；`gui/src/components/screens/MainView.tsx`（门 `isMainChat`、交接的判定、`typingBubbleShown`、`withoutHiddenTurns`）。

## 要做的

总原则：**最终的布局与滚动位置同今天一模一样**（锚点规则、贴底、跟随目标都不改），动的只是看上去的过程：在提交后、绘制前，把挪了位置的东西用 transform 放回它原来看上去的位置，再放回 0；离场的东西用一份拷贝在原位演退场。只用 transform 与 opacity（Web Animations 或 CSS 都行，参考交接用的 Web Animations）。

### 1. 发出（S2）

- 触发：你的一条消息追加到主对话末尾（`userSubmitTick` 增加且是当前会话；`lastSubmitSource` 各种来源都算：输入框、排队发出、你答它的提问、CLI 或手机发进来的。它们都是眼前发生的）。
- **整栏滑上来**：提交前后，对话在视口里的位置差多少（屏上各行看上去挪了多少），就从那里滑回原位。尾部变化时屏上的行挪的是同一个距离，所以量对话栏在视口里的顶边（栏在滚动内容里的位置减 `scrollTop`）前后之差就够。时长与曲线同程序滚动：`scrollDurationMs(距离)`、`scrollProgress(距离, t)`（Web Animations 要 CSS 缓动，可用多段关键帧或 `linear()` 采样，你定，数值从 `lib/animate-scroll.ts` 取，不另抄一份）；距离超过 `SCROLL_ANIMATED_MAX_PX` 时只滑最后那 800px（同 `scrollJumpFrom` 的远跳先瞬移）。不满一屏、对话贴着输入框往上堆（`mt-auto`）时是同一回事：栏的顶边往上挪了，照样滑。
- **你的气泡**同时淡入：opacity 0 → 1，`--motion-base`，`--ease-pop`。
- **三点气泡**（连同你发起的一轮里它下面那一行 `assistant-progress`）等整栏滑到位再淡入：延迟 = 这次滑动的时长，opacity 0 → 1，`--motion-base`，`--ease-pop`，`fill: backwards`（延迟期间是透明的）。它的位置从一开始就占着（不改布局），只是看上去晚一拍。三个点自己的循环与扫光不受影响。
- **第一帧就在起点**：新内容出现的第一帧必须已经在滑动的起点，不能先闪一下终点再跳回去。今天贴底的钉底在 `useEffect` + `requestAnimationFrame` 里（`useStickyScroll.ts:671` 起），可能在绘制之后；贴底跟随也可能在 ResizeObserver 里先钉了。你要查清这一帧的顺序，确保「之后」的量在钉底之后、起播在绘制之前（必要时把主对话这次的钉底挪进 layout 阶段，但工作台的发出滚动不改）。
- **输入框同时变矮**：多行消息发出时输入框会变矮（`lib/composer-grow.ts`，155–253ms），贴底期间对话跟着往下挪。这一段照旧，不要合并或改它的数值；只要两段叠在一起时没有跳变或回退（例如滑动的起点要按提交时那一刻量）。在报告里写你怎么处理的、哪里没法在测试里验证。

### 2. 删除与放回（D2）

- 触发：待删的状态变了（点「删除」藏起、「撤销」放回、Core 拒绝后放回，`stores/message-delete.ts`），以及 Core 报来的删除让当前会话的行变少（`removedOrdinals` 增加，例如手机或 CLI 删的）。`useRemovedTurnsAnchor` 已在这两处、store 写入那一刻量过屏上各行；在同一时机量你要的东西（可以扩这个钩子，也可以另起一个钩子在同一处订阅，你定；先量动画要的，再让锚点照旧保位）。
- **被删的那几行**（只管和视口相交的；视口外的照旧，没动画）：删除前克隆一份（别等 React 卸载后再拿节点），放进零尺寸图层（照交接的做法，`aria-hidden`、`pointer-events: none`），摆在原来看上去的位置，演退场：缩到 `0.9` 并淡出，`--motion-base`，`--ease-exit`（下面第 4 节新加的 token）。缩放的原点：你那边的行（`user-msg`、`user-msg-reply`）在右下角，它那边的行在左下角，居中的时间条只淡不缩。缩放比例写成一个具名常量（例如 `DELETE_SHRINK_SCALE = 0.9`，注释写「裁决 138 第 4 条：取中档、没比过，嫌大嫌小改这里」）。一行高过视口高度时只淡不缩。拷贝里悬停才出现的那一行（复制 · 引用 · ⋯、回复的行动条）不显示，免得菜单刚关时它在拷贝里亮着。
- **屏上其余的行**同一时间从原来看上去的位置滑到新位置：逐行量前后的视口位置（被锚住的那行差为 0，不动；在底部被夹住时是上面的行往下挪，量出来是什么就滑什么），`--motion-slow`，`--ease-firm`。差小于 0.5px 的不动；差超过 `SCROLL_ANIMATED_MAX_PX` 的不滑、直接到位。删除后时间条因规则重算而新出现的，同放回的行一样淡入（不缩）。
- **放回**（撤销、被拒）反着放：其余的行从原位滑开让位，`--motion-slow`、`--ease-firm`；放回的那几行从同一个角（规则同上）由 `0.9` 放大到 1 并淡入，延迟 `--motion-fast`、时长 `--motion-base`、`--ease-pop`、`fill: backwards`（等让位走了大半才出来）。放回后因规则重算而消失的时间条，同删除那样淡出。
- Core 删除成功（提示条走掉后）不再动：那些行早已藏起，DOM 不变，什么都不放。
- 连着删几条：每一次各放各的；上一次还没放完又来一次，先把在跑的那次直接放到终点（`finish()`、移除拷贝），再量、再放。

### 3. 三点没人接替就走、叫醒那一轮的三点（顺手两处）

- 三点气泡离开、这一次没有交接（`useTypingBubbleHandoff` 只在回复或提问撑开时放；停止、出错、停在步数上限、回复只剩派活标签时三点直接消失）：整行（气泡、三个点、下面那一行）的拷贝在原位淡出，`--motion-fast`，`--ease-exit`；三点的循环与那一行的扫光在拷贝里接着原来的相位走，同交接里的做法（`useTypingBubbleHandoff.ts` 里 `loopStart`、`sweepStart` 那段，可抽出来共用）。接替它的东西（整段平铺的运行、步数上限的尾巴、派活卡片）从三点淡出的一半开始淡入，`--motion-base`，`--ease-pop`；认不准「接替它的东西」时只淡三点、接替的照旧直接出现，并在报告里说明。屏上其余的行若因此挪了（贴底时整栏往下挪），同第 2 节一样滑过去。
- 叫醒的那一轮里三点随写字出现（不是紧跟你发出的那次）：淡入，`--motion-fast`，`--ease-pop`，不延迟；整栏若因此挪了，同第 1 节滑上来（时长与曲线同第 1 节）。收起同上一条。
- 交接照旧：回复或提问撑开时走 `useTypingBubbleHandoff`，本节不放。

### 4. 时序、互斥与边界

- **只放在眼前发生的那一次**（同交接，`lib/typing-bubble-handoff.ts` 的 `typingBubbleHandoff` 注释）：切会话、整页重载、`MainView` 重挂载（从工作台回到主对话）、冷启动恢复、翻历史与分页加载（`useEarlierTurns` 前插）都不放。
- **互斥**：任何一次新的动效（本票的、交接、删除锚点量位置之前）开始前，先把还在跑的本票动效直接放到终点并清掉拷贝：Web Animations 期间 `getBoundingClientRect` 含 transform，量出来会错。特别是回复来得极快、三点还没淡入完或整栏还没滑到位就交接：交接开始前把发出那段放完，三点的离场拷贝从它当时的不透明度起淡出（克隆不带 Web Animations 的状态，按当时的计算值设），不先跳到不透明。
- 卸载、切会话时取消所有在跑的动画、移除拷贝图层。
- 只在主对话：`isMainChat` 为假（工作台、子任务、外置运行时）一个像素不变，钩子什么都不量。
- **减少动态**（每次读 `prefersReducedMotion()`，不缓存）：不滑、不缩，只淡。发出：你的气泡淡入，三点延迟 `--motion-base` 后淡入；删除：拷贝只淡出，其余的行直接到位；放回：直接到位后淡入；三点离开、出现照淡。
- **退场缓动 token**：`gui/src/styles/globals.css` 的 motion easings 那段（`--ease-firm` 旁）加 `--ease-exit: cubic-bezier(0.4, 0, 1, 1)`，注释写「离场：加速离开（ease-in 一类），配 ease-out 的入场；foundations Motion tokens」。时长、缓动从 token 读（交接的 `readHandoffTiming` 读根上的计算值，照做）；读不到 token 时什么都不放（直接到位），同交接。

## 测试

- 纯规则抽到 `lib/`（例如位移量、哪些行要放、原点按哪边、只淡不缩的判定、减少动态的分档、超过远跳阈值不滑、发出时三点的延迟），各自单测。
- 钩子测试照 `gui/src/hooks/useTypingBubbleHandoff.test.tsx` 的路数（jsdom 里给 `Element.prototype.animate` 打桩、断言关键帧与时长）：
  - 发出：栏被放回原位再滑到 0；你的气泡淡入；三点的延迟等于滑动时长；减少动态时没有 transform。
  - 删除：被删的行有拷贝、原点按哪一边、拷贝里没有悬停那一行；其余的行按各自的位移滑；被锚住的那行不动；高过视口的只淡不缩；放回反着放。
  - 三点没人接替就走：拷贝淡出、相位接续；交接那次不放本节的淡出。
  - 不放的：切会话、重挂载、冷启动恢复、前插更早的页、`isMainChat` 为假。
  - 互斥：在跑时来新的一次，先 `finish()` 旧的、拷贝移除。
- 现有测试照旧全过（`useTypingBubbleHandoff`、`useRemovedTurnsAnchor` / `scroll-anchor`、`useStickyScroll`、`MainView` 与 `Conversation` 的删除、`TypingBubble` 相关）。

## 设计文档（中文，标点全角，代码用反引号）

- `docs/design/conversation.md`：
  - 「在跑时：三点气泡」：补三点怎么出现（紧跟你发出的那次等滑到位再淡入；叫醒那一轮淡入）、没人接替时怎么走（原位淡出、接替的东西分段淡入），引用裁决 138；「交接」里补一句互斥（交接前把发出那段放完）。
  - 「消息菜单」的「删除不弹确认，删完给撤销」：「立刻从界面藏起」那条补上动效（收回自己那一角、其余的行滑过去合拢、`0.9`、时长与 token、高过视口只淡、放回反着放、Core 删除成功不再动），「看着的内容不动」照旧是终点规则。
  - 在「滚动贴底」或「你的在右」附近（你看哪里顺）写发出那一下：整栏滑上来、时长与曲线借程序滚动、你的气泡淡入、三点晚一拍；减少动态只淡。
- `docs/design/foundations.md`：「Motion tokens」表加 `--ease-exit` 一行（值与用途）；「时长随距离变的动效」那段补一句：主对话发出时整栏滑上来借程序滚动的公式（它看上去就是一次滚动），引用裁决 138。
- `docs/devlog/deferred.md:531`（「用户排印微调」一条里的「已关闭的前置项」）：补一句用户消息入场已在票 94 做了（裁决 138：整栏滑上来、气泡淡入），写时的「与助手那边对称」现在读作「有来处的连续」（发出滑上来、三点接住、回复撑开）；原来那句「不要复活笔触展开」保留。
- 别处若还写着主对话删除是「立刻藏起」「瞬间」之类与本票冲突的话，`grep` 一并改；`.scratch/` 下的 PRD 与旧票不改（主会话维护）。

## 别动

- 主工作树：只在你的 worktree 里做（路径在派单里），不碰主树，不跑 `tauri dev`。
- 交接（`useTypingBubbleHandoff`）的现有行为与数值，只允许为互斥与共用相位代码做最小改动；锚点、贴底、跟随的终点规则；工作台的发出滚动（live tail）；输入框长高的动画；三点的循环、那一行的换句与扫光；删除的分组、撤销提示条与计时；侧栏那张脸。
- `core/`、`runner/`、`managed-ga/`、`cli/`、提示词、locale（本票没有新文案）；`.scratch/` 下的 PRD 与旧票（只在本票末尾写 Comments）。
- `gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk，新文件可整篇格式化。React 编译器 lint：effect 里不同步 setState、渲染期不读 `Date.now`，工具函数别从组件文件导出（放 `lib/`）。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。新建的 scratchpad 文件用 `t94-` 前缀。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint` 通过
- `CI=true pnpm --dir gui test` 全过，再 `TZ=UTC CI=true pnpm --dir gui test` 一遍
- `node scripts/check-docs-links.mjs`
- `git diff --check`
- 报告写在本票末尾「## Comments」下：提交列表、改了哪些文件、怎么量与起播（尤其发出那一帧的顺序、输入框变矮同时发生时怎么处理、互斥）、偏离票面的地方与理由；没验证到的（真机观感、WKWebView 与 WebView2 上的实际帧、长回复里删一条的观感）原样列出。

## Comments

### 2026-10-26 实现报告（代理，分支 `ticket-94`）

**提交**（`git log --oneline main..HEAD`，本条报告另起一个提交）：

- `8614d766` Ticket 94: main chat bubbles slide in on send, shrink away on delete
- `50a17100` Ticket 94: design docs for the bubbles' send and delete motion

**改了哪些文件**

- 新增：`gui/src/lib/bubble-motion.ts`（纯规则、token 读取、`DELETE_SHRINK_SCALE`、互斥登记）、`gui/src/lib/bubble-motion-play.ts`（页面上的量与起播：发出、删除与放回、三点出现与离开）、`gui/src/lib/typing-bubble-phase.ts`（三点循环与扫光的读相位、接相位，交接与本票共用）、`gui/src/hooks/useBubbleMotion.ts`（发出与三点的钩子）；测试 `gui/src/lib/bubble-motion.test.ts`、`gui/src/hooks/useBubbleMotion.test.tsx`、`gui/src/hooks/useRemovedTurnsAnchor.test.tsx`、`gui/src/hooks/useStickyScroll.send-pin.test.tsx`，测试用假页面 `gui/src/test/bubble-motion-page.ts`（jsdom 没有版面、Web Animations、ResizeObserver）。
- 改动：`gui/src/styles/globals.css`（`--ease-exit`）、`gui/src/hooks/useRemovedTurnsAnchor.ts`（`animate` 参数，删除的量与起播）、`gui/src/hooks/useStickyScroll.ts`（主对话发出时 layout 阶段钉底；`startLanding` 先放完本票动效）、`gui/src/hooks/useTypingBubbleHandoff.ts`（只为互斥与共用相位：量之前先放完、认领三点的离开、拷贝从当时的不透明度淡出、量三点时扣掉本票的 transform、相位代码挪到共用文件）、`gui/src/hooks/useEarlierTurns.ts`（前插量锚点前先放完）、`gui/src/lib/typing-bubble-handoff.ts`（只改一句注释）、`gui/src/components/screens/MainView.tsx`（接线，门 `isMainChat`）、`gui/src/components/conversation/MessageActions.tsx` 与 `MessageUser.tsx`（悬停那一行加 `data-hover-row`）、两处现有测试的 markup 字面量跟着加这个属性（`MessageActions.test.tsx`、`Conversation.assistant.test.tsx`，断言的意思不变）；文档 `docs/design/conversation.md`、`docs/design/foundations.md`、`docs/design/overlays-and-settings.md`（「气泡立刻藏起」）、`docs/devlog/deferred.md`。
- 没碰 `core/`、`runner/`、`managed-ga/`、`cli/`、提示词、locale；`.scratch/` 只写本条。

**怎么量、怎么起播**

- 两半：「之前」在改对话的那次 store 写入里量（React 还没渲染，DOM 就是屏上的样子）；「之后」在第一次画出这次改动的那一帧里量、起播，用一个当场新建的 ResizeObserver（`lib/bubble-motion-play.ts` 的 `beforePaint`）：它的第一次回调必来（不管尺寸变没变），落在这一帧布局之后、绘制之前，而且排在先建的观察者后面（跟随的钉底、输入框变矮时的钉底、交接的量），所以量到的就是要画出来的终点，起播的第一帧就在起点。
- **发出那一帧的顺序**：① store 写入（`userSubmitTick` 增加且本会话的切片变了，各种来源都算）→ `useBubbleMotion` 的订阅先把在跑的本票动效放到终点，再量对话栏在视口里的顶边、记下对话最后一行、三点在不在；② React 提交：`useStickyScroll` 的跟随（在底部时）照旧钉底，新加的 layout 阶段钉底（主对话、新的一次发出才有；`assistantScrollToBottom`）保证读着上面的历史时发出也在这一刻到底，原来 `useEffect` + `requestAnimationFrame` 那次照旧跑（变成空操作，`setAtBottom(true)` 照旧）；③ `useBubbleMotion` 的 layout effect 只登记，不量；④ 这一帧的 ResizeObserver：跟随的观察者若因栏变高再钉一次，在前；然后本票的回调量栏顶，差多少就把栏里所有子元素（对话、三点、在问的问题、步数上限的尾巴）用 `translateY` 按回原处，按 `scrollProgress` 采样成关键帧（约 16ms 一个，线性插值）在 `scrollDurationMs` 里放回 0，超过 800px 只滑最后 800px；往下按的这段 `overflow: clip`（同交接）。你的气泡（新出现在旧最后一行之后、属于你的行与时间条）同时淡入，三点那一行延迟一个滑动时长淡入，`fill: backwards`。
- **输入框同时变矮**：输入框的高度动画在它自己的 effect 里排 rAF，第一步落在 `--ease-firm` 平的起头，所以「之后」量到的基本是输入框原来的高度；之后每帧变矮、视口 ResizeObserver 钉底，对话真实地往下挪，叠在 transform 上，两段各走各的、数值不动。起点是提交那一刻的位置，所以不跳。用两条曲线算过（scratchpad 脚本，没进仓库）：气泡至少与输入框里的字一样高时（2–8 行）全程只往上走；8 行输入框发出、气泡折成 6 行的长消息，尾段往回约 10px。这一点 jsdom 测不了（没有版面与真实的帧），真机没看过。
- **删除与放回**：`useRemovedTurnsAnchor` 的同一处订阅里，先放完在跑的本票动效，再量动画要的（视口上下各 800px 内每一行的顶边；和视口相交的每一行各拷一份），再量锚点（照旧）；提交后 layout effect 先保位（照旧），再登记起播；ResizeObserver 回调里（在底部放回时跟随会在这里再钉一次底，量在它之后）逐行比前后：还在的行滑过去，不在的行用拷贝演退场，新出现的行（放回的、规则重算出来的时间条）演入场。
- **三点**：`useBubbleMotion` 在这一轮 live 时每次提交读一次三点那一行（在栏里的位置、扣掉本票 transform）、栏在滚动内容里的位置、`scrollTop`（另有一个先建的 ResizeObserver 与 scroll 监听补读）、对话最后一行与栏的子元素；下一次提交三点没了且交接没认领就放离开，三点新出现且不是发出那次就放叫醒那一轮的淡入。只有上一次提交也是 live 才放，所以挂载、切回主对话、冷启动恢复不放。
- **互斥**：一个按滚动容器登记的「在跑的本票动效」（`lib/bubble-motion.ts`），新的一次本票动效、交接量位置前、落地跟随读回复开头前、删除量锚点前、前插量锚点前、停止（`agentRunning` 变假，在 store 写入里，React 渲染之前）、卸载，都先把它直接放到终点：取消所有动画、移除拷贝图层、还原栏的 `overflow`。放完时若三点的淡入还没走完，记下它当时的不透明度（`getComputedTiming().progress`），交接的拷贝和本票三点离开的拷贝都从这个值起淡出。交接放了就在这一提交认领三点的离开，本票不再另放。

**偏离票面的地方与理由**

1. 「之后」的量与起播不在 layout effect 里，而在同一帧的 ResizeObserver 回调里。理由：在底部撤销时，跟随的钉底发生在 layout effect 之后的 ResizeObserver 里；在 layout effect 里量会量到钉底之前的位置，而且那时已起播的 transform 会让跟随读到回复开头还在旧位置，把本该到底的跟随停在半路，改了终点。放在回调里，跟随看到的是不带 transform 的版面，终点同今天一样。
2. 删除时拷贝和视口相交的所有行，不只被删的那几行：写入那一刻还不知道哪几行会消失（放回时因规则重算消失的时间条、随回复一起走的过程卡片）。代价只在删除、撤销、Core 回执三个时刻各一次克隆。
3. 拷贝图层放在对话栏里，不是交接那样放在滚动容器里：这样拷贝继承栏的气泡排版规则（`ASSISTANT_BUBBLE_TEXT_CLASS` 与行内变量），不会重排；绝对定位的包含块仍是滚动容器，跟着内容滚动、不被栏的 `overflow: clip` 裁掉。拷贝去掉 `id`、`data-message-id`，你的气泡的 `user-msg` 改成 `user-msg-leaving`（跟随取最后一个 `user-msg` 当回复开头；栏的 `^=user-msg` 规则照样命中）；图层 `aria-hidden`、`inert`、不接指针。
4. 删除合拢时不加 `overflow: clip`：短对话里上面的行是从栏顶之上滑下来的，裁了会被切掉一截；正位移只出现在锚点没被夹住的行，多出来的滚动范围不超过离底部的距离，在底部（24px 内）时读不成「不在底部」。发出、叫醒那一轮出现、三点离开往下按时照交接加 clip。
5. 三点离开时屏上的挪动按整栏一个距离滑（变化在尾部，各行挪的是同一个距离），接替它的新行跟着整栏一起滑、同时淡入，没有排除在外：排除的话第一帧它站在新位置、上面的行还在旧位置，会叠在一起。时长与曲线照第 2 节（`--motion-slow`、`--ease-firm`），拷贝跟着一起走。
6. 「接替它的东西」认的是：上一次提交对话最后一行之后新出现的行，加上栏里新出现的子元素（步数上限的尾巴）。最后一行被重画（元素换了）时认不准，只淡三点，接替的照旧直接出现。步数上限的尾巴若晚一次提交才出现（暂停标志与停止不在同一次写入），它直接出现。
7. 发出时没有滑动（减少动态，或什么都没挪）三点延迟 `--motion-base`：票面写「延迟 = 这次滑动的时长」，没有滑动时照减少动态那条。
8. 互斥多放了两处：落地跟随（`startLanding`）读回复开头前、前插更早的页量锚点前；停止时在 store 写入里先放完（那次提交的跟随要在不带 transform 的版面上决定终点）。
9. `--ease-exit` 写在 `@theme` 里 `--ease-firm` 旁边。Tailwind 4 会删掉没人点名的主题变量（用它自己的编译器与扫描器核过：`--ease-spring` 现在就不输出）；`lib/bubble-motion.ts` 里 token 名的字符串就是它被扫到、照常输出的原因，注释写了。
10. 交接文件的改动比「最小」多一点行数：读相位、接相位那几段原样挪到 `lib/typing-bubble-phase.ts` 两边共用，行为不变（交接的现有测试全过）。

**验证**（都跑过，看到输出）：`pnpm --dir gui typecheck`、`pnpm --dir gui lint` 通过；`CI=true pnpm --dir gui test` 211 个文件 2338 条全过，`TZ=UTC CI=true pnpm --dir gui test` 同样全过；`node scripts/check-docs-links.mjs` 通过（474 个文件）；`git diff --check` 干净。新测试覆盖：发出（栏放回原处再滑到 0、起播前什么都不放、你的气泡淡入、三点延迟等于滑动时长、远跳只滑 800px、减少动态没有 transform、自己走完后还原）、删除（拷贝、原点按哪一边、拷贝里没有悬停那一行、其余的行各按位移滑、被锚住的不动、在底部时上面的往下、高过视口与时间条只淡、新出现的时间条淡入、放回反着放、Core 删除后不动、减少动态）、三点（拷贝在原位淡出、循环与扫光接相位、接替的从一半淡入、整栏挪了一起滑、从发出那次淡入到一半的不透明度起淡出、交接那次不另放、交接前把发出那段放完且点从当时的不透明度淡出、认不准时只淡三点、叫醒那一轮进出）、不放的（另一个会话的发出、重挂载、冷启动恢复、前插更早的页、`isMainChat` 为假时一次都不量版面）、互斥（新的一次先 `cancel` 旧的、拷贝移除、卸载时移除图层）、主对话发出在提交时就到底而工作台不变。

**没验证到的**（原样列出）

- 真机观感：发出滑上来、三点晚一拍、删除收回那一角与合拢、0.9 的大小，都没在 tauri dev 里看过。
- WKWebView 与 WebView2 上的实际帧：「ResizeObserver 的第一次回调落在布局之后、绘制之前，且按建立顺序排在跟随的观察者后面」是按规范与 Chromium 的行为推的，jsdom 测试只是照这个顺序模拟；WebKit 里 `getComputedTiming().progress` 读出的是否是缓动后的进度、关键帧里的 `transformOrigin`、栏上 `overflow: clip` 都没在真机上看过帧。
- 长回复里删一条的观感：屏上一大片内容同时在滑，可能显得重；视口里的行越多，删除那一刻克隆越多，长回复（大段代码、表格）的克隆耗时没量过。
- 输入框变矮与发出滑动叠在一起：算出来一般只往上走，极端的长消息尾段约 10px 往回走，真机没看过。
- 回复落地的交接还在放（240ms 内）就又发出一句、且对话不满一屏时：交接按住内容的 transform 与发出的滑动叠在同一批元素上，后来的那段盖住前面的，没处理也没看过。
- 撤销被拒（主对话这时已经在跑）时放回与跟随同时发生：跟随在起播之前决定终点，放回的滑动之后若再有跟随，会读到带 transform 的位置，概率小，没覆盖。
- 发出那一下的 `overflow: clip` 在 240–600ms 里也会裁掉栏左右两边伸出去的投影（交接一向如此），没在真机上找过有没有这样的东西。

### 2026-10-26 主会话验收

- 门禁在 worktree 里重跑（代理停手后）：`pnpm --dir gui typecheck`、`lint` 过；`CI=true pnpm --dir gui test` 211 个文件 2338 个测试全过，`TZ=UTC` 再跑一遍同样全过；`node scripts/check-docs-links.mjs` 过（474 个文件）；`git diff --check main..HEAD` 干净。
- `vite build` 产物里有 `--ease-exit:cubic-bezier(.4, 0, 1, 1)`（Tailwind 会丢没人引用的主题变量，丢了时整套动效读不到 token、什么都不放，所以单独核了）。
- 读过的改动：`useStickyScroll` 只多了主对话发出时在 layout 阶段的钉底（工作台的发出滚动不变）与 `startLanding` 前的放完；`useTypingBubbleHandoff` 只有互斥、从当时的不透明度淡出、相位代码挪到 `lib/typing-bubble-phase.ts`；`useRemovedTurnsAnchor` 在原来的时机先放完、再量动画要的，锚点照旧先保位；`MessageActions`、`MessageUser` 只加 `data-hover-row` 标记；`MainView` 只接线，门照旧是 `isMainChat`。
- 文档新增 57 行扫过全角标点，0 处；diff 里没有本机路径与密钥。
- 合入：`--ff-only` 到 main（`d04049c0`），纯 GUI，没等 `busy:0`。
- 真机待 JC：发出时整栏滑上来与三点晚一拍、删除收回那一角与合拢（0.9 的大小）、撤销放回、停止时三点淡出、叫醒那一轮三点进出；以及上面代理列的没验证到的几条，尤其多行消息发出与输入框变矮叠在一起、长回复里删一条。


### 2026-10-26 真机问题：发出时闪过旧消息（主会话修）

- JC 在 dev 里：「发新消息的时候……整个对话 UI 会先闪过一个其他消息好像是之前的旧消息的一些画面，再切回到最新发的消息」。
- 探针（main.tsx 临时挂、量完已拆）在真窗口里模拟发出（只改页面内存、不碰 Core，整页重载还原），逐帧记滚动与第一帧要画的内容：
  - 贴底发出：滑动起播那一帧滚动区 `scrollHeight` 塌成视口高（`max: 0`），`scrollTop` 被夹到 0，屏上是这一页最早的几行（「10月23日 10:06」起），约 350ms 后 clip 摘掉才回底部；还因为滚到顶误触发了一次加载更早的页（行数 28 → 55）。原因：主对话的滚动区是 `flex flex-col`，滑动期间给对话栏加了 `overflow: clip`，WebKit 把非 visible 溢出的 flex 子项的自动最小高度算成 0，整栏被压扁。jsdom 不排版，测不到。修法：clip 期间同时 `flex-shrink: 0`（`lib/bubble-motion-play.ts` 的 `clip`）；交接按住内容时同一处也加了（`useTypingBubbleHandoff.ts`，对话不满一屏、回复把它撑过一屏时同样会塌）。
  - 往上翻 1500px 再发出：第一帧画的是「离底部 800px 处」（票面让它照程序滚动先瞬移、只滑最后 800px），不是你看着的那一屏，也读作旧消息闪过。改成超过 800px 不滑、直接到位（`columnSlide`），800px 以内整段滑、第一帧就是你看着的那一屏。
  - 修后复测：贴底发出可滚高度保持、第一帧同发出前、141px 平滑滑到位；往上翻 500px 第一帧同发出前、滑 573px；往上翻 1500px 不滑、直接到位，气泡照样淡入。
- 门禁：typecheck、lint、`CI=true pnpm --dir gui test`（2339）与 `TZ=UTC` 各一遍、docs links、`git diff --check` 全过；文档改了两处措辞（`conversation.md`「发出那一下」与「第一帧就在起点」、`foundations.md` 时长随距离那段）。
