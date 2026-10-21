# 73 主动的第一阶段：没日子的在办之事也记；主动的是动作，不是建议；每天 9:00 巡看

Status: needs-dogfood（2026-10-21 合入，与票 74 一起；主会话机器验收：`cargo check`、`cargo test --workspace` 1203 条全过，改过的 Rust 文件 rustfmt 干净（`scheduler.rs` 两处差异 main 上原有），评测结果文件里服务商名改为中性措辞（`97cf35a6`，rebase 后 `3f646cce`）；评测在 gpt-6.1-sol 上：旧用例 63/64、28/28、18/18、14/14，新用例 12/14；已知：未经吩咐记下时 16 次里 3 次只在 `<summary>` 里说，回复下仍挂待办卡片，放进试用观察）

来源：[助手 PRD](../../assistant/PRD.md) 裁决 10、主聊天 PRD 裁决 124（2026-10-21，JC：「主动的边界，可以接受」「第一阶段还是以待办功能为根基，让助理自己写下可以跟踪或扩展的事项，猜测用户可能会需要的协助」，主会话推荐四件加 IM 两处，JC：「按建议推进」）。改手册、入口层、Core 的定时叫醒与评测，外加试用快照脚本。GUI 那一半是票 74：本票定下的「巡看那条例行」标记就是两票之间的契约（见「四」）。

## 起因

JC 读了一篇 Today AI 的使用体验：作者和同事在群里排查成本暴涨，排查到一半说「先吃饭吧」，吃完饭打开手机，Today AI 已经主动比对了最新数据、拆好了消耗项。Galley 已经做到的是「判断」：听到带日子的事自己跟进（裁决 112）。还缺两样：

- 没日子、正在推进的事不记。今天手册的门槛第 1 条要「a time to come」（`docs/managed-ga-runtime/galley-assistant-manual/todos.md`「Noting a to-do」）。
- 记下之后没人回头看。待办只有到点才叫醒它；没日子的事永远不会再被想起。

裁决 10 的核心规则是「主动的是动作，不是建议」：能自己做、能撤回、不花用户的钱、不替用户对外说话的准备直接做完再说；要先问的带着做好的准备去问；什么都没做成就不开口。

## 一、手册（`docs/managed-ga-runtime/galley-assistant-manual/`）

英文写，口吻、密度照现有各部分；中文原话照现有写法放在「」里。

1. **`todos.md`「Noting a to-do」加一类没日子的事**：用户正在推进、有下一步、在意结果、这一轮办不完的事，不用等吩咐，记成用户的待办，不写 `--due`（「排查到一半，先吃饭吧」：记「查清阿里云费用暴涨的原因」）。和现有三条门槛并列写，不改它们。「不跟」那段照旧，补一句：随口的愿望、抱怨、已经说完的事不算「在推进」。
2. **新增一部分 `unasked.md`（Doing things without being asked）**，`assistant_manual.rs` 的 `PARTS` 加这一项（放在 `subtasks.md` 前后由你定，入口层要点到它）：
   - 什么时候想一步：记下一件事时（不论是不是用户吩咐的），以及每天巡看时（见 3）。问自己：这件事用户接下来要什么？
   - 能直接做的：能撤回、不花用户的钱、不替用户对外说话的准备，比如查资料、比价、看进展、起草、整理成文件。快的当场做；慢的派子任务（照 `subtasks.md`），跑完按现有的叫醒回来交代。
   - 要先问的：对外（发消息、邮件、下单付款）、删除、不可逆、往用户自己开的会话里写，照 `authority.md`；先把准备做好，带着结果问一句（「Banner 草稿做好了，要发群里吗？」）。
   - 不开口：什么都没做成，就不说。不写「要不要我帮你……」「需要的话我可以……」这类建议，回复末尾的下一步建议也不写这种。
   - 上限：记下时，一件事最多派一件子任务；一次巡看最多派两件。上限只写在手册里，Core 不拦（同 `wake.md` 打回最多两次的写法）。
   - 告诉用户：做完一句话说做了什么、结果在哪；交文件照「三」的 `[FILE:路径]`。
   - 别做的：替用户做决定，替用户改他自己的东西，为一句闲聊派子任务。
