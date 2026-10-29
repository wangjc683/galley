//! Integration tests for `SqliteGalley` write methods (B3 M4a).
//!
//! Read tests live in [`db_test.rs`]; write tests are split out so the
//! happy-path / error-path matrix per method has room to breathe.
//! Shared test setup (`fresh_pool`) is intentionally duplicated rather
//! than imported from `db_test.rs` because cargo test compiles each
//! `tests/*.rs` as its own crate root — sharing across files needs a
//! `tests/common/mod.rs` scaffold that adds noise for two test files.

use galley_core_lib::api::{
    CreateProjectInput, CreateScheduledTaskInput, CreateSessionInput, GalleyApi,
    ManagedModelAuthKind, ManagedModelCredentialStatus, ManagedModelProtocol, MessageTelemetry,
    MessageVisibility, Origin, ProjectId, ProjectPatch, RuntimeKind, ScheduledTaskId,
    ScheduledTaskPatch, ScheduledTaskRepeat, SessionFilter, SessionId, SessionStatus,
};
use galley_core_lib::credential_store;
use galley_core_lib::db::{
    PersistAssistantMessage, SqliteGalley, UpsertManagedModelMetadata,
    UpsertManagedModelProviderMetadata,
};
use galley_core_lib::error::GalleyError;
use galley_core_lib::managed_runtime;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

// Migration SQL — keep in sync with `core/src/lib.rs::run()`.
const MIG_001: &str = include_str!("../migrations/001_init.sql");
const MIG_002: &str = include_str!("../migrations/002_add_has_unread.sql");
const MIG_003: &str = include_str!("../migrations/003_add_message_summary.sql");
const MIG_004: &str = include_str!("../migrations/004_add_messages_fts.sql");
const MIG_005: &str = include_str!("../migrations/005_add_message_preamble.sql");
const MIG_006: &str = include_str!("../migrations/006_messages_origin.sql");
const MIG_007: &str = include_str!("../migrations/007_sessions_origin.sql");
const MIG_008: &str = include_str!("../migrations/008_runtime_identity.sql");
const MIG_009: &str = include_str!("../migrations/009_managed_models.sql");
const MIG_010: &str = include_str!("../migrations/010_managed_model_providers.sql");
const MIG_011: &str = include_str!("../migrations/011_managed_model_sort_order.sql");
const MIG_012: &str = include_str!("../migrations/012_managed_model_local_secrets.sql");
const MIG_013: &str = include_str!("../migrations/013_session_llm_key.sql");
const MIG_014: &str = include_str!("../migrations/014_managed_model_auth_kind.sql");
const MIG_015: &str = include_str!("../migrations/015_goal_v1.sql");
const MIG_016: &str = include_str!("../migrations/016_goal_master_session.sql");
const MIG_017: &str = include_str!("../migrations/017_message_visibility.sql");
const MIG_018: &str = include_str!("../migrations/018_goal_deliverable.sql");
const MIG_019: &str = include_str!("../migrations/019_goal_workspace.sql");
const MIG_020: &str = include_str!("../migrations/020_message_attachments.sql");
const MIG_021: &str = include_str!("../migrations/021_native_session_runtime.sql");
const MIG_022: &str = include_str!("../migrations/022_native_memory_substrate.sql");
const MIG_023: &str = include_str!("../migrations/023_native_goal_runtime.sql");
const MIG_024: &str = include_str!("../migrations/024_native_default_runtime.sql");
const MIG_025: &str = include_str!("../migrations/025_restore_managed_runtime_default.sql");
const MIG_026: &str = include_str!("../migrations/026_project_workspace.sql");
const MIG_027: &str = include_str!("../migrations/027_managed_model_context_win.sql");
const MIG_028: &str = include_str!("../migrations/028_message_telemetry.sql");
const MIG_029: &str = include_str!("../migrations/029_managed_model_custom_context_win.sql");
// 034 only ADD COLUMN approval_mode to sessions — required since
// SESSIONS_SELECT_COLS reads it.
const MIG_034: &str = include_str!("../migrations/034_session_approval_mode.sql");
const MIG_030: &str = include_str!("../migrations/030_single_active_goal.sql");
const MIG_031: &str = include_str!("../migrations/031_message_goal_id.sql");
const MIG_032: &str = include_str!("../migrations/032_goal_mode.sql");
const MIG_033: &str = include_str!("../migrations/033_goal_optional_project.sql");
const MIG_035: &str = include_str!("../migrations/035_scheduled_tasks.sql");
const MIG_036: &str = include_str!("../migrations/036_scheduled_tasks_monthly.sql");
const MIG_037: &str = include_str!("../migrations/037_scheduled_tasks_llm.sql");
const MIG_038: &str = include_str!("../migrations/038_session_title_source.sql");
const MIG_039: &str = include_str!("../migrations/039_goal_v2.sql");
const MIG_040: &str = include_str!("../migrations/040_session_reasoning_effort.sql");
const MIG_042: &str = include_str!("../migrations/042_managed_model_advanced_layers.sql");
const MIG_043: &str = include_str!("../migrations/043_message_session_client.sql");
const MIG_044: &str = include_str!("../migrations/044_session_main_chat.sql");
const MIG_045: &str = include_str!("../migrations/045_ledger_exclusions.sql");
const MIG_046: &str = include_str!("../migrations/046_main_chat_segments.sql");
const MIG_047: &str = include_str!("../migrations/047_drop_ledger_exclusions.sql");
const MIG_048: &str = include_str!("../migrations/048_subtasks.sql");
const MIG_049: &str = include_str!("../migrations/049_scheduled_tasks_once_and_wake.sql");
const MIG_050: &str = include_str!("../migrations/050_todos.sql");
const MIG_051: &str = include_str!("../migrations/051_cancelled_by.sql");
const MIG_052: &str = include_str!("../migrations/052_provider_auth_kind_none.sql");
const MIG_053: &str = include_str!("../migrations/053_memos.sql");
const MIG_054: &str = include_str!("../migrations/054_todo_subitems.sql");

async fn fresh_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    // FK enforcement isn't on by default for new SQLite connections;
    // turn it on so assign_session_to_project / delete_project pickup
    // the FK violations our tests expect.
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    run_migrations(&pool).await;
    pool
}

async fn fresh_file_pool() -> (tempfile::TempDir, SqlitePool) {
    let dir = tempfile::tempdir().expect("create tempdir");
    let path = dir.path().join("galley-test.db");
    let opts = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(opts)
        .await
        .expect("open file-backed sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    run_migrations(&pool).await;
    (dir, pool)
}

async fn run_migrations(pool: &SqlitePool) {
    run_migrations_through_051(pool).await;
    for sql in [MIG_052, MIG_053, MIG_054] {
        sqlx::raw_sql(sql)
            .execute(pool)
            .await
            .expect("run migration");
    }
}

async fn run_migrations_through_051(pool: &SqlitePool) {
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_027, MIG_028, MIG_029, MIG_030,
        MIG_031, MIG_032, MIG_033, MIG_034, MIG_035, MIG_036, MIG_037, MIG_038, MIG_039, MIG_040,
        MIG_042, MIG_043, MIG_044, MIG_045, MIG_046, MIG_047, MIG_048, MIG_049, MIG_050, MIG_051,
    ] {
        sqlx::raw_sql(sql)
            .execute(pool)
            .await
            .expect("run migration");
    }
}

async fn run_migrations_through_028(pool: &SqlitePool) {
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_027, MIG_028, MIG_034,
    ] {
        sqlx::raw_sql(sql)
            .execute(pool)
            .await
            .expect("run migration through 028");
    }
}

fn sid(s: &str) -> SessionId {
    SessionId(s.to_string())
}

fn pid(s: &str) -> ProjectId {
    ProjectId(s.to_string())
}

async fn seed_session_idle(pool: &SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO sessions (id, title, status, turn_count, pending_approval_count, \
            error_count, pinned, last_activity_at, created_at, updated_at) \
         VALUES (?, ?, 'idle', 0, 0, 0, 0, ?, ?, ?)",
    )
    .bind(id)
    .bind(format!("title-{id}"))
    .bind("2026-05-19T00:00:00Z")
    .bind("2026-05-19T00:00:00Z")
    .bind("2026-05-19T00:00:00Z")
    .execute(pool)
    .await
    .expect("seed session");
}

async fn seed_project(pool: &SqlitePool, id: &str, name: &str) {
    sqlx::query(
        "INSERT INTO projects (id, name, pinned, last_activity_at, created_at, updated_at) \
         VALUES (?, ?, 0, ?, ?, ?)",
    )
    .bind(id)
    .bind(name)
    .bind("2026-05-19T00:00:00Z")
    .bind("2026-05-19T00:00:00Z")
    .bind("2026-05-19T00:00:00Z")
    .execute(pool)
    .await
    .expect("seed project");
}

#[tokio::test]
async fn assistant_message_telemetry_round_trips() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "sess_telemetry").await;
    let galley = SqliteGalley::from_pool(pool);

    galley
        .persist_assistant_message(PersistAssistantMessage {
            session_id: sid("sess_telemetry"),
            turn_index: 1,
            content: "Final answer".into(),
            tool_calls: Some("[]".into()),
            tool_results: Some("[]".into()),
            thinking: None,
            final_answer: Some("Final answer".into()),
            summary: Some("done".into()),
            preamble: None,
            visibility: MessageVisibility::Visible,
            telemetry: Some(MessageTelemetry {
                elapsed_ms: Some(135_000),
                input_tokens: Some(18_000),
                output_tokens: Some(1_200),
                cache_create_tokens: Some(100),
                cache_read_tokens: Some(300),
                request_count: Some(2),
                context_used_chars: Some(126_000),
                context_limit_chars: Some(300_000),
            }),
        })
        .await
        .expect("persist assistant telemetry");

    let rows = galley
        .persisted_message_rows(&sid("sess_telemetry"))
        .await
        .expect("load message rows");
    assert_eq!(rows.len(), 1);
    let telemetry = rows[0].telemetry.as_ref().expect("telemetry");
    assert_eq!(telemetry.elapsed_ms, Some(135_000));
    assert_eq!(telemetry.input_tokens, Some(18_000));
    assert_eq!(telemetry.output_tokens, Some(1_200));
    assert_eq!(telemetry.context_used_chars, Some(126_000));
    assert_eq!(telemetry.context_limit_chars, Some(300_000));
}

// ---------------- Goal removed (schemaVersion 3) ----------------

/// Goal was removed on 2026-10-13 without a migration: `messages.goal_id`
/// stays in the schema, but no write fills it and no read returns it, so
/// a row an older Galley stamped reads like any other.
#[tokio::test]
async fn a_legacy_goal_id_is_neither_written_nor_read_back() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    seed_session_idle(&pool, "s1").await;
    let sent = galley
        .send_message(sid("s1"), "plain".into(), Origin::gui())
        .await
        .expect("send");
    let narrated = galley
        .send_system_message(sid("s1"), "narration".into(), Origin::gui())
        .await
        .expect("system row");
    // A row written before the removal still carries its stamp.
    sqlx::query(
        "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, \
            created_at, visibility, goal_id) \
         VALUES ('m_legacy', 's1', 9, 0, 'user', 'objective', '2026-09-16T00:00:00Z', \
            'visible', 'goal_legacy')",
    )
    .execute(&pool)
    .await
    .expect("seed legacy row");

    let stamps: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT id, goal_id FROM messages WHERE session_id = 's1' ORDER BY turn_index",
    )
    .fetch_all(&pool)
    .await
    .expect("read stamps");
    assert_eq!(
        stamps,
        vec![
            (sent.id.0.clone(), None),
            (narrated.id.0.clone(), None),
            ("m_legacy".to_string(), Some("goal_legacy".to_string())),
        ]
    );

    let briefs = galley
        .session_messages(sid("s1"), None)
        .await
        .expect("briefs");
    assert_eq!(briefs.len(), 3);
    let rows = galley
        .persisted_message_rows(&sid("s1"))
        .await
        .expect("rows");
    assert_eq!(rows.len(), 3);
    let wire = serde_json::to_string(&(briefs, rows)).expect("serialize");
    assert!(!wire.contains("goal"), "{wire}");
}

/// Migration 039 carries v1 rows over: finished goals keep their status,
/// mid-run ones land as `stopped` and already seen, headless ones drop.
/// The migration still runs for anyone upgrading from before 2026-09-16,
/// so it stays pinned; with Goal removed (2026-10-13) the carried rows are
/// read straight from the table.
#[tokio::test]
async fn migration_039_carries_v1_goals_onto_their_sessions() {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_027, MIG_028, MIG_029, MIG_030,
        MIG_031, MIG_032, MIG_033, MIG_034, MIG_035, MIG_036, MIG_037, MIG_038,
    ] {
        sqlx::raw_sql(sql).execute(&pool).await.expect("migration");
    }
    seed_session_idle(&pool, "s1").await;
    seed_session_idle(&pool, "s2").await;
    let v1_insert = "INSERT INTO goals (
            id, proposal_id, project_id, objective, status, budget_seconds, worker_limit,
            runtime_kind, write_mode, started_at, deadline_at, ended_at, latest_summary,
            stop_requested, created_at, updated_at, master_session_id, result_seen_at,
            workspace_path, mode
         ) VALUES (?, NULL, NULL, ?, ?, 600, 1, 'managed', 'autonomous',
            '2026-07-01T10:00:00+00:00', '2026-07-01T10:10:00+00:00', ?, ?, 0,
            '2026-07-01T10:00:00+00:00', '2026-07-01T10:20:00+00:00', ?, ?, NULL, 'solo')";
    for (id, status, ended, summary, master, seen) in [
        (
            "g-done",
            "completed",
            Some("2026-07-01T10:09:00+00:00"),
            Some("shipped"),
            Some("s1"),
            Some("2026-07-01T10:30:00+00:00"),
        ),
        (
            "g-live",
            "running",
            None,
            Some("mid-step"),
            Some("s2"),
            None,
        ),
        (
            "g-headless",
            "completed",
            Some("2026-07-01T10:09:00+00:00"),
            None,
            None,
            None,
        ),
    ] {
        sqlx::query(v1_insert)
            .bind(id)
            .bind("obj")
            .bind(status)
            .bind(ended)
            .bind(summary)
            .bind(master)
            .bind(seen)
            .execute(&pool)
            .await
            .expect("seed v1 goal");
    }
    sqlx::query(
        "INSERT INTO goal_tasks (id, goal_id, title, status, created_at, updated_at)          VALUES ('t1', 'g-live', 'task', 'open', 'x', 'x')",
    )
    .execute(&pool)
    .await
    .expect("seed child row");

    sqlx::raw_sql(MIG_039)
        .execute(&pool)
        .await
        .expect("apply 039");
    sqlx::raw_sql(MIG_040)
        .execute(&pool)
        .await
        .expect("apply 040");

    type Carried = (
        String,
        String,
        Option<i64>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    );
    let carried: Vec<Carried> = sqlx::query_as(
        "SELECT id, session_id, budget_seconds, status, started_at, ended_at, latest_summary \
         FROM goals ORDER BY id",
    )
    .fetch_all(&pool)
    .await
    .expect("read carried rows");
    assert_eq!(
        carried,
        vec![
            (
                "g-done".to_string(),
                "s1".to_string(),
                Some(600),
                "completed".to_string(),
                Some("2026-07-01T10:00:00+00:00".to_string()),
                Some("2026-07-01T10:09:00+00:00".to_string()),
                Some("shipped".to_string()),
            ),
            (
                "g-live".to_string(),
                "s2".to_string(),
                Some(600),
                "stopped".to_string(),
                Some("2026-07-01T10:00:00+00:00".to_string()),
                Some("2026-07-01T10:20:00+00:00".to_string()),
                Some("mid-step".to_string()),
            ),
        ],
        "g-headless had no thread to land in and is dropped"
    );
    // Neither carried row may resurface as an unseen result.
    let unseen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM goals WHERE result_seen_at IS NULL")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(unseen, 0, "mid-run rows must not resurface as unseen");
    for table in [
        "goal_tasks",
        "goal_events",
        "goal_deliverables",
        "goal_proposals",
    ] {
        let exists: Option<String> =
            sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
                .bind(table)
                .fetch_optional(&pool)
                .await
                .unwrap();
        assert!(exists.is_none(), "{table} should be dropped");
    }
}

