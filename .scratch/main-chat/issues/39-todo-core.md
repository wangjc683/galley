# 39 待办记录（Core）

Status: ready-for-agent

来源：主聊天 PRD 裁决 91（2026-10-16，JC：「丙，说说这件也要，按你推荐」）。依赖 33（定时任务的一次性、叫醒、软删除、建在哪一句）、37（`assistant_todo` 查询、「在办的事」的取数）。改 Core（含迁移与给界面的命令、事件）；CLI 是票 40，手册是 41，界面是 42。

## 目标

「待办」成为一种记录：你要办的一件事，可以有截止、可以挂一个提醒。Galley 在对话里记下它、改它、勾掉它（经 CLI），你在界面上只能勾掉、取消勾、取消它的提醒。待办的查询分组改成「你的事 / Galley 在办 / 例行 / 已完成」，侧栏那一行要的「今天 N」也从这里来。

## 一、表

- 新表（名字你定，比如 `todos`），id 照定时任务的铸法（如 `todo_<16 位十六进制>`）：
  - 标题（必填）、备注（可选）；
  - **截止**：可以只有日期（「周五前」），也可以有日期加时刻（「周三下午 3 点」）。怎么存你定（比如 `due_at` UTC 瞬间 + 一个「有没有时刻」的标记，或分成本地日期与时刻），写理由；按日期分组时用本机时区。
  - **提醒**：可选，指向一个定时任务（票 33 的一次性、叫醒助理）。待办勾掉或取消时，它没触发的提醒跟着取消（软删除）；取消勾不恢复提醒（要提醒再跟 Galley 说）。提醒到点时待办已经勾掉的，不叫醒（双保险）。
  - 状态：没做 / 做完 / 取消（软删除，照票 33）；做完的时刻与「谁勾的」（界面上你勾的 / Galley 经 CLI 勾的，照来源字段的写法）。
  - 谁建的、建在哪一句：照票 33 的来源三列与「建在哪一句」（会话、run 开头那一轮、回复那一轮），卡片挂在那条回复下面（票 42）。
- 迁移照规矩补六处手写迁移列表（core/tests 四处、cli/tests 两处）。

## 二、写

- Core 函数（CLI 与界面共用，权威在 Rust）：建、改（标题、备注、截止、提醒的设、改、去掉）、勾掉、取消勾、取消。提醒的设与改调用票 33 的定时任务函数，不另写一套调度。
- 给界面的 Tauri 命令只开三个：勾掉、取消勾、取消提醒（裁决 91 第 3 条：清单上只留这几个直接动作）。读走查询（下面）。
- 提醒到点时给叫醒行的话：写清是哪件待办、截止、原定与实际时刻（票 33 的晚到措辞照旧），让 Galley 知道是你的事要提醒你。

## 三、查询改组（`crate::assistant_todo`）

把票 37 的三组改成四组，界面与「在办的事」照旧共用这一个函数：

- **你的事**：没做完的待办，再分「今天」（今天到期与逾期的）、「以后」（有截止、不在今天）、「随时」（没截止）；今天里逾期的排前面并标出逾期。
- **Galley 在办**：主对话派出、没升级、没结束的子任务（票 37 的规则，含 7 天没动静就不列）；没挂在待办上的一次性叫醒（它自己要回头查的事）。
- **例行**：重复的定时任务（两种目标都算），带规则与下次时刻，暂停的也列。
- **已完成**：近 7 天做完的待办、触发过的独立提醒、结束的子任务、例行跑过的那一次；条数上限照票 37。
- 另给一个数：「今天 N」= 今天到期与逾期、没做完的待办件数（侧栏那一行用）。
- 票 37 已有的跳转目标照旧（待办跳回建它的那句；没有挂处的不跳）。

## 四、「在办的事」

- 票 36 的 `### In Hand` 加一组没做完的待办（标题、截止、提醒、id），排序同查询；上限、截断与预算照票 36 的做法，预算测试跟着改并写理由。
- 只在主对话；外置零变化。

## 五、事件与其他

- 待办的增删改、勾掉都发事件（界面刷新、卡片状态）；沿用定时任务那一路的做法。
- 远程协议：手机版没开工，这张票不加事件；若已转发定时任务的变化，确认不受影响。写进 Comments。
- 主对话被重置时（票 15），待办跟着清（它们是这条对话的副产品），写进重置的「会删除」清单的数据层；界面文案在票 42。