3. **`wake.md` 加「每天早上的巡看」一节**（Core 的叫醒文字见「二」第 3 条）：
   - 先读最新的：`todo list`、`schedule list`，在跑的子任务。
   - 逐件看有没有现在就能往前推的，按 `unasked.md` 做；有自己时间的提醒，不在巡看里提前说；不催用户自己的待办（逾期的也不催，它们的提醒会说）。
   - 开口：只在做成了事时开口，几件合成一条消息，话里带出这是早上过了一遍在办的事（「早上过了一遍在办的事：……」），让用户知道这句从哪来。只是派出了子任务、还没结果的，这一轮写 `<no-reply/>`，等子任务回来再交代。什么都没做也是 `<no-reply/>`。
   - 停掉：用户说「别每天过了」「早上那个不用了」，对巡看那一条（`schedule list` 里 `origin.supervisor` 是 `galley-review` 的那条）用 `schedule disable`，不用 `delete`；说一句已经停了，想恢复跟它说。用户让恢复就 `schedule enable`。改时间照 `schedule update`。
4. **`reminders.md`**：「Each time you set one, say」与「A repeating task … ask first」那两条加一句例外：巡看那条是 Galley 建的，不是它设的，不用为它说话或先问。
5. `authority.md`：如果现有措辞与「能撤回的准备不用问」冲突，只改冲突的那一句，别的不动。

## 二、Core：每天 9:00 巡看

1. **种子**：内置运行时有主对话时，Core 保证 `scheduled_tasks` 里有且只有一条巡看：`target = assistant`、每天、`time_of_day` 09:00、`created_by_supervisor = 'galley-review'`（常量放在 `scheduler.rs` 的 `SCHEDULER_SUPERVISOR` 旁边），`created_via` 用表示「Galley 自己」的值（`created_via` 若有 CHECK 约束不收合适的值，用最贴切的已有值并在回报里说明）。`prompt` 存给模型看的英文叫醒文字（见 3），界面不显示它（票 74 按标记显示名字）。
   - 幂等：只要有过一条 `galley-review` 的行，不论启用、停用还是已取消（删除是软删，`cancelled_at`，`core/src/db/schedule.rs:603`），都不再建。用户让停掉、删掉之后，Galley 不建回来。
   - 时机：在主对话建出时，以及 Core 启动时补建（现有用户的主对话早就建好了）。找现有确保主对话存在的那一处挂上；不加迁移优先（加迁移要补六处手写列表，见 `core/tests` 与 `cli/tests`）。
   - 外置运行时、没有主对话时不建。
2. **叫醒前的检查**：巡看那条到点时，Core 先看在办的事，读法同「In Hand」背后的读取（`crate::assistant_todo::assistant_todo`，`core/src/managed_prompt.rs:509` 的注释）：用户没勾的待办、Galley 在办（没结束的子任务、还没到点的一次性提醒与任务）。例行不算（巡看自己更不算）。一件都没有，就不叫醒、不花 token，这次到点照样记下（当天不再补跑），并留下「跳过」的痕迹，快照脚本数得出来（优先复用 `last_wake` 一类现有字段的取值，不加迁移）。
3. **叫醒**：照现有的提醒叫醒走（`fire_reminder`，`core/src/scheduler.rs:247`；`crate::subtask_report::restore_pending_reminders`）：主对话空闲就立刻，在跑就等这一轮结束，在等用户回答时不发。叫醒文字点明这是每天早上的巡看、去读 `wake.md` 的那一节、上限两件子任务。
   - **送不出去时不发系统通知**：普通提醒送不出去会退回系统通知并用原话；巡看不能这样（会把英文的叫醒文字弹给用户）。送不出去就丢掉这一次。
   - 电脑 9 点在睡：照现有的补跑（当天醒来补，过了午夜不补，`scheduler.rs` 的 `catch_up_expires_at_local_midnight`）。补跑也先做 2 的检查。
4. **CLI**：`schedule list` 照常列出它（`origin` 里看得出 `galley-review`）。`schedule disable` / `enable` / `update` 对它照常有效。Agent API 只做加法；如果要动 JSON 字段，先读 `docs/agent-api/README.md`。

## 三、入口层（`core/src/managed_prompt.rs` 的 `main_chat_entry_layer`）

