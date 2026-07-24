//! SQLite schema migrations for `workbench.db`, extracted from `lib.rs`.
//! The vec is pure data: one entry per file under `core/migrations/`, in
//! version order. `app_setup` registers it with `tauri-plugin-sql` and
//! derives the pre-migration-backup version gate from it.

use tauri_plugin_sql::{Migration, MigrationKind};

/// SQLite filename. Resolved by tauri-plugin-sql relative to the
/// platform's app-data directory:
///
///   macOS:  ~/Library/Application Support/app.galley/
///
/// Schema lives in core/migrations/001_init.sql; tauri-plugin-sql
/// runs Up migrations in version order on first connect.
pub(crate) const DB_URL: &str = "sqlite:workbench.db";

pub(crate) fn all() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add sessions.has_unread",
            sql: include_str!("../migrations/002_add_has_unread.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add messages.summary",
            sql: include_str!("../migrations/003_add_message_summary.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add messages_fts (full-text search)",
            sql: include_str!("../migrations/004_add_messages_fts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add messages.preamble",
            sql: include_str!("../migrations/005_add_message_preamble.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add messages origin (created_via, supervisor, origin_note)",
            sql: include_str!("../migrations/006_messages_origin.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description:
                "add sessions origin (created_via, created_by_supervisor, created_origin_note)",
            sql: include_str!("../migrations/007_sessions_origin.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add managed/external runtime identity",
            sql: include_str!("../migrations/008_runtime_identity.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add managed model metadata",
            sql: include_str!("../migrations/009_managed_models.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "split managed model providers from models",
            sql: include_str!("../migrations/010_managed_model_providers.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "add managed model display order",
            sql: include_str!("../migrations/011_managed_model_sort_order.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "add managed model local encrypted secrets",
            sql: include_str!("../migrations/012_managed_model_local_secrets.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "add stable per-session LLM identity",
            sql: include_str!("../migrations/013_session_llm_key.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "add managed model provider auth kind",
            sql: include_str!("../migrations/014_managed_model_auth_kind.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "add Galley Goal V1 state",
            sql: include_str!("../migrations/015_goal_v1.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "add Goal master session delivery state",
            sql: include_str!("../migrations/016_goal_master_session.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "add message visibility",
            sql: include_str!("../migrations/017_message_visibility.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "add Goal deliverable anchor",
            sql: include_str!("../migrations/018_goal_deliverable.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "add Goal file workspace path",
            sql: include_str!("../migrations/019_goal_workspace.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "add message attachments",
            sql: include_str!("../migrations/020_message_attachments.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "allow Galley Native session runtime",
            sql: include_str!("../migrations/021_native_session_runtime.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "add Galley Native memory substrate",
            sql: include_str!("../migrations/022_native_memory_substrate.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "allow Galley Native Goal runtime",
            sql: include_str!("../migrations/023_native_goal_runtime.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "make Galley Native the default built-in runtime",
            sql: include_str!("../migrations/024_native_default_runtime.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "restore managed runtime default after native experiment",
            sql: include_str!("../migrations/025_restore_managed_runtime_default.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "project workspace binding",
            sql: include_str!("../migrations/026_project_workspace.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "backfill managed model context_win default",
            sql: include_str!("../migrations/027_managed_model_context_win.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "add message telemetry",
            sql: include_str!("../migrations/028_message_telemetry.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 29,
            description: "backfill managed custom model context_win default",
            sql: include_str!("../migrations/029_managed_model_custom_context_win.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 30,
            description: "enforce single active goal",
            sql: include_str!("../migrations/030_single_active_goal.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 31,
            description: "stamp goal-scoped message rows with goal_id",
            sql: include_str!("../migrations/031_message_goal_id.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 32,
            description: "add goal solo/hive engine mode",
            sql: include_str!("../migrations/032_goal_mode.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 33,
            description: "make goals.project_id optional (solo without a project)",
            sql: include_str!("../migrations/033_goal_optional_project.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 34,
            description: "per-session approval mode override",
            sql: include_str!("../migrations/034_session_approval_mode.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 35,
            description: "add scheduled tasks",
            sql: include_str!("../migrations/035_scheduled_tasks.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 36,
            description: "add scheduled task monthly repeat",
            sql: include_str!("../migrations/036_scheduled_tasks_monthly.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 37,
            description: "add scheduled task per-task model",
            sql: include_str!("../migrations/037_scheduled_tasks_llm.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
