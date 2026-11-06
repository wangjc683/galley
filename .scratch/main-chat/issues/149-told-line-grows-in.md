# 149 途中先说的话从三点大小的框长出来，三点被平滑推下去

Status: done（2026-11-06 JC 真机：「我按甲真机看过了，没问题」。库里：07:58:05 UTC 主对话收到「这个周末厦门天气怎么样」，11 秒后先说一句、6 步答完；这一轮只有一句先说的话，「连着 4 句的整体感觉」没走到）

验收记录：（2026-11-06 rebase 到 `7adfd323` 后快进合入 `84619031`。主会话验收：读过放不放的规则（`toldLineAtEnd`、`toldLineGrows`：这一轮在跑、同一会话、末尾是新的先说的话、轮数只增）与 `rowPush`；worktree 复跑 typecheck、lint 过，`TZ=UTC` vitest 256 个文件 2,873 条全过，`check-docs-links` 494 个文件过，`git diff --check` 干净，新增行没有本机路径。Open risk 1（没在跟随时三点也平滑滑下去，不是瞬时推开）主会话认同：瞬时推开读作「三点长成这一句、又来新三点」，正是裁决 200 要避开的。要真机看：先说的话进来的第一帧三点不跳、底色从三点上沿往上长、连着 4 句的整体感觉；第一帧探针与票 150 合入后一起在 dev 真窗口量）

真窗口探针（2026-11-06，主会话代测）：四轮带先说的话的真对话。第 1 轮先说的话没长（字直接出现，跟随照样平滑），原因由票 151 查清：它的行按位置记 key，说出它的那一步紧跟着落下、插在它前面，key 变了整行重挂，`clip-path` 留在旧节点上；票 151 改按消息 id 记 key（`told-<messageId>`）。其余各轮与 151 合入后的两句都正常：`clip-path` 240ms 展开、字与行动条晚 60ms 淡入，扣掉每帧滚动后三点稳在约 757px（误差 <1px）。四轮测试对话已从主对话删掉（库备份在主会话 scratchpad）。

来源：[主对话 PRD](../PRD.md) 裁决 200 第 2 条（JC 2026-11-06：「甲和乙都做」）。只改 GUI 与设计文档；只影响内置运行时的主对话（`MainView` 的 `isMainChat`）；工作台、从助手点开的子任务、外置运行时零变化（外置没有主对话）。不碰 Core、库、CLI、runner。乙（落地回弹）不在本票。

## 为什么

- 主对话里它说的话进场都有动效，只有途中先说的话（票 137 的 `tell_user`、裁决 191 的「先说的一句」，库里 `supervisor = galley-step-text`、`sequence` 2 起的行，前端是 `interim` 的 agent turn）没有：`docs/design/conversation.md:214`「**出现**：这一轮没结束，不做「三点长成回复」的交接，也不加新动效：它直接落在三点上面，三点被推到它下面（没比过，真机看）」；跟随也是瞬时的（`:289`「其余时候照旧瞬时」）。
- 一轮里常连着来几句（JC 的截图那一轮 4 句），每句啪地出现、三点一把被推下去，是主对话最显得机械的一刻。

## 要做到

1. **长出来**：先说的话这条气泡进场时，从它自己左上角一个三点气泡大小的框长出来，**用现成的那套**：叫醒那一轮屏上没有三点时回复的进场（`conversation.md:173`「叫醒的一轮落地时屏上没有三点……就从气泡自己左上角一个三点气泡大小的框长出来」），底色 `clip-path` 展开、字随后淡入，时长、曲线、字淡入的起点都照那一套（`--motion-slow`、`--ease-pop`），不另起数值。代码入口在 `gui/src/hooks/useTypingBubbleHandoff.ts`、`gui/src/lib/typing-bubble-handoff.ts`，你读了再定怎么复用（优先抽出共用的那一段，不复制一份）。
2. **三点不走**：三点气泡与下面那一行「在做什么 · 用时」不淡出、不重新淡入，三个点的循环、那一行的扫光与换句照走，用时不断；它们只是被这句话推下去。
3. **平滑推下去**：
   - 在跟随（贴底、`atBottom`）时：跟随不再瞬时钉底，与展开同一个时钟平滑走到 `assistantFollowTop` 算出的目标，做法同回复交接的「跟随同步」（`conversation.md`「交接」里的「跟随同步」：`animateScroll` 的定时模式 `ScrollTiming`；对话不满一屏、`mt-auto` 时按回原处再沿同一条曲线放上去）。看上去：三点留在底部，这句话在它上面长出来，上面的消息一起往上滑。
   - 没在跟随（往上翻着读）时：不滚，这句话在原处长出来，下面的照常被推开（同交接「往回翻着、没在跟随时不滚」）。
