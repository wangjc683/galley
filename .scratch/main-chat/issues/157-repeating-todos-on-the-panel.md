# 157 重复的待办在面板上：时间行的记号、「跳过这一次」「不再重复」、卡片

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 204 第 6、7 条（三个分开的动作；叫「重复」，时间那一行多一个记号与规则，不加组、不加表单），票 154、156 验收时留下的三处。动 GUI、设计文档，和 `core/src/todo_by_hand.rs` 里一处规则。只在内置运行时有主对话时有这个面板；外置运行时零变化。

先读 [dispatch](../../../docs/agents/dispatch.md)「Standing constraints for executor agents」、`docs/design/foundations.md`、`docs/design/conversation/reply-cards.md`「待办面板」「待办卡片」两节（含票 156 加的「改日期」）、[copy-language-guidelines](../../../docs/copy-language-guidelines.md)、`docs/agent-api/todo-commands.md`（重复的待办一段）。票 154（Core）、155（手册）、156（改日期的浮层）都已合入。

## 为什么

重复的待办 Core 已经会生成下一期，浮层里也能选重复，但面板的一行上看不出这件事在重复，「⋯」菜单里也没有「跳过这一次」「不再重复」（桌面命令 `skip_todo`、`stop_todo_repeat` 与 `gui/src/lib/assistant-todo.ts` 的封装都在，还没接界面）。

## 要做的

### 一、时间那一行的重复记号

- 你没做完的待办里，在重复的那一期（`TodoItem.todoRepeat` 有值）：时间那一行在到期日之后、铃铛之前多一段「重复的记号加规则」，如「周一 ↻ 每周 🔔 9:00 2/5 项」。记号用图标库里表示重复的那一个（Phosphor 的 `Repeat` 或 `ArrowsClockwise`，选一个与铃铛 `BellSimple` 同粗细的），11px，墨色随那一行；规则的字用票 156 在 `gui/src/lib/todo-date.ts` 加的「规则成字」函数。与前后各隔 8px、不用「·」，同铃铛那一段的隔法。
- 行窄放不下时，截的是到期日与规则的字，不截行尾的「取消提醒」与子项计数（现有规矩）。
- 收起与打开都画；打开时它在时间那颗按钮里面（点了同样打开改日期的浮层）。
- 「已完成」里勾掉的各期、「Galley 在办」「例行」不画这个记号。回复下的待办卡片：记下那一刻的卡片在时间后面带同一个记号（不带规则的字，卡片只有一行）。
- **铃铛指到到期日之后时不画**：这一期没逾期、而它的提醒时刻晚于它的到期日（提醒响过后被 Core 挂到了下一期的时刻，票 154 第 13 条），这时不画铃铛；逾期之后照常画（它说的是下次什么时候再响）。

### 二、「⋯」菜单

你没做完的、在重复的那一期，「⋯」与右键菜单在「删除」上面多两项：

- **跳过这一次**：照「删除」现在的做法：不确认，行先离开，底部 5 秒撤销，撤销期过了才调 `skip_todo`；撤销提示写「已跳过「标题」」。Core 随之生出下一期，面板照 `todos:changed` 重读。
- **不再重复**：立刻调 `stop_todo_repeat`，不撤销提示（在改日期的浮层里把「重复」选回去就是撤销）。这一期留着，记号消失。
- 「删除」照旧（对重复的待办它同时结束规则，Core 已是这样）；菜单里三项的次序：跳过这一次、不再重复、删除，「删除」上面照现有菜单的分隔写法。
- 不在重复的待办：菜单与现在一模一样。

### 三、卡片与亮行

- 被跳过的那一期（`skipped` 为真），它的卡片写「已跳过」，样子照「已删除」那种划掉的卡片，只换字。
- Core 生成的下一期出现在面板里：是你在这个窗口里勾掉或跳过带出来的，不亮（现有规矩：你自己做的不亮）；是 Galley 勾掉或跳过带出来的，照「它新放进来的行」亮一下。

### 四、改日期浮层里重复的这一期（票 156 验收留下的）

- 浮层的「提醒」那一行，对重复的这一期读规则里记的偏移（`todoRepeat.remind`），不读提醒任务此刻的时刻：提醒响过后被挂到了下一期的时刻，照任务读会读成「到期后 7 天」。规则没有记提醒、而这一期自己有提醒的，照任务读（现状）。
- Core 的 `when_write`（`core/src/todo_by_hand.rs`）同样：重复的这一期改日子时，提醒按规则的偏移挂到新日子前（已过就照现有的例外改挂到后面第一个没过的时刻），不按「原提醒离原到期日几天」算。规则没有记提醒时照现状。配测试。
- 用户在浮层里给重复的这一期改了提醒：照裁决 204 第 8 条只动这一期（现状），不动规则。

