# 08 拆切换器定稿：A3、B1、C2、D2

Status: merged（2026-10-16 合入 main，`6425fbd6`，合并提交 `47bda701`；等 JC 真机验收）

来源：[PRD](../PRD.md) 裁决 6 的切档裁决（JC：「按你推荐，A3 和 B1」）与裁决 3a 的切档裁决（JC：「选 C2」「选 D2」），2026-10-16。只改 GUI 与文档。
与票 09 并行（09 改工作台留白里的提问滚动，两张都会碰 `conversation.md`，各改各的节）。

## 要做

拆法以 `gui/src/components/conversation/td-variants/td-variants.ts` 开头的说明为准，逐条核对；所有 `TEMP variant switcher (telegram-details 05)` / `(telegram-details 07)` 标记清零（grep 确认）。

1. **整颗切换器**：删 `td-variants/` 整个文件夹（含 `td-demo.ts`「演示连发」与测试）、MainView 的 pill、Conversation 的演示替换（`turns` / `agentRunning` / `askUserPending` 回到直接用 props）。localStorage 里的 `galley.tmp.tdVariants.*` 不用迁移（临时键，留着无害；要清就在启动时删一次，你定）。
2. **A3 写死**：输入框长高、变矮一律按距离：`round(50 × ln|Δh|)` ms，Δ 不到 1px 不动，首次挂载瞬间，减少动态效果瞬间，半路接着走（`lib/composer-grow.ts` 现有行为）。**缓动换成我们的 `--ease-firm`**（`cubic-bezier(0.2, 0, 0, 1)`，在 `foundations.md` 的动效 token 里）：逐帧写高度，所以要在 JS 里按这条三次贝塞尔求值；数值从 token 的定义处取或注释里写明出处，别另抄一份不同步的数。A1、A2 的分支与 `"instant"` / `"fixed"` 档删掉（首次挂载、减少动态的瞬间路径保留）。
3. **B1 不改**：删组内圆角的代码（`assistantGroupCornerClass`、Conversation 的 `below` 参数、`groupJoins`、重画上一条的 `lastLineRow`、`--bubble-group-radius`）。从 `assistantRowGap` 抽出的 `assistantJoinsGroup` 若只剩 `assistantRowGap` 一个调用方，并回去或留着你定，别留只为圆角存在的东西。
4. **C2 写死**：`ComposerQuoteStrip` 只留 ↳ 在 ＋ 那一列、一行的画法，删 C1 分支与 variant prop。
5. **D2 写死**：`MessageQuotes` / `MessageUser` 只留气泡内顶部的画法，删 D1 分支与 variant prop。**D1 为停靠开的例外一起删**：票 07 让提交贴顶、⌥↑ / ⌥↓、问题轨、⌘K / ⌘F 定位停在引用的上缘（`lib/conversation-anchor.ts` 等），D2 的引用在气泡里，停靠回到气泡上缘这一条规则；删干净后跑停靠相关测试确认。
6. **文档**：
   - `docs/design/conversation.md`：「会话里的输入框」写 A3（时长公式、`--ease-firm`、瞬间的三种情形）；「助手的对话」气泡与连发间距处写明组内圆角不做（B1，理由一句、指向 PRD 裁决 6）；「引用条」写 C2；「你引用的话」写 D2（块的底、竖线、字号、三行省略与点开）。删掉所有「切换器」「待真机」字样。
   - `docs/design/foundations.md` 动效一节：票 04 已写「程序滚动的时长随距离变，不在固定刻度里」，把输入框长高并进同一条（时长随距离变；缓动仍用 token）。
   - 票 05、07 的 Comments 各补一行「票 08 定稿」。

## 验收

- grep `td-variants`、`tdVariants`、`TEMP variant switcher` 在 `gui/src` 里零命中。
- typecheck、lint、全量 gui 测试两遍（本机时区、`TZ=UTC`）、`git diff --check`；中文标点脚本扫新增行。
- 删掉的测试要有对应的定稿测试接上：A3 的时长与 `--ease-firm` 曲线、C2 的画法、D2 的画法与停靠回到气泡上缘。
- 真机（JC）：小按钮没了；输入框长高按 A3；连发气泡全 12px；引用条是 ↳ 一行；气泡里引用在内顶部；带引用的消息 ⌥↑ 停靠位置正确。

