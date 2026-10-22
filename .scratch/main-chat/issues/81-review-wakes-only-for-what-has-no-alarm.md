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

### 2026-10-22 实现回报（票 81 代理）

- **提交**（分支 `ticket-81-review-gate`，未 push、未合入）：`b1993689` Core、测试、手册、现行文档与快照脚本；`a74b2a30` 评测结果与 README 一节；本条回报另一个提交。
- **新判据**：`AssistantTodo::review_has_something_to_look_at(today: NaiveDate)`（`core/src/assistant_todo.rs`），只在 `fire_review` 用；`anything_in_hand` 没有别的调用方，删掉了。算的：你的事里没有截止的（随时），或截止日不晚于 `today` 加 `REVIEW_LOOKAHEAD_DAYS` 的（今天、逾期、挂没挂提醒都算；有时刻的按 `due.date` 那天，即构建清单时读的那个时区）；「Galley 在办」里 `kind == Subtask` 的（在跑、在问、出错、停在步数上限、没跑完）。不算：更远的你的事、它自己的一次性任务（`kind == Task`，两种 target）、例行、已完成。`due.date` 读不出来时当作要醒（Core 不会写出这样的值）。`REVIEW_LOOKAHEAD_DAYS = 3` 是 `assistant_todo.rs` 里的公开常量，注释写了裁决 128 第 4 条、试用到 10-28 再看、与 `todos.md` 的「ahead when there is something to get ready」对上。
- **`fire_review`**：`today` 取 `now` 换到 `chrono::Local` 的日子（`assistant_todo` 构建清单用的就是 `chrono::Local`），判断本身只吃传进来的 `today`，单测里用 UTC、上海、洛杉矶各自的日子。读失败照旧醒，日志改成 `reading the to-do list failed, waking it`。跳过时的日志：`[scheduler] review {id}: nothing to look at (no to-do any time or due within 3 days, no unfinished subtask), skipped`（3 来自常量）。模块注释、`ReviewEvent::Skipped`、`ReviewEvent::Run`、`ReviewFire::Skipped`、`fire_review` 的文档注释改成新判据的说法；`REVIEW_PROMPT`、`review_paragraph`、`in_hand_section`、清单的分组排序都没动。
- **手册**：`wake.md` 第一段末尾改为「Galley made this task, not you, and skips the morning when there is nothing to look at (what is due further off and your own reminders come up at their own time); when it wakes you, go over everything in hand.」；`todos.md` 的 `--notes` 一条原句保留，后面补「The user sees the notes under the to-do in their list: write them for the user, in their language (「A 座 3 楼，带身份证」), without the title or the day again, and not as a record about them (「用户说……」).」。反例没用票面的「JC 告知：……」，改成评测里旧手册下真出现过的「用户说……」，免得手册里带出真实用户的名字。`assistant_manual.rs` 两组断言各加了新句子（单行片段），`.md` 交叉引用数没变（仍是 18）。
- **字节预算**：手册没有字节预算。`core/` 里的预算常量只管进提示词的部分（`STATIC_PROMPT_BUDGET_BYTES`、`MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`、`MAIN_CHAT_SECTION_BUDGET_BYTES`、`IN_HAND_BUDGET_BYTES`、`IM_PROMPT_BUDGET_BYTES`），手册是按需读的文件，这次提示词一字没变，所以没有常量要改、`prompt-composition.md` 的条款台账也不用加行。两处手册改动合计 +363 字节（`todos.md` 6865 → 7097，+232；`wake.md` 4151 → 4282，+131；九个部分合计 26693 → 27056）。
- **测试**：`assistant_todo.rs` 新增两条纯函数测试：只有远期待办（挂提醒的 11-20、不挂的今天加 4 天、今天加 4 天零点）、它自己的一次性任务（target assistant 与 session）、例行（含巡看本身）、已完成的待办与子任务 → 不醒；在此之上任加一件今天加 3 天（只有日期、当天 23:59）、今天加 2 天挂提醒、今天、逾期（日期、时刻）、随时 → 醒，单独一件也醒；在跑、出错、在问、没跑完的子任务各一 → 醒；7 天没动、不在清单里的旧子任务 → 不醒。时区：同一时刻的截止在上海是加 4 天、在洛杉矶是加 3 天，一醒一不醒；同一时刻上海已是第二天，日期型截止在上海算加 3 天、洛杉矶算加 4 天。`schedule_wake_test.rs`：`with_nothing_to_look_at_the_review_wakes_nobody`（原 `with_nothing_in_hand…`，加了 702 那样的远期待办挂提醒、加 4 天不挂、它自己的喝水提醒、一个开会话的一次性任务，照旧跳过，清单里这几件都还在）；`with_something_to_look_at_the_review_wakes_the_main_chat`（随时的那件照旧醒；加 3 天挂与不挂、今天、逾期 2 天醒，加 4 天挂与不挂不醒，加 3 天 23:59 醒；原来「它自己的一次性提醒也算在办」那段改成只有它不醒）；新增 `a_review_that_cannot_read_the_list_wakes_the_main_chat`（把 `todos` 表改名让读失败，照旧醒、记 `woke`）。原来靠一个十分钟后的提醒让巡看醒的四处（投递不到、runner 起不来、这一轮出错、外置运行时）改成一件随时的待办，覆盖的情形都留着。
- **快照脚本**：`.scratch/assistant/closed-loop-snapshot.py` 文档串与输出里的「skipped (nothing in hand)」改为「skipped (nothing to look at)」，文档串写明票 81 起的判据；只读日志，没加逻辑。
- **评测**：`run.py` 没有巡看判据的镜像（巡看用例直接拼到点的叫醒），手册目录照旧整套拷进状态根，`--dry-test` 560 项 PASS、0 项 FAIL，结尾 `DRY TEST PASSED`，`managed-ga/` 下没有 `__pycache__`。待办套件能走到 `todo add`，挑了六条（`reno-asked`、`flight-wed`、`hospital-tomorrow`、`half-done`、`lease-expiry`、`meeting-3pm`）各跑第 1 遍，`--model-id mm_1792576875658`，6 次运行、24 次模型调用，六遍都过；用 `--supersede` 合并，被替换的旧第 1 遍在 `meta.superseded_runs[10]`。备注原文：
  - `reno-asked`：「预计完工，届时确认实际进度。」
  - `flight-wed`：「早上的航班。出发前核对机场、航站楼和起飞时间，准备有效身份证件，查看值机安排并安排去机场的交通；航班号和具体起飞时间尚未提供。」
  - `hospital-tomorrow`：「准备身份证、医保卡、既往检查报告和用药清单；核对预约时间、院区及医生告知的检查准备要求，是否空腹按医嘱。」
  - `half-done`：「接着核实两台 ECS 实例的实际发起人，以及 OSS 外网下行流量对应的桶和业务。此前对话中的待核实线索：10 月 9 日、子账号 deploy-bot；需回到操作审计与账单明细验证。」
  - `lease-expiry`：「先核对合同里的续租、退租提前通知期限及自动续约条款，再决定续租或搬迁；到期日按“3月底”暂记，具体以合同为准。」
  - `meeting-3pm`：这一遍没写 `--notes`。
  旧手册下这六条的第 1 遍，四条以「用户说」「用户先吃饭」开头，两条复述了标题与日子；这一次一条都没有。README 加了「备注写给用户看（票 81）」一节。
