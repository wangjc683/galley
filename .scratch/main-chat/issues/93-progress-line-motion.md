# 93 三点下面那一行动起来：换句滚一行、「在做什么」慢扫光

Status: needs-dogfood（2026-10-23 机器验收过、合入 main；等 JC 在 dev 里看主对话三点下面那一行）

来源：[主聊天 PRD](../PRD.md) 裁决 137（2026-10-23；JC：「不做切换器，直接定 2，开始做」）。只改 GUI 与设计文档，不上切换器，JC 在 dev 里看。

## 为什么

- 主对话你发起的一轮在跑时，三点气泡下面有一行小字「{在做什么} · {用时}」（裁决 134、135，部件 `gui/src/components/conversation/TypingBubble.tsx` 的 `ProgressLine`）。JC 真机：「现在比较呆板没有动态，只有秒数变化是动的，前面一个长句子就是完全静态，稍微不够灵动」。
- 「在做什么」只在每一步派出工具时换（`gui/src/lib/assistant-progress.ts` 的 `assistantDoing`），约每十来秒一次，最长一步 40 秒一字不变；换的那一下是瞬间替换。所以要补两半：换句那一下有动静（滚一行），两次换句之间句子上也在动（慢扫光）。

## 要做的

1. **换句滚一行**（`ProgressLine` 的「在做什么」那段）：
   - 「在做什么」的字变了（与上一句不同才算；同一句重渲染不算），旧句往上滚出、新句从下滚进，各走一整行（18px，行高就是 18px），行框外的部分裁掉（这一段 `overflow: hidden`，`truncate-fade` 本来就是）。时长 `--motion-slow`，曲线 `--ease-firm`（`globals.css` 的 motion token；新代码不写 duration / easing 字面量）。
   - 第一次出现（随三点一起出来）不滚。「 · 用时」不滚，照旧每秒换数（`ProgressElapsed` 不动）。
   - 过渡期间这一段的宽度取新旧两句里宽的那个，滚完落到新句的宽度，「 · 用时」一步跟过去，不做水平滑动。宽度照旧受行宽上限（`ASSISTANT_BUBBLE_MAX`）约束。
   - 上一次还没滚完又来新句：从当前位置直接换到最新那句，不排队、不补放中间那句。
   - 离场那句 `aria-hidden`；新句在 `role="status"` 区里照旧被读出（区在 `TypingBubble` 根上）。
   - 截断渐隐照旧：只按屏上那句（新句）判是否截断（`truncationFadeRef` 的 `data-truncated` 是按元素 `scrollWidth > clientWidth` 判的，留意离场那句不要把它撑出误判）；悬停给全文照旧给新句（`syncTruncatedTitle`）。
   - 实现方式你定（Web Animations 或 CSS 类切换都行；`useTypingBubbleHandoff.ts` 用的是 Web Animations，可参考）。遵守 React 编译器 lint：effect 里不同步 setState、渲染期不读 `Date.now`（见 `docs/engineering-workflow.md` 或现有代码的做法）；需要「上一句」可用 guarded setState-in-render 或 ref + layout effect。
2. **慢扫光**：
   - 只扫「在做什么」那一段（「思考中」、步骤那句、「正在写回复」都扫），「 · 用时」不扫。
   - 新起一个类（名字你定，例如 `progress-shimmer`），放在 `gui/src/styles/globals.css` 的 `thinking-shimmer` 旁边，不改 `thinking-shimmer`（工作台思考行在用，`Conversation.tsx:1730`）。几何照抄 `thinking-shimmer`（`linear-gradient(90deg, A 35%, B 50%, A 65%)`、`background-size: 200% 100%`、`background-position` 200% → -200%、`linear`、`infinite`、`background-clip: text` 加 `-webkit-` 前缀、`color: transparent`）；颜色与周期改成：底色 `var(--color-ink-soft)`，光带中心 `var(--color-ink)`，周期 2.4s（B 类循环的周期按语义取值，不在 motion token 里，注释写清）。
   - 注释写清：比工作台淡（底色 `ink-soft` 而不是 `ink-muted`，幅度约一半）、慢（2.4 秒，工作台 1.4 秒与三点同一拍）；为什么允许（foundations §2.7 豁免一，主对话视图里只有这一处；主聊天 PRD 裁决 137）。
   - 与 `truncate-fade[data-truncated]` 的遮罩同时生效（遮罩作用在扫光之后，WebKit 支持；在 dev 里或用测试确认类名同时挂上即可）。如果滚动实现里同一时刻有两个元素（旧句、新句），两句都带扫光。
