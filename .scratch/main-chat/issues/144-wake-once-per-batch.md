# 144 同一条回复派出的几件，Core 等齐了一起叫醒主对话

Status: ready-for-agent

来源：[主对话 PRD](../PRD.md) 裁决 193 第 5 条（JC 11-04：「甲甲甲」）。只在内置运行时的主对话；外置零变化（外置没有主对话，也没有子任务）。和票 [143](./143-deep-work-fans-out.md)（条款、手册、评测）并行做，互不碰文件。

## 为什么

- 现在一件子任务做完就叫醒主对话一次（裁决 174 第 5 条甲；`core/src/subtask_report.rs` 文件头「When」）。主对话忙着时到的报告才会攒成一次。
- 11-04 真机：三款手机拆成三个子任务并行，分别 267、284、398 秒做完，叫醒三次，前两次各 25–29 秒、各回一句进度，最后一次合表；三条「回复完成」通知。裁决 193 起，对比、报告这类成品默认拆开并行，这种情况会常见。JC 定由 Core 攒齐。

## 要做到

### 1. 行为

- **一批**：同一条回复派出、起来了的两件以上，即 `subtask_dispatches` 里同一个 `parent_session_id` + `turn_index`、`session_id` 不空、`failure` 为空的行。只派一件的不算批，照旧。
- **攒着**：一件的报告是做完（`ReportOutcome::Done`），同批还有别的在跑时，先不叫醒，报告攒着。
- **一起送**：同批没有在跑的了，攒着的就到期，走现有 `take_due` 那条路：主对话空着就立刻叫醒，忙着就等这一轮完。「没有在跑的了」指每一件都已经回来（有报告在等、在路上或已送过），或已不在跑（被停 `ABORTED` 不报告、被删、被提升成普通对话）。只等真在跑的；被停的那件不能让同批干等。
- **上限**：同批第一件做完满 5 分钟，还没回来的不再等，已经回来的先到期；后回来的照常各自叫醒（它们之间还算同一批的，照同样规则攒）。常量放在 `subtask_report.rs`，文档注释写出处（裁决 193 第 5 条：这次三件做完相差 131 秒；上限保证先做完的结果最多晚 5 分钟到）。
- **不攒的**：在问（`Asking`）、步数到顶（`StepLimit`）、出错（`Error`）、没起来（`NotStarted`）照旧立刻叫醒，它们要主对话动手。到点提醒（`Due`）不变。
- **顺路**：任何一次叫醒（到点提醒、同批在问的那件、别的报告）都把等着的报告一起送，攒着的同批也在内。这是现有做法（「the rest go as one message」），保住它。
- **时钟**：没有别的事件时，满 5 分钟也要有人去看。调度器每 60 秒一拍、已经在调 `subtask_report`（`core/src/scheduler.rs:737` 附近的 `restore_pending_reminders` / `wake_if_due`），可以借这一拍，也可以另起计时；你选，报告里写清粒度（例如最多晚一拍）。
- **退出**：攒着的报告和别的报告一样只在内存里；Galley 退出时子任务也停了，丢的只是等着的报告（裁决 8），不改。

### 2. 测试（`core/tests/` 或模块内，照现有子任务叫醒测试的写法）

1. 三件一批：前两件做完不叫醒，第三件做完叫醒一次，带三份报告。
2. 上限：两件做完、第三件还在跑，满 5 分钟叫醒一次带两份；第三件后来做完再叫醒一次。时钟要能在测试里拨，别真等 5 分钟。
3. 同批一件在问：立刻叫醒，攒着的做完那件一起送。
4. 同批一件被停：不等它，其余做完就叫醒。
5. 只派一件：做完立刻叫醒，照旧。
6. 到点提醒叫醒时，攒着的同批报告一起送。
7. 主对话忙着时到期：这一轮完了一次送进去，照旧。

### 3. 文档

- `core/src/subtask_report.rs` 文件头「When」那条改写，写出一批、攒着、上限、不攒的几种。
- grep `docs/` 里讲叫醒时机的地方（`architecture.md`、`ipc-protocol.md`、`docs/managed-ga-runtime/` 等），有写「一件做完就叫醒」的跟着改；没有就不加。
- 手册那句（几块回来合成一份）在票 143 里改，这里不碰手册与提示词。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
node scripts/check-docs-links.mjs
git diff --check
```

`rustfmt --check` 只查自己改过的 Rust 文件。预计不动 GUI；子任务卡片的状态来自子任务会话本身，不来自报告。若发现 GUI 依赖「一件做完就叫醒」（例如某个提示、计时），停下写进报告，别自己改 GUI。真机 dev 由主会话合入后走。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树）。不跑 `tauri dev`。
  ```bash
  cd <主树>
  git worktree add -b t144-wake-once-per-batch <scratchpad>/wt-144 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  ```
- 不动：入口层与手册（票 143）、GUI、runner、CLI、Agent API、迁移、IM、外置。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t144-` 前缀。票面里不写本机用户目录、worktree 路径。
- 长命令前台跑，跑完再往下。

