# 81 巡看只为没有自己闹钟的事醒；手册：备注写给用户看

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 128 第 4 条与第 5 条的手册那句（2026-10-22，从底层捋一遍待办；JC：「按你的推荐推进」）；改写 [助手 PRD](../../assistant/PRD.md) 裁决 10「确定式的部分」的叫醒判据。只改 Core、手册与评测。与票 80（GUI 待办面板、设计文档）同时在跑，不碰同一处。依赖票 73、78（都已合入 main）。

## 为什么

- 巡看叫醒前的判据是 `AssistantTodo::anything_in_hand`（`core/src/assistant_todo.rs:150`）：用户有没勾掉的事，或 Galley 有在办的事（`assistant` 组：没结束的子任务，加它自己还没响的一次性提醒）。唯一调用方是 `fire_review`（`core/src/scheduler.rs:445`）。
- 它几乎每天都成立。库里现在只有一件没做完的事：702 装修（11-20 到期、挂着 11-20 09:00 的提醒），它就让巡看从 10-22 起天天醒，至少醒到 11-20；10-22 早上那一轮读了三遍清单与记录，最后 `<no-reply/>`，一个字没说。
- Galley 自己的一次性提醒到点会自己叫醒它，巡看替它天天多醒没有用；远期的事有提醒管着，没提醒的也要临近截止才有可准备的。
- 裁决 128 定的原则：**巡看只为没有自己闹钟的事醒**。醒了以后它照旧过一遍全部在办的事，改的只是醒不醒。
- 备注：手册让它在 `--notes` 里写「到时要用的东西」（`docs/managed-ga-runtime/galley-assistant-manual/todos.md:107-109`），原来只有它自己在提醒响时读到。票 80 起面板会把备注显示给用户。库里 702 那条备注是「JC 告知：702 办公室装修预计于 2026 年 11 月 20 日完工；当天确认实际完工情况，日期为预计而非已确认。」：第三人称、复述了标题与日子，显示出来像一份内部记录。

## 要做的

1. **新判据**：把 `anything_in_hand` 换成巡看专用的判断（名字你定，如 `review_has_something_to_look_at`），只在 `fire_review` 用。算的（任一样就醒）：
   - 你的事里「随时」组（没有截止）的任何一件；
   - 你的事里截止日不晚于「今天加 3 天」的任何一件，含今天到期与逾期（不论挂没挂提醒）。「今天」与截止日用同一个时区读，即构建清单时读 `due.date` 的那个时区（`build_todo` 的 `Tz`，生产里是 `chrono::Local`）；有时刻的待办按它那天算（截止在今天加 3 天的 23:59 也算）。3 天写成一个命名常量，注释写依据（裁决 128 第 4 条：主会话定的数，试用到 10-28 再看；够它提前准备，与手册「该提前的提前」对上）。
   - `assistant` 组里的子任务（`kind == Subtask`，即没结束的：在跑、在问、出错、停在步数上限、没跑完）。
   不算：截止日在今天加 3 天之后的你的事、`assistant` 组里它自己的一次性任务（`kind == Task`，不论 target）、例行、已完成。读失败照旧当作要醒（「一轮多醒好过从不巡看」）。
   - 判断要能脱开 `chrono::Local` 测：给它传进「今天」（或 `now` 与时区），别在里面读本机时区。
   - `anything_in_hand` 没有别的调用方就删掉；文档注释与 `fire_review`、`ReviewFire::Skipped`、`scheduler.rs` 模块注释（`:67`、`:164`、`:412`、`:474` 一带）里「nothing in hand」的说法改成新判据的说法。日志那句改成说清是「没有要巡看的」（措辞你定，回报里原样给出）。
2. **快照脚本**：`.scratch/assistant/closed-loop-snapshot.py` 里「skipped (nothing in hand)」的说法（`:13`、`:240`）跟着改成新判据的说法；它只读日志，不重算判据，别加逻辑。
3. **手册**（`docs/managed-ga-runtime/galley-assistant-manual/`）：
   - `wake.md:57`「skips the morning when nothing is in hand」改成如实的说法：没有要看的（远期的事、它自己的提醒有自己的叫醒）就跳过；醒了照旧过一遍全部在办的事。一句话，措辞你定。
   - `todos.md` 的 `--notes` 那一条（`:107-109`）补一句：用户在待办清单里那件事下面看得到备注，写给用户看，用用户的语言，不复述标题与日子，不写成关于用户的第三人称记录（例子照手册的写法：中文用户给中文例子，如「A 座 3 楼，带身份证」，不是「JC 告知：……」）。原来那半句（到时要用的东西、它会带着标题与备注叫醒你）保留。
   - 手册的字节预算、`core/src/assistant_manual.rs` 里断言条文的测试（如 `:490-500` 那组）按改动更新；预算加了多少写进常量注释与回报，照现有记账写法。