// ---------------- managed model advanced layers (042) ----------------

async fn run_migrations_through_040(pool: &SqlitePool) {
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_027, MIG_028, MIG_029, MIG_030,
        MIG_031, MIG_032, MIG_033, MIG_034, MIG_035, MIG_036, MIG_037, MIG_038, MIG_039, MIG_040,
    ] {
        sqlx::raw_sql(sql)
            .execute(pool)
            .await
            .expect("run migration through 040");
    }
}

async fn seed_pre_042_provider(pool: &SqlitePool, id: &str, protocol: &str, api_base: &str) {
    sqlx::query(
        "INSERT INTO managed_model_providers (
           id, display_name, protocol, auth_kind, api_base, api_key_ref, created_at, updated_at
         ) VALUES (?, ?, ?, 'api_key', ?, ?, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    )
    .bind(id)
    .bind(id)
    .bind(protocol)
    .bind(api_base)
    .bind(format!("managed-provider:{id}"))
    .execute(pool)
    .await
    .expect("seed provider");
}

async fn seed_pre_042_model(
    pool: &SqlitePool,
    id: &str,
    provider_id: &str,
    sort_order: i64,
    snapshot: &str,
) {
    sqlx::query(
        "INSERT INTO managed_models (
           id, provider_id, display_name, model, advanced_options, is_default,
           last_validated_at, sort_order, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
    )
    .bind(id)
    .bind(provider_id)
    .bind(id)
    .bind(id)
    .bind(snapshot)
    .bind(sort_order)
    .execute(pool)
    .await
    .expect("seed model");
}

async fn managed_model_column_json(pool: &SqlitePool, id: &str, column: &str) -> serde_json::Value {
    let raw: String = sqlx::query_scalar(&format!(
        "SELECT {column} FROM managed_models WHERE id = ?"
    ))
    .bind(id)
    .fetch_one(pool)
    .await
    .expect("read managed model column");
    serde_json::from_str(&raw).expect("column is JSON")
}

async fn managed_model_defaults_pref(pool: &SqlitePool) -> Option<serde_json::Value> {
    let raw: Option<String> =
        sqlx::query_scalar("SELECT value FROM prefs WHERE key = 'managed_model_defaults'")
            .fetch_optional(pool)
            .await
            .expect("read defaults pref");
    raw.map(|raw| serde_json::from_str(&raw).expect("pref is JSON"))
}

const SNAP_OPENAI_DIRECT: &str = r#"{"context_win":90000,"api_mode":"chat_completions","temperature":1,"max_retries":3,"connect_timeout":10,"read_timeout":300,"stream":true,"reasoning_effort":"high"}"#;
const SNAP_RELAY_A: &str = r#"{"context_win":90000,"thinking_type":"adaptive","fake_cc_system_prompt":true,"max_retries":3,"read_timeout":300,"stream":false,"reasoning_effort":"high","trim_keep_prefix":4}"#;
const SNAP_RELAY_B: &str = r#"{"context_win":90000,"thinking_type":"adaptive","fake_cc_system_prompt":true,"max_retries":5,"read_timeout":300,"stream":false,"reasoning_effort":"high"}"#;
const SNAP_CODEX: &str = r#"{"context_win":90000,"api_mode":"responses","reasoning_effort":"medium","temperature":1,"max_retries":3,"connect_timeout":10,"read_timeout":300,"stream":true,"codex_backend":true}"#;

/// The 042 invariant: every row's effective object (`preset ⊕ defaults ⊕
/// overrides`, as `list_managed_models` computes it) equals its pre-042
/// snapshot, while the split itself follows the documented rules.
#[tokio::test]
async fn migration_042_splits_snapshots_into_layers_without_changing_effective_options() {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    run_migrations_through_040(&pool).await;
    seed_pre_042_provider(&pool, "mp_openai", "openai", "https://api.openai.com/v1/").await;
    seed_pre_042_provider(&pool, "mp_relay", "anthropic", "https://relay.example/anthropic").await;
    seed_pre_042_provider(&pool, "mp_codex", "openai", "https://chatgpt.com/backend-api/codex").await;
    seed_pre_042_model(&pool, "mm_openai", "mp_openai", 0, SNAP_OPENAI_DIRECT).await;
    seed_pre_042_model(&pool, "mm_relay_a", "mp_relay", 1, SNAP_RELAY_A).await;
    seed_pre_042_model(&pool, "mm_relay_b", "mp_relay", 2, SNAP_RELAY_B).await;
    seed_pre_042_model(&pool, "mm_codex", "mp_codex", 3, SNAP_CODEX).await;
    seed_pre_042_model(&pool, "mm_array", "mp_relay", 4, "[]").await;

    sqlx::raw_sql(MIG_042)
        .execute(&pool)
        .await
        .expect("run 042 migration");

    // Rule 1: the preset layer is the whole old snapshot.
    for (id, snapshot) in [
        ("mm_openai", SNAP_OPENAI_DIRECT),
        ("mm_relay_a", SNAP_RELAY_A),
        ("mm_relay_b", SNAP_RELAY_B),
        ("mm_codex", SNAP_CODEX),
    ] {
        assert_eq!(
            managed_model_column_json(&pool, id, "preset_options").await,
            serde_json::from_str::<serde_json::Value>(snapshot).unwrap(),
            "{id} preset layer"
        );
    }

    // Rule 3: read_timeout 300 is on every object row → lifted. stream and
    // reasoning_effort were pruned on the first-party rows (factory true /
    // seed high+medium), so they stay per-row on the relay models.
    assert_eq!(
        managed_model_defaults_pref(&pool).await,
        Some(serde_json::json!({"read_timeout": 300}))
    );

    // Rules 2 + 4: what remains on each row.
    assert_eq!(
        managed_model_column_json(&pool, "mm_openai", "advanced_options").await,
        serde_json::json!({})
    );
    assert_eq!(
        managed_model_column_json(&pool, "mm_codex", "advanced_options").await,
        serde_json::json!({})
    );
    assert_eq!(
        managed_model_column_json(&pool, "mm_relay_a", "advanced_options").await,
        serde_json::json!({"stream": false, "reasoning_effort": "high", "trim_keep_prefix": 4})
    );
    assert_eq!(
        managed_model_column_json(&pool, "mm_relay_b", "advanced_options").await,
        serde_json::json!({"max_retries": 5, "stream": false, "reasoning_effort": "high"})
    );

    // Non-object rows are untouched.
    let raw_array: String =
        sqlx::query_scalar("SELECT advanced_options FROM managed_models WHERE id = 'mm_array'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(raw_array, "[]");
    let raw_array_preset: String =
        sqlx::query_scalar("SELECT preset_options FROM managed_models WHERE id = 'mm_array'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(raw_array_preset, "{}");

    // The invariant, through the real read path.
    sqlx::query("DELETE FROM managed_models WHERE id = 'mm_array'")
        .execute(&pool)
        .await
        .unwrap();
    let galley = SqliteGalley::from_pool(pool.clone());
    let models = galley.list_managed_models().await.expect("list models");
    for (id, snapshot) in [
        ("mm_openai", SNAP_OPENAI_DIRECT),
        ("mm_relay_a", SNAP_RELAY_A),
        ("mm_relay_b", SNAP_RELAY_B),
        ("mm_codex", SNAP_CODEX),
    ] {
        let model = models.iter().find(|m| m.id == id).expect(id);
        assert_eq!(
            model.advanced_options,
            serde_json::from_str::<serde_json::Value>(snapshot).unwrap(),
            "{id} effective options must survive 042 unchanged"
        );
    }
}

#[tokio::test]
async fn migration_042_lifts_a_shared_tier_and_keeps_an_existing_defaults_pref() {
    // Two relay models that agree on everything non-factory → all of it
    // lifts, rows end up empty.
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    run_migrations_through_040(&pool).await;
    seed_pre_042_provider(&pool, "mp_relay", "anthropic", "https://relay.example").await;
    seed_pre_042_model(&pool, "mm_a", "mp_relay", 0, SNAP_RELAY_B).await;
    seed_pre_042_model(&pool, "mm_b", "mp_relay", 1, SNAP_RELAY_B).await;
    sqlx::raw_sql(MIG_042).execute(&pool).await.unwrap();
    assert_eq!(
        managed_model_defaults_pref(&pool).await,
        Some(serde_json::json!({
            "max_retries": 5, "read_timeout": 300, "stream": false, "reasoning_effort": "high"
        }))
    );
    assert_eq!(
        managed_model_column_json(&pool, "mm_a", "advanced_options").await,
        serde_json::json!({})
    );

    // A pre-existing defaults pref blocks the lift entirely.
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    run_migrations_through_040(&pool).await;
    sqlx::query(
        "INSERT INTO prefs (key, value, updated_at) VALUES ('managed_model_defaults', '{\"read_timeout\":9}', 'x')",
    )
    .execute(&pool)
    .await
    .unwrap();
    seed_pre_042_provider(&pool, "mp_relay", "anthropic", "https://relay.example").await;
    seed_pre_042_model(&pool, "mm_a", "mp_relay", 0, SNAP_RELAY_B).await;
    sqlx::raw_sql(MIG_042).execute(&pool).await.unwrap();
    assert_eq!(
        managed_model_defaults_pref(&pool).await,
        Some(serde_json::json!({"read_timeout": 9}))
    );
    assert_eq!(
        managed_model_column_json(&pool, "mm_a", "advanced_options").await,
        serde_json::json!({"max_retries": 5, "read_timeout": 300, "stream": false, "reasoning_effort": "high"})
    );
}

// ---------------- managed provider auth kind 'none' (052) ----------------

/// A stored CREATE statement with its layout taken out: whitespace runs
/// collapse to one space, and the spaces next to `(`, `)` and `,` go. A
/// table written with every column inline and the same table grown by
/// ALTER TABLE ADD COLUMN then compare equal.
fn normalized_create_sql(sql: &str) -> String {
    let collapsed = sql.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out = String::with_capacity(collapsed.len());
    for ch in collapsed.chars() {
        if matches!(ch, '(' | ')' | ',') && out.ends_with(' ') {
            out.pop();
        }
        if ch == ' ' && (out.ends_with('(') || out.ends_with(')') || out.ends_with(',')) {
            continue;
        }
        out.push(ch);
    }
    out
}

async fn text_rows(pool: &SqlitePool, sql: &str, bind: &str) -> Vec<String> {
    sqlx::query_scalar(sql)
        .bind(bind)
        .fetch_all(pool)
        .await
        .unwrap_or_else(|e| panic!("{sql}: {e}"))
}

/// Everything SQLite records about `table` but its rootpages, one line each:
/// the CREATE statement (normalized), every column, foreign key and index
/// (an index's own statement verbatim, then its columns), and every row with
/// its rowid, each value through quote() so a changed type would show too.
async fn table_snapshot(pool: &SqlitePool, table: &str) -> Vec<String> {
    let create: String =
        sqlx::query_scalar("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
            .bind(table)
            .fetch_one(pool)
            .await
            .expect("table sql");
    let mut lines = vec![format!("table: {}", normalized_create_sql(&create))];
    for line in text_rows(
        pool,
        "SELECT quote(cid) || '|' || quote(name) || '|' || quote(type) || '|' || \
                quote(\"notnull\") || '|' || quote(dflt_value) || '|' || quote(pk) || '|' || \
                quote(hidden) \
         FROM pragma_table_xinfo(?) ORDER BY cid",
        table,
    )
    .await
    {
        lines.push(format!("column: {line}"));
    }
    for line in text_rows(
        pool,
        "SELECT quote(id) || '|' || quote(seq) || '|' || quote(\"table\") || '|' || \
                quote(\"from\") || '|' || quote(\"to\") || '|' || quote(on_update) || '|' || \
                quote(on_delete) || '|' || quote(\"match\") \
         FROM pragma_foreign_key_list(?) ORDER BY id, seq",
        table,
    )
    .await
    {
        lines.push(format!("foreign key: {line}"));
    }
    let index_names = text_rows(
        pool,
        "SELECT name FROM pragma_index_list(?) ORDER BY name",
        table,
    )
    .await;
    for index in index_names {
        let (unique, origin, partial, sql): (i64, String, i64, Option<String>) = sqlx::query_as(
            "SELECT il.\"unique\", il.origin, il.partial, m.sql \
             FROM pragma_index_list(?) il \
             LEFT JOIN sqlite_master m ON m.type = 'index' AND m.name = il.name \
             WHERE il.name = ?",
        )
        .bind(table)
        .bind(&index)
        .fetch_one(pool)
        .await
        .expect("index row");
        lines.push(format!(
            "index: {index}|unique={unique}|origin={origin}|partial={partial}|{sql:?}"
        ));
        for line in text_rows(
            pool,
            "SELECT quote(seqno) || '|' || quote(cid) || '|' || quote(name) || '|' || \
                    quote(\"desc\") || '|' || quote(coll) || '|' || quote(key) \
             FROM pragma_index_xinfo(?) ORDER BY seqno",
            &index,
        )
        .await
        {
            lines.push(format!("index column: {index}|{line}"));
        }
    }
    let columns = text_rows(
        pool,
        "SELECT name FROM pragma_table_info(?) ORDER BY cid",
        table,
    )
    .await;
    let values = columns
        .iter()
        .map(|c| format!("quote(\"{c}\")"))
        .collect::<Vec<_>>()
        .join(" || '|' || ");
    let rows: Vec<String> = sqlx::query_scalar(&format!(
        "SELECT quote(rowid) || '|' || {values} FROM \"{table}\" ORDER BY rowid"
    ))
    .fetch_all(pool)
    .await
    .expect("table rows");
    lines.extend(rows.into_iter().map(|row| format!("row: {row}")));
    lines
}

/// One connection, so a PRAGMA set on it holds for every later statement.
async fn single_connection_pool_through_051() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    run_migrations_through_051(&pool).await;
    pool
}

async fn seed_051_provider(pool: &SqlitePool, id: &str, protocol: &str, auth_kind: &str) {
    sqlx::query(
        "INSERT INTO managed_model_providers (
           id, display_name, protocol, api_base, api_key_ref, created_at, updated_at, auth_kind
         ) VALUES (?, ?, ?, ?, ?, '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', ?)",
    )
    .bind(id)
    .bind(format!("{id} provider"))
    .bind(protocol)
    .bind(format!("https://{id}.example/v1"))
    .bind(format!("managed-provider:{id}"))
    .bind(auth_kind)
    .execute(pool)
    .await
    .expect("seed provider");
}

async fn seed_051_model(
    pool: &SqlitePool,
    id: &str,
    provider_id: &str,
    is_default: bool,
    sort_order: i64,
    last_validated_at: Option<&str>,
    preset_options: &str,
    advanced_options: &str,
) {
    sqlx::query(
        "INSERT INTO managed_models (
           id, provider_id, display_name, model, advanced_options, is_default,
           last_validated_at, created_at, updated_at, sort_order, preset_options
         ) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-09-02T00:00:00Z', '2026-10-02T00:00:00Z', ?, ?)",
    )
    .bind(id)
    .bind(provider_id)
    .bind(format!("{id} model"))
    .bind(format!("{id}-name"))
    .bind(advanced_options)
    .bind(is_default)
    .bind(last_validated_at)
    .bind(sort_order)
    .bind(preset_options)
    .execute(pool)
    .await
    .expect("seed model");
}

