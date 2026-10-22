# 88 面板上删除你的待办：「⋯」与右键一份菜单，5 秒撤销，卡片写「已删除」

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 132（2026-10-22，JC：「按你推荐推进」）。Core 一个桌面命令 + GUI + 设计文档。外置运行时没有待办面板，零变化；Agent API 不变（CLI 本来就有 `todo cancel`）；不加迁移。

## 现状（读码起点）

- Core：`core/src/db/todo.rs` 的 `cancel_todo`（约 587 行，软删除：写 `cancelled_at` / `cancelled_via` / 谁 / 原因，`release_todo_reminder` 一并取消挂着的提醒；已取消或不存在报 `not_found`）。桌面命令在 `core/src/commands/schedule.rs`（`complete_todo`、`reopen_todo`、`cancel_todo_reminder`，`Origin` 记 `gui`），注册在 `core/src/lib.rs` 的 invoke handler。`core/src/assistant_todo.rs` 的 `declined_items` / `declined_one`：`via = Gui` 的取消进「最近不要的跟进」。
- GUI 数据：`gui/src/lib/assistant-todo.ts`（各命令的 invoke 包装、`TodoItem`），`gui/src/stores/assistant-todo.ts`（`todo` 面板数据、`noted` 卡片数据、`flips` 勾的停留、`cancelling`、`failures`；`todos:changed` 事件后重读）。
- 面板：`gui/src/components/todo/TodoPanel.tsx`（你的待办那一行 `YourRow`；悬停的「说说这件」`TalkAbout`；小字行末的取消提醒 `CancelReminder`；行的失败小字）。票 87 的亮行：`lib/todo-panel.ts` 的 `todoPanelChanges` 与 `todoWritesOnTheirWay`（这个窗口自己在途的写不亮），`hooks/useTodoPanelFlash.ts`。
- 卡片：`gui/src/components/conversation/TodoCards.tsx`（取消了的写 `copy.todo.stateCancelled`「已取消」；同一个键也给提醒卡片用：`lib/assistant-todo.ts` 的 `reminderStateLabel`）。
- 照抄的先例：
  - 菜单：`gui/src/components/conversation/MessageMenu.tsx`（「⋯」与右键共用一份清单，裁决 85、99、105；`data-galley-context-menu-trigger` 让全局右键拦截放行，见 `hooks/useGlobalShortcuts.ts`）。
  - 不确认、5 秒撤销、提示条走了才提交、连删合成一条、发出前先提交、退出不删、Core 拒绝时放回：`gui/src/stores/message-delete.ts`（`UNDO_DELETE_MS`、`flush` 从 `sendThroughCore` 调）与它的文案（`zh.ts` 的 `deleteMessage`）。

## 要做的