4. **只放在眼前发生的那次**：条件同交接（上一帧这一轮在跑、这句是新落到对话末尾的、同一个会话、不在冷启动恢复中）；切会话、整页重载、从工作台回到主对话、翻历史、分页加载、删除后放回都直接出现。
5. **撞在一起**：
   - 上一句还在长，又来一句：先把上一句放到终点（同 `lib/bubble-motion.ts` 的 `settleBubbleMotion` 的思路），再放新的；不排队补放。
   - 正在长时回复到了（交接）、你发出、删除：先放到终点，再放后来的那段；动画中的 `getBoundingClientRect` 带 transform，量之前先放完（`conversation.md`「与发出那一下互斥」同一条坑）。
6. **减少动态**：只淡不移（foundations §2.7）：这句话整条淡入（`--motion-base`），不展开、不平滑滚动，跟随照旧瞬时。系统设置实时读。
7. **它挂的行动条**：票 148 起是气泡自己的子元素（挂在气泡右边，`opacity` 是它的悬停显示），随字同一段淡入的做法同回复交接（`useTypingBubbleHandoff.ts` 的 `fadeParts`）；长的过程中不会闪出来。

## 文档

- `docs/design/conversation.md`「在跑时它先说的一句」的「**出现**」一条（`:214`）按本票改写，引裁决 200；「滚动：贴底」里说跟随何时平滑的那句（`:289` 附近）补上这一种；「交接」一节若抽了共用部分，措辞同步。

## 别动

- 回复的交接、叫醒那一轮的进场、发出、删除与放回、三点自己的出现与离开，行为都不变（抽共用代码可以，像素与时序不变）。
- 先说的话的位置、间距（票 148：同一边 4px）、行动条内容、库与 Core。
- 工作台、子任务、外置运行时。

## 验证

- `pnpm --dir gui typecheck`
- `pnpm --dir gui lint`（React 编译器规则：effect 体内同步 setState、渲染期 `Date.now()` 都是 error；组件文件只导出组件）
- `TZ=UTC pnpm --dir gui test`（全量 vitest，跑完照抄条数）
- `node scripts/check-docs-links.mjs`、`git diff --check`
- 加测试：放与不放的条件（眼前新落的先说的话放；重载、切会话、翻历史、分页、放回不放）；撞在一起时先放完再放；减少动态只淡不移；回复交接与叫醒进场的既有测试照过。
- jsdom 不排版也不跑动画：报告里写明哪些只能真窗口看（第一帧位置、长的过程中三点有没有跳、跟随与展开是不是同一个时钟）。主会话合入后在 dev 真窗口用探针量第一帧再交 JC。

## 环境与边界

- 只在自建 worktree 里做：`git worktree add -b t149-told-line-grows-in <scratchpad>/wt149 main`（从本地 main 起：本票与裁决 200 只在本地提交里），进去先 `pnpm --dir gui install`。纯 GUI，不用克隆 Rust target。绝不碰主工作树，不跑 `tauri dev`。
- gui 不是 prettier-clean：别对整个已有文件跑 prettier，只保证自己写的 hunk 风格一致；新文件可整篇格式化。
- 在分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行（脚本放 scratchpad，文件名用 `t149-` 前缀）。报告里不写绝对路径。
- 长命令（全量测试）前台跑，跑完再往下；别交给后台任务或分叉代理，也别留后台等待循环。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：按上面 1–7 条逐条对应 file:line；复用了哪一段、有没有抽共用；改了哪些文件；验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；只能真窗口看的；看到但没改的（Open risks），原样列出。