## 不做

- 后台整理、从历史里抽待办（裁决 91 第 1 条）。
- 清单上的新建与编辑（裁决 91 第 6 条）。

## 验收

- Rust 测试：建、改、勾掉、取消勾、取消；勾掉与取消时没触发的提醒被取消、已触发的不动；提醒到点时待办已勾掉不叫醒；查询四组的成员、排序、今天与逾期按本机时区、7 天边界、「今天 N」；「在办的事」带上待办、空时不写、外置不写；重置清掉待办；迁移与六处列表。
- `cargo check` / `cargo test --manifest-path core/Cargo.toml --workspace`（本机时区、`TZ=UTC`、`TZ=America/Los_Angeles`），六个门禁，`git diff --check`，中文标点扫新增行。

## Comments

### 2026-10-17 实现回报（子代理，分支 `mc-todo-core`）

**改了哪些文件**

- 迁移：`core/migrations/050_todos.sql`（新表 `todos`，`scheduled_tasks` 加列 `todo_id`）、`core/src/db_migrations.rs`；六处手写迁移列表（`db_test`、`db_writes_test`、`scheduler_fire_test`、`socket_write_handlers_test`、`cli/tests/cli_test.rs`、`cli/tests/m1_writes.rs`）都补了 050。
- 记录与写：`core/src/api/todo.rs`（新：线上类型、截止的两种存法、`mint_todo_id`、`TODOS_CHANGED_EVENT`）、`core/src/db/todo.rs`（新：读、建、改、勾掉、取消勾、取消、取消提醒、补填建在哪一句）、`core/src/session_writes.rs`（写路径与事件）、`core/src/commands/schedule.rs` 与 `core/src/lib.rs`（三个 Tauri 命令）。
- 定时任务那边：`api/schedule.rs`（`ScheduledTaskBrief.todo_id`，铸 id 挪到 `mint_scheduled_task_id` 共用）、`db/schedule.rs`（读新列；重启补读的 pending 排除已关的待办）、`scheduler.rs`（到点前的第二道保险）、`subtask_report.rs`（叫醒措辞、送达前再查一次待办）、`socket_listener/schedule_cmds.rs`（只改用共用的铸 id）。
- 查询改组：`core/src/assistant_todo.rs`；「在办的事」：`core/src/managed_prompt.rs`、`runner_commands.rs`（只改注释）；建在哪一句：`message_queue.rs`；重置：`db/main_chat.rs`、`main_chat_reset.rs`。
- 界面（只为旧界面不坏）：`gui/src/lib/assistant-todo.ts`（类型镜像、三个命令、`todos:changed`、`legacyTodoGroups`）、`TodoDialog.tsx`（从四组取回原来三组）、`gui/src/lib/scheduled-tasks.ts`（`todoId`），及其测试。
- 测试：`core/tests/todo_test.rs`（新，12 条）、`schedule_wake_test.rs` 加 2 条、`main_chat_reset_test.rs` 加 1 条、`db_writes_test.rs` 加迁移 050 一条（049 那条读之前跟着跑 050）、`assistant_todo_test.rs` 改成四组；单测：`assistant_todo` 18 条（新增 5 条待办的、1 条空，其余改成四组）、`api::todo` 4 条、`subtask_report` 加 1 条、`managed_prompt` 的 In Hand 5 条重写。
- 文档：`docs/architecture.md` 事件表一行、`docs/managed-ga-runtime/runtime-modes-and-sessions.md`（新节「The User's To-Dos」，待办列表一节改写）、`prompt-composition.md`（In Hand 一节、条款台账一行）、`docs/agent-api/schedule-commands.md`（`todoId` 一行，只加不改）。

**票面留给我定的**

