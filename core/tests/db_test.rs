//! Integration tests for `SqliteGalley` reads.
//!
//! Tests use an in-memory SQLite DB seeded with the same migration SQL
//! the GUI runs in production. Each test sets up its own DB to keep
//! cases isolated.

use galley_core_lib::api::{
    GalleyApi, MessageId, MessageWindow, OriginVia, RuntimeKind, SearchScope, SessionFilter,
    SessionId, SessionStatus,
};
use galley_core_lib::db::SqliteGalley;
use sqlx::SqlitePool;

// Migration SQL — same files Tauri's tauri-plugin-sql runs in
// production via core/src/lib.rs's `run()`. Included by relative path
// from `core/tests/`. Each migration is idempotent only at the schema
// level: re-running on an existing DB would fail, but we always start
// from a fresh in-memory pool per test.
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
const MIG_031: &str = include_str!("../migrations/031_message_goal_id.sql");
// 034 only ADD COLUMN approval_mode to sessions; 030–033 touch goal tables
// this fixture doesn't exercise.
const MIG_034: &str = include_str!("../migrations/034_session_approval_mode.sql");
const MIG_038: &str = include_str!("../migrations/038_session_title_source.sql");
const MIG_040: &str = include_str!("../migrations/040_session_reasoning_effort.sql");
const MIG_042: &str = include_str!("../migrations/042_managed_model_advanced_layers.sql");
const MIG_043: &str = include_str!("../migrations/043_message_session_client.sql");
const MIG_044: &str = include_str!("../migrations/044_session_main_chat.sql");
const MIG_045: &str = include_str!("../migrations/045_ledger_exclusions.sql");
const MIG_046: &str = include_str!("../migrations/046_main_chat_segments.sql");
const MIG_047: &str = include_str!("../migrations/047_drop_ledger_exclusions.sql");

async fn fresh_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_027, MIG_028, MIG_029, MIG_031, MIG_034,
        MIG_038, MIG_040, MIG_042, MIG_043, MIG_044, MIG_045, MIG_046, MIG_047,
    ] {
        sqlx::raw_sql(sql)
            .execute(&pool)
            .await
            .expect("run migration");
    }
    pool
}