async fn run_052_as_sqlx_does(pool: &SqlitePool) {
    // SQLx applies a migration inside one transaction. Foreign keys stay
    // enforced in there (PRAGMA foreign_keys = OFF would be a no-op), so a
    // DROP of the parent table with the models still in place cascades.
    let mut tx = pool.begin().await.expect("begin");
    let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
        .fetch_one(&mut *tx)
        .await
        .expect("read foreign_keys");
    assert_eq!(
        foreign_keys, 1,
        "the cascade hazard must be live in this test"
    );
    sqlx::raw_sql(MIG_052)
        .execute(&mut *tx)
        .await
        .expect("run 052 migration");
    tx.commit().await.expect("commit 052");
}

async fn assert_db_consistent(pool: &SqlitePool) {
    let violations: Vec<(String,)> =
        sqlx::query_as("SELECT \"table\" FROM pragma_foreign_key_check")
            .fetch_all(pool)
            .await
            .expect("foreign_key_check");
    assert!(
        violations.is_empty(),
        "foreign key violations: {violations:?}"
    );
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(pool)
        .await
        .expect("integrity_check");
    assert_eq!(integrity, "ok");
}

const NO_AUTH_PROVIDER_INSERT: &str = "INSERT INTO managed_model_providers (
       id, display_name, protocol, api_base, api_key_ref, created_at, updated_at, auth_kind
     ) VALUES ('mp_local', 'Ollama', 'openai', 'http://localhost:11434/v1',
               'managed-provider:mp_local', 't', 't', 'none')";

/// Ticket chatgpt-siwc 01: a DB at 051 with two providers, models on both
/// (one the default), the advanced layers and the defaults pref; rowids with
/// gaps, as deletes leave them. After 052 both tables are what they were,
/// rows, rowids, columns, foreign key and indexes, but for the one CHECK.
#[tokio::test]
async fn migration_052_widens_the_auth_kind_check_and_keeps_both_tables_as_they_were() {
    let pool = single_connection_pool_through_051().await;
    seed_051_provider(&pool, "mp_dropped", "openai", "api_key").await;
    seed_051_provider(&pool, "mp_relay", "anthropic", "api_key").await;
    seed_051_provider(&pool, "mp_codex", "openai", "chatgpt_codex_oauth").await;
    seed_051_model(
        &pool,
        "mm_dropped",
        "mp_dropped",
        false,
        3,
        None,
        "{}",
        "{}",
    )
    .await;
    seed_051_model(
        &pool,
        "mm_relay_default",
        "mp_relay",
        true,
        0,
        Some("2026-10-03T00:00:00Z"),
        r#"{"context_win":90000,"thinking_type":"adaptive","read_timeout":180}"#,
        r#"{"read_timeout":42,"reasoning_effort":null}"#,
    )
    .await;
    seed_051_model(
        &pool,
        "mm_relay_b",
        "mp_relay",
        false,
        1,
        None,
        r#"{"context_win":90000,"stream":false}"#,
        "{}",
    )
    .await;
    seed_051_model(
        &pool,
        "mm_codex",
        "mp_codex",
        false,
        2,
        Some("2026-10-04T00:00:00Z"),
        r#"{"api_mode":"responses","codex_backend":true}"#,
        r#"{"reasoning_effort":"xhigh"}"#,
    )
    .await;
    // Deleting a provider takes its model with it (ON DELETE CASCADE),
    // leaving a rowid gap in both tables.
    sqlx::query("DELETE FROM managed_model_providers WHERE id = 'mp_dropped'")
        .execute(&pool)
        .await
        .expect("delete provider");
    sqlx::query(
        "INSERT INTO prefs (key, value, updated_at) \
         VALUES ('managed_model_defaults', '{\"read_timeout\":300}', 'x')",
    )
    .execute(&pool)
    .await
    .expect("seed defaults pref");

    // Before 052 the CHECK turns a no-auth provider away: the bug.
    let refused = sqlx::query(NO_AUTH_PROVIDER_INSERT)
        .execute(&pool)
        .await
        .expect_err("051 refuses auth_kind 'none'");
    assert!(
        refused.to_string().contains("CHECK constraint failed"),
        "{refused}"
    );

    let providers_before = table_snapshot(&pool, "managed_model_providers").await;
    let models_before = table_snapshot(&pool, "managed_models").await;
    // Not vacuous: 2 provider rows, 3 model rows (rowids 2..4), the
    // foreign key, 1 + 2 auto provider indexes, 4 + 1 auto model indexes.
    fn count(lines: &[String], prefix: &str) -> usize {
        lines.iter().filter(|l| l.starts_with(prefix)).count()
    }
    assert_eq!(count(&providers_before, "row: "), 2);
    assert_eq!(count(&models_before, "row: "), 3);
    assert!(models_before
        .iter()
        .any(|l| l.starts_with("row: 2|'mm_relay_default'")));
    assert_eq!(count(&models_before, "foreign key: "), 1);
    assert_eq!(count(&providers_before, "index: "), 3);
    assert_eq!(count(&models_before, "index: "), 5);

    run_052_as_sqlx_does(&pool).await;

    assert_eq!(table_snapshot(&pool, "managed_models").await, models_before);
    let old_check = "'chatgpt_codex_oauth')";
    assert_eq!(
        providers_before[0].matches(old_check).count(),
        1,
        "{}",
        providers_before[0]
    );
    let mut providers_expected = providers_before.clone();
    providers_expected[0] = providers_before[0].replace(old_check, "'chatgpt_codex_oauth','none')");
    assert_eq!(
        table_snapshot(&pool, "managed_model_providers").await,
        providers_expected
    );
    assert_eq!(
        managed_model_defaults_pref(&pool).await,
        Some(serde_json::json!({"read_timeout": 300}))
    );
    assert_db_consistent(&pool).await;

    // After 052 the same insert goes in.
    sqlx::query(NO_AUTH_PROVIDER_INSERT)
        .execute(&pool)
        .await
        .expect("052 accepts auth_kind 'none'");
}

/// A model whose provider is gone can only have been written with foreign
/// keys off. Copying it back under enforcement would abort 052 and Galley's
/// startup; it was never readable (every read JOINs the provider), so 052
/// leaves it out and keeps every other row.
#[tokio::test]
async fn migration_052_leaves_out_a_model_whose_provider_is_gone() {
    let pool = single_connection_pool_through_051().await;
    seed_051_provider(&pool, "mp_relay", "anthropic", "api_key").await;
    seed_051_model(&pool, "mm_kept", "mp_relay", true, 0, None, "{}", "{}").await;
    sqlx::raw_sql("PRAGMA foreign_keys = OFF;")
        .execute(&pool)
        .await
        .expect("foreign keys off");
    seed_051_model(&pool, "mm_orphan", "mp_missing", false, 1, None, "{}", "{}").await;
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("foreign keys on");

    run_052_as_sqlx_does(&pool).await;

    let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM managed_models ORDER BY id")
        .fetch_all(&pool)
        .await
        .expect("model ids");
    assert_eq!(ids, vec!["mm_kept".to_string()]);
    assert_db_consistent(&pool).await;
}

/// The no-auth provider through the real write and read path, on a schema
/// with 052: it saves, reads back, carries a model, switches kind and
/// deletes; the two older kinds behave as before, and the CHECK still turns
/// an unknown kind away.
#[tokio::test]
async fn no_auth_provider_saves_reads_back_and_deletes() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    let provider = |id: &str, auth_kind: ManagedModelAuthKind| UpsertManagedModelProviderMetadata {
        id: id.into(),
        display_name: format!("{id} provider"),
        protocol: ManagedModelProtocol::Openai,
        auth_kind,
        api_base: format!("https://{id}.example/v1"),
        api_key_ref: format!("managed-provider:{id}"),
    };
    for (id, auth_kind) in [
        ("mp_key", ManagedModelAuthKind::ApiKey),
        ("mp_codex", ManagedModelAuthKind::ChatgptCodexOauth),
        ("mp_local", ManagedModelAuthKind::None),
    ] {
        let saved = galley
            .upsert_managed_model_provider_metadata(provider(id, auth_kind))
            .await
            .unwrap_or_else(|e| panic!("save {id}: {e}"));
        assert_eq!(saved.auth_kind, auth_kind, "{id}");
    }

    let listed = galley
        .list_managed_model_providers()
        .await
        .expect("list providers");
    let kind_of = |id: &str| listed.iter().find(|p| p.id == id).map(|p| p.auth_kind);
    assert_eq!(kind_of("mp_key"), Some(ManagedModelAuthKind::ApiKey));
    assert_eq!(
        kind_of("mp_codex"),
        Some(ManagedModelAuthKind::ChatgptCodexOauth)
    );
    assert_eq!(kind_of("mp_local"), Some(ManagedModelAuthKind::None));
    // No secret row, and none needed.
    let local = listed.iter().find(|p| p.id == "mp_local").unwrap();
    assert!(matches!(
        local.credential_status,
        ManagedModelCredentialStatus::Present
    ));
    let keyed = listed.iter().find(|p| p.id == "mp_key").unwrap();
    assert!(matches!(
        keyed.credential_status,
        ManagedModelCredentialStatus::Missing
    ));

    let model = galley
        .upsert_managed_model_metadata(UpsertManagedModelMetadata {
            id: "mm_local".into(),
            provider_id: "mp_local".into(),
            display_name: "Qwen".into(),
            model: "qwen3:32b".into(),
            preset_options: Some(serde_json::json!({"api_mode": "chat_completions"})),
            advanced_overrides: Some(serde_json::json!({})),
            make_default: true,
        })
        .await
        .expect("save a model on the no-auth provider");
    assert_eq!(model.auth_kind, ManagedModelAuthKind::None);

    // An existing key provider can become no-auth (the clear-key save) and
    // go back.
    for auth_kind in [ManagedModelAuthKind::None, ManagedModelAuthKind::ApiKey] {
        let saved = galley
            .upsert_managed_model_provider_metadata(provider("mp_key", auth_kind))
            .await
            .expect("switch auth kind");
        assert_eq!(saved.auth_kind, auth_kind);
    }

    let removed = galley
        .delete_managed_model_provider_metadata("mp_local")
        .await
        .expect("delete the no-auth provider");
    assert_eq!(removed.as_deref(), Some("managed-provider:mp_local"));
    let listed = galley
        .list_managed_model_providers()
        .await
        .expect("list providers");
    assert!(listed.iter().all(|p| p.id != "mp_local"));
    assert!(galley
        .list_managed_models()
        .await
        .expect("list models")
        .is_empty());

    let bogus = "INSERT INTO managed_model_providers (
                   id, display_name, protocol, api_base, api_key_ref, created_at, updated_at,
                   auth_kind
                 ) VALUES ('mp_bogus', 'x', 'openai', 'x', 'managed-provider:mp_bogus', 't', 't',
                           'bogus')";
    assert!(sqlx::query(bogus).execute(&pool).await.is_err());
}

#[tokio::test]
async fn managed_model_layers_merge_through_the_write_and_read_path() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    galley
        .upsert_managed_model_provider_metadata(UpsertManagedModelProviderMetadata {
            id: "mp_test".into(),
            display_name: "OpenAI".into(),
            protocol: ManagedModelProtocol::Openai,
            auth_kind: ManagedModelAuthKind::ApiKey,
            api_base: "https://api.openai.com/v1".into(),
            api_key_ref: "managed-provider:mp_test".into(),
        })
        .await
        .unwrap();
    let saved = galley
        .upsert_managed_model_metadata(UpsertManagedModelMetadata {
            id: "mm_test".into(),
            provider_id: "mp_test".into(),
            display_name: "GPT".into(),
            model: "gpt-5.6-sol".into(),
            preset_options: Some(serde_json::json!({
                "api_mode": "chat_completions", "read_timeout": 180, "reasoning_effort": "high"
            })),
            advanced_overrides: Some(serde_json::json!({"read_timeout": 42})),
            make_default: true,
        })
        .await
        .unwrap();
    assert_eq!(
        saved.advanced_options,
        serde_json::json!({"api_mode": "chat_completions", "read_timeout": 42, "reasoning_effort": "high"})
    );

    galley
        .set_managed_model_defaults(serde_json::json!({"read_timeout": 300, "reasoning_effort": "max", "stream": false}))
        .await
        .unwrap();
    let listed = galley.list_managed_models().await.unwrap();
    assert_eq!(
        listed[0].advanced_options,
        serde_json::json!({"api_mode": "chat_completions", "read_timeout": 42, "reasoning_effort": "max", "stream": false})
    );
    assert_eq!(listed[0].advanced_overrides, serde_json::json!({"read_timeout": 42}));

    // An edit without a preset keeps the stored baseline; a null override
    // is a tombstone.
    let edited = galley
        .upsert_managed_model_metadata(UpsertManagedModelMetadata {
            id: "mm_test".into(),
            provider_id: "mp_test".into(),
            display_name: "GPT".into(),
            model: "gpt-5.6-sol".into(),
            preset_options: None,
            advanced_overrides: Some(serde_json::json!({"reasoning_effort": null})),
            make_default: false,
        })
        .await
        .unwrap();
    assert_eq!(
        edited.preset_options,
        serde_json::json!({"api_mode": "chat_completions", "read_timeout": 180, "reasoning_effort": "high"})
    );
    assert_eq!(
        edited.advanced_options,
        serde_json::json!({"api_mode": "chat_completions", "read_timeout": 300, "stream": false})
    );

    // A flag-only save (None for both layers) keeps everything stored.
    let flagged = galley
        .upsert_managed_model_metadata(UpsertManagedModelMetadata {
            id: "mm_test".into(),
            provider_id: "mp_test".into(),
            display_name: "GPT".into(),
            model: "gpt-5.6-sol".into(),
            preset_options: None,
            advanced_overrides: None,
            make_default: true,
        })
        .await
        .unwrap();
    assert_eq!(flagged.advanced_overrides, serde_json::json!({"reasoning_effort": null}));
    assert_eq!(flagged.advanced_options, edited.advanced_options);
}

