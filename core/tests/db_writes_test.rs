//! Integration tests for `SqliteGalley` write methods (B3 M4a).
//!
//! Read tests live in [`db_test.rs`]; write tests are split out so the
//! happy-path / error-path matrix per method has room to breathe.
//! Shared test setup (`fresh_pool`) is intentionally duplicated rather
//! than imported from `db_test.rs` because cargo test compiles each
//! `tests/*.rs` as its own crate root — sharing across files needs a
//! `tests/common/mod.rs` scaffold that adds noise for two test files.

use galley_core_lib::api::{
    CreateGoalInput, CreateProjectInput, CreateScheduledTaskInput, CreateSessionInput, GalleyApi,
    GoalId, GoalStatus, ManagedModelAuthKind, ManagedModelCredentialStatus, ManagedModelProtocol,
    MessageTelemetry, MessageVisibility, Origin, ProjectId, ProjectPatch, RuntimeKind,
    ScheduledTaskId, ScheduledTaskPatch, ScheduledTaskRepeat, SessionFilter, SessionId,
    SessionStatus, DEFAULT_GOAL_BUDGET_SECONDS,
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
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_027, MIG_028, MIG_029, MIG_030,
        MIG_031, MIG_032, MIG_033, MIG_034, MIG_035, MIG_036, MIG_037, MIG_038, MIG_039, MIG_040,
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
        .persist_gui_assistant_message(PersistAssistantMessage {
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

// ---------------- Goal v2 ----------------

fn goal_input(session: &str, objective: &str, budget: Option<u32>) -> CreateGoalInput {
    CreateGoalInput {
        session_id: sid(session),
        objective: objective.into(),
        budget_seconds: budget,
    }
}

#[tokio::test]
async fn goal_create_defaults_and_lists() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    seed_session_idle(&pool, "s1").await;

    let goal = galley
        .create_goal(
            goal_input("s1", "  Ship goal v2  ", Some(DEFAULT_GOAL_BUDGET_SECONDS)),
            Origin::cli(Some("sup-1".into()), Some("user asked".into())),
        )
        .await
        .expect("create goal");
    assert_eq!(goal.session_id, sid("s1"));
    assert_eq!(goal.objective, "Ship goal v2");
    assert_eq!(goal.status, GoalStatus::Active);
    assert_eq!(goal.budget_seconds, Some(DEFAULT_GOAL_BUDGET_SECONDS));
    assert_eq!(goal.continuation_count, 0);
    assert!(!goal.wrap_up_dispatched);
    assert!(goal.ended_at.is_none());
    assert!(goal.paused_at.is_none());
    let origin = goal.origin.as_ref().expect("cli origin kept");
    assert_eq!(origin.supervisor.as_deref(), Some("sup-1"));
    assert_eq!(origin.reason.as_deref(), Some("user asked"));

    let active = galley.list_active_goals().await.expect("active");
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].id, goal.id);
    let for_session = galley
        .list_goals_for_session(sid("s1"))
        .await
        .expect("for session");
    assert_eq!(for_session.len(), 1);
    assert_eq!(
        galley.get_goal(goal.id.clone()).await.expect("get").id,
        goal.id
    );

    // No ceiling is an explicit choice, and GUI origin is elided like
    // SessionBrief does.
    seed_session_idle(&pool, "s2").await;
    let open_ended = galley
        .create_goal(goal_input("s2", "Keep improving", None), Origin::gui())
        .await
        .expect("create open-ended goal");
    assert_eq!(open_ended.budget_seconds, None);
    assert!(open_ended.origin.is_none());
}

