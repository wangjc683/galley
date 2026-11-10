# 154 重复的待办：规则加「这一期」（Core 与命令）

Status: done（2026-11-10 代理两轮交回，rebase 后快进合入 `be549439`（Core 与 CLI）、`38752983`（Agent API 文档）、`6adbdb91`（第二轮：重挂从到期日起数、没有任务的这一期补挂）。主会话验收：读过 `todo_repeat.rs` 的日期计算、`db/todo.rs` 的了结与生成、每个 tick 的那一遍、巡看判据与「最近不要的跟进」的改动；在 worktree 复跑 `cargo test --workspace` 本机与 `TZ=UTC` 各 1,395 条全过，协议漂移、文档链接、`git diff --check` 过，新增行没有本机路径。合入前 `busy:0`、库先备份；合入后迁移 057 在真实库上跑完，待办条数不变；dev 的 CLI 已重编替换。dev 真机走查（CLI，测试数据标明是本票的）：建每天重复的一件（规则与「提前 1 天 08:00」记对）→ 到期日挪到今天、勾掉 → 下一期到期明天、自己的提醒时刻已过所以没挂 → 55 秒后调度器真实的 tick 给它补挂到次日 08:00（记成 `galley-repeat` 建的，待办的 `updated_at` 没动）→ 跳过它，再下一期当场带提醒 → 已勾掉的一期跳过被拒 → 取消勾后两期并存 → 删掉其中一期，规则结束，另一期成了普通待办、提醒还在 → 规则结束后再跳过报 `not_repeating:` → 删掉。走完后三件都是取消的样子（软删，与票 87 的测试数据同样留在库里，面板与「最近不要的跟进」都不显示）、规则已结束、三个提醒任务都已取消，没有一个响过。给人看的部分随手册票 155 与面板票一起验）

来源：[主聊天 PRD](../PRD.md) 裁决 204（JC 2026-11-10），定位见裁决 202（那一条一定在：日子、提醒、下一期由 Core 算）。本票只做 Core、CLI、给面板的数据与文档；手册与评测、面板各另有一张票。只在内置运行时；外置运行时没有主对话与待办，写命令照旧 `assistant_unavailable:`，零变化。Agent API 在 `schemaVersion: 3` 内只做加法（先读 [agent-api](../../../docs/agent-api/README.md) 与 [todo-commands](../../../docs/agent-api/todo-commands.md)）。

先读 [dispatch](../../../docs/agents/dispatch.md)「Standing constraints for executor agents」。

## 为什么

- 「每周一交周报」按手册自己的判法（你不理这次提醒，这件事还要留在清单上吗）是待办，可待办记录里放不下规则，现在只能记成 Galley 自己的重复提醒：没有方框、不进「今天 N」、不会逾期、每期叫醒模型一轮、那天电脑没开过了午夜就丢。
- 定的做法：规则单独存；任何时候至多一件没了结的「这一期」，它是一件普通待办。这一期勾掉或被跳过时，Core 在同一个事务里按规则生出下一期。不靠定时器，不调模型。

## 词

- **规则（series）**：一条重复规则连同下一期要带的东西。
- **这一期（period）**：规则名下的一件待办，`todos` 里的普通一行。
- **了结**：勾掉（done）或跳过（skip）。

## 数据

迁移 `057`（接在 `056` 后面；测试库走 `apply_all_migrations_for_tests`，升级测试里手写的部分迁移列表要看一眼）。不加外键，理由同 `050` 文件头。

- 新表 `todo_series`：`id`（`series_<16 hex>`，Core 铸）；下一期要带的 `title`、`notes`（可空）、`items`（JSON 字符串数组，可空）；规则 `repeat_kind`（`daily` / `weekly` / `monthly` / `yearly`）、`repeat_every`（整数，至少 1）、`repeat_days`（逗号分隔：每周是 ISO 星期 1–7，每月是 1–31；其余为空）、`anchor_date`（`YYYY-MM-DD`，间隔的相位从这一天数）、`time_of_day`（`HH:MM` 本地，到期带时刻时才有）；提醒 `remind_days_before`（整数）与 `remind_time`（`HH:MM` 本地），两个一起有或一起空；`ended_at` 与谁结束的三元组（写法照 `051` 的 `cancelled_*`）；谁建的三元组；`created_at`、`updated_at`。
- `todos` 加两列：`series_id`（可空）、`skipped`（整数，默认 0）。
- 重置主对话时规则跟着待办一起删（`core/src/main_chat_reset.rs`）。