// ---------------- managed model metadata ----------------

#[tokio::test]
async fn managed_model_context_win_migration_029_backfills_missing_object_key() {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    run_migrations_through_028(&pool).await;

    sqlx::query(
        "INSERT INTO managed_model_providers (
           id, display_name, protocol, auth_kind, api_base, api_key_ref, created_at, updated_at
         ) VALUES (?, ?, 'openai', 'api_key', ?, ?, ?, ?)",
    )
    .bind("mp_custom")
    .bind("Custom OpenAI")
    .bind("https://example.test/v1")
    .bind("managed-provider:mp_custom")
    .bind("2026-06-29T00:00:00Z")
    .bind("2026-06-29T00:00:00Z")
    .execute(&pool)
    .await
    .expect("seed provider");

    for (sort_order, (id, advanced_options)) in [
        ("mm_empty", "{}"),
        ("mm_explicit", r#"{"context_win":16000,"read_timeout":42}"#),
        ("mm_array", "[]"),
        ("mm_malformed", "not-json"),
    ]
    .into_iter()
    .enumerate()
    {
        sqlx::query(
            "INSERT INTO managed_models (
               id, provider_id, display_name, model, advanced_options, is_default,
               last_validated_at, sort_order, created_at, updated_at
             ) VALUES (?, 'mp_custom', ?, ?, ?, 0, NULL, ?, ?, ?)",
        )
        .bind(id)
        .bind(id)
        .bind(id)
        .bind(advanced_options)
        .bind(sort_order as i64)
        .bind("2026-06-29T00:00:00Z")
        .bind("2026-06-29T00:00:00Z")
        .execute(&pool)
        .await
        .expect("seed model");
    }

    sqlx::raw_sql(MIG_029)
        .execute(&pool)
        .await
        .expect("run 029 migration");

    let empty = managed_model_advanced_options_raw(&pool, "mm_empty").await;
    let empty_json = serde_json::from_str::<serde_json::Value>(&empty).expect("parse empty row");
    assert_eq!(empty_json["context_win"], serde_json::json!(90_000));

    let explicit = managed_model_advanced_options_raw(&pool, "mm_explicit").await;
    assert_eq!(explicit, r#"{"context_win":16000,"read_timeout":42}"#);

    let array = managed_model_advanced_options_raw(&pool, "mm_array").await;
    assert_eq!(array, "[]");

    let malformed = managed_model_advanced_options_raw(&pool, "mm_malformed").await;
    assert_eq!(malformed, "not-json");
}

async fn managed_model_advanced_options_raw(pool: &SqlitePool, id: &str) -> String {
    sqlx::query_scalar("SELECT advanced_options FROM managed_models WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("read managed model advanced options")
}

#[tokio::test]
async fn managed_model_metadata_never_requires_plaintext_key_in_db() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());

    let provider = galley
        .upsert_managed_model_provider_metadata(UpsertManagedModelProviderMetadata {
            id: "mp_test".into(),
            display_name: "Anthropic".into(),
            protocol: ManagedModelProtocol::Anthropic,
            auth_kind: ManagedModelAuthKind::ApiKey,
            api_base: "https://api.anthropic.com".into(),
            api_key_ref: "managed-provider:mp_test".into(),
        })
        .await
        .expect("upsert managed provider metadata");
    assert_eq!(provider.api_key_ref, "managed-provider:mp_test");
    assert!(matches!(
        provider.credential_status,
        ManagedModelCredentialStatus::Missing
    ));

    let row = galley
        .upsert_managed_model_metadata(UpsertManagedModelMetadata {
            id: "mm_test".into(),
            provider_id: "mp_test".into(),
            display_name: "Claude".into(),
            model: "claude-sonnet-4-6".into(),
            preset_options: Some(serde_json::json!({
                "thinking_type": "adaptive",
                "read_timeout": 180
            })),
            advanced_overrides: Some(serde_json::json!({})),
            make_default: true,
        })
        .await
        .expect("upsert managed model metadata");

    assert_eq!(row.provider_id, "mp_test");
    assert_eq!(row.api_key_ref, "managed-provider:mp_test");
    assert!(matches!(
        row.credential_status,
        ManagedModelCredentialStatus::Missing
    ));
    assert!(row.is_default);
    assert_eq!(row.sort_order, 0);

    let raw_rows: Vec<(String,)> =
        sqlx::query_as("SELECT api_key_ref FROM managed_model_providers WHERE id = ?")
            .bind("mp_test")
            .fetch_all(&pool)
            .await
            .expect("read raw provider row");
    assert_eq!(raw_rows, vec![("managed-provider:mp_test".to_string(),)]);
}

#[tokio::test]
async fn managed_model_secret_roundtrip_uses_encrypted_sqlite_rows() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    let api_key_ref = "managed-provider:mp_secret";

    credential_store::set_secret(&galley, api_key_ref, "sk-test-secret")
        .await
        .expect("store secret");
    let provider = galley
        .upsert_managed_model_provider_metadata(UpsertManagedModelProviderMetadata {
            id: "mp_secret".into(),
            display_name: "Secret Provider".into(),
            protocol: ManagedModelProtocol::Openai,
            auth_kind: ManagedModelAuthKind::ApiKey,
            api_base: "https://example.test/v1".into(),
            api_key_ref: api_key_ref.into(),
        })
        .await
        .expect("upsert provider with stored secret");
    assert!(matches!(
        provider.credential_status,
        ManagedModelCredentialStatus::Present
    ));

    let restored = credential_store::get_secret(&galley, api_key_ref)
        .await
        .expect("get secret");
    assert_eq!(restored, "sk-test-secret");

    let raw: (Vec<u8>,) =
        sqlx::query_as("SELECT ciphertext FROM managed_model_secrets WHERE api_key_ref = ?")
            .bind(api_key_ref)
            .fetch_one(&pool)
            .await
            .expect("read ciphertext");
    assert_ne!(raw.0, b"sk-test-secret".to_vec());

    credential_store::delete_secret(&galley, api_key_ref)
        .await
        .expect("delete secret");
    let missing = credential_store::get_secret(&galley, api_key_ref)
        .await
        .expect_err("secret should be gone");
    assert!(matches!(missing, GalleyError::InvalidArgs { .. }));
}

#[tokio::test]
async fn managed_model_order_drives_default_model() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);

    galley
        .upsert_managed_model_provider_metadata(UpsertManagedModelProviderMetadata {
            id: "mp_test".into(),
            display_name: "OpenAI".into(),
            protocol: ManagedModelProtocol::Openai,
            auth_kind: ManagedModelAuthKind::ApiKey,
            api_base: "https://api.openai.com".into(),
            api_key_ref: "managed-provider:mp_test".into(),
        })
        .await
        .expect("upsert managed provider metadata");
    for (idx, id) in ["mm_a", "mm_b", "mm_c"].iter().enumerate() {
        galley
            .upsert_managed_model_metadata(UpsertManagedModelMetadata {
                id: (*id).into(),
                provider_id: "mp_test".into(),
                display_name: format!("Model {idx}"),
                model: format!("model-{idx}"),
                preset_options: None,
                advanced_overrides: Some(serde_json::json!({})),
                make_default: idx == 0,
            })
            .await
            .expect("upsert managed model metadata");
    }

    galley
        .reorder_managed_models(vec!["mm_c".into(), "mm_a".into(), "mm_b".into()])
        .await
        .expect("reorder managed models");
    let models = galley
        .list_managed_models()
        .await
        .expect("list managed models");
    let ids = models
        .iter()
        .map(|model| model.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["mm_c", "mm_a", "mm_b"]);
    assert!(models[0].is_default);
    assert!(!models[1].is_default);
    assert!(!models[2].is_default);
    assert_eq!(models[0].sort_order, 0);
    assert_eq!(models[1].sort_order, 1);
    assert_eq!(models[2].sort_order, 2);

    galley
        .upsert_managed_model_metadata(UpsertManagedModelMetadata {
            id: "mm_b".into(),
            provider_id: "mp_test".into(),
            display_name: "Model 2".into(),
            model: "model-2".into(),
            preset_options: None,
            advanced_overrides: Some(serde_json::json!({})),
            make_default: true,
        })
        .await
        .expect("set default managed model");
    let models = galley
        .list_managed_models()
        .await
        .expect("list managed models after default");
    let ids = models
        .iter()
        .map(|model| model.id.as_str())
        .collect::<Vec<_>>();
    assert_eq!(ids, vec!["mm_b", "mm_c", "mm_a"]);
    assert!(models[0].is_default);
}

// ---------------- delete_empty_new_sessions ----------------

/// `session.new` commits the default title, `turn_count = 0` and the
/// first user message together; the GUI's hydrate sweep ran while such a
/// session was still in its first turn and deleted it with its message.
#[tokio::test]
async fn delete_empty_new_sessions_spares_sessions_with_messages() {
    let pool = fresh_pool().await;
    for (id, status) in [
        ("s-empty", "idle"),
        ("s-first-turn", "running"),
        ("s-archived", "archived"),
    ] {
        sqlx::query(
            "INSERT INTO sessions (id, title, status, turn_count, pending_approval_count, \
                error_count, pinned, last_activity_at, created_at, updated_at) \
             VALUES (?, '新对话', ?, 0, 0, 0, 0, ?, ?, ?)",
        )
        .bind(id)
        .bind(status)
        .bind("2026-10-07T00:00:00Z")
        .bind("2026-10-07T00:00:00Z")
        .bind("2026-10-07T00:00:00Z")
        .execute(&pool)
        .await
        .expect("seed session");
    }
    sqlx::query(
        "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, created_at) \
         VALUES ('msg_s-first-turn_0_user', 's-first-turn', 0, 0, 'user', 'task', ?)",
    )
    .bind("2026-10-07T00:00:00Z")
    .execute(&pool)
    .await
    .expect("seed first user message");
    let galley = SqliteGalley::from_pool(pool.clone());

    let removed = galley
        .delete_empty_new_sessions()
        .await
        .expect("sweep empty sessions");

    assert_eq!(removed, 1);
    let left: Vec<String> = sqlx::query_scalar("SELECT id FROM sessions ORDER BY id")
        .fetch_all(&pool)
        .await
        .expect("list sessions");
    assert_eq!(
        left,
        vec!["s-archived".to_string(), "s-first-turn".to_string()]
    );
    let messages: i64 = sqlx::query_scalar("SELECT count(*) FROM messages")
        .fetch_one(&pool)
        .await
        .expect("count messages");
    assert_eq!(messages, 1);
}

// ---------------- create_session ----------------

#[tokio::test]
async fn create_session_happy_path_persists_all_fields() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .create_session(
            CreateSessionInput {
                id: "sess_new_1".into(),
                title: "First session".into(),
                project_id: None,
                selected_llm_index: Some(2),
                selected_llm_key: Some("managed-model-2".into()),
                selected_llm_display_name: Some("Claude Sonnet 4.6".into()),
                ga_runtime_kind: None,
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::gui(),
        )
        .await
        .expect("create session");
    assert_eq!(brief.id.as_str(), "sess_new_1");
    assert_eq!(brief.title, "First session");
    assert!(matches!(brief.status, SessionStatus::Idle));
    assert_eq!(brief.selected_llm_index, Some(2));
    assert_eq!(brief.selected_llm_key.as_deref(), Some("managed-model-2"));
    assert_eq!(
        brief.selected_llm_display_name.as_deref(),
        Some("Claude Sonnet 4.6")
    );
    assert!(matches!(brief.ga_runtime_kind, RuntimeKind::Managed));
    assert!(brief.ga_runtime_id.is_none());
    assert_eq!(
        brief.prompt_profile.as_deref(),
        Some(managed_runtime::PROMPT_PROFILE_ID)
    );
}

#[tokio::test]
async fn create_session_can_snapshot_explicit_external_runtime() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .create_session(
            CreateSessionInput {
                id: "sess_external_1".into(),
                title: "External session".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: Some(RuntimeKind::External),
                ga_runtime_id: Some("external-default".into()),
                prompt_profile: None,
            },
            Origin::gui(),
        )
        .await
        .expect("create external session");

    assert!(matches!(brief.ga_runtime_kind, RuntimeKind::External));
    assert_eq!(brief.ga_runtime_id.as_deref(), Some("external-default"));

    let managed = galley
        .list_sessions(SessionFilter {
            runtime_kind: Some(RuntimeKind::Managed),
            ..Default::default()
        })
        .await
        .expect("list managed");
    assert!(managed.is_empty());

    let external = galley
        .list_sessions(SessionFilter {
            runtime_kind: Some(RuntimeKind::External),
            ..Default::default()
        })
        .await
        .expect("list external");
    assert_eq!(external.len(), 1);
    assert_eq!(external[0].id.as_str(), "sess_external_1");
}

#[tokio::test]
async fn create_session_persists_origin_creation_triple() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    galley
        .create_session(
            CreateSessionInput {
                id: "sess_cli_1".into(),
                title: "From CLI".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: None,
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::cli(Some("ga-test-1".into()), Some("auto-trigger".into())),
        )
        .await
        .expect("create session");
    let row: (String, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT created_via, created_by_supervisor, created_origin_note \
         FROM sessions WHERE id = ?",
    )
    .bind("sess_cli_1")
    .fetch_one(&pool)
    .await
    .expect("read origin");
    assert_eq!(row.0, "cli");
    assert_eq!(row.1.as_deref(), Some("ga-test-1"));
    assert_eq!(row.2.as_deref(), Some("auto-trigger"));
}

#[tokio::test]
async fn create_session_rejects_empty_title() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .create_session(
            CreateSessionInput {
                id: "sess_x".into(),
                title: "   ".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: None,
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::gui(),
        )
        .await
        .expect_err("empty title rejected");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
}

#[tokio::test]
async fn create_session_id_conflict_returns_invalid_args() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "sess_dup").await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .create_session(
            CreateSessionInput {
                id: "sess_dup".into(),
                title: "Conflicting".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: None,
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::gui(),
        )
        .await
        .expect_err("dup id rejected");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
}

#[tokio::test]
async fn create_session_with_missing_project_rejects() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .create_session(
            CreateSessionInput {
                id: "sess_in_ghost".into(),
                title: "Has bad project".into(),
                project_id: Some("proj_does_not_exist".into()),
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: None,
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::gui(),
        )
        .await
        .expect_err("FK violation rejected");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
}

// ---------------- archive / unarchive ----------------

#[tokio::test]
async fn archive_session_flips_status() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .archive_session(sid("s1"), Origin::gui())
        .await
        .expect("archive");
    assert!(matches!(brief.status, SessionStatus::Archived));
}

#[tokio::test]
async fn archive_session_not_found() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .archive_session(sid("nope"), Origin::gui())
        .await
        .expect_err("missing id");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

