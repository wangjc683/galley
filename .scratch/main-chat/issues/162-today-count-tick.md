# 162 顶栏待办按钮：「今天 N」的数字变了跳一下，按钮宽度的变化走过渡

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 208 第 4 条（JC 2026-11-11：「做 1+2+4」）。只改 GUI 与设计文档；只在内置运行时有主对话时有这颗按钮，外置运行时零变化。不碰 Core、CLI、手册、评测。

先读 [dispatch](../../../docs/agents/dispatch.md)「Standing constraints for executor agents」、`docs/design/foundations.md` §2.7、`docs/design/layout-and-chrome.md` §4.1「待办按钮」与「禁止」、`gui/src/components/layout/header/TodoToggleButton.tsx` 文件头的注释（按钮的三种样子、什么时候是胶囊）。

## 为什么

勾掉一件今天的事，顶栏按钮上的「今天 N」一帧换成 N−1；最后一件勾掉时数字不见，按钮从带数字的宽度一帧收回 28px 的方块，它旁边的东西跟着跳。

## 要做的

1. **数字跳一下**：N 在挂载之后变了（多了、少了、从没有到有）的那一下，数字用 `sidebar-step-tick`（`gui/src/styles/globals.css` 现成的：淡入加上移 1px，`--motion-slow`）。挂载时、切会话带来的重新挂载不放。
2. **宽度走过渡**：按钮的宽度因为数字出现、不见、位数变了（9 → 10）或三种样子之间切换而变的那一下，从旧宽度走到新宽度，`--motion-base`、`--ease-firm`，顶栏里它旁边的东西跟着平滑让位。实现由你定（量前后的宽度再用 Web Animations，或别的办法）。真窗口在 macOS 上是 WKWebView、Windows 上是 WebView2，两边都要行：不许用 `interpolate-size`、`calc-size()` 这类 WebKit 还没有的 CSS。宽度走的途中字不换行、不被压扁（裁掉可以）。
3. **数字不见的那一下**：数字跟着宽度收回时淡出或被裁掉都行，不能先一帧不见、再收宽度。
4. **与接住卡片的 pop 不打架**：卡片飞进来、按钮 pop（`todo-catch-pop`，主聊天票 102、104）的同时数字也可能变（记下一件今天到期的事）。pop 的规则不改（胶囊时只弹图标）；两样落在不同的元素上、同时走，不排队。做下来有冲突写进回报。
5. **减少动态**（`prefers-reduced-motion`）：宽度一步到位；数字只淡不移（`sidebar-step-tick` 现在在减少动态下还移 1px 的话，给这一处补成只淡）。
6. 静止时的样子与现在逐像素相同。选中底色、悬停、无障碍名、悬停提示的规则不变。

## 设计文档

`docs/design/layout-and-chrome.md` §4.1「待办按钮」加一条（2026-11-11、票 162、裁决 208）：数字跳与宽度过渡的规则、数值、减少动态；说明它不算 §4.1「禁止」里的「健康状态用动效」：一次性、由清单的变化触发、不循环（同接住卡片的 pop 的说法）。

## 别动

- N 怎么算（`gui/src/lib/todo-button.ts`）、三种样子的判定、飞行与 pop（`lib/todo-flight*.ts`）。
- 顶栏别的按钮与分组。
- `globals.css` 里 `sidebar-step-tick` 本身的关键帧（侧栏在用）；要补减少动态就给这颗按钮自己加一个类，写在 `todo-catch-wash` 那一段后面，自带 `@media`。票 160、161 也在这个文件里各加一段，位置不同。
- `gui/src/components/todo/`、`ui/checkbox.tsx`：票 160、161 在改。
- `.scratch/main-chat/PRD.md` 与别的票。不跑 `tauri dev`。
- `gui/` 现有文件只格式化自己的 hunk；React 编译器的 lint 规则：effect 里不同步 `setState`，渲染期不读 `Date.now()`，工具函数不从组件文件导出。

## 验证

```bash
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui test
node scripts/check-docs-links.mjs
git diff --check
```

测试至少覆盖：挂载时数字不带跳的类；N 变了才带、每次变都重放；N 归零时数字与宽度的处理；减少动态下宽度不走。按钮现有的测试全过。新增的中文行扫半角标点（脚本放 scratchpad，文件名带 `t162-` 前缀）；新增行不许有本机路径。

## 回报格式

照 dispatch「The report has four parts」。另外：宽度过渡怎么实现的；胶囊样子下怎么处理的；与 pop 同时发生时的情况。

## 真机步骤

只动 `gui/`，合入后 dev 热更新。

| 主会话代验 | 只有 JC 能验 |
|---|---|
| 用 CLI 建两件今天到期的测试待办、逐件完成，在 dev 真窗口用探针量：数字每次变都跳、最后一件完成时宽度连续收回、旁边的按钮没有跳；减少动态下一步到位；测完清掉 | 数字跳得够不够看见又不吵；宽度收回的快慢 |

## Comments
