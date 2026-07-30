# 12: 表单「首次 / 下次触发」预览

Status: done
PRD: ../PRD.md（决策 12）

## 背景

`next_fire_after` 的 strictly-after 语义有个用户预期陷阱：10:00 创建
每日 09:00 任务，实际**明天**才首跑。反馈应发生在决策时刻（表单里），
而不是让用户第二天发现没跑。

## 定案（JC 2026-07-30）

- 表单时刻字段下方实时显示一行：新建「首次触发：7/31 09:00」、编辑
  「下次触发：…」；文案用**绝对时间**（日期本身消除「今天会不会跑」
  的歧义，与列表行格式一致）。
- 编辑态走真实 baseline（`created_at` / `last_fired_at`）：「把今天
  已跑过的 09:00 改成 14:00 → 今天再跑一次」被如实预告为
  「保存后将立即触发一次 · 下次触发：…」（`dueNow`）。
- **不在 TS 复刻日历逻辑**——小月钳制、DST 间隙正是最易复刻错的
  部分；Rust 权威（Rule 5 精神），GUI 只调只读命令。

## 实现

- Core：`scheduler.rs` 新增 `preview_fire`（复用 `due_fire` 语义 +
  `next_fire_after`，返回 `FirePreview { dueNow, nextFireAt }`）；
  `commands/schedule.rs` 新增只读命令 `preview_scheduled_fire`
  （additive；新建以 now 为 baseline，编辑读真实任务行，enabled
  强制视为 true——预览回答「这条规则会怎样」）。单测钉三个场景。
- GUI：`previewScheduledFire` wrapper；TaskForm effect 依赖仅规则
  字段（prompt 键入不触发 IPC），weekly/monthly 未选日隐藏。
