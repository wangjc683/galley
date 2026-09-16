# 01: Core 数据层 — 迁移 039、GoalBrief v2、GalleyApi 收窄

Status: done
PRD: ../PRD.md（§3.5、§3.6 GoalBrief v2、§4.2）
Blocked by: 无（第一张票；02 / 03 / 04 依赖本票的类型与 DB 面）

## 范围

只做数据模型与 Rust API 面，不碰循环（03）、不碰 socket / CLI（04）、
不碰 GUI（05）。

- **迁移 `039_goal_v2.sql`**（`core/migrations/` + `db_migrations.rs` 注册）：
  - 删表 `goal_proposals`、`goal_tasks`、`goal_events`、`goal_deliverables`。
  - 重建 `goals`：`id, session_id NOT NULL REFERENCES sessions(id) ON DELETE
    CASCADE, objective, status CHECK IN ('active','paused','blocked',
    'completed','budget_limited','stopped','failed'), budget_seconds NULL,
    started_at, ended_at, paused_at, latest_summary, result_seen_at,
    continuation_count INTEGER NOT NULL DEFAULT 0, wrap_up_dispatched
    INTEGER NOT NULL DEFAULT 0, created_at, updated_at, created_via,
    supervisor, origin_note`。
  - 部分唯一索引：`goals(session_id) WHERE status IN ('active','paused',
    'blocked')`。删 `goals_single_active`。保留 `goals_visible_unseen_results`
    语义（status IN ('completed','budget_limited','blocked','failed') AND
    result_seen_at IS NULL）。
  - 旧数据搬迁：`INSERT … SELECT` 旧 goals，`master_session_id → session_id`；
    `running / wrapping → 'stopped'`；`master_session_id IS NULL` 的行丢弃；
    `created_via / supervisor / origin_note` 旧表没有则置 `'system'` / NULL。
  - `messages.goal_id` 保留不动。
- **preflight 边界**：`migration_backup.rs` 的
  `SAFE_REBUILD_PREFLIGHT_MAX_VERSION = 33`。039 是表重建且 `INSERT…SELECT`
  依赖 032 的 `mode` 列不存在于新表（不读它即可）。按 07-09 devlog §2 先例
  评估是否扩到 39：若扩，边界必须连续（34–38 全部纳入）、spec 用
  `include_str!` 全文；`migration_backup.rs` 里 `Applied { to: 33 }` 的硬编
  码测试同步。结论写进本票 Comments。
- **`core/src/api/goal.rs`**：`GoalStatus` 七值；`GoalBrief` v2 字段：
  `id, session_id, objective, status, budget_seconds: Option<u32>, started_at,
  ended_at, paused_at, latest_summary, result_seen_at, continuation_count,
  elapsed_seconds（查询时算：ended_at ?? now − started_at − 暂停累计，v1 先
  不扣暂停时长，直接 now − started_at）, created_at, updated_at, origin`。
  删 `GoalProposal*`、`GoalTask*`、`GoalEvent*`、`GoalDeliverable*`、
  `GoalWorkerContext`、`GoalStatusSnapshot` 的 tasks / events / sessions /
  deliverable（只留 `goal`）、`GoalMode`、`GoalWriteMode`、`worker_limit`、
  `DEFAULT_GOAL_BUDGET_SECONDS` 改为 `60 * 60`。`GoalLocale` 保留（续跑模板
  双语用）。删 9 个叙述文案函数（`goal_launch_ack` 等）；三份模板文案由 03
  新建。
- **`core/src/db/goal.rs`** 重写：`create_goal(session_id, objective,
  budget_seconds, origin)`（唯一索引冲突映射为 `invalid_args`，消息含现有
  goal id）、`get_goal`、`list_active_goals`（active / paused / blocked）、
  `list_visible_goals`（活跃 + 未查看终态）、`list_goals_for_session`、
  `update_goal_status(id, status, latest_summary, {ended_at|paused_at})`、
  `bump_continuation(id, wrap_up: bool)`、`mark_goal_result_seen`。
