# 78 巡看错开整点；巡看与别的事同一次叫醒时不吞掉别的事

Status: needs-dogfood（2026-10-22 合入 `4b04ca08`、`50bea3a9`；主会话机器验收：rebase 到含票 77 的 main 后 `TZ=UTC cargo test --workspace` 1210 条全过、评测 `--dry-test` 全过；代理另跑本机时区全量、改过的文件 `rustfmt --check`、GUI typecheck 与 lint。两条混合叫醒用例 Sol 上 6/6，没有一遍吞掉别的事，叫醒措辞未改）

来源：[主聊天 PRD](../PRD.md) 裁决 126（2026-10-22，JC：「助理自己来选一个时间来执行定时任务、提醒用之类，我觉得是不是不应该定整点，因为用户通常会定整点……可以比如说定一个 9:13，10:07 之类的，和用户会配置的时间进行岔开」；主会话推荐 B 加 C、不做 A，JC：「按建议推进」）。依赖票 73、75（已合入）。与在跑的票 76（GUI 静默判定）、77（`carry.rs`、`db/main_chat.rs`）不碰同一处。

## 为什么

- Galley 自己定的时间只有一个：巡看的种子时间 `REVIEW_TIME_OF_DAY = "09:00"`（`core/src/scheduler.rs:113`），每台机器都一样、正落在用户最常定的整点上。Claude Code 自己的定时工具也有这条规则：大概时间时避开 :00、:30，理由是「全世界的请求在同一秒落到 API 上」。
- 本机两件事同一分钟到期时，Core 合成一次叫醒（`take_due` 一次全拿；`report_text` 用 `OPENING_MIXED` 开头、`CLOSING_MANY`「Reply once, covering all of them.」收尾，`core/src/subtask_report.rs:137`、`:146`、`:388-417`）。合成一条是对的；但巡看那段（`review_paragraph`，`:462` 起）说「没做成值得说的事，整条回复就是 `<no-reply/>`」，提醒那段要它告诉用户，两条放在同一条叫醒里，真模型会不会把提醒一起吞掉，评测没测过（四个巡看用例都是巡看单独到期）。真实的一例：JC 库里「确认 702 办公室装修完工」那条提醒是助理自己挑的 11-20 09:00，正好和巡看同一分钟。
- 助理替用户定的提醒照旧挑自然的时间（卡片和它说的话里都是这个时间，9:13 读起来像机器），不在本票范围。

## 一、巡看的种子时间错开整点（B）

1. 种巡看时（`ensure_review` → `create_system_task_once`，`core/src/scheduler.rs:358` 一带、`core/src/db/schedule.rs:747` 一带）挑一个时间：08:45 到 09:15 之间（含两端），分钟数不是 5 的倍数（用户常定的 :00、:15、:30、:45、:05 等都避开），共 24 个，随机取一个。种下后不再变：已经有种子（包括停用、取消的）时照旧不动。
2. 随机来源用 Core 现有的（看生成 `sched_…` 一类 id 用的是什么），不加新依赖。挑法写成一个纯函数，接受一个随机数，单元测试覆盖：落在范围内、不是 5 的倍数、24 个都取得到、边界。
3. `REVIEW_TIME_OF_DAY` 这个常量去掉或改成表达范围的常量；`scheduler.rs` 模块注释、`:106`、`:350` 一带写「每天 9 点上下」的地方跟着改。别的写死「09:00 巡看」的测试按新规则改（断言时间合法，不断言具体值）。
4. 手册 `docs/managed-ga-runtime/galley-assistant-manual/wake.md:54`「Every morning at 9:00」改成「Every morning a little before or after 9:00 (the time is in `schedule list`)」这个意思，其余不动。`gui/src/lib/scheduled-tasks.ts:54` 一带注释里的「at 09:00」跟着改；`EMPTY_SCHEDULED_TASK_FORM` 的 `09:00`（用户自己的表单默认值）不动。
5. 入口层与 `core/src/managed_prompt.rs` 测试里样例数据的 09:00 是虚构样例，不用改；如果有断言依赖巡看真实种子时间的，跟着改。

