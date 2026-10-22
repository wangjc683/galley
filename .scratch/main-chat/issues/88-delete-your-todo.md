# 88 面板上删除你的待办：「⋯」与右键一份菜单，5 秒撤销，卡片写「已删除」

Status: done（2026-10-22 JC 真机：「真机看了，没问题」；查库自 17:00 起没有待办变化，与步骤里「702 只试撤销」一致：「⋯」与右键菜单、删除后行离开、提示条与撤销是真机验过的，等提示条走完交给 Core、卡片写「已删除」、连删合成一条没在真机上走，靠测试（store 与面板的点击测试、Core 的 `the_desktop_deletes_a_to_do_and_it_is_turned_down`）。快进合入 `0e4a1773`，Core 随之重启；主会话机器验收：Core 命令、删除暂存与提交、发出前先提交、菜单与文案的 diff，worktree 里 `cargo test --workspace` 1221 条、前端 2205 条全过）

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

### 2026-10-22 实现回报（票 88 代理）

worktree `/Users/inkstone/Documents/genericagent-webui-wt88`，分支 `ticket-88-delete-todo`（从本地 main `453ceaa4` 起），没 push、没合入。

1. **提交**（`git log --oneline main..HEAD`，本条回报的提交不在其中）：

   ```
   1c6bf3b4 Ticket 88: the to-do panel's delete in design, managed runtime and Agent API docs
   bf7beafe Ticket 88: delete your to-do from the panel, with a five-second undo
   d5f0fac1 Ticket 88: Core's desktop command to delete a to-do
   ```

2. **做了什么**
   - **Core**：Tauri 命令 `cancel_todo(app: tauri::AppHandle, galley: State<'_, SqliteGalley>, id: crate::api::TodoId) -> Result<crate::api::TodoBrief, String>`（`core/src/commands/schedule.rs`，在 `core/src/lib.rs` 的 invoke handler 里紧跟 `cancel_todo_reminder`）。照邻居：`Writes::new(&galley, notifier, VIA_GUI).cancel_todo(&id, Origin::desktop())`，所以记 `cancelled_via = 'gui'`；发 `todos:changed` 与 `scheduled-tasks:changed`（`Writes::todos_changed(result, true)`，Core 拒绝时也发）。错误是 Core 的 JSON：已取消或不存在 `not_found`，没有助理 `invalid_args`。数据库逻辑、CLI、socket、Agent API、迁移都没动。测试 `core/tests/todo_test.rs` 的 `the_desktop_deletes_a_to_do_and_it_is_turned_down`：两个事件、待办记 `gui`、挂着的提醒记 `system`、`declined_follow_ups` 只多这一件（`DeclinedBy::User`，提醒不另算）、`in_hand_read` 带上它、面板清单里没有它、再删一次 `not_found` 且不改写第一次的记录。
   - **GUI 调用**：`lib/assistant-todo.ts` 的 `cancelTodo(id)`。
   - **暂存与提交**：都在 `stores/assistant-todo.ts`（与勾的停留、取消提醒同一个 store）：`deleting`（按待办 id，`{ order, committing }`）、`deleteToastId`，动作 `deleteTodo(item)`、`undoDelete()`、`commitDeletes()`、`flushDeletes()`。Core 答完后读回新清单，新清单、放掉 `deleting`、拒绝的原因写进 `failures` 在同一次 `set` 里，删掉的行中间不会闪回来；拒绝的那件随之回到面板，行下用现有的失败小字。面板画的是 `lib/todo-panel.ts` 的 `todoWithoutDeleting(todo, deleting)`（所有组里拿掉，没有要拿的时原样返回同一个对象）；`todoWritesOnTheirWay` 加了 `deleting`，票 87 的亮行与停留不碰暂存或在途的那件。卡片（`TodoCards.tsx`）与方框（`TodoCheck.tsx`）读 `deleting`：暂存期间卡片已写「已删除」、方框不能点、标题是字。主对话发送前提交：`hooks/useMessageSend.ts` 的 `sendThroughCore` 里，删消息的 `flush` 之后，发往 `mainChat` 的会话才 `await flushDeletes()`。
   - **与 `message-delete.ts` 共用的**：常量 `UNDO_DELETE_MS`（直接从那里导入）。照抄的做法（没抽公共代码）：提示条用 `pushToast` + `action: { kind: "undo" }` + `autoDismissMs` + `onClose`（只在它还是当前提示条时才提交），每次删除换一条新提示条、关掉上一条；提交排队（`inflightDeletes`，一批等上一批）；按偏好语言取文案。菜单的三个样式常量从 `MessageMenu.tsx` 挪到新的 `components/conversation/message-menu-styles.ts`，消息菜单与待办菜单共用；两个菜单都走侧栏的 `SidebarRowMenuItem` / `SidebarRowMenuSeparator`。
   - **菜单**：`components/todo/TodoRowMenu.tsx`（`TodoRowMenuButton` 是行尾的「⋯」，`IconButton` 28px、`DotsThree` 14px、悬停或聚焦显现、名字与悬停文字「更多」；`TodoRowContextMenu` 把行本身做成右键的 trigger，带 `data-galley-context-menu-trigger`）。`TodoPanel.tsx` 的 `RowShell` 加 `menu` 与 `menuOff`，只有 `YourRow` 传。
   - **文案**：`zh.ts` / `en.ts` 的 `todo.deleteTodo`（`menuItem`、`deleted(title)`、`deletedCount(n)`、`undo`）与 `todo.stateDeleted`；提醒卡片的 `stateCancelled` 没动。
   - **文档**：`docs/design/conversation.md`（见下第 4 条最后一项还改了两处散文）。