#[tokio::test]
async fn runtime_identity_migration_preserves_existing_attach_users() {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007,
    ] {
        sqlx::raw_sql(sql)
            .execute(&pool)
            .await
            .expect("run pre-runtime migration");
    }
    sqlx::query("INSERT INTO prefs (key, value, updated_at) VALUES (?, ?, ?)")
        .bind("ga_config")
        .bind(r#"{"gaPath":"/Users/jc/GenericAgent"}"#)
        .bind("2026-05-23T00:00:00Z")
        .execute(&pool)
        .await
        .expect("seed ga_config");

    sqlx::raw_sql(MIG_008)
        .execute(&pool)
        .await
        .expect("run runtime migration");
    sqlx::raw_sql(MIG_009)
        .execute(&pool)
        .await
        .expect("run managed models migration");
    sqlx::raw_sql(MIG_010)
        .execute(&pool)
        .await
        .expect("run managed model providers migration");
    sqlx::raw_sql(MIG_011)
        .execute(&pool)
        .await
        .expect("run managed model order migration");
    sqlx::raw_sql(MIG_012)
        .execute(&pool)
        .await
        .expect("run managed model local secrets migration");
    sqlx::raw_sql(MIG_013)
        .execute(&pool)
        .await
        .expect("run session llm key migration");
    sqlx::raw_sql(MIG_014)
        .execute(&pool)
        .await
        .expect("run managed model auth kind migration");
    sqlx::raw_sql(MIG_015)
        .execute(&pool)
        .await
        .expect("run goal v1 migration");
    sqlx::raw_sql(MIG_016)
        .execute(&pool)
        .await
        .expect("run goal master session migration");
    sqlx::raw_sql(MIG_017)
        .execute(&pool)
        .await
        .expect("run message visibility migration");

    let active: String =
        sqlx::query_scalar("SELECT value FROM prefs WHERE key = 'active_runtime_kind'")
            .fetch_one(&pool)
            .await
            .expect("read active runtime");
    assert_eq!(active, r#""external""#);
}

async fn seed_session(pool: &SqlitePool, id: &str, title: &str, status: &str, ts: &str) {
    seed_session_with_runtime(pool, id, title, status, ts, "external").await;
}

async fn seed_session_with_runtime(
    pool: &SqlitePool,
    id: &str,
    title: &str,
    status: &str,
    ts: &str,
    runtime_kind: &str,
) {
    sqlx::query(
        "INSERT INTO sessions (id, title, status, turn_count, pending_approval_count, \
            error_count, pinned, last_activity_at, created_at, updated_at, ga_runtime_kind) \
         VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(title)
    .bind(status)
    .bind(ts)
    .bind(ts)
    .bind(ts)
    .bind(runtime_kind)
    .execute(pool)
    .await
    .expect("seed session");
}

#[allow(clippy::too_many_arguments)] // Test seed helper — 8 args is fine.
async fn seed_message(
    pool: &SqlitePool,
    id: &str,
    session_id: &str,
    turn: i64,
    seq: i64,
    role: &str,
    content: &str,
    created_at: &str,
) {
    sqlx::query(
        "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(session_id)
    .bind(turn)
    .bind(seq)
    .bind(role)
    .bind(content)
    .bind(created_at)
    .execute(pool)
    .await
    .expect("seed message");

    // Mirror the GUI's `indexMessageFts` write so FTS5 search hits
    // the row. Only user.content and assistant.final_answer are
    // indexed in production — but for test simplicity index any
    // role's content. The trigram tokenizer doesn't care.
    sqlx::query(
        "INSERT INTO messages_fts (message_id, session_id, role, turn_index, body) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(session_id)
    .bind(role)
    .bind(turn)
    .bind(content)
    .execute(pool)
    .await
    .expect("seed fts row");
}

#[tokio::test]
async fn list_sessions_default_filter_returns_all_in_recency_order() {
    let pool = fresh_pool().await;
    seed_session(&pool, "sess_old", "old", "idle", "2026-05-10T00:00:00Z").await;
    seed_session(&pool, "sess_new", "new", "idle", "2026-05-18T00:00:00Z").await;
    seed_session(
        &pool,
        "sess_arch",
        "old archived",
        "archived",
        "2026-05-15T00:00:00Z",
    )
    .await;

    let galley = SqliteGalley::from_pool(pool);
    // Default SessionFilter has archived=None → no filter (active +
    // archived both returned). Matches the legacy `loadSessions()`
    // TS behaviour the GUI hydrate path depends on.
    let rows = galley
        .list_sessions(SessionFilter::default())
        .await
        .expect("list_sessions");

    let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, vec!["sess_new", "sess_arch", "sess_old"]);
}

#[tokio::test]
async fn list_sessions_archived_false_excludes_archived() {
    let pool = fresh_pool().await;
    seed_session(&pool, "sess_old", "old", "idle", "2026-05-10T00:00:00Z").await;
    seed_session(&pool, "sess_new", "new", "idle", "2026-05-18T00:00:00Z").await;
    seed_session(
        &pool,
        "sess_arch",
        "archived",
        "archived",
        "2026-05-15T00:00:00Z",
    )
    .await;

    let galley = SqliteGalley::from_pool(pool);
    let rows = galley
        .list_sessions(SessionFilter {
            archived: Some(false),
            ..Default::default()
        })
        .await
        .expect("list_sessions excluding archived");

    let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, vec!["sess_new", "sess_old"]);
}

#[tokio::test]
async fn list_sessions_with_archived_true_returns_only_archived() {
    let pool = fresh_pool().await;
    seed_session(&pool, "sess_live", "live", "idle", "2026-05-18T00:00:00Z").await;
    seed_session(
        &pool,
        "sess_arch",
        "archived",
        "archived",
        "2026-05-10T00:00:00Z",
    )
    .await;

    let galley = SqliteGalley::from_pool(pool);
    let rows = galley
        .list_sessions(SessionFilter {
            archived: Some(true),
            ..Default::default()
        })
        .await
        .expect("list archived");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id.as_str(), "sess_arch");
    assert!(matches!(rows[0].status, SessionStatus::Archived));
}

#[tokio::test]
async fn list_sessions_status_filter_matches_exact() {
    let pool = fresh_pool().await;
    seed_session(&pool, "sess_a", "a", "idle", "2026-05-18T00:00:00Z").await;
    seed_session(&pool, "sess_b", "b", "completed", "2026-05-17T00:00:00Z").await;

    let galley = SqliteGalley::from_pool(pool);
    let rows = galley
        .list_sessions(SessionFilter {
            status: Some(SessionStatus::Completed),
            ..Default::default()
        })
        .await
        .expect("list completed");

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id.as_str(), "sess_b");
}

