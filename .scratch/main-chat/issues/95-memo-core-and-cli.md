# 95 备忘的 Core 与命令：记录、`galley memo`、上限与期限、段首一节、巡看为前一天的新备忘叫醒

Status: ready-for-agent

来源：[主聊天 PRD](../PRD.md) 裁决 140、141、143（2026-10-26，主对话的上下文与备忘；JC：「按你建议推进」）；devlog [主对话的备忘](../../../docs/devlog/2026-10-26-main-chat-memo.md)。改写 [助手 PRD](../../assistant/PRD.md) 裁决 10 与主聊天裁决 128 第 4 条的叫醒判据。本票只做 Core、CLI、Agent API 文档与 GUI 的 IPC 类型；手册与评测是票 96，卡片与面板页是票 97，两张都等本票合入后再开。

## 为什么

- 主对话要记住「关于你的事」（称呼、家人、偏好、常打交道的人、反复出现的兴趣），GA 的记忆接不住：L0 公理 1 只认工具调用的结果（「No Execution, No Memory」），用户亲口说的偏好按 L0 都不该记；L2 重置后 6 天没改过。裁决 140 定由 Galley 自己记：一份备忘记录，模型当轮用 `galley memo` 写，每段开头带上。
- 待办记动作，备忘记信息。备忘没有「办完」，只有「还对」与「不对了」，会过期的带期限。
- 信息丢在段界（空闲 4 小时开新段，只带最近 10 轮、15,000 字），所以备忘放进段首状态块，与 In Hand 并列：状态块是运行时层的一部分，起 runner 时定下，GA 的压缩与裁剪碰不到它。
- 裁决 141：记不记交给模型，总量由 Core 用确定式规则卡住。
- 裁决 143：巡看除了待办，也为「前一天」的新备忘醒；只算你发起的轮次里记下或改过的，每条只落进一个窗口。

## 要做的

照待办的路数做（迁移 `050_todos.sql`、`core/src/db/todo.rs`、`core/src/api/todo.rs`、`core/src/socket_listener/todo_cmds.rs`、`cli/src/todo.rs`、`docs/agent-api/todo-commands.md`）。名字、结构与待办不一致的地方，以本票为准；本票没说的细节照待办的现成做法，回报里列出你自己定的。

1. **迁移 `053_memos.sql`**：
   - `memos`：id（`memo_` 开头，同 `todo_` 的生成法）、正文、可选期限 `until_date`（只有日子，浮动本地日期，同 `todos.due_date`）、`created_at`、`updated_at`；出处同待办：`created_via`、`created_by_supervisor`、`created_origin_note`、`created_in_session_id`、`created_in_run_turn`、`created_in_turn_index`。
   - 一列「最近一次在你发起的轮次里记下或改过的时刻」（名字你定，下面叫 `fresh_at`）：在叫醒开头的轮次里记或改，不动它（见第 6 条）。
   - `memo_events`：每次记、改、删一行：备忘 id、动作（add / update / delete）、动作之后的正文（删除时记删之前的正文）、`via` 与 supervisor、出处的会话与轮次（同待办：`run_turn` 记那一轮开头的用户行，`turn_index` 在运行结束时填回复所在的轮，照 `settle_todo_created_in`，`core/src/db/todo.rs:637`，调用方 `core/src/message_queue.rs:232`）、`created_at`。票 97 的回复下卡片读它。
   - 删除：删掉 `memos` 那一行，`memo_events` 留着（卡片要显示「不再记 · ……」）。
   - **加迁移要补六处手写的迁移列表**：`core/tests` 里四个文件（如 `scheduler_fire_test.rs:83`、`db_test.rs:67`、`db_writes_test.rs:79`、`socket_write_handlers_test.rs:87` 那一组 `MIG_052`）加 `cli/tests` 里两处，各自 `include_str!` 手写列表；只跑 core 抓不到 cli 那两处，验证必须 `--workspace`。
2. **上限与期限**（命名常量，注释写依据「主聊天 PRD 裁决 141」）：
   - 单条：去掉首尾空白后 1–100 个 Unicode 字符（按字符，不按字节）；空的或超了，命令拒收，错误信息说清上限与这条的字数。错误类别照 `docs/agent-api/errors-and-exit-codes.md` 现有的参数错误，不新增类别。
   - 期限：`--until=YYYY-MM-DD`，按本机时区的日子算，不能早于今天；`memo update` 有 `--no-until`。过了期限那天（本地日子在期限之后）的备忘：不进段首、不进 `memo list`、不进面板、不计总量，行留着、不自动删（倾向不让 Core 删用户的数据；你若有更好的做法，回报里说）。
   - 总量：没过期的备忘正文字符数合计。`memo add` / `memo update` 之后超过 2,000，照记，JSON 里多一个字段说超了多少（名字你定，如 `overLimit: { chars, limit }`），人读的输出多一句英文：超过段首上限，先合并或删掉过时的（措辞你定，回报原样给出）。
