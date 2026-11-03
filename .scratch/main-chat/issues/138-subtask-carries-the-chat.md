# 138 子任务带着这段对话出门

Status: needs-dogfood（2026-11-03 快进合入 `a160ac8a`…`23da4a90`。主会话验收：读过迁移 056、`runner_commands.rs` 的分支（只有存了背景的子任务走 `compose_subtask_runtime_prompt`，在工作台那份提示词后加一节）与说明原文；跟进两处：背景取主对话 runner 手上的那几轮（跨段界，最近 10 轮），说明里不写 main chat；代理验证 workspace 1,314 条过。要真机看：子任务读到背景后会不会去回用户、会不会越过派活说明多做）

来源：[主对话 PRD](../PRD.md) 裁决 186 第 2 条（「少规矩、多手」的第三只手）。只对主对话派出的子任务；工作台会话、IM 渠道照旧；外置零变化（外置没有主对话）。

## 为什么

- 子任务现在是一个看不见主对话的新会话（`core/src/subtask.rs` 的 `dispatch_reply`：照普通内置会话经 Core 的发送起跑，第一条消息就是派活说明）。
- 入口层条款有好几句在补这一点：派活说明要写全目标、用户给的事实、这段对话定下的、已查到的（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）；「把我们聊的整理成文件」不能派，因为子任务看不见这段对话；追问派出去时前文要抄进说明（裁决 185 第 5 条）。说明漏一句，子任务就做偏。
- 方向（裁决 186）：交出去不丢上下文，派活就便宜，条款也就短。

## 要做到

1. **带什么**：主对话派出子任务的那一刻，把主对话最近几轮作为只读背景交给这件子任务。取法与截断复用开新段时的做法（`core/src/session_runner/carry.rs`：`CARRY_TURNS` 10 轮、`CARRY_MAX_CHARS` 15,000 字、`CUT_MARKER`），只取当前段。子任务的标签与派活说明不算在背景里重复一遍。
2. **放在哪**：放在子任务自己的上下文里，不当成子任务的对话：
   - 工作台里看这件子任务，第一条用户消息仍是派活说明，背景不画出来（或者只在你决定的某个不打眼的地方，写理由）；
   - 不能让它以为自己就是主对话、去对用户说话；它交回的东西仍照派活说明，交回给 Galley；
   - 放在运行时提示词的一节，还是首条消息前的注入，由你定，写理由；配给它的说明一两句，英文，说清这是派活那一刻用户与 Galley 的对话、只读、以派活说明为准。
3. **存快照**：派活那一刻取好存下，子任务冷启动、重启续跑、被送回重做时用同一份，不在重启时重取（那时主对话已经往前走了）。存哪里由你定（`subtask_dispatches` 加一列、或别处），新迁移记得 `core/tests` 4 处、`cli/tests` 2 处手写的迁移列表都要补，验证必须 `--workspace`。
4. **不改主对话条款**：入口层派活一段与手册 `subtasks.md` 留给票 139 一起收。子任务这头新加的说明文字按第 2 条，要短。
5. **量一下**：只读查真实的 `workbench.db`，量主对话近两周每次派活时「最近 10 轮、15,000 字以内」实际多大（字数中位、最大），写进报告，估一下每件子任务多花的 token。
6. **Agent API**：`session show` 等命令若因此多出字段，只加不改（宪法 Rule 3）；能不暴露就不暴露。

## 怎么做

- 先读：`AGENTS.md`（宪法）；`docs/architecture.md` 主对话分段与子任务两节；`core/src/subtask.rs`、`core/src/subtask_report.rs` 文件头；`core/src/session_runner/carry.rs`；`core/src/managed_prompt.rs` 里内置会话的提示词怎么组（子任务是普通内置会话）；`docs/managed-ga-runtime/runtime-modes-and-sessions.md`。
- 先在本文件写「## 设计」一节（取法、放在哪、快照存哪、冷启动与送回重做、GUI 有没有变化），然后直接实现。要动 GUI 才能把背景藏好时先停下回报。
- 同时在跑的还有票 134 第四轮（改 `managed_prompt.rs` 主对话入口层与 `runner/handlers.py`）和票 136（插话改道，改 `session_send.rs`、`message_queue.rs`、runner 与 GUI）。尽量别碰这些地方；碰了在报告里写明，合入时我来对。

