# 59 助理手册按部分拆成小文件，入口层改成「写之前读要用的那一部分」

Status: ready-for-agent

来源：主聊天 PRD 裁决 111（2026-10-19，JC：「按你推荐推进」）。只改 Core 的手册与入口层、手册源文件、相关文档与入口层评测；GUI、runner、`managed-ga/code`、别的提示词层不动。

## 为什么

- 手册（`docs/managed-ga-runtime/galley-assistant-manual.md`，17.3 KB / 358 行）不在系统提示词里：入口层最后一段只写路径，要模型「第一次 Galley CLI 写之前去读」（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）。
- 实际用量（`workbench.db` 的 `messages.tool_calls`）：主对话 10-17 到 10-19 至少读了 7 次，10-19 的 5 次都在同一段里、两小时内。模型其实已经在按节读（`start=35 / 126 / 180 / 191 / 220`，对应权限、CLI、记一条待办、改待办），但 GA 的 `file_read` 默认一次 200 行（`managed-ga/code/ga.py:455`），每次拖进 140–200 行，约 1.7k–2.4k tokens。7 次合计约 16k 原价输入，约占同期主对话未命中缓存的输入（149k）的一成。
- 重读的原因：GA 每隔几次请求把最近 10 条以外的工具结果截成 800 字（`managed-ga/code/llmcore.py:77`），手册读过就被截掉，下次写之前又得读。这一点不改，改的是每次读进来多少。

## 一、拆法

源文件从一个文件改成一个目录 `docs/managed-ga-runtime/galley-assistant-manual/`，一部分一个文件。Core 照旧在每次主对话启动时整套写进状态根，目标目录是 `assistant/reference/manual/`。

| 文件 | 来自现在的哪几节 | 约 |
|---|---|---|
| `authority.md` | Three levels of authority（含三个小节） | 2.4 KB |
| `cli.md` | The Galley CLI | 3.3 KB |
| `times.md` | To-dos and reminders › Times | 0.45 KB |
| `todos.md` | To-dos and reminders 开头两段 + Noting a to-do | 3.8 KB |
| `todos-change.md` | Changing a to-do, ticking it off, what is left | 1.2 KB |
| `reminders.md` | Your own reminders + When one comes due | 3.3 KB |
| `wake.md` | When Galley wakes you | 1.3 KB |
| `subtasks.md` | Who you are + Checking a result and reporting it + Sessions that are not yours | 1.7 KB |

- **正文不改写**。只动三类地方：
  1. 各部分之间的互相引用改成文件名，例如 `(see "To-dos and reminders")` → `` (see `reminders.md`) ``。已知的有：权限第一段（会花钱的重复任务）、CLI 一节的两处「see "To-dos and reminders"」、Noting 里的 `see "Your own reminders"`、Your own reminders 里的 `see "Noting a to-do"`、When one comes due 里的 `(see below)`。逐处 grep 引号里的节名，别漏。指向系统提示词的引用不改，比如「as your rules on past Galley conversations show」「the "In Hand" lines of your Main Chat section」。
  2. 开头那段（「This manual covers …」）的目录作用交给入口层，删掉。第一句「You are Galley, the user's personal assistant, talking with them in their main chat.」放到 `subtasks.md` 的 Who you are 前面。
  3. 每个文件开头一行标题（例如 `# Galley Assistant Manual: To-dos`），下面一句写明 Galley 每次主对话启动时重写这些文件、不要改。每个文件都写，读到哪个都看得到。
- 小节标题的层级跟着调整（原来的 `###` 在新文件里可以升为 `##`），文字不变。
- 拆完把八个文件按上表顺序拼起来，与原文逐行对比：除上面三类改动，不应有别的差别。回报里附这份对比。

## 二、Core

- `core/src/assistant_manual.rs`：
  - 每个部分一个 `include_str!`，用一张有序表（文件名 → 内容）表示。
  - `manual_path` 改为 `manual_dir`（`<state_root>/assistant/reference/manual`）。
  - `materialize` 把每个部分写进去；删掉目录里不在表上的 `.md`（以后改名不留旧部分）；删掉旧的单个文件 `assistant/reference/galley-assistant-manual.md`（Galley 自己的文件，不是用户状态）。
  - 模块文档照新结构改写，「an update never leaves an old copy behind」这条保留，并由上面两处删除来兑现。
