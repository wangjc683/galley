# 01 · providers 表的 auth_kind 约束补上 `none`

Status: ready-for-agent

来源：2026-10-20 讨论 SIWC 时顺带发现。免密钥服务商（galley#24，`8b0c4d38`，08-31 上线）存不进库：
迁移 014 给 `managed_model_providers.auth_kind` 加的约束只允许 `api_key` 和 `chatgpt_codex_oauth`
（`core/migrations/014_managed_model_auth_kind.sql:8`），而保存路径会把 `none` 写进去
（`core/src/commands/managed_model.rs:49` → `core/src/db/helpers.rs:132` → `core/src/db/managed_model.rs:184`）。
用同样的建表语句在 SQLite 里插入 `none`，结果是 `CHECK constraint failed`；没有任何测试把 `none` 写进真库。

## 要做的

新迁移 `052`：把约束放宽为 `auth_kind IN ('api_key', 'chatgpt_codex_oauth', 'none')`，现有行原样保留。

SQLite 不能就地改约束，只能重建表；难点在于 `managed_model_providers` 是 `managed_models` 的外键父表
（`010_managed_model_providers.sql:37`，`ON DELETE CASCADE`）。sqlx 在事务里跑迁移，事务里
`PRAGMA foreign_keys = OFF` 不生效，直接 `DROP TABLE managed_model_providers` 会级联删掉全部模型记录
（v0.2.9 出过同类事故，见 `core/src/migration_backup.rs:422-430` 与 `core/src/app_setup.rs:173-178`）。

推荐做法（不扩展 preflight）：在同一个迁移里先把 `managed_models` 的行拷到临时表、删掉子表，
重建父表（新表 → 拷数据 → 删旧表 → 改名），再按**当前完整结构**重建 `managed_models`（010 加上后续迁移的
所有 ALTER，例如 042）、拷回数据、删临时表，并重建两张表的全部索引（live 库里有
`managed_model_providers_by_updated_at`、`managed_models_by_provider`、`managed_models_by_updated_at`、
`managed_models_one_default`、`managed_models_by_sort_order`）。先确认没有别的表外键引用 `managed_models`。
如果你判断扩展 `migration_backup.rs` 的 preflight 边界更稳，可以改走那条路，但要在实现说明里写清理由。

## 验收

- `none` 服务商能保存、读回、删除；`api_key` 与 `chatgpt_codex_oauth` 行为不变。
- 测试：在跑到 051 的库里放两个服务商、若干模型（含一个默认模型）、带 `advanced` 层数据，跑 052 后
  行数和每列值一致，且 `sqlite_master` 里两张表的结构（除约束这一处）与索引和迁移前一致。
- 六处手写迁移列表都补上 052：`grep -rn "MIG_0" core/tests cli/tests -l`。
- `cargo test --manifest-path core/Cargo.toml --workspace` 全绿，`cargo check` 同；`git diff --check` 干净。

## 约束

- 只在给定的 worktree 里工作，不碰主工作树，不跑 `tauri dev`。
- `core/` 不是 rustfmt-clean：只对自己动过的 Rust 文件跑 `rustfmt --check`，别跑 `cargo fmt --all`。
- 提交只点名文件，禁用 `git add -A` / `git commit -a`；提交信息用英文，结尾带
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 不改 Agent API / CLI 输出（CLI 不暴露 auth kind）。

## Comments
