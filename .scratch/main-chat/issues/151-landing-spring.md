# 151 新气泡落定时一次极轻的回弹（同一根弹簧，最多冲过 1.5px）

Status: ready-for-agent（149、150 已合入 main `f6216ac3`）

接口（票 150）：`gui/src/lib/bubble-spring-play.ts` 的 `kickBubbleRow(container, el, peakPx)`（`el` 是这一行里的任一元素；`peakPx` 带符号、负为向上，封顶 1.5px，由同一根弹簧拉回；只动这一行；没有弹簧、减少动态或找不到行时返回 false、什么都不动）与 `bubbleSpringScrolling(container)`（你最近 150ms 内的滚动还在动这些行时为真，落定时人正在滚就不加）；常量 `MAX_KICK_PX` 在 `gui/src/lib/bubble-spring.ts`。

来源：[主对话 PRD](../PRD.md) 裁决 200 第 3 条、裁决 201 第 4 条（JC 2026-11-06：「甲和乙都做」「不做切换器，直接按建议推进」）。只改 GUI 与设计文档；只影响内置运行时的主对话；工作台、子任务、外置运行时零变化。

## 要做到

- 任何一条新气泡进场的动效走完、落定那一刻（你发出时整栏滑完、回复从三点撑开完、叫醒那一轮的回复长完、票 149 的先说的话长完、它的提问撑开完），给它所在的那一行一个沿来向的冲量（从下往上进来的，就往上多冲一点），最多冲过 **1.5px**，再由票 150 的同一根弹簧（阻尼比 0.8、约 350ms 回到 0.5px 以内）拉回原位。
- 不改原有进场的时长与曲线；只放在眼前发生的那次（与各进场自己的条件相同）；落定时人正在滚动就不加（滚动弹性已在管这一行）。
- 减少动态下没有；只在主对话。
- 文档：`docs/design/conversation.md` 各进场里补一句落定回弹，引裁决 200、201；数值写在弹簧模块里，不另抄。

## 验证与边界

同票 150（typecheck、lint、`TZ=UTC` 全量 vitest、docs links、`git diff --check`；自建 worktree 从本地 main 起、先 `pnpm --dir gui install`；不碰主工作树、不跑 `tauri dev`；只点名提交、`Co-Authored-By` 行；全角标点自扫，脚本 `t151-` 前缀；长命令前台跑）。合入后主会话在 dev 真窗口量。

## 回报

同票 150 的格式，写在本文件末尾「## 报告」一节。

## 报告

2026-11-06，代理在分支 `t151-landing-spring` 上做完（从本地 main `ba78bc74` 起，含 149、150），代码、测试、文档在 `eb3c6a24`，本节另一个提交；未 push、未合入。中途主会话转来 dev 真窗口探针的发现（第 1 轮先说的话没有长），查清、修了，一并在 `eb3c6a24` 里，见下第 2 节。

### 1. 要做到的各条在哪（行号按 `eb3c6a24`）

- **规则**：`gui/src/lib/bubble-spring.ts:195` `landingKick(travel)`：这次进场里它在屏上往上走过（超过 0.5px，`:183`）就往上冲 `-MAX_KICK_PX`，否则往下冲 `MAX_KICK_PX`。冲多远只用票 150 的常量 `MAX_KICK_PX`，没有另抄数值。
- **入口**：`gui/src/lib/bubble-spring-play.ts:560` `landAfter(container, el, entrance, travel)`：等进场动画的 `finished` 兑现再给这一行冲量（`:568` 调票 150 的 `kickBubbleRow`，同一根弹簧拉回，邻居不动）；`finished` 被拒（被后来的动效取消、放到终点）不加；`:567` 人正在滚（`bubbleSpringScrolling`）、这一行已不在文档里都不加；减少动态与不是主对话由 `kickBubbleRow` 返回假。
- **五种进场**：
  1. 发出整栏滑完：`gui/src/lib/bubble-motion-play.ts:461` `playSend`，`:480` 拿到滑动的动画（`slideColumn` 改成返回它们，`:328`），`:481` 你的气泡那一行，`:484` 滑完往上冲（来向是 `-slide.distance`，从下往上）。没有滑动（减少动态、超过 800px 直接到位）、叫醒的下半场（没有你的气泡）不加。
  2. 回复从三点撑开完、3. 叫醒那一轮的回复长完、5. 它的提问撑开完：都是 `gui/src/hooks/useTypingBubbleHandoff.ts` 的 `playTypingHandoff`，`:511` `growTint` 改成返回展开那段动画，`:522` `landWhenGrown`（`:349`）。
  4. 先说的话长完：同文件 `playToldLine`，`:621`、`:632`。