#[tokio::test]
async fn session_brief_not_found_errors() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let err = galley
        .session_brief(SessionId("sess_missing".into()))
        .await
        .expect_err("expected NotFound");
    match err {
        galley_core_lib::error::GalleyError::NotFound { .. } => {}
        other => panic!("expected NotFound, got {other:?}"),
    }
}

#[tokio::test]
async fn session_brief_returns_one_row() {
    let pool = fresh_pool().await;
    seed_session(&pool, "sess_x", "Hello", "idle", "2026-05-18T00:00:00Z").await;
    let galley = SqliteGalley::from_pool(pool);
    let brief = galley
        .session_brief(SessionId("sess_x".into()))
        .await
        .expect("session_brief");
    assert_eq!(brief.title, "Hello");
    assert!(matches!(brief.status, SessionStatus::Idle));
    assert_eq!(brief.pinned, Some(false));
}

#[tokio::test]
async fn session_messages_returns_chronological_order() {
    let pool = fresh_pool().await;
    seed_session(&pool, "sess_x", "Conv", "idle", "2026-05-18T00:00:00Z").await;
    seed_message(
        &pool,
        "m1",
        "sess_x",
        1,
        0,
        "user",
        "hi",
        "2026-05-18T00:00:00Z",
    )
    .await;
    seed_message(
        &pool,
        "m2",
        "sess_x",
        1,
        1,
        "assistant",
        "hello",
        "2026-05-18T00:00:01Z",
    )
    .await;
    seed_message(
        &pool,
        "m3",
        "sess_x",
        2,
        0,
        "user",
        "how?",
        "2026-05-18T00:00:02Z",
    )
    .await;

    let galley = SqliteGalley::from_pool(pool);
    let msgs = galley
        .session_messages(SessionId("sess_x".into()), None)
        .await
        .expect("session_messages");
    let ids: Vec<&str> = msgs.iter().map(|m| m.id.0.as_str()).collect();
    assert_eq!(ids, vec!["m1", "m2", "m3"]);
}

#[tokio::test]
async fn session_messages_projects_origin_metadata() {
    let pool = fresh_pool().await;
    seed_session(&pool, "sess_x", "Conv", "idle", "2026-05-18T00:00:00Z").await;
    seed_message(
        &pool,
        "m1",
        "sess_x",
        1,
        0,
        "user",
        "hi",
        "2026-05-18T00:00:00Z",
    )
    .await;
    sqlx::query(
        "UPDATE messages \
         SET created_via = 'supervisor', supervisor = 'ga-test/v1', origin_note = 'dogfood' \
         WHERE id = 'm1'",
    )
    .execute(&pool)
    .await
    .expect("update origin");

    let galley = SqliteGalley::from_pool(pool);
    let msgs = galley
        .session_messages(SessionId("sess_x".into()), None)
        .await
        .expect("session_messages");

    let origin = msgs[0].origin.as_ref().expect("origin");
    assert_eq!(origin.via, OriginVia::Supervisor);
    assert_eq!(origin.supervisor.as_deref(), Some("ga-test/v1"));
    assert_eq!(origin.reason.as_deref(), Some("dogfood"));
}

#[tokio::test]
async fn session_messages_tail_returns_last_n_in_order() {
    let pool = fresh_pool().await;
    seed_session(&pool, "sess_x", "Conv", "idle", "2026-05-18T00:00:00Z").await;
    for i in 1..=5 {
        seed_message(
            &pool,
            &format!("m{i}"),
            "sess_x",
            i,
            0,
            "user",
            &format!("msg{i}"),
            &format!("2026-05-18T00:00:0{i}Z"),
        )
        .await;
    }

    let galley = SqliteGalley::from_pool(pool);
    let msgs = galley
        .session_messages(SessionId("sess_x".into()), Some(2))
        .await
        .expect("session_messages tail");
    let ids: Vec<&str> = msgs.iter().map(|m| m.id.0.as_str()).collect();
    assert_eq!(ids, vec!["m4", "m5"]);
}