#[tokio::test]
async fn goal_create_rejects_empty_objective_missing_session_and_second_open_goal() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    seed_session_idle(&pool, "s1").await;

    let err = galley
        .create_goal(goal_input("s1", "   ", None), Origin::gui())
        .await
        .expect_err("blank objective");
    assert!(matches!(err, GalleyError::InvalidArgs { .. }), "{err:?}");

    let err = galley
        .create_goal(goal_input("nope", "x", None), Origin::gui())
        .await
        .expect_err("missing session");
    assert!(matches!(err, GalleyError::NotFound { .. }), "{err:?}");

    let first = galley
        .create_goal(goal_input("s1", "first", None), Origin::gui())
        .await
        .expect("first goal");
    let err = galley
        .create_goal(goal_input("s1", "second", None), Origin::gui())
        .await
        .expect_err("second open goal on the same session");
    match err {
        GalleyError::InvalidArgs { message } => {
            assert!(message.contains(first.id.as_str()), "{message}")
        }
        other => panic!("expected invalid_args, got {other:?}"),
    }

    // A paused / blocked goal still occupies the session's slot …
    galley
        .update_goal_status(
            first.id.clone(),
            GoalStatus::Blocked,
            Some("need key".into()),
        )
        .await
        .expect("block");
    assert!(galley
        .create_goal(goal_input("s1", "third", None), Origin::gui())
        .await
        .is_err());
    // … a terminal one frees it.
    galley
        .update_goal_status(first.id.clone(), GoalStatus::Stopped, None)
        .await
        .expect("stop");
    galley
        .create_goal(goal_input("s1", "third", None), Origin::gui())
        .await
        .expect("slot freed after terminal status");
}

#[tokio::test]
async fn goal_status_transitions_stamp_timestamps_and_keep_summary() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    seed_session_idle(&pool, "s1").await;
    let goal = galley
        .create_goal(goal_input("s1", "objective", Some(120)), Origin::gui())
        .await
        .expect("create");

    let paused = galley
        .update_goal_status(goal.id.clone(), GoalStatus::Paused, None)
        .await
        .expect("pause");
    assert_eq!(paused.status, GoalStatus::Paused);
    assert!(paused.paused_at.is_some());
    assert!(paused.ended_at.is_none());

    let resumed = galley
        .update_goal_status(goal.id.clone(), GoalStatus::Active, Some("  ".into()))
        .await
        .expect("resume");
    assert_eq!(resumed.status, GoalStatus::Active);
    assert!(resumed.paused_at.is_none(), "resume clears paused_at");
    assert!(
        resumed.latest_summary.is_none(),
        "blank summary keeps stored None"
    );

    let bumped = galley
        .bump_goal_continuation(goal.id.clone(), false)
        .await
        .expect("bump");
    assert_eq!(bumped.continuation_count, 1);
    assert!(!bumped.wrap_up_dispatched);
    let wrapped = galley
        .bump_goal_continuation(goal.id.clone(), true)
        .await
        .expect("bump wrap-up");
    assert_eq!(wrapped.continuation_count, 2);
    assert!(wrapped.wrap_up_dispatched);

    let done = galley
        .update_goal_status(
            goal.id.clone(),
            GoalStatus::BudgetLimited,
            Some("delivered current best".into()),
        )
        .await
        .expect("budget limited");
    assert_eq!(done.status, GoalStatus::BudgetLimited);
    assert!(done.ended_at.is_some());
    assert_eq!(
        done.latest_summary.as_deref(),
        Some("delivered current best")
    );
    assert!(galley.list_active_goals().await.expect("active").is_empty());

    let err = galley
        .update_goal_status(GoalId("goal_missing".into()), GoalStatus::Stopped, None)
        .await
        .expect_err("unknown goal");
    assert!(matches!(err, GalleyError::NotFound { .. }));
}

#[tokio::test]
async fn visible_goals_include_unseen_terminals_and_rank_attention_first() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    for s in ["s-active", "s-blocked", "s-done", "s-seen"] {
        seed_session_idle(&pool, s).await;
    }
    let active = galley
        .create_goal(goal_input("s-active", "a", None), Origin::gui())
        .await
        .unwrap();
    let blocked = galley
        .create_goal(goal_input("s-blocked", "b", None), Origin::gui())
        .await
        .unwrap();
    galley
        .update_goal_status(
            blocked.id.clone(),
            GoalStatus::Blocked,
            Some("stuck".into()),
        )
        .await
        .unwrap();
    let done = galley
        .create_goal(goal_input("s-done", "c", None), Origin::gui())
        .await
        .unwrap();
    galley
        .update_goal_status(done.id.clone(), GoalStatus::Completed, Some("ok".into()))
        .await
        .unwrap();
    let seen = galley
        .create_goal(goal_input("s-seen", "d", None), Origin::gui())
        .await
        .unwrap();
    galley
        .update_goal_status(seen.id.clone(), GoalStatus::Stopped, None)
        .await
        .unwrap();
    galley
        .mark_goal_result_seen(seen.id.clone(), Origin::gui())
        .await
        .unwrap();

    let visible = galley.list_visible_goals().await.expect("visible");
    let ids: Vec<&str> = visible.iter().map(|g| g.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![blocked.id.as_str(), active.id.as_str(), done.id.as_str()]
    );

    // Seeing the completed result removes it from the list; the open ones stay.
    galley
        .mark_goal_result_seen(done.id.clone(), Origin::gui())
        .await
        .unwrap();
    let visible = galley.list_visible_goals().await.expect("visible");
    assert_eq!(visible.len(), 2);
    assert!(visible.iter().all(|g| g.status.is_open()));
}