## 规则怎么算下一期

写成一个不碰数据库的纯函数模块（建议 `core/src/todo_repeat.rs`），时区作参数传入（照 `build_todo<Tz>` 的写法），单元测试覆盖下面每一条，并在 `TZ=UTC` 与一个西半球时区下各跑一遍全量测试。

输入：规则、`after`（一个本地日子）。输出：规则在 `after` **之后**（不含当天）的第一个日子。

- `daily`，每 N 天：`anchor_date + k·N 天`。
- `weekly`，每 N 周、星期集合 W：从 `anchor_date` 所在的 ISO 周（周一起）数，隔 N 周的那些周里，星期在 W 里的日子。
- `monthly`，每 N 月、日子集合 M：从 `anchor_date` 所在的月数，隔 N 月的那些月里，M 里的每个日子；那个月没有这一天就落在月末（同定时任务的每月规则）。季度是 `monthly` 加每 3 月。
- `yearly`，每 N 年：`anchor_date` 的月与日；2 月 29 日在平年落在 2 月 28 日。

`after` 取「今天（这台机器的时区）与这一期到期日里较晚的那一天」：

- 周一的事逾期一周、今天周一才勾：下一期是下周一，不是今天。
- 提前勾（周四勾了下周一的）：下一期是再下一个周一。
- 每天的事，昨天那期今天才勾：下一期是明天。

到期带时刻的（`time_of_day`）：下一期是那一天的那个本地时刻，存成 `due_at`；只有日子的存 `due_date`。

## 行为

1. **建**：`todo add` 带重复规则时建一条规则和第一期。必须有 `--due`，没有就 `invalid_args`，消息以 `repeat_needs_due:` 开头，什么都不写。第一期的到期日就是给的那一天（不要求它落在规则上），`anchor_date` 取它；带了 `--remind-at` 就由「提醒的本地日子比到期日早几天」和「提醒的本地时刻」推出 `remind_days_before`、`remind_time`。规则的 `title`、`notes`、`items` 取这件待办此刻的样子。
2. **了结时生出下一期**：`complete_todo`（勾掉，桌面或 CLI）与新的跳过，在写下这一期状态的同一个事务里：这条规则没结束、且名下没有别的没了结的待办，就生出下一期。
   - 下一期：`title`、`notes`、`items`（全部没勾）取规则里存的；到期日按上一节算；`series_id` 指向规则；谁建的记成 `{"via":"system","supervisor":"galley-repeat"}`（写法照巡看那条 `galley-review`）；`created_in_*` 为空（回复下不挂卡片）；`created_at` 与 `updated_at` 是同一个时刻。
   - 下一期的提醒：规则有 `remind_*` 就挂在「到期日往前 `remind_days_before` 天的 `remind_time`」；这个时刻已经过了就不挂，不报错。提醒的任务同样记成 `galley-repeat` 建的，走现有的 `set_todo_reminder` 那条路。
   - 已经勾掉的再勾一次不变，也不再生。