1. **截止怎么存**：两列二选一，`due_date`（`YYYY-MM-DD`，没有时刻的「周五前」）或 `due_at`（UTC 瞬间，有时刻的「周三下午 3 点」），CHECK 不许同时有。理由：只有日期的截止是「浮动的本地日期」，换成瞬间得替它挑一个时区和钟点，电脑往西走就会变成周四（重复任务的 `time_of_day` 也是这么存的）；有时刻的截止和一次性提醒的 `fire_at` 一样是瞬间。分组按本机时区读：有时刻的读它在本机是哪天，没时刻的就是那天。线上 `due: {date, hasTime, at?, time?}`，`date` 总有（有时刻的是本机读出来的日期），`at`、`time` 只在有时刻时有。`--due` 的写法：`2026-10-23` 是日期；`schedule create --at` 认的写法（本地 `YYYY-MM-DDTHH:MM`、RFC 3339）是时刻；截止在过去不拒（可能记一件已经晚了的事）。
2. **表与命令名**：表 `todos`，id `todo_<16 位十六进制>`（Core 铸，和 `sched_` 同一个搅法）；状态不设列，照票 33 从时间戳读：`cancelled_at` 有就是取消（不看 `done_at`），否则 `done_at` 有就是做完，都没有是没做；谁勾的照来源三列（`done_via` / `done_by_supervisor` / `done_origin_note`），取消勾四列清空。Tauri 命令 `complete_todo`、`reopen_todo`、`cancel_todo_reminder`，参数只有 `id`，来源由 Core 记成 `Origin::desktop()`（`done_via = 'gui'`），返回待办当前的样子。Core 函数（给票 40）：`SqliteGalley::create_todo / update_todo / complete_todo / reopen_todo / cancel_todo / cancel_todo_reminder / todo / list_todos(TodoListScope::{Open, Live, All}) / settle_todo_created_in`，经 `Writes` 同名方法调用会发事件。
3. **提醒怎么挂、怎么取消**：链接在任务那一侧，`scheduled_tasks.todo_id`（线上 `todoId`），一件待办最多一个没取消的任务。设提醒：没有就用票 33 的 `create_scheduled_task_in` 建一次性、`target = assistant`，话是待办标题，不记「建在哪一句」（卡片由待办出，票 37 的提醒卡片不会为它出现）；已有就用 `update_scheduled_task` 改 `fireAt`（已响过的会重新装上）。去掉提醒是软取消任务。勾掉或取消待办时，取消「还没提醒到」的提醒：没到点的，或到点了但叫醒还是 `pending`（没送进主对话）的；已送达或已退回通知的不动。改标题时提醒任务的话跟着改（送不出去时通知正文用它）。链接放在任务一侧而不是 `todos.reminder_task_id`：换过的、去掉的提醒都还认得是哪件待办的，重置时能连根删掉。
4. **查询的形状**：`{ yours: {today, later, anytime}, assistant, routine, done, doneOmitted, todayCount }`；`TodoItem` 加 `kind: "todo"`、状态 `open`，以及 `notes`、`due`、`overdue`（只在逾期时写）、`reminder {taskId, at, state: scheduled|paused|fired}`、`doneBy`（user / assistant / agent）；没做完的待办不写 `at`（看 `due`），做完的 `at` 是勾掉的时刻。分组与排序：今天 = 本机今天到期或更早，逾期的在前，再按截止（没时刻的算到那天结束）；以后按截止；随时按记下的先后（记事本往下添）；Galley 在办 = 子任务（票 37 规则，最近有动静的在前）在前，再接没挂在待办上的一次性任务（两种目标都算），近的在前、暂停的在后；例行 = 重复任务（两种目标），近的在前、暂停的在后；已完成 = 7 天滚动窗口内勾掉的待办、触发过的独立一次性、例行跑过的那一次、结束的子任务，新的在前，上限 50。挂在待办上的提醒不进任何一组，只在它的待办上。
5. **「在办的事」的格式**：三组照查询，分别是 `The user's to-dos (not done):`、`What you are on (subtasks not finished, then one-off reminders and tasks to come):`、`Routine (repeating tasks):`。例：

   ```text
   As of 2026-10-16 14:05, local time (it may have changed since: `todo list`, `schedule list` and `session brief <id>` read it now).

   The user's to-dos (not done):
   - `todo_1a2b3c4d5e6f7a8b` due 2026-10-16 10:00 (Fri), overdue: 回房东电话
   - `todo_2b3c4d5e6f7a8b9c` due 2026-10-21 15:00 (Wed), reminder 2026-10-21 14:00 (Wed): 交季度报告
   - `todo_3c4d5e6f7a8b9c0d` due 2026-10-23 (Fri), reminded 2026-10-16 09:00 (Fri): 交材料
   - `todo_4d5e6f7a8b9c0d1e` no due date: 买营养土
   ```

   第一行只在有待办时才写 `todo list`（没有待办时这一行与原来逐字相同）。每组 5 行、截 40 字照旧，多的写「and N more」加列全的命令（待办是 `todo list`）。预算 `IN_HAND_BUDGET_BYTES` 2467 → 4230：同一条规则从两组变三组（待办是新的一组，任务分到「在办」与「例行」两组），十五行而不是十行，一行待办（截止、逾期、暂停的提醒）和一行任务差不多长，再加第一行的 `todo list`；仍是量出来的最坏情况，无余量。

