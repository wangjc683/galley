# 33 定时任务加「一次性」与「叫醒助理」（Core）

Status: done（2026-10-19 JC 真机：「十分钟后提醒我喝水」10:44 到点，主对话说了一句并通知；合盖错过提醒的补发未验。2026-10-16 合入 main，分支提交 `b767edaa`、`26c56879`、`edca1db4`，合并提交 `16d7f2e1`；真机随票 35–37 一起验）

来源：[助手 PRD](../../assistant/PRD.md) 裁决 9（2026-10-16，JC：「一，B；二，按你推荐，写票吧」），主对话 PRD 裁决 84。只改 Core（含迁移与给界面的事件）；CLI 是票 34，界面是票 37。依赖 29（叫醒）、32（若先合入，迁移编号接在它后面）。

## 目标

助理用一句话就能让 Galley 在某个时刻（一次或重复）叫醒它一轮，带上它当初记下的话；到点它来组织说什么、做什么。叫醒走票 29 已有的管道，不另起一条。

## 现状

- `scheduled_tasks`（迁移见 `core/src/db/schedule.rs`）：`repeat_kind` 只有 `daily` / `weekly` / `monthly`（表上有 CHECK），`time_of_day` 是本地时刻，到点经 `session.new` 的 socket 派发新建一个普通会话（`core/src/scheduler.rs:18`）。
- 补跑：错过的当天内补一次，过了午夜丢（`core/src/scheduler.rs:9-16`）。
- 叫醒：`core/src/subtask_report.rs`，子任务一次运行结束时写一条看不见的 user 行（`via: system`、supervisor `galley-report`），空闲即送、在跑等这一轮、在等回答时不送并告诉界面送不出去、几件合一；报告只在内存里。

## 要做

### 一、表

- 迁移：
  - `repeat_kind` 加 `once`；一次性的触发时刻是一个绝对时刻（UTC ISO 8601，新列，比如 `fire_at`），`time_of_day` / `repeat_days` 对它无意义（允许空，或照约定填；改 CHECK 要重建表，照 SQLite 的做法）。
  - 新列「到点做什么」（比如 `target`）：`session`（今天的行为：新建会话跑 prompt）或 `assistant`（叫醒主对话）。旧行全是 `session`。
  - 新列「谁建的」：照 `messages` 的来源字段（`created_via` + `supervisor`），GUI 建的是 `gui`，助理经 CLI 建的是 `supervisor` + `galley-assistant`，外部 agent 是它自己的 supervisor 名。
  - 新列「建在哪一句里」：助理在主对话的一轮里建的，记下主对话的会话 id 与那一轮回复的 `turn_index`（票 37 的卡片挂在那条回复下，照子任务卡片 `subtask_dispatches(parent_session_id, turn_index, …)` 的挂法）。怎么判定「这个 CLI 调用来自主对话正在跑的那一轮」你定，要确定式：比如 supervisor 是 `galley-assistant` 且主对话有一轮在跑。判不出来就不挂，任务照建。
  - 一次性的触发后不删，留着「已触发」的状态与实际触发时刻（卡片要显示「已提醒」，「定时」列表要能看到历史）。
  - **取消是软的**：取消与删除（界面、CLI 都算）记一个取消时刻（新列），调度与默认列表都忽略它，行留着，卡片据此画「已取消」（票 37）。今天界面的删除若是真删，改为软删除，界面看起来不变。
- 加了迁移，记得补六处手写迁移列表（core/tests 四处、cli/tests 两处），`--workspace` 全量测试能抓到。

### 二、调度

- `once`：到点（`fire_at <= 现在`）且没触发过就触发，触发一次。**不受「过了午夜就丢」的限制**：电脑睡了两天，醒来照样补，提醒丢了比晚到更糟。
- 重复的：补跑规则不变。
- `target = session`：照今天。另外，**托管运行时有主对话时，这类会话一次运行结束也叫醒助理交代**（主对话裁决 80）：结果、提问、出错各一份报告，进同一条管道；会话照旧在侧栏、不变成子任务。
- `target = assistant`：不建会话，交给叫醒管道。

### 三、叫醒