3. **CLI 与 Agent API**（`3` 内加法；`--schema=1`、`2` 也认，同待办）：
   - `galley memo list`（没过期的，按记下的先后）、`memo add "<text>" [--until=]`、`memo update <id> [--text=] [--until= | --no-until]`、`memo delete <id>`；写命令带 `--supervisor`、`--reason`，记谁写的、在哪一轮写的，同 `todo add` 的出处规则。不要 `show`（一条只有一句），除非你发现 CLI 的命令族惯例要求有，回报里说明。
   - 事件 `memos:changed`（空载荷），写命令与面板的删除都发。
   - 文档：新增 `docs/agent-api/memo-commands.md`（照 `todo-commands.md` 的写法与 § 编号接着排），`docs/agent-api/README.md` 的表加一行；其余列命令族的地方照待办那次补。
4. **给面板与卡片的 IPC**（Tauri 命令，照 `list_assistant_todo`、`list_noted_todos`、`cancel_todo` 那组，`core/src/lib.rs:265` 一带、`core/src/commands/schedule.rs:171`）：
   - 列出没过期的备忘，带面板要的字段：id、正文、期限、`created_at`、`updated_at`、最近一次记或改的出处（会话 id 与 `turn_index`，面板「点一行回到当初那句话」用）。
   - 删除一条（`via = gui`，记为你在桌面上删的，事件照记一行 delete）。
   - 给卡片：某个会话里各轮的备忘事件（动作、正文、备忘 id、这条备忘现在还在不在），照 `list_noted_todos` 的形状。
   - `gui/src/types/ipc.ts` 补上对应的类型（Core-only 的 IPC 命令也要进这里，check.yml 的前置门禁查它）。本票不写 GUI 组件。
5. **段首的备忘一节**（`core/src/managed_prompt.rs`，接在 In Hand 后面；读的地方在 `core/src/runner_commands.rs:420` 一带，照 `in_hand_read` 的写法，读失败记日志、这一节不放，runner 照起）：
   - 有没过期的备忘才放。标题与说明照 In Hand 的英文写法（如 `### Memo`，一句说明：这是你替用户记下的、关于他的事，用 `galley memo` 改；措辞你定，回报原样给出）。
   - 每条一行：id、最近一次记或改的本地日子、正文、有期限的写到哪天。按记下的先后排（`created_at` 升序：先记的多是称呼、家人这类底子）。
   - 正文合计放到 2,000 字为止，放不下的那几条不放，最后一行写还有几条、用 `galley memo list` 查。
   - 固定文字加字节预算常量与测试，照 `IN_HAND_BUDGET_BYTES`（`managed_prompt.rs:2385`）的记账写法；Windows 检出是 CRLF，原始字符串里的提示词在 Windows 上带 `\r`，预算按本机字节数 +18 设、`contains` 别跨行（见 `docs/engineering-workflow.md` 有没有现成的说明，没有就照现有预算测试的处理）。`docs/managed-ga-runtime/prompt-composition.md` 的条款台账加一行。
   - 只在主对话。工作台、子任务、IM 的提示词一个字不变。
6. **巡看为前一天的新备忘叫醒**（`core/src/assistant_todo.rs:174` 的 `review_has_something_to_look_at`、`core/src/scheduler.rs:442` 的 `fire_review`）：
   - **窗口**：从上一次巡看（醒了或跳过都算，即巡看那条定时任务这次之前的 `last_fired_at`）那天的本地 0 点起，到今天本地 0 点止（不含）；从没巡看过就从昨天 0 点起。每条备忘只落进一个窗口；手动再跑一次巡看，同一天窗口为空。
   - **算的**：`fresh_at` 在窗口里、还没过期、还在的备忘。`fresh_at` 只在你发起的轮次里记或改时更新：那一轮开头的用户行不是 Galley 的叫醒行（巡看、提醒、子任务回报等叫醒都是 `created_via = 'system'` 的那种行，以库里实际的写法为准，回报里写你怎么判的）。不在主对话里写的（工作台、其他 supervisor）照你的判断：倾向只算主对话的，回报说明。
   - **判据**：原来的待办判据成立，或窗口里有这样的备忘，就醒；都没有照旧跳过。判断要能脱开 `chrono::Local` 测（传进「今天」与时区，同票 81 的做法）。跳过时的日志改成说清两样都没有。
   - **叫醒说明里点名**：窗口里有这样的备忘时，在巡看的叫醒说明里加一段英文，列出它们的 id 与正文，并指向 `wake.md` 的「The morning review」（手册由票 96 写）；没有就不加这一段，叫醒说明一字不变。措辞你定，回报原样给出。
   - `.scratch/assistant/closed-loop-snapshot.py` 里跳过原因的说法若随日志改，跟着改，别加逻辑。