## 二、巡看与别的事同一次叫醒（C）

1. **评测**（`.scratch/main-chat/entry-layer-eval/`，待办套件 `todo/cases.json`，写法见 `_note` 与 README「巡看那条的写法」）加两条，组名「巡看与别的事同一次叫醒（票 78）」：
   - `review-with-reminder`：巡看与一条到期提醒在同一次叫醒（提醒是一条待办的提醒，如「确认 702 办公室装修完工」当天到点；`fired` 两条都为真）。期望：回复用自己的话告诉用户这件事（不是整条 `<no-reply/>`，不是复述提醒原文）；巡看本身没做成值得说的事时不提巡看；不提建议。
   - `review-with-subtask-done`：巡看与一件刚做完、有结果的子任务回报在同一次叫醒。期望：转达子任务的结果；同上。
   - 叫醒措辞要和 Rust 一字不差：`run.py` 的移植如果拼不出混合叫醒，照 README 的做法补移植，并用临时 Rust 测试按样本字段拼 `report_text` 得到 `rust-samples.json` 的新样本（临时测试跑完删掉，不提交）；`--dry-test` 的逐字对照要过。
   - 判卷：说了那件事（`names_any`）、不是只有 `<no-reply/>`、没有固定开头、`no_offer`；`--dry-test` 给过与不过各造一个运行。
2. **跑**：`--model-id mm_1792576875658`（API key 接入的 gpt-6.1-sol，脚本默认就是它；主会话 2026-10-22 已核对它在库里、`auth_kind` 是 `api_key`）。先 `--dry-test`，再只跑这两条，每条 3 遍。不重跑别的用例。
3. **只要有一遍吞掉了那件事**（整条 `<no-reply/>`，或没提它）：改 Core 的叫醒措辞，让巡看那段的「不开口」只管巡看自己。做法：`review_paragraph` 知道这次叫醒是否还带着别的事；带着时，最后两句换成「Say something about the review only when it got something done the user will want to know; the other updates in this note still get your reply as they ask. If the review only started subtasks or did nothing, say nothing about it.」这个意思（措辞你定，回报里原样给出）。巡看单独到期时的措辞一字不动。`wake.md`「The morning review」加一句同义的话。移植、样本跟着改，两条重跑各 3 遍。四遍以上都没吞就不改 Core，回报里写明。
4. 结果文件 `meta` 与说明只写模型 id 和「API key 接入」，不写服务商名、接口地址、本机路径；提交前 grep 一遍。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。JC 库里已经种下的那条巡看不由你改（合入后主会话处理）。
- 停用、跳过、补跑、丢弃等巡看的其余 Core 逻辑；用户的定时任务表单；助理替用户定提醒的手册规则（`reminders.md`、`times.md`）。
- `carry.rs`、`db/main_chat.rs`（票 77 在改）、`gui/` 里除第一部分第 4 条那处注释以外的文件（票 76 在改）。
- `core/` 不是 rustfmt-clean：只对改过的文件 `rustfmt --check`。
- 提交只点名文件，`git add … && git commit …`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 探针、脚本 import `managed-ga/code` 时 `PYTHONDONTWRITEBYTECODE=1`。

## 验证

- `cargo check --manifest-path core/Cargo.toml --workspace`；`cargo test --manifest-path core/Cargo.toml --workspace`，再在 `TZ=UTC` 下跑一遍；改过的文件 `rustfmt --check`；`git diff --check`。
- 动了 `gui/` 那处注释：`pnpm --dir gui typecheck`、`pnpm --dir gui lint`。
- 评测：`--dry-test` 全过；两条新用例在 Sol 上的结果。
- 中文全角标点。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 挑时间的函数与种子调用处的 diff 原样；`wake.md` 的 diff 原样。
3. 两条新用例逐遍结果，回复原文附上；改没改叫醒措辞、为什么，改了的话给出新措辞与重跑结果。
4. 验证命令与结果原样。
5. 看到但没改的问题、没验证到的地方。

## 给 JC 的真机步骤

