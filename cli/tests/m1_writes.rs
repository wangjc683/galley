//! Integration tests for the B4 M1 write surface — `session new` /
//! `session btw` / `session stop` / `session archive` / `session
//! restore` / `session move` / `project create` / `project list` /
//! `project delete` / `llm list` / `llm set`.
//!
//! Strategy mirrors the existing `cli_test.rs`:
//!
//! 1. Socket-backed write commands assert the cheap "Galley Core not
//!    running → exit 4 db_unavailable" path. Full happy-path coverage
//!    for these would require spinning up a real socket server in-test
//!    (no AppHandle available outside Tauri), and the underlying trait
//!    method behaviour is already covered by `core/tests/db_writes_test`
//!    and `core/tests/db_test.rs`. The atomicity invariant for
//!    `session.new` (sub-plan O1) is similarly covered by the three
//!    `tx_*` tests in `db_writes_test.rs` — those exercise
//!    `create_session_in_tx` + `send_message_in_tx` + commit/rollback
//!    directly. The integration layer's job here is to prove the CLI
//!    surface reaches the socket and reports the right exit code; the
//!    handler logic doesn't need re-testing through the binary.
//!
//! 2. Direct-SQLite read commands (`project list/brief/show`, `llm list`)
//!    and hybrid follow snapshot fallbacks get full happy / empty /
//!    shape-error coverage because they don't need a server for the
//!    persisted state.

use std::path::PathBuf;
use std::process::{Command, Stdio};

use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;
use tempfile::TempDir;

const MIG_001: &str = include_str!("../../core/migrations/001_init.sql");
const MIG_002: &str = include_str!("../../core/migrations/002_add_has_unread.sql");
const MIG_003: &str = include_str!("../../core/migrations/003_add_message_summary.sql");
const MIG_004: &str = include_str!("../../core/migrations/004_add_messages_fts.sql");
const MIG_005: &str = include_str!("../../core/migrations/005_add_message_preamble.sql");
const MIG_006: &str = include_str!("../../core/migrations/006_messages_origin.sql");
const MIG_007: &str = include_str!("../../core/migrations/007_sessions_origin.sql");
const MIG_008: &str = include_str!("../../core/migrations/008_runtime_identity.sql");
const MIG_009: &str = include_str!("../../core/migrations/009_managed_models.sql");
const MIG_010: &str = include_str!("../../core/migrations/010_managed_model_providers.sql");
const MIG_011: &str = include_str!("../../core/migrations/011_managed_model_sort_order.sql");
const MIG_012: &str = include_str!("../../core/migrations/012_managed_model_local_secrets.sql");
const MIG_013: &str = include_str!("../../core/migrations/013_session_llm_key.sql");
const MIG_014: &str = include_str!("../../core/migrations/014_managed_model_auth_kind.sql");
const MIG_015: &str = include_str!("../../core/migrations/015_goal_v1.sql");
const MIG_016: &str = include_str!("../../core/migrations/016_goal_master_session.sql");
const MIG_017: &str = include_str!("../../core/migrations/017_message_visibility.sql");
const MIG_018: &str = include_str!("../../core/migrations/018_goal_deliverable.sql");
const MIG_019: &str = include_str!("../../core/migrations/019_goal_workspace.sql");
const MIG_020: &str = include_str!("../../core/migrations/020_message_attachments.sql");
const MIG_021: &str = include_str!("../../core/migrations/021_native_session_runtime.sql");
const MIG_022: &str = include_str!("../../core/migrations/022_native_memory_substrate.sql");
const MIG_023: &str = include_str!("../../core/migrations/023_native_goal_runtime.sql");
const MIG_024: &str = include_str!("../../core/migrations/024_native_default_runtime.sql");
const MIG_025: &str = include_str!("../../core/migrations/025_restore_managed_runtime_default.sql");
const MIG_026: &str = include_str!("../../core/migrations/026_project_workspace.sql");
// 032 only ADD COLUMN mode to goal_proposals/goals (both exist since 015), so
// it applies cleanly on top of this harness's 026 baseline; 027–031 touch
// unrelated tables and stay out of this fixture.
const MIG_032: &str = include_str!("../../core/migrations/032_goal_mode.sql");
// 034 only ADD COLUMN approval_mode to sessions — required since
// SESSIONS_SELECT_COLS reads it.
const MIG_034: &str = include_str!("../../core/migrations/034_session_approval_mode.sql");

