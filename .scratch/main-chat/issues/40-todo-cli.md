# 40 CLI：`galley todo` 命令族

Status: merged（2026-10-17 快进合入 main，提交 `2cdddb9f`、`c2c3e97f`；真机随票 42 一起验，真模型随票 41）

来源：主聊天 PRD 裁决 91。依赖 39。改 Core 的 socket 处理、CLI 与 Agent API 文档；不改界面。

## 目标

Galley（和任何外部 agent）能经 CLI 记下、查看、改、勾掉、取消待办，并给待办设、改、去掉提醒。Agent API `schemaVersion: 3` 只加不改（宪法 Rule 3），照票 34、35 的做法（socket 处理、CLI 子命令、`cli/tests` 端到端、文档、稳定前缀）。

## 要做

- 命令（名字与参数你定，照 `schedule`、`session` 的风格）：
  - `galley todo list [--all]`：默认没做完的；`--all` 带做完与取消的。每行一个 JSON：id、标题、备注、截止（照票 39 的存法输出，带「有没有时刻」）、提醒（时刻与定时任务 id）、状态、做完时刻与谁勾的、谁建的（`origin`）、建在哪一句。
  - `galley todo show <id>`。
  - `galley todo add "<标题>" [--notes=…] [--due=<日期或时刻>] [--remind-at=<时刻>] [--supervisor] [--reason]`：`--due` 收本地日期（`2026-10-18`）或时刻（照 `schedule create --at` 的写法）；`--remind-at` 建一个挂在它上面的提醒（叫醒助理，过去的时刻报 `time_in_past:`）。
  - `galley todo update <id> [--title] [--notes] [--due | --no-due] [--remind-at | --no-remind]`：只改给了的。
  - `galley todo done <id>`、`galley todo reopen <id>`、`galley todo cancel <id>`。
- 写命令都记来源；「建在哪一句」照票 34 的认法（`--supervisor=galley-assistant` 且主对话有一轮在跑）。
- 外置运行时：待办是助理的，`add` 等写命令在外置下报 `assistant_unavailable:`（照票 34 的前缀）；读命令照常。
- 不给待办做「立即运行」这类东西。

## 文档

- `docs/agent-api/` 新增 `todo-commands.md`（照 `schedule-commands.md` 的格式），README 路由表、`docs/agent-api.md` 节表、`stability-and-versioning.md`（稳定前缀、枚举、§7.1 一条）跟着加。

## 验收

- CLI 集成测试（`cli/tests/`，unix）：每条命令成功与失败；`--due` 两种写法；`--remind-at` 建出提醒、`done` 后提醒被取消；外置下写命令被拒；`--schema=3` 下输出；旧命令输出不变。
- `cargo test --manifest-path core/Cargo.toml --workspace`（本机时区与 `TZ=UTC`）、六个门禁、`git diff --check`、中文标点扫新增行。

## Comments

### 2026-10-17 实现回报（子代理，分支 `mc-todo-cli`）

**命令**（`schemaVersion: 3` 内只加不改；socket 在 `1`、`2`、`3` 下都答，`4` 是 `schema_mismatch`；写命令都收 `--supervisor` / `--reason`）

| CLI | socket | 输出 | 背后的 Core 函数（票 39） |
|---|---|---|---|
| `todo list [--all]` | `todo.list {all?}` | NDJSON，每行一个待办；socket 是 `{"todos": […]}` | 新的 `assistant_todo::todo_list`（`list_todos(Open / All)` 再排序） |
| `todo show <id>` | `todo.show {todoId}` | 待办本身；socket 是 `{"todo": …}` | `SqliteGalley::todo` |
| `todo add "<标题>" [--notes] [--due] [--remind-at]` | `todo.add {title, notes?, due?, remindAt?, supervisor?, reason?}` | `{"todo": …}` | `Writes::create_todo` |
| `todo update <id> [--title] [--notes] [--due \| --no-due] [--remind-at \| --no-remind]` | `todo.update {todoId, title?, notes?, due?, remindAt?, …}` | `{"todo": …}` | `Writes::update_todo` |
| `todo done <id>` / `reopen <id>` / `cancel <id>` | `todo.done` / `todo.reopen` / `todo.cancel {todoId, …}` | `{"todo": …}` | `Writes::complete_todo` / `reopen_todo` / `cancel_todo` |

