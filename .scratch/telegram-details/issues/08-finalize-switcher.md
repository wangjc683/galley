# 08 拆切换器定稿：A3、B1、C2、D2

Status: ready-for-agent

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