1. **Core 桌面命令**：`cancel_todo`（名字照邻居），调 `SqliteGalley::cancel_todo`，`Origin` 记 `gui`（同 `cancel_todo_reminder` 的取法），成功后照邻居发 `todos:changed`。注册、补测试：桌面取消的待办进 `declined_items`（`DeclinedBy::User`），挂着的提醒随之取消且不另算一条。CLI、socket、Agent API 不动。
2. **GUI 调用**：`lib/assistant-todo.ts` 加包装；store 里加「删除」：照 `message-delete.ts` 的做法暂存——点了这一件立刻从面板消失、卡片同时写成删除了的样子，底部提示条「已删除『{标题}』」+「撤销」，5 秒（悬停或聚焦时暂停，`ToastHost` 本来就会）后才交给 Core；5 秒内再删别的合成一条「已删除 N 件待办」，撤销全部放回；主对话发出一句前先提交（接到 `sendThroughCore` 已有的 `flush` 旁边或同一处）；退出 Galley 时没提交的就没删；Core 拒绝时这一行回来，下面写原因（用面板现有的失败小字：「这件事已经不在了。」「没能完成，再试一次。」）。暂存中的那件算进 `todoWritesOnTheirWay`，票 87 的亮行与停留不碰它。顶栏「今天 N」等 Core 提交后跟着变即可，不另算。
3. **菜单**：只给你的没完成的待办（`YourRow`）。悬停或键盘聚焦时行末出现「⋯」（与右键同一份菜单，照 `MessageMenu` 的组件与写法）：「说说这件」、「取消提醒」（`todoReminderCancellable` 为真时）、分隔线、「删除」。原有的悬停「说说这件」图标与小字行末的取消提醒按钮照留（菜单里重复一份，同气泡的 chip 与菜单）。「⋯」的位置与样子照面板现有行末按钮（`IconButton`、`opacity` 悬停显现），不挤掉标题；已完成、Galley 在办、例行的行不加。
4. **文案**（`zh.ts`、`en.ts` 都加）：菜单「删除」/「Delete」；提示条「已删除「{标题}」」/ `Deleted "{title}"`（标题过长照现有提示条的截断）、「已删除 {n} 件待办」/ `Deleted {n} to-dos`、「撤销」/「Undo」；卡片上取消了的待办新键「已删除」/「Deleted」，只给待办卡片用，提醒卡片的「已取消」不动。中文标点全角。
5. **设计文档** `docs/design/conversation.md`：「待办面板」的「动作只有这几个」补删除（范围、菜单、撤销、进「最近不要的跟进」）；「待办卡片」里取消了的写「已删除」。都注「2026-10-22，票 88，裁决 132」。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- `cancel_todo` 的数据库逻辑、CLI、socket 命令、Agent API、迁移；提醒卡片的文案；已完成、Galley 在办、例行的行。
- 票 87 的开关、亮行规则（只把暂存的删除算进「自己在途的写」）。
- `core/` 不是 rustfmt-clean：只格式化你动过的文件（`rustfmt --check <文件>`），别 `cargo fmt --all`。`gui/` 不是 prettier-clean：旧文件只格式化你改的 hunk。
- gui 的 React 编译器 lint：effect 里同步 `setState`、渲染期 `Date.now()` 报错；工具函数别从组件文件导出。
- 注释照周围写法（英文，引「main chat ticket 88, PRD ruling 132」），密度相当。
- 临时改回去做反向检查时先备份文件，别用 `git checkout --`。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- `cargo check --manifest-path core/Cargo.toml --workspace`、`cargo test --manifest-path core/Cargo.toml --workspace`
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`pnpm --dir gui test`（再在 `TZ=UTC` 下跑一遍）
- `git diff --check`；六个门禁脚本里至少 `node scripts/check-docs-links.mjs`
- 反向检查：撤销路径、合并成一条、Core 拒绝放回各改坏一处，对应测试要红，改回全绿
- 设计文档与文案新增行中文全角标点（自写正则扫 diff 新增行，脚本放 scratchpad、文件名带 `t88-` 前缀）

## 回报格式

1. 提交列表（`git log --oneline main..HEAD` 原样）。
2. Core 命令名、签名、发的事件；GUI 暂存与提交放在哪、与 `message-delete.ts` 共用了什么。
3. 验证命令与结果原样（含反向检查）。
4. 票面没写到、你自己定的边界（逐条）。
5. 看到但没改的问题，没验证到的（逐条）。

## 给 JC 的真机步骤

合入后（Core 会重启）：

1. 面板里悬停一件没完成的待办：行末出现「⋯」；点开是「说说这件」「取消提醒」（有提醒时）──「删除」；右键同一份菜单。
2. 点「删除」：这一行立刻离开，底部「已删除『…』 · 撤销」；5 秒内点撤销，它回来；再删一次等提示条走掉，回复下那张卡片写「已删除」。
3. 连删两件：提示条合成「已删除 2 件待办」。
4. 已完成、Galley 在办、例行的行没有「⋯」。

## Comments