/// Ticket 03b fixture: turns 0..6, each a user row then an agent row
/// (`u{turn}` / `a{turn}`), one minute apart from 2026-10-08T00:00Z,
/// plus an internal row inside turn 3 that no window may show.
async fn seed_window_transcript(pool: &SqlitePool) {
    seed_session(pool, "sess_w", "w", "idle", "2026-10-08T00:00:00Z").await;
    seed_session(pool, "sess_other", "o", "idle", "2026-10-08T00:00:00Z").await;
    for turn in 0..6 {
        for (seq, role, prefix) in [(0, "user", "u"), (1, "assistant", "a")] {
            let minute = turn * 2 + seq;
            seed_message(
                pool,
                &format!("{prefix}{turn}"),
                "sess_w",
                turn,
                seq,
                role,
                &format!("{prefix}{turn} body"),
                &format!("2026-10-08T00:{minute:02}:00+00:00"),
            )
            .await;
        }
    }
    seed_message(
        pool,
        "internal3",
        "sess_w",
        3,
        2,
        "assistant",
        "internal",
        "2026-10-08T00:07:30+00:00",
    )
    .await;
    sqlx::query("UPDATE messages SET visibility = 'internal' WHERE id = 'internal3'")
        .execute(pool)
        .await
        .expect("mark internal");
    seed_message(
        pool,
        "o1",
        "sess_other",
        0,
        0,
        "user",
        "other",
        "2026-10-08T00:00:00+00:00",
    )
    .await;
}

fn window_ids(msgs: &[galley_core_lib::api::MessageBrief]) -> Vec<&str> {
    msgs.iter().map(|m| m.id.0.as_str()).collect()
}

async fn around(
    galley: &SqliteGalley,
    message_id: &str,
    context: usize,
) -> galley_core_lib::error::Result<Vec<galley_core_lib::api::MessageBrief>> {
    galley
        .session_messages_window(
            SessionId("sess_w".into()),
            MessageWindow::Around {
                message_id: MessageId(message_id.into()),
                context,
            },
        )
        .await
}

#[tokio::test]
async fn session_messages_around_reads_both_sides_in_transcript_order() {
    let pool = fresh_pool().await;
    seed_window_transcript(&pool).await;
    let galley = SqliteGalley::from_pool(pool);

    // Middle: two visible rows each side; the internal row is skipped.
    let msgs = around(&galley, "u3", 2).await.expect("around u3");
    assert_eq!(window_ids(&msgs), vec!["u2", "a2", "u3", "a3", "u4"]);
    let msgs = around(&galley, "a3", 1).await.expect("around a3");
    assert_eq!(window_ids(&msgs), vec!["u3", "a3", "u4"]);
    // Near the start and the end: the window is cut short, not shifted.
    let msgs = around(&galley, "a0", 3).await.expect("around a0");
    assert_eq!(window_ids(&msgs), vec!["u0", "a0", "u1", "a1", "u2"]);
    let msgs = around(&galley, "a5", 2).await.expect("around a5");
    assert_eq!(window_ids(&msgs), vec!["a4", "u5", "a5"]);
    // Zero context: the message alone; a huge one: the whole transcript.
    let msgs = around(&galley, "u4", 0).await.expect("around u4");
    assert_eq!(window_ids(&msgs), vec!["u4"]);
    let all = around(&galley, "u4", usize::MAX).await.expect("around all");
    let full = galley
        .session_messages(SessionId("sess_w".into()), None)
        .await
        .expect("full");
    assert_eq!(window_ids(&all), window_ids(&full));
    assert_eq!(all.len(), 12);
    // Fields are the full MessageBrief projection.
    assert_eq!(all[1].role, galley_core_lib::api::MessageRole::Agent);
    assert_eq!(all[1].turn_index, Some(0));
    assert_eq!(all[1].created_at, "2026-10-08T00:01:00+00:00");

    // Not a visible message of this session: not_found.
    for missing in ["nope", "internal3", "o1"] {
        let err = around(&galley, missing, 2).await.unwrap_err();
        assert!(
            matches!(err, galley_core_lib::error::GalleyError::NotFound { .. }),
            "{missing}: {err:?}"
        );
    }
}

