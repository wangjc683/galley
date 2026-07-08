# 03 — Solo Goal 不应自动创建项目(需谨慎的数据迁移)

Status: ready-for-human
Created: 2026-07-08
Parent: ../PRD.md

## 目标

solo 是单 session 任务,不需要项目来圈一个 worker 舰队。所以:

- solo 在**某个项目里发起** → 就留在那个项目(**已成立**,无需改动)。
- solo **无项目发起** → **保持无项目**(像普通 session 一样),**不**再凭空建一个
  `Goal · X` 项目污染侧边栏。
- hive 维持现状(它需要项目装 master + workers)。

## 现状(已核实)

- `start_goal_from_proposal_db`(`core/src/db/goal.rs`):proposal 无 project 时无条件
  建一个项目并把 master session 拉进去。
- `goals.project_id` 是 **`NOT NULL` + `ON DELETE CASCADE`**(`sessions.project_id`
  可空,goals 不行)。
- 三个子表 FK 引用 goals:`goal_tasks` / `goal_events`(015)、`goal_deliverables`
  (018),均 `ON DELETE CASCADE`。

## 为什么这不是「小改动」——数据丢失风险(关键)

要让 `goals.project_id` 可空,SQLite 必须**重建 goals 表**。但:

- `migration_backup.rs:349` 注释:**"SQLx runs SQLite migrations inside a DDL
  transaction"**,而**事务里 `PRAGMA foreign_keys = OFF` 是 no-op**。
- 于是重建时 `DROP TABLE goals` 会**级联删除** goal_tasks/events/deliverables
  (`migration_backup.rs:266`:021/023 当年就删过子行)。
- Galley 为此有 **preflight 机制**(`SAFE_PREFLIGHT_MIGRATIONS` +
  `apply_preflight_migration`):在 sqlx 之前、以 `foreign_keys(false)` 的连接重跑
  重建迁移,绕开级联删除。**但它只覆盖到 `SAFE_REBUILD_PREFLIGHT_MAX_VERSION = 23`。**

**所以直接加一个 v33 的 goals 重建迁移,会在真实用户升级时悄悄删掉历史 goal 的
子表数据(task board / events / deliverables)。** 有全量目录备份兜底,但不是自动
恢复——属于数据丢失级。

(2026-07-08 已实现到一半后因此**主动回退**,树保持干净。)

## 正经做的方案(供实现者)

1. **迁移 033**:重建 goals 表,`project_id` 改为
   `TEXT REFERENCES projects(id) ON DELETE SET NULL`(可空 + SET NULL),列形状其余
   与 post-032 一致(含 `mode`)。模式照抄 `023_native_goal_runtime.sql`。
2. **扩展 preflight**(关键、易错):把 `SAFE_PREFLIGHT_MIGRATIONS` 补到 33(加
   024–033 共 10 条 spec),`SAFE_REBUILD_PREFLIGHT_MAX_VERSION` 提到 33,并确认
   preflight 对"部分已应用"的库(如 on_disk=32 的用户)不会重跑已应用迁移出错。
   **这是数据安全的核心,必须充分测试**(参考现有
   `safe_rebuild_preflight_preserves_session_and_goal_child_rows` 等测试,补 goal
   子表在 033 后仍存活的断言)。
3. **Rust Option 化**(约 8 处,机械):`GoalBrief.project_id: Option<ProjectId>`、
   `GoalRow.project_id: Option<String>` + decode、goal INSERT bind、
   `start_goal_from_proposal_db` 的建项目逻辑(solo 无项目 → None、跳过 session
   mirror)、`goal_status_db`(None → 空 sessions/无 project)、controller 合成 prompt
   / project_follow / session_new_goal_worker(hive-only,Some 兜底)、prompts 主规划。
4. **GUI**(约 10 处):`GoalBrief.projectId?: string`,处理
   `useGoalActions`(solo 不 mirror)、`GoalIndicator`/`useProjectNavigation`/
   `App.tsx`/`useGoalEffects` 里 `goal.projectId` 的 undefined 分支。

(以上 3、4 我 2026-07-08 已写过一版可编译的实现,可从 git 历史/本 issue 参考;
真正的拦路石只有 1、2 的迁移安全。)

## 零风险替代(若只想解决侧边栏污染)

不动迁移:solo 仍建项目,但 GUI 把这些 auto 建的 "Goal · X" 项目从侧边栏项目列表
**过滤掉**(靠 goal.mode==solo 反查)。解决"侧边栏被塞满"的主要痛点,但 session
在数据上仍归属那个隐藏项目(非真·无项目)。JC 2026-07-08 倾向先记 issue 走正经方案 A。

## Comments