- 原来的测试（`manual_keeps_its_hard_rules`、`manual_spells_commands_as_the_cli_does`、`manual_covers_reminders_and_the_new_hands`、`manual_covers_the_users_to_dos`、`manual_tells_a_nudge_from_a_to_do` 等）改为断言规则在**它该在的那一部分**里，这样也守住拆法。再加三条测试：materialize 写出全部文件；删掉不在表上的文件与旧的单个文件；各部分之间的引用只指向表上有的文件名（扫 `` `xxx.md` ``）。Windows 检出是 CRLF，`contains` 只用单行片段。
- `core/src/runner_commands.rs`（约 385–422 行）：跟着改名，把目录路径交给 `compose_main_chat_runtime_prompt`。
- `core/src/managed_prompt.rs` 的入口层最后两段，起点稿（措辞可调，但要守住这几样：目录只写一次、文件名用裸名、每个文件一个「什么时候读」）：

  > Note what the user has to do (…) as a to-do, with a reminder when it has a date, and tick it off when it is done; set yourself a reminder when you promise to follow up. Do it unasked, and read `todo list` before saying what is left: see `todos.md` in your manual.
  >
  > Your manual is in `{manual_dir}`, one file per part. Before a Galley CLI write (a session, project, model, schedule or to-do command), read the parts it needs: `todos.md` to note a to-do or a reminder the user asks for, `todos-change.md` to change, tick off or list them, `reminders.md` for your own reminders, `times.md` for any date or time, `authority.md` and `cli.md` for sessions, projects and models, `wake.md` and `subtasks.md` when Galley wakes you.

  - 「第一次」去掉：截掉之后要用就得重读，这一点照实写。
  - 入口层的字节预算 `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`（现在 2026）按新长度重设，不留余量，`\r` 不计，照现有注释的写法补一段「Raised 2026 → N by ticket 59」：增加了多少字节、为什么值（一次读从约 2k tokens 降到几百，而这几行常驻、几乎都在缓存里）。
  - `main_chat_entry_layer_sends_the_model_to_the_manual` 等测试跟着改；工作台与 IM 的提示词里仍然不出现手册（`your manual`、`assistant/reference`）。
  - `prompt_hash()` 不变（入口层本来就不在里面），加一句断言或在回报里写明核对过。
- 别的提示词层一字不动：`RUNTIME_PROMPT_STATIC`、建议、Galley State、Main Chat 节、In Hand、IM。

## 三、文档

- `docs/managed-ga-runtime/README.md` 那一行、`prompt-composition.md`（约 365–367 行、676 行）、`runtime-modes-and-sessions.md:352` 的链接、`docs/README.md` 若有链接：改成目录与新路径。
- `.scratch/main-chat/entry-layer-eval/README.md` 里讲手册的地方跟着改。
- 历史文件（`docs/devlog/`、`.scratch/main-chat/issues/` 旧票、旧评测结果文件）不改。
- 不写 devlog（主会话写），不改 PRD。中文全角标点。

## 四、评测（入口层评测的待办、定时、叫醒三套）

- **镜像**：`.scratch/main-chat/entry-layer-eval/run.py` 里 `MANUAL`（约 129 行）、拷手册进状态根（约 2843 行）、`manual_sha` 改成按目录：整套拷到状态根下 Core 写它的位置，sha 对全部文件算。`galley-prompt/`（`schedule/` 与 `wake/` 两处）照 README 的办法重新生成：在 `managed_prompt.rs` 测试模块里临时加一个测试写出文件，跑完删掉，产品代码不留改动。
- **记录读了什么**：「读手册」一列从「读了 / 没读」扩成读了哪几部分、几次、共多少字节（返回给模型的工具结果的字节数）。上一次的数字从现有 `results.json` 里已记的工具结果算出来（旧路径 `galley-assistant-manual.md`），不重跑旧版本。
- **先干跑**：`run.py --dry-test`，确认手册目录在状态根下、提示词里的目录是那个位置、读部分文件的路径能被记下。
- **再真跑**：`--suite todo`、`--suite schedule`、`--suite wake` 各跑默认的两遍（12 + 14 + 9 条，共 70 次运行，模型 gpt-6.1-sol，即 `--model-id` 的默认值）。旧结果用 `--supersede "票 59：手册按部分拆开"` 留进 `meta.superseded_runs`。每套的 `results.md` 加一节「票 59 重跑（日期、模型、推理强度）」。
- **过线**：每套的通过率不低于上一次（待办 24/24、定时与叫醒照各自 `results.md` 里最近一次）。没过的逐条看：是没读到该读的部分、读错了部分，还是与拆分无关的随机波动（同一条补跑一遍）。是入口层措辞的问题，就改措辞再跑那几条，最多两轮；还不行就停下回报，别硬调。
- **对比表**（回报里给）：每套「上一次 → 这一次」的通过率、平均每次运行读手册的字节数与次数、读过的部分分布。
- 结果文件里不能出现私有接口地址、API host 或本机绝对路径（仓库开源）。提交前 grep 一遍域名、`api_host`、`/Users/`。

## 别动

- 主工作树：只在本 worktree 里做，不碰主树，不跑 `tauri dev`。
- `gui/`（票 58 在改）、`runner/`、`managed-ga/code/`、`cli/`。
- `core/` 不是 rustfmt-clean：不跑 `cargo fmt --all`，只用 `rustfmt --check` 核对自己改过的文件。
- 提交只点名文件，不用 `git add -A` / `git commit -a`；`git add` 与 `git commit` 用 `&&` 连起来。

## 验证

- `cargo check --manifest-path core/Cargo.toml --workspace`
- `cargo test --manifest-path core/Cargo.toml --workspace`（加迁移那类手写列表这次不涉及，照样全量跑）
- 改过的 Rust 文件逐个 `rustfmt --check`
- `git diff --check`
- `grep -rn "galley-assistant-manual.md" --exclude-dir=target --exclude-dir=node_modules --exclude-dir=.git .`：只剩历史文件（devlog、旧票、旧评测结果）。
- 拼回去与原文的逐行对比（见「一、拆法」）。
- 评测：见「四」。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 八个文件的实际字节数；拼回原文的对比（diff 原样）；改过的引用逐条列出。
3. 入口层最后两段的定稿原文，新旧字节数，预算注释原文。
4. Core 改动带 `file:line`：`materialize` 怎么删旧文件，测试各守什么。
5. 验证命令与结果原样（测试条数）。
6. 评测对比表；没过的条目与原因；改过几轮措辞。
7. 看到但没改的问题。

## Comments