## 验证

```bash
cargo test --manifest-path core/Cargo.toml --workspace
node scripts/check-docs-links.mjs
git diff --check
```

改到 runner 就加 `.venv/bin/python -m pytest`、`.venv/bin/python -m mypy runner`、`.venv/bin/ruff check runner`；改到 GUI 就加 `pnpm --dir gui typecheck`、`pnpm --dir gui lint`、`TZ=UTC pnpm --dir gui exec vitest run`。

测试至少覆盖：派活时取到快照、截断照 `carry.rs`；子任务第一次起跑时模型看得到背景；冷启动、重启后用的是同一份快照；工作台会话、手动开的会话不带背景。真模型真机我在合入后的 dev 里走，代理不跑 `tauri dev`。

## 环境与边界

- 只在自建 worktree 里做，绝不碰主工作树（JC 的 `tauri dev` 常驻在主树）。不跑 `tauri dev`。
  ```bash
  cd <主树>
  git worktree add -b t138-subtask-carries-the-chat <scratchpad>/wt-138 main
  mkdir -p <wt>/core/target
  cp -cR core/target/debug core/target/tauri-sidecars <wt>/core/target/
  rm -rf <wt>/core/target/debug/incremental
  cp -cR core/python-bundle core/gen <wt>/core/
  ```
- 真实数据库只读；不写内置 / 外置 GA 的状态。
- Core 不是 rustfmt-clean：只对自己改过的 Rust 文件跑 `rustfmt --check`。Windows CI 检出是 CRLF：Rust 原始字符串里的提示词，contains 断言别跨行。
- 在 worktree 分支上提交，`git add` 只点名文件，禁用 `git add -A` / `git commit -a`；add 与 commit 用 `&&` 链接；提交说明末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。不 push，不合入 main。
- 中文文字一律全角标点；提交前自己写正则扫新增行，脚本放 scratchpad，用 `t138-` 前缀命名。票面与文档里不写本机用户目录、worktree 路径、服务商名、接口主机；量出来的数字只写字数与轮数，不抄对话原文。

## 回报

写在本文件末尾的「## 报告」一节，并在最后一条消息里给主会话：设计要点；第 5 条量的数；改了哪些文件；测试与验证结果（数字照抄命令输出）；提交号（照抄 `git log --oneline -1`）；看到但没改的（Open risks），原样列出。

## 设计

**取法**（新模块 `core/src/subtask_background.rs`）：

- 时机：`subtask::dispatch_reply` 在启动任何一个标签之前取一次，同一条回复派出的几件子任务共用一份。这时这条回复的标签都还没有记录。
- 范围（跟进改）：到派活回复为止的最近几轮，不管在哪一段，跟主对话 runner 此刻手上的一样（当前段开头就是段界前带过来的那几轮）。不取回复之后的行（排在队里的下一句即使已经落库也不算）。最初的取法只取回复所在的段，验收时改掉，见「跟进」。
- 读法照开新段：行先过 `subtask::mark_rows`（回复去掉 `<subtask>` 说明、换成 `[subtask <id>: <title>]`；子任务报告换成它的回放行），再交给 `carry::CarriedWindow::from_rows`：一轮是一条用户消息加到下一条为止的所有回复，问候、没等到回复的、静默的叫醒都不算；取最后 `CARRY_TURNS`（10）轮，合计 `CARRY_MAX_CHARS`（15,000）字封顶，超了从最老的整轮丢；只剩最新一轮仍超，照 `fit` 截，`CUT_MARKER` 标在截掉的地方。
- 派活那条回复本身：标签和说明全部去掉，不加标记行（这时还没有子任务 id；派活说明就是子任务的第一条消息，不在背景里再来一遍）。标签前的话（「好，去查了」）留着。之前几轮派过的子任务，照主对话自己回放时看到的样子留标记行。
- 用户消息的图片：快照里记路径，提示里只写几张（`[2 images attached]`）：系统提示里放不了图，本机路径也不发给服务商（状态块准入第 4 条）。

