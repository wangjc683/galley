# 02: runner `generate_title` 命令

Status: ready-for-human（已实现，待 dogfood 验收）

## 范围

- `runner/ipc.py`：新增 `GenerateTitleCommand(firstUserMessage, finalAnswer)`
  与 `TitleGeneratedEvent(sessionId, title)`，注册 kind 表；
  `docs/ipc-protocol.md` 同步。
- `runner/ga_session.py`：新增 `side_ask(prompt, deadline) -> str`——构造单条
  user 消息（不带历史，无需 deepcopy/锁），`backend.make_messages` 可用则用，
  否则裸 pair，迭代 `backend.raw_ask` 至 deadline。这是 GaSession 新的只读
  耦合点（raw_ask 不写 GA 状态；probe.rs 先例），模块 docstring 补记。
  确认 F2 不依赖 `btw_cmd`，attach / managed 两模式一致。
- `workbench_bridge.py`：`dispatch_command` 新分支 → `_handle_generate_title`
  daemon 线程：构标题 prompt（≤15 字 / 跟随会话主要语言 / 只输出标题）→
  `side_ask` → 清洗（剥标签、去引号、单行化、截断）→ 发 `TitleGeneratedEvent`。
  任何失败静默（stderr 记日志，不发 error 事件）——重试由 core 在下次
  run_complete 驱动。

## 验收

- runner pytest：命令/事件编解码、清洗函数、假 backend 的 side_ask 路径。
- mypy / ruff 通过。
