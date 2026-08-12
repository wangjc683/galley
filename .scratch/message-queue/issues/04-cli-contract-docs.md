# 04 CLI 契约 + 文档

Status: ready-for-human
Blocked by: 01

## 内容

1. `session.send` 运行中 → `dispatch: "queued"`（additive enum 值，
   响应附 `queueId` / `position` 字段，additive）。exit code 仍 0。
2. `galley session send --jump`：入队 + 插队（等价 stop→优先执行）。
3. 文档：agent-api/session-commands.md（send 语义、--jump、queued
   响应形状）、stability-and-versioning（如需登记新 enum 值）、
   ipc-protocol.md（bridge mid-run 拒绝行为、queue 相关事件不过
   bridge 层则注明）。docs/agent-api 是契约唯一真相，先文档后代码。

## 验证

- CLI 集成测试（现有 socket 测试模式）：空闲 send 形状不变；运行中
  send 返回 queued；--jump 语义。
- `cargo test --workspace`；`git diff --check`。