**放在哪**：运行时提示词里的一节，不进子任务的对话。

- 子任务的运行时提示词 = 工作台那一份（一字不改）+ 状态块之后一节 `## Background: The User's Chat With Galley`：两句英文说明，后面是各轮原文，用 `<turn at="本地时间">`、`<user>`、`<galley>` 包起来。标题、说明、标签都不写「main chat」（跟进改，裁决 173）。
- 说明（英文两句）：这件子任务是从用户与 Galley 的对话里交给你的，下面是交出来那一刻那段对话最近几轮；只读的背景，不是要你接着说的对话；派活说明（你的第一条消息）为准，交回的东西照它说的交回那段对话。
- 为什么不放首条消息前：
  1. GA 收到超过 2,000 字的用户消息会存成临时文件，换成一句「Long user prompt saved to … Read and execute.」（`managed-ga/code/agentmain.py` 的任务循环）。背景加派活说明多半过线，连派活说明都会被挪进文件。
  2. 另一种是往 `load_history` 里塞一对假的 user / assistant：要改 ensure「没有完成的轮次就不回放」与回放规则（子任务冷启动、送回重做都要特判），而且模型读到的是一段「它说过」的话，更容易接着去回用户。
- 为什么放提示词：
  1. 不是对话：GA 的历史里只有子任务自己的往来；工作台第一条用户消息仍是派活说明，GUI 不用改。
  2. 跟主对话的状态块同一个口子：spawn 时从库里存好的快照组出来，经 `GALLEY_RUNTIME_PROMPT_TEXT` 交给 runner，runner 零改动；每次 spawn 拿到的字一样（时间按本机时区写到分钟）。
  3. 代价：这一节在子任务每次调模型时都在（系统提示，前缀不变，能走提示缓存），不会像历史那样被 GA 截短。

**快照存哪**：迁移 056，`subtask_dispatches` 加一列 `background`（JSON：每轮的 `turnIndex`、`saidAt`、`user`、`images`、`reply`；窗口为空时为 NULL）。

- 只有建出了会话的那条记录写，跟记录同一条 INSERT，在子任务的 runner 起来之前落库。
- 按子任务的 `session_id` 读。不进 `SubtaskDispatch`（桌面事件、`list_subtask_dispatches` 不变），不进 Agent API。
- 随主对话走：重置主对话时 CASCADE 删掉派活记录，快照一起删（主对话里说过的话跟着主对话走）；已提升为普通对话、留下来的子任务，之后再起 runner 就不带背景了。

**冷启动、重启、送回重做**：`runner_commands::prepare_managed_spawn_args` 对主对话以外的会话按 id 读快照，有就换成带背景的那份提示词。子任务第一次起跑、Core 重启后冷启动、被逐出后重起、主对话 `session send --ensure-runner` 送回重做、用户在工作台打开它，都走这一处，拿到的都是派活那一刻存下的那份；runner 还活着时提示词本来就在。提升为普通对话后照旧带着（这段对话就是从那份背景开始的）。

**GUI**：不变。工作台里第一条用户消息仍是派活说明，背景不画。CLI / Agent API 不变，不加字段。

**两种运行时**：外置零变化（外置没有主对话，也走不到 `prepare_managed_spawn_args`）。工作台会话、手动开的会话、IM 渠道没有派活记录，不带背景。

## 报告

**设计要点**（详见上面「设计」）：