- 待办那一段补一句：用户在推进、没日子的事也记（指向 `todos.md`）；记下一件事时想一步，能做的做完再说、不提建议（指向 `unasked.md`）。
- 交文件：给用户一个它做出或找到的文件时，在回复里单独一行写 `[FILE:<绝对路径>]`，桌面会在气泡下画成文件卡片；话里也说一句是什么。今天主对话的回复从没带过这个标记（库里主对话 assistant 行的 `content` 里 0 条），它没被教过。GUI 已经能解析（`gui/src/lib/ipc/ga-output-cleaning.ts` 的 `finalAnswerFileRefs`），画卡片是票 74。
- 措辞自定，尽量短；照 `MAIN_CHAT_ENTRY_LAYER_BUDGET_BYTES`（`core/src/managed_prompt.rs:1304`）注释的写法补「Raised N → M by ticket 73」并写理由。入口层点名全部手册部分的地方加上 `unasked.md`。工作台、IM 的提示词不变。
- Windows CI 检出是 CRLF：Rust 原始字符串的字节预算要去掉 `\r` 再算，`contains` 别跨行（以往静态提示词 Windows 版比本机长 18 字节）。

## 四、给票 74 的契约

- 巡看那条的识别：`scheduled_tasks.created_by_supervisor = 'galley-review'`，经现有给 GUI 的定时任务 / 待办读取原样带出（`origin.supervisor` 或现有同义字段）。如果现有 IPC 结构带不出这个字段，按 `docs/ipc-protocol.md` 只做加法，并同步 `gui/src/types/ipc.ts`（Core-only 的 IPC 命令也要进这个镜像）。在回报里写清 GUI 该读哪个字段、取什么值。
- 文件标记：`[FILE:<绝对路径>]`，一行一个，出现在主对话 assistant 行的原始 `content` 里。

## 五、试用快照（`.scratch/assistant/closed-loop-snapshot.py`）

只读，加几项（`--since` 照旧）：它建的待办里没日子的几条；它取消的、用户取消的各几条（取消记录照票 61 的字段）；巡看到点几次、跳过几次、叫醒几次、其中开口几次（不是 `<no-reply/>`）；巡看那一轮派出了几件子任务。数不出来的项写明原因，不要猜。

## 六、评测（`.scratch/main-chat/entry-layer-eval/`）

先 `run.py --dry-test`，再真跑。改了 Rust 提示词要重新生成 `galley-prompt/`（README「怎么跑」最后一段）。新用例照各套件现有格式，判定写进 `expect`，每条两遍：

- **待办套件，该记**：
  - `half-done`：上下文两三轮在查阿里云费用暴涨、还没结论，用户说「先吃饭，回来再说」→ 记一条没日子的待办；可以当场做一步只读的或派一件子任务；回复一句话说记了什么、做了什么；不出现「要不要我……」。
  - `supplier-quote`：「供应商的报价还没回，我在等」→ 它自己回头查的提醒（现有规则：等外部结果），不是没日子的待办。
- **待办套件，不该记**：`guitar`（现有）、`tired-today`：「今天好累，不想动」→ 什么都不记、不派。
- **两可**（只记回复与动作，交 JC 读）：「下周三去上海出差」（会不会去查车次）、「季度报告我写了一半」。
- **叫醒套件，巡看**（叫醒文字照 Core 实际拼法）：
  - `review-nothing-to-do`：在办的只有一条 11-20 的装修待办、提醒挂好了 → `<no-reply/>`。
  - `review-advance`：在办的有「查清阿里云费用暴涨的原因」（没日子）→ 做一步或派 ≤ 2 件；只派出去、没结果时 `<no-reply/>`；有结果时开口，带出「早上过了一遍」。
  - `review-overdue`：有一条昨天到期、没勾的「交季度报告」→ 不催，`<no-reply/>`（除非还有别的可推进）。
  - `review-stop`：用户说「早上那个巡看别弄了」→ `schedule disable` 巡看那条（不是 delete），说一句已停、怎么恢复。
- **交文件**：`file-handover`：子任务回报说文件写在某个绝对路径（用临时目录里的假路径，不要本机真实路径）→ 交代里有 `[FILE:那个路径]`。
- **不退步**：待办、定时、叫醒三套原有用例全部重跑，通过率不低于票 63、64 重跑后的结果；入口层 15 条闲聊用例（`cases.json`）跑一遍，看有没有在闲聊里记待办、派子任务或写建议。
- 跟票 59 一样记下每条读了手册的哪几部分、多少字节、几次请求。
- 结果文件里不能出现私有接口地址、API host、本机绝对路径或本机真实数据。

## 七、打开白名单补文档格式

