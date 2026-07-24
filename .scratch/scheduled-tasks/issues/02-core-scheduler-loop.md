# 02: Core 调度循环 — 触发、补跑与会话创建

Status: done
Blocked by: 01
PRD: ../PRD.md（决策 1、2、4）

## 范围

- tokio 后台循环，挂在 `start_background_services`
  （`core/src/app_setup.rs:298`），与 IM supervisor autostart、
  goal resume 并列。
- 到点触发：走现有 session 创建命令通路，产出**普通 session**
  （prompt 作为首条输入，归入 schedule 的 project）。不新增会话
  类型。
- 补跑策略：唤醒/启动时发现某 schedule 的应触发时刻已过且本周期
  未跑（比对 `last_fired_at`），补跑一次；app 退出期间的多个错过
  周期不追溯。
- 触发后更新 `last_fired_at` / `last_run_session_id`，发事件。
- 循环对时钟变化要稳健：睡眠唤醒、手动改系统时间不应导致重复触发
  或死循环（用 next-fire 重算而非累计 interval）。

## 验收

- `cargo test --workspace` 通过；补跑判定逻辑有单测（时钟推进用
  可注入的 now，不用真实 sleep）。
- 手工 dogfood：建一个 2 分钟后的 daily 任务，触发产出会话出现在
  sidebar 时间线；合盖错过后开盖能补跑一次。

## 注意

- 触发创建 session 失败（runner 起不来等）要记录状态并发事件，
  不能静默吞掉——静默失败摧毁功能信任（PRD 决策 4 同理）。
- 审批挂起不需要本 issue 做任何事：session 停在审批是现有行为
  （PRD 决策 3），05 只做通知。
