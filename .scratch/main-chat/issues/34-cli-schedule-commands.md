# 34 CLI：`galley schedule` 命令族

Status: needs-dogfood（2026-10-16 合入 main，分支提交 `5ab63f0b`、`26c56879`、`edca1db4`，合并提交 `16d7f2e1`；真机随票 35–37 一起验）

来源：[助手 PRD](../../assistant/PRD.md) 裁决 9，主对话 PRD 裁决 84。取代 [scheduled-tasks 票 06](../../scheduled-tasks/issues/06-cli-schedule-commands.md)（needs-triage，从没做）。依赖 33。改 Core 的 socket 处理、CLI 与 Agent API 文档；不改界面。

## 目标

助理（和任何外部 agent）能用 CLI 建、看、改、删、启停、立即运行定时任务，包括票 33 的「一次性」与「叫醒助理」。Agent API `schemaVersion: 3` 只加不改（宪法 Rule 3）。

## 要做

- 命令（名字与参数你定，照现有命令的风格，比如 `session new`、`project create`）：
  - `galley schedule list [--all]`：默认只列启用的与没触发的一次性；`--all` 带已触发、已停用的。每行一个 JSON，字段至少：id、是一次性还是重复、触发规则（一次性的绝对时刻；重复的种类、日子、本地时刻）、下次触发时刻、上次触发与结果、到点做什么（`assistant` / `session`）、要说的话或 prompt、项目、模型、谁建的（`createdVia` + `supervisor`）、启用。
  - `galley schedule show <id>`。
  - `galley schedule create "<prompt>"`，带：
    - 一次性：`--at=<时刻>`。认带时区的 ISO 8601，也认本机本地时间（如 `2026-10-20T20:00`，按本机时区解释，写清楚）；过去的时刻报错（错误标识你定、加进稳定集合）。
    - 重复：`--daily` / `--weekly=<1-7,…>` / `--monthly=<1-31,…>` 加 `--time=HH:MM`，规则与界面表单一致（复用 `scheduled_tasks` 的校验）。
    - `--target=assistant|session`：CLI 默认值你定、写理由（助理用的多半是 `assistant`；外部 agent 多半是 `session`）。`assistant` 只在托管运行时、有主对话时允许。
    - `--project=<id>`、`--llm=<name>`（只对 `session` 有意义）、`--supervisor=<x>`、`--reason=<y>`。
  - `galley schedule update <id> …`：改时刻、规则、话、目标；只给的字段变。
  - `galley schedule delete <id>`（软删除，照票 33 的取消）、`galley schedule enable|disable <id>`、`galley schedule run <id>`（立即运行，复用界面的「立即运行」，票 13）。
- 写命令都记来源（`--supervisor`）；票 33 的「谁建的」「建在哪一句里」由这里写进去。
- socket 协议同步加（`core/src/socket_listener/`），CLI 走 socket；CLI 与 socket 的错误封装、退出码照 `docs/agent-api/errors-and-exit-codes.md`。
- **不加**任何「只能你来」的东西（Key、渠道、运行环境……）。授权的三级由手册（票 36）约束模型，Core 不硬拦，照票 29「打回最多两次」的先例。

## 文档

- `docs/agent-api/` 新增 `schedule-commands.md`（照 `session-commands.md` 的格式：每条命令的参数、输出字段表、例子、错误），README 路由表加一行，稳定标识集合（`stability-and-versioning.md`）加新的错误标识与枚举值。
- `docs/agent-api/roadmap-and-references.md` 里若列着「定时任务 CLI 待做」，改掉。
- Supervisor SOP 不动，除非 `check-supervisor-sop-drift` 要求。
- scheduled-tasks 票 06 的 Status 主会话已改（被取代），你不用动。

## 验收

- CLI 集成测试（`cli/tests/`）：每条命令的成功与失败；一次性过去的时刻报错；`--target=assistant` 在外置运行时报错；`list` 默认与 `--all`；`--schema=3` 下输出；旧命令输出逐字节不变。
- `cargo test --manifest-path core/Cargo.toml --workspace`、六个门禁脚本、`git diff --check`、中文标点扫新增行。

## Comments

### 2026-10-16 实现回报（子代理，分支 `mc-schedule-core`）

**改了哪些文件**

- `core/src/protocol/commands.rs`、`core/src/protocol/mod.rs`：`ScheduleListArgs`、`ScheduleShowArgs`、`ScheduleCreateArgs`、`ScheduleUpdateArgs`、`ScheduleDeleteArgs`、`ScheduleEnableArgs`、`ScheduleDisableArgs`、`ScheduleRunArgs`，线上形状测试。
- `core/src/socket_listener/schedule_cmds.rs`（新）、`core/src/socket_listener/mod.rs`：八个 `schedule.*` 处理函数与分发表。
- `cli/src/args.rs`、`cli/src/main.rs`、`cli/src/schedule.rs`（新）；`cli/Cargo.toml` 测试依赖加 `chrono` 与 tokio 的 `net`、`io-util`（`core/Cargo.lock` 多一行）。
- 测试：`core/tests/schedule_socket_test.rs`（新，10 条，经生产路由）、`cli/tests/schedule_test.rs`（新，4 条：测试里在临时 `TMPDIR` 的每用户 socket 路径上起一个 Unix socket 服务，用 Core 的生产路由答，CLI 二进制真连过去；只在 unix）。
- 文档：`docs/agent-api/schedule-commands.md`（新，§5.20–§5.27）、`docs/agent-api/README.md` 路由表、`docs/agent-api.md` 节表、`docs/agent-api/stability-and-versioning.md`（§1.1 新表「Stable message prefixes」与三个枚举，§7.1「Changes inside `3`」一条）。`roadmap-and-references.md` 里没有列「定时任务 CLI 待做」，没改；Supervisor SOP 没动，漂移门禁照过。