- 在 `subtask_report.rs` 的管道里加一种报告「定时到点」：带任务 id、它当初记下的话（`prompt`）、原定时刻、实际时刻、晚了多久（本地时间，人读的格式），以及是一次性还是重复。送达、合并、在等回答时不送、送不出去的规则与子任务报告相同；多件同时到点合成一次。
- **不能丢**：子任务报告只在内存里，Galley 退出就丢。定时到点的不行：它要从表里能重新推出来（比如「已到点、未送达」也是持久状态，送达或退回通知后才算消费）。Galley 在等回答时退出，下次启动照样送。
- **送不出去**（在等你回答、runner 起不来、模型出错这一轮没回）：发系统通知，正文用它记下的原话，然后算消费，不再叫醒。界面事件照子任务报告的做法（票 37 用）。
- 叫醒行的回放形式（`replay_lines`）写清是哪个任务、原定与实际时刻；页面照旧藏起这一行（票 31 的规则按 supervisor 认，确认新报告也被藏）。
- 叫醒这一轮它回 `<no-reply/>` 是允许的（比如事情你已经办了），照票 29 的规则不画、不通知。

### 四、给界面与手机

- 任务的增删改、触发、送达、退回都发事件（已有 `SCHEDULED_TASKS_CHANGED_EVENT` 就沿用）。远程协议若已转发定时任务的变化，跟着带上新字段；没有就不在这张票加。
- GUI 用的 Tauri 命令与类型带上新字段；`gui/src/types/ipc.ts` 镜像跟着加，IPC 门禁要过。界面的改动是票 37，这里只让旧界面不坏：旧表单建的照旧是每天 / 每周 / 每月 + `session`。

## 不做

- CLI（票 34）、手册与提示词（票 36）、卡片与列表（票 37）。
- 推到手机或 IM 渠道（裁决 9：等手机版）。
- 外置运行时：没有主对话，`target = assistant` 的任务在外置下不触发（或根本建不出来，你定、写理由）；`session` 照旧。

## 验收

- Rust 测试：
  - 一次性按时触发一次；睡过头（跨天、跨两天）醒来补一次，报告里写晚了多久；触发后不再触发；
  - `target = assistant` 不建会话、进叫醒；在等回答时不送、退回通知、算消费；Galley 重启后未送达的照送；
  - 两件同时到点合成一次叫醒；
  - `target = session` 的会话跑完叫醒助理（主对话存在时），会话不变成子任务；外置运行时零变化；
  - 迁移：旧行全部变成 `session`、来源 `gui`；六处迁移列表。
- `cargo check` / `cargo test --manifest-path core/Cargo.toml --workspace`、`git diff --check`、六个门禁脚本、中文标点扫新增行。
- 真机（JC，随票 34–37 一起）：说「十分钟后提醒我喝水」，十分钟后它在主对话里说一句并通知；合上盖子错过一个提醒，醒来它说晚了多久。

## Comments

### 2026-10-16 实现回报（子代理，分支 `mc-schedule-core`）

**改了哪些文件**

- `core/migrations/049_scheduled_tasks_once_and_wake.sql`（新）与 `core/src/db_migrations.rs`：重建 `scheduled_tasks`；六处手写迁移列表都补了 049（`db_test`、`db_writes_test`、`scheduler_fire_test`、`socket_write_handlers_test`、`cli/tests/cli_test.rs`、`cli/tests/m1_writes.rs`；后两者与 `db_test`、`socket_write_handlers_test` 原来没有 035–037，一并补上，否则 049 的重建找不到表）。
- `core/src/api/schedule.rs`、`core/src/api.rs`：`ScheduledTaskRepeat::Once`、`ScheduleTarget`、`ScheduledWake`、`ScheduledTaskCreatedIn`、新事件与载荷、`parse_fire_at`、错误前缀常量；`ScheduledTaskBrief` 只加字段。
- `core/src/db/schedule.rs`（重写）、`core/src/db/mod.rs`：读写新列、列表范围 `ScheduleListScope`、软取消、到点记 pending、送达 / 退回、重启补读、「建在哪一句」的补填。
- `core/src/scheduler.rs`：一次性与取消的到点判断（`due_at`）、叫醒助理的触发（`fire_reminder`）、「立即运行」共用的 `run_now`；触发会话改为直接调 `session.new` 的处理函数（见下文第 6 条）。
- `core/src/subtask_report.rs`：报告加 `ReportOutcome::Due` 与 `SubtaskReport.scheduled_task_id`，措辞、回放行、送不出去的退回、这一轮结束时的结算、从库里补读。
- `core/src/message_queue.rs`、`core/src/app_setup.rs`：叫醒的待报集合由 app 持有（排队任务与调度共用一个）；排队任务在主对话一轮结束时结算到点任务、补填「建在哪一句」。
- `core/src/commands/schedule.rs`、`core/src/session_writes.rs`、`core/src/socket_listener/mod.rs`（只加 `dispatch_session_new_with`）。
- 界面（只为旧界面不坏）：`gui/src/lib/scheduled-tasks.ts`、`ScheduledTasksDialog.tsx`、`useSchedulerSignals.ts`、`zh.ts` / `en.ts`、`scheduled-tasks.test.ts`。
- 测试：`core/tests/schedule_wake_test.rs`（新，14 条）；`db_writes_test` 加迁移 049 一条、删除改为取消一条；`scheduler.rs`、`subtask_report.rs` 单测。
- 文档：`docs/managed-ga-runtime/runtime-modes-and-sessions.md` 新节「Scheduled Tasks Wake The Assistant」、`docs/architecture.md` 事件表一行。