async fn seeded_db_at(path: &std::path::Path) -> SqlitePool {
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = SqlitePool::connect_with(opts).await.expect("open db");
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_032, MIG_034,
    ] {
        sqlx::raw_sql(sql)
            .execute(&pool)
            .await
            .expect("run migration");
    }
    pool
}

async fn seed_project(pool: &SqlitePool, id: &str, name: &str, ts: &str) {
    sqlx::query(
        "INSERT INTO projects (id, name, pinned, last_activity_at, created_at, updated_at) \
         VALUES (?, ?, 0, ?, ?, ?)",
    )
    .bind(id)
    .bind(name)
    .bind(ts)
    .bind(ts)
    .bind(ts)
    .execute(pool)
    .await
    .expect("seed project");
}

async fn seed_project_session(
    pool: &SqlitePool,
    id: &str,
    project_id: &str,
    title: &str,
    status: &str,
    ts: &str,
) {
    sqlx::query(
        "INSERT INTO sessions (id, project_id, title, status, turn_count, \
            pending_approval_count, error_count, pinned, last_activity_at, \
            created_at, updated_at, ga_runtime_kind) \
         VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, 'managed')",
    )
    .bind(id)
    .bind(project_id)
    .bind(title)
    .bind(status)
    .bind(ts)
    .bind(ts)
    .bind(ts)
    .execute(pool)
    .await
    .expect("seed project session");
}

async fn seed_message(
    pool: &SqlitePool,
    id: &str,
    session_id: &str,
    turn_index: i64,
    sequence: i64,
    role: &str,
    content: &str,
) {
    sqlx::query(
        "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, '2026-05-20T00:00:00Z')",
    )
    .bind(id)
    .bind(session_id)
    .bind(turn_index)
    .bind(sequence)
    .bind(role)
    .bind(content)
    .execute(pool)
    .await
    .expect("seed message");
}

async fn seed_pref(pool: &SqlitePool, key: &str, value_json: &str) {
    // `updated_at` is NOT NULL per migration 001 — use a fixed ts so
    // tests are deterministic.
    sqlx::query("INSERT INTO prefs (key, value, updated_at) VALUES (?, ?, ?)")
        .bind(key)
        .bind(value_json)
        .bind("2026-05-20T00:00:00Z")
        .execute(pool)
        .await
        .expect("seed pref");
}

/// Run the CLI with the socket path namespaced to a tempdir, so no live
/// Galley Core on the developer's machine accidentally answers the
/// "no Core running" tests.
fn run_galley_isolated(
    db: &std::path::Path,
    tmp: &std::path::Path,
    args: &[&str],
) -> (String, Option<i32>) {
    let bin = PathBuf::from(env!("CARGO_BIN_EXE_galley"));
    let out = Command::new(&bin)
        .args(args)
        .env("GALLEY_DB_PATH", db)
        .env("TMPDIR", tmp)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("spawn galley");
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    (stdout, out.status.code())
}

fn tempdir() -> TempDir {
    tempfile::Builder::new()
        .prefix("galley-m1-test-")
        .tempdir()
        .expect("create tempdir")
}

// ---------------- session.* write commands (socket) ----------------

#[tokio::test]
async fn session_new_without_core_exits_4() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(&db, td.path(), &["session", "new", "first task"]);
    assert_eq!(code, Some(4), "stdout: {stdout}");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(parsed["error"], "db_unavailable");
}

#[tokio::test]
async fn session_new_passes_through_optional_flags() {
    // Same exit-4 path as above, but verifies clap accepts the full
    // flag set without parser errors. If clap rejected an arg the CLI
    // would exit 2 + emit a parser error, not exit 4.
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(
        &db,
        td.path(),
        &[
            "session",
            "new",
            "investigate",
            "--project",
            "proj_demo",
            "--llm",
            "glm-4.5-x",
            "--runtime",
            "external",
            "--supervisor",
            "ga-claude-1",
            "--reason",
            "weekly review",
        ],
    );
    assert_eq!(code, Some(4), "stdout: {stdout}");
}

#[tokio::test]
async fn session_new_rejects_runtime_all() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(
        &db,
        td.path(),
        &["session", "new", "investigate", "--runtime", "all"],
    );
    assert_eq!(code, Some(2), "stdout: {stdout}");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(parsed["error"], "invalid_args");
}