3. **跳过**：新写入 `skip_todo`：这一期软删（`cancelled_at` 与谁跳过的三元组照 `cancel_todo` 写），另记 `skipped = 1`，提醒照 `cancel_todo` 放掉，然后照第 2 条生出下一期。不是重复的待办，或规则已结束：`invalid_args`，消息以 `not_repeating:` 开头。
4. **删除**（现有的 `cancel_todo`）：这一期照旧软删，规则同时结束（`ended_at` 与谁结束的记成同一个 origin），不生下一期。
5. **不再重复**：规则结束，这一期原样留着，成了一件普通待办（`series_id` 留着，输出里不再有 `repeat`）。
6. **取消勾**（`reopen_todo`）：只把这一期打开，不删已经生出的下一期；于是可能同时有两件没了结的。之后勾掉其中一件时，另一件还开着，不生；全了结时才生。
7. **改这一期**（`update_todo`，桌面或 CLI）：标题、备注、到期、提醒都只动这一期，不动规则。例外是带 `series: true`（CLI `--series`）：改完之后把规则存的那一份照这一期重拍一遍：`title`、子项的字、提醒相对到期日的偏移（没有提醒就清空）、到期的时刻；`notes` 只在这一次命令里给了 `--notes` 时才进规则（这一期的备注里叠着进展，不能整段带走）；这一次给了 `--due` 的话 `anchor_date` 换成新的到期日。
8. **给一件普通待办加规则 / 换规则**：`update_todo` 带重复规则。原来不重复的：照第 1 条建规则（要有到期日，否则 `repeat_needs_due:`）。原来重复的：换掉规则的 `repeat_*`，`anchor_date` 取这一期的到期日，别的不动。
9. **重复的待办不能拿掉到期日**：`--no-due`（socket 的空 `due`）对重复的这一期是 `invalid_args`，`repeat_needs_due:`。
10. **巡看的叫醒判据**（`AssistantTodo::review_has_something_to_look_at`）：Core 生出的下一期，不因为「刚生出来」算动过；有人改过它（`updated_at` 晚于 `created_at`）才算。「到期日这次才进 3 天窗口」那一半照旧算。效果：每天重复的事不会让巡看天天醒；每周及更长的，每期进窗口时醒一次。写测试钉住这两种。
11. **「最近不要的跟进」**（`declined_items`）：跳过的那一期（`skipped = 1`）不列。删除重复的待办照旧列。
12. **「在办的事」**（`core/src/managed_prompt.rs` 的 `in_hand_section`）：重复的待办那一行带上规则（英文，照例行那一组写规则的口径，如 `repeats weekly on Mon`、`repeats every 3 months on the 15th`）。改了这一节的格式，grep `.scratch/main-chat/entry-layer-eval/` 里照它写的镜像，在回报里列出位置，不要改（手册与评测那张票改）。
13. **没了结的这一期，到了后面每一期的日子照样提醒**（2026-11-10 派票后补，主会话已通知代理）：提醒挂在每一期上、只响一次，下一期又要等这一期了结才生出来；不补这一条，交了周报忘了勾、或每天的事漏了一天，之后就再也不响。规则有 `remind_*`、这一期还开着、它的提醒任务还在（没被取消）且已经响过并有了结果（送到了，或没送到、已转成系统通知）时，把这同一个提醒任务重新挂到规则下一个日子对应的提醒时刻：下一个日子照「规则怎么算下一期」算，`after` 取今天与这一期到期日里较晚的那一天；算出的提醒时刻已经过了就再往后取一期。这一期自己的到期日不动（照旧逾期），不生新的一行。
    - 不重挂的：这一期了结了、被删了、规则结束或「不再重复」了；用户在面板上「取消提醒」或 `--no-remind` 去掉了这一期的提醒（任务已取消，不新建；下一期照规则挂）。
    - 做法要是库里状态的纯函数：重启不丢，重复执行不多挂（建议在调度器现有的 tick 里扫一遍）。不改触发与送达的状态机；提醒还没有结果（`lastWake` 是 `pending`）时不许动它。
    - 测试：每天的事没勾，第二天同一行再响；每周的事逾期两周，响过三次仍只有一行、到期日没动；了结之后只剩下一期自己的提醒；取消提醒后不重挂；连扫两遍不多挂。
    - **验收时再补两处**（2026-11-10，主会话读完第一版后通知代理）：① 重挂从这一期自己的到期日往后数，一期一期找到提醒时刻还没过的那一个，不从「今天与到期日里较晚的那一天」起算（上面那句是主会话写错的）：周一 9:00 提醒的事逾期一周，电脑关了一周、周一 8:00 才开，当天 9:00 这一响不能丢。② 没有提醒任务的这一期也要补挂：生成时自己的提醒时刻已经过了（周日 21:00 才勾掉上一期，新一期的提醒是周日 20:00），或了结的事务提交后、挂提醒前崩了，这一期名下一条提醒任务都没有，原写法「把同一个任务重新挂」就永远轮不到它。规则：名下一条任务都没有（取消了的也算有）就补挂一个，先看这一期自己的提醒时刻，过了再往后找；有取消了的任务说明是人或 Galley 有意去掉的，不补。

## 命令（Agent API，`schemaVersion: 3` 内加法；`--schema=1`、`2` 照 `todo` 家族现状也认）