**确切名字（给票 36、37）**

- 新列：`fire_at`（UTC）、`target`（`session` / `assistant`）、`created_via` / `created_by_supervisor` / `created_origin_note`、`created_in_session_id` / `created_in_run_turn` / `created_in_turn_index`、`last_due_at`、`last_wake`（`pending` / `delivered` / `notified`）、`cancelled_at`；一次性的 `time_of_day`、`repeat_days` 为空。旧行全是 `session`、`gui`。
- 线上（`ScheduledTaskBrief`，空则不写）：`repeat` 加 `{"kind":"once"}`；`fireAt`、`target`（总写）、`lastDueAt`、`lastWake`、`origin`（Agent API 的 `Origin`）、`createdIn {sessionId, turnIndex?}`、`cancelledAt`。一次性的 `timeOfDay` 是 `fireAt` 的本地时刻，只供显示。`nextFireAt` 在停用、取消、一次性已触发时不写。
- 事件：沿用 `scheduled-tasks:changed`（增删改、触发、送达、退回、补填建在哪一句都发）；新 `scheduled-tasks:reminder-undelivered`，载荷 `{taskId, prompt, reason}`，`reason` 为 `asking` / `not_started` / `no_reply` / `no_main_chat`。
- 叫醒行：照票 29 的 `galley-report` 行，`origin_note` 列出它带的子任务会话 id 与到点任务 id；回放行 `[Galley: reminder <id> came due (…) — details: schedule show <id>]`，定时会话的是 `[Galley: scheduled task <task> ran in session <sid> "<prompt>": finished — details: session show <sid>]`。页面按 supervisor 藏，新报告同样被藏。
- 晚于 `LATE_AFTER_SECS = 120` 秒才写晚了多久（「2 days 3 hours」这类）。
- Tauri：`list_scheduled_tasks` 加可选参数 `all`（含已取消）；`delete_scheduled_task` 改为取消。

**票面留给我定的**

1. **列名与线上形状**：来源照 `sessions` 的三列（`--reason` 也记）。线上用 Agent API 已有的 `origin` 对象（§6A），不另起 `createdVia` + `supervisor` 两个散字段：同一个意思已有现成形状。「建在哪一句」拆成两步：CLI 调用时只知道这一轮从哪条用户行开始（`created_in_run_turn`），回复还没写出来；这一轮结束时排队任务填回复的 `turn_index`（这一轮最后一条看得见的 assistant 行）。用开头那条认这一轮，Galley 中途退出留下的旧任务不会被下一轮误认；这一轮没写回复就留空。
2. **怎么判定「来自主对话正在跑的那一轮」**：写命令带 `--supervisor=galley-assistant`，并且此刻主对话的运行闸门开着（`run_state(main).open_run`），两条都成立才挂，否则照建不挂。
3. **重启后照送**：库就是队列。到点只在库里记 `last_wake = 'pending'`；调度每分钟把所有 pending 读进叫醒管道（按 `sched:<任务>@<触发时刻>` 去重），这一刻触发的与重启前遗留的走同一条路；送达或退回才改状态。
4. **外置运行时**：建不出来（`assistant_unavailable:`），已建的在外置期间不触发；切回托管后一次性的照补（照说晚了多久），重复的照旧只在当天内补；外置期间 pending 的留着，回到托管再送。理由：外置没有主对话，零变化；切走一阵再回来，提醒仍不该丢。
5. **「模型出错这一轮没回」**：叫醒送出前记下这一轮带着哪些到点任务；这一轮结束时是 `DONE_WITHOUT_EXIT` 或 runner 中途退出就算没回，退回通知；其他结束（含 `<no-reply/>`、你手动停掉）算送达。
6. **定时会话（`target = session`）何时叫醒助理**：会话来源是 `galley-scheduler`（从理由字段 `scheduled task <id>` 认任务），会话与当前运行时都是托管，主对话存在，且没有人从 app 在里面写过（有 `created_via = 'gui'` 的用户行就算接手，不再报）；结果、提问、步数上限、出错各一份报告，会话照旧在侧栏。
7. **一次性的「已触发」**不另加列：`last_fired_at >= fire_at` 即已触发。手动「立即运行」在 `fire_at` 之前跑不吃掉到点那次（与重复任务「手动运行不吃掉以后的计划」同一规则）；把 `fire_at` 改到以后会重新装上。