#[tokio::test]
async fn session_btw_without_core_exits_4() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) =
        run_galley_isolated(&db, td.path(), &["session", "btw", "sess_x", "ping?"]);
    assert_eq!(code, Some(4), "stdout: {stdout}");
}

#[tokio::test]
async fn session_stop_without_core_exits_4() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(&db, td.path(), &["session", "stop", "sess_x"]);
    assert_eq!(code, Some(4), "stdout: {stdout}");
}

#[tokio::test]
async fn session_archive_without_core_exits_4() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(&db, td.path(), &["session", "archive", "sess_x"]);
    assert_eq!(code, Some(4), "stdout: {stdout}");
}

#[tokio::test]
async fn session_restore_without_core_exits_4() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(&db, td.path(), &["session", "restore", "sess_x"]);
    assert_eq!(code, Some(4), "stdout: {stdout}");
}

#[tokio::test]
async fn session_move_accepts_no_to_flag() {
    // `session move <id>` without `--to` is the "detach" form per
    // sub-plan O3 — the CLI must accept it and reach the socket
    // (where it'd be processed). Asserting exit 4 proves clap
    // didn't reject the omitted flag.
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(&db, td.path(), &["session", "move", "sess_x"]);
    assert_eq!(code, Some(4), "stdout: {stdout}");
}

#[tokio::test]
async fn session_move_accepts_to_flag() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(
        &db,
        td.path(),
        &["session", "move", "sess_x", "--to", "proj_demo"],
    );
    assert_eq!(code, Some(4), "stdout: {stdout}");
}

// ---------------- project.* (mixed: socket writes + SQLite reads) ----------------

#[tokio::test]
async fn project_create_without_core_exits_4() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(
        &db,
        td.path(),
        &["project", "create", "MyApp refactor", "--root-path", "/x"],
    );
    assert_eq!(code, Some(4), "stdout: {stdout}");
}

#[tokio::test]
async fn project_create_enable_workspace_requires_root_path() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(
        &db,
        td.path(),
        &["project", "create", "MyApp refactor", "--enable-workspace"],
    );
    assert_eq!(code, Some(2), "stdout: {stdout}");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(parsed["error"], "invalid_args");
    assert_eq!(parsed["message"], "--enable-workspace requires --root-path");
}

#[tokio::test]
async fn project_delete_without_core_exits_4() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(&db, td.path(), &["project", "delete", "proj_demo"]);
    assert_eq!(code, Some(4), "stdout: {stdout}");
}