1. 合入后主会话把你本机那条巡看改到按新规则挑的时间，告诉你是几点。打开待办面板「例行」：「过一遍在办的事」第二行是「每天 08:57」这样的时间。
2. 第二天早上在那个时间前后看：清单上只有提醒还早的事时，什么都不出现。
3. 11-20 早上 9 点，装修那条提醒照常到；巡看在它自己的时间另行，不和提醒合成一次。

## Comments

### 2026-10-22 实现回报（票 78 代理）

#### 1. 提交

分支 `ticket-78-review-off-the-hour`，未 push、未合入：

```text
1913c717 Ticket 78 eval: the review in one wake with a reminder or a subtask's result
7c3ecdb8 Ticket 78: pick the morning review's time off the hour
```

- `7c3ecdb8`：Core 挑时间（`scheduler.rs`、`api/schedule.rs`）、测试（`scheduler.rs` 单元测试、`schedule_wake_test.rs`、`assistant_manual.rs`）、手册 `wake.md`、`runtime-modes-and-sessions.md`、`gui/src/lib/scheduled-tasks.ts` 的注释。
- `1913c717`：评测（移植、用例、三条 Rust 样本、判卷、`--dry-test`、两条新用例的结果、README 一节）。

#### 2. 挑时间的函数、种子调用处、`wake.md` 的 diff

随机来源：`sched_…` 一类 id 用的是 `mint_hex16`（时间混计数器，再乘两次常数打散），本票把它拆出 `mint_u64`，`mint_hex16` 改成格式化它的高 64 位（与原来取 `{x:032x}` 前 16 位逐位相同），没加依赖。

```diff
-/// 16 hex digits, apart for two mints in the same tick: the time stirred
-/// with a counter, as `mint_project_id` does.
+/// 16 hex digits, apart for two mints in the same tick: [`mint_u64`].
 pub(crate) fn mint_hex16() -> String {
+    format!("{:016x}", mint_u64())
+}
+
+/// 64 bits apart for two mints in the same tick: the time stirred with a
+/// counter, as `mint_project_id` does. The ids above, and the morning
+/// review's time (ticket 78, `crate::scheduler::review_time_of_day`).
+pub(crate) fn mint_u64() -> u64 {
     use std::sync::atomic::{AtomicU64, Ordering};
@@
     x ^= x.wrapping_mul(0xC4CEB9FE1A85EC53_C4CEB9FE1A85EC53);
-    let hex = format!("{x:032x}");
-    hex[..16].to_string()
+    // The high half: what the first 16 of `{x:032x}` were.
+    (x >> 64) as u64
 }
```

```diff
-/// When the review fires, local wall clock, every day.
-pub const REVIEW_TIME_OF_DAY: &str = "09:00";
+/// The window the review's time is picked in (main chat ticket 78, PRD
+/// ruling 126), local wall clock, in minutes after midnight, both ends
+/// included: 08:45 to 09:15.
+pub const REVIEW_WINDOW: std::ops::RangeInclusive<u32> = (8 * 60 + 45)..=(9 * 60 + 15);
+
+/// Every time the review may be made at, as `HH:MM`, earliest first: the
+/// minutes of [`REVIEW_WINDOW`] that are not a multiple of five, so none
+/// is a time people set (:00, :05, :15, :30, :45 …). There are 24.
+pub fn review_times() -> Vec<String> {
+    REVIEW_WINDOW
+        .filter(|minute| minute % 5 != 0)
+        .map(|minute| format!("{:02}:{:02}", minute / 60, minute % 60))
+        .collect()
+}
+
+/// The review's time of day, one of [`review_times`] picked by `random`
+/// (any number; Core passes `crate::api::schedule::mint_u64`'s). Main
+/// chat ticket 78 (PRD ruling 126): not 09:00 on every machine, on the
+/// hour people set their own tasks at. Picked once, when Galley makes the
+/// review ([`ensure_review`]), and kept: the user moves it with `schedule
+/// update`, Galley never does.
+pub fn review_time_of_day(random: u64) -> String {
+    let mut times = review_times();
+    let pick = (random % times.len() as u64) as usize;
+    times.swap_remove(pick)
+}
```

```diff
     let id = crate::api::schedule::mint_scheduled_task_id();