- 派活回复落定、任何一个标签起跑之前，Core 取一次主对话最近几轮（`subtask_background::take`）：到这条回复为止、跨段界（跟主对话 runner 手上的一样），行照主对话回放的读法过一遍，再交给 `CarriedWindow::from_rows`（10 轮、15,000 字、`CUT_MARKER`）。派活那条回复去掉标签和说明，不加标记行。
- 快照随每条建出了会话的派活记录写进 `subtask_dispatches.background`（迁移 056，JSON），与记录同一条 INSERT，早于子任务的 runner。
- 放在子任务运行时提示词状态块之后的一节 `## Background: The User's Chat With Galley`（两句英文说明 + 各轮原文，不写「main chat」），由 `prepare_managed_spawn_args` 在每次 spawn 时从快照组出来：第一次起跑、冷启动、送回重做、桌面打开都是同一份。首条消息仍是派活说明；回放、GUI、CLI、Agent API 都不变；runner 零改动。
- 不放首条消息前：GA 把超过 2,000 字的用户消息存成文件换成一句「Long user prompt saved to …」，派活说明会一起被挪走。
- 图片在提示里只写张数，本机路径不发给服务商。

**第 5 条量的数**（只读打开真实库，备份到 scratchpad 的副本上跑本票的 `take`，量完删副本；主对话近两周 10-21 至 11-03，派活回复 7 条、子任务 8 件，其中一条回复派了两件）：

- 以下是跟进后的取法（跨段界）。每条派活回复取到的轮数：8、10、10、10、10、10、10；字数：7,006、4,440、6,004、3,854、7,413、7,844、8,991。
- 中位 7,006 字，最大 8,991 字。15,000 字的上限一次都没碰到，没有截断。
- 加上说明与标签后整节的字数：中位 7,978，最大 10,111。
- token 估算（没有分词器，按中文约 0.85 token / 字、其余约 4 字符 / token 估）：整节中位约 4,400 token，最大约 5,500 token。这一节在子任务每次调模型时都在；8 件子任务最后一步的 telemetry 里 `requestCount` 为 5、5、6、10、21、23、25、27（中位 15.5）。按每件子任务自己的节长乘请求数：中位约 55K token，最大约 137K token（8,991 字那件，25 次请求）；占这些子任务原本输入（`inputTokens` + `cacheReadTokens`）的 6%–53%：跑 20 次以上的四件在 6%–19%，5–10 次的四件在 38%–53%。提示词前缀不变，支持提示缓存的服务商第二次请求起按缓存读计；telemetry 里有的子任务几乎没有缓存读，按全价算就是上面这些数。
- 量完之后真实库里又多了一条派活回复（11-03 13:26），新取法下 10 轮、8,999 字；算上它，8 条的中位 7,210 字、最大 8,999 字。上面的数仍按最初那 7 条。
- 对照（最初的取法，只取回复所在的段）：7 条回复各取到 1、5、0、2、3、6、10 轮，字数中位 1,700、最大 8,991，整节中位约 1,100 token，每件子任务多花中位约 16K token。

**改了哪些文件**：

- 新增：`core/migrations/056_subtask_background.sql`、`core/src/subtask_background.rs`
- Core：`core/src/subtask.rs`（派活前取快照、随记录写；抽出 `named_dispatches`）、`core/src/db/subtask.rs`（`record_subtask_dispatch_with_background`、`subtask_background`）、`core/src/managed_prompt.rs`（只加 `compose_subtask_runtime_prompt` 一个函数，放在 `compose_im_runtime_prompt` 后面，入口层与测试模块没碰）、`core/src/runner_commands.rs`（`prepare_managed_spawn_args` 加一个分支，`set_runtime_prompt` 从 `mark_main_chat_env` 里拆出来，加一个测试）、`core/src/session_runner/carry.rs`（只改文档注释）、`core/src/db_migrations.rs`、`core/src/lib.rs`
- 迁移列表：`core/tests/db_test.rs`、`core/tests/db_writes_test.rs`、`core/tests/scheduler_fire_test.rs`、`core/tests/socket_write_handlers_test.rs`、`cli/tests/cli_test.rs`、`cli/tests/m1_writes.rs`
- 测试：`core/tests/subtask_test.rs`（新增一节 4 个测试）
- 文档：`docs/architecture.md`、`docs/managed-ga-runtime/runtime-modes-and-sessions.md`、`docs/managed-ga-runtime/prompt-composition.md`
- 没碰：`session_send.rs`、`message_queue.rs`、`runner/`、GUI、手册、入口层。