- `todo add` 与 `todo update` 加规则的旗标，写法照 `schedule create` 已有的那几个（先读 `cli/src/args.rs` 里 `schedule` 的定义，能共用就共用）：`--daily`、`--weekly=<days>`（1 = 周一 … 7 = 周日）、`--monthly=<days>`（1–31）、`--yearly`，四选一；`--every=<n>`（默认 1，只能和四个之一同给）。`todo update` 另加 `--no-repeat`（第 5 条）与 `--series`（第 7 条）。旗标给错的组合是 `invalid_args`。
- 新命令 `todo skip <todo-id> [--supervisor] [--reason]`（socket `todo.skip`）。
- `Todo` 加字段（都是可选，没有就不出现）：
  - `repeat`：`{"kind":"weekly","weekdays":[1],"every":2,"remind":{"daysBefore":1,"time":"20:00"}}`。`kind` 四种；`weekdays` 只在 `weekly`、`monthdays` 只在 `monthly`；`every` 是 1 时不出现；`remind` 没有就不出现。只在规则没结束时出现。
  - `seriesId`：这件待办属于（或属于过）哪条规则。
  - `skipped`：`true`，只在被跳过的那一期上。
- `todo done` 与 `todo skip` 的输出在 `{"todo": …}` 之外多一个可选的 `next`：生出的下一期（没生就不出现）。
- `todo list` / `todo show` 照旧，每一期就是一件待办。

## 给面板的数据（本票只给数据，不画）

- `list_assistant_todo` 的 `TodoItem`：待办带上规则与 `seriesId`。`TodoItem` 上已有一个给定时任务用的 `repeat` 字段（`ScheduledTaskRepeat`），待办的规则另起名字，别混用。
- Tauri 命令：`skip_todo(id)`、`stop_todo_repeat(id)`（等于 `update` 带「不再重复」，origin 是 `gui`），照 `cancel_todo` 那几个的写法注册；写完照旧广播 `todos:changed`。
- `gui/src/types/ipc.ts` 里对应的类型与命令镜像补上（只加类型；`scripts/check-ipc-protocol-drift.mjs` 要过）。GUI 别的文件不碰。

## 文档

- `docs/agent-api/todo-commands.md`：开头的概述加一段「Repeating」，§5.28 表里加三行，§5.31、§5.32、§5.33、§5.34 各补上面的行为，新增 `todo skip` 一节（编号接在 §5.34e 之后）；每处标「Added 2026-11-10（main chat ticket 154）」。`docs/agent-api/README.md` 的命令索引、别处列着 `todo` 命令清单的文档（grep `todo.item_move` 找）一并补。
- `docs/architecture.md` 等散文里说到待办记录结构的地方，只在说法与现状冲突时改一句。
- 迁移文件头照 `050`、`054` 的写法，把上面的规则写清楚。

## 别动

- 助理手册（`docs/managed-ga-runtime/galley-assistant-manual/`）与评测（`.scratch/main-chat/entry-layer-eval/`）：票 153 在改，重复的手册另有票。Core 里若有测试要求手册列全 CLI 命令，在回报里写，不要改手册。
- `docs/design/` 与 GUI 的组件、store、文案：票 152 在改；面板怎么画另有票。GUI 只许动 `gui/src/types/ipc.ts`。
- 定时任务（`scheduled_tasks`、`scheduler.rs` 的触发）：下一期的生成不经过调度器；只许为第 13 条在现有的 tick 里加那一遍重挂，触发与送达的状态机不改。
- 不做：日子串（Core 表达不了的规则）、规则的结束日期或次数、「连着跳过几期来问」。
- `.scratch/main-chat/PRD.md` 与别的票。主工作树；不跑 `tauri dev`。

## 验证

```bash
cargo check --manifest-path core/Cargo.toml --workspace
cargo test --manifest-path core/Cargo.toml --workspace
TZ=UTC cargo test --manifest-path core/Cargo.toml --workspace
TZ=America/Los_Angeles cargo test --manifest-path core/Cargo.toml --workspace
pnpm --dir gui typecheck
pnpm --dir gui lint
node scripts/check-ipc-protocol-drift.mjs
node scripts/check-docs-links.mjs
git diff --check
```