## Comments

### 2026-10-16 实现（子代理，分支 `td-composer`）

按 `td-variants.ts` 开头的拆法逐条核对：

- **Always**：删 `td-variants/` 整个文件夹（`td-variants.ts`、`TdVariantsPill.tsx`、`td-demo.ts`「演示连发」、`td-variants.test.tsx`）；MainView 的 pill 与 import；Conversation 的演示替换（`turns` / `agentRunning` / `askUserPending` 回到直接用 props）与 `groupCorners` 的读取。
- **A3 胜**：`Composer` 不再传档位，改成 `if (oneLine && animateTextareaHeight(el, oneLineMaxHeightPx)) return;`，卡片照旧瞬间。`lib/composer-grow.ts` 删掉 `ComposerGrowTiming`、`"instant"` / `"fixed"` 档、`COMPOSER_GROW_FIXED_MS` 与 CSS `ease-out` 的 `easeOut`；`composerGrowDurationMs(Δh)` 只剩 `round(50 × ln|Δh|)`，不到 1px 为 0。首次挂载、减少动态效果的瞬间路径与半路接着走都保留。
- **B1 留着**：删组内圆角的全部代码。Conversation.tsx、`lib/assistant-conversation.ts` 与它的测试从票 05 之后只有票 05 改过（`git log` 核对过），三个文件直接还原到票 05 之前（`00ae635c^`）：`assistantGroupCornerClass`、`below` 参数、`groupJoins`、`lastLineRow` 都没了，`--bubble-group-radius` 本来就只在 `td-variants.ts` 里设。`assistantJoinsGroup` 只剩 `assistantRowGap` 一个调用方，并回去了（`previous === side ? "mt-1" : "mt-5"`，与票 05 之前一字不差），没留只为圆角存在的东西。
- **C2**：`ComposerQuoteStrip` 只留 ↳ 在 ＋ 那一列、一行截断（全文在原生 tooltip），删 C1 分支、`QuoteStripVariant` 与 `variant` 属性；Composer 不再读 store。
- **D2**：`MessageQuotes` 只留气泡内顶部（一个 `quotes` 属性），删 `placement`、`MessageQuotesVariant`、D1 的样式与 `data-role="message-quotes"`；`MessageUser` 只在气泡里画。**D1 的停靠例外**：`lib/conversation-anchor.ts` 删掉 `quotesAbove` 与 `userMsgParkOffset` 里的分支，整个文件回到票 07 之前一字不差；其余四条路径（⌥↑ / ⌥↓、问题轨、⌘K / ⌘F 定位、提交贴顶）本来就都走 `userMsgParkOffset`，没有别的分支要删。
- **localStorage 的 `galley.tmp.tdVariants.*`**：不清。只存在于 JC 的 dev 页面（`localhost:1420` 源，安装版的源从没写过），五个几字节的临时键，没人读；为它写一段启动时清理的代码，比留着的害处更大。
- **grep**：`gui/src` 里 `td-variants`、`tdVariants`、`TEMP variant switcher` 都是 0 条；`bubble-group-radius`、`assistantGroupCornerClass`、`assistantJoinsGroup`、`groupJoins`、`lastLineRow`、`quotesAbove`、`composerGrowTiming`、`TD_DEMO` 也是 0 条。

**`--ease-firm` 在 JS 里怎么求值**