- **对真实数据核对**（`sqlite3 … ".backup"` 到 worktree 之外的临时目录，不提交的临时测试按 `assistant_todo` 读备份，`RunnerManager::new()`，跑完删掉测试与备份）：今天 2026-10-22；你的事今天 0、以后 1（29 天后到期、挂着提醒）、随时 0；Galley 在办：子任务 0、它自己的任务 0；例行 1；已完成 3。原判据（有没有在办的）为真，新判据为假：不醒。
- **文档**：`docs/managed-ga-runtime/runtime-modes-and-sessions.md` 的「The morning review」一条改成新判据。`docs/` 里别处（`prompt-composition.md`、`agent-api/schedule-commands.md`、`managed-ga-runtime/README.md`）只说巡看是什么、没写判据，没动；devlog、PRD、`docs/project-status.md`、`docs/design/` 没动。

### 看到但没改、没验证到的

1. 评测的 `review-nothing-to-do`（只有 11 月 20 日的装修待办、挂着提醒）按新判据在真机上不会再醒，这条用例现在测的是「醒了以后」；README 票 78 一节「在办的另有 11 月 20 号的装修待办（巡看因此不跳过）」也不再成立。用例和那段旧文字都没改，新的一节里写明了。
2. 只重跑了六条的第 1 遍，第 2 遍仍是旧手册的结果；别的会写备注的用例（`note-report`、`school-monday`、`shanghai-trip`、`report-half`、`hotpot-asked` 等）没重跑。`flight-wed`、`half-done` 的备注还留着「尚未提供」「此前对话中的」这类给它自己看的字眼，`lease-expiry` 用的是弯引号“”；手册没再为这些加字，要不要再收由主会话定。
3. 快照脚本的跳过次数按日志累计，合入之前的跳过是旧判据下的，没有按日期分开。
4. 7 天没动、不在跑的子任务不在「Galley 在办」里（`RECENT_WINDOW_DAYS`），也就不让巡看醒：判据跟着清单走，没另算。
5. `fire_review` 对 `now` 是泛型时区，但「今天」固定按 `chrono::Local` 取，与 `assistant_todo` 构建清单的时区一致；生产里调用方传的就是 `Local`，测试里也是。
6. 没跑 `tauri dev`，真机三步没走；真模型只跑了上面 6 次运行。