2026-10-21 JC 加进本票（「按建议推进，并进 73」）。票 74 的文件卡片里，PDF、Word、Excel 点了只能「在文件夹中显示」，HTML 只能在阅读面板里看源码：`core/src/local_file.rs` 的 `is_openable` 只放行 Markdown、图片和 `OPENABLE_TEXT_EXTENSIONS`。白名单是为了防脚本被「用默认应用打开」执行，但把无害的文档也挡在了外面。

- 加一组 `OPENABLE_DOCUMENT_EXTENSIONS`：`pdf`、`docx`、`xlsx`、`pptx`、`pages`、`numbers`、`html`、`htm`（HTML 用默认应用打开就是浏览器）。GUI 的镜像 `gui/src/lib/local-file-path.ts` 的 `isOpenableWithDefaultApp` 由票 74 同步，两边列表一字不差。
- 不放：老二进制格式 `doc`、`xls`、`ppt`，带宏的 `docm`、`xlsm`、`pptm`（都能带宏）；`key`（和私钥文件撞扩展名）；脚本类照旧。理由写在常量上方的注释里。
- `.pages`、`.numbers` 常存成包（macOS 上是文件夹）：`open` 对文件夹只在扩展名是这两个时放行，其余文件夹照旧拒绝，`inspect` 报的类型不变；`reveal` 对这两种包走 `reveal_item_in_dir`（在访达里选中它），不再 `open_path` 打开它（那等于用 Pages / Numbers 打开）。
- 测试：新放行的能过打开的闸，不放的仍被拒；`x.pages/`、`x.numbers/` 文件夹能过，`x.zip/`、`report.pdf/` 一类的普通文件夹仍拒；`reveal` 对包选中、对普通文件夹打开。

## 别动

- 主工作树：只在你的 worktree 里做，不碰主树，不跑 `tauri dev`。
- `gui/`（票 74）、`runner/`、`managed-ga/code/`、`cli/` 的代码（CLI 只在确实需要时做加法，并在回报里说明）。
- 别的提示词层：静态规则、建议、State、Main Chat 节、In Hand 的格式、IM、工作台。
- 手册里与本票无关的段落（权限的其余部分、CLI、子任务、改待办）。
- `core/` 不是 rustfmt-clean：只对自己改过的文件 `rustfmt --check`，不跑 `cargo fmt --all`。
- 提交只点名文件：`git add <文件…> && git commit …`，不用 `git add -A` / `git commit -a`；提交说明英文，结尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 探针、脚本 import `managed-ga/code` 时用 `python -B` 或 `PYTHONDONTWRITEBYTECODE=1`。

## 验证

- `cargo check --manifest-path core/Cargo.toml --workspace`、`cargo test --manifest-path core/Cargo.toml --workspace`（必须 `--workspace`）、改过的文件 `rustfmt --check`、`git diff --check`。
- 时间相关测试：`TZ=UTC` 与 `TZ=America/Los_Angeles` 各跑一遍相关测试（CI 跑在 UTC）。
- 评测：`--dry-test`，再按「六」真跑。
- 中文全角标点（手册是英文，但「」里的中文原话、票面 Comments 都要全角）。

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 手册改动的 diff 原样；入口层那一段的新旧原文、字节数与预算注释。
3. Core：种子与检查挂在哪（file:line），幂等怎么判，「跳过」的痕迹存在哪，送不出去时怎么丢；给票 74 的字段名与取值（「四」）。
4. 验证命令与结果原样。
5. 评测：新用例逐条结果，两可用例的回复原文，原有三套「票 63/64 → 本票」对比，闲聊用例里有没有乱记、乱派、写建议。
6. 快照脚本在主树数据库上跑一遍的输出（只读）。
7. 看到但没改的问题、没验证到的地方（原样列出）。

## 给 JC 的真机步骤

（真机步骤与票 74 合成一组，见票 74「给 JC 的真机步骤」的一到四站。）

## Comments

### 2026-10-21 实现回报（票 73 代理）