+    let time = review_time_of_day(crate::api::schedule::mint_u64());
     match galley
-        .create_system_task_once(&id, REVIEW_PROMPT, REVIEW_TIME_OF_DAY, REVIEW_SUPERVISOR)
+        .create_system_task_once(&id, REVIEW_PROMPT, &time, REVIEW_SUPERVISOR)
         .await
```

`create_system_task_once`（`db/schedule.rs`）本来就收时间参数、「有任何一条（启用、停用、取消）就不建」，没改；已有的种子因此不动。

```diff
 ## The morning review
 
-Every morning at 9:00 Galley wakes you to go over what is in hand; the
-note says it is the morning review. Galley made this task, not you, and
+Every morning a little before or after 9:00 (the time is in
+`schedule list`) Galley wakes you to go over what is in hand; the note
+says it is the morning review. Galley made this task, not you, and
 skips the morning when nothing is in hand.
```

其余跟着改的：`scheduler.rs` 模块注释、`REVIEW_SUPERVISOR` 与 `ensure_review` 的注释、`fire_review` 注释里的「asleep at 9:00」；`assistant_manual.rs` 的手册条目断言换成新的两行；`schedule_wake_test.rs` 断言时间在 `review_times()` 里、已有的那条再叫一次 `ensure_review` 时间不变、叫醒原文里的「every day at」取那条任务自己的时间；`gui/src/lib/scheduled-tasks.ts:54` 注释改成「a little before or after 09:00 (a time Core picks once when it seeds it, ticket 78)」，`EMPTY_SCHEDULED_TASK_FORM` 的 `09:00` 没动。单元测试 `the_review_time_is_off_the_times_people_set_around_nine`：24 个、首尾是 08:46 与 09:14、每个都在窗口里且不是 5 的倍数、08:45 / 08:50 / … / 09:15 与 08:44 / 09:16 都不在、0～23 取遍 24 个、24 回到 08:46、`u64::MAX` 也合法。入口层与 `managed_prompt.rs` 测试里的 09:00 是虚构样例，没有断言依赖巡看的真实种子时间，没动。

#### 3. 两条新用例

组名「巡看与别的事同一次叫醒（票 78）」。叫醒原文是 Core 的：`run.py` 的 `reminder_note` 补了子任务做完的那一段（`OPENING_SUBTASK`、`done_paragraph`、`report_cut`），`schedule/rust-samples.json` 加了三条用临时 Rust 测试按样本字段拼 `report_text` 得到的混合叫醒（提醒加巡看、子任务加巡看、打回两次且回答超长被截断的子任务加晚了 8 小时 5 分钟的巡看），临时测试已删，`--dry-test` 逐字对照全过。次序照 Core：同一分钟到点的定时任务按 `last_fired_at, id` 读，所以提醒（`sched_4b8c…`）在巡看（`sched_5e1a…`）前；子任务的回报先到，排在巡看前。两条里巡看都排在后面，它那句「your whole reply is exactly <no-reply/>」离结尾最近，是更容易吞的那种排法。

`--model-id mm_1792576875658`（API key 接入），运行前只读核对过：在库里，`auth_kind` 是 `api_key`。先 `--dry-test`，再 `--suite todo --cases review-with-reminder,review-with-subtask-done --repeats 3 --parallel 6`，6 次运行、18 次模型调用，别的用例没重跑。

| 用例 | 结果 |
| --- | --- |
| `review-with-reminder` | 3/3 过 |
| `review-with-subtask-done` | 3/3 过 |

逐遍回复原文（`<summary>`、`<next-suggestion>` 保留）：

- `review-with-reminder` 第 1 遍（读了 `todo list`、`schedule list`、`sessions list`）：

  ```text
  <summary>今天是预计完工日，实际进度还待确认。</summary>

  702 办公室装修今天能按计划完工吗？先跟师傅确认是否还有收尾项目，再约现场验收，免得白跑一趟。

  <next-suggestion>帮我列一份702办公室装修验收清单</next-suggestion>
  ```

- `review-with-reminder` 第 2 遍（同上三条命令）：

  ```text
  <summary>已核对待办，702 办公室是否完工还待确认。</summary>

  师傅之前说 702 办公室预计今天完工，现在收尾了吗？如果已经完工，可以约个时间现场验收，先查水电、墙面和门窗，再确认尾款。

  <next-suggestion>帮我列一份702办公室装修验收清单</next-suggestion>
  ```

- `review-with-reminder` 第 3 遍（同上三条命令）：

  ```text
  702 办公室的装修今天按计划完工了吗？如果师傅已经收工，可以约个时间现场验收，看看水电、墙面和收尾清理是否到位。

  <next-suggestion>帮我列一份办公室装修验收清单</next-suggestion>
  ```

- `review-with-subtask-done` 第 1 遍（`session show … --around=msg_…_0_user`、`--tail=40`，再读三份清单）：

  ```text
  <summary>三班候选均符合上午 9 点后出发的条件，查询结果已核对。</summary>

  下周三（**10 月 28 日**）杭州东 → 上海虹桥，挑了这三班：

  | 车次 | 出发 → 到达 | 耗时 | 二等座票价 | 查询时余票 |
  |---|---|---|---|---|
  | G7502 | 09:12 → 10:06 | 54 分钟 | 73 元 | 有票 |
  | G7348 | 09:41 → 10:39 | 58 分钟 | 73 元 | 有票 |
  | G1374 | 10:05 → 10:58 | 53 分钟 | 73 元 | 余 9 张 |

  来源：[12306 余票查询页](https://kyfw.12306.cn/otn/leftTicket/init)。余票会变化，以购票时显示为准。

  <next-suggestion>帮我查一下当天傍晚上海虹桥回杭州东的高铁</next-suggestion>
  ```

- `review-with-subtask-done` 第 2 遍（同上五条命令）：

  ```text
  <summary>三班车次符合出发时段要求，已核对返回信息与查询链接。</summary>

  下周三（**10 月 28 日**）杭州东 → 上海虹桥，上午 9 点以后出发的三班：

  | 车次 | 出发—到达 | 二等座 | 查询时余票 |
  |---|---|---|---|
  | G7502 | 09:12—10:06 | 73 元 | 有票 |
  | G7348 | 09:41—10:39 | 73 元 | 有票 |
  | G1374 | 10:05—10:58 | 73 元 | 余 9 张 |

  来源：[12306 余票查询页](https://kyfw.12306.cn/otn/leftTicket/init)。余票会变动，以购票时显示为准。

  <next-suggestion>帮我查一下 G7348 的最新余票</next-suggestion>
  ```

- `review-with-subtask-done` 第 3 遍（同上五条命令）：

  ```text
  <summary>三班候选的时间、票价、余票及查询来源已核对齐全。</summary>

  下周三（**10 月 28 日**）杭州东 → 上海虹桥，上午 9 点以后出发可选这三班：

  | 车次 | 出发—到达 | 二等座票价 | 查询时余票 |
  |---|---|---:|---|
  | G7502 | 09:12—10:06 | 73 元 | 有票 |
  | G7348 | 09:41—10:39 | 73 元 | 有票 |
  | G1374 | 10:05—10:58 | 73 元 | 余 9 张 |

  来源：[12306 余票查询页](https://kyfw.12306.cn/otn/leftTicket/init)。余票随时变化，以购票时显示为准。

  <next-suggestion>帮我比较一下这三班，推荐一班</next-suggestion>
  ```

**没改叫醒措辞**：六遍没有一遍吞掉那件事（没有整条 `<no-reply/>`，每遍都说了装修或三班车），也没有一遍提到巡看、写 `<no-reply/>`、勾掉待办、打回或派活。照第二部分第 3 条，「四遍以上都没吞就不改 Core」，`review_paragraph` 一字没动，`wake.md` 也没加那句同义的话，移植与样本里巡看那段照旧。

#### 4. 验证

```text
cargo check --manifest-path core/Cargo.toml --workspace          → Finished，退出码 0
cargo test --manifest-path core/Cargo.toml --workspace           → 1204 passed，0 failed，退出码 0
TZ=UTC cargo test --manifest-path core/Cargo.toml --workspace    → 1204 passed，0 failed，退出码 0
rustfmt --edition 2021 --check core/src/api/schedule.rs core/src/assistant_manual.rs core/tests/schedule_wake_test.rs → 干净
rustfmt --edition 2021 --check core/src/scheduler.rs             → 两处 diff（`pub async fn fire` 签名、一条 `due_fire` 断言），HEAD 上同样两处，都不是本票的行
git diff --check bd32c2c9..HEAD                                   → 干净
pnpm --dir gui typecheck                                          → 退出码 0
pnpm --dir gui lint                                               → 退出码 0
PYTHONDONTWRITEBYTECODE=1 <python3.14> run.py --dry-test          → DRY TEST PASSED（555 项 PASS，0 FAIL）
run.py --suite todo --cases review-with-reminder,review-with-subtask-done --repeats 3 → 6/6 ok，failed: none
```

`--dry-test` 新加的：三条混合样本逐字对 Rust；两条用例的叫醒是混合开头、次序对、结尾 `CLOSING_MANY`；子任务那条在假 CLI 的会话列表与 `session show` 里、快照里没有它；判卷各造了过与不过的运行（说了那件事过；只有 `<no-reply/>`、开口没提、「早上过了一遍在办的事：」开头、「其他在办的事都没变化」、建议、复述提醒原文都不过；正文加 `<no-reply/>` 过但注出来；只写在 `<summary>` 不过、不算吞掉）；另有两次假模型运行：子任务那条照叫醒的命令经假 CLI 核对后转达（过），提醒那条只回 `<no-reply/>`（判成吞掉）。`managed-ga/` 下没有 `__pycache__`。提交前 grep 过新增行：没有 `/Users/`、`/var/folders`、临时目录、接口地址、服务商名；唯一的网址是用例里虚构的子任务回答带的 12306 查询页。

#### 5. 看到但没改、没验证到的

1. 改了票面清单以外的一处文档：`docs/managed-ga-runtime/runtime-modes-and-sessions.md` 写着「a daily 09:00 `assistant` task」，改成挑时间的写法。`docs/devlog/deferred.md:65`「不再只靠每天 9:00」、`subtask_report.rs:459` 注释「promised nothing at 9:00」、`.scratch` 里的历史票与 PRD 没动。
2. 顺手修了一处评测的老问题：票 75 的 `review_advance` 判卷把 `names`（这次运行跑过的命令）覆盖成了 `names_any`，开口的运行记下的命令名会错；改了变量名，判定结果不变（这次没有别的用例重判出不同结论）。
3. `todo/results.md` 是用 `--render-only` 从 `results.json` 重出的：老用例的「读手册」字节数比原来少了几十（原来是在没去掉临时目录前算的，现在按 JSON 里换成 `$TMPDIR` 的结果算），运行记录本身逐字没变。`meta.repeats` 跟着这次变成 3（脚本记的是最后一次调用的参数，别的用例仍是两遍），`meta.manual_sha` 变成这次的手册版本。
4. 评测里巡看那条的时间照旧取运行那一分钟，新的 08:45～09:15 规则没有上真模型；两条混合用例只在 Sol 上各跑 3 遍。B 之后，巡看与用户整点的提醒不会再同一分钟到点，混合叫醒只剩补跑、主对话正忙时攒在一起、子任务恰好同时交回这几种，本票测的就是这几种的措辞。
5. `review_mixed` 判「提了巡看」靠 `REVIEW_TALK_RE`（「巡看」「过了一遍」「在办的事」「例行」「清单上其他」「别的事都……」一类）和 `REVIEW_EMPTY_RE`；换个说法提巡看（「顺便看了下别的待办」）认不出来，只能读原文。
6. 没跑 `tauri dev`，没在待办面板上看「例行」第二行的时间；JC 库里已经种下的那条巡看仍是 09:00，按票面由主会话合入后处理。
