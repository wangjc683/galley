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