- **提交**（分支 `ticket-73-act-unasked`，未 push、未合入）：`7c918349` 手册、入口层与巡看；`b3b5a9b8` 打开白名单补文档格式；`77be46fd` 试用快照；`0d9dae29` Pages / Numbers 包能打开；`3e9c048c` 包的「在文件夹中显示」改成选中；`5920e65e` 文档；`2c45dd17` 在推进之事的措辞调一轮；`bc1e4192` 评测（gpt-6.1-sol）。
- **Core 挂在哪**：
  - 种子：`core/src/scheduler.rs` 的 `ensure_review`，调用在 `core/src/session_writes.rs` 的 `Writes::get_or_create_main_chat`（主对话建出、从归档恢复、桌面每次启动来要）与 `core/src/scheduler.rs` 的 `start`（Core 启动、定时循环开始前）。写入是 `core/src/db/schedule.rs` 的 `create_system_task_once`，一条 `INSERT … SELECT … WHERE NOT EXISTS`：只要有过 `created_via = 'system'` 且 `created_by_supervisor = 'galley-review'` 的行（启用、停用、已取消都算）就不建；外置运行时或还没有主对话（`ensure_assistant_available` 不过）不建。`created_via` 用 `system`，CHECK 收这个值。常量 `REVIEW_SUPERVISOR`、`REVIEW_TIME_OF_DAY`、`REVIEW_PROMPT` 在 `SCHEDULER_SUPERVISOR` 旁边。
  - 叫醒前的检查：`core/src/scheduler.rs` 的 `fire_review`，tick 遇到 `task.is_review()` 时调（补跑走同一条路）。读 `assistant_todo::assistant_todo`，`AssistantTodo::anything_in_hand`：你的事没勾的，或 Galley 在办（没结束的子任务、还没到点的一次性提醒与任务）；例行不算。一件都没有就 `mark_scheduled_wake_skipped`：`last_fired_at`、`last_due_at` 照记（当天不再补跑），`last_wake` 置 NULL，不叫醒、不花 token。读失败按有事叫醒。`schedule run` 手动跑不做这个检查。
  - 「跳过」的痕迹：行上的 `last_wake` 为 NULL（叫醒过的是 `pending` / `delivered`）；每一次另追加进 prefs 的 `assistant_review_log`（JSON 数组，最多 400 条，事件 `skipped` / `woke` / `run` / `dropped`，`core/src/db/prefs.rs` 的 `append_pref_log`，每步一条语句）。不加迁移。只靠 `last_wake` 只看得到最近一次，所以加了这份记录。
  - 叫醒措辞：`core/src/subtask_report.rs` 的 `OPENING_REVIEW` 与 `review_paragraph`（这是每天早上的巡看、Galley 建的不是你设的、去读 `wake.md` 的「The morning review」、最多两件子任务、只派了子任务或什么都没做就 `<no-reply/>`；晚了只写时间，不让说晚）。存在库里的 `prompt` 是给 `schedule list` 与「In Hand」看的一句英文说明，叫醒文字由 Core 现拼，以后改措辞对已建的那条也生效。
  - 送不出去：`return_due_tasks` 遇到巡看走 `drop_review_wake`：`drop_scheduled_wake` 把 `pending` 改成 NULL、日志记 `dropped` 和原因，不发 `scheduled-tasks:reminder-undelivered`。等用户回答、runner 起不来、那一轮出错、主对话没了四条路都汇到这里（测试覆盖了前三条）。
  - 外置运行时：tick 里 `ensure_assistant_available` 不过，巡看与现有 `target = assistant` 的提醒一样不触发、不盖戳、不通知、不报错；切走前已经 `pending` 的一次留着，切回内置后照提醒的规矩送达（可能晚了几天，措辞让它不提晚）。
  - 「已完成」：巡看的到点永远不进 `done` 组（`assistant_todo.rs` 的 `build_todo`，叫醒或跳过都一样），例行组照常有它。「In Hand」里那一行写「Galley's morning review, not set by you」，不再是「set by the outside agent galley-review」（手册对外部 agent 的任务要先问）。
- **给票 74 的字段与取值**：
  - 清单面板读 `list_assistant_todo`：`routine` 组里 `kind === "task"` 且 `agent === "galley-review"` 的那一项（`createdBy` 是 `"agent"`，`creator()` 没改，标签原样进 `agent`）；它的到点不进 `done`。
  - 定时任务读取（Tauri `list_scheduled_tasks`、CLI `schedule list` / `show`）：`origin` 是 `{"via": "system", "supervisor": "galley-review"}`。IPC 与 Agent API 都没加字段。
  - 文件：主对话 assistant 行原始 `content` 里，一行一个 `[FILE:<绝对路径>]`。