输出就是票 39 的 `TodoBrief`（文档里叫 `Todo`，§5.28）。例（测试里实际打出的一行）：

```text
{"id":"todo_79ce81a15a975727","title":"交季度报告","notes":"带合同","due":{"date":"2026-10-20","hasTime":false},"reminder":{"taskId":"sched_6aba6fababddd64e","at":"2026-10-16T17:11:27+00:00","state":"scheduled"},"status":"open","origin":{"via":"supervisor","supervisor":"galley-assistant","reason":"user mentioned it"},"createdAt":"2026-10-16T16:41:27+00:00","updatedAt":"2026-10-16T16:41:27+00:00"}
```

**票面留给我定的**

1. **名字**：照票面 `list / show / add / update / done / reopen / cancel`，与「在办的事」里写的 `todo list`、注释里的 `todo show`、票 41 写的 `todo done` 一致，提示词与它的测试不用改。socket 名照 CLI 名（`todo.add`，不是 `todo.create`），同 `schedule create` ↔ `schedule.create`、`session new` ↔ `session.new`。
2. **清空的写法**：CLI 用票面的 `--no-due` / `--no-remind`；`--notes=` 给空值清空备注（同 `schedule update --project=`）。线上照 `schedule.update` 的先例：`notes`、`due`、`remindAt` 给空字符串就是清空，CLI 的 `--no-due` / `--no-remind` 发的就是空字符串。CLI 的 `--due=`、`--remind-at=` 给空值在参数层就拒（退出码 2）：免得一个没填上的变量悄悄删掉截止或提醒，要删就写 `--no-…`。
3. **`update` 什么都没给**：CLI 在参数层拒（至少一个改动参数），socket 报 `invalid_args`（「nothing to change」），同票 35 的 `project update`；不让空改动白刷一次 `updatedAt`。
4. **`list` 的顺序**：默认照界面「你的事」的顺序：今天与逾期（逾期在前）、以后、随时（记下的先后）。新函数 `assistant_todo::todo_list_order` 直接取 `build_todo` 排出的顺序，不另写一套规则；`--all` 在后面接已完成（新勾的在前）与已取消（新取消的在前）。理由：Galley 答「还有什么没办」时读到的先后与你在面板上看到的一样（裁决 86「你看到的就是它看到的」）。同一秒记下、都没有截止的两件，按 id 定先后（同面板）。
5. **读命令直连 SQLite**（照 schedule）：Core 没开也能读；截止的 `date` / `time` 按 CLI 进程的本机时区读出。socket 的 `todo.list` / `todo.show` 在 Core 进程里读，同一台机器结果一样。
6. **错误**：没有新的前缀与错误类别。`time_in_past:`（`--remind-at` 已过）、`assistant_unavailable:`（外置运行时或还没有主对话，任何写）沿用票 34 的两个，稳定前缀表这两行的「Where」加上 `todo`；未知或已取消的 id 是 `not_found`（3）；Core 没开时写命令 `db_unavailable`（4）。新枚举：`Todo.status`（`open / done / cancelled`）、`Todo.reminder.state`（`scheduled / paused / fired`），已进 §1.1。

**与票面不同、或我加的**