**与票面不同、或我加的**

1. **「在办的事」原有两组也跟着改组**：原来的「Coming up (reminders and scheduled tasks)」「Subtasks not finished」照查询拆成「What you are on」（子任务在前、一次性在后）与「Routine」。票面只说加一组待办，但第三节要求界面与「在办的事」照旧共用一个函数、同组同序（裁决 86），查询已经没有原来那两组。代价：没有待办时主对话的「在办的事」文本也变了；票 36 的评测在旧文本上测过，票 41 重跑时会覆盖。另一案是「在办的事」保留旧两组（文本不变），但就不再是「你看到的就是它看到的」。
2. **所有写都要托管运行时加主对话**：建、改、勾掉、取消勾、取消、取消提醒在外置或没有主对话时报 `assistant_unavailable:`（票 33 的前缀），票 40 不用再判。界面只在托管下有这几个动作。
3. **勾掉与取消勾是幂等的**（再勾一次、对没做完的取消勾都原样返回，`done_by` 保留第一次的）；取消照票 33 是第二次 `not_found`；已取消的待办对任何写都是 `not_found`；没有提醒时取消提醒是 `not_found`。做完的待办可以改标题、改截止、去掉提醒，不能设提醒（`invalid_args`，先取消勾）。
4. **双保险落在三处**：调度每分钟到点时，挂在已关待办上的任务不触发、直接软取消（`scheduler::drop_reminders_of_closed_todos`）；重启补读的 pending 用 SQL 排除已关待办的；叫醒送出前再读一次（`is_still_due` 查待办还开着）。读待办失败时照送（提醒丢了比多一次糟）。
5. **叫醒措辞**：挂在待办上的提醒换一段话：「Reminder `<任务>` on the user's to-do `<待办>` came due.」，原定时刻与晚到措辞照票 33 原样（抽成 `due_when_and_act` 共用，独立提醒的措辞逐字不变），接着说这是用户自己要办的事、给出标题与备注、截止（「It is due 2026-10-21 (Wed), local time.」或「It has no due date.」），行动句是「remind the user of it in a sentence or two, …」。标题与截止在叫醒那一刻从待办读，改过名的读到新名。回放行加「for to-do `<id>`」。
6. **事件在写失败时也发**：待办的写可能做了一半（待办改了、提醒被拒），所以 `Writes` 不论成败都发 `todos:changed`（碰到提醒的写再发 `scheduled-tasks:changed`），界面重读拿到的就是库里的样子。主对话一轮结束补填「建在哪一句」、重置清掉待办也发。
7. **没有外键**：`todo_id` 不建外键。以后重建任一张表时，开着外键（sqlx 默认，迁移里关不掉）的 `DROP TABLE` 会对指向它的行执行 ON DELETE，SET NULL 会把提醒和待办全部断开，CASCADE 会删掉提醒。待办只有重置会真删，重置在同一个事务里先删它们的任务。写进了迁移注释。
8. **旧界面**：对话框照旧三组（`legacyTodoGroups` 从四组取回：接下来 = Galley 的一次性任务加例行，按原来的排法；在办 = 子任务；最近做完 = 除待办外的已完成），**待办不画**，只有待办时显示空状态；勾掉、取消勾、取消提醒的界面函数已镜像好但没有接到任何按钮。票 40 合入后、票 42 之前，Galley 记下的待办在界面上看不见。

**远程协议**：远程模块转发的事件表（`core/src/remote/events.rs` 的 `FORWARDED`）本来就不含定时任务，`todos:changed` 也不加；手机推送里的 `schedule_failed` 走的是定时任务触发失败，不受影响。

