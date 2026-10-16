# 40 CLI：`galley todo` 命令族

Status: ready-for-agent

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