3. **验证**（原样）
   - `cargo check --manifest-path core/Cargo.toml --workspace`：``Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.34s``；唯一的警告是 `galley-relay` 里原有的 `fetch_update` 弃用警告，不是这张票的。
   - `cargo test --manifest-path core/Cargo.toml --workspace`：45 个 `test result: ok.`，合计 1221 passed、0 failed，退出码 0；其中 `test the_desktop_deletes_a_to_do_and_it_is_turned_down ... ok`、`test every_cancel_records_who_and_why ... ok`、`test the_follow_ups_turned_down_and_only_the_main_chat_reads_them ... ok`。
   - `rustfmt --edition 2021 --check`（逐个文件经 stdin）：`core/src/commands/schedule.rs`、`core/src/lib.rs`、`core/src/api/todo.rs`、`core/tests/todo_test.rs` 都 clean；按路径跑时报出的差异只在别的文件与 `lib.rs` 原有的 `mod` 顺序，main 上就有。
   - `pnpm --dir gui typecheck`：`tsc --noEmit` 无输出。`pnpm --dir gui lint`：`eslint src --max-warnings 0` 无输出。
   - `pnpm --dir gui test`：`Test Files  201 passed (201)`、`Tests  2203 passed (2203)`；`TZ=UTC` 再跑一遍：`Test Files  201 passed (201)`、`Tests  2203 passed (2203)`。
   - prettier：新文件整篇格式化；改过的旧文件里 main 上本来 clean 的整篇 `--write`，`zh.ts` / `en.ts`（main 上就不 clean）核对过 2080–2150 行之间没有 prettier 差异。
   - `git diff --check`：无输出。
   - 门禁脚本六个：`[ipc-drift] IPC protocol fields and optional/null semantics aligned (python: 18 events, 11 commands; rust: 18 events, 11 commands; ts: 18 events, 11 commands)`、`[supervisor-sop-drift] 4 reference copies verbatim with canonical docs; SKILL.md variants aligned`、`docs link gate OK: 471 files checked.`、`[version-consistency] 5 files agree on 0.6.2`、`[managed-ga-payload] OK`、`[ga-baseline-drift] OK (5205f408)`，退出码都是 0。
   - 反向检查（先备份 `stores/assistant-todo.ts` 到 scratchpad，逐个改坏、跑 `stores/assistant-todo.test.ts`、`TodoPanel.click.test.tsx`、`useMessageSend.test.ts`，再拷回，与备份 `diff -q` 一致）：
     - 撤销不放回（`undoDelete` 留着等待中的）：`× 撤销 puts it back and Core never hears of it`、`× several in a row are one toast, its time from the latest, 撤销 taking them all back`、`× ⋯ opens it: 说说这件, 取消提醒, 删除; 删除 takes the row off at once under an undo toast, Core told nothing`，`Tests  3 failed | 51 passed (54)`。
     - 不合成一条（不关上一条提示条）：`× several in a row are one toast, its time from the latest, 撤销 taking them all back`、`× comes back with the reason when Core refuses`，`Tests  2 failed | 52 passed (54)`。
     - Core 拒绝不放回（拒绝的留在 `deleting`）：`× comes back with the reason when Core refuses`、`× comes back with the reason under it when Core refuses`，`Tests  2 failed | 52 passed (54)`。
     - 另做一条：关掉菜单时去掉右键包装（`if (!menu || menuOff) return row;`），`× is away while a tick holds, the row not mounted afresh: its box keeps focus`，`Tests  1 failed | 5 passed (6)`。
     - 改回后全绿（见上面的全量结果）。
   - 中文全角标点：scratchpad 的 `t88-cjk-punct.py` 扫 `git diff -U0 main` 新增行（去掉行内代码与链接目标后，找贴着中文的 `, ; : ! ? ( )` 与句末 `.`）：设计文档与文案 `checked 20 added lines with CJK, 0 flagged`；连本条回报一起 `checked 66 added lines with CJK, 0 flagged`。