1. **「写命令都记来源」只做到 Core 有地方记的**：`add` 记成待办的 `origin`，`done` 记成 `doneBy`，`add` / `update` 建或改的提醒记在任务的 `origin`；`reopen`、`cancel` 收 `--supervisor` / `--reason` 但票 39 的表没有列可存（没有「谁取消的」，取消勾会清空 `done_*`），没加迁移。要记得以后加列。
2. **「建在哪一句」只在 `add` 记**：照票 34 的判法（`--supervisor=galley-assistant` 且主对话有一轮开着），`schedule_cmds.rs` 的 `created_in` 改成 `pub(super)` 复用，没复制。`update --remind-at` 新建的提醒任务不记（票 39：提醒的卡片由待办出）。
3. **没加 `overdue` 字段**：`TodoBrief` 也是界面三个命令的返回，票 42 正在镜像它的类型，读时算出的字段放进去会牵动界面；逾期从 `due` 与当前时刻看得出，「在办的事」已经标出逾期。以后要加可以只加不改地加。
4. **没有单独的「取消提醒」命令**：`update --no-remind` 就是（和界面的「取消提醒」同一个结果：任务软取消、待办不动；没有提醒时它什么也不做，不报错）。没有「立即运行」。

**改了哪些文件**

- Core：`core/src/socket_listener/todo_cmds.rs`（新，七个处理函数）、`socket_listener/mod.rs`（分发表）、`socket_listener/schedule_cmds.rs`（只放开 `created_in`）、`protocol/commands.rs` 与 `protocol/mod.rs`（七个参数类型、命令名表、线上形状测试）、`assistant_todo.rs`（`todo_list`、`todo_list_order` 与一条单测）。
- CLI：`cli/src/todo.rs`（新）、`args.rs`、`main.rs`。
- 测试：`core/tests/todo_socket_test.rs`（新，10 条，经生产路由：记下时挂在开着的那一轮、只在 Galley 写且有一轮开着时挂、截止两种写法、两个前缀、外置下写全拒读照常、没有主对话、只改给了的与空值清空、勾掉取消提醒而取消勾不恢复、取消是软删除、列表顺序、`1`/`2`/`3` 都答）；`cli/tests/todo_test.rs`（新，5 条，CLI 二进制真连测试里起的 Unix socket：全流程成功、失败与退出码、外置、Core 没开、旧命令输出逐字节不变）。
- 文档：`docs/agent-api/todo-commands.md`（新，§5.28–§5.34）、`README.md` 路由表、`docs/agent-api.md` 节表、`stability-and-versioning.md`（两个前缀的 Where、两个枚举、§7.1 一条）、`schedule-commands.md`（`todoId` 一行加链接）、`docs/managed-ga-runtime/runtime-modes-and-sessions.md`（待办一节加链接）。没有迁移；没有动 runner 协议与界面。

**验证**（分支基于 `5f56da21`；交回报前 main 没动，没有变基）

- `cargo check --manifest-path core/Cargo.toml --workspace`：`Finished`，唯一警告是原有的 `relay/src/channels.rs:347` `fetch_update`。
- `cargo test --manifest-path core/Cargo.toml --workspace`：本机时区、`TZ=UTC`、`TZ=America/Los_Angeles` 各一遍，都是 45 组 `test result: ok`，合计 1124 passed、0 failed（票 39 是 1106，本票加 18）。第一遍本机时区挂过一次：CLI 测试里两件都没截止、同一秒记下，先后落到随机 id 上，断言改成按集合比，之后单跑 6 遍、三个时区全量各一遍都过。
- 旧命令不变，两种测法：测试里同一个二进制在记、改、勾、取消待办前后跑 `version`、`status`、`sessions list`、`session brief`、`project list`、`schedule list --all`、`--schema=1 sessions list --all`，逐字节相同；另把 `5f56da21` 的 CLI 从 `git archive` 副本编出来，与本分支的 CLI 在 JC 库的两份只读副本上跑 22 条旧读命令（`sessions list` 各种范围、`--schema=1` / `--schema=2`、`session brief / show / wait`、`project list / brief / show`、`schedule list`、`llm list`、`sessions search` 等），输出与退出码逐字节相同；副本与编出来的东西已删。顶层 `galley --help` 多一行 `todo`，是预期的只加。
- 六个门禁全过：IPC 漂移 aligned（18 events、11 commands）、Supervisor SOP 4 份副本一致、文档链接 447 个文件、版本 0.6.2、内置 GA 载荷 OK、GA 基线 OK（`f308ee7e`）。`git diff --check` 无输出。
- 新增行 grep 域名、`http`、`api_host`、`apibase`、`/Users/`、`/private/tmp`、`/var/folders`：无。中文标点扫新增行：0 处。
- `rustfmt --check`：新文件整篇干净；改过的旧文件差异条数与 HEAD 相同（`socket_listener/mod.rs` 原有的 `git.review` 两处与 `session_cmds.rs` 一处不是本票的）。

