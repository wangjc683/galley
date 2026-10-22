# 79 新段带最近 10 轮、15,000 字；一句话都没说的叫醒轮次不占名额；状态块写起止时间

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 127（2026-10-22。旁路代理指出票 77 修好后，今早 9 点那一段带过去的 3 轮里有 2 轮是叫醒，JC 问 NBA 的原话一轮都没带上；JC：「最近 3 轮，我现在感觉是不是太少了？」主会话推荐 A 加 C，JC：「A + C，但是上限到 10 轮」，主会话补上 15,000 字与状态块写起止时间两个条件，JC：「定了，推进」）。只改 Core 与评测移植。依赖票 77（已合入 `e3767d1f`）。与在跑的票 78（`scheduler.rs`、`db/schedule.rs`、`subtask_report.rs`、`wake.md`、评测待办套件）不碰同一处；评测目录两张票都动，你只改 `run.py` 里主对话状态块那段移植与 `rust-samples.json` 里对应的样本。

## 为什么

- 裁决 50 定 3 轮，理由是「5 轮 1 万字多数时候用不上」，那是按 `turn_index` 配对量出来的（一轮中位 127 字）。票 77 改成按用户的一句分以后，一轮中位 759 字、p90 2,464。
- 3 轮里叫醒也占名额。今早 9 点那一段（段首 37）带过去的是 27→30（JC 的话）、31→33（巡看叫醒，只派了子任务，`<no-reply/>`）、34→36（NBA 子任务回报叫醒）。31→33 对 JC 是看不见的（票 76 后什么都不画），却占了一轮。
- JC 用主对话一天几句：主对话至今看得见的只有 9 轮，3 轮只往回接半天（中位 0.5 天），10 轮接得上这一周。
- 主会话 10-22 只读量本机（叫醒静默轮已去掉）：所有会话连续 10 轮的字数中位 10,808、p90 13,796、p95 14,188，装进 12,000 的 64%、15,000 的 98%（样本 44 个窗口）。

## 要做的