## 报告

2026-11-06，代理在分支 `t149-told-line-grows-in` 上做完（从本地 main `d88378a0` 起），代码、测试、文档在 `d4782cd8`，本节另一个提交；未 push、未合入。票面前提与代码对得上，没有扩范围。

### 1–7 条各在哪（行号按 `d4782cd8`）

1. **长出来**：`gui/src/hooks/useTypingBubbleHandoff.ts:535` `playToldLine`；起点是它自己左上角一个三点气泡大小的框（`:578` `cornerStart(targetBox, size)`，尺寸取三点气泡量得的框，没有就按 `typingSizeFor` 算，同叫醒那一轮的回复）；底色 `clip-path` 展开与字淡入是抽出来的 `growTint`（`:304`），字淡入的时间是 `comeInFader`（`:279`，即 `handoffFadeIn`：展开开始后 `--motion-fast` 的一半起、到展开结束）；时长、曲线由 `readHandoffTiming` 读 `--motion-slow`、`--motion-fast`、`--ease-pop`，没有新数值。
2. **三点不走**：`playToldLine` 不拷贝、不淡三点那一行（没有 `claimTypingDeparture`，也不碰 `TypingBubble`：`MainView.tsx:808` 同一个位置照旧渲染，不重挂载，三个点的循环、扫光、换句与用时都在原元素上接着走）；它对三点那一行只加一段 `transform`（下一条）。
3. **平滑推下去**：推下去多少 = 三点那一行在对话栏里的位置这一帧减上一帧（`useTypingBubbleHandoff.ts:571`，`rowPush` 在 `gui/src/lib/typing-bubble-handoff.ts:152`；上一帧的记录在 `:680` `state.before`）；对话栏一下子上移多少照交接的 `columnLift`（`:567`）。`:591`–`:596`：对话（`data-role="conversation"`）按 `lift`、它后面的行（三点那一行）按 `lift − push` 用 `holdColumn`（`:342`，从交接里抽出来的「按回原处再沿同一条曲线放」）放回；贴底时两者相等，三点那一行不加动画、一像素不动，只在按住内容时给对话栏 `overflow: clip`、`flex-shrink: 0`（同交接）。跟随：`MainView.tsx:564` 放一次就给 `handoff` 的 `tick` 加一，`:591` 传成 `landingTick`，`useStickyScroll.ts:390` 照旧走 `startLanding`（`:101`，`ScrollTiming`、`assistantFollowTop`），这一段一行没改。没在跟随（`atBottom` 为假）时 `startLanding` 不跑、不滚，这句话在原处长，三点那一行照 `−push → 0` 滑下去（票面第 3 条标题是「平滑推下去」，两种情形用同一段 `transform`）。
4. **只放在眼前发生的那次**：`typing-bubble-handoff.ts:104` `toldLineAtEnd`（对话最后一轮是有字的 `interim`，取它的 `messageId`），`:132` `toldLineGrows`（上一帧与这一帧都 `live`、同一个会话、末尾换成新的一句、轮数比上一回多）；`MainView.tsx:536` 读的是整份 `turns`（不是被待删藏起的 `shown`，所以放回不算新来的），`:544` 守卫里多比一项 `told`，`:564` 放。`live` 本来就含 `!restoring`。工作台 `told` 恒为空、`turns` 恒为 0，不多渲染。
5. **撞在一起**：量之前先 `settleBubbleMotion`（`useTypingBubbleHandoff.ts:554`），放的时候登记成裁决 138 那一组动效（`:629` `holdBubbleMotion`，结束时 `:625` 释放）：之后的发出（`useBubbleMotion` 的订阅）、删除（`useRemovedTurnsAnchor`）、停止、翻页（`useEarlierTurns`）、交接（`playTypingHandoff` 开头）都会先把它放到终点；下一句或交接换了 `handoff`，effect 的清理也会先取消上一段（`:716` 分派处）。
6. **减少动态**：`useTypingBubbleHandoff.ts:599`，整条淡入 `toldLineFade`（`gui/src/lib/bubble-motion.ts:198`：`--motion-base`、`--ease-pop`、不延迟，与发出时你的气泡淡入同值），不展开、不加 `transform`；`startLanding` 在减少动态下本来就返回假，跟随照旧瞬时。`prefersReducedMotion` 每次放都读一次。
7. **行动条**：`growTint` 里沿用交接的 `fadeParts`（`useTypingBubbleHandoff.ts:192`）：行动条本身的透明度是悬停显示，淡入的是它里面的按钮，与字同一段；展开的 `clip-path` 期间行动条也在框外被裁掉，长的过程中不会闪出来。