4. **票面没写到、我自己定的**
   - **提示条标题的截断**：票面说「照现有提示条的截断」，但现有提示条没有截断（`ErrorCard` 的小提示条标题会折行，不限字数），与代码不符。我加了 `todoToastTitle`：换行与连续空白压成一个空格，超过 24 个字（按字符，不切开 emoji）截断加「…」，大约占提示条两行。
   - **勾下去停留时没有「⋯」**：你勾的停留 1.5 秒、Galley 勾的停留（票 87）里，这一行正在去「已完成」，不出「⋯」、右键不开（交给全局拦截挡掉 WebView 菜单）。右键的包装一直在、只是 `disabled`，这样勾的时候行不重挂，方框的焦点与删除线的过渡都留着（加了测试）。
   - **菜单开着时**：这一行保持悬停的样子（按钮在、标题照旧让出 60px、底色 `hover`），照侧栏行的「⋯」；Galley 在菜单开着时勾掉它，菜单收起，回来时不会自己再开。
   - **焦点与 Esc**：照 `MessageMenu`，关菜单不还焦点（「说说这件」把光标放进输入框，不能被抢回）；Esc 只关菜单，不关面板。
   - **菜单里的「取消提醒」**：进行中不禁用，store 的 `cancel` 本来就挡重复。
   - **只在发往主对话时提交**：在别的对话（旁聊、子任务回答）里发，删除照旧等在提示条下。
   - **Core 拒绝时不出错误提示条**（`message-delete.ts` 会出）：票面要的是行下原因，只写行下。`not_found` 的那件通常已不在新清单里，行不回来，原因也就看不到。
   - **顶栏「今天 N」**：用 Core 的 `todayCount`，等 Core 删完读回才变。
   - **英文提示条**用直引号 `Deleted "…"`（照票面，也是 `en.ts` 里引用标题的多数写法）。
   - **另改的散文**：`docs/managed-ga-runtime/runtime-modes-and-sessions.md`、`docs/agent-api/todo-commands.md` 里「桌面上只能勾、取消勾、取消提醒」，与 `core/src/api/todo.rs` 的模块注释，都补上删除（Agent API 本身不变）。设计文档里「悬停的按钮」原写「行尾只有这一颗」，按裁决 132 第 3 条改为你的待办行尾两颗，写明是裁决定的。