**与票面不同、或我加的**

1. **系统通知由界面发**：Core 照旧不直接发系统通知（scheduled-tasks 票 05），所以在 `useSchedulerSignals.ts` 加了一个监听，收到 `scheduled-tasks:reminder-undelivered` 就发通知：标题「提醒」/「Reminder」，正文是原话，沿用 `scheduleFailed` 这一类（没有开关），音色 `needsYou`。窗口在前台时照现有门控不弹，点通知打开助理，这两处留给票 37。
2. **旧界面不坏，只动最少的几处**：类型加字段与 `once`；一次性的行不能点开编辑（旧表单表达不了），重复规则写「一次 20:00」；叫醒助理的任务不算「触发失败」（不进角标，「上次运行」不写「上次触发失败」）；删除改为取消后行从列表消失，看起来不变。
3. 删第二次照旧是 `not_found`（原有测试钉着）；已取消的任务对改、启停、立即运行都是 `not_found`。
4. `target = assistant` 不许带项目与模型（只对会话有意义），带了是 `invalid_args`。
5. 一次性的过去时刻在 Core 校验（Tauri 与 socket 同一处），信息以 `time_in_past:` 开头。
6. 调度触发会话时改为直接调 `session.new` 的处理函数，不再经过行路由：票 34 的 `schedule.run` 从路由里进来，路由的 future 不能包含自己（编译报类型成环）。行为不变，`scheduler_fire_test` 全过。
7. 多件同时到点：同一次 tick 先把到点的都记成 pending，再一次读进来叫醒，所以合成一条。

**拿不准、要主会话定的**

1. 叫醒送出后、这一轮结束前 Galley 退出：下次启动会再送一次，主对话里会有两条同一提醒的叫醒行（模型看得出是重复）。若嫌重复，可改成「送出即记送达」，代价是那一轮出错时提醒丢了。
2. 定时会话跑完：会话自己的完成通知（普通会话照旧会弹）加上助理的交代，可能是两个声音；交给票 37。
3. 主对话被重置时还在等的到点任务，按「送不出去」处理（发通知、用原话）。
4. 手机端：叫醒行照常经远程模块转发（与票 29 相同），手机渲染时按 `galley-report` 藏；定时任务的变化不转发（远程协议本来就不转发，按票面不加）。
5. 票 32 合入后用户可以删单条消息：若删掉了挂卡片的那条回复，`createdIn.turnIndex` 指向的行就不在了，卡片怎么办由票 37 / 38 定。

**验证（分支 rebase 到 `d1201b09` 之后）**

- `cargo check --manifest-path core/Cargo.toml --workspace`：`Finished`，唯一警告是原有的 `relay/src/channels.rs:347` `fetch_update`。
- `cargo test --manifest-path core/Cargo.toml --workspace`：本机时区、`TZ=UTC`、`TZ=America/Los_Angeles` 各一遍，都是 39 组 `test result: ok`，合计 1038 passed、0 failed（跑在 `47521368` 上；之后 main 的 `467ece12`、票 38 的合入只改界面与文档，Rust 源码没变，rebase 后 `cargo check` 照过）。
- 本票的新测试：`schedule_wake_test` 14 条；`scheduler.rs` 一次性、取消、到点时刻、理由解析、一次性不预览共 7 条单测；`subtask_report.rs` 措辞、晚了多久、规则文字、按时区读出共 4 条单测；`db_writes_test` 的迁移 049 与软删除。
- 迁移在 JC 库的一次性只读副本上试跑：`foreign_key_check` 无输出、`integrity_check` 为 `ok`，副本已删。
- `pnpm --dir gui typecheck`、`lint`：exit 0；vitest 本机与 `TZ=UTC` 各一遍，都是 `Test Files 153 passed`、`Tests 1601 passed`。
- 六个门禁脚本全过（IPC 漂移 aligned：本票没动 runner 协议，`gui/src/types/ipc.ts` 不用改，定时任务的界面类型在 `gui/src/lib/scheduled-tasks.ts`）；`git diff --check` 无输出；新增行无私有域名与本机路径；中文标点扫新增行 0 处。
- `rustfmt --check`：新文件与原本干净的文件整篇干净；原本不干净的文件只格式化了自己的段落。