- **沿来向**：`landWhenGrown` 用第一帧它在屏上的位置（量的时候的位置加上按住对话栏的 `lift`，扣掉弹簧的偏移）比展开结束时的位置（`:335` `screenTop`，同样扣掉弹簧偏移）。跟随着、或不满一屏被放上来时是往上走来的，往上冲；往回翻着、在原处长出来时往下冲（底色是从左上角往下展开的），见 Open risks 第 1 条。
- **不改原有时长与曲线**：各进场的 `animate` 调用、次序、关键帧、选项一字未改，只多等它们的 `finished`；交接、叫醒进场、发出、先说的话的既有测试全过、一条没改。
- **只放眼前那次**：只在各进场自己放了的那一次挂上（条件就是它们的条件）。
- **减少动态 / 只在主对话**：减少动态下交接与先说的话走淡入一支，不挂；发出没有滑动，不挂；`kickBubbleRow` 再兜一层。工作台、子任务、外置运行时没有弹簧，`kickBubbleRow` 返回假。
- **文档**：`docs/design/conversation.md` 交接的「落定回弹」（182，回复、叫醒那一轮的回复、提问同此）、先说的一句的「落定回弹」（220）、发出那一下的「落定回弹」（296）、「滚动时的弹性」里的「落地回弹」改写成做法（310），引裁决 200 第 3 条、201 第 4 条与本票；`docs/design/foundations.md` §2.7「滚动时的弹性是 A 类」后补一句落地回弹同属 A 类（633）。

### 2. 真窗口探针：第 1 轮先说的话没有长

- **原因**：先说的话在主对话里按「位置」记 React key（`Conversation.tsx` 的 `renderLineRow`，`turn-${ordinal(turnIndex)}`，序号就是它在 `turns` 里的下标）。说出它的那一步晚它一点落下，store 把那一步插在它前面（`stores/messages.ts` 的 `withLandedStep`，为了与库里恢复的次序一致），在跑时那一步又不画，于是这句的下标加一、key 变了，整行被卸掉、重新挂一个新节点。生长的 `clip-path` 与字的淡入都挂在旧节点上，新节点从第一帧就是完整的样子；跟随与三点那一行的推移不在这一行上，照样平滑走完。那一步离这句不到 240ms 就看得见（`tell_user` 跑得快，那一步几乎马上结束，所以与它同一秒落库）；步骤里写的话（票 142）早约 1 秒，生长早已结束，重挂看不出来，与探针的第 2、3 轮一致。不是「找不到气泡」（Open risk 8），也不是同一次提交里被三点的出现或离开放到终点（Open risk 4：你发起的一轮三点一直在）。
- **修**：`gui/src/components/conversation/Conversation.tsx:718`，主对话里先说的话按消息 id 记 key（`told-<messageId>`），没有 id 时照旧按位置。只在主对话的那条渲染路径（`renderLineRow`）里，工作台不走它。live 与库里的 id 一致（主会话已核），恢复后同一个 key。
- **复现测试**：新文件 `gui/src/components/conversation/Conversation.told.dom.test.tsx`（2 条）：这句画出来后它那一步落在它前面、下一句落下又跟着它那一步，行与气泡都还是同一个 DOM 节点。改前这 2 条都挂（改动临时拿掉跑过一次），改后都过。
- **没有核到的**：探针那一轮没记动画，「`tell_user` 之后不到 240ms 落下那一步」是按代码与复现推的，没拿那一轮的帧证实。合入后请在 dev 用探针再跑一次 `tell_user`，看先说的话那一行是否全程有 `clip-path`、落定时有一次回弹。

### 3. 量位置的代码怎么处理（与票 150 一起）

- 冲量只落在气泡那一行（`translate`），三点那一行从不被冲。交接与先说的话读「看上去在哪」的那几处（`measureTyping` 读三点那一行，`playToldLine` / `playTypingHandoff` 读的是新落下、还没被冲过的气泡）都读不到被冲的行，没改。
- 本票自己算来向时两头都扣掉弹簧偏移（`screenTop`、起点的 `bubbleSpringShift`），不被人的滚动或上一次回弹带歪。
- 被冲过的先说的话可能是下一次落地跟随读的「回复的开头」：`startLanding` 已按票 150 扣掉偏移，没改。

### 改了哪些文件