3. **减少动态**（`prefers-reduced-motion: reduce`，CSS 侧 `@media` 实时生效；JS 侧如需判断，每次读 `matchMedia`，不缓存，同 `lib/animate-scroll.ts`）：
   - 扫光关掉：`animation: none; background-image: none; color: var(--color-ink-soft)`（同 `thinking-shimmer` 的写法）。
   - 换句只淡出淡入、不滚：旧句原位淡出、新句原位淡入，同一时长与曲线。
4. **交接**（`gui/src/hooks/useTypingBubbleHandoff.ts:303` 起，那一行的拷贝原位淡出）：
   - 拷贝只带当前那句：克隆时若正有离场那句，从拷贝里去掉，宽度按当前那句。
   - 扫光接着原来的相位走，不从头跳：照同文件 `:285` 起三个点的做法（读原元素扫光动画已跑的时间，给拷贝设负的 `animation-delay`）；减少动态时没有扫光，不用管。
   - 别的交接逻辑不动。
5. **设计文档**（中文，标点全角，代码用反引号）：
   - `docs/design/conversation.md`「在跑时：三点气泡」一节：
     - 「三点下面那一行」的「写法」那条（约第 142 行）：把「不扫光、不动」改成本票的画法（换句滚一行、「在做什么」慢扫光、用时不滚不扫，数值与 token 写上），引用裁决 137。
     - 「为什么」那条（约第 127 行）末尾「这里是两样……不扫光」：改成现状（三点、扫光、跳秒三样，是 JC 按真机实感直接定的，裁决 137），保留 08-12 先例的来龙去脉。
     - 「交接」（约第 132 行）与「减少动态」（约第 138 行）各补一句本票的规则。
     - 「代价」（约第 159 行）补裁决 137 第 7 条的翻车点。
   - `docs/design/foundations.md` §2.7：
     - 豁免一的「豁免边界」（约第 643 行）「当前独占 thinking 行」改成两处各在自己的视图（工作台思考行、主对话三点下面那一行的「在做什么」）。
     - 约第 647–652 行那段（主对话三点气泡与那一行、「两样并列、不扫光」）：改写成现状，写清 10-23 先定不扫光、同日 JC 嫌呆板直接定扫光（裁决 137），三样同时动是有意接受的代价；保留 10-15 到 10-19 那一行用过扫光的历史。
   - 别处若还写着这一行「不扫光」「不动」，`grep -n "不扫光" docs/design` 一并改；`.scratch/` 下的 PRD 与旧票不改（主会话维护）。

## 测试

- `TypingBubble` 渲染：「在做什么」那段带扫光类，「 · 用时」那段不带。
- 换句：字变了才进入滚动状态，同一句重渲染不进入；第一次出现不滚；连续两次换句只留最新那句（可用 fake timers 或直接测你抽出的纯函数 / hook）。
- 离场那句带 `aria-hidden`，`status` 区里能读到的只有新句。
- 交接：克隆出的那一行不含离场那句（`useTypingBubbleHandoff` 现有测试旁加一条）。
- 现有 `TypingBubble`、`MainView.assistant.test.tsx`、`useTypingBubbleHandoff` 与 `assistant-progress` 相关测试照旧全过。

## 别动

