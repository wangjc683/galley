# 11: 失败可见性 — 角标扩为「需行动数」+ 失败系统通知

Status: done
PRD: ../PRD.md（决策 7 修订、决策 11）

## 背景

v1 的失败面太薄：fire 失败只在 dialog 里一格「上次触发失败」，会被下
一次成功覆盖；角标只统计审批阻塞。按决策 7 自己的定义，「需要你行动」
显然包括失败——失败通常意味着 runner 坏了，后续任务全会失败。

## 定案（JC 2026-07-30）

- 角标口径 = 审批阻塞会话数 + 上次运行失败的任务数，**合并单一数字**
  （角标职责是「有事要处理」，两类状态进 dialog 后本就分别可见）。
- **不放总任务数**：常亮的静态数字会稀释 warning 数字的警示力
  （alarm fatigue）；总数留在 dialog 标题旁。JC 曾提议放总数，被
  论证说服撤回。
- 失败驻留语义：仅计 enabled 任务（手动停用 = 已处理）；下次成功
  触发自动清除；**无手动 dismiss**。
- 失败发系统通知（决策 7 扩一格）。走 GUI 门控管线
  （`sendGatedSystemNotification`，聚焦不发 / 权限 / 每任务节流），
  **无独立偏好开关**——错误类通知不做配置项，罕见且必须被看见。
- Core 只发 Tauri 事件，GUI 独占 OS 通知（issue 05 的不双发规则）。

## 实现

- Core：`scheduler.rs` fire 失败分支发
  `scheduled-tasks:fire-failed`（payload `{taskId, prompt}`；常量与
  payload 在 `api/schedule.rs`）。集成测试钉事件与 payload；成功路径
  的精确编排断言钉「成功不发」。
- GUI：`hooks/useSchedulerSignals.ts`（替换原
  `useSchedulerBlockedCount.ts`）——`useSchedulerActionCount`
  （阻塞数 + `countFailedTasks`，监听 `scheduled-tasks:changed` 刷新）
  与 `useScheduledFireFailedNotification`（事件 → 门控通知）。
- `lib/notify.ts` 新增 `scheduleFailed` kind（无偏好，恒启用）。
- 文案键 `sidebar.scheduledNeedsAction` 替换 `scheduledBlocked`。
- 事件名跨语言 seam 由 `scheduled-tasks.test.ts` 钉住。