- Rust 只格式化自己动过的文件，逐个 `rustfmt --check`；不跑 `cargo fmt --all`。
- 用开发版 CLI 在一个假 HOME（临时目录里的空数据库）下把「建、勾掉、看下一期、跳过、不再重复、删除」走一遍，输出贴进回报；内置运行时与主对话这个前提怎么在假库里满足，照现有 CLI 测试的做法。走不通就写明卡在哪，别动真实数据目录。
- 测试至少覆盖：四种规则与间隔的日期计算（月末、闰年、跨年、间隔的相位、带时刻、两个时区）；逾期后勾掉与提前勾掉；生成在同一事务里（勾掉失败不留半截）；取消勾之后两件并存、再勾不重复生；跳过；删除结束规则；不再重复；`--series` 重拍的每一样；提醒的偏移与「时刻已过不挂」；巡看判据两种；「最近不要的跟进」不列跳过的；重置主对话清规则；外置运行时拒写。

## 回报格式

照 dispatch「The report has four parts」。另外：

1. 最终的表结构与 `Todo` 新字段的一条真实输出样例（假库里的）。
2. 票面没写到、你自己定的边界（逐条）。尤其：旗标的组合校验、`--every` 的上限、`weekly` 不给星期时怎么办。
3. 「在办的事」那一行的最终写法，和评测镜像的位置清单。

## 真机步骤

合入前主会话看 `busy:0`；合入重启 Core；dev 的 CLI 要另外重编替换（`tauri dev` 不重编 CLI）。

| 主会话代验 | 只有 JC 能验 |
|---|---|
| 用 dev 的 CLI 建一件每周重复的测试待办（`--reason` 标明是票 154 的测试数据），勾掉、查库看下一期与提醒，跳过，删除，逐步查库；测完清掉 | 面板与手册的票合入之前没有要 JC 看的；之后在面板上勾一件重复的事，看下一期出现得对不对 |

## Comments

### 2026-11-10 代理回报摘要（主会话记）

- **票面一处前提错了**：`gui/src/types/ipc.ts` 是 Core 与 runner 的协议镜像，没有待办的类型；待办的 TS 镜像在 `gui/src/lib/assistant-todo.ts`。代理没动 GUI，`TodoItem.todoRepeat` / `seriesId` / `skipped`、`TodoBrief.repeat` / `seriesId` / `skipped` 与 `skip_todo`、`stop_todo_repeat` 的封装由票 156 补。
- **代理自己定的边界**：四种规则旗标互斥，`--every` 要和其一同给，`--no-repeat` 与规则旗标、`--every`、`--series` 互斥；`--every` 1–365；每周不给星期就拒绝，不替用户取到期日的星期；下一期从「今天、这条规则名下每一期到期日」里最晚的一天之后算（取消勾再勾时不会生出同一天）；已勾掉的一期不能跳过、不能 `--series`；提醒可以在到期日之后（偏移为负）；规则没结束时每一期（含已勾掉、已跳过的）都带 `repeat`；Core 生成的一期被用户删掉算「最近不要的跟进」，跳过的不算；`TodoItem` 也带 `skipped`，卡片分得出跳过与删除。
- **「在办的事」那一行**：规则写在到期与逾期之后、提醒之前，如 `due 2026-10-19 (Mon), repeats weekly on Mon, reminder 2026-10-18 20:00 (Sun): 交周报`；另有 `repeats daily`、`repeats every 2 weeks on Mon, Thu`、`repeats every 3 months on the 15th`、`repeats yearly` 等。规则结束的不写。评测里照它写的镜像（`run.py` 的 `in_hand_block`、`schedule/rust-samples.json`、两份 `cli-help.json`）由票 155 跟上。
- **没验证到的**（原样）：每个 tick 的那一遍在真实运行的调度器里没跑过（主会话合入后在 dev 里补验了「没有任务的这一期补挂」这一支，「响过之后重挂」这一支要等一个提醒真的响，没有在真实库里做）；夏令时只在纯函数测试里覆盖；补挂与重挂的提醒时刻必须按真实时钟在未来（任务那条路查的是真实时间）；数据库测试若跨本地零点运行，期望日期可能差一天；`skip_todo`、`stop_todo_repeat` 两个 Tauri 命令没经桌面调用过。
- **一个显示上的后果**：提醒响过会立刻被挂到下一期的时刻，一件还没逾期的事，行上的铃铛可能指向到期日之后；面板怎么画留给面板票。
- **票外**：手册 `todos-change.md` 与设计文档 `reply-cards.md` 列着 `todo` 的命令，都没动（分别归票 155、面板票）。
