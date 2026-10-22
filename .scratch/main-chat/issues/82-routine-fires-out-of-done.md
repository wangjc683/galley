# 82 例行响过不进已完成

Status: needs-dogfood（2026-10-22 与票 81 一起快进合入 `15fa743b`、`12129063`、`d74d5c4a`；主会话机器验收：看过判断那处与设计文档那一条的 diff，`TZ=UTC cargo test --workspace` 1220 条全过；`DoneRow` 画例行的那一支由已完成定档票删）

来源：[主聊天 PRD](../PRD.md) 裁决 129 第 3 条（2026-10-22；JC：「按你的推荐推进」）。只改 Core 一处判断、它的注释与测试，加设计文档一行。

## 为什么

- 面板「已完成」现在收四种：勾掉的待办、送到的一次性提醒、交回来的子任务，还有**例行的最近一次响过**（`core/src/assistant_todo.rs` 构建分组时 `let counts = (fired_once || !once) && !task.is_review();`，`:652-656` 一带；模块注释 `:26-38` 写着「a routine's last fire」「A routine can be in two」）。
- 每天一次的例行因此一直在已完成里占一行，例行越多，已完成越长，永远消不掉。巡看已经因「它自己什么也没替你办成」被排除（票 73）。
- 裁决 128 的定义：已完成是办完了的承诺。例行响一次没有办完什么，承诺本身还在「例行」组里；响过的那一次，它被叫醒时已经在对话里说了。

## 要做的

1. **判断**：只有一次性任务（不挂在待办上的）按时响过才进已完成；例行（不论 target、不论是不是巡看）一律不进。例行照旧在「例行」组里，下次时刻照旧。
2. **注释**：模块注释里「Done」那条与「A routine can be in two」那句、`AssistantTodo::done` 字段注释、这处判断旁的注释，改成现在的规则，写上依据（裁决 129 第 3 条；巡看那半句并进去，不再单列）。
3. **影响面核对**（只读，回报里写结论）：
   - `managed_prompt.rs` 的「In Hand」块不印已完成（`in_hand_section`），应当不受影响；
   - CLI `todo list` 与 socket 走 `todo_list`（待办本身），不读这组分组，Agent API 不变；
   - 票 81 的巡看判据不看已完成；
   - grep `.scratch/main-chat/entry-layer-eval/`、`.scratch/assistant/closed-loop-snapshot.py` 有没有镜像这组分组的地方，有就跟着改，没有写「无」。
4. **设计文档一行**：`docs/design/conversation.md`「待办面板」的「已完成」那一条（「近 7 天，默认收起……子任务、提醒、例行用它们的图标……」）改成已完成只收勾掉的待办、送到的一次性提醒、交回来的子任务，例行响过不进（注「2026-10-22，票 82，裁决 129」）。票 80 改的是这一节别的几条，你先 rebase 到 main（票 80 可能已合入），只动这一条。GUI 代码不动（`DoneRow` 里画例行的那一支变成走不到，由已完成的定档票删）。
5. **测试**：每天的例行今天响过 → 不在已完成、在例行；每周的例行同理；一次性提醒响过 → 在已完成（照旧）；巡看 → 不在已完成（照旧）；暂停的例行照旧。原有断言「例行在两处」的测试按新规则改，覆盖的情形都留着。跑完整套后再在 `TZ=UTC`、`TZ=America/Los_Angeles` 下各跑一遍。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- 已完成的 7 天窗口、50 件上限、排序；其余分组；「In Hand」块；CLI 与 Agent API。
- `gui/` 代码；设计文档里除第 4 条那一条以外的内容。
- `core/` 不是 rustfmt-clean：只对改过的文件 `rustfmt --check`。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push、不合入 main。

## 验证

- `cargo test --manifest-path core/Cargo.toml --workspace`，再在 `TZ=UTC`、`TZ=America/Los_Angeles` 下各跑一遍。
- 改过的文件 `rustfmt --check`，`git diff --check`。
- 设计文档新增行中文全角标点。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 判断那处的 diff 原样。
3. 第 3 条的核对结论。
4. 验证命令与结果原样。
5. 看到但没改的问题。

## 给 JC 的真机步骤

合入后 dev 重启 Core。现在库里只有巡看一条例行，面板上看不出差别；以后让它设一个每天的提醒（「每天晚上 10 点提醒我关电脑」），响过以后，「已完成」里没有它，「例行」里那一行照旧写下次时刻。

## Comments

### 2026-10-22 实现回报（票 82 代理，接着票 81 做）