**拿不准、要主会话定的**

1. 上面第 1 条：「在办的事」原有两组改组，没有待办时文本也变。
2. 上面第 8 条：票 40 与 42 之间待办在界面上看不见，合入顺序要注意。
3. 「随时」按记下的先后排（新的在下面）；若面板上想让刚记下的在上面，改一处排序。
4. 提醒到点但叫醒还在 pending 时把它的时刻改到以后：那次 pending 的叫醒照样会送（它已经到点了），新时刻再响一次。没处理。

**验证**（分支基于 `be2e91f7`；main 没动，没有变基）

- `cargo check --manifest-path core/Cargo.toml --workspace`：`Finished`，唯一警告是原有的 `relay/src/channels.rs:347` `fetch_update`。
- `cargo test --manifest-path core/Cargo.toml --workspace`：本机时区、`TZ=UTC`、`TZ=America/Los_Angeles` 各一遍，都是 43 组 `test result: ok`，合计 1106 passed、0 failed。
- `pnpm --dir gui typecheck`、`pnpm --dir gui lint`：exit 0；vitest 全量本机与 `TZ=UTC` 各一遍，都是 `Test Files 158 passed`、`Tests 1654 passed`。
- 六个门禁全过：IPC 漂移 aligned（18 events、11 commands，没动 runner 协议）、Supervisor SOP 4 份副本一致、文档链接 446 个文件、版本 0.6.2、内置 GA 载荷 OK、GA 基线 OK（`f308ee7e`）。`git diff --check` 无输出，新文件无行尾空白。
- 迁移在 JC 库的只读副本上试跑：副本（`immutable=1` 读，不含 WAL）在 048，依次跑 049、050 后 `foreign_key_check` 无输出、`integrity_check` 为 `ok`，副本已删。
- 新增行与新文件 grep 域名、`http`、`api_host`、`apibase`、`/Users/`、`/private/tmp`、`/var/folders`：无。
- 中文标点扫新增行：中文句子 0 处；19 处是英文注释与 In Hand 英文格式里夹中文词，用英文标点，不改。
- `rustfmt --check`：新文件与原本干净的文件整篇干净；原本不干净的（`lib.rs`、`scheduler.rs`、`db_writes_test.rs`、`scheduler_fire_test.rs`）差异条数与 HEAD 相同。gui 原本干净的四个文件整篇 prettier 干净，`scheduled-tasks.ts` 原本不干净，只加了一处注释与字段。

**没验证的**

- 真机（按约定不跑 `tauri dev`）；Windows 没测；没有真模型评测（票 41）。

**给票 40、41、42**

- 票 40：直接调上面的 Core 函数（经 `Writes` 发事件）；外置与没有主对话的拒绝、`time_in_past:`、截止解析都在 Core。「建在哪一句」照票 34 的判法传 `created_in`，`schedule_cmds.rs` 里的 `created_in` 是私有函数，复用要放开可见性。`todo list` 默认用 `TodoListScope::Open`，`--all` 用 `All`。`TodoBrief` 就是线上形状（`status`、`due`、`reminder`、`doneBy`、`origin`、`createdIn`）。`schedule list/show` 现在会带 `todoId`（只加），文档已加一行。
- 票 41：「在办的事」的文本变了（见上面格式），`.scratch/main-chat/entry-layer-eval/run.py` 里移植的 In Hand 与 `schedule/rust-samples.json` 还是票 36 的旧格式，`--dry-test` 会对不上，要跟着改；叫醒措辞里挂在待办上的提醒是新的一段。手册里该写的命令名在票 40。
- 票 42：查询形状见上面第 4 条，「今天 N」是 `todayCount`；三个命令在 `gui/src/lib/assistant-todo.ts`（`completeTodo` / `reopenTodo` / `cancelTodoReminder`）；刷新事件 `todos:changed` 已加进 `TODO_REFRESH_EVENTS`。待办卡片挂在 `createdIn` 那条回复下（同票 37 的算法）；待办的提醒任务没有 `createdIn`，票 37 的提醒卡片不会重复出现。对话框里的 `legacyTodoGroups` 是过渡，面板做好后可以删。重置确认框「会删除」的文案在这张票；数据层已经清。