#[tokio::test]
async fn unarchive_session_flips_back_to_idle() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    galley
        .archive_session(sid("s1"), Origin::gui())
        .await
        .unwrap();
    let brief = galley
        .unarchive_session(sid("s1"), Origin::gui())
        .await
        .expect("unarchive");
    assert!(matches!(brief.status, SessionStatus::Idle));
}

#[tokio::test]
async fn unarchive_session_idle_is_noop_success() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    // No-op on already-idle row: GUI shouldn't have to pre-check
    // status before calling. Returns brief unchanged.
    let brief = galley
        .unarchive_session(sid("s1"), Origin::gui())
        .await
        .expect("unarchive noop");
    assert!(matches!(brief.status, SessionStatus::Idle));
}

// ---------------- rename ----------------

#[tokio::test]
async fn rename_session_persists_new_title() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .rename_session(sid("s1"), "renamed".into(), Origin::gui())
        .await
        .expect("rename");
    assert_eq!(brief.title, "renamed");
}

#[tokio::test]
async fn rename_session_empty_falls_back_to_default() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .rename_session(sid("s1"), "   ".into(), Origin::gui())
        .await
        .expect("rename empty");
    assert_eq!(brief.title, "新对话");
}

#[tokio::test]
async fn rename_session_not_found() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .rename_session(sid("ghost"), "x".into(), Origin::gui())
        .await
        .expect_err("missing id");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

// ---------------- pin ----------------

#[tokio::test]
async fn set_session_pinned_toggles_flag() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    let pinned = galley
        .set_session_pinned(sid("s1"), true, Origin::gui())
        .await
        .expect("pin");
    assert_eq!(pinned.pinned, Some(true));
    let unpinned = galley
        .set_session_pinned(sid("s1"), false, Origin::gui())
        .await
        .expect("unpin");
    assert_eq!(unpinned.pinned, Some(false));
}

// ---------------- reasoning effort ----------------

#[tokio::test]
async fn set_session_reasoning_effort_round_trip() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    // Fresh row: no override, and the field stays out of the JSON.
    let before = galley.session_brief(sid("s1")).await.expect("brief");
    assert_eq!(before.reasoning_effort, None);
    let json = serde_json::to_value(&before).expect("serialize");
    assert!(json.get("reasoningEffort").is_none());

    let set = galley
        .set_session_reasoning_effort(sid("s1"), Some("high".into()), Origin::gui())
        .await
        .expect("set");
    assert_eq!(set.reasoning_effort.as_deref(), Some("high"));
    let json = serde_json::to_value(&set).expect("serialize");
    assert_eq!(json["reasoningEffort"], "high");

    let cleared = galley
        .set_session_reasoning_effort(sid("s1"), None, Origin::gui())
        .await
        .expect("clear");
    assert_eq!(cleared.reasoning_effort, None);
}

#[tokio::test]
async fn set_session_reasoning_effort_rejects_bad_tier_and_archived() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .set_session_reasoning_effort(sid("s1"), Some("ultra".into()), Origin::gui())
        .await
        .expect_err("bad tier");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
    let untouched = galley.session_brief(sid("s1")).await.expect("brief");
    assert_eq!(untouched.reasoning_effort, None);

    galley
        .archive_session(sid("s1"), Origin::gui())
        .await
        .expect("archive");
    let err = galley
        .set_session_reasoning_effort(sid("s1"), Some("low".into()), Origin::gui())
        .await
        .expect_err("archived");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));

    let err = galley
        .set_session_reasoning_effort(sid("nope"), Some("low".into()), Origin::gui())
        .await
        .expect_err("missing");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

#[tokio::test]
async fn set_session_pinned_rejects_archived() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    galley
        .archive_session(sid("s1"), Origin::gui())
        .await
        .unwrap();
    let err = galley
        .set_session_pinned(sid("s1"), true, Origin::gui())
        .await
        .expect_err("pin archived rejected");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
}

#[tokio::test]
async fn set_session_pinned_not_found() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .set_session_pinned(sid("ghost"), true, Origin::gui())
        .await
        .expect_err("missing id");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

// ---------------- delete ----------------

#[tokio::test]
async fn delete_session_removes_row() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool.clone());
    galley
        .delete_session(sid("s1"), Origin::gui())
        .await
        .expect("delete");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE id = ?")
        .bind("s1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn delete_session_cascades_messages_and_attachments() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    sqlx::query(
        "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, created_at) \
         VALUES (?, ?, 1, 0, 'user', 'hi', ?)",
    )
    .bind("m1")
    .bind("s1")
    .bind("2026-05-19T00:00:00Z")
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO message_attachments (
           id, message_id, session_id, kind, file_path, mime_type, byte_size, created_at
         ) VALUES (
           'att_1', 'm1', 's1', 'image', '/tmp/paste.png', 'image/png', 3, ?
         )",
    )
    .bind("2026-05-19T00:00:00Z")
    .execute(&pool)
    .await
    .unwrap();
    let galley = SqliteGalley::from_pool(pool.clone());
    galley
        .delete_session(sid("s1"), Origin::gui())
        .await
        .expect("delete");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE session_id = ?")
        .bind("s1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    let n: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM message_attachments WHERE session_id = ?")
            .bind("s1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn delete_session_not_found() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .delete_session(sid("ghost"), Origin::gui())
        .await
        .expect_err("missing id");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

async fn fts_rows(pool: &SqlitePool, session_id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM messages_fts WHERE session_id = ?")
        .bind(session_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// The ordinary session delete takes the session's search-index rows
/// along (`messages_fts` has no foreign key): one session or several.
#[tokio::test]
async fn deleting_a_session_drops_its_search_index_rows() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    for id in ["s-a", "s-b", "s-c"] {
        let mut tx = galley.begin_tx().await.unwrap();
        galley
            .create_session_in_tx(
                &mut tx,
                CreateSessionInput {
                    id: id.into(),
                    title: id.into(),
                    project_id: None,
                    selected_llm_index: None,
                    selected_llm_key: None,
                    selected_llm_display_name: None,
                    ga_runtime_kind: Some(RuntimeKind::Managed),
                    ga_runtime_id: None,
                    prompt_profile: None,
                },
                Origin::gui(),
            )
            .await
            .unwrap();
        galley
            .send_message_in_tx(
                &mut tx,
                sid(id),
                format!("{id} 里说过的一段话"),
                Origin::gui(),
            )
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(fts_rows(&pool, id).await, 1);
    }
    galley
        .delete_session(sid("s-a"), Origin::gui())
        .await
        .unwrap();
    assert_eq!(fts_rows(&pool, "s-a").await, 0);
    assert_eq!(
        galley
            .bulk_delete_sessions(vec![sid("s-b")], Origin::gui())
            .await
            .unwrap(),
        1
    );
    assert_eq!(fts_rows(&pool, "s-b").await, 0);
    assert_eq!(fts_rows(&pool, "s-c").await, 1);
}

// ---------------- assign_session_to_project ----------------

#[tokio::test]
async fn assign_session_to_project_attaches_id() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    seed_project(&pool, "proj_a", "Alpha").await;
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .assign_session_to_project(sid("s1"), Some("proj_a".into()), Origin::gui())
        .await
        .expect("assign");
    assert_eq!(brief.project_id.as_deref(), Some("proj_a"));
}

#[tokio::test]
async fn assign_session_to_project_detach() {
    let pool = fresh_pool().await;
    seed_project(&pool, "proj_a", "Alpha").await;
    seed_session_idle(&pool, "s1").await;
    sqlx::query("UPDATE sessions SET project_id = ? WHERE id = ?")
        .bind("proj_a")
        .bind("s1")
        .execute(&pool)
        .await
        .unwrap();
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .assign_session_to_project(sid("s1"), None, Origin::gui())
        .await
        .expect("detach");
    assert!(brief.project_id.is_none());
}

#[tokio::test]
async fn assign_session_to_project_rejects_missing_project() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .assign_session_to_project(sid("s1"), Some("proj_ghost".into()), Origin::gui())
        .await
        .expect_err("FK violation");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
}

#[tokio::test]
async fn assign_session_to_project_not_found_session() {
    let pool = fresh_pool().await;
    seed_project(&pool, "proj_a", "A").await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .assign_session_to_project(sid("ghost"), Some("proj_a".into()), Origin::gui())
        .await
        .expect_err("session missing");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

// ---------------- set_session_llm ----------------

#[tokio::test]
async fn set_session_llm_persists_choice() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .set_session_llm(
            sid("s1"),
            Some(3),
            Some("NativeClaudeSession/claude-opus-4.7".into()),
            Some("Claude Opus 4.7".into()),
        )
        .await
        .expect("set llm");
    assert_eq!(brief.selected_llm_index, Some(3));
    assert_eq!(
        brief.selected_llm_key.as_deref(),
        Some("NativeClaudeSession/claude-opus-4.7")
    );
    assert_eq!(
        brief.selected_llm_display_name.as_deref(),
        Some("Claude Opus 4.7")
    );
}

#[tokio::test]
async fn set_session_llm_clear_with_none() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    sqlx::query(
        "UPDATE sessions SET llm_index = 2, llm_key = 'old-key', llm_display_name = 'old' WHERE id = 's1'",
    )
        .execute(&pool)
        .await
        .unwrap();
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .set_session_llm(sid("s1"), None, None, None)
        .await
        .expect("clear");
    assert!(brief.selected_llm_index.is_none());
    assert!(brief.selected_llm_key.is_none());
    assert!(brief.selected_llm_display_name.is_none());
}

#[tokio::test]
async fn set_session_llm_not_found() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .set_session_llm(sid("ghost"), Some(1), Some("key".into()), Some("x".into()))
        .await
        .expect_err("missing");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

// ---------------- bump_session_after_turn ----------------

#[tokio::test]
async fn bump_session_after_turn_increments_turn_count_and_summary() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .bump_session_after_turn(sid("s1"), Some("did work".into()), Some(1), false)
        .await
        .expect("bump");
    assert_eq!(brief.turn_count, Some(1));
    assert_eq!(brief.summary.as_deref(), Some("did work"));
    assert_eq!(brief.has_unread, Some(false));
}

#[tokio::test]
async fn bump_session_after_turn_mark_unread_sets_flag() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .bump_session_after_turn(sid("s1"), Some("done".into()), Some(1), true)
        .await
        .expect("bump unread");
    assert_eq!(brief.has_unread, Some(true));
}

#[tokio::test]
async fn bump_session_after_turn_empty_summary_keeps_previous() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    galley
        .bump_session_after_turn(sid("s1"), Some("first recap".into()), Some(1), false)
        .await
        .unwrap();
    // Second bump with empty summary — turn_count goes up, summary
    // stays at "first recap".
    let brief = galley
        .bump_session_after_turn(sid("s1"), Some("   ".into()), Some(2), false)
        .await
        .expect("bump empty");
    assert_eq!(brief.turn_count, Some(2));
    assert_eq!(brief.summary.as_deref(), Some("first recap"));
}

#[tokio::test]
async fn bump_session_after_turn_truncates_long_summary() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    let long: String = "x".repeat(120);
    let brief = galley
        .bump_session_after_turn(sid("s1"), Some(long), Some(1), false)
        .await
        .expect("bump long");
    let summary = brief.summary.unwrap();
    // truncate_summary keeps 80 + "…"
    assert_eq!(summary.chars().count(), 81);
    assert!(summary.ends_with('…'));
}

#[tokio::test]
async fn bump_session_after_turn_not_found() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .bump_session_after_turn(sid("ghost"), Some("x".into()), Some(1), false)
        .await
        .expect_err("missing");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

// ---------------- mark_session_unread ----------------

#[tokio::test]
async fn mark_session_unread_sets_flag_and_is_idempotent() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    for _ in 0..2 {
        galley
            .mark_session_unread(sid("s1"))
            .await
            .expect("mark unread");
    }
    let brief = galley.session_brief(sid("s1")).await.unwrap();
    assert_eq!(brief.has_unread, Some(true));
    // Unread never moves the turn counter — that is Core's bump.
    assert_eq!(brief.turn_count, Some(0));
}

#[tokio::test]
async fn mark_session_unread_not_found() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .mark_session_unread(sid("ghost"))
        .await
        .expect_err("missing");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

// ---------------- clear_session_unread ----------------

#[tokio::test]
async fn clear_session_unread_zeroes_flag() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    sqlx::query("UPDATE sessions SET has_unread = 1 WHERE id = ?")
        .bind("s1")
        .execute(&pool)
        .await
        .unwrap();
    let galley = SqliteGalley::from_pool(pool);
    galley
        .clear_session_unread(sid("s1"))
        .await
        .expect("clear unread");
    let brief = galley.session_brief(sid("s1")).await.unwrap();
    assert_eq!(brief.has_unread, Some(false));
}

#[tokio::test]
async fn clear_session_unread_already_zero_is_success() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "s1").await;
    let galley = SqliteGalley::from_pool(pool);
    galley
        .clear_session_unread(sid("s1"))
        .await
        .expect("idempotent");
}

#[tokio::test]
async fn clear_session_unread_not_found() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .clear_session_unread(sid("ghost"))
        .await
        .expect_err("missing");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

// ---------------- bulk_archive / unarchive / delete ----------------

#[tokio::test]
async fn bulk_archive_sessions_flips_only_active() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "a").await;
    seed_session_idle(&pool, "b").await;
    seed_session_idle(&pool, "c").await;
    sqlx::query("UPDATE sessions SET status = 'archived' WHERE id = 'b'")
        .execute(&pool)
        .await
        .unwrap();
    let galley = SqliteGalley::from_pool(pool);
    let n = galley
        .bulk_archive_sessions(vec![sid("a"), sid("b"), sid("c")], Origin::gui())
        .await
        .expect("bulk archive");
    // b was already archived → only a + c flipped.
    assert_eq!(n, 2);
    let listed = galley
        .list_sessions(SessionFilter {
            archived: Some(true),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(listed.len(), 3);
}

#[tokio::test]
async fn bulk_archive_sessions_empty_returns_zero() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let n = galley
        .bulk_archive_sessions(vec![], Origin::gui())
        .await
        .expect("empty list");
    assert_eq!(n, 0);
}

#[tokio::test]
async fn bulk_unarchive_sessions_flips_only_archived() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "a").await;
    seed_session_idle(&pool, "b").await;
    seed_session_idle(&pool, "c").await;
    sqlx::query("UPDATE sessions SET status = 'archived' WHERE id IN ('a','b')")
        .execute(&pool)
        .await
        .unwrap();
    let galley = SqliteGalley::from_pool(pool);
    let n = galley
        .bulk_unarchive_sessions(vec![sid("a"), sid("b"), sid("c")], Origin::gui())
        .await
        .expect("bulk unarchive");
    assert_eq!(n, 2);
}