1. **常量**：`CARRY_TURNS` 3 → 10，`CARRY_MAX_CHARS` 8,000 → 15,000（`core/src/session_runner/carry.rs`）。常量注释改成上面的依据（裁决 127；连续 10 轮的字数中位、p95、15,000 装下 98%）。
2. **一句话都没说的叫醒轮次不算一轮**：开头是叫醒行（用户行 `created_via = 'system'`、`supervisor = 'galley-report'`），并且这一轮在下一句用户行之前的最后一行助理行是静默回复（最终回答为空、内容带 `no-reply`，与 `core/src/db/search.rs:8-13` 同一口径），这一轮整轮不带、不占名额。提问了用户的叫醒轮（下一句用户行是对提问的回答）不是静默轮，照常算。`from_rows` 与 `main_chat_carry_from`（`core/src/db/main_chat.rs`）用同一个定义，注释互相指向；`ReplayRow` 需要的字段（`created_via`、`supervisor`、`final_answer` 之类）从 `PersistedMessageRow` 带过来，问候的判定照旧。
3. **状态块写起止时间**：`core/src/managed_prompt.rs` 的 `main_chat_section`（`:275` 一带）带过去 2 轮及以上时，把「opens with {exchanges} from before it, the last said {at}」改成说清第一轮与最后一轮各是什么时候说的（如「…from before it, said between {first} and {last}: time has passed since.」，措辞你定，回报里原样给出）；只带 1 轮时一字不动。`CarriedWindow` 加取第一轮时间的方法，`MainChatPromptState` 的 carried 部分跟着加字段，时间格式与现有 `{at}` 相同。
4. **评测移植**（`.scratch/main-chat/entry-layer-eval/`）：`run.py` 里主对话状态块的 Python 移植照新措辞改，按 README 的做法用临时 Rust 测试生成 `rust-samples.json` 里 2 轮以上的新样本（临时测试跑完删掉，不提交）；`--dry-test` 的逐字对照要过。现有两条带过去 1 轮的用例措辞不变，不跑真模型。
5. **对真实数据核对**：同票 77 第 5 条的做法（`sqlite3 … ".backup"` 到 worktree 之外的临时目录，不提交的临时测试按 `carry::read` 的步骤算），对主对话（`sessions.main_chat = 1`）段首 27 与 37 算出新窗口：回报每轮的用户行号、最后一行助理行号、字数、是否叫醒，确认段首 37 的窗口里有第 13、21 轮（NBA 两问）、没有 31→33。跑完删掉，只回报号与字数，不回报内容。
6. **测试**：补静默叫醒轮不带不占名额（单个、连续几个、夹在两句之间）、提问了用户的叫醒轮照常带、说了话的叫醒轮照常带、10 轮与 15,000 字的边界、`main_chat_carry_from` 跳过静默叫醒轮后起点正确、状态块 1 轮与多轮两种措辞。原有测试按新常量调整（按常量写，别写死数字），覆盖的情形都留着。
7. **文档**：`docs/ipc-protocol.md`、`docs/managed-ga-runtime/runtime-modes-and-sessions.md` 里票 77 刚改成「3 轮、8,000 字」的现行描述，改成 10 轮、15,000 字并写上静默叫醒轮不算。历史记录（裁决原文、devlog、`docs/project-status.md`）不动。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`；JC 的数据库只读，只经备份读。
- 段的规则（空闲小时数、边界记录）、重放 `rows_to_conversation_messages`、截断的分法（保底一半、回复留结尾）、入口层。
- `scheduler.rs`、`db/schedule.rs`、`subtask_report.rs`、手册（票 78 在改）；`gui/`、`runner/`、`cli/`、`managed-ga/`。
- `core/` 不是 rustfmt-clean：只对改过的文件 `rustfmt --check`。
- 提交只点名文件，`git add … && git commit …`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。提交前 grep 新增行，不能有本机路径、会话 id、本机真实数据。

## 验证

- `cargo check --manifest-path core/Cargo.toml --workspace`
- `cargo test --manifest-path core/Cargo.toml --workspace`，再在 `TZ=UTC` 下跑一遍。
- 改过的文件 `rustfmt --check`，`git diff --check`。
- 评测 `--dry-test` 全过。
- 中文全角标点。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. `from_rows`、`main_chat_carry_from`、`main_chat_section` 的 diff 原样，状态块新措辞原样。
3. 第 5 条的核对结果（只有号、字数、是否叫醒）。
4. 验证命令与结果原样。
5. 看到但没改的问题、没验证到的地方。

## 给 JC 的真机步骤

1. 合入后 dev 重启 Core。等到下一次开新段（闲置 4 小时以上再开口，或第二天早上巡看）。
2. 问它「我这周问过你哪些球队的事？」或「前天我们聊到哪了？」：它应当不用去查历史就答得上来这几天主对话里说过的事，并且分得清是哪天说的。
3. 早上的巡看不再把已经答完的事当成没答。

## Comments

### 2026-10-22 实现回报（票 79 代理）

- **提交**（分支 `ticket-79-carry-ten-turns`，未 push、未合入）：`61ff90d3` Core、测试与三处文档；`5a531c85` 评测移植与样本；本条回报另一个提交。
- **常量**：`CARRY_TURNS` 3 → 10，`CARRY_MAX_CHARS` 8,000 → 15,000，常量注释写上裁决 127 与连续 10 轮的量数（44 个窗口，中位 10,808、p90 13,796、p95 14,188；15,000 装下 98%，12,000 只装下 64%）。
- **静默叫醒轮**：判定写成一处 `db::is_main_chat_silent_reply`，与 `db/search.rs` 的 `HIDDEN_FROM_GUI_SEARCH` 同一口径，并照 SQLite 那里的读法（`TRIM` 只去空格，`LIKE` 不分 ASCII 大小写）。`ReplayRow` 从 `PersistedMessageRow` 带上 `created_via`、`supervisor`、`final_answer`（都是 `serde(default)`，回放的金样本不受影响），加 `is_wake()`（`Origin::is_stored_subtask_report`）与 `is_silent_reply()`；问候照旧走 `shown_only`。`from_rows` 记下一轮是不是叫醒行开头、它最后一行助理行是不是静默回复，两样都是就整轮不带、不占名额。`main_chat_carry_from` 的 SQL 加同一条件：叫醒行开头，且它之后、下一句用户行之前（也在段首之前）的最后一行非问候助理行是静默回复，就不算一轮。两处注释互相指向。问了用户的叫醒轮，最后一行助理行是那句提问，不静默，照常算，没有另做特例；说了话的叫醒轮（包括「已转告。<no-reply/>」这种有正文的）照常算。
- **状态块**：只带 1 轮时一字不动；2 轮及以上，第三行改为 `with {k} exchanges from before it, said between {first} and {last}: time has passed`，下一行照旧 `since. Anything older …`。第一轮的时间取它最后一行助理行的 `created_at`（与最后一轮同一口径，本地时间到分钟）。新增 `CarriedWindow::first_said_at()`、`CarriedPromptState::first_said_at`。`MAIN_CHAT_SECTION_BUDGET_BYTES` 421 → 442（时间段 +20，十轮的第二位数字 +1），依据写进常量注释，`prompt-composition.md` 的条款台账加了一行。
- **评测**：`run.py` 原来没有主对话状态块的移植（两个套件都直接读 Rust 写出的 `main_chat.carried-N.txt` 模板），这次新写了 `main_chat_carried_section`（照 `main_chat_section` 的带轮次写法，1 到 `CARRY_TURNS` 轮）。带过来的用例一律读 carried-1 模板，把那一节换成移植写出的 N 轮写法：1 轮时替换前后逐字相同，模板里找不到移植写出的 1 轮原文就报错退出。第一轮的时间来自可选字段 `first_hours_ago`（默认同 `hours_ago`）。`schedule/rust-samples.json` 加了新键 `main_chat_section`：临时 Rust 测试（跑完删掉）用 `main_chat_section` 写出的 1 轮、2 轮、10 轮三条原文。`--dry-test` 新增 6 项检查：三条样本逐字对上、样本覆盖 1、2 和 10 轮、carry-quote 在主套件与 schedule 提示词里和改动前的模板填法逐字相同、拼成 3 轮时两套提示词都写出起止时间。全程只跑 `--dry-test`，没跑真模型。
- **对真实数据核对**（`sqlite3 … ".backup"` 到 worktree 之外的临时目录，用不提交的临时测试直接调用 `carry::read`，跑完删掉测试与备份）：
  - 段首 27：读取起点 0，带 7 轮，合计 6,697 字，没有截断：0→0（2＋85）、1→4（5＋461）、5→8（28＋337）、9→11（63＋420）、12→12（29＋1,723）、13→20（28＋1,876）、21→26（4＋1,636），都不是叫醒。
  - 段首 37：读取起点 0，带 9 轮，合计 8,226 字，没有截断：上面 7 轮原样，加 27→30（12＋297，不是叫醒）、34→36（174＋1,046，叫醒，说了话）；31→33（叫醒，静默）没带。第 13、21 轮（NBA 两问）都在窗口里。
  - 两段之前能带的轮次都不到 10 轮，上限 15,000 字都没碰到。读取各 3～8 毫秒。
- **测试**：`carry.rs` 新增静默叫醒轮不带不占名额（夹在两句之间一个、末尾连着几个、只有静默叫醒时为空、用户自己的一轮以 `<no-reply/>` 收尾照常带）、问了用户的叫醒轮照常带、说了话的叫醒轮照常带（原有的叫醒行测试改成真的带叫醒行来源）、10 轮正好 15,000 字整轮带上而多一个字丢掉最早一轮；原有测试改成按 `CARRY_TURNS`、`CARRY_MAX_CHARS` 写，覆盖的情形都留着。`main_chat_segment_test.rs` 新增三条端到端：静默叫醒轮跳过后 `main_chat_carry_from` 在不同 `turns` 与段首上的起点、开新段后 `load_history` 不含静默叫醒轮而含说了话的叫醒轮；问了用户的叫醒轮带上；只有静默叫醒轮时不带也不回放、状态块没有带轮次的那一句。状态块那条端到端改成核对起止两个时间。`managed_prompt.rs` 的状态块测试分 1 轮（逐行核对与票 11 一字不差）与多轮两种措辞。
- **改了一条原有测试的预期**：`core/tests/subtask_report_test.rs` 的 `a_report_after_an_idle_gap_opens_a_segment_that_carries_the_line` 原来要求新段带上前一条以 `<no-reply/>` 收尾的子任务回报，正是这张票要去掉的行为；改名为 `…_that_leaves_a_silent_one_out`，预期改成只带用户那一轮。只动了这个测试文件，没动 `subtask_report.rs`。
- **文档**：`docs/ipc-protocol.md`、`docs/managed-ga-runtime/runtime-modes-and-sessions.md` 里现行的「3 轮、8,000 字」改成 10 轮、15,000 字，写上静默叫醒轮不算；`runtime-modes-and-sessions.md` 与 `prompt-composition.md` 里状态块的说法改成起止时间（票面只点了前两份，`prompt-composition.md` 有现行措辞原文与「新条款必须加一行」的台账，一并改了）。裁决原文、devlog、`docs/project-status.md` 没动。

### 看到但没改、没验证到的

1. 评测里的 `galley-prompt/main_chat.carried-2.txt`、`carried-3.txt` 现在没人读，里面还是旧措辞；README「文件」一节仍写「`carried-N`……N 为 1 到 3，即 `CARRY_TURNS`」，也没记这次的移植与样本。按票面只动了 `run.py` 移植与样本，删不删、README 补不补由主会话定。
2. 样本放在 `schedule/rust-samples.json` 新键 `main_chat_section`（按键名排序，落在 `lateness_words` 与 `wake` 之间）。票 78 也会动这个文件，若它整份重新写出，合并时要留住这一键。`subtask_report_test.rs` 票 78 也可能在动，合并时留意上面那条测试。
3. `from_rows` 看的是 `mark_replay_rows` 之后的行（`<subtask>` 块已去掉），SQL 看原始 `content`：只有「`no-reply` 字样只出现在 `<subtask>` 派活说明里、答案又为空」时两边判法会不同，后果是读取起点偏晚、窗口少一轮。没有处理。
4. 用户自己的一轮以 `<no-reply/>` 收尾照常算（票面只排除叫醒轮），测试里写明了。
5. 第一轮的时间取它回复写完的时刻，不是用户那句的时刻，与最后一轮同一口径。
6. 没跑 `tauri dev`，真机步骤没走；没跑真模型。