**测试与验证**：

- `cargo test --manifest-path core/Cargo.toml --workspace`：47 组结果，1313 passed，0 failed，0 ignored（其中 `subtask_test` 14 passed，`cli_test` 36 passed，`m1_writes` 31 passed，`db_test` 23 passed）。
- `node scripts/check-docs-links.mjs`：docs link gate OK: 493 files checked.
- `git diff --check`：无输出。
- `rustfmt --check`：新文件、`runner_commands.rs`、`subtask_test.rs`、`subtask.rs`、`db/subtask.rs`、`managed_prompt.rs`、`carry.rs`、`db_migrations.rs` 干净；`db_writes_test.rs`、`scheduler_fire_test.rs`、`lib.rs` 的格式差异是 main 上原有的，只改了迁移那一行。
- 全角标点：扫了相对 df588eaf 的新增行，散文（票面、文档）零命中；命中的 29 行都是 Rust 代码里括号包着的中文字符串字面量。
- 覆盖：派活时取到快照、带上段界前的几轮（跟进后）、不取回复之后、派活回复不带标签与标记、之前派过的留标记、同一条回复的几件共用一份（`the_background_is_the_last_turns_up_to_the_dispatching_reply`，跟进后改名）；10 轮与 15,000 字截断照 `carry.rs`（`the_background_keeps_the_carrys_ten_turns_and_its_cap`）；第一次起跑时运行时提示词里有背景、第一条消息只有派活说明、主对话往前走后冷启动拿到的提示词逐字相同、回放只有子任务自己的往来（`every_runner_of_a_subtask_is_told_the_same_background`）；工作台会话、CLI 开的会话、主对话本身、票 138 之前的子任务不带背景（`sessions_no_reply_dispatched_carry_no_background`、`only_a_subtask_with_a_stored_background_gets_it`）。最初的版本拿掉段界那一行做过反证，第一个测试会红；跟进后这条测试改成断言段界前那一轮在背景里，10 轮那条测试也加了段界。
- 没跑 `tauri dev`，没跑真模型。

**Open risks**：

1. **只取当前段会漏掉刚隔了一段时间回来的那几句。** 用户隔了 4 小时以上回来说「那就按刚才说的订吧」，这句开了新段，主对话 runner 手上有段界前带过来的几轮，子任务这边只拿到这一句。真实数据 7 条里 4 条只取到 0–3 轮。要改成跟主对话 runner 手上的一样，删掉 `take` 里 `.max(segment_start)` 那一行及段界的读取即可，代价见上面的对照数（字数中位 1,700 → 7,006）。票 139 收掉「派活说明要写全」之后，这个缺口更显眼。
2. **入口层仍说子任务看不见这段对话。** 票面第 4 条留给票 139（手册 `subtasks.md` 里没有这句）；在那之前，入口层派活一段（`a separate conversation that cannot see this one, so write everything it needs`、`(a subtask cannot see this conversation)`）与提示里的事实不一致，模型多半照旧写全说明，只多花些字。
3. **Windows 上环境变量的长度。** 带背景的提示词经 `GALLEY_RUNTIME_PROMPT_TEXT` 一个环境变量传给 runner；工作台提示词约 7.5K 字符，加上最长的一节（15,000 字 + 说明与标签）约 24K，低于 Windows 文档里单个变量 32,767 字符的上限，但没有测试钉住，也没在 Windows 上实跑过。
4. **删消息不删副本。** 用户在主对话里删掉一条消息（票 32），已经存进某件子任务背景里的那段不会跟着删；只有重置主对话（CASCADE）会删。
5. **迁移号。** 本票占了 056；票 136 若也加迁移，合入时要对号（含 6 处手写列表）。
6. **`managed_prompt.rs` 与票 134 并行。** 本票只在 `compose_im_runtime_prompt` 后面加了一个函数，合入时看一眼是否冲突。
7. **模型行为没验。** 子任务读到主对话几轮后，会不会去回应其中用户的话、会不会越过派活说明多做，要在合入后的 dev 里真机走；说明里的两句是为这件事写的，没评测过。
8. **提升为普通对话的子任务。** 照旧带着背景（设计如此）；主对话重置后，留下来的这类子任务下次起 runner 就没有背景了。

