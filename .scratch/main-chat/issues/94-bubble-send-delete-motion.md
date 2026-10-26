# 94 气泡的发出与删除有动效

Status: ready-for-agent

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