7. **重置主对话时备忘跟着清**：`core/src/db/main_chat.rs:322` 删 `todos` 的那一处一起删 `memos` 与 `memo_events`；重置确认里若列了会清掉什么（看 `core/src/main_chat_reset.rs` 与 GUI 的确认文案），回报里说有没有要补的文案（GUI 文案留给票 97）。
8. **文档**：`docs/managed-ga-runtime/runtime-modes-and-sessions.md`「The morning review」一条的判据补上新备忘；`docs/managed-ga-runtime/prompt-composition.md` 的段首说明补上备忘一节。devlog、PRD、`docs/project-status.md` 的历史不动。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`；JC 的数据库只读，只经备份读。
- `gui/` 只改 `gui/src/types/ipc.ts`；手册 `docs/managed-ga-runtime/galley-assistant-manual/` 与 `core/src/assistant_manual.rs` 不动（票 96）；入口层提示词（`managed_prompt.rs` 的主对话入口层条文）不动（票 96）。
- In Hand 的内容、分组、排序；待办与定时任务的表与命令；巡看的时刻、种子、补发、每天上限、两件子任务的上限（手册管）。
- `runner/`、`managed-ga/`、IM 的代码与提示词。
- `core/` 不是 rustfmt-clean：只对改过的文件 `rustfmt --check`，别跑 `cargo fmt --all`。
- 提交只点名文件，`git add <文件…> && git commit …`，禁用 `git add -A` / `git commit -a`；提交说明英文，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。提交前 grep 新增行，不能有本机路径、会话 id、本机真实数据、私有接口地址。

## 验证

- 干净的 target 上 `cargo check` 要 sidecar 占位文件；worktree 已克隆好 `core/target`、`core/python-bundle`、`core/gen`，照常跑即可。
- `cargo check --manifest-path core/Cargo.toml --workspace`
- `cargo test --manifest-path core/Cargo.toml --workspace`，再在 `TZ=UTC`、`TZ=America/Los_Angeles` 下各跑一遍（窗口按本地 0 点算，日期边界最容易在这里错）。
- `pnpm --dir gui typecheck`（`ipc.ts` 改了）。
- 改过的文件 `rustfmt --check`，`git diff --check`。
- 新增中文（文档里的）用全角标点。
- 测试至少覆盖：单条 0 / 1 / 100 / 101 字（含中文与 emoji 的字符数）；期限早于今天拒收、今天可以、过了那天的不进列表、段首与总量；总量 1,999 → 加一条超过时照记并带超限字段；段首按先后排、放到 2,000 字为止与「还有几条」那一行、没有备忘时不放这一节；`fresh_at` 在叫醒轮次里不动、在你发起的轮次里动；窗口：上次巡看是昨天、前天（跳过一天）、从没巡看过、今天手动再跑一次；窗口里只有过期的、只有已删的不醒；只有新备忘、没有待办时醒且叫醒说明里点名，待办判据成立而没有新备忘时叫醒说明不变；重置后备忘与事件都清掉；运行结束时事件的 `turn_index` 填上；CLI 各命令的 JSON 与退出码。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 迁移的 SQL 原样；`fresh_at` 怎么判「你发起的轮次」，引代码行。
3. 段首一节的样子：用测试里的样例渲染出来原样贴出（不是真实数据）；固定文字的字节预算与常量。
4. 巡看：新判据与 `fire_review` 那段的 diff 原样；叫醒说明里加的那段原样；日志新措辞原样。
5. CLI：`memo add / update / delete / list` 各一例的 JSON 输出（测试数据）；超限那句原样。
6. IPC 命令与 `ipc.ts` 新类型的名字。
7. 改了哪些文档。
8. 验证命令与结果原样。
9. 你自己定的细节（本票说「你定」的那些），看到但没改的问题，没验证到的地方。

## 给 JC 的真机步骤

（三张票都合入后一起走，见票 97。）本票单独合入后：dev 重启 Core，主对话下一段起段首带上备忘一节（还没有备忘时不出现）；`core/target/debug/galley memo add "测试一条" --supervisor=galley-assistant --reason=test` 能记，`memo list` 能看，重置前用 `memo delete` 删掉。
