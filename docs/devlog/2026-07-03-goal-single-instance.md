# 2026-07-03 · Goal 单实例化 · 一次一个 + 重启自动恢复 + 控制器重入锁

> Status: implemented · Related:
> [2026-06-04 Galley Goal V1](./2026-06-04-galley-goal-v1.md) ·
> `core/src/db/goal.rs` · `core/src/desktop_goal.rs` · `cli/src/goal/controller.rs`

## Context

用户对 Goal 的定位判断:**目前阶段 Goal 是重武器,一次一个更符合心智**。
调查(见对话)确认现状是无上限并发:没有单 Goal 锁、没有 per-project 约束、
没有跨 Goal 的 worker 池配额。N 个 Goal 各自最多派 5 个 worker,共抢一个全局
20 runner 的 LRU 池(`core/src/runner_manager/manager.rs:19`),会互相驱逐对方
idle-but-not-done 的 worker,而用户对这个竞争完全无感。

按「一次一个」重新设计。三件事是一个内聚包:

## Decisions

### D1. 单 Goal 锁(DB 强制 + 友好错误)

- migration `030_single_active_goal.sql`:部分唯一索引
  `CREATE UNIQUE INDEX goals_single_active ON goals((1)) WHERE status IN
  ('running','wrapping')`。常量表达式 `(1)` 令所有 active 行索引键相同,UNIQUE
  即「最多一个」。running→wrapping 同行 UPDATE 不冲突;completed/stopped/failed
  掉出谓词立即释放。语法在 SQLite 3.50 实测通过(≥3.9 表达式索引)。
- `start_goal_from_proposal_db`(`core/src/db/goal.rs`)事务内、INSERT 前加一次
  SELECT active goal,命中返回 `InvalidArgs`,message 带 objective/id 供
  supervisor / GUI 直接转达。DB 索引是并发竞争(两事务都 pre-SELECT 到 0)的
  race-proof 兜底。
- active = running + wrapping;stop/complete 后立即可开新;proposal 不占用。

### D2. 重启自动恢复

controller 是脱离进程,Core 重启(崩溃/退出/重启机器)后变孤儿,无 reaper。
**若只加锁不加恢复,一个死掉的 running Goal 会在 DB 里永久占位、被单 Goal 锁
锁死所有新 Goal**——所以两件必须一起做。

- 泛化 `spawn_goal_controller`(`core/src/desktop_goal.rs`)为
  supervisor/reason 参数化;新增 `resume_active_goals`,Core setup 钩子
  (`core/src/lib.rs`,IM autostart 旁)启动时 `list_active_goals` → 逐个
  re-spawn(单 Goal 下最多一个)。恢复用默认 locale(无 GUI 上下文)。

### D3. 控制器重入锁(fs2 文件锁)

防止自动恢复与手动 `goal run --resume` 对同一 Goal 双开 controller。

- `cli` 加 `fs2` 依赖;`run_goal_controller`(`cli/src/goal/controller.rs`)
  最前面对 `<goal.workspace_path>/controller.lock` 做
  `try_lock_exclusive`,抢不到 → log 后 `Ok(())` 干净退出。锁 File 生命周期
  覆盖整个 run loop(RAII 释放)。workspace_path 缺失(古老 goal)降级为不加锁
  ——DB 单 Goal 锁仍是硬保证。与 Python 侧 `supervisor.lock` 语义一致。

### D4. GUI 预防式禁用(不给注定失败的入口)

- `App.tsx` 派生 `hasActiveGoal = activeGoals.length > 0`,传入 MainView +
  EmptyState 两条 Composer 路径。
- Composer gate:`goalBlockedByActive = canShowGoalEntry && hasActiveGoal`
  (`!goal` 已排除「本 Composer 就是那个 Goal」),折进 `goalModeBlocked`,
  Goal 入口禁用 + tooltip `goalBlockedByActive`(en/zh)。

### D5. 新增 `galley goal active` CLI

单 Goal 设计下 supervisor 需要「有没有在跑的 Goal」预检,但原 `goal status`
需要 goal_id、无列 active 的面。新增 additive 只读命令 `goal active`,复用现成
`list_active_goals` API,NDJSON 输出,空 = 无。SOP / reference / agent-api
均以它作为「propose 前先查」的入口。

## 不在范围(独立 / 信号驱动)

运行中 `goal extend`(deadline 创建时冻结,无法延长——真实痛点,但独立)、
LLM quota 退避、「一键停旧开新」快捷路径、worker 上限与默认时长调整(有 GA
Hive 背书的合理默认,非缺陷)。

## 落点

`core/migrations/030_single_active_goal.sql`(新)· `core/src/lib.rs`
(migration 注册 + 恢复钩子)· `core/src/db/goal.rs`(pre-SELECT 锁)·
`core/src/desktop_goal.rs`(泛化 spawn + resume_active_goals)·
`cli/Cargo.toml` + `cli/src/goal/controller.rs`(fs2 重入锁)·
`cli/src/goal/mod.rs` + `args.rs` + `main.rs`(goal active)·
`gui`(App / MainView / EmptyState / Composer / i18n)·
`docs/integrations/galley-supervisor-sop.md` + reference(+ 4 副本)+
`docs/agent-api.md`。

## 验证

单元:db_writes(第二个 Goal InvalidArgs;stop 后可开新)· cli 重入锁
try_lock 二次失败。端到端 dogfood:启动一个 → GUI 入口禁用 + CLI 强启返回
InvalidArgs;stop 后入口恢复;dev core 重启后自动 resume;二次手动 resume
抢锁失败干净退出。