### 复用与抽共用

- 抽出、交接与先说的一句共用（都在 `useTypingBubbleHandoff.ts`，没导出）：`boxInColumn`（`:252`）、`cornerStart`（`:264`）、`comeInFader`（`:279`）、`growTint`（`:304`）、`holdColumn`（`:342`）。`playTypingHandoff`（`:368`）改成调它们，调 `animate` 的次序、关键帧、选项与改前一样；交接与叫醒进场的既有测试一条没改、全过。
- 直接复用：跟随同步整段（`landingTick` → `startLanding` → `animateScroll` 的 `ScrollTiming`）、`findBubble`、`followersOf`、`fadeParts`、`typingSizeFor`、`columnLift`、`bubbleGrowInsets`、`insetClipPath`、`settleBubbleMotion` / `holdBubbleMotion` / `releaseBubbleMotion`。
- 新加的只有规则：`toldLineAtEnd`、`ToldLineFrame`、`toldLineGrows`、`rowPush`（`typing-bubble-handoff.ts`），`toldLineFade`（`bubble-motion.ts`），`TypingBubbleHandoff.kind` 多一种 `"told"`（`typing-bubble-handoff.ts:40`）。

### 改了哪些文件

- `gui/src/hooks/useTypingBubbleHandoff.ts`：抽共用、`playToldLine`、`state.before`、按 `kind` 分派。
- `gui/src/lib/typing-bubble-handoff.ts`：上面的四样规则与 `kind`。
- `gui/src/lib/bubble-motion.ts`：`toldLineFade`。
- `gui/src/components/screens/MainView.tsx`：帧多记 `told`、`turns`，守卫多比 `told`，放先说的一句。
- `gui/src/hooks/useStickyScroll.ts`：只改 `landingTick` 的注释。
- 测试：新文件 `gui/src/hooks/useTypingBubbleHandoff.told.test.tsx`（12 条）；`gui/src/lib/typing-bubble-handoff.test.ts` 加 6 条（放与不放：新落的放；重载、切会话、从工作台回来、冷启动恢复、翻历史 / 分页、放回、删掉后剩下更早的一句、后面跟着一步或等它读的插话都不放；`rowPush`）；`gui/src/lib/bubble-motion.test.ts` 加 1 条（`toldLineFade`）。
- 文档：`docs/design/conversation.md`「在跑时它先说的一句」的「出现」改写成一条加六个小条（214–220，引裁决 200）、「交接」的「怎么长」末句（173）与「代码」（182）补共用、「滚动：贴底」说跟随何时平滑的那句（295）、「Sticky-bottom」里同一句（986）；`docs/design/foundations.md:712` Motion tokens 下「例外一处」补这一种（票面「文档」一节没列，不补就与事实不符，只加一个分句）。

### 验证（照抄输出）