- **七、打开白名单**：`core/src/local_file.rs` 加 `OPENABLE_DOCUMENT_EXTENSIONS`（`pdf`、`docx`、`xlsx`、`pptx`、`pages`、`numbers`、`html`、`htm`，与 GUI 的 `isOpenableWithDefaultApp` 一字不差）；`doc`、`xls`、`ppt`、`docm`、`xlsm`、`pptm`、`key` 不放，理由写在常量注释里。`open` 的闸改成 `may_open`：文件夹只在扩展名是 `pages` 或 `numbers` 时放行；`reveal` 对这两种包走 `reveal_item_in_dir`（`reveal_opens_folder`），其余文件夹照旧打开。测试只测到闸，不真的调系统打开。
- **评测**（gpt-6.1-sol，条目 `mm_1792576875658`，与票 63、64 同一个模型；详见 `.scratch/main-chat/entry-layer-eval/README.md`「主动的第一阶段（票 73）」）：原有用例对 main 上的基线，待办 64/64 → 63/64（剩下一遍是判定误伤，回答本身对），定时 28/28 → 28/28，叫醒 16/18 → 18/18，闲聊 14/14 → 14/14（第一版措辞下 12/14，调了一轮）；新用例 12/14（`half-done`、`supplier-quote` 各有一遍把话只写进了 `<summary>`），同一批新用例在 main 的提示词下 5/7；`file-handover` 2/2（main 的提示词下写成了 Markdown 链接）。巡看四条八遍全过：没事就 `<no-reply/>`；有事时一遍去浏览器看账单（停在浏览器工具，看不到结果），一遍派 1 件只读的子任务再沉默；逾期不催；「早上那个巡看别弄了」用 `schedule disable` 并说怎么恢复。先跑过一轮 gpt-6-astra（结果只留在 scratchpad，没进仓库），结论大体一致。
- **调的那一轮措辞**：第一版下闲聊组两条带过来的对话记了待办（「回来了」接着谈报价、选定笔记本后问注意事项），用户都在接着办。入口层改成「what they are in the middle of and set aside to come back to」（3132 → 3140 字节），`todos.md` 改成「sets aside to come back to … they stop here for now」并加「Not while they carry on with it here」。只重跑了这两条和待办「在推进」「两可」五条。
- **没改的**：`authority.md` 里没有与「能撤回的准备不用问」冲突的句子，没动。`wake.md` 只改了与巡看直接相关的两句（叫醒消息的种类里加上巡看；`<no-reply/>`「Never write it in any other reply」后加巡看的例外）。

### 看到但没改、没验证到的

1. 「In Hand」里巡看那一行的说法改了（票面说 In Hand 的格式别动；改的是这一条的「谁建的」，格式没变）：不改的话它读成外部 agent 的任务，手册让它停之前先问。
2. GUI 的「定时」对话框（`ScheduledTasksDialog`）列定时任务时会显示巡看那条的英文 `prompt`；票 74 只管清单面板，这里没人管。
3. 巡看的 `prompt` 建的时候写进库，以后改 `REVIEW_PROMPT` 不会改已建的那条（叫醒文字是 Core 现拼的，不受影响）。模型用 `schedule update --prompt` 改它也只改显示的那句。
4. `wake.md` 里原有的例子「要不要约个时间验收？」是问用户自己的事、不是「要不要我」，没动；判定的 `OFFER_RE` 也不把它算建议。
5. 评测：巡看那条的钟点取运行那一分钟（好让叫醒按时），所以叫醒措辞里的规则是「every day at 运行那一分钟」，不是 09:00；巡看几条放在待办套件（它有待办与定时的假 CLI、叫醒照 Core 的措辞），叫醒套件只放了 `file-handover`。
6. 评测：第二轮只重跑了七条，其余用例是第一版措辞下的结果；`whats-left` 第 2 遍的判定误伤没改判定（`forbid_unless` 认的词里没有「不在」）。
7. 评测脚本读 Galley 库：新加的模型还在 WAL 里，`immutable` 读不到，改成读不到时退回普通只读（`mode=ro`，不写库，只在 `-shm` 里留读者标记）。
8. 先用 gpt-6-astra 跑的那一轮存在 scratchpad 的 `t73-astra/`，没进仓库。
9. 没跑 `tauri dev`，没在真机上看巡看的建出、跳过、叫醒、停掉，也没看 GUI；Core 的路径只由 `core/tests/schedule_wake_test.rs`、`main_chat_test.rs` 和单元测试覆盖。
10. `core/src/scheduler.rs` 本来就不是 rustfmt-clean（`fire` 的签名、一处测试），这两处没动。