#[tokio::test]
async fn project_list_happy_path_ndjson() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_project(&pool, "proj_a", "Alpha", "2026-05-15T00:00:00Z").await;
    seed_project(&pool, "proj_b", "Beta", "2026-05-18T00:00:00Z").await;
    drop(pool);

    let (stdout, code) = run_galley_isolated(&db, td.path(), &["project", "list"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let lines: Vec<&str> = stdout.trim().lines().collect();
    assert_eq!(lines.len(), 2);
    // Sort order: pinned DESC, last_activity_at DESC. Neither is pinned,
    // so most-recently-active first.
    let first: serde_json::Value = serde_json::from_str(lines[0]).expect("ndjson line 1");
    assert_eq!(first["id"], "proj_b");
}

#[tokio::test]
async fn project_list_empty_db_returns_empty_stdout() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(&db, td.path(), &["project", "list"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    assert!(
        stdout.trim().is_empty(),
        "expected empty stdout, got: {stdout}"
    );
}

#[tokio::test]
async fn project_list_db_unavailable_exits_4() {
    let td = tempdir();
    // Don't create the DB file. `project list` opens SqliteGalley
    // directly (no socket), so a missing file surfaces as exit 4.
    let db = td.path().join("nonexistent.db");
    let (stdout, code) = run_galley_isolated(&db, td.path(), &["project", "list"]);
    assert_eq!(code, Some(4), "stdout: {stdout}");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(parsed["error"], "db_unavailable");
}

#[tokio::test]
async fn project_brief_counts_active_sessions_and_running_subset() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_project(&pool, "proj_batch", "Release check", "2026-05-20T00:00:00Z").await;
    seed_project_session(
        &pool,
        "s_running",
        "proj_batch",
        "Packaging",
        "running",
        "2026-05-20T00:00:02Z",
    )
    .await;
    seed_project_session(
        &pool,
        "s_done",
        "proj_batch",
        "Data",
        "completed",
        "2026-05-20T00:00:01Z",
    )
    .await;
    seed_project_session(
        &pool,
        "s_archived",
        "proj_batch",
        "Old",
        "archived",
        "2026-05-20T00:00:03Z",
    )
    .await;
    drop(pool);

    let (stdout, code) = run_galley_isolated(&db, td.path(), &["project", "brief", "proj_batch"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(payload["schemaVersion"], 1);
    assert_eq!(payload["project"]["id"], "proj_batch");
    assert_eq!(payload["sessionCount"], 2);
    assert_eq!(payload["statusCounts"]["running"], 1);
    assert_eq!(payload["statusCounts"]["completed"], 1);
    assert_eq!(payload["statusCounts"].get("archived"), None);
    assert_eq!(payload["runningSessions"].as_array().unwrap().len(), 1);
    assert_eq!(payload["runningSessions"][0]["id"], "s_running");
}

#[tokio::test]
async fn project_show_includes_tail_messages_per_session() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_project(&pool, "proj_batch", "Release check", "2026-05-20T00:00:00Z").await;
    seed_project_session(
        &pool,
        "s_review",
        "proj_batch",
        "Review",
        "completed",
        "2026-05-20T00:00:02Z",
    )
    .await;
    seed_message(&pool, "m1", "s_review", 0, 0, "user", "first").await;
    seed_message(&pool, "m2", "s_review", 1, 0, "assistant", "second").await;
    drop(pool);

    let (stdout, code) = run_galley_isolated(
        &db,
        td.path(),
        &["project", "show", "proj_batch", "--tail", "1"],
    );
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(payload["schemaVersion"], 1);
    assert_eq!(payload["sessionCount"], 1);
    assert_eq!(payload["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(payload["sessions"][0]["session"]["id"], "s_review");
    let messages = payload["sessions"][0]["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["content"], "second");
}

#[tokio::test]
async fn session_follow_without_core_emits_snapshot_and_clean_end() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_project(&pool, "proj_batch", "Release check", "2026-05-20T00:00:00Z").await;
    seed_project_session(
        &pool,
        "s_review",
        "proj_batch",
        "Review",
        "completed",
        "2026-05-20T00:00:02Z",
    )
    .await;
    seed_message(&pool, "m1", "s_review", 0, 0, "user", "inspect").await;
    drop(pool);

    let (stdout, code) = run_galley_isolated(
        &db,
        td.path(),
        &["session", "follow", "s_review", "--tail", "1"],
    );
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let lines: Vec<&str> = stdout.trim().lines().collect();
    assert_eq!(lines.len(), 2, "stdout: {stdout}");
    let snapshot: serde_json::Value = serde_json::from_str(lines[0]).expect("snapshot json");
    assert_eq!(snapshot["stream"], "snapshot");
    assert_eq!(snapshot["phase"], "initial");
    assert_eq!(snapshot["session"]["id"], "s_review");
    assert_eq!(snapshot["messages"].as_array().unwrap().len(), 1);
    let end: serde_json::Value = serde_json::from_str(lines[1]).expect("end json");
    assert_eq!(end["stream"], "end");
    assert_eq!(end["reason"], "core_unavailable");
}

#[tokio::test]
async fn project_follow_without_live_sessions_ends_after_snapshot() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_project(&pool, "proj_batch", "Release check", "2026-05-20T00:00:00Z").await;
    seed_project_session(
        &pool,
        "s_idle",
        "proj_batch",
        "Idle",
        "idle",
        "2026-05-20T00:00:02Z",
    )
    .await;
    drop(pool);

    let (stdout, code) = run_galley_isolated(&db, td.path(), &["project", "follow", "proj_batch"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let lines: Vec<&str> = stdout.trim().lines().collect();
    assert_eq!(lines.len(), 2, "stdout: {stdout}");
    let snapshot: serde_json::Value = serde_json::from_str(lines[0]).expect("snapshot json");
    assert_eq!(snapshot["stream"], "snapshot");
    assert_eq!(snapshot["phase"], "initial");
    assert_eq!(snapshot["sessionCount"], 1);
    assert_eq!(snapshot["followState"]["mode"], "live");
    assert_eq!(snapshot["followState"]["state"], "checking_live_events");
    assert_eq!(snapshot["followState"]["watchedSessions"], 1);
    assert_eq!(snapshot["followState"]["activeStatusSessions"], 0);
    let end: serde_json::Value = serde_json::from_str(lines[1]).expect("end json");
    assert_eq!(end["stream"], "end");
    assert_eq!(end["reason"], "no_live_sessions");
}

#[tokio::test]
async fn project_follow_until_idle_final_show_emits_final_snapshot() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_project(&pool, "proj_batch", "Release check", "2026-05-20T00:00:00Z").await;
    seed_project_session(
        &pool,
        "s_idle",
        "proj_batch",
        "Idle",
        "idle",
        "2026-05-20T00:00:02Z",
    )
    .await;
    seed_message(&pool, "m1", "s_idle", 0, 0, "user", "inspect").await;
    drop(pool);

    let (stdout, code) = run_galley_isolated(
        &db,
        td.path(),
        &[
            "project",
            "follow",
            "proj_batch",
            "--tail",
            "1",
            "--until-idle",
            "--final-show",
        ],
    );
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let lines: Vec<&str> = stdout.trim().lines().collect();
    assert_eq!(lines.len(), 3, "stdout: {stdout}");

    let initial: serde_json::Value = serde_json::from_str(lines[0]).expect("initial json");
    assert_eq!(initial["stream"], "snapshot");
    assert_eq!(initial["phase"], "initial");
    assert_eq!(initial["followState"]["mode"], "until_idle");

    let final_snapshot: serde_json::Value =
        serde_json::from_str(lines[1]).expect("final snapshot json");
    assert_eq!(final_snapshot["stream"], "snapshot");
    assert_eq!(final_snapshot["phase"], "final");
    assert_eq!(
        final_snapshot["sessions"][0]["messages"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(final_snapshot["followState"]["mode"], "until_idle");

    let end: serde_json::Value = serde_json::from_str(lines[2]).expect("end json");
    assert_eq!(end["stream"], "end");
    assert_eq!(end["reason"], "no_live_sessions");
}

#[tokio::test]
async fn project_follow_running_session_without_core_marks_session_end() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_project(&pool, "proj_batch", "Release check", "2026-05-20T00:00:00Z").await;
    seed_project_session(
        &pool,
        "s_running",
        "proj_batch",
        "Running",
        "running",
        "2026-05-20T00:00:02Z",
    )
    .await;
    drop(pool);

    let (stdout, code) = run_galley_isolated(&db, td.path(), &["project", "follow", "proj_batch"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let lines: Vec<&str> = stdout.trim().lines().collect();
    assert_eq!(lines.len(), 4, "stdout: {stdout}");
    let session_end: serde_json::Value = serde_json::from_str(lines[1]).expect("session end json");
    assert_eq!(session_end["stream"], "sessionEnd");
    assert_eq!(session_end["sessionId"], "s_running");
    assert_eq!(session_end["reason"], "core_unavailable");
    let final_snapshot: serde_json::Value =
        serde_json::from_str(lines[2]).expect("final snapshot json");
    assert_eq!(final_snapshot["stream"], "snapshot");
    assert_eq!(final_snapshot["phase"], "final");
    let end: serde_json::Value = serde_json::from_str(lines[3]).expect("end json");
    assert_eq!(end["reason"], "all_live_sessions_ended");
}

// ---------------- goal.* (direct SQLite + socket-backed controller) ----------------

#[tokio::test]
async fn goal_propose_defaults_to_3_workers_30_minutes() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);

    let (stdout, code) = run_galley_isolated(
        &db,
        td.path(),
        &[
            "goal",
            "propose",
            "Improve Galley Goal V1",
            "--runtime",
            "managed",
        ],
    );
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(parsed["objective"], "Improve Galley Goal V1");
    assert_eq!(parsed["budgetSeconds"], 1800);
    assert_eq!(parsed["workerLimit"], 3);
    assert_eq!(parsed["runtimeKind"], "managed");
    assert_eq!(parsed["writeMode"], "autonomous");
    assert_eq!(parsed["confirmationPhrase"], "确认启动 Goal");
    assert!(parsed["internalConfirmToken"].as_str().is_some());
}

#[tokio::test]
async fn goal_propose_caps_workers_to_official_hive_max() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);

    let (stdout, code) = run_galley_isolated(
        &db,
        td.path(),
        &[
            "goal",
            "propose",
            "Scale Galley Goal safely",
            "--workers",
            "9",
        ],
    );
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(parsed["workerLimit"], 5);
}

#[tokio::test]
async fn goal_task_claim_is_atomic_at_cli_surface() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_project(
        &pool,
        "proj_goal",
        "Goal Project",
        "2026-06-04T00:00:00+00:00",
    )
    .await;
    seed_project_session(
        &pool,
        "s_worker",
        "proj_goal",
        "Worker",
        "idle",
        "2026-06-04T00:00:00+00:00",
    )
    .await;
    seed_project_session(
        &pool,
        "s_other",
        "proj_goal",
        "Other",
        "idle",
        "2026-06-04T00:00:00+00:00",
    )
    .await;
    sqlx::query(
        "INSERT INTO goals (
            id, proposal_id, project_id, master_session_id, objective, status, budget_seconds,
            worker_limit, runtime_kind, write_mode, started_at, deadline_at,
            result_seen_at, stop_requested, created_at, updated_at
         ) VALUES (
            'goal_test', NULL, 'proj_goal', NULL, 'Test atomic claim', 'running', 1800,
            3, 'managed', 'autonomous', '2026-06-04T00:00:00+00:00',
            '2026-06-04T00:30:00+00:00', NULL, 0, '2026-06-04T00:00:00+00:00',
            '2026-06-04T00:00:00+00:00'
         )",
    )
    .execute(&pool)
    .await
    .expect("seed goal");
    sqlx::query(
        "INSERT INTO goal_tasks (
            id, goal_id, title, status, created_at, updated_at
         ) VALUES (
            'gtask_test', 'goal_test', 'Atomic task', 'open',
            '2026-06-04T00:00:00+00:00', '2026-06-04T00:00:00+00:00'
         )",
    )
    .execute(&pool)
    .await
    .expect("seed task");
    drop(pool);

    let (stdout, code) = run_galley_isolated(
        &db,
        td.path(),
        &[
            "goal",
            "task",
            "claim",
            "gtask_test",
            "--owner-session",
            "s_worker",
            "--scope",
            "core",
        ],
    );
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let claimed: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(claimed["status"], "claimed");
    assert_eq!(claimed["ownerSessionId"], "s_worker");

    let (stdout, code) = run_galley_isolated(
        &db,
        td.path(),
        &[
            "goal",
            "task",
            "claim",
            "gtask_test",
            "--owner-session",
            "s_other",
        ],
    );
    assert_eq!(code, Some(2), "stdout: {stdout}");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(parsed["error"], "invalid_args");
}

