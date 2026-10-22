# 78 巡看错开整点；巡看与别的事同一次叫醒时不吞掉别的事

Status: ready-for-agent

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