#[tokio::test]
async fn pause_open_goals_parks_active_only() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    for s in ["s1", "s2", "s3"] {
        seed_session_idle(&pool, s).await;
    }
    let a = galley
        .create_goal(goal_input("s1", "a", None), Origin::gui())
        .await
        .unwrap();
    let b = galley
        .create_goal(goal_input("s2", "b", None), Origin::gui())
        .await
        .unwrap();
    galley
        .update_goal_status(b.id.clone(), GoalStatus::Blocked, None)
        .await
        .unwrap();
    let c = galley
        .create_goal(goal_input("s3", "c", None), Origin::gui())
        .await
        .unwrap();
    galley
        .update_goal_status(c.id.clone(), GoalStatus::Completed, None)
        .await
        .unwrap();

    assert_eq!(galley.pause_open_goals().await.expect("pause"), 1);
    assert_eq!(
        galley.get_goal(a.id).await.unwrap().status,
        GoalStatus::Paused
    );
    assert_eq!(
        galley.get_goal(b.id).await.unwrap().status,
        GoalStatus::Blocked
    );
    assert_eq!(
        galley.get_goal(c.id).await.unwrap().status,
        GoalStatus::Completed
    );
}

/// The objective turn is stamped with the goal it opens (`messages.goal_id`,
/// migration 031) so the GUI brackets the episode by exact id; ordinary
/// sends stay unstamped.
#[tokio::test]
async fn goal_scoped_message_rows_carry_goal_id() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool.clone());
    seed_session_idle(&pool, "s1").await;
    let goal = galley
        .create_goal(goal_input("s1", "objective", None), Origin::gui())
        .await
        .unwrap();

    galley
        .send_message_for_goal(
            sid("s1"),
            "objective".into(),
            Origin::gui(),
            goal.id.clone(),
        )
        .await
        .expect("objective row");
    galley
        .send_message(sid("s1"), "plain follow-up".into(), Origin::gui())
        .await
        .expect("plain row");

    let stamped: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT content, goal_id FROM messages WHERE session_id = 's1' ORDER BY turn_index",
    )
    .fetch_all(&pool)
    .await
    .expect("read rows");
    assert_eq!(
        stamped,
        vec![
            ("objective".to_string(), Some(goal.id.0.clone())),
            ("plain follow-up".to_string(), None),
        ]
    );
}

/// Migration 039 carries v1 rows over: finished goals keep their status,
/// mid-run ones land as `stopped` and already seen, headless ones drop.
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

    let galley = SqliteGalley::from_pool(pool.clone());
    let done = galley
        .get_goal(GoalId("g-done".into()))
        .await
        .expect("carried");
    assert_eq!(done.status, GoalStatus::Completed);
    assert_eq!(done.session_id, sid("s1"));
    assert_eq!(done.budget_seconds, Some(600));
    assert_eq!(done.latest_summary.as_deref(), Some("shipped"));
    assert!(done.result_seen_at.is_some());
    assert_eq!(done.elapsed_seconds, 9 * 60);

    let live = galley
        .get_goal(GoalId("g-live".into()))
        .await
        .expect("carried");
    assert_eq!(live.status, GoalStatus::Stopped);
    assert_eq!(live.ended_at.as_deref(), Some("2026-07-01T10:20:00+00:00"));
    assert!(
        live.result_seen_at.is_some(),
        "mid-run rows must not resurface as unseen"
    );

    assert!(galley.get_goal(GoalId("g-headless".into())).await.is_err());
    assert!(galley.list_visible_goals().await.unwrap().is_empty());
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
            advanced_options: serde_json::json!({
                "thinking_type": "adaptive",
                "read_timeout": 180
            }),
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
                advanced_options: serde_json::json!({}),
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
            advanced_options: serde_json::json!({}),
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
async fn delete_scheduled_task_removes_row() {
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
    assert!(galley
        .list_scheduled_tasks()
        .await
        .expect("list")
        .is_empty());
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