- `pnpm --dir gui typecheck`：`tsc --noEmit` 无输出，过。
- `pnpm --dir gui lint`：`eslint src --max-warnings 0` 无输出，过。
- `TZ=UTC pnpm --dir gui test`：`Test Files  256 passed (256)`、`Tests  2873 passed (2873)`。
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 494 files checked.`
- `git diff --check`：干净。
- prettier：动过的 7 个旧文件在 `d88378a0` 上都是 prettier-clean（逐个核过），整文件格式化后 diff 只落在自己的 hunk；新测试文件整篇格式化。
- 全角标点：自写正则扫新增行，`docs/` 与 `.scratch/` 0 处；`gui/src` 3 处都是英文注释或测试名里夹「贴底」（`(贴底, …)`、`贴底 (shorter …)`），英文句子用半角，同仓库已有写法，不改。
- 新增行没有本机路径。

### 只能真窗口看的（jsdom 不排版、不跑动画）

- 第一帧：先说的一句的起点框是否正好压在三点气泡上（被三点那一行盖住、看不出来），三点那一行是否一像素不跳；贴底（不满一屏）与可滚两种都要看。
- 长的过程中：三点是不是一直留在底部、三个点的循环与扫光有没有断、用时有没有跳；这句话的底色是不是从三点上沿「冒出来」往上长，字从 60ms 起进来时有没有和三个点同时看得见。
- 跟随与展开是不是同一个时钟：滚动（`animateScroll` 第一帧 rAF 起算）与 Web Animations（同一任务里开始）理论上同帧起，实际是否对齐，要量帧。
- 往上翻着时：这句话在原处长、三点往下滑开，读起来是否自然（票面这一条写「下面的照常被推开」，我按第 3 条标题做成平滑推，见 Open risks 第 1 条）。
- 连着来几句（截图那一轮 4 句）时的整体感觉。
- 减少动态下：整条淡入 160ms，三点当即在新位置。
- 主会话合入后在 dev 真窗口用探针量第一帧再交 JC。

### Open risks（看到但没改的）

1. 没在跟随时三点那一行也是平滑滑下去（`−push → 0`），不是瞬时被推开。票面第 3 条第二款写「这句话在原处长出来，下面的照常被推开」，「照常」可以读成瞬时；我按第 3 条标题「平滑推下去」与第 2 条「三点被这句话推下去」做成两种情形同一段动画，因为瞬时推开时第一帧三点跳到下面、先说的一句从三点原来的位置长出来，读起来就是「三点长成了这一句、又来一个新的三点」，正是裁决 200 要避开的。要改成瞬时只需在不跟随时不给三点那一行加 `transform`（`playToldLine` 读不到 `atBottom`，要从 MainView 传进来）。
2. 上一句还在长（240ms 内）又来一句：上一段的 `transform` 与 `clip-path` 放到终点，但跟随的滚动不跳到上一段的终点，而是从半路接着滚向新目标（`startLanding` 取消上一段滚动的写法，交接一直如此，没改）。结果是三点那一行往下跳剩下的那一截再平滑回来。两句隔不到 240ms 很少见（每句是一次工具调用），没处理。
3. 等它读的插话在下面时，先说的一句落在插话上面、不在末尾，直接出现（插话与三点一把被推下去），同回复在这种情形下不从三点撑开（票 136）。没做成从中间长出来。
4. 叫醒那一轮（三点只在写字时出现）里，若先说的一句与三点出现或离开落在同一次提交，`useBubbleMotion` 的三点淡入 / 淡出会在同一次提交里先把这句的生长放到终点（结果是这句直接出现）。按现在的事件次序（`tell_user` 在工具跑时到，那时三点多半已收起）很少碰到，没测真机。
5. 守卫多比一项 `told` 后，主对话里先说的一句每落一次、以及它之后落下第一步时，MainView 会多一次渲染内的 `setState` 重渲染（同一次提交里，不多提交）；工作台不受影响。`MainView.mount-commits` 的计数测试照过。
6. `toldLineGrows` 用「轮数比上一回多」排除「删掉最后一句、剩下更早的一句在末尾」；在跑时不能删（`conversation.md`「不能删的时候」，Core 同样拒绝），所以在跑时轮数只增不减。若以后放开在跑时删除，翻页（轮数大增）后再删可能误判成新来的。
7. MainView 里放不放的接线（读整份 `turns`、守卫、`setHandoff`）没有挂载 MainView 的测试，只由规则的纯函数测试与 typecheck 守着；放的这一段由 hook 测试守着。
8. 没有气泡的先说的一句（理论上只有协议失败提示那种）`findBubble` 找不到，什么都不长，但 `landingTick` 已经加了一，跟随仍按生长的时钟平滑走一次。库里先说的话都是普通字，没见过这种。