- 主工作树：只在你的 worktree 里做（路径在派单里），不碰主树，不跑 `tauri dev`。
- 「在做什么」的内容规则（`assistant-progress.ts` 的 `assistantDoing` 及其优先级）、用时的算法与字、行的位置与尺寸（`mt-1.5`、18px、12px、`ink-soft`、`ASSISTANT_BUBBLE_MAX`）、三点本身、侧栏卡片、顶栏、工作台思考行的 `thinking-shimmer`。
- `core/`、`runner/`、`managed-ga/`、提示词；`.scratch/` 下的 PRD（主会话维护）。
- `gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk，新文件可整篇格式化。React 编译器 lint：工具函数别从组件文件导出。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- `pnpm --dir gui typecheck`、`pnpm --dir gui lint` 通过
- `CI=true pnpm --dir gui test` 全过，再 `TZ=UTC CI=true pnpm --dir gui test` 一遍
- `node scripts/check-docs-links.mjs`
- `git diff --check`
- 报告写在本票末尾「## Comments」下：改了哪些文件、怎么实现滚动与相位接续、没验证到的（例如真机上扫光与渐隐遮罩叠加的样子、四样一起动的观感）原样列出。

## Comments

### 2026-10-23 回报（票 93 代理）

**1. 提交列表**（`git log --oneline main..HEAD`，写本回报之前；本回报另起一个提交）

````text
ba403c4a Ticket 93: design docs for the moving progress line (ruling 137)
203b970d Ticket 93: the progress line rolls a new sentence in and sweeps slowly (ruling 137)
````

**2. 改了哪些文件**

- 新文件 `gui/src/lib/progress-line-motion.ts`：换句的规则（纯函数 `progressRollStart`、`progressRollNext`、`progressRollSettle`，关键帧 `progressRollIn` / `progressRollOut`，`progressRollMotion` 按减少动态选滚或淡），时长与曲线从 token 读（`readProgressRollTiming`：`--motion-slow`、`--ease-firm`，读不到就是瞬间替换），扫光动画名常量 `PROGRESS_SHIMMER_ANIMATION`。
- 新文件 `gui/src/hooks/useProgressRoll.ts`：页面上的滚动（下面第 3 条）。
- `gui/src/components/conversation/TypingBubble.tsx`：`ProgressLine` 的「在做什么」换成 `ProgressDoing`；文件不导出新东西。
- `gui/src/styles/globals.css`：`thinking-shimmer` 旁边新加 `@keyframes progress-shimmer` 与 `.progress-shimmer`（减少动态的 `@media` 同 `thinking-shimmer` 的写法）。`thinking-shimmer` 的样式一个字没动，只改了它注释里一句「This is the one sanctioned shimmer」，改成工作台那一处、主对话另有 `progress-shimmer`（一个视图一处），免得两处注释打架。
- `gui/src/hooks/useTypingBubbleHandoff.ts`：交接拷贝（下面第 4 条）。
- 测试：新 `gui/src/lib/progress-line-motion.test.ts`、新 `gui/src/components/conversation/TypingBubble.test.tsx`；`gui/src/hooks/useTypingBubbleHandoff.test.tsx` 加两条；`gui/src/components/screens/MainView.assistant.test.tsx` 改一条（原来断言这一行「no sweep, no motion」、类名是 `truncate-fade min-w-0`，按裁决 137 改成「在做什么」带一次 `progress-shimmer`、外面一层裁切盒，用时照旧不带）。
- 文档：`docs/design/conversation.md`「在跑时：三点气泡」（标题行引用、「为什么」末尾、交接的「怎么长」与「减少动态」、「写法」改写并新增「动起来」一条、这一行的「交接」、「代价」补裁决 137 第 7 条）；`docs/design/foundations.md` §2.7（豁免边界、主对话那一段）。`grep -n "不扫光" docs/design` 现在剩下的五处，都是讲裁决 134 当时的写法（及被裁决 137 推翻），或减少动态下不扫光的规则。

**3. 滚动怎么实现**

- 「在做什么」那段是一个裁切盒（`<span data-role="assistant-progress-doing-box" class="grid min-w-0 overflow-hidden">`），里面每句一个 `<span>`，都放在同一个格子里（`col-start-1 row-start-1`），类是 `truncate-fade progress-shimmer … max-w-full min-w-0 justify-self-start`。盒子的宽度是格子里最宽那句（封顶照旧是这一行的 `ASSISTANT_BUBBLE_MAX`），所以过渡期间取新旧两句里宽的那个、离场那句拿掉后落到新句，「 · 用时」一步跟过去。`justify-self-start` 让每句只有自己的宽度，截断按自己判（`truncationFadeRef` 照旧挂在每句上），离场那句再宽也不会把新句判成截断；扫光的 `background-size` 也跟着各自的宽度，离场那句拿掉时光带不跳。
- 状态在 `useProgressRoll`：`{ current, leaving[] }`，句子按出现顺序编号当 key。字变了才换（guarded setState-in-render，同 `ExpandSection` 的写法，离场那句与新句在同一次提交上屏）；同一句重渲染返回同一个对象，什么都不放。第一次出现编号 0，记为已放过，不滚。盒子里按 `[...leaving, current]` 画，key 不变，所以屏上那句开始离场时还是同一个元素。
- `useLayoutEffect` 在带来新句的那次提交里放一次：先 `getComputedStyle` 读刚变成离场那句当下的 `transform` / `opacity`，再停掉它自己还在跑的滚进，从读到的位置往上滚出（`translateY(-100%)`，`fill: "forwards"`，滚完之前不会弹回原位），新句从 `translateY(100%)` 滚到 0；时长、曲线读 token，每次读 `matchMedia`，减少动态下改成原位 `opacity` 淡出淡入。离场那句的动画结束后从状态里拿掉（promise 回调里 setState，不是 effect 里同步 setState）。
- 上一次没滚完又来新句：正在滚进的那句从当下位置掉头往上滚出，更早还在滚出的那句不打断、走完自己的；最新那句从下滚进；不排队，中间那句不补放。票面写「从当前位置直接换到最新那句」，我理解成这样；另一种读法是更早那句当场拿掉，那样它会在半截处闪没，所以没选。
- 离场的句子 `aria-hidden`、`pointer-events-none`，没有 `onPointerEnter`；悬停全文只挂在新句上（`syncTruncatedTitle`）。
- 没有 Web Animations（jsdom）时换句就是瞬间替换，不留离场那句；token 读不到时离场那句在下一个微任务里拿掉，也是瞬间替换。

**4. 交接的拷贝与扫光相位**

- 拷贝只带屏上那句：克隆这一行后，把 `[data-role="assistant-progress-doing-leaving"]` 从拷贝里删掉。宽度：这一行本身是块级 flex，宽度是这一行能占的宽度（封顶 88%），与说了什么无关，所以 `lineBox.width` 照旧可用；离场那句删掉后，拷贝里的裁切盒按屏上那句排，用时跟在它后面。拷贝里那句停在原位，不接着滚（Web Animations 不随 `cloneNode` 复制）。
- 扫光相位：照三个点的做法。`measureTyping` 每次量的时候一起读那句扫光动画开始的时刻（`getAnimations()` 里 `animationName === "progress-shimmer"` 的那个的 `startTime`，滚动用的 Web Animations 被这个名字筛掉），记在 `TypingRecord.sweepStart`；交接时 `ran = now - sweepStart`，给拷贝里那句设 `animation-delay: (原 delay − ran)ms`。和三个点不同的一处：每换一句是一个新元素、新的一段扫光，而量的那次提交正是把它带上屏的那次，那时它的 `startTime` 还是 `null`（下一帧才开始），这时按当下的时间线时刻算，差不到一帧。减少动态时没有这个动画，`sweepStart` 为 `null`，什么都不设。

**5. 测试**

- `lib/progress-line-motion.test.ts`（7 条）：第一次出现不滚；字变了才滚、同一句返回同一个对象；连续两次换句最新那句在屏上、中间那句排在离场里、不排队，拿掉按编号；没有动画时不留离场；滚 / 淡的关键帧，半途掉头从读到的位置出发；token 读得到、读不到。
- `components/conversation/TypingBubble.test.tsx`（9 条，jsdom，`animate` 用可手动结束的假实现）：「在做什么」带 `progress-shimmer`、用时不带；第一次出现与同一句重渲染不调 `animate`、没有离场那句；换句时同一个元素变成离场那句、关键帧与 `{ duration: 240, easing: cubic-bezier(0.2, 0, 0, 1) }`、离场那句 `fill: "forwards"`；离场那句 `aria-hidden`，`status` 区去掉 `aria-hidden` 后的文字只有「Galley 正在输入」加新句；滚完离场那句被拿掉；滚到半途再换句：滚进的动画被取消、从 `translateY(6px)` 掉头滚出、更早那句不被打断、屏上是最新那句；减少动态每次换句时读、走淡入淡出；token 读不到时瞬间替换；没有 Web Animations 时瞬间替换。
- `hooks/useTypingBubbleHandoff.test.tsx`（加 2 条）：滚到半途交接，拷贝里没有离场那句，文字是「新句 · 12 秒」，裁切盒里只有一句；扫光相位接续（假 `getAnimations` 与 `document.timeline`：开始于 1000ms、交接在 1600ms，拷贝那句 `animation-delay` 是 `-600ms`，混在一起的滚动动画不被当成扫光，用时不设）。
- 现有 `TypingBubble` / `MainView.assistant.test.tsx` / `useTypingBubbleHandoff` / `assistant-progress` 相关测试照旧全过（`MainView.assistant.test.tsx` 那一条按上面第 2 条改过）。

**6. 验证**（都在 worktree 里，提交之后重跑）

- `pnpm --dir gui typecheck`：通过
- `pnpm --dir gui lint`：通过（0 warning）
- `CI=true pnpm --dir gui test`：207 个文件、2281 条全过
- `TZ=UTC CI=true pnpm --dir gui test`：207 个文件、2281 条全过
- `node scripts/check-docs-links.mjs`：`docs link gate OK: 474 files checked.`
- `git diff --check main HEAD`：无输出
- 文档新增行全角标点：用临时脚本扫了 diff 新增行里贴着中文的半角 `, ; : ( ) ? !`（反引号与链接目标除外），0 处。
- 格式：新文件整篇 prettier；旧的 TS 文件 prettier 输出与现状一致；`globals.css` 只看自己的 hunk（整文件本来就不是 prettier-clean）。
- 额外：用一个临时 Swift 脚本在真 WKWebView 里按同一套 CSS（手写，不是 Tailwind 编译产物）排了四种情况并量宽度：长旧句（截断）加短新句同在时，盒宽取长的（311.4px），新句 `scrollWidth == clientWidth` 不被判成截断，用时跟在 311.4px；短句单独时盒宽 57.6px、用时跟过去；长句单独照旧截断；短旧句加长新句时盒宽取新句。又截了一张静帧：扫光冻结在一个相位、截断那句带渐隐遮罩、滚动冻结在半途（旧句露下半截、新句露上半截，被盒子裁掉）、减少动态的实色——WebKit 里 `background-clip: text` 与遮罩、`transform` 叠在一起都画得出来。离屏窗口不跑动画，所以动起来的样子没看。

**7. Open risks / not verified**

- 真机 WebKit 里扫光与截断渐隐遮罩叠加的动态观感没看过：只在离屏 WKWebView 里截了静帧（扫光、遮罩、半途的滚动都冻结），动画没跑。
- 三点、扫光、跳秒加侧栏那张脸，四样一起动的观感没看；一直扫的光会不会放大等待感、长句扫得快不快，也没看（裁决 137 第 7 条，等 JC 在 dev 里看）。
- 扫光的实际节奏与裁决的说法对不上：几何照抄 `thinking-shimmer`（`background-size: 200%`、`background-position` 从 200% 到 -200%），背景是平铺的，所以一个周期里光带穿过文字两次。2.4 秒的周期实际是约每 1.2 秒扫过一次、每次横穿约 0.6 秒（工作台同理：1.4 秒的周期是约每 0.7 秒一次），不是裁决 137 第 3 条写的「约 2.4 秒扫一趟」。我照票面写了 2.4s；要真的 2.4 秒一趟，把周期改成 4.8s 或把行程改成 200% → 0%，等 JC 看过再定。
- 交接正好撞上换句半途时（例如它向你提问：提问那一步派发后问题很快就到，裁决 135 第 3 条），拷贝里那句直接停在原位，等于从半途的位置往上跳了不到 18px，接着 120ms 淡出；减少动态时半透明的新句在拷贝里是不透明的。都没在真机上看。
- 扫光相位接续只在 jsdom 里用假的 `getAnimations` / `document.timeline` 测过；真 WebKit 里 `CSSAnimation` 的 `animationName` / `startTime` 在 app 里是否如预期、刚换上那句「按当下算」差的那一帧看不看得出来，没验证。
- 连续换句时格子里同时有三句（两句在滚出、一句在滚进）的样子只在 jsdom 里验证了排列与动画参数，没看过真机。
- 读屏：离场那句加 `aria-hidden` 与插入新句在同一次提交里，VoiceOver 实际念出什么没测（jsdom 只验证了去掉 `aria-hidden` 后的文字）。

### 主会话验收（2026-10-23）

- 读过全部代码改动；在 rebase 到 main 后的分支上重跑 typecheck、lint、`CI=true` 与 `TZ=UTC` 两遍测试（207 个文件、2281 条全过）、`check-docs-links`、`git diff --check`，都通过；新增文档行全角标点扫过（唯一命中是 markdown 链接的括号）、无本机路径。
- 报告第 3 条（扫光节奏）属实：平铺的 200% 背景从 200% 走到 -200% 是两块，一个循环扫两趟。照裁决 137 第 3 条「约 2.4 秒扫一趟」改成行程 200% → 0%（`5f02585b`），一个循环正好一趟；工作台照旧（约 0.7 秒一趟）。裁决 137 的说法同步改正（`b71a10f9`）。
- 其余 open risks 原样转给 JC，真机看。
