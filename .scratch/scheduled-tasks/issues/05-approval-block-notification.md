# 05: 审批阻塞通知

Status: done（零代码——现有管线已覆盖，见 Comments）
Blocked by: 02
PRD: ../PRD.md（决策 3、7）

## 范围

- 当**定时任务产出的** session 进入等待审批状态时，发一条 macOS
  系统通知（Tauri notification 能力）；点击通知聚焦 Galley 并定位
  该会话（若现有通知通路支持 deep-link，沿用；不支持则只聚焦窗口，
  不为此扩通路）。
- 正常完成**不**发通知，只由 03 的角标承担。
- 通知判定在 Core 侧（订阅会话审批状态 + 会话是否来自 schedule），
  GUI 不做权威判断。

## 验收

- `cargo test --workspace` 通过；手工 dogfood：定时任务触发一个
  会碰审批的 prompt，收到系统通知，手动会话碰审批不发。

## 注意

- 先调研现有审批状态在 Core 的暴露点（`GenericAgentHandler` 审批
  拦截那条线），如果状态只在 GUI 侧可见，需要先补 Core 侧信号——
  若工作量超预期，回到 PRD 讨论降级方案（v1 只做角标）。
- 去重：同一 session 反复进出审批态不要连环轰炸，同一等待期只发
  一次。

## Comments

2026-07-23 调研结论：**不需要任何新代码**，PRD 决策 7 的行为已由现
有基础设施完整实现：

- 调度器会话的事件链成立：Core `session.new` 发
  `runner-spawned-external` → GUI `useExternalCoreEvents` 调
  `attachExternalBridge` → runner 事件进 `ipc-handlers`。
- `tool_call_pending` 到达时 `ipc-handlers.ts` 已调
  `sendGatedSystemNotification("approval", …)`（`lib/notify.ts`）：
  `notifyOnApproval` pref 默认开、窗口聚焦不发、每会话 5s 节流
  （即去重）。调度器仅在 app 存活时运行，GUI 管线必然在场。
- 正常完成不打扰：`replyDone` 通知只对 GUI Composer 提交的 run 生效
  （`replyNotifyPending` 门控），调度会话天然静默，正好符合决策 7。
- Core 侧若再加通知会与 GUI 管线双发。审批阻塞角标由 03 的
  `useSchedulerBlockedCount`（`addPendingApproval` 同源数据）承担。
