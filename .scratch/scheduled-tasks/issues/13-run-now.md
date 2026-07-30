# 13: 「立即运行一次」

Status: done
PRD: ../PRD.md（决策 13；原开放问题 5）

## 背景

新建任务后要等到下一个触发点才知道 prompt 写得对不对——验证回路长达
一天；今早触发失败后也没有顺手的补救入口。「立即运行」同时服务
信任三问的第 3 问（验证 + 修复），并且是决策 11 失败角标最自然的
清除路径。

## 定案（2026-07-30，JC 授权按 agent 主张推进）

- **走 `fire()` 同一条路、照常盖 `last_fired_at` 戳**。盖戳是设计而
  非偷懒：手动运行成为行内「上次运行」（信任闭环覆盖手动跑）、成功
  重跑清除失败角标；due 数学保证未来计划触发永不被吃掉（08:50 手动
  跑 → 09:00 的 prev 仍严格大于 baseline，照跑；单测
  `manual_fire_before_planned_time_keeps_today_due` 钉死）。唯一被
  吸收的是已到期未补的 catch-up——用户刚手动跑过，正是应有行为。
- 不检查 `enabled`：手动试跑暂停中的任务是正当用法。
- 交互：行内 hover Play 图标（删除同款惯例）；**无二次确认**（产物
  是普通可归档会话）；**不自动跳转**（「上次运行」格经 changed 事件
  实时变成新会话链接，用户自己决定进不进）；in-flight 禁用防双击。
- 手动失败也会触发 fire-failed 事件 → 通知管线的聚焦门控天然抑制
  （用户就在窗口前），不会打扰。

## 实现

- Core：`scheduler.rs::run_task_now`（查任务 + tick 同款 HandlerCtx
  组装 + `fire`）；`commands/schedule.rs::run_scheduled_task_now`
  薄壳；lib.rs 注册。语义由 due_fire 既有单测 + 新增单测覆盖，
  组装壳不另测（与 tick 同理）。
- GUI：`runScheduledTaskNow` wrapper；TaskRow 行内按钮。