#[tokio::test]
async fn bulk_delete_sessions_returns_count_and_cascades() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "a").await;
    seed_session_idle(&pool, "b").await;
    // Attach a message under "a" so we can verify CASCADE.
    sqlx::query(
        "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, created_at) \
         VALUES (?, ?, 1, 0, 'user', 'x', ?)",
    )
    .bind("m_a")
    .bind("a")
    .bind("2026-05-19T00:00:00Z")
    .execute(&pool)
    .await
    .unwrap();
    let galley = SqliteGalley::from_pool(pool.clone());
    let n = galley
        .bulk_delete_sessions(vec![sid("a"), sid("b")], Origin::gui())
        .await
        .expect("bulk delete");
    assert_eq!(n, 2);
    let msg_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(msg_count, 0);
}

#[tokio::test]
async fn bulk_delete_sessions_skips_unknown_ids() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "a").await;
    let galley = SqliteGalley::from_pool(pool);
    let n = galley
        .bulk_delete_sessions(vec![sid("a"), sid("ghost")], Origin::gui())
        .await
        .expect("bulk delete");
    // Only "a" exists; "ghost" no-op. Bulk doesn't error on missing.
    assert_eq!(n, 1);
}

// ---------------- list_projects ----------------

#[tokio::test]
async fn list_projects_orders_pinned_then_content_recency() {
    let pool = fresh_pool().await;
    seed_project(&pool, "p_content", "Content").await;
    seed_project(&pool, "p_empty_new", "Empty New").await;
    seed_project(&pool, "p_archived_only", "Archived Only").await;
    seed_project(&pool, "p_pinned", "Pinned").await;

    sqlx::query(
        "UPDATE projects SET pinned = 1, created_at = ?, last_activity_at = ? \
         WHERE id = 'p_pinned'",
    )
    .bind("2026-05-01T00:00:00Z")
    .bind("2026-05-01T00:00:00Z")
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE projects SET created_at = ?, last_activity_at = ? WHERE id = 'p_content'")
        .bind("2026-05-01T00:00:00Z")
        .bind("2026-05-01T00:00:00Z")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE projects SET created_at = ?, last_activity_at = ? \
         WHERE id = 'p_empty_new'",
    )
    .bind("2026-05-20T00:00:00Z")
    .bind("2026-05-20T00:00:00Z")
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE projects SET created_at = ?, last_activity_at = ? \
         WHERE id = 'p_archived_only'",
    )
    .bind("2026-05-18T00:00:00Z")
    .bind("2026-05-18T00:00:00Z")
    .execute(&pool)
    .await
    .unwrap();

    seed_session_idle(&pool, "s_content").await;
    sqlx::query("UPDATE sessions SET project_id = ?, last_activity_at = ? WHERE id = ?")
        .bind("p_content")
        .bind("2026-05-21T00:00:00Z")
        .bind("s_content")
        .execute(&pool)
        .await
        .unwrap();
    seed_session_idle(&pool, "s_archived").await;
    sqlx::query(
        "UPDATE sessions SET project_id = ?, status = 'archived', last_activity_at = ? \
         WHERE id = ?",
    )
    .bind("p_archived_only")
    .bind("2026-05-25T00:00:00Z")
    .bind("s_archived")
    .execute(&pool)
    .await
    .unwrap();

    let galley = SqliteGalley::from_pool(pool);
    let ps = galley.list_projects().await.expect("list projects");
    let ids: Vec<&str> = ps.iter().map(|p| p.id.as_str()).collect();
    // pinned first; unpinned projects use non-archived session activity,
    // with empty projects falling back to created_at.
    assert_eq!(
        ids,
        vec!["p_pinned", "p_content", "p_empty_new", "p_archived_only"]
    );
    assert_eq!(ps[1].last_activity_at, "2026-05-21T00:00:00Z");
    assert_eq!(ps[3].last_activity_at, "2026-05-18T00:00:00Z");
}

// ---------------- create_project ----------------

#[tokio::test]
async fn create_project_happy_path() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let p = galley
        .create_project(
            CreateProjectInput {
                id: "proj_1".into(),
                name: "Alpha".into(),
                root_path: Some("/tmp/alpha".into()),
                workspace_enabled: true,
                icon: Some("📁".into()),
                color: None,
            },
            Origin::gui(),
        )
        .await
        .expect("create");
    assert_eq!(p.name, "Alpha");
    assert_eq!(p.root_path.as_deref(), Some("/tmp/alpha"));
    assert!(p.workspace_enabled);
    assert_eq!(p.icon.as_deref(), Some("📁"));
    assert!(!p.pinned);
}

#[tokio::test]
async fn create_project_empty_root_path_normalized_to_null() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let p = galley
        .create_project(
            CreateProjectInput {
                id: "proj_2".into(),
                name: "Beta".into(),
                root_path: Some("   ".into()),
                workspace_enabled: false,
                icon: None,
                color: None,
            },
            Origin::gui(),
        )
        .await
        .expect("create");
    assert!(p.root_path.is_none());
    assert!(!p.workspace_enabled);
}

#[tokio::test]
async fn create_project_rejects_empty_name() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .create_project(
            CreateProjectInput {
                id: "proj_x".into(),
                name: "  ".into(),
                root_path: None,
                workspace_enabled: false,
                icon: None,
                color: None,
            },
            Origin::gui(),
        )
        .await
        .expect_err("empty name");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
}

#[tokio::test]
async fn create_project_id_conflict_returns_invalid_args() {
    let pool = fresh_pool().await;
    seed_project(&pool, "proj_dup", "Dup").await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .create_project(
            CreateProjectInput {
                id: "proj_dup".into(),
                name: "Other".into(),
                root_path: None,
                workspace_enabled: false,
                icon: None,
                color: None,
            },
            Origin::gui(),
        )
        .await
        .expect_err("dup id");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
}

#[tokio::test]
async fn update_project_workspace_enabled_flag() {
    let pool = fresh_pool().await;
    seed_project(&pool, "proj_1", "X").await;
    let galley = SqliteGalley::from_pool(pool);
    let p = galley
        .update_project(
            pid("proj_1"),
            ProjectPatch {
                workspace_enabled: Some(true),
                ..Default::default()
            },
            Origin::gui(),
        )
        .await
        .expect("workspace flag");
    assert!(p.workspace_enabled);
}

// ---------------- update_project ----------------

#[tokio::test]
async fn update_project_partial_name_only() {
    let pool = fresh_pool().await;
    seed_project(&pool, "proj_1", "Old name").await;
    sqlx::query("UPDATE projects SET root_path = ? WHERE id = 'proj_1'")
        .bind("/keep/me")
        .execute(&pool)
        .await
        .unwrap();
    let galley = SqliteGalley::from_pool(pool);
    let p = galley
        .update_project(
            pid("proj_1"),
            ProjectPatch {
                name: Some("New name".into()),
                ..Default::default()
            },
            Origin::gui(),
        )
        .await
        .expect("update");
    assert_eq!(p.name, "New name");
    // root_path stayed (Option<Option<_>> = None means "don't touch")
    assert_eq!(p.root_path.as_deref(), Some("/keep/me"));
}

#[tokio::test]
async fn update_project_clears_root_path_with_some_none() {
    let pool = fresh_pool().await;
    seed_project(&pool, "proj_1", "X").await;
    sqlx::query("UPDATE projects SET root_path = '/x' WHERE id = 'proj_1'")
        .execute(&pool)
        .await
        .unwrap();
    let galley = SqliteGalley::from_pool(pool);
    let p = galley
        .update_project(
            pid("proj_1"),
            ProjectPatch {
                root_path: Some(None),
                ..Default::default()
            },
            Origin::gui(),
        )
        .await
        .expect("clear");
    assert!(p.root_path.is_none());
}

#[tokio::test]
async fn update_project_pinned_flag() {
    let pool = fresh_pool().await;
    seed_project(&pool, "proj_1", "X").await;
    let galley = SqliteGalley::from_pool(pool);
    let p = galley
        .update_project(
            pid("proj_1"),
            ProjectPatch {
                pinned: Some(true),
                ..Default::default()
            },
            Origin::gui(),
        )
        .await
        .expect("pin");
    assert!(p.pinned);
}

#[tokio::test]
async fn update_project_rejects_empty_name() {
    let pool = fresh_pool().await;
    seed_project(&pool, "proj_1", "X").await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .update_project(
            pid("proj_1"),
            ProjectPatch {
                name: Some("  ".into()),
                ..Default::default()
            },
            Origin::gui(),
        )
        .await
        .expect_err("empty");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
}

#[tokio::test]
async fn update_project_not_found() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .update_project(pid("ghost"), ProjectPatch::default(), Origin::gui())
        .await
        .expect_err("missing");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

// ---------------- delete_project ----------------

#[tokio::test]
async fn delete_project_detaches_sessions_via_fk() {
    let pool = fresh_pool().await;
    seed_project(&pool, "proj_1", "X").await;
    seed_session_idle(&pool, "s1").await;
    sqlx::query("UPDATE sessions SET project_id = 'proj_1' WHERE id = 's1'")
        .execute(&pool)
        .await
        .unwrap();
    let galley = SqliteGalley::from_pool(pool.clone());
    galley
        .delete_project(pid("proj_1"), Origin::gui())
        .await
        .expect("delete project");
    // FK ON DELETE SET NULL → session's project_id is now NULL.
    let pid_col: Option<String> =
        sqlx::query_scalar("SELECT project_id FROM sessions WHERE id = 's1'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(pid_col.is_none());
}

#[tokio::test]
async fn delete_project_not_found() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .delete_project(pid("ghost"), Origin::gui())
        .await
        .expect_err("missing");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

// ============= B4 M1 · transaction-aware variant tests =============

#[tokio::test]
async fn tx_commit_persists_both_session_and_message() {
    // O1 atomicity happy path: session new socket handler's two writes
    // (create_session_in_tx + send_message_in_tx) inside one tx, COMMIT,
    // both rows visible.
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    let mut tx = galley.begin_tx().await.expect("begin");
    let session_brief = galley
        .create_session_in_tx(
            &mut tx,
            CreateSessionInput {
                id: "sess_tx_1".into(),
                title: "From CLI session.new".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: None,
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::cli(Some("ga-claude".into()), Some("user asked".into())),
        )
        .await
        .expect("create in tx");
    assert_eq!(session_brief.id.as_str(), "sess_tx_1");
    let msg_brief = galley
        .send_message_in_tx(
            &mut tx,
            sid("sess_tx_1"),
            "fix auth bug".to_string(),
            Origin::cli(Some("ga-claude".into()), Some("user asked".into())),
        )
        .await
        .expect("send in tx");
    assert_eq!(msg_brief.content, "fix auth bug");
    tx.commit().await.expect("commit");

    // Both rows must be visible after commit.
    let session_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE id = ?")
        .bind("sess_tx_1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(session_count, 1, "session row should be persisted");
    let msg_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE session_id = ?")
        .bind("sess_tx_1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(msg_count, 1, "first message should be persisted");
    let fts_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM messages_fts WHERE message_id = ?")
            .bind("msg_sess_tx_1_0_user")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(fts_count, 1, "first message should be indexed for search");
}

#[tokio::test]
async fn socket_user_message_ids_are_session_scoped() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "sess_msg_a").await;
    seed_session_idle(&pool, "sess_msg_b").await;
    let galley = SqliteGalley::from_pool(pool.clone());

    let msg_a = galley
        .send_message(sid("sess_msg_a"), "task A".into(), Origin::cli(None, None))
        .await
        .expect("send A");
    let msg_b = galley
        .send_message(sid("sess_msg_b"), "task B".into(), Origin::cli(None, None))
        .await
        .expect("send B");

    assert_eq!(msg_a.id.0, "msg_sess_msg_a_0_user");
    assert_eq!(msg_b.id.0, "msg_sess_msg_b_0_user");
    let fts_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM messages_fts WHERE message_id IN (?, ?)")
            .bind("msg_sess_msg_a_0_user")
            .bind("msg_sess_msg_b_0_user")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(fts_count, 2, "socket user messages should be searchable");
}

#[tokio::test]
async fn gui_user_message_allocation_does_not_overwrite_socket_message() {
    let pool = fresh_pool().await;
    seed_session_idle(&pool, "sess_mixed").await;
    let galley = SqliteGalley::from_pool(pool.clone());
    let initial_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE session_id = ?")
            .bind("sess_mixed")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(initial_count, 0, "fixture should not pre-seed messages");

    let socket_msg = galley
        .send_message(
            sid("sess_mixed"),
            "from supervisor".into(),
            Origin::cli(Some("ga-test".into()), Some("mixed path".into())),
        )
        .await
        .expect("socket send");
    let gui_msg = galley
        .send_message(sid("sess_mixed"), "from gui".into(), Origin::gui())
        .await
        .expect("gui send");

    assert_eq!(socket_msg.id.0, "msg_sess_mixed_0_user");
    assert_eq!(socket_msg.turn_index, Some(0));
    assert_eq!(gui_msg.id.0, "msg_sess_mixed_1_user");
    assert_eq!(gui_msg.turn_index, Some(1));

    let rows: Vec<(String, i64, String)> = sqlx::query_as(
        "SELECT id, turn_index, content FROM messages WHERE session_id = ? ORDER BY turn_index",
    )
    .bind("sess_mixed")
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        rows,
        vec![
            (
                "msg_sess_mixed_0_user".to_string(),
                0,
                "from supervisor".to_string()
            ),
            (
                "msg_sess_mixed_1_user".to_string(),
                1,
                "from gui".to_string()
            ),
        ]
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_send_message_allocates_unique_turn_indexes() {
    let (_dir, pool) = fresh_file_pool().await;
    seed_session_idle(&pool, "sess_concurrent").await;
    let galley = SqliteGalley::from_pool(pool.clone());

    let mut handles = Vec::new();
    for i in 0..12 {
        let galley = galley.clone();
        handles.push(tokio::spawn(async move {
            galley
                .send_message(
                    sid("sess_concurrent"),
                    format!("message {i}"),
                    Origin::cli(None, Some(format!("concurrent {i}"))),
                )
                .await
        }));
    }

    let mut turn_indexes = Vec::new();
    for handle in handles {
        let msg = handle
            .await
            .expect("task joins")
            .expect("send_message succeeds");
        turn_indexes.push(msg.turn_index.expect("turn index"));
    }
    turn_indexes.sort_unstable();

    assert_eq!(turn_indexes, (0..12).collect::<Vec<_>>());
    let rows: Vec<(i64, String)> = sqlx::query_as(
        "SELECT turn_index, content FROM messages WHERE session_id = ? ORDER BY turn_index",
    )
    .bind("sess_concurrent")
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 12);
    for (idx, (turn_index, content)) in rows.into_iter().enumerate() {
        assert_eq!(turn_index, idx as i64);
        assert!(content.starts_with("message "));
    }
}

#[tokio::test]
async fn tx_drop_without_commit_rolls_back() {
    // O1 atomicity invariant: drop the tx without commit → ROLLBACK,
    // no row in DB. This is what happens when the second in-tx call
    // fails and the socket handler returns early.
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    {
        let mut tx = galley.begin_tx().await.expect("begin");
        galley
            .create_session_in_tx(
                &mut tx,
                CreateSessionInput {
                    id: "sess_tx_doomed".into(),
                    title: "Will be rolled back".into(),
                    project_id: None,
                    selected_llm_index: None,
                    selected_llm_key: None,
                    selected_llm_display_name: None,
                    ga_runtime_kind: None,
                    ga_runtime_id: None,
                    prompt_profile: None,
                },
                Origin::gui(),
            )
            .await
            .expect("create in tx");
        // Intentionally drop `tx` without calling .commit(). sqlx
        // issues ROLLBACK in Transaction's Drop impl.
    }
    let session_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE id = ?")
        .bind("sess_tx_doomed")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        session_count, 0,
        "session row must NOT be persisted (rollback)"
    );
}

#[tokio::test]
async fn tx_second_call_fails_first_rolls_back_when_dropped() {
    // O1 atomicity worst case: create_session_in_tx succeeds, then
    // send_message_in_tx fails (we send to a non-existent session id,
    // simulating any in-tx error). Caller drops tx without commit;
    // verify the created session is NOT in DB.
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    {
        let mut tx = galley.begin_tx().await.expect("begin");
        galley
            .create_session_in_tx(
                &mut tx,
                CreateSessionInput {
                    id: "sess_atomic_1".into(),
                    title: "Atomic create".into(),
                    project_id: None,
                    selected_llm_index: None,
                    selected_llm_key: None,
                    selected_llm_display_name: None,
                    ga_runtime_kind: None,
                    ga_runtime_id: None,
                    prompt_profile: None,
                },
                Origin::gui(),
            )
            .await
            .expect("create in tx");
        let err = galley
            .send_message_in_tx(
                &mut tx,
                sid("nonexistent_session"),
                "this should fail".to_string(),
                Origin::gui(),
            )
            .await
            .expect_err("send to missing session");
        assert!(matches!(err, GalleyError::NotFound { .. }));
        // Drop tx without commit.
    }
    let session_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE id = ?")
        .bind("sess_atomic_1")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        session_count, 0,
        "first in-tx write must roll back when second fails + tx dropped"
    );
}

