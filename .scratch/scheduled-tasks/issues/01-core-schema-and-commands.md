# 01: Core 数据层 — schedules 表、CRUD 与命令/事件面

Status: done
PRD: ../PRD.md（决策 1、2）

## 范围

Rust Core 新增 scheduled task 实体的持久化与读写面。不含调度循环
（见 02）、不含任何 GUI（见 03/04）。

- SQLite migration（`core/src/db_migrations.rs` + `core/src/db/` 新模块）。
  建议字段：`id`、`project_id`（可空=无项目）、`prompt`、重复规则
  （v1 只需表达 每天/每周几 + 本地时刻）、`enabled`、
  `last_fired_at`、`last_run_session_id`（关联产出会话）、
  `created_at` / `updated_at`。
- Rust 域模型 + CRUD：list / create / update / toggle / delete。
- Tauri command 面向 GUI 暴露上述操作；变更通过现有 broadcast
  事件总线发事件，GUI 订阅刷新（参考 `core/src/runner_commands.rs`
  的事件模式）。
- 「下次触发时间」的纯函数计算（给 02 循环和 GUI 展示共用），
  含单测：跨午夜、每周几、DST 切换。

## 验收

- `cargo check --workspace` / `cargo test --workspace` 通过。
- 重复规则的 next-fire 计算有覆盖 DST 与周界的单测。
- 不引入 GUI 侧权威写（Rule 5）。

## 注意

- 重复规则的存储表达要留 additive 扩展空间（将来可能加
  `every_Nh`），但 v1 不实现。
- `last_run_session_id` 关联的 session 可能被归档/删除，读侧要容忍
  悬空引用。