async fn between(
    galley: &SqliteGalley,
    since: Option<&str>,
    until: Option<&str>,
    tail: Option<usize>,
) -> Vec<String> {
    let parse = |s: &str| {
        chrono::DateTime::parse_from_rfc3339(s)
            .unwrap()
            .with_timezone(&chrono::Utc)
    };
    let window = MessageWindow::between(since.map(parse), until.map(parse), tail).expect("window");
    galley
        .session_messages_window(SessionId("sess_w".into()), window)
        .await
        .expect("between")
        .into_iter()
        .map(|m| m.id.0)
        .collect()
}

#[tokio::test]
async fn session_messages_between_is_half_open_and_reads_every_time_format() {
    let pool = fresh_pool().await;
    seed_window_transcript(&pool).await;
    // Rows written by other writers over the years: a JS `toISOString`
    // value and a local offset. Both are instants like the rest.
    sqlx::query("UPDATE messages SET created_at = '2026-10-08T00:04:00.000Z' WHERE id = 'u2'")
        .execute(&pool)
        .await
        .expect("z form");
    sqlx::query("UPDATE messages SET created_at = '2026-10-08T08:05:00+08:00' WHERE id = 'a2'")
        .execute(&pool)
        .await
        .expect("offset form");
    let galley = SqliteGalley::from_pool(pool);

    // since inclusive, until exclusive.
    assert_eq!(
        between(
            &galley,
            Some("2026-10-08T00:04:00Z"),
            Some("2026-10-08T00:07:00Z"),
            None
        )
        .await,
        vec!["u2", "a2", "u3"]
    );
    // Either bound alone.
    assert_eq!(
        between(&galley, Some("2026-10-08T00:10:00Z"), None, None).await,
        vec!["u5", "a5"]
    );
    assert_eq!(
        between(&galley, None, Some("2026-10-08T00:02:00Z"), None).await,
        vec!["u0", "a0"]
    );
    // --tail keeps the window's last rows, still oldest first.
    assert_eq!(
        between(&galley, Some("2026-10-08T00:00:00Z"), None, Some(3)).await,
        vec!["a4", "u5", "a5"]
    );
    // A window nothing was written in is empty, not an error.
    assert!(between(
        &galley,
        Some("2026-10-09T00:00:00Z"),
        Some("2026-10-10T00:00:00Z"),
        None
    )
    .await
    .is_empty());
    // An unknown session reads as empty, like `session show`.
    let none = galley
        .session_messages_window(
            SessionId("sess_missing".into()),
            MessageWindow::between(None, None, None).expect("window"),
        )
        .await
        .expect("missing session");
    assert!(none.is_empty());
}

#[tokio::test]
async fn search_hits_carry_time_role_and_turn_and_filter_by_session() {
    let pool = fresh_pool().await;
    seed_window_transcript(&pool).await;
    seed_message(
        &pool,
        "o2",
        "sess_other",
        1,
        0,
        "user",
        "a3 body elsewhere",
        "2026-10-09T00:00:00+00:00",
    )
    .await;
    let galley = SqliteGalley::from_pool(pool);

    // FTS path (>= 3 chars).
    let hits = galley
        .search_messages("a3 body".into(), SearchScope::All, None, None)
        .await
        .expect("fts");
    let mut found: Vec<(&str, &str)> = hits
        .iter()
        .map(|h| (h.session_id.0.as_str(), h.message_id.0.as_str()))
        .collect();
    found.sort();
    assert_eq!(found, vec![("sess_other", "o2"), ("sess_w", "a3")]);
    let a3 = hits.iter().find(|h| h.message_id.0 == "a3").unwrap();
    assert_eq!(a3.role, galley_core_lib::api::MessageRole::Agent);
    assert_eq!(a3.turn_index, 3);
    assert_eq!(a3.created_at, "2026-10-08T00:07:00+00:00");

    let only_w = galley
        .search_messages(
            "a3 body".into(),
            SearchScope::All,
            None,
            Some(SessionId("sess_w".into())),
        )
        .await
        .expect("fts in session");
    assert_eq!(only_w.len(), 1);
    assert_eq!(only_w[0].message_id.0, "a3");

    // LIKE path (2 chars): same fields, same filter.
    let like = galley
        .search_messages(
            "u4".into(),
            SearchScope::All,
            None,
            Some(SessionId("sess_w".into())),
        )
        .await
        .expect("like in session");
    assert_eq!(like.len(), 1);
    assert_eq!(like[0].role, galley_core_lib::api::MessageRole::User);
    assert_eq!(like[0].turn_index, 4);
    assert_eq!(like[0].created_at, "2026-10-08T00:08:00+00:00");
    assert!(galley
        .search_messages(
            "u4".into(),
            SearchScope::All,
            None,
            Some(SessionId("sess_other".into())),
        )
        .await
        .expect("like elsewhere")
        .is_empty());
}