// ============= B4 M1 · get_pref_json tests =============

#[tokio::test]
async fn get_pref_json_returns_none_for_missing_key() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let v = galley
        .get_pref_json("never_written")
        .await
        .expect("get_pref ok");
    assert!(v.is_none());
}

#[tokio::test]
async fn get_pref_json_round_trips_llm_list_shape() {
    // Mirror the GUI shape: setPref<LLMOption[]>("llm_list", [...]).
    // Stored value is JSON.stringify(...) string. get_pref_json
    // parses it back to serde_json::Value.
    let pool = fresh_pool().await;
    sqlx::query("INSERT INTO prefs (key, value, updated_at) VALUES (?, ?, '2026-05-20T00:00:00Z')")
        .bind("llm_list")
        .bind(r#"[{"index":0,"name":"glm-4.5-x"},{"index":1,"name":"claude-sonnet-4-6"}]"#)
        .execute(&pool)
        .await
        .expect("seed pref");
    let galley = SqliteGalley::from_pool(pool);
    let v = galley
        .get_pref_json("llm_list")
        .await
        .expect("get_pref ok")
        .expect("present");
    let arr = v.as_array().expect("array");
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0]["index"], 0);
    assert_eq!(arr[0]["name"], "glm-4.5-x");
    assert_eq!(arr[1]["index"], 1);
}

#[tokio::test]
async fn get_pref_json_rejects_corrupt_value() {
    let pool = fresh_pool().await;
    sqlx::query("INSERT INTO prefs (key, value, updated_at) VALUES (?, ?, '2026-05-20T00:00:00Z')")
        .bind("broken")
        .bind("{not valid json")
        .execute(&pool)
        .await
        .expect("seed pref");
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .get_pref_json("broken")
        .await
        .expect_err("should reject");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
}

// ---------------- scheduled tasks ----------------

fn sched_input(id: &str) -> CreateScheduledTaskInput {
    CreateScheduledTaskInput {
        id: id.into(),
        project_id: None,
        prompt: "morning digest".into(),
        repeat: ScheduledTaskRepeat::Daily,
        time_of_day: "09:00".into(),
        llm_name: None,
        enabled: true,
        fire_at: None,
        target: Default::default(),
    }
}

#[tokio::test]
async fn scheduled_task_llm_name_roundtrips_and_clears() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                llm_name: Some("  Claude Haiku 4.5  ".into()),
                ..sched_input("sched_llm")
            },
            Origin::gui(),
        )
        .await
        .expect("create with llm");
    assert_eq!(brief.llm_name.as_deref(), Some("Claude Haiku 4.5"));

    // Some(None) clears back to the runtime default.
    let brief = galley
        .update_scheduled_task(
            ScheduledTaskId("sched_llm".into()),
            ScheduledTaskPatch {
                llm_name: Some(None),
                ..ScheduledTaskPatch::default()
            },
            Origin::gui(),
        )
        .await
        .expect("clear llm");
    assert!(brief.llm_name.is_none());
}

#[tokio::test]
async fn create_scheduled_task_roundtrips_and_computes_next_fire() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                repeat: ScheduledTaskRepeat::Weekly {
                    // Unsorted + duplicate on purpose: stored normalized.
                    weekdays: vec![5, 1, 5],
                },
                ..sched_input("sched_1")
            },
            Origin::gui(),
        )
        .await
        .expect("create scheduled task");
    assert_eq!(brief.id.as_str(), "sched_1");
    assert_eq!(
        brief.repeat,
        ScheduledTaskRepeat::Weekly {
            weekdays: vec![1, 5]
        }
    );
    assert_eq!(brief.time_of_day, "09:00");
    assert!(brief.enabled);
    assert!(brief.last_fired_at.is_none());
    assert!(
        brief.next_fire_at.is_some(),
        "enabled task must expose nextFireAt"
    );

    let listed = galley.list_scheduled_tasks().await.expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id.as_str(), "sched_1");
}

#[tokio::test]
async fn monthly_scheduled_task_roundtrips_through_036_schema() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                repeat: ScheduledTaskRepeat::Monthly {
                    monthdays: vec![31, 1, 31],
                },
                ..sched_input("sched_monthly")
            },
            Origin::gui(),
        )
        .await
        .expect("create monthly task");
    assert_eq!(
        brief.repeat,
        ScheduledTaskRepeat::Monthly {
            monthdays: vec![1, 31]
        }
    );
    assert!(brief.next_fire_at.is_some());

    let err = galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                repeat: ScheduledTaskRepeat::Monthly { monthdays: vec![0] },
                ..sched_input("sched_monthly_bad")
            },
            Origin::gui(),
        )
        .await
        .expect_err("day 0 rejected");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }));
}

#[tokio::test]
async fn create_scheduled_task_validates_inputs() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    for bad in [
        CreateScheduledTaskInput {
            prompt: "   ".into(),
            ..sched_input("sched_bad_prompt")
        },
        CreateScheduledTaskInput {
            time_of_day: "9am".into(),
            ..sched_input("sched_bad_time")
        },
        CreateScheduledTaskInput {
            repeat: ScheduledTaskRepeat::Weekly { weekdays: vec![] },
            ..sched_input("sched_no_days")
        },
        CreateScheduledTaskInput {
            repeat: ScheduledTaskRepeat::Weekly { weekdays: vec![8] },
            ..sched_input("sched_bad_day")
        },
        CreateScheduledTaskInput {
            project_id: Some("proj_missing".into()),
            ..sched_input("sched_bad_project")
        },
    ] {
        let err = galley
            .create_scheduled_task(bad, Origin::gui())
            .await
            .expect_err("should reject");
        assert!(matches!(err, GalleyError::InvalidArgs { .. }));
    }
}

#[tokio::test]
async fn update_scheduled_task_patches_and_detaches_project() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    galley
        .create_project(
            CreateProjectInput {
                id: "proj_sched".into(),
                name: "Sched".into(),
                root_path: None,
                workspace_enabled: false,
                icon: None,
                color: None,
            },
            Origin::gui(),
        )
        .await
        .expect("create project");
    galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                project_id: Some("proj_sched".into()),
                ..sched_input("sched_up")
            },
            Origin::gui(),
        )
        .await
        .expect("create");

    let brief = galley
        .update_scheduled_task(
            ScheduledTaskId("sched_up".into()),
            ScheduledTaskPatch {
                prompt: Some("weekly repo sweep".into()),
                repeat: Some(ScheduledTaskRepeat::Weekly { weekdays: vec![1] }),
                time_of_day: Some("07:30".into()),
                enabled: Some(false),
                project_id: Some(None),
                llm_name: None,
                fire_at: None,
                target: None,
            },
            Origin::gui(),
        )
        .await
        .expect("update");
    assert_eq!(brief.prompt, "weekly repo sweep");
    assert_eq!(brief.time_of_day, "07:30");
    assert!(!brief.enabled);
    assert!(brief.project_id.is_none(), "Some(None) detaches project");
    assert!(
        brief.next_fire_at.is_none(),
        "disabled task must not expose nextFireAt"
    );

    let err = galley
        .update_scheduled_task(
            ScheduledTaskId("sched_gone".into()),
            ScheduledTaskPatch::default(),
            Origin::gui(),
        )
        .await
        .expect_err("missing id");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

#[tokio::test]
async fn mark_scheduled_task_fired_stamps_and_survives_session_delete() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    galley
        .create_scheduled_task(sched_input("sched_fire"), Origin::gui())
        .await
        .expect("create");
    galley
        .create_session(
            CreateSessionInput {
                id: "sess_from_sched".into(),
                title: "morning digest".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: None,
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::gui(),
        )
        .await
        .expect("create session");

    let brief = galley
        .mark_scheduled_task_fired(
            ScheduledTaskId("sched_fire".into()),
            "2026-07-23T01:00:00Z".into(),
            Some(SessionId("sess_from_sched".into())),
        )
        .await
        .expect("mark fired");
    assert_eq!(brief.last_fired_at.as_deref(), Some("2026-07-23T01:00:00Z"));
    assert_eq!(
        brief.last_run_session_id.as_ref().map(|s| s.as_str()),
        Some("sess_from_sched")
    );

    // Deleting the produced session must dangle to NULL, not block the
    // delete or break later reads.
    galley
        .delete_session(SessionId("sess_from_sched".into()), Origin::gui())
        .await
        .expect("delete session");
    let listed = galley.list_scheduled_tasks().await.expect("list");
    assert!(listed[0].last_run_session_id.is_none());
}

#[tokio::test]
async fn migration_049_keeps_old_tasks_as_desktop_session_tasks() {
    // Rows made before 049 rebuild unchanged: target session, made from
    // the desktop, never cancelled, no wake (main chat ticket 33).
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_027, MIG_028, MIG_029, MIG_030,
        MIG_031, MIG_032, MIG_033, MIG_034, MIG_035, MIG_036, MIG_037, MIG_038, MIG_039, MIG_040,
        MIG_042, MIG_043, MIG_044, MIG_045, MIG_046, MIG_047, MIG_048,
    ] {
        sqlx::raw_sql(sql).execute(&pool).await.expect("migration");
    }
    sqlx::query(
        "INSERT INTO scheduled_tasks (id, project_id, prompt, repeat_kind, repeat_days, \
            time_of_day, enabled, last_fired_at, last_run_session_id, created_at, updated_at, \
            llm_name) \
         VALUES ('sched_old', NULL, 'weekly sweep', 'weekly', '1,5', '07:30', 0, \
                 '2026-07-20T11:30:00Z', NULL, '2026-07-01T00:00:00+00:00', \
                 '2026-07-02T00:00:00+00:00', 'Claude Haiku 4.5')",
    )
    .execute(&pool)
    .await
    .expect("seed pre-049 row");
    sqlx::raw_sql(MIG_049)
        .execute(&pool)
        .await
        .expect("migration 049");
    // Read with today's columns (050 adds `todo_id`, 051 who cancelled).
    sqlx::raw_sql(MIG_050)
        .execute(&pool)
        .await
        .expect("migration 050");
    sqlx::raw_sql(MIG_051)
        .execute(&pool)
        .await
        .expect("migration 051");

    let galley = SqliteGalley::from_pool(pool.clone());
    let task = galley.scheduled_task("sched_old").await.expect("read");
    assert_eq!(task.prompt, "weekly sweep");
    assert_eq!(
        task.repeat,
        ScheduledTaskRepeat::Weekly {
            weekdays: vec![1, 5]
        }
    );
    assert_eq!(task.time_of_day, "07:30");
    assert!(!task.enabled);
    assert_eq!(task.llm_name.as_deref(), Some("Claude Haiku 4.5"));
    assert_eq!(task.last_fired_at.as_deref(), Some("2026-07-20T11:30:00Z"));
    assert_eq!(task.updated_at, "2026-07-02T00:00:00+00:00");
    assert_eq!(task.target, galley_core_lib::api::ScheduleTarget::Session);
    let origin = task.origin.expect("origin");
    assert_eq!(origin.via, galley_core_lib::api::OriginVia::Gui);
    assert!(origin.supervisor.is_none() && origin.reason.is_none());
    assert!(task.fire_at.is_none());
    assert!(task.cancelled_at.is_none());
    assert!(task.last_wake.is_none());
    assert!(task.created_in.is_none());
    // The widened CHECKs hold: a one-off needs its instant, a repeating
    // task its time of day.
    for bad in [
        "INSERT INTO scheduled_tasks (id, prompt, repeat_kind, created_at, updated_at) \
         VALUES ('b1', 'x', 'once', 't', 't')",
        "INSERT INTO scheduled_tasks (id, prompt, repeat_kind, created_at, updated_at) \
         VALUES ('b2', 'x', 'daily', 't', 't')",
        "INSERT INTO scheduled_tasks (id, prompt, repeat_kind, time_of_day, target, \
            created_at, updated_at) VALUES ('b3', 'x', 'daily', '09:00', 'robot', 't', 't')",
    ] {
        assert!(sqlx::query(bad).execute(&pool).await.is_err(), "{bad}");
    }
}