**命令与名字**

- CLI：`galley schedule list [--all]`、`show <id>`、`create "<prompt>" (--at=<时刻> | --daily | --weekly=<1-7,…> | --monthly=<1-31,…>) [--time=HH:MM] [--target=session|assistant] [--project=<id>] [--llm=<name>] [--supervisor=<x>] [--reason=<y>]`、`update <id> [--prompt=<话>] [--at | --daily | --weekly | --monthly] [--time] [--target] [--project] [--llm] …`、`delete <id>`、`enable <id>`、`disable <id>`、`run <id>`（后四个都收 `--supervisor` / `--reason`）。
- socket：`schedule.list {all?}`、`schedule.show {taskId}`、`schedule.create {prompt, fireAt?, repeat?, timeOfDay?, target?, projectId?, llmName?, supervisor?, reason?}`、`schedule.update {taskId, prompt?, fireAt?, repeat?, timeOfDay?, target?, projectId?, llmName?, supervisor?, reason?}`、`schedule.delete | enable | disable | run {taskId, supervisor?, reason?}`。
- 输出：`list` 每行一个任务（NDJSON）；`show` 打印任务本身；写命令打印 `{"task": …}`（`delete` 之后带 `cancelledAt`，`run` 之后是触发后的样子）。任务 id 由 Core 铸，形如 `sched_<16 位十六进制>`，与界面一致。
- 错误：都是已有类别。`invalid_args`（退出码 2）里两个稳定前缀 `time_in_past:`、`assistant_unavailable:`；未知或已取消的任务 `not_found`（3）；Core 没开时写命令 `db_unavailable`（4），读命令照样能用。

**票面留给我定的**

1. **`--target` 默认 `session`**：两种运行时都能用；与界面表单、旧票 06 的语义一致；不随 `--supervisor` 变出隐式默认（按身份变的默认最难预期）。助理的手册（票 36）写明 `--target=assistant`；它万一忘了写，建成的是定时会话，跑完照样叫醒它交代，不会哑火。
2. **错误标识**：没有新加错误类别，沿用 `invalid_args` 加稳定的信息前缀，先例是 `schema_mismatch:`。理由：新加 `error` 判别值要么占新退出码，要么在 CLI 里折回 `invalid_args`（CLI 输出里根本看不到新值），还多一处要同步的映射；前缀在两种传输上都看得到。已写进稳定集合。
3. **时刻的写法**：认 RFC 3339（带 `Z` 或偏移），也认本地 `YYYY-MM-DDTHH:MM[:SS]`（空格代替 `T` 也行），在 Core 按 Galley 所在机器的时区解析；夏令时空档挪到空档后第一分钟（与重复任务同一规则）；只有日期的不收。
4. **读命令直连 SQLite**：照所有读命令的做法，Core 没开也能看；socket 另提供 `schedule.list` / `schedule.show`，给只走 socket 的 agent。写命令全走 socket。
5. **清空**：`update` 里 `--project=`、`--llm=` 给空值即清空（socket 传空字符串）。`update` 不改 `origin`：它记的是谁建的。
6. **默认列表**：启用、没取消、不是已触发的一次性；`--all` 带上已触发、已停用、已取消的（已取消的带 `cancelledAt`）。

**与票面不同**

1. 「谁建的」在输出里是 `origin`（`{via, supervisor?, reason?}`），不是 `createdVia` + `supervisor` 两个字段，理由见票 33 的回报第 1 条。
2. `run` 一个叫醒助理的任务在外置运行时同样报 `assistant_unavailable:`；`run` 不检查是否启用（与界面「立即运行」一致）。

**测试覆盖**

- 每条命令的成功与失败；一次性过去的时刻 → 退出码 2、`time_in_past:`；外置运行时 `--target=assistant` → 退出码 2、`assistant_unavailable:`；`list` 默认与 `--all`；`--schema=3` 下创建；socket 在 `1`、`2`、`3` 下都答新命令，`4` 是 `schema_mismatch`；clap 层的冲突与拼错 → 退出码 2；Core 没开 → 写命令退出码 4、读命令照常。
- 旧命令：没改任何旧命令的代码路径，原有 `cli_test.rs`、`m1_writes.rs` 钉着旧输出，全过。

**没验证的**

- Windows 命名管道下的 CLI 端到端（新测试只在 unix 跑）。
- 真机（JC，随票 35–37）。

**验证**：与票 33 同一次（见票 33 回报）。本票的新测试：`schedule_socket_test` 10 条、`cli/tests/schedule_test.rs` 4 条、`cli/src/schedule.rs` 单测 1 条、`protocol/commands.rs` 线上形状 1 条（命令名表另补 8 行）；全量 `cargo test --workspace` 三个时区都是 1038 passed、0 failed；文档链接门禁 `docs link gate OK`。