4. **评测**（`.scratch/main-chat/entry-layer-eval/`）：
   - `--dry-test` 要过（手册改了，若评测有手册或叫醒的镜像，照 README 的做法更新）。
   - 待办套件（`todo/`）若能走到 `todo add` 那一步（看 `run.py` 怎么模拟读手册），挑会写备注的用例（带地点、人名、号码的那几条），用 `--model-id mm_1792576875658`（API key 接入的 gpt-6.1-sol）各跑一遍，最多 6 次真调用；回报每条的 `--notes` 原文，看是不是写给用户看的。走不到那一步就只跑 `--dry-test`，回报里写明。结果文件按 README 的合并做法写回，结果里不写服务商名、域名。
5. **对真实数据核对**：`sqlite3 ~/Library/Application\ Support/app.galley/workbench.db ".backup <worktree 之外的临时目录>/wb.db"`，用不提交的临时测试按 `assistant_todo` 的读法读备份（`runners` 用空的或不在跑的状态），算出今天新判据的结果：应当是不醒（只有 702，截止 11-20）。回报只写各组件数与判断结果，不写内容。跑完删掉临时测试与备份。
6. **测试**：只有远期待办（挂提醒与不挂）→ 不醒；截止在今天加 3 天（只有日期、有时刻在当天晚上）→ 醒；今天加 4 天 → 不醒；今天到期、逾期 → 醒；随时的一件 → 醒；只有它自己的一次性提醒（target assistant 与 session 各一）→ 不醒；有一个没结束的子任务（在跑、出错各一）→ 醒；只有例行（含巡看本身）→ 不醒；读失败 → 醒（原有测试若有，保留）。原有巡看测试按新判据调整，覆盖的情形都留着。时区：跑完整套之后再在 `TZ=UTC` 与 `TZ=America/Los_Angeles` 下各跑一遍（CI 跑在 UTC；日期边界最容易在这里错）。
7. **文档**：grep `docs/`（devlog、PRD 原文与 `docs/project-status.md` 的历史不动）里描述巡看判据的现行说法（「nothing in hand」「没有在办的事就不叫醒」「没有没结束的事」之类），改成新判据，比如 `docs/managed-ga-runtime/` 下讲巡看的那份。改了哪些文件写进回报。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`；JC 的数据库只读，只经备份读。
- 「在办的事」那一块（`core/src/managed_prompt.rs` 的 `in_hand_section`）与面板读的 `assistant_todo` 分组、排序、内容：都不变；改的只是巡看醒不醒。
- 巡看的时刻、种子、补发、每天的上限、叫醒说明（`REVIEW_PROMPT`）、合并叫醒。
- `gui/`、`cli/`、`runner/`、`managed-ga/`；`docs/design/`（票 80 在改）。
- 手册里与这两句无关的条文。
- `core/` 不是 rustfmt-clean：只对改过的文件 `rustfmt --check`，别跑 `cargo fmt --all`。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。提交前 grep 新增行，不能有本机路径、会话 id、本机真实数据、私有接口地址。

## 验证

- `cargo check --manifest-path core/Cargo.toml --workspace`
- `cargo test --manifest-path core/Cargo.toml --workspace`，再在 `TZ=UTC`、`TZ=America/Los_Angeles` 下各跑一遍。
- 改过的文件 `rustfmt --check`，`git diff --check`。
- 评测 `--dry-test` 全过（命令照 README：`PYTHONDONTWRITEBYTECODE=1` 与它点名的解释器）。
- 中文全角标点（手册里的中文例子、文档新增行）。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 新判断函数、`fire_review` 那段的 diff 原样；日志新措辞原样。
3. 手册两处的新原文、预算变化。
4. 评测：`--dry-test` 结果；跑了真模型的话每条的 `--notes` 原文。
5. 第 5 条真实数据的核对结果（件数与判断）。
6. 改了哪些文档。
7. 验证命令与结果原样。
8. 看到但没改的问题、没验证到的地方。

## 给 JC 的真机步骤

1. 合入后 dev 重启 Core。明天早上巡看的时刻过后，看 dev 日志：应当是跳过（只有 702，离截止还远），主对话里没有新的一轮。
2. 跟它说一件今天往后三天内要办的事（比如「后天下午要把报价发给客户」），第二天早上巡看应当醒；它开不开口照旧由它判断。
3. 让它记一件带地点或人名的事（比如「下周三下午 3 点去 A 座 3 楼面试，记得带身份证」），打开待办面板（票 80 合入后）：那件事下面的备注是写给你看的一句，不复述标题与日子。

## Comments