## 回报

写在本文件末尾「## 报告」一节，并在最后一条消息里给主会话：行为怎么落的（认批、判「不在跑」、计时、顺路送）各在哪几行；改了哪些文件、加了哪些测试；验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。

## 报告

2026-11-04，在自建 worktree 的分支 `t144-wake-once-per-batch` 上做完，没合入 main。行号指本分支提交里的文件。

### 行为怎么落的

- **认批**：`core/src/db/subtask.rs` 新加 `SubtaskBatch`（65 行）与 `SqliteGalley::subtask_batch`（443 行）：按这件子任务最早那条记录的 `parent_session_id` + `turn_index`，取同一条回复里 `session_id` 不空、`failure` 为空的行，按 `ordinal` 排。`core/src/subtask_report.rs` 的 `record_run_end`（1450 行）在报告是做完（`Done`）、又是主对话的子任务（不是定时任务的会话）时，调 `batch_of`（1485 行）读出这一批，交给 `SubtaskReports::add_in_batch`（1236 行）：两件以上才攒，记下批与到达时刻；别的结局一律不攒。成员在报告到达时读一次（一条回复只派一次，成员不变）。
- **判「不在跑」**：`still_running`（1628 行）。一件算在跑：运行闸门开着（`open_run`，派出去的一轮还没等到结束），并且会话还在、没被提升。报告在等、在路上或已送过的，被停（`ABORTED`）的，在问的，被删、被提升的，都不算。先看内存里的闸门，开着的才读库查提升 / 删除；读库出错按在跑算，由上限兜底。
- **到期**：`due_now`（1607 行），`take_due`（1554 行）在第 1563 行先问它。等着的报告里有一份没攒（别的结局、到点提醒），就到期；全是攒着的，按批看：同批没有在跑的了，或这批最早那份到达满 `BATCH_WAIT_SECS`（167 行，300 秒，出处写在文档注释里），就到期。到期以后照旧：主对话空着就叫醒，忙着等这一轮完，在等用户回答就告诉桌面。上限之后后回来的，在还没回来的几件之间照同样规则攒，时钟从它们里头最早回来的那份算（`held_batches`，1270 行：按 `turn_index` 分批，取最早的到达时刻）。
- **计时**：借调度器 60 秒一拍。`core/src/scheduler.rs` 的 `tick` 读完到点提醒后调 `wake_for_held`（306 行调用，376 行定义），对每个还攒着报告的主对话（`SubtaskReports::holding`，1295 行）走一次 `spawn_wake_if_due`。粒度：上限最多晚一拍，主对话空着时在第一份到达后 5 分 0 秒到 6 分 0 秒之间叫醒；被提升、被删而没有运行信号的那件，也最多晚一拍才不再被等。时间是墙钟（`Utc::now`，同调度器，Mac 睡着也算时间）；测试用 `SubtaskReports::with_clock`（1212 行，`Clock` 类型 1177 行）拨钟。
- **被停的不让同批干等**：`ABORTED` 不报告，但 `record_run_end` 这时返回攒着它那一批的主对话（`holding_for`，1307 行），drain 任务在排队那步之后立刻再问一次 `take_due`。被提升、被删的那件跑完一轮或 runner 关掉时也这样返回。
- **顺路**：`take_due` 到期以后 `reports.take(main_chat_id)`（1590 行）拿走全部等着的报告，攒着的同批也在内，一条消息送出；到点提醒、同批在问 / 到顶 / 出错的那件、没起来的标签叫醒时都是这样。投递失败放回去的（`restore`，1381 行，1396 行清掉攒着的标记）已经到过期，下次照旧立刻试，不再攒。
- **文档**：`subtask_report.rs` 文件头「When」改写，新加「A batch」一条（30–60 行）；`docs/managed-ga-runtime/runtime-modes-and-sessions.md`「Subtask Reports」新加「A batch」一条（360 行）；`docs/architecture.md` 子任务报告那段补一句（166 行）；`CONTEXT.md` 加术语「Batch」（219 行起）；`scheduler.rs` 文件头补一段。`docs/devlog/deferred.md` 里「同一批子任务的结果攒一攒再交代」在 main 上已经撤了，没再动。

### 改的文件