5. **看到但没改、没验证到的**
   - **助理手册没改**：`core/src/assistant_manual.rs` 拼的 `todos.md`（模型看的）仍写「the user sees it in 「待办」 beside this chat and can only tick a to-do off, untick it, or cancel its reminder there」。改它是改模型提示词、按惯例要评测，票面没让动，留给 JC 定。
   - **5 秒内被叫醒**：提醒到点或巡看叫醒 Galley（不是你发的一句）时不提交，它读的清单里还有这件。
   - **5 秒内 Galley 勾掉了这件**：Core 的 `cancel_todo` 对做完的待办照样成功（只看 `cancelled_at`），回复下的卡片会从「已完成」变「已删除」，与裁决 132 第 2 条「不改写发生过的事」相抵。数据库逻辑在「别动」里，没改。
   - **读回失败**：Core 删成功但随后读清单失败时，那件从 `deleting` 放掉、旧清单里还有它，会显示到下一次读（与勾写完后的处理相同）。
   - **Tauri 命令本身没有单测**：要 `AppHandle`；测的是它包装的那一行 `Writes::cancel_todo(…, Origin::desktop())`。
   - **没跑 `tauri dev`**，真机步骤都没走：WKWebView 里「⋯」的位置与悬停、右键、提示条、窄面板，以及 Galley 勾的停留行（只在静态测试里用你勾的停留验过，Galley 的停留走同一个 `checked` 判断）。
   - 测试里的 `localStorage is not available` 实验性警告是 Node 原有的，不是这张票加的。点击测试为 Radix 菜单在 jsdom 里补了一个空的 `ResizeObserver`，测完撤掉。

### 2026-10-22 补充回报（票 88 代理，主会话追加的两条）

主会话按裁决 132 定了上面第 5 条里的两项，同一个 worktree 与分支：

1. **勾掉了的不删**（`9271120e`）：提示条走时，`stores/assistant-todo.ts` 的 `sendDeletes` 先看面板清单（`get().todo`，`todos:changed` 刷新过的）：这件已在「已完成」里（5 秒内 Galley 替你勾掉了），就不问 Core，不调 `cancel_todo`、不写原因，随这一批一起从 `deleting` 放掉，行回到「已完成」，卡片照旧「已完成」（裁决 132 第 2 条）；同一批里其余的照常交给 Core。补了两个 store 测试与设计文档「删除」里的一句。反向检查：去掉这个判断，`× leaves one Galley ticked off within the five seconds done: Core is not asked, the row ends in 已完成`、`× asks Core for the rest of a batch past one ticked off meanwhile`，`Tests  2 failed | 24 passed (26)`；拷回备份（`diff -q` 一致）后 `Tests  26 passed (26)`。
2. **助理手册**（`89be80a6`）：`docs/managed-ga-runtime/galley-assistant-manual/todos.md` 改成「can only tick a to-do off, untick it, cancel its reminder, or delete it there.」，这一条后面几行按文件的宽度（74 列，中文算两列）重新折行；`core/src/assistant_manual.rs` 的 `manual_covers_the_users_to_dos` 换成新的两行片段，每段仍是文件里完整的一行。手册别处没动。没有测试数手册的字节（`managed_prompt.rs` 的字节预算只管入口层，不含手册各部分）。反向检查：把手册换回旧版，`todos.md lost: untick it, cancel its reminder, or delete it there. Everything else, a`，`test result: FAILED. 0 passed; 1 failed`；拷回后 `test result: ok. 1 passed`。

验证（原样）：`cargo test --manifest-path core/Cargo.toml --workspace` 合计 45 个 `test result: ok.`、1221 passed、0 failed，退出码 0，其中 `test assistant_manual::tests::manual_covers_the_users_to_dos ... ok`、`test managed_prompt::tests::main_chat_entry_layer_sends_the_model_to_the_manual ... ok`；`pnpm --dir gui typecheck`、`lint` 无输出；`pnpm --dir gui test` 与 `TZ=UTC` 下都是 `Test Files  201 passed (201)`、`Tests  2205 passed (2205)`；`git diff --check` 无输出；`rustfmt --check`（经 stdin）`core/src/assistant_manual.rs` clean。