- **提交**（分支 `ticket-81-review-gate`，先 `git rebase main` 干净叠上票 80、裁决 128 第 9 条与裁决 129；未 push、未合入）：`f3fdc3fe` Core、测试与设计文档一条；`be47559a` 评测文字（主会话让顺带修的票 81 第 1 条）；本条回报另一个提交。票 81 的三个提交 rebase 后是 `0a443a40`、`620c0748`、`e3b2399c`。
- **判断**：`core/src/assistant_todo.rs` 构建分组时，`let counts = (fired_once || !once) && !task.is_review();` 改为 `let counts = fired_once && !task.is_review();`。只剩不挂在待办上、按时响过的一次性任务（两种 target）进已完成；例行不论 target、不论是不是巡看都不进，照旧在「例行」里写下次时刻（暂停的照旧排后、不写时刻）。`!task.is_review()` 留着，只为一种边角：有人用 `schedule update` 把巡看改成一次性，响过以后照票 73 的理由也不进；注释里把它并进了同一句，不再单列一条规则。
- **注释**：模块注释「Done」一条改为只收三种、例行的响过不在这里（巡看并进去），写上裁决 129 第 3 条与「已完成是办完了的承诺」；「A routine can be in two」改为「A routine is in routine alone, however often it has fired」；`AssistantTodo::done` 字段注释写出三种；判断旁的注释重写；`TodoState::Fired` 的注释原来也写着「a routine's last run」，一并改了。
- **影响面核对**（只读）：
  - 「In Hand」块：`in_hand_section`（`managed_prompt.rs:560` 起）只读 `yours`、`assistant`、`routine`，判空也只看这三组，不印已完成：不受影响。
  - CLI `todo list` 与 socket `todo.list` 走 `todo_list`，它调 `build_todo(&todos, &[], &[], …)` 只为给你的事排序，不带任务：不受影响，Agent API 不变。
  - 票 81 的巡看判据 `review_has_something_to_look_at` 只看 `yours` 与 `assistant`：不受影响。
  - 读已完成的只有面板（Tauri `list_assistant_todo`，`commands/schedule.rs:154`）。
  - `.scratch/main-chat/entry-layer-eval/`：`run.py` 的「In Hand」移植同 Rust 不写已完成，假 CLI 的 `todo list` 读待办本身，`:627` 一带的「一次性响过」是 `schedule list` 的移植，不是分组：无镜像，没改。`.scratch/assistant/closed-loop-snapshot.py`：不读这组分组：无。
- **设计文档**：`docs/design/conversation.md`「待办面板」只改「已完成」那一条：加「只收三种：你勾掉的待办、它的一次性提醒送到了、子任务交回来了；例行响过不进（2026-10-22，票 82，裁决 129 第 3 条……；巡看早在票 73 就不进）」，后面「子任务、提醒、例行用它们的图标」去掉「例行」。「开机自启提示」与分组那几条没碰。GUI 代码没动。
- **测试**：单测 `a_routine_and_its_last_run`（原来断言例行同时在例行与已完成）改为 `a_routine_that_fired_stays_in_routine_and_a_one_off_is_done`：每天的（今天响过、开会话、带运行会话）、每周的（叫醒助理、一小时前响过）、暂停的（昨天响过）、半个月前响过的、巡看（今早响过）都只在例行、状态与下次时刻照旧，已完成里只有一件按时响过的开会话一次性任务，带着它那次运行的会话、建的人是用户（原测试的 `run_session_id` 与 `created_by` 覆盖挪到了它身上）。`schedule_wake_test.rs` 新增端到端 `a_routine_that_fired_stays_out_of_done`：每天的例行经 `fire_reminder` 响过、它自己的一次性提醒睡过头后经调度器响过，已完成只有那个提醒，例行那一行的时刻是任务的下次时刻。一次性提醒响过进已完成（`a_fired_one_off_is_done_within_seven_days`）、巡看不进（`schedule_wake_test` 两处）、7 天窗口与 50 件上限（`done_mixes_kinds_newest_first_and_is_capped`）的原有测试没动、照旧过。
- **评测文字**（主会话第 3 条）：README 票 73 一节 `review-nothing-to-do` 的说明后加「票 81 起按新判据，真机上这一种巡看会跳过、不叫醒，用例测的是醒了以后」；票 78 一节「（巡看因此不跳过）」改为「（票 78 时它让巡看不跳过；票 81 起它不再让巡看醒，真机上要出现这一种合并叫醒，得是巡看到点时子任务还没结束、让巡看醒了，回报随后赶进同一次叫醒）」；票 81 一节那条改成说明这两处已改。`todo/cases.json` 里这条的 `expect_text` 加同一句，`todo/results.md` 用 `--render-only` 重出。没重跑模型，用例的输入与判定没动，`--dry-test` 560 项 PASS、0 项 FAIL。
- **验证**：`cargo check --manifest-path core/Cargo.toml --workspace` rc=0；`cargo test --manifest-path core/Cargo.toml --workspace` 本机时区、`TZ=UTC`、`TZ=America/Los_Angeles` 各一遍，都是 45 个测试二进制、1220 过、0 失败（`galley_core_lib` 578、`schedule_wake_test` 23）；`rustfmt --check`（`assistant_todo.rs`、`schedule_wake_test.rs`）rc=0；`git diff --check` rc=0；设计文档新增行全角标点扫过，0 处。

### 看到但没改的

1. `gui/` 的 `DoneRow`（`TodoPanel.tsx:678`）画例行的那一支现在走不到，票面说由已完成的定档票删。GUI 的类型镜像 `gui/src/lib/assistant-todo.ts` 看过，注释没写例行会进已完成，不用跟着改。
2. `--render-only` 重出 `todo/results.md` 时，票 81 那六遍的「读手册字节」各少 49：运行当时 `render` 是在把沙盒路径换成 `$TMPDIR` 之前算的字节，重出是按存下来的（已换过的）结果算，后者可以复现。是 `run.py` 原有的小出入，没改脚本。
3. 已完成里一次性任务的「按时响过」沿用 `once_fired`（`last_fired_at >= fire_at`）：一次性任务被手动提前跑过一次、后来又按时响了，只算按时那次，这是原有行为，没动。
4. 没跑 `tauri dev`，真机步骤没走。