**没验证的**

- Windows 命名管道下的 CLI 端到端（新测试只在 unix 跑）。
- 真机：按约定不跑 `tauri dev`；界面要等票 42 才看得到待办。
- 真模型（票 41）。

**给票 41**

- Galley 该发的命令（`--supervisor=galley-assistant` 每条都带，「建在哪一句」靠它）：
  - 先读：`galley todo list`（答「还有什么没办」、建之前查有没有同一件、「说说这件」按标题找）；`galley todo show <todo-id>`。
  - 记下：`galley todo add "交季度报告" --due=2026-10-21T15:00 --remind-at=2026-10-21T14:00 --supervisor=galley-assistant --reason="…"`；没时间的 `galley todo add "买营养土" --supervisor=galley-assistant`；只有日子的 `--due=2026-10-18`。提醒用 `--remind-at` 挂在待办上，不要另外 `schedule create`（那样建出的任务没有 `todoId`，是「Galley 在办」里的独立提醒）。
  - 改：`galley todo update <todo-id> --due=2026-10-22T15:00 --remind-at=2026-10-22T14:00 --supervisor=galley-assistant`；去掉 `--no-due` / `--no-remind`；改说法 `--title=…`。待办的提醒也用 `todo update` 改或去掉，不用 `schedule update / delete`。
  - 勾掉：`galley todo done <todo-id> --supervisor=galley-assistant`；取消勾 `todo reopen`；不要了 `todo cancel`。
  - `schedule list` 里带 `todoId` 的任务是待办的提醒，手册可以点一句。
- `.scratch/main-chat/entry-layer-eval/` 要跟着改的：
  - 假 CLI（`run.py`）加 `todo list / show / add / update / done / reopen / cancel`：形状照 §5.28（`TodoBrief`，`due` 是 `{date, hasTime, at?, time?}`，`reminder` 是 `{taskId, at, state}`），校验照真 CLI：`--due` 收 `YYYY-MM-DD` 或 `--at` 的写法，过去的日期不拒；`--remind-at` 过去报 `time_in_past:`；`--due=` / `--remind-at=` 空值、`--due` 与 `--no-due` 同给、`update` 什么都没给都是参数错误（退出码 2）；未知或已取消的 id 退出码 3；`done` 取消没提醒到的提醒、再勾不变；`reopen` 不恢复提醒；`list` 的顺序与 `--all`。外置下写命令报 `assistant_unavailable:`。
  - `cli-help.json`（或新目录下的一份）重新抓：顶层 `--help` 多了 `todo` 一行，另加 `todo` 与七个子命令的 `--help` 原文（合入 main 后用开发版二进制、假 HOME，只跑 `--help`）。
  - 判定里的写命令清单（`SCHEDULE_WRITES`、`HAND_WRITES` 一类）加上 `todo add / update / done / reopen / cancel`，查 `--supervisor=galley-assistant`、有没有多余的写；「该记待办」查 `todo add` 而不是 `schedule create`。
  - 票 39 已说过的：`in_hand_block` 的移植与 `schedule/rust-samples.json` 还是票 36 的格式，要照新的「在办的事」三组重抓（待办一组的行里有 `todo_…` id、截止、逾期、提醒）。
