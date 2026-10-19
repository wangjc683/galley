# 61 取消时记下谁和为什么；「在办的事」加「最近不要的跟进」

Status: done（2026-10-19 合入 `5b1273d6`、`98401b64`、`3493ee78`；主会话复跑门禁：cargo check、workspace 测试 `TZ=UTC` 与 `TZ=America/Los_Angeles` 各 1137 条全过、评测干跑 357 项、gui typecheck，rustfmt 只有三个原本就不干净的文件、差异数不变。不单独真机：效果要等票 60 的手册，本票只要主对话照常回话、面板没多东西）

来源：主聊天 PRD 裁决 113（2026-10-19，JC：「B」），修正裁决 112 第 5 条后半句。改 Core（迁移、取消落库、「在办的事」）、Agent API 文档与入口层评测的镜像；GUI、runner、手册、`managed-ga/code` 不动（手册在票 60 改）。

## 为什么

裁决 112 让主对话自己判断要不要跟进，底线之一是你说「这类别提醒我」它以后不再设。可偏好如果只写进 GA 记忆，下一段就看不见了：

- GA 的 L1 索引每次请求都在系统提示词里（`managed-ga/code/ga.py:597`），L2 不在，模型要读才看得到。702 那次，模型照 GA 的记忆规矩把内容写进 L2，L1 只留了一行指针。
- 主对话闲置超过 4 小时就开新段（`core/src/session_runner/segment.rs:54`），只带最后 3 轮。

所以偏好要由 Galley 记、由 Core 每段放到它眼前，和「在办的事」（`in_hand_section`）走同一条路。

## 一、取消时记下谁、为什么

- 新迁移 `051`：`todos` 与 `scheduled_tasks` 各加 `cancelled_via`、`cancelled_by_supervisor`、`cancelled_origin_note`，取值与约束照 `done_via` / `done_by_supervisor` / `done_origin_note`（050）和 `created_*`（049）那组。已取消的旧行留 NULL（不知道是谁，不补猜）。迁移文件开头照 050 的写法写清楚三列的含义与三种来源。
- **加迁移要补六处手写迁移列表**：`core/tests` 里 4 处、`cli/tests` 里 2 处各自 `include_str!` 的列表。`grep -rn "050_todos" core/tests cli/tests` 找全；验证必须跑 `--workspace`，否则 CLI 那两处抓不到。
- 落库：
  - `core/src/db/todo.rs` 的 `cancel_todo(&self, id, _origin)`：现在收到 origin 却丢掉，改成写进三列。
  - `core/src/db/schedule.rs` 的 `cancel_scheduled_task(&self, id)`：加 origin 参数，所有调用方传进来。
  - 三种来源：
    1. CLI 的 `todo cancel`、`schedule delete` 带的 `--supervisor`、`--reason` 进三列。
    2. 桌面「取消提醒」（`core/src/commands/schedule.rs` 的 `cancel_todo_reminder`，`Origin::desktop()`）记为 `gui`。
    3. 勾掉或取消待办时 Core 顺带取消提醒（`release_todo_reminder` 一类），以及别的由 Core 自己发起的取消，一律记为 `system`。
  - 逐个调用方 grep，回报里列全。
- Agent API：`todo show` / `todo list --all` 与 `schedule show` / `schedule list --all` 的 JSON，照「谁勾的」的现有写法多带「谁取消的、为什么」（`3` 内加法，`1`、`2` 照现有规则处理）。改 `docs/agent-api/todo-commands.md`、`schedule-commands.md`，同步 `gui/src/types/ipc.ts` 里对应的类型（只加可选字段，不改界面）。CLI 自身不用改参数，确认 `--reason` 已经送到 Core 就行。

## 二、「在办的事」加一组「最近不要的跟进」

- `core/src/managed_prompt.rs` 的 `in_hand_section` 与它读的 `crate::assistant_todo`：在现有三组（你的待办、Galley 在办、例行）之后加第四组。
  - **收什么**：Galley 建的（`created_by_supervisor = 'galley-assistant'`）待办与定时任务里，近 90 天被取消、且 `cancelled_via` 是 `gui`，或是 `supervisor` 加 `galley-assistant`（照用户的话取消）的。`system` 与 NULL 不收。
  - 最新在前，最多 `IN_HAND_MAX_PER_GROUP` 条，多的照现有写法记「and N more」。
  - 每行写标题或任务的话（截断照 `IN_HAND_TEXT_CHARS`）、取消的日子（同现有时间格式）、谁取消的（桌面 / 照用户的话）和原因（有就写，截断同标题）。
  - 组名与一句说明用英文，口吻同现有几组，例如「Follow-ups the user turned down (last 90 days)」。怎么用这组（主动设之前先看；用户拒一类时原因里写明哪一类）写进手册，那是票 60 的事，这里只给数据加一句定位。
  - 四组都空时照旧不出这一节；只有这一组有内容时，这一节也要出现。
- 面板不变：「最近不要的跟进」只进它的上下文。`assistant_todo` 现在和面板共用一个查询（「你看到的就是它看到的」），新组不要漏进面板；如果要拆查询，在注释里写清这是有意的例外（裁决 113 第 4 条）。
- 重置主对话：照现在待办跟着清的规则，确认取消记录也跟着清。
- 测试：
  - 三种来源各落对三列；旧行 NULL 不进组。
  - 90 天边界；`system` 不进组。
  - 只这一组有内容时这一节出现；条数与截断。
  - 面板查询不含这一组；CLI JSON 多出的字段在 `--schema=3` 下有。
  - Windows 检出是 CRLF，`contains` 只用单行片段。

## 三、评测镜像