- `gui/src/lib/bubble-spring.ts`：`landingKick`。
- `gui/src/lib/bubble-spring-play.ts`：`landAfter`。
- `gui/src/lib/bubble-motion-play.ts`：`slideColumn` / `slideColumnBy` 返回动画，`playSend` 挂上落地回弹，注释。
- `gui/src/hooks/useTypingBubbleHandoff.ts`：`growTint` 返回展开那段，`screenTop`、`landWhenGrown`，交接与先说的话各挂一处。
- `gui/src/components/conversation/Conversation.tsx`：先说的话按消息 id 记 key（第 2 节）。
- 测试：新文件 `gui/src/hooks/useBubbleMotion.landing.test.tsx`（11 条：五种进场各自上冲、在原处长的下冲、只冲这一行、邻居与三点不动、不在展开结束前、减少动态、只在主对话）、新文件 `gui/src/components/conversation/Conversation.told.dom.test.tsx`（2 条）；`gui/src/lib/bubble-spring.test.ts` 加 3 条（`landingKick` 方向、350ms 内回到 0.5px 以内）；`gui/src/lib/bubble-spring-play.test.ts` 加 5 条（等 `finished`、下冲、取消不加、人在滚不加、减少动态 / 没有弹簧 / 行不在了都不加）。把冲量那一行临时拿掉跑过一次，9 条本票的测试会挂。
- 文档：`docs/design/conversation.md`、`docs/design/foundations.md`（见第 1 节末条）。

### 验证（照抄输出）

- `pnpm --dir gui typecheck`：`tsc --noEmit` 无输出，退出 0。
- `pnpm --dir gui lint`：`eslint src --max-warnings 0` 无输出，退出 0。
- `TZ=UTC pnpm --dir gui test`：`Test Files  261 passed (261)`、`Tests  2948 passed (2948)`。
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 494 files checked.`
- `git diff --check`：干净。
- prettier：动过的旧文件里 `Conversation.tsx` 在 `ba78bc74` 上就不是 prettier-clean，没对它跑 prettier，自己的 hunk 手排；其余 6 个旧文件在 `ba78bc74` 上是 clean，整文件格式化后 diff 只落在自己的 hunk；两个新测试文件整篇格式化。
- 全角标点：scratchpad 里 `t151-` 前缀的脚本扫新增行，`docs/` 与 `.scratch/` 0 处；`gui/src` 7 处都是英文注释里引「裁决 200 第 3 条」「贴底」这类中文词，同仓库写法，不改。
- 新增行没有本机路径。

### 只能真窗口看的

- 1.5px 的回弹读不读得出来、读成「灵动」还是一下抖动；2 倍屏按 0.5px 一格画，1 倍屏是 1 或 2px 的台阶。
- 发出时：整栏滑完那一刻你的气泡往上冲，三点同一刻开始淡入，两样同时动是否太忙。
- 交接与先说的话：展开结束与跟随滚动结束是否同一帧，回弹方向是否总是对的（往上走来的往上冲）。
- 冲到最高时同一边只隔 4px 的两条气泡之间剩 2.5px，读起来会不会挤。
- 第 2 节的修：`tell_user` 那种马上结束的一步，先说的话那一行是否全程有 `clip-path`、落定时回弹一次。

### Open risks（看到但没改的）

1. 在原处长出来（往上翻着读，没在跟随）时我让它往下冲：这次进场里它没有在屏上走过，「来向」我按底色展开的方向（从左上角往下）取。若 JC 觉得在原处长出来不该动，或该往上，只改 `landingKick` 一处。
2. 冲量一律是满的 1.5px，不随进场的快慢变（一次落地一种大小）。
3. 等它读的插话（在跑时你发出、还没被读到的那几句）也按位置记 key，同样会在它前面落下一步时被整行重挂：它发出时的淡入（160ms）与本票的落地回弹（滑完时）若碰上一步落下就被截掉，票 150 的弹簧对这一行的状态也会清零。这不是先说的话，改你的气泡的 key 牵涉持久化前后两种 id（`queueId` → `messageId`），没在本票改。
4. 来向在展开结束那一刻量（一次 `getBoundingClientRect`，在动画结束后的回调里）；跟随的最后一次滚动若晚一帧写，量到的位移略短，方向不受影响。
5. 人在展开途中滚过、又在结束前 150ms 以外停手时，量到的位移混进了人的滚动：往上翻时可能被读成往下走来、往下冲。
6. 往上翻着时在视口外长完的气泡也会冲一次，看不见；弹簧第一帧就把带外的行放掉，代价只有一帧。
7. 第 2 节的原因是按代码与复现推的，探针那一轮没有动画记录可对。
