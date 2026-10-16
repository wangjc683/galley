# 34 CLI：`galley schedule` 命令族

Status: ready-for-agent

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