- 出处：token 定义在 `gui/src/styles/globals.css` 的 `@theme`（`--ease-firm: cubic-bezier(0.2, 0, 0, 1);`），`foundations.md`「Motion tokens」表里列着。代码里不抄这四个数：每次开始一段动画时，`getComputedStyle(document.documentElement).getPropertyValue("--ease-firm")` 读页面根上的值（Tailwind v4 把用到的 `@theme` 变量发在根上，`ease-firm` 这个 utility 到处在用），`parseCubicBezier` 解析出四个数，`cubicBezier(x1, y1, x2, y2)` 求值：x(s) 在 x1、x2 落在 0–1 时单调，二分 30 次找到时间 t 对应的参数 s，再算 y(s)。读不到或不是 cubic-bezier 时不动画、走瞬间路径（不留一份兜底的数）。
- 实测（Chrome 无头）：根上读到 `"cubic-bezier(0.2, 0, 0, 1)"`；一行到三行（32 → 77px）在 190ms 时落定，与 `round(50 × ln 45)` = 190 一致。
- 测试读的也是定义处：`composer-grow.test.ts` 用 `fs` 读 `globals.css`、正则取出 `--ease-firm` 的值，喂给假的 `getComputedStyle`；另用 CSS `ease-out` 的已知值（0.5 → 0.6847、0.25 → 0.3781）和对 `--ease-firm` 的暴力取样（20 万个点）校验求值器。

**测试（删掉的都有定稿测试接上）**

- A3：`composerGrowDurationMs`（不到 1px 为 0；22 / 45 / 157px → 155 / 190 / 253ms，变矮同样）；token 解析（从 `globals.css` 读到 `[0.2, 0, 0, 1]`，非法值为 null）与求值；逐帧高度按 `--ease-firm`（第 1、5 帧的值、190ms 落定）、变矮 253ms、半路接着走、封顶、首次挂载与无变化瞬间、减少动态效果瞬间并停下进行中的动画、token 读不到时瞬间且不碰样式；贴底：每一帧都钉住（三种距离），以及「在滚动事件之前移动会掉一帧」的反证；接线在 Composer 的瞬间路径之前。
- C2：`Composer.test.tsx` 新增一条：↳ 在 ＋ 那一列（`w-8`）、一行截断、换行并成空格、没有 `line-clamp` 与竖线。
- D2：`MessageQuotes.test.tsx` 改写：引用在气泡里、在你的话之上、没有 `>`、气泡前面没有引用；块的底、竖线、三行省略；长消息折叠只算你的话；只有引用不画空行。
- 停靠：`conversation-anchor.test.ts` 换成一条：气泡前面有什么兄弟节点都不读，停的是气泡自己的上缘。
- typecheck、lint、`git diff --check` 通过；全量 gui 测试两遍：本机时区 145 个文件 1511 条、`TZ=UTC` 145 个文件 1511 条，全过（`td-variants.test.tsx` 与组内圆角的测试删了，定稿测试接在上面几个文件里）。

**文档**

- `conversation.md`：「会话里的输入框」加「长高的动画」一条（A3 的公式与三档时长、`--ease-firm` 与 JS 求值、瞬间的三种情形、半路接着走、为什么逐帧、为什么按距离、卡片照旧瞬间）；「分组间距」后补一句组内圆角不做（B1，指向裁决 6）；「引用条」改成 C2（↳、一行、tooltip，框高 78 / 106 / 134px）；「你引用的话」改成 D2（块的底、竖线、字号、三行省略与点开、停靠照旧按气泡上缘、为什么在气泡里与代价）。所有「切换器」「待 JC 真机定」字样已删。「Scroll behaviour」一节没碰。
- `foundations.md`「Motion tokens」：「程序发起的平滑滚动」那一段改成「时长随距离变的动效不在这个刻度里，两处」，加上输入框长高（时长随距离变，缓动仍用 `--ease-firm`，在 JS 里从 token 读）。
- 票 05、07 的 Comments 各补一行「票 08 定稿」。

**JC 真机验收**

1. 右上角的「临时 · …」小按钮没了。
2. 一行式输入框打字换行、粘贴一大段、发出后缩回一行，都是按距离的缓动（多一行约 155ms，满 8 行约 253ms），对话全程贴底不跳；系统开了「减少动态效果」时瞬间。工作台在流式输出时打多行，看会不会因掉帧一顿一顿（裁决 6 里记的待看项）。
3. 主对话连发的气泡四角都是 12px。
4. 引用条是 ↳ 一行；气泡里引用在内顶部。
5. 带引用的消息按 ⌥↑ 停靠，气泡上缘（连同里面的引用）停在视口顶下 32px（有时间条时时间条停在 16px），引用不被切掉。