#[tokio::test]
async fn search_messages_short_query_returns_empty() {
    let pool = fresh_pool().await;
    seed_session(&pool, "sess_x", "x", "idle", "2026-05-18T00:00:00Z").await;
    seed_message(
        &pool,
        "m1",
        "sess_x",
        1,
        0,
        "user",
        "anything",
        "2026-05-18T00:00:00Z",
    )
    .await;

    let galley = SqliteGalley::from_pool(pool);
    assert!(galley
        .search_messages("a".into(), SearchScope::default(), None, None)
        .await
        .expect("search 1-char")
        .is_empty());
}

#[tokio::test]
async fn search_messages_runtime_filter_limits_fts_and_like() {
    let pool = fresh_pool().await;
    seed_session_with_runtime(
        &pool,
        "sess_managed",
        "managed",
        "idle",
        "2026-05-18T00:00:00Z",
        "managed",
    )
    .await;
    seed_session_with_runtime(
        &pool,
        "sess_external",
        "external",
        "idle",
        "2026-05-18T00:00:01Z",
        "external",
    )
    .await;
    seed_message(
        &pool,
        "m1",
        "sess_managed",
        1,
        0,
        "user",
        "sharedtoken 兔子",
        "2026-05-18T00:00:00Z",
    )
    .await;
    seed_message(
        &pool,
        "m2",
        "sess_external",
        1,
        0,
        "user",
        "sharedtoken 兔子",
        "2026-05-18T00:00:01Z",
    )
    .await;

    let galley = SqliteGalley::from_pool(pool);
    let managed_hits = galley
        .search_messages(
            "sharedtoken".into(),
            SearchScope::Active,
            Some(RuntimeKind::Managed),
            None,
        )
        .await
        .expect("managed fts search");
    assert_eq!(managed_hits.len(), 1);
    assert_eq!(managed_hits[0].session_id.0, "sess_managed");

    let external_hits = galley
        .search_messages(
            "sharedtoken".into(),
            SearchScope::Active,
            Some(RuntimeKind::External),
            None,
        )
        .await
        .expect("external fts search");
    assert_eq!(external_hits.len(), 1);
    assert_eq!(external_hits[0].session_id.0, "sess_external");

    let all_runtime_hits = galley
        .search_messages("sharedtoken".into(), SearchScope::Active, None, None)
        .await
        .expect("all-runtime fts search");
    assert_eq!(all_runtime_hits.len(), 2);

    let managed_like_hits = galley
        .search_messages(
            "兔子".into(),
            SearchScope::Active,
            Some(RuntimeKind::Managed),
            None,
        )
        .await
        .expect("managed like search");
    assert_eq!(managed_like_hits.len(), 1);
    assert_eq!(managed_like_hits[0].session_id.0, "sess_managed");
}

#[tokio::test]
async fn search_messages_fts_finds_hit() {
    let pool = fresh_pool().await;
    seed_session(&pool, "sess_x", "x", "idle", "2026-05-18T00:00:00Z").await;
    seed_message(
        &pool,
        "m1",
        "sess_x",
        1,
        0,
        "user",
        "the quick brown fox",
        "2026-05-18T00:00:00Z",
    )
    .await;
    seed_message(
        &pool,
        "m2",
        "sess_x",
        2,
        0,
        "user",
        "elephants are slow",
        "2026-05-18T00:00:01Z",
    )
    .await;

    let galley = SqliteGalley::from_pool(pool);
    let hits = galley
        .search_messages("quick".into(), SearchScope::default(), None, None)
        .await
        .expect("search");

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].message_id.0, "m1");
    // snippet wraps the hit token in <mark>…</mark>.
    assert!(hits[0].snippet.contains("<mark>"));
}