#[tokio::test]
async fn migration_050_adds_todos_and_leaves_tasks_on_no_to_do() {
    // Tasks made before 050 are the assistant's own (no to-do); the new
    // table's CHECKs hold (main chat ticket 39).
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_027, MIG_028, MIG_029, MIG_030,
        MIG_031, MIG_032, MIG_033, MIG_034, MIG_035, MIG_036, MIG_037, MIG_038, MIG_039, MIG_040,
        MIG_042, MIG_043, MIG_044, MIG_045, MIG_046, MIG_047, MIG_048, MIG_049,
    ] {
        sqlx::raw_sql(sql).execute(&pool).await.expect("migration");
    }
    sqlx::query(
        "INSERT INTO scheduled_tasks (id, prompt, repeat_kind, fire_at, target, created_via, \
            created_by_supervisor, created_at, updated_at) \
         VALUES ('sched_before', '提醒用户喝水', 'once', '2026-10-16T12:00:00+00:00', \
                 'assistant', 'supervisor', 'galley-assistant', \
                 '2026-10-16T00:00:00+00:00', '2026-10-16T00:00:00+00:00')",
    )
    .execute(&pool)
    .await
    .expect("seed pre-050 row");
    sqlx::raw_sql(MIG_050)
        .execute(&pool)
        .await
        .expect("migration 050");
    // Read with today's columns (051: who cancelled).
    sqlx::raw_sql(MIG_051)
        .execute(&pool)
        .await
        .expect("migration 051");
    let galley = SqliteGalley::from_pool(pool.clone());
    let task = galley.scheduled_task("sched_before").await.expect("read");
    assert_eq!(task.prompt, "提醒用户喝水");
    assert!(task.todo_id.is_none());
    let todos: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM todos")
        .fetch_one(&pool)
        .await
        .expect("todos table");
    assert_eq!(todos, 0);
    let ok = "INSERT INTO todos (id, title, due_date, created_via, created_at, updated_at) \
              VALUES ('todo_ok', '交材料', '2026-10-23', 'supervisor', 't', 't')";
    sqlx::query(ok).execute(&pool).await.expect("a to-do");
    for bad in [
        // A due date in both forms.
        "INSERT INTO todos (id, title, due_date, due_at, created_via, created_at, updated_at) \
         VALUES ('b1', 'x', '2026-10-23', '2026-10-23T07:00:00+00:00', 'cli', 't', 't')",
        // Done without who.
        "INSERT INTO todos (id, title, done_at, created_via, created_at, updated_at) \
         VALUES ('b2', 'x', 't', 'cli', 't', 't')",
        // An origin the CHECK does not name.
        "INSERT INTO todos (id, title, created_via, created_at, updated_at) \
         VALUES ('b3', 'x', 'robot', 't', 't')",
        // A title is required.
        "INSERT INTO todos (id, created_via, created_at, updated_at) \
         VALUES ('b4', 'cli', 't', 't')",
    ] {
        assert!(sqlx::query(bad).execute(&pool).await.is_err(), "{bad}");
    }
}

#[tokio::test]
async fn migration_054_adds_the_items_under_a_to_do_and_leaves_the_to_dos_as_they_were() {
    // Main chat ticket 111: to-dos noted before 054 have no items; the new
    // table's CHECKs hold (words, done with who, the origin values).
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    run_migrations_through_051(&pool).await;
    for sql in [MIG_052, MIG_053] {
        sqlx::raw_sql(sql).execute(&pool).await.expect("migration");
    }
    sqlx::query(
        "INSERT INTO todos (id, title, notes, created_via, created_at, updated_at) \
         VALUES ('todo_before', '希尔顿酒店项目资料收集', '收集要点：品牌、预算', \
                 'supervisor', '2026-10-28T09:46:38+00:00', '2026-10-28T09:46:38+00:00')",
    )
    .execute(&pool)
    .await
    .expect("seed pre-054 to-do");
    sqlx::raw_sql(MIG_054)
        .execute(&pool)
        .await
        .expect("migration 054");
    let galley = SqliteGalley::from_pool(pool.clone());
    let todo = galley.todo("todo_before").await.expect("read");
    assert_eq!(todo.notes.as_deref(), Some("收集要点：品牌、预算"));
    assert!(todo.items.is_empty() && todo.item_count.is_none());
    assert_eq!(todo.updated_at, "2026-10-28T09:46:38+00:00");
    let ok = "INSERT INTO todo_subitems (id, todo_id, text, position, created_at, updated_at) \
              VALUES ('item_ok', 'todo_before', '品牌', 1, 't', 't')";
    sqlx::query(ok).execute(&pool).await.expect("an item");
    let ticked = "INSERT INTO todo_subitems \
                  (id, todo_id, text, position, done_at, done_via, created_at, updated_at) \
                  VALUES ('item_ticked', 'todo_before', '预算', 2, 't', 'gui', 't', 't')";
    sqlx::query(ticked)
        .execute(&pool)
        .await
        .expect("a ticked item");
    for bad in [
        // No words.
        "INSERT INTO todo_subitems (id, todo_id, text, position, created_at, updated_at) \
         VALUES ('b1', 'todo_before', '  ', 3, 't', 't')",
        // Ticked without who.
        "INSERT INTO todo_subitems (id, todo_id, text, position, done_at, created_at, updated_at) \
         VALUES ('b2', 'todo_before', 'x', 3, 't', 't', 't')",
        // Who without the tick.
        "INSERT INTO todo_subitems (id, todo_id, text, position, done_via, created_at, updated_at) \
         VALUES ('b3', 'todo_before', 'x', 3, 'gui', 't', 't')",
        // An origin the CHECK does not name.
        "INSERT INTO todo_subitems \
         (id, todo_id, text, position, done_at, done_via, created_at, updated_at) \
         VALUES ('b4', 'todo_before', 'x', 3, 't', 'robot', 't', 't')",
        // A to-do is required.
        "INSERT INTO todo_subitems (id, text, position, created_at, updated_at) \
         VALUES ('b5', 'x', 3, 't', 't')",
    ] {
        assert!(sqlx::query(bad).execute(&pool).await.is_err(), "{bad}");
    }
    let todo = galley.todo("todo_before").await.expect("read");
    let words: Vec<&str> = todo.items.iter().map(|i| i.text.as_str()).collect();
    assert_eq!(words, ["品牌", "预算"]);
    assert!(todo.items[1].done);
}

#[tokio::test]
async fn migration_051_records_who_cancelled_and_leaves_older_cancels_unknown() {
    // Main chat ticket 61: rows cancelled before 051 keep NULL (who it
    // was is not known, and is not guessed); the CHECKs name the origin
    // values and need the cancel stamp.
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_027, MIG_028, MIG_029, MIG_030,
        MIG_031, MIG_032, MIG_033, MIG_034, MIG_035, MIG_036, MIG_037, MIG_038, MIG_039, MIG_040,
        MIG_042, MIG_043, MIG_044, MIG_045, MIG_046, MIG_047, MIG_048, MIG_049, MIG_050,
    ] {
        sqlx::raw_sql(sql).execute(&pool).await.expect("migration");
    }
    sqlx::query(
        "INSERT INTO scheduled_tasks (id, prompt, repeat_kind, fire_at, target, created_via, \
            created_by_supervisor, cancelled_at, created_at, updated_at) \
         VALUES ('sched_gone', '提醒用户确认装修进度', 'once', '2026-10-16T12:00:00+00:00', \
                 'assistant', 'supervisor', 'galley-assistant', '2026-10-16T01:00:00+00:00', \
                 '2026-10-16T00:00:00+00:00', '2026-10-16T01:00:00+00:00')",
    )
    .execute(&pool)
    .await
    .expect("seed a task cancelled before 051");
    sqlx::query(
        "INSERT INTO todos (id, title, cancelled_at, created_via, created_by_supervisor, \
            created_at, updated_at) \
         VALUES ('todo_gone', '702 装修验收', '2026-10-16T01:00:00+00:00', 'supervisor', \
                 'galley-assistant', 't', 't')",
    )
    .execute(&pool)
    .await
    .expect("seed a to-do cancelled before 051");
    sqlx::raw_sql(MIG_051)
        .execute(&pool)
        .await
        .expect("migration 051");
    // Read with today's code, which reads a to-do's items (054, main chat
    // ticket 111).
    for sql in [MIG_052, MIG_053, MIG_054] {
        sqlx::raw_sql(sql).execute(&pool).await.expect("migration");
    }
    let galley = SqliteGalley::from_pool(pool.clone());
    let task = galley.scheduled_task("sched_gone").await.expect("read");
    assert!(task.cancelled_at.is_some());
    assert!(task.cancelled_by.is_none());
    let todo = galley.todo("todo_gone").await.expect("read");
    assert!(todo.cancelled_at.is_some());
    assert!(todo.cancelled_by.is_none());
    let ok = "INSERT INTO todos (id, title, cancelled_at, cancelled_via, \
                cancelled_by_supervisor, cancelled_origin_note, created_via, created_at, \
                updated_at) \
              VALUES ('todo_ok', 'x', 't', 'supervisor', 'galley-assistant', '不用了', 'cli', \
                      't', 't')";
    sqlx::query(ok)
        .execute(&pool)
        .await
        .expect("a cancel with who");
    for bad in [
        // Who cancelled, on a row that is not cancelled.
        "INSERT INTO todos (id, title, cancelled_via, created_via, created_at, updated_at) \
         VALUES ('b1', 'x', 'gui', 'cli', 't', 't')",
        "INSERT INTO scheduled_tasks (id, prompt, repeat_kind, time_of_day, cancelled_via, \
            created_at, updated_at) VALUES ('b2', 'x', 'daily', '09:00', 'gui', 't', 't')",
        // An origin the CHECK does not name.
        "INSERT INTO todos (id, title, cancelled_at, cancelled_via, created_via, created_at, \
            updated_at) VALUES ('b3', 'x', 't', 'robot', 'cli', 't', 't')",
        "INSERT INTO scheduled_tasks (id, prompt, repeat_kind, time_of_day, cancelled_at, \
            cancelled_via, created_at, updated_at) \
         VALUES ('b4', 'x', 'daily', '09:00', 't', 'robot', 't', 't')",
    ] {
        assert!(sqlx::query(bad).execute(&pool).await.is_err(), "{bad}");
    }
}

#[tokio::test]
async fn delete_scheduled_task_cancels_and_keeps_the_row() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    galley
        .create_scheduled_task(sched_input("sched_del"), Origin::gui())
        .await
        .expect("create");
    galley
        .delete_scheduled_task(ScheduledTaskId("sched_del".into()), Origin::gui())
        .await
        .expect("delete");
    // Gone from the desktop's list and the scheduler's (ticket 33)…
    assert!(galley
        .list_scheduled_tasks()
        .await
        .expect("list")
        .is_empty());
    // …but kept, cancelled, for its card, with who cancelled it (ticket
    // 61): the desktop.
    let kept = galley.scheduled_task("sched_del").await.expect("kept");
    assert!(kept.cancelled_at.is_some());
    assert!(kept.next_fire_at.is_none());
    let by = kept.cancelled_by.expect("who cancelled");
    assert_eq!(by.via, galley_core_lib::api::OriginVia::Gui);
    assert!(by.supervisor.is_none() && by.reason.is_none());
    let err = galley
        .delete_scheduled_task(ScheduledTaskId("sched_del".into()), Origin::gui())
        .await
        .expect_err("double delete");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

// ============= session-auto-title · title_source semantics =============

fn title_input(id: &str, title: &str) -> CreateSessionInput {
    CreateSessionInput {
        id: id.into(),
        title: title.into(),
        project_id: None,
        selected_llm_index: None,
        selected_llm_key: None,
        selected_llm_display_name: None,
        ga_runtime_kind: None,
        ga_runtime_id: None,
        prompt_profile: None,
    }
}

async fn title_source_of(pool: &SqlitePool, id: &str) -> String {
    sqlx::query_scalar("SELECT title_source FROM sessions WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .expect("read title_source")
}

#[tokio::test]
async fn create_session_marks_seed_vs_user_title_source() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    galley
        .create_session(title_input("s_seed", "新对话"), Origin::gui())
        .await
        .expect("create seed session");
    galley
        .create_session(title_input("s_user", "Deploy pipeline"), Origin::gui())
        .await
        .expect("create titled session");
    assert_eq!(title_source_of(&pool, "s_seed").await, "seed");
    assert_eq!(title_source_of(&pool, "s_user").await, "user");
}

#[tokio::test]
async fn rename_stamps_user_derived_and_seed_reset() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    galley
        .create_session(title_input("s_r", "新对话"), Origin::gui())
        .await
        .expect("create");

    // GUI first-message truncation keeps the row upgradable.
    galley
        .rename_session_with_source(
            sid("s_r"),
            "帮我看看这个 bug".into(),
            galley_core_lib::db::RenameTitleSource::Derived,
            Origin::gui(),
        )
        .await
        .expect("derived rename");
    assert_eq!(title_source_of(&pool, "s_r").await, "derived");

    // Plain rename (trait path) locks it as a user title.
    galley
        .rename_session(sid("s_r"), "登录问题".into(), Origin::gui())
        .await
        .expect("user rename");
    assert_eq!(title_source_of(&pool, "s_r").await, "user");

    // Clearing the title hands it back to Galley (seed again).
    galley
        .rename_session(sid("s_r"), "   ".into(), Origin::gui())
        .await
        .expect("clear rename");
    assert_eq!(title_source_of(&pool, "s_r").await, "seed");
}

#[tokio::test]
async fn try_apply_auto_title_cas_respects_eligibility() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    galley
        .create_session(title_input("s_cas", "新对话"), Origin::gui())
        .await
        .expect("create");

    // seed → auto succeeds.
    let brief = galley
        .try_apply_auto_title(&sid("s_cas"), "登录超时排查")
        .await
        .expect("cas ok")
        .expect("eligible row updated");
    assert_eq!(brief.title, "登录超时排查");
    assert_eq!(title_source_of(&pool, "s_cas").await, "auto");

    // auto is NOT eligible again — one-shot per session.
    let second = galley
        .try_apply_auto_title(&sid("s_cas"), "另一个标题")
        .await
        .expect("cas ok");
    assert!(second.is_none());
    assert_eq!(title_source_of(&pool, "s_cas").await, "auto");

    // A user rename permanently wins over a late title_generated.
    galley
        .rename_session(sid("s_cas"), "我的标题".into(), Origin::gui())
        .await
        .expect("user rename");
    let after_user = galley
        .try_apply_auto_title(&sid("s_cas"), "迟到的自动标题")
        .await
        .expect("cas ok");
    assert!(after_user.is_none());
    let title: String = sqlx::query_scalar("SELECT title FROM sessions WHERE id = 's_cas'")
        .fetch_one(&pool)
        .await
        .expect("read title");
    assert_eq!(title, "我的标题");

    // Empty / whitespace generated titles are dropped.
    galley
        .create_session(title_input("s_cas2", "新对话"), Origin::gui())
        .await
        .expect("create 2");
    let empty = galley
        .try_apply_auto_title(&sid("s_cas2"), "   ")
        .await
        .expect("cas ok");
    assert!(empty.is_none());
    assert_eq!(title_source_of(&pool, "s_cas2").await, "seed");
}

#[tokio::test]
async fn migration_backfill_marks_existing_seed_rows() {
    // Simulate a pre-038 database: run everything except 038, insert
    // rows, then apply 038 and check the backfill split.
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_027, MIG_028, MIG_029, MIG_030,
        MIG_031, MIG_032, MIG_033, MIG_034, MIG_035, MIG_036, MIG_037,
    ] {
        sqlx::raw_sql(sql).execute(&pool).await.expect("migration");
    }
    seed_session_idle(&pool, "s_old_seed").await;
    sqlx::query("UPDATE sessions SET title = '新对话' WHERE id = 's_old_seed'")
        .execute(&pool)
        .await
        .expect("seed title");
    seed_session_idle(&pool, "s_old_named").await;
    sqlx::query("UPDATE sessions SET title = '部署流水线' WHERE id = 's_old_named'")
        .execute(&pool)
        .await
        .expect("named title");

    sqlx::raw_sql(MIG_038)
        .execute(&pool)
        .await
        .expect("apply 038");
    assert_eq!(title_source_of(&pool, "s_old_seed").await, "seed");
    assert_eq!(title_source_of(&pool, "s_old_named").await, "user");
}
