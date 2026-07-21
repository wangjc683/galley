# 02: Core — `plan_update` 事件转发

Status: ready-for-human

## 目标

Rust core 认识 `plan_update`，随现有 `runner-event` 信封转发给 GUI。

## 方案

core 的事件转发是通用信封（`runner_commands.rs::spawn_emit_task`），无需
业务逻辑；只需让 serde 能解析新 kind（否则落进 MalformedLine）：

- `core/src/ipc.rs`：`IpcEvent` 加 `PlanUpdate(PlanUpdateEvent)` 变体 +
  camelCase struct（含 `items: Vec<Value>`）+ `session_id()` 分支。
- 加一个 parse 测试（对照 runner 侧 wire JSON）。

不做 DB 持久化、不做 CLI 暴露（PRD 明确本期不做；未来是 v1 加法）。

## 验证

`cargo check --workspace` / `cargo test --workspace`。

## Comments