#[tokio::test]
async fn backfill_fts_rebuilds_full_index_in_batches() {
    let pool = fresh_pool().await;
    seed_session(&pool, "sess_bf", "bf", "idle", "2026-07-04T00:00:00Z").await;

    // Seed 2003 raw message rows (no FTS mirror) in one tx: 2000
    // indexable user/assistant turns — enough to force multiple
    // 500-row backfill batches — plus three rows the backfill must
    // skip (internal visibility, tool role, blank body).
    let mut tx = pool.begin().await.expect("begin seed tx");
    for i in 0..2000 {
        let id = format!("m{i:05}");
        let (role, content, final_answer) = if i % 2 == 0 {
            ("user", format!("user says token{i:05}"), None)
        } else {
            (
                "assistant",
                "raw <thinking> noise".to_string(),
                Some(format!("answer token{i:05}")),
            )
        };
        sqlx::query(
            "INSERT INTO messages \
               (id, session_id, turn_index, sequence, role, content, final_answer, created_at) \
             VALUES (?, 'sess_bf', ?, 0, ?, ?, ?, '2026-07-04T00:00:00Z')",
        )
        .bind(&id)
        .bind(i)
        .bind(role)
        .bind(&content)
        .bind(&final_answer)
        .execute(&mut *tx)
        .await
        .expect("seed message");
    }
    for (id, role, content, visibility) in [
        ("mz-internal", "user", "internal text", "internal"),
        ("mz-tool", "tool", "tool output", "visible"),
        ("mz-blank", "user", "   ", "visible"),
    ] {
        sqlx::query(
            "INSERT INTO messages \
               (id, session_id, turn_index, sequence, role, content, visibility, created_at) \
             VALUES (?, 'sess_bf', 9000, 0, ?, ?, ?, '2026-07-04T00:00:00Z')",
        )
        .bind(id)
        .bind(role)
        .bind(content)
        .bind(visibility)
        .execute(&mut *tx)
        .await
        .expect("seed skipped message");
    }
    tx.commit().await.expect("commit seed tx");

    let galley = SqliteGalley::from_pool(pool.clone());

    // FTS starts empty → full rebuild.
    let inserted = galley.backfill_fts_if_empty().await.expect("backfill");
    assert_eq!(inserted, 2000);
    let fts_cnt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages_fts")
        .fetch_one(&pool)
        .await
        .expect("count fts");
    assert_eq!(fts_cnt, 2000);
    // Assistant rows index final_answer, never raw content.
    let body: String =
        sqlx::query_scalar("SELECT body FROM messages_fts WHERE message_id = 'm00001'")
            .fetch_one(&pool)
            .await
            .expect("assistant body");
    assert_eq!(body, "answer token00001");

    // Converged: counts match, so a second call is a no-op.
    assert_eq!(galley.backfill_fts_if_empty().await.expect("noop"), 0);

    // Simulate a crash mid-rebuild / index corruption: wipe the index
    // and leave one stale row for a message that no longer exists.
    // The re-run must reconstruct everything and drop the stale row.
    sqlx::query("DELETE FROM messages_fts")
        .execute(&pool)
        .await
        .expect("truncate fts");
    sqlx::query(
        "INSERT INTO messages_fts (message_id, session_id, role, turn_index, body) \
         VALUES ('mz-stale', 'sess_bf', 'user', 0, 'stale ghost row')",
    )
    .execute(&pool)
    .await
    .expect("seed stale fts row");

    assert_eq!(galley.backfill_fts_if_empty().await.expect("rebuild"), 2000);
    let fts_cnt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM messages_fts")
        .fetch_one(&pool)
        .await
        .expect("count rebuilt fts");
    assert_eq!(fts_cnt, 2000);

    // A hit on the last id proves keyset pagination walked the whole
    // keyspace, not just the first batch.
    let hits = galley
        .search_messages("token01999".into(), SearchScope::default(), None, None)
        .await
        .expect("search last batch");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].message_id.0, "m01999");
}