`.scratch/main-chat/entry-layer-eval/run.py` 的 `in_hand_block`（约 1331 行）逐字镜像 Rust 的 `in_hand_section`，`--dry-test` 会逐字对比。照新组改镜像，假 CLI 的 `todo cancel` / `schedule delete` 照真实 Core 记下来源与原因、`--all` 输出带上新字段，`--dry-test` 跑过。本票不跑真模型：组为空时提示词与现在逐字相同（回报里用一条测试或对比写明）；有内容时的效果由票 60 的评测测。

## 别动

- 主工作树：只在本 worktree 里做，不碰主树，不跑 `tauri dev`。
- 手册、入口层措辞（票 59 在拆手册、改入口层；票 60 再改内容）。`core/src/managed_prompt.rs` 里只动 `in_hand_section` 及其测试，别碰 `main_chat_entry_layer` 与它的预算测试，免得和 59 撞。
- `gui/` 除 `types/ipc.ts` 的可选字段外不动；`runner/`、`managed-ga/code/` 不动。
- `core/` 不是 rustfmt-clean：只对自己改过的文件跑 `rustfmt --check`。提交只点名文件，`git add … && git commit …`。

## 验证

- `cargo check --manifest-path core/Cargo.toml --workspace`
- `cargo test --manifest-path core/Cargo.toml --workspace`（带测试条数）
- 改过的 Rust 文件逐个 `rustfmt --check`；`git diff --check`
- `pnpm --dir gui typecheck`（只加了类型字段）
- `run.py --dry-test`（解释器与环境照 README：`/Library/Frameworks/Python.framework/Versions/3.14/bin/python3`，`PYTHONDONTWRITEBYTECODE=1`）

## 回报格式

1. 提交列表（`git log --oneline` 原样）。
2. 迁移原文；三种来源各在哪落库（`file:line`），调用方清单。
3. 新组的样子：拿一组例子数据，把 `in_hand_section` 的输出原样贴出来（四组都有、只有新组两种）。
4. Agent API 改了哪些字段、文档哪几节。
5. 验证命令与结果原样。
6. 看到但没改的问题。

## 给 JC 的真机步骤（主会话合入后补全）

合入会重启 Core，主会话等主对话空闲（`busy:0`）再合。效果要等票 60 的手册才看得到；本票只看它不出错：主对话照常回话，面板没有多出东西。

## Comments

- 2026-10-19（实现子代理）：已在分支 `main-chat-61-declined-follow-ups` 做完，待主会话合入（Core 与文档 `b9315802`，评测镜像 `f15d688c`，本条另一提交）。没跑真模型。
  - **取消落库**：迁移 `051_cancelled_by.sql` 给两张表各加三列，取值照 `done_via`，另有一条约束「有来源就必须已取消」；051 之前取消的旧行留 NULL。`cancel_scheduled_task` 加了 origin 参数，`cancel_todo`、`cancel_todo_reminder` 不再丢掉 origin。来源：CLI 的 `todo cancel`、`schedule delete`、`todo update --no-remind` 记 `--supervisor` 与 `--reason`；桌面的「取消提醒」与卡片、清单、定时任务对话框里的取消记 `gui`；勾掉或取消待办时顺带取消的提醒、调度器丢掉的已关待办的提醒记 `system`（新加 `Origin::system()`）。`--no-remind` 记成调用方自己的取消，票里没点名，回报里写明了。
  - **「在办的事」第四组**：`assistant_todo::declined_follow_ups` 单独读（全部待办与定时任务，筛出 Galley 建的、近 90 天、`gui` 或 `supervisor` 加 `galley-assistant`），`in_hand_read` 把它和面板那份一起交给 `in_hand_section`；面板读的 `AssistantTodo` 里没有这一组，模块注释写明这是裁决 113 第 4 条的有意例外。组名 `Follow-ups the user turned down (… last 90 days):`，每行写取消的时间、谁取消的、话、`(reason: …)`，多的记「and N more: `todo list --all`, `schedule list --all`」。四组都空不出这一节；只有这一组也出。这一组为空时输出逐字不变（原有的 `in_hand_lines_say_what_when_and_who` 照旧逐字通过，评测里也对了一次）。`IN_HAND_BUDGET_BYTES` 4230 → 6161（第四组每行带话和原因两段截断）。
  - **重置**：待办连同取消记录照旧删掉；留下的定时任务（它自己的）清掉三列，新主对话的这一组从空开始。
  - **Agent API**：`Todo.cancelledBy`、`ScheduledTask.cancelledBy`，`3` 内加法，`1`、`2` 照样带；改了 `todo-commands.md` §5.28、§5.34，`schedule-commands.md` §5.20、§5.25，`stability-and-versioning.md` §7.1 加一条。CLI 不用改，`--reason` 本来就送到 Core。
  - **GUI**：票里写的 `gui/src/types/ipc.ts` 里没有这两个类型（那里是 runner 的 IPC 事件），镜像在 `gui/src/lib/assistant-todo.ts` 的 `TodoBrief` 与 `gui/src/lib/scheduled-tasks.ts` 的 `ScheduledTask`，可选字段加在那两处，界面没动。
  - **评测**：`in_hand_block` 多一个 `declined` 参数，`declined_items` 移植选法，`sched_in_hand` 从起始数据里取（现在的用例都没有取消过的，提示词不变）；`rust-samples.json` 多三组「In Hand」与一组选法样本，由临时测试写出、已删；假 CLI 照 Core 记 `cancelledBy`，`--dry-test` 341 项全过。用例里怎么写取消过的、判定怎么算，留给票 60。
  - **验证**：`cargo test --workspace` 1135 项全过；相关测试在 `TZ=UTC` 与 `TZ=America/Los_Angeles` 下各跑一遍全过；改过的 Rust 文件 `rustfmt --check` 没有新增差异；`git diff --check`、`pnpm --dir gui typecheck` 通过。