// ---------------- llm.* (mixed: SQLite reads + socket writes) ----------------

#[tokio::test]
async fn llm_list_happy_path_ndjson() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    // Cache shape mirrors what hydrate.ts seeds: array of {index, name}.
    seed_pref(
        &pool,
        "llm_list",
        r#"[{"index":0,"name":"glm-4.5-x"},{"index":1,"name":"claude-opus-4-7"}]"#,
    )
    .await;
    drop(pool);

    let (stdout, code) = run_galley_isolated(&db, td.path(), &["llm", "list"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let lines: Vec<&str> = stdout.trim().lines().collect();
    assert_eq!(lines.len(), 2);
    let first: serde_json::Value = serde_json::from_str(lines[0]).expect("ndjson line 1");
    assert_eq!(first["index"], 0);
    assert_eq!(first["name"], "glm-4.5-x");
}

#[tokio::test]
async fn llm_list_empty_cache_returns_empty_stdout_exit_0() {
    // Cache miss is the documented "open the GUI once to warm up"
    // path — must return exit 0 with empty stdout, not an error.
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(&db, td.path(), &["llm", "list"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    assert!(
        stdout.trim().is_empty(),
        "expected empty stdout, got: {stdout}"
    );
}

#[tokio::test]
async fn llm_list_corrupt_cache_shape_exits_2() {
    // GUI's llm_list pref is always an array. If a future GUI rev
    // shipped a different shape, the CLI should surface that loudly
    // (exit 2) so SOPs can flag the schema drift instead of silently
    // truncating output.
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_pref(&pool, "llm_list", r#"{"oops":"not an array"}"#).await;
    drop(pool);

    let (stdout, code) = run_galley_isolated(&db, td.path(), &["llm", "list"]);
    assert_eq!(code, Some(2), "stdout: {stdout}");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(parsed["error"], "invalid_args");
}

#[tokio::test]
async fn llm_set_without_core_exits_4() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) =
        run_galley_isolated(&db, td.path(), &["llm", "set", "sess_x", "glm-4.5-x"]);
    assert_eq!(code, Some(4), "stdout: {stdout}");
}