#[tokio::test]
async fn gui_search_message_hits_runtime_filter_limits_fts_and_like() {
    let pool = fresh_pool().await;
    seed_session_with_runtime(
        &pool,
        "sess_managed",
        "managed",
        "idle",
        "2026-05-18T00:00:00Z",
        "managed",
    )
    .await;
    seed_session_with_runtime(
        &pool,
        "sess_external",
        "external",
        "idle",
        "2026-05-18T00:00:01Z",
        "external",
    )
    .await;
    seed_message(
        &pool,
        "m1",
        "sess_managed",
        1,
        0,
        "user",
        "guitoken 猫猫",
        "2026-05-18T00:00:00Z",
    )
    .await;
    seed_message(
        &pool,
        "m2",
        "sess_external",
        1,
        0,
        "user",
        "guitoken 猫猫",
        "2026-05-18T00:00:01Z",
    )
    .await;

    let galley = SqliteGalley::from_pool(pool);
    let managed_hits = galley
        .search_message_hits("guitoken".into(), 20, Some(RuntimeKind::Managed))
        .await
        .expect("managed gui fts search");
    assert_eq!(managed_hits.len(), 1);
    assert_eq!(managed_hits[0].session_id, "sess_managed");

    let external_hits = galley
        .search_message_hits("guitoken".into(), 20, Some(RuntimeKind::External))
        .await
        .expect("external gui fts search");
    assert_eq!(external_hits.len(), 1);
    assert_eq!(external_hits[0].session_id, "sess_external");

    let all_runtime_hits = galley
        .search_message_hits("guitoken".into(), 20, None)
        .await
        .expect("all-runtime gui fts search");
    assert_eq!(all_runtime_hits.len(), 2);

    let managed_like_hits = galley
        .search_message_hits("猫猫".into(), 20, Some(RuntimeKind::Managed))
        .await
        .expect("managed gui like search");
    assert_eq!(managed_like_hits.len(), 1);
    assert_eq!(managed_like_hits[0].session_id, "sess_managed");
}

#[tokio::test]
async fn search_messages_active_scope_excludes_archived() {
    let pool = fresh_pool().await;
    seed_session(&pool, "sess_live", "live", "idle", "2026-05-18T00:00:00Z").await;
    seed_session(
        &pool,
        "sess_arch",
        "archived",
        "archived",
        "2026-05-15T00:00:00Z",
    )
    .await;
    seed_message(
        &pool,
        "m1",
        "sess_live",
        1,
        0,
        "user",
        "needle",
        "2026-05-18T00:00:00Z",
    )
    .await;
    seed_message(
        &pool,
        "m2",
        "sess_arch",
        1,
        0,
        "user",
        "needle",
        "2026-05-15T00:00:00Z",
    )
    .await;

    let galley = SqliteGalley::from_pool(pool);
    let active_hits = galley
        .search_messages("needle".into(), SearchScope::Active, None, None)
        .await
        .expect("search active");
    assert_eq!(active_hits.len(), 1);
    assert_eq!(active_hits[0].message_id.0, "m1");

    let all_hits = galley
        .search_messages("needle".into(), SearchScope::All, None, None)
        .await
        .expect("search all");
    assert_eq!(all_hits.len(), 2);
}

#[tokio::test]
async fn status_counts_non_archived_sessions() {
    let pool = fresh_pool().await;
    seed_session(&pool, "a", "a", "idle", "2026-05-18T00:00:00Z").await;
    seed_session(&pool, "b", "b", "running", "2026-05-18T00:00:01Z").await;
    seed_session(&pool, "c", "c", "completed", "2026-05-18T00:00:02Z").await;
    seed_session(&pool, "d", "d", "archived", "2026-05-18T00:00:03Z").await;

    let galley = SqliteGalley::from_pool(pool);
    let s = galley.status().await.expect("status");
    assert_eq!(s.total, 3);
    assert_eq!(s.running, 1);
    assert_eq!(s.waiting_input, 0);
    assert_eq!(s.errored, 0);
}

#[tokio::test]
async fn health_reports_db_readable_and_deferred_probes() {
    let pool = fresh_pool().await;
    let galley = SqliteGalley::from_pool(pool);
    let report = galley.health().await.expect("health");
    // 5 check ids, exact list depends on env. Just assert presence
    // of the SQLite-checkable ones + deferred B4 markers.
    let ids: Vec<&str> = report.checks.iter().map(|c| c.id.as_str()).collect();
    assert!(ids.contains(&"db_readable"));
    assert!(ids.contains(&"ga_path"));
    assert!(ids.contains(&"mykey_py"));
    assert!(ids.contains(&"agentmain_import"));
    assert!(ids.contains(&"llm_session_init"));
}