- **`core/src/api.rs` trait + `db/api_impl.rs`**：删 `create_goal_proposal /
  start_goal_from_proposal / goal_status_full / set_goal_deliverable /
  latest_goal_deliverable / request_goal_stop（改由 03 的 stop 路径调
  update_goal_status）/ create_goal_task / claim_goal_task /
  update_goal_task / create_goal_event / send_system_message_for_goal`；
  `send_message_for_goal` 保留（目标行盖 goal_id）。
- **`db/helpers.rs` / `db/rows.rs`**：删 proposal / write_mode / mode /
  task / event 的 SQL 映射；`goal_status_sql` 改七值。
- `app_paths.rs` 删 `goal_workspace_dir / goal_runtime_dir` 及其测试。

## 验收

- `cargo check --manifest-path core/Cargo.toml --workspace` 过（CLI 侧引用
  旧类型会编译失败：本票允许暂以 `#[allow]` 或 stub 让 workspace 通过，04
  正式清理；或 01 与 04 同一分支连续落地，二选一在 Comments 写明）。
- `cargo test` 过：新增 db 测试——建 goal / 同 session 二次建冲突 /
  list_visible 含 blocked 未读 / 旧行搬迁（fixture 含 running、wrapping、
  无 master 三种）。
- 本机真实库升级实测（备份 + preflight 全过），JC 库 goals 0 行。

## 注意

- 只格式化自己动过的文件（core 不是 rustfmt-clean）。
- `messages.goal_id` 与 `send_message_for_goal` 是 GUI 委派标记的匹配基础，
  不动。

## Comments

**2026-09-16 落地（分支 `goal-v2`，未提交）**

- 消费者处理选了「01 与 04 的删除部分连续落地」：`cli/src/goal/` 整目录、
  `desktop_goal.rs`、`session_goal_cmds.rs`、`session.new_goal_worker`、
  三个 `session.goal_*` socket 命令、对应 protocol 结构与测试全部删除，
  workspace 干净编译，无 stub。04 只剩「新增四个命令 + schema 政策」。
- **preflight 边界不扩**：`messages.goal_id` 无 FK（031 明说），goals 的子表
  先于 goals 删除，DROP TABLE 的隐式 DELETE 无处可级联；039 走 SQLx 普通迁移
  事务即可，`SAFE_REBUILD_PREFLIGHT_MAX_VERSION` 保持 33。真实库副本（38
  版、0 goal、12 proposals）在 `PRAGMA foreign_keys=ON` 下整段事务跑通，
  `foreign_key_check` 空，messages 行数不变。
- **`goal_hive_master_duty.md` 不删**：git log 显示它随上游 GA baseline 升级
  变动，是上游 seed 而非 Galley 文件（Rule 1 不 fork）。只去掉了 Galley 的
  `include_str!` 引用。PRD §4.2 该行已改。
- **`send_system_message_for_goal` 保留**：`session.checkpoint` 是 v1 公开
  命令，带 `goalId` 时经它落行；删掉会连带改一个仍在用的命令。
- 顺手：`ensure_goal_synthesis_runner` 搬到 `session_cmds.rs` 改名
  `ensure_session_runner`（`#[allow(dead_code)]`，03 接线）；启动时
  `resume_active_goals` 换成 `pause_open_goals`（03 的重启语义，逻辑只有一行
  就一并做了）；`request_goal_stop` Tauri 命令暂改为纯状态写 `stopped`，03
  在前面加 abort。
- 测试：`db_writes_test.rs` 7 条 v2 用例（建/冲突/状态戳/可见列表排序/
  重启暂停/goal_id 盖章/039 搬迁三形态），socket 与 CLI 的 v1 goal 用例删除。
  `cargo test --workspace` 全绿。
- GUI 未动（05），此刻 GUI 里的 goal 相关 invoke 会在运行时报 command not
  found，属预期，分支内闭合。