- `core/src/subtask_report.rs`、`core/src/db/subtask.rs`、`core/src/db/mod.rs`、`core/src/scheduler.rs`
- `core/tests/subtask_report_test.rs`
- `docs/architecture.md`、`docs/managed-ga-runtime/runtime-modes-and-sessions.md`、`CONTEXT.md`
- 本票（报告）
- 没动：入口层、手册、提示词、评测（票 143 的文件）、GUI、runner、CLI、Agent API、迁移、IM、外置。

### 加的测试

`core/tests/subtask_report_test.rs` 新一节「a batch (ticket 144)」，用可拨的时钟（`clocked` / `at`），对应票面 1–7：

1. `a_batch_wakes_the_main_chat_once_when_the_last_is_back`：三件一批，前两件做完不叫醒、不告诉桌面，第三件回来叫醒一次，带三份。
2. `a_batch_waits_five_minutes_from_its_first_report_at_most`：两件做完、第三件在跑，差一秒不叫，满 300 秒叫醒一次带两份；第三件后来做完再叫醒一次。另加 `after_the_cap_the_ones_still_out_are_held_among_themselves`：上限之后后回来的照同样规则攒，从它们自己最早那份算。
3. `one_of_a_batch_asking_stopping_short_or_failing_wakes_at_once_with_the_held`：在问、步数到顶、出错三种，都立刻叫醒，带上攒着的那件。
4. `a_stopped_one_does_not_hold_up_its_batch`；另加 `a_promoted_or_deleted_one_does_not_hold_up_its_batch`。
5. `a_reply_that_started_one_subtask_is_no_batch`：同一条回复另有空标签、没起来的各一个，都不算成员（直接查 `subtask_batch`）；别的回复的子任务在跑也不影响。
6. `a_reminder_coming_due_carries_the_held_reports`
7. `a_batch_back_while_the_main_chat_runs_goes_in_one_wake_after_its_run`

模块内另加 `a_finished_report_is_held_for_a_batch_of_two_or_more`（只攒做完的、两件以上；分批取最早时刻；`holding` / `holding_for`；投递失败放回后不再攒）。测试辅助 `subtask()` 改为调新的 `subtask_of(…, turn)`，原有测试的派活结构不变。

反证：临时让 `due_now` 恒为真，跑本文件得「20 passed; 7 failed」（新测试里查攒着的 7 条全败），复原后全过。

### 验证（照抄命令输出）

- `cargo test --manifest-path core/Cargo.toml --workspace`：exit=0；47 行 `test result: ok`，合计 1344 passed、0 failed、0 ignored；其中 `tests/subtask_report_test.rs` 为「test result: ok. 27 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out」，库单测为「test result: ok. 629 passed; 0 failed」。唯一的警告是 `galley-relay` 原有的 `fetch_update` 弃用提示。
- `node scripts/check-docs-links.mjs`：「docs link gate OK: 493 files checked.」
- `git diff --check`：无输出。
- `rustfmt --edition 2021 --check`：`subtask_report.rs`、`db/subtask.rs`、`tests/subtask_report_test.rs` 无差异；`scheduler.rs` 只剩 main 上原有的两处（939、1293 行附近，不是本票改的）。
- 全角标点：自写脚本扫本分支新增行，「hits: 0」。

### 看到但没改的（Open risks）

1. 主对话在等用户回答时，若有别的报告到期（同批另一件在问、到点提醒），现有做法会把等着的全部报告告诉桌面「没送到」，攒着的也在内，桌面于是回落成这几件子任务自己的通知。这是「任何一次叫醒都带上等着的」在送不出去时的样子，没另做区分。
2. 攒着的报告只在内存里，退出即丢（裁决 8，不改）；攒着让这个窗口最多长 5 分钟。
3. 上限按墙钟算：系统时间往回拨会拉长等待（直到同批回来为止）；Mac 睡醒后在下一拍或下一个运行信号时到期。
4. 一件的运行闸门开着、runner 实际卡死又没有关闭信号时，会被当成在跑，只靠 5 分钟上限兜底。
5. 被提升、被删而没有运行信号的那件，要等下一拍（最多 60 秒）才不再被等。删一个正在跑的子任务时会不会发关闭信号，我没核。
6. 两处读法请主会话确认：①上限之后后回来的几件，时钟从它们里头最早回来的那份重新算，不从整批第一件算（那样它们会每件立刻各自叫醒）；②主对话把同批某件派回去重做后，这件又算在跑，同批后回来的会等它，最多 5 分钟。
7. 没发现 GUI 依赖「一件做完就叫醒」：子任务卡片的状态来自子任务会话本身；在问的那件不攒，裁决 102 的问题归属判断不受影响。看得见的差别只有：一件做完后卡片显示已完成，主对话最多 5 分钟不出声。
8. 真机 dev 没走，按票面由主会话合入后走。

## Comments