## 跟进

验收后主会话定了三处，在同一个 worktree 里做完：

1. **取法跨段界**（Open risk 1 定了）：子任务拿到的跟主对话 runner 手上的一样，即当前段加上段界前带过来的那几轮。理由（主会话）：裁决 186 的「带着这段对话出门」，指的是主对话此刻看得到的那段；「那就按刚才说的订吧」这种开新段的话，前文正好在带过来的几轮里。`take` 删掉了段界的读取和 `.max(segment_start)`，从 `main_chat_carry_from(reply + 1, 10)` 读起。测试：第一条改名 `the_background_is_the_last_turns_up_to_the_dispatching_reply`，断言段界前那一轮在背景里（之前派过的那件子任务的背景也带上它）；10 轮那条在派活那句前记一个段界，背景仍是跨段界的 10 轮。上面「第 5 条量的数」已换成新取法下的数，旧取法的数留作对照。
2. **不写「main chat」**（裁决 173：只作内部用语，子任务的输出用户在工作台看得到，模型会照抄）：标题改为 `## Background: The User's Chat With Galley`；说明改为 "This conversation is a subtask handed to you from the user's chat with Galley; below are that chat's last turns, as they stood at that moment. Read them as background, not as a conversation to continue: your first message, the instructions, is what to do and wins where they differ, and what you hand back goes to that chat, as it says."；回复的标签从 `<main-chat>` 改为 `<galley>`。新增单测 `the_section_never_says_main_chat`：整节转小写后不含 `main chat`、`main-chat`、`main_chat`、`mainchat`。`docs/managed-ga-runtime/prompt-composition.md` 那一小节改名「Subtask Background」，引文、标签同步，加一条「Words」说明为什么。
3. **rebase 到 main**（f7032950，票 134 第四轮已合入）：没有冲突。迁移号 056 留给本票，票 136 用 057。

Open risks 随之变化：第 1 条已按上面改掉；第 5 条迁移号已定；第 6 条 rebase 无冲突。其余照旧。第 2 条入口层的原文在第四轮之后仍在（`as a separate conversation that cannot` 与 `(a subtask cannot see this conversation)`）。

跟进后的验证（rebase 之后）：

- `cargo test --manifest-path core/Cargo.toml --workspace`：47 组结果，1314 passed，0 failed，0 ignored（`subtask_test` 14 passed，`cli_test` 36 passed，`m1_writes` 31 passed，`db_test` 23 passed；多出的一个是 `the_section_never_says_main_chat`）。
- `node scripts/check-docs-links.mjs`：docs link gate OK: 493 files checked.
- `git diff --check`：无输出。
- `rustfmt --check`：`subtask_background.rs`、`subtask_test.rs`、`managed_prompt.rs`、`runner_commands.rs`、`subtask.rs`、`db/subtask.rs`、`carry.rs`、`db_migrations.rs` 干净。
- 全角标点：散文零命中，命中的 31 行都是 Rust 代码里的中文字符串字面量。
