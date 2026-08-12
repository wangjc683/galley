# 01 Core 队列原语

Status: ready-for-human

## 范围

Rust Core（core/src）。队列挂 session 键（不挂 RunnerProcess，respawn
不丢），in-memory，重启即空（PRD 定案 2）。

## 内容

1. `QueuedMessage { queueId, text, images, origin, queuedAt }` +
   per-session `VecDeque`，归属 RunnerManager 域。
2. 统一入口「dispatch-or-enqueue」：`agent_running()` 为真或队列非空
   → 入队 + emit queue-changed；否则复用现有落库+下发路径。socket
   （session.send 收敛到此）与 Tauri command（GUI 用）双面暴露。
3. 出队钩子：RunComplete 事件处理点（process.rs 清 AtomicBool 处）
   pop front → Core 侧落库 → 下发 bridge → emit
   `user-message-persisted` + queue-changed。
4. `queue-jump(queueId)`：移队首；running → 发 Abort（出队由
   RunComplete 钩子完成）；空闲 → 立即出队。
5. `queue-remove(queueId)`：删除 + emit。
6. 事件 `session-queue:changed`：常量 + 类型化 payload 全量快照，
   仿 core/src/api/schedule.rs:25 的 scheduled-tasks 模式。

## 验证

- cargo test：入口原子判定（running/空闲/队列非空三态）、出队顺序、
  jump 语义、remove、崩溃保留（bridge 退出不清队列）。
- `cargo check --workspace` / `cargo test --workspace`。