### 五、文案（中英逐字）

| 位置 | 中文 | English |
|---|---|---|
| 菜单项 | 跳过这一次 | Skip this one |
| 菜单项 | 不再重复 | Stop repeating |
| 撤销提示 | 已跳过「标题」 | Skipped “title” |
| 卡片 | 已跳过 | Skipped |
| 重复记号的悬停与无障碍名 | 重复：每周 | Repeats weekly（用规则成字的函数拼） |

### 六、设计文档

`docs/design/conversation/reply-cards.md`「待办面板」：时间那一行的写法补上重复的记号与「铃铛指到到期日之后时不画」；「删除」一节旁边写「跳过这一次」「不再重复」；「待办卡片」补「已跳过」；「它动过的行亮一下」补下一期出现时亮不亮的规矩；「改日期」一节补第四条。`docs/agent-api/todo-commands.md` 开头「The user can …」那段补上跳过与不再重复。

## 别动

- 助理手册与评测目录、`core/src/assistant_manual.rs`、`core/src/subtask_report.rs`、`core/src/db/todo.rs` 里 `update_todo` 的规则那一支：票 158 在改。本票在 Core 只许动 `core/src/todo_by_hand.rs` 及调用它的那一处读规则偏移所必需的几行，与对应的测试。
- CLI、Agent API 的形状、票 154 的生成与重挂。
- 不加组、不加新的面板区块、不加新建入口。
- `.scratch/main-chat/PRD.md` 与别的票。主工作树；不跑 `tauri dev`。
- `gui/` 现有文件只格式化自己的 hunk；`core/` 逐文件 `rustfmt --check`。React 编译器的 lint 规则照票 156。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
TZ=UTC cargo test --manifest-path core/Cargo.toml --workspace
pnpm --dir gui typecheck
pnpm --dir gui lint
TZ=UTC pnpm --dir gui test
TZ=America/Los_Angeles pnpm --dir gui test
node scripts/check-ipc-protocol-drift.mjs
node scripts/check-docs-links.mjs
git diff --check
```

测试至少覆盖：重复的这一期收起与打开都有记号与规则的字、不重复的没有；铃铛在「没逾期且晚于到期日」时不画、逾期时画；菜单只在重复的这一期多两项、次序对；跳过走撤销、撤销期内撤回不调 Core、过期才调 `skip_todo`；不再重复立刻调 `stop_todo_repeat`；卡片「已跳过」；下一期出现时亮与不亮两种；浮层提醒那一行读规则的偏移；Core 改日子按规则的偏移挂。新增的中文行扫半角标点（脚本放 scratchpad，文件名带 `t157-` 前缀）；新增行不许有本机路径。

## 回报格式

照 dispatch「The report has four parts」。另外：选了哪个图标、时间那一行各段的实际间距；票面没写到、你自己定的边界。

## 真机步骤

合入前主会话看 `busy:0`。

| 主会话代验 | 只有 JC 能验 |
|---|---|
| 用 CLI 建一件每周重复的测试待办，截 dev 窗口：记号与规则的字在、行没被挤坏；点「⋯」走跳过（等撤销期过）与不再重复，逐步查库；测完清掉 | 记号与规则的字读着顺不顺、时间那一行挤不挤；菜单三项的次序与叫法 |

## Comments

### 2026-11-10 派票后追加（主会话在真窗口走票 156 时看到的，已通知代理）

1. 浮层关掉时不许弹出「改日期」的提示：现在选完日子或按 Esc，焦点回到时间那颗按钮，提示随即弹出并压在标题与方框上，指针选完按钮上还画着焦点环。提示只在指针悬停与 Tab 走到时出，出在哪都不能盖住标题那一行；指针关掉的不画焦点环，键盘关掉的焦点照旧回按钮。
2. 刚选的提醒因为时刻已过没挂上时，在浮层提醒那一行下面写一行淡字「这个时刻已经过了，没有挂提醒」（英文 "That time has already passed, so no reminder was set"），下一次改动或浮层关掉就消失；选「不提醒」本身、重复的这一期（Core 会改挂到后面）不写。
3. 没有到期日的事，「不定日子」不可点。
