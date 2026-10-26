//! Integration tests for the `galley` CLI binary.
//!
//! Each test:
//!   1. Builds a fresh on-disk SQLite file in a tempdir (in-memory pools
//!      can't be shared between processes, so a file is required).
//!   2. Seeds rows via direct sqlx writes (matches core/tests/db_test.rs
//!      style — same migration SQL + seed helpers).
//!   3. Spawns `target/debug/galley <args>` with `GALLEY_DB_PATH`
//!      pointing at the temp file.
//!   4. Asserts stdout / exit code.
//!
//! Tests share `tokio` (for the setup helper) but the CLI binary
//! itself is invoked synchronously via `std::process::Command`.

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
const MIG_031: &str = include_str!("../../core/migrations/031_message_goal_id.sql");
// 034 only ADD COLUMN approval_mode to sessions; 027–033 touch unrelated
// tables and stay out of this fixture.
const MIG_034: &str = include_str!("../../core/migrations/034_session_approval_mode.sql");
// 040 only ADD COLUMN reasoning_effort to sessions — required since
// SESSIONS_SELECT_COLS reads it.
const MIG_040: &str = include_str!("../../core/migrations/040_session_reasoning_effort.sql");
const MIG_042: &str = include_str!("../../core/migrations/042_managed_model_advanced_layers.sql");
const MIG_043: &str = include_str!("../../core/migrations/043_message_session_client.sql");
const MIG_044: &str = include_str!("../../core/migrations/044_session_main_chat.sql");
const MIG_045: &str = include_str!("../../core/migrations/045_ledger_exclusions.sql");
const MIG_046: &str = include_str!("../../core/migrations/046_main_chat_segments.sql");
const MIG_047: &str = include_str!("../../core/migrations/047_drop_ledger_exclusions.sql");
const MIG_048: &str = include_str!("../../core/migrations/048_subtasks.sql");
const MIG_035: &str = include_str!("../../core/migrations/035_scheduled_tasks.sql");
const MIG_036: &str = include_str!("../../core/migrations/036_scheduled_tasks_monthly.sql");
const MIG_037: &str = include_str!("../../core/migrations/037_scheduled_tasks_llm.sql");
const MIG_049: &str = include_str!("../../core/migrations/049_scheduled_tasks_once_and_wake.sql");
const MIG_050: &str = include_str!("../../core/migrations/050_todos.sql");
const MIG_051: &str = include_str!("../../core/migrations/051_cancelled_by.sql");
const MIG_052: &str = include_str!("../../core/migrations/052_provider_auth_kind_none.sql");
const MIG_053: &str = include_str!("../../core/migrations/053_memos.sql");

/// Build a temp .db file with all migrations applied + (optionally)
/// seed rows. Returns the path; caller stashes it for the spawned
/// command via `GALLEY_DB_PATH`.
async fn seeded_db_at(path: &std::path::Path) -> SqlitePool {
    // `mode=rwc` so sqlx creates the file if missing.
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = SqlitePool::connect_with(opts).await.expect("open db");
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_031, MIG_034, MIG_035, MIG_036,
        MIG_037, MIG_040, MIG_042, MIG_043, MIG_044, MIG_045, MIG_046, MIG_047, MIG_048, MIG_049,
        MIG_050, MIG_051, MIG_052, MIG_053,
    ] {
        sqlx::raw_sql(sql)
            .execute(&pool)
            .await
            .expect("run migration");
    }
    pool
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

async fn seed_message(pool: &SqlitePool, id: &str, session_id: &str, content: &str) {
    sqlx::query(
        "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, created_at) \
         VALUES (?, ?, 1, 0, 'user', ?, '2026-05-18T00:00:00Z')",
    )
    .bind(id)
    .bind(session_id)
    .bind(content)
    .execute(pool)
    .await
    .expect("seed message");

    sqlx::query(
        "INSERT INTO messages_fts (message_id, session_id, role, turn_index, body) \
         VALUES (?, ?, 'user', 1, ?)",
    )
    .bind(id)
    .bind(session_id)
    .bind(content)
    .execute(pool)
    .await
    .expect("seed fts row");
}

async fn seed_message_with_role(
    pool: &SqlitePool,
    id: &str,
    session_id: &str,
    turn_index: i64,
    sequence: i64,
    role: &str,
    content: &str,
    final_answer: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, \
            final_answer, created_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, '2026-05-18T00:00:00Z')",
    )
    .bind(id)
    .bind(session_id)
    .bind(turn_index)
    .bind(sequence)
    .bind(role)
    .bind(content)
    .bind(final_answer)
    .execute(pool)
    .await
    .expect("seed message");

    let body = final_answer.unwrap_or(content);
    sqlx::query(
        "INSERT INTO messages_fts (message_id, session_id, role, turn_index, body) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(session_id)
    .bind(role)
    .bind(turn_index)
    .bind(body)
    .execute(pool)
    .await
    .expect("seed fts row");
}

/// Resolve the binary path. Cargo writes test binaries to
/// `target/<profile>/deps/...` but workspace bins land at
/// `target/<profile>/<name>`. `CARGO_BIN_EXE_galley` is set by Cargo
/// for the test-runner so we can locate the binary deterministically.
fn galley_bin() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_galley"))
}

fn run_galley(db_path: &std::path::Path, args: &[&str]) -> (String, Option<i32>) {
    let out = Command::new(galley_bin())
        .args(args)
        .env("GALLEY_DB_PATH", db_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("spawn galley");
    let stdout = String::from_utf8(out.stdout).expect("utf8 stdout");
    (stdout, out.status.code())
}

fn search_session_ids(stdout: &str) -> Vec<String> {
    let mut ids = stdout
        .trim()
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let payload: serde_json::Value = serde_json::from_str(line).expect("ndjson line");
            payload["sessionId"]
                .as_str()
                .expect("sessionId")
                .to_string()
        })
        .collect::<Vec<_>>();
    ids.sort();
    ids
}

fn assert_search_session_ids(stdout: &str, expected: &[&str]) {
    let expected = expected.iter().map(|id| id.to_string()).collect::<Vec<_>>();
    assert_eq!(search_session_ids(stdout), expected);
}

fn parse_ndjson(stdout: &str) -> Vec<serde_json::Value> {
    stdout
        .trim()
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).expect("ndjson line"))
        .collect()
}

#[tokio::test]
async fn version_subcommand_prints_schema_v3() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;
    let (stdout, code) = run_galley(&db, &["version"]);
    assert_eq!(code, Some(0));
    let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    // B4 M6 freeze: version output uses camelCase to align with the rest
    // of the wire format (sessions/projects/etc all camelCase). v3 since
    // Goal was removed (.scratch/remove-goal).
    assert_eq!(payload["schemaVersion"], 3);
    assert!(payload.get("galleyVersion").is_some());
}

#[tokio::test]
async fn schema_pins_1_2_and_3_pass_through_for_unchanged_commands() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;
    // An old SOP pinning `--schema=1` or `--schema=2` keeps working for
    // every command that survived unchanged; `--schema=3` is the current
    // pin.
    for pin in ["1", "2", "3"] {
        let (stdout, code) = run_galley(&db, &["--schema", pin, "version"]);
        assert_eq!(code, Some(0), "pin {pin}: stdout: {stdout}");
        let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
        assert_eq!(payload["schemaVersion"], 3);
    }
}

/// Goal was removed in schemaVersion 3 (2026-10-13): `galley goal …` is
/// an unknown subcommand under every pin — the parse-failure path, one
/// `invalid_args` envelope on stdout, exit 2 — not a schema mismatch.
#[tokio::test]
async fn the_goal_subcommands_are_gone_under_every_pin() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;
    for pin in [
        None,
        Some("--schema=1"),
        Some("--schema=2"),
        Some("--schema=3"),
    ] {
        for args in [&["goal", "start", "x", "y"][..], &["goal", "active"][..]] {
            let mut full: Vec<&str> = pin.into_iter().collect();
            full.extend_from_slice(args);
            let (stdout, code) = run_galley(&db, &full);
            assert_eq!(code, Some(2), "{full:?}: stdout: {stdout}");
            assert_eq!(stdout.trim().lines().count(), 1, "{full:?}: {stdout}");
            let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
            assert_eq!(payload["error"], "invalid_args", "{full:?}");
            let msg = payload["message"].as_str().expect("message string");
            assert!(!msg.starts_with("schema_mismatch:"), "{full:?}: {msg}");
            assert!(msg.contains("goal"), "{full:?}: {msg}");
        }
    }
}

#[tokio::test]
async fn schema_pin_mismatch_exits_2_invalid_args() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;
    // B4 M6: pinning to an unknown schema → exit 2 invalid_args with
    // `schema_mismatch:` prefix in the message. `4` is the first version
    // past the current one.
    for pin in ["4", "99"] {
        let (stdout, code) = run_galley(&db, &["--schema", pin, "version"]);
        assert_eq!(code, Some(2), "pin {pin}: stdout: {stdout}");
        let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
        assert_eq!(payload["error"], "invalid_args");
        let msg = payload["message"].as_str().expect("message string");
        assert!(
            msg.starts_with("schema_mismatch:"),
            "message should start with schema_mismatch: — got {msg}"
        );
    }
}

#[tokio::test]
async fn sessions_list_emits_ndjson_recent_first() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "old", "old", "idle", "2026-05-10T00:00:00Z").await;
    seed_session(&pool, "new", "new", "idle", "2026-05-18T00:00:00Z").await;
    drop(pool);

    let (stdout, code) = run_galley(&db, &["sessions", "list", "--runtime", "all"]);
    assert_eq!(code, Some(0));
    let lines: Vec<&str> = stdout.trim().lines().collect();
    assert_eq!(lines.len(), 2);
    // Each line is independently valid JSON (NDJSON contract).
    let first: serde_json::Value = serde_json::from_str(lines[0]).expect("ndjson line 1");
    let second: serde_json::Value = serde_json::from_str(lines[1]).expect("ndjson line 2");
    assert_eq!(first["id"], "new");
    assert_eq!(second["id"], "old");
}

/// Main chat ticket 06a: a subtask stays in the default `sessions list`
/// (the desktop sidebar hides it, the Agent API does not), and the
/// session JSON gains `parentSessionId` and `promoted` (additive, Rule 3)
/// with `origin.via: "subtask"`.
#[tokio::test]
async fn sessions_list_shows_subtasks_with_their_parent_and_promotion() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let pool = seeded_db_at(&db).await;
    for (id, ts) in [
        ("main", "2026-10-13T08:00:00Z"),
        ("sub-new", "2026-10-13T09:00:00Z"),
        ("sub-promoted", "2026-10-13T10:00:00Z"),
    ] {
        seed_session_with_runtime(&pool, id, id, "idle", ts, "managed").await;
    }
    sqlx::query(
        "UPDATE sessions SET parent_session_id = 'main', created_via = 'system', \
            created_by_supervisor = 'galley-subtask' \
         WHERE id IN ('sub-new', 'sub-promoted')",
    )
    .execute(&pool)
    .await
    .expect("subtasks");
    sqlx::query(
        "UPDATE sessions SET promoted_at = '2026-10-13T10:05:00Z' WHERE id = 'sub-promoted'",
    )
    .execute(&pool)
    .await
    .expect("promote");
    drop(pool);

    let (stdout, code) = run_galley(&db, &["sessions", "list"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let rows = parse_ndjson(&stdout);
    let ids: Vec<&str> = rows.iter().map(|r| r["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["sub-promoted", "sub-new", "main"]);
    assert_eq!(rows[0]["parentSessionId"], "main");
    assert_eq!(rows[0]["promoted"], true);
    assert_eq!(rows[0]["origin"], serde_json::json!({ "via": "subtask" }));
    assert_eq!(rows[1]["parentSessionId"], "main");
    assert!(rows[1].get("promoted").is_none(), "{}", rows[1]);
    assert!(rows[2].get("parentSessionId").is_none(), "{}", rows[2]);
    assert!(rows[2].get("promoted").is_none(), "{}", rows[2]);

    let (stdout, code) = run_galley(&db, &["session", "brief", "sub-new"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let brief: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    let session = brief.get("session").unwrap_or(&brief);
    assert_eq!(session["parentSessionId"], "main", "{brief}");
    assert_eq!(session["origin"]["via"], "subtask", "{brief}");
}

#[tokio::test]
async fn sessions_list_defaults_to_current_runtime() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let pool = seeded_db_at(&db).await;
    seed_session_with_runtime(
        &pool,
        "external",
        "external",
        "idle",
        "2026-05-18T00:00:00Z",
        "external",
    )
    .await;
    seed_session_with_runtime(
        &pool,
        "managed",
        "managed",
        "idle",
        "2026-05-19T00:00:00Z",
        "managed",
    )
    .await;
    drop(pool);

    let (stdout, code) = run_galley(&db, &["sessions", "list"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let lines: Vec<&str> = stdout.trim().lines().collect();
    assert_eq!(lines.len(), 1);
    let only: serde_json::Value = serde_json::from_str(lines[0]).expect("ndjson line");
    assert_eq!(only["id"], "managed");
    assert_eq!(only["runtimeKind"], "managed");

    let (stdout, code) = run_galley(&db, &["sessions", "list", "--runtime", "external"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let lines: Vec<&str> = stdout.trim().lines().collect();
    assert_eq!(lines.len(), 1);
    let only: serde_json::Value = serde_json::from_str(lines[0]).expect("ndjson line");
    assert_eq!(only["id"], "external");
    assert_eq!(only["runtimeKind"], "external");
}

#[tokio::test]
async fn sessions_search_defaults_to_current_runtime() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let pool = seeded_db_at(&db).await;
    seed_session_with_runtime(
        &pool,
        "external",
        "external",
        "idle",
        "2026-05-18T00:00:00Z",
        "external",
    )
    .await;
    seed_session_with_runtime(
        &pool,
        "managed",
        "managed",
        "idle",
        "2026-05-19T00:00:00Z",
        "managed",
    )
    .await;
    seed_session_with_runtime(
        &pool,
        "managed_archived",
        "managed archived",
        "archived",
        "2026-05-20T00:00:00Z",
        "managed",
    )
    .await;
    seed_message(&pool, "m_ext", "external", "sharedtoken").await;
    seed_message(&pool, "m_man", "managed", "sharedtoken").await;
    seed_message(&pool, "m_arch", "managed_archived", "sharedtoken").await;
    drop(pool);

    let (stdout, code) = run_galley(&db, &["sessions", "search", "sharedtoken"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    assert_search_session_ids(&stdout, &["managed"]);

    let (stdout, code) = run_galley(&db, &["sessions", "search", "sharedtoken", "--all"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    assert_search_session_ids(&stdout, &["managed", "managed_archived"]);

    let (stdout, code) = run_galley(
        &db,
        &["sessions", "search", "sharedtoken", "--runtime", "external"],
    );
    assert_eq!(code, Some(0), "stdout: {stdout}");
    assert_search_session_ids(&stdout, &["external"]);

    let (stdout, code) = run_galley(
        &db,
        &["sessions", "search", "sharedtoken", "--runtime", "all"],
    );
    assert_eq!(code, Some(0), "stdout: {stdout}");
    assert_search_session_ids(&stdout, &["external", "managed"]);

    let (stdout, code) = run_galley(
        &db,
        &[
            "sessions",
            "search",
            "sharedtoken",
            "--runtime",
            "all",
            "--all",
        ],
    );
    assert_eq!(code, Some(0), "stdout: {stdout}");
    assert_search_session_ids(&stdout, &["external", "managed", "managed_archived"]);
}

#[tokio::test]
async fn session_brief_missing_exits_3() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;
    let (stdout, code) = run_galley(&db, &["session", "brief", "sess_missing"]);
    assert_eq!(code, Some(3), "stdout was: {stdout}");
    let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(payload["error"], "not_found");
}

#[tokio::test]
async fn session_wait_completed_returns_final_payload() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "s_wait", "wait", "idle", "2026-05-18T00:00:00Z").await;
    seed_message_with_role(&pool, "m1", "s_wait", 1, 0, "user", "please work", None).await;
    seed_message_with_role(&pool, "m2", "s_wait", 1, 1, "assistant", "", Some("done")).await;
    drop(pool);

    let (stdout, code) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &[
            "session",
            "wait",
            "s_wait",
            "--timeout=1",
            "--poll=1",
            "--tail=5",
        ],
    );
    assert_eq!(code, Some(0), "stdout was: {stdout}");
    let lines = parse_ndjson(&stdout);
    assert_eq!(lines.len(), 3, "stdout was: {stdout}");
    assert_eq!(lines[0]["schemaVersion"], 3);
    assert_eq!(lines[0]["stream"], "wait");
    assert_eq!(lines[0]["phase"], "initial");
    assert_eq!(lines[1]["stream"], "wait");
    assert_eq!(lines[1]["phase"], "final");
    assert_eq!(lines[1]["status"], "completed");
    assert_eq!(lines[1]["session"]["id"], "s_wait");
    let messages = lines[1]["messages"].as_array().expect("messages array");
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[1]["role"], "agent");
    assert_eq!(messages[1]["finalAnswer"], "done");
    assert_eq!(lines[2]["stream"], "end");
    assert_eq!(lines[2]["reason"], "completed");
}

#[tokio::test]
async fn session_wait_timeout_returns_timed_out_exit_0() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let pool = seeded_db_at(&db).await;
    seed_session(
        &pool,
        "s_pending",
        "pending",
        "running",
        "2026-05-18T00:00:00Z",
    )
    .await;
    seed_message_with_role(&pool, "m1", "s_pending", 1, 0, "user", "please work", None).await;
    drop(pool);

    let (stdout, code) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &[
            "session",
            "wait",
            "s_pending",
            "--timeout=0",
            "--poll=1",
            "--tail=20",
        ],
    );
    assert_eq!(code, Some(0), "stdout was: {stdout}");
    let lines = parse_ndjson(&stdout);
    assert_eq!(lines.len(), 3, "stdout was: {stdout}");
    assert_eq!(lines[1]["stream"], "wait");
    assert_eq!(lines[1]["phase"], "final");
    assert_eq!(lines[1]["status"], "timed_out");
    assert_eq!(lines[1]["messages"].as_array().unwrap().len(), 1);
    assert_eq!(lines[2]["stream"], "end");
    assert_eq!(lines[2]["reason"], "timeout");
}

#[tokio::test]
async fn session_wait_missing_session_exits_3() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;

    let (stdout, code) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &["session", "wait", "sess_missing", "--timeout=0"],
    );
    assert_eq!(code, Some(3), "stdout was: {stdout}");
    let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(payload["error"], "not_found");
}

#[tokio::test]
async fn session_wait_missing_db_exits_4() {
    let td = tempdir();
    let db = td.path().join("nonexistent.db");

    let (stdout, code) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &["session", "wait", "s_wait", "--timeout=0"],
    );
    assert_eq!(code, Some(4), "stdout was: {stdout}");
    let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(payload["error"], "db_unavailable");
}

#[tokio::test]
async fn session_wait_tail_limits_returned_messages() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "s_tail", "tail", "idle", "2026-05-18T00:00:00Z").await;
    seed_message_with_role(&pool, "m1", "s_tail", 1, 0, "user", "first", None).await;
    seed_message_with_role(&pool, "m2", "s_tail", 1, 1, "assistant", "second", None).await;
    seed_message_with_role(&pool, "m3", "s_tail", 2, 0, "user", "third", None).await;
    seed_message_with_role(&pool, "m4", "s_tail", 2, 1, "assistant", "fourth", None).await;
    drop(pool);

    let (stdout, code) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &[
            "session",
            "wait",
            "s_tail",
            "--timeout=1",
            "--poll=1",
            "--tail=1",
        ],
    );
    assert_eq!(code, Some(0), "stdout was: {stdout}");
    let lines = parse_ndjson(&stdout);
    assert_eq!(lines[1]["status"], "completed");
    let messages = lines[1]["messages"].as_array().expect("messages array");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["id"], "m4");
    assert_eq!(messages[0]["content"], "fourth");
}

#[tokio::test]
async fn sessions_list_invalid_status_exits_2() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;
    let (stdout, code) = run_galley(&db, &["sessions", "list", "--status", "not_a_status"]);
    assert_eq!(code, Some(2), "stdout was: {stdout}");
    let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(payload["error"], "invalid_args");
}

#[tokio::test]
async fn db_unavailable_exits_4() {
    let td = tempdir();
    // No seeded_db_at call → file doesn't exist. `create_if_missing(false)`
    // in SqliteGalley::open() should surface as DbUnavailable / exit 4.
    let db = td.path().join("nonexistent.db");
    let (stdout, code) = run_galley(&db, &["status"]);
    assert_eq!(code, Some(4), "stdout was: {stdout}");
    let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(payload["error"], "db_unavailable");
}

#[tokio::test]
async fn status_returns_counts() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "a", "a", "idle", "2026-05-18T00:00:00Z").await;
    seed_session(&pool, "b", "b", "completed", "2026-05-18T00:00:01Z").await;
    drop(pool);

    let (stdout, code) = run_galley(&db, &["status"]);
    assert_eq!(code, Some(0));
    let s: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(s["total"], 2);
}

// ---- B2 M4 write command tests ----

/// `galley session send` with no Galley Core running maps to exit 4
/// (DbUnavailable per CLI exit-code contract). Asserts the CLI gracefully
/// reports the socket connect failure instead of panicking.
#[tokio::test]
async fn session_send_without_core_running_exits_4() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "s1", "x", "idle", "2026-05-18T00:00:00Z").await;
    drop(pool);

    // No Galley Core process → socket file absent OR refused. Either
    // way, session send should report exit 4. We pre-empt cross-test
    // pollution by setting TMPDIR to the tempdir so any (impossible)
    // existing socket in /tmp doesn't accidentally match.
    let (stdout, code) =
        run_galley_with_tmpdir(&db, td.path(), &["session", "send", "s1", "hello"]);
    assert_eq!(code, Some(4), "exit code: stdout = {stdout}");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(parsed["error"], "db_unavailable");
}

/// `galley session watch` same as above: no Core → exit 4.
#[tokio::test]
async fn session_watch_without_core_running_exits_4() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    drop(pool);

    let (stdout, code) = run_galley_with_tmpdir(&db, td.path(), &["session", "watch", "s1"]);
    assert_eq!(code, Some(4), "exit code: stdout = {stdout}");
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn session_watch_socket_error_emits_single_cli_error() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixListener;

    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    drop(pool);

    let socket_path = td.path().join(format!("galley-{}.sock", current_uid()));
    let listener = UnixListener::bind(&socket_path).expect("bind fake socket");
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("accept");
        let (read_half, mut write_half) = stream.into_split();
        let mut lines = BufReader::new(read_half).lines();
        let _request = lines.next_line().await.expect("read request");
        write_half
            .write_all(
                br#"{"ok":false,"requestId":null,"error":"not_found","message":"no live runner"}"#,
            )
            .await
            .expect("write response");
        write_half.write_all(b"\n").await.expect("write newline");
    });

    let (stdout, code) = run_galley_with_tmpdir(&db, td.path(), &["session", "watch", "s1"]);
    server.await.expect("fake socket task");
    assert_eq!(code, Some(3), "stdout = {stdout}");
    let lines: Vec<&str> = stdout.trim().lines().collect();
    assert_eq!(lines.len(), 1, "stdout should contain one error envelope");
    let parsed: serde_json::Value = serde_json::from_str(lines[0]).expect("json");
    assert_eq!(parsed["error"], "not_found");
    assert_eq!(parsed.get("ok"), None);
}

// ---------------- `live` run-state decoration ----------------

/// Without Galley Core the read commands still answer from SQLite, and
/// the `live` key is simply absent — never a fabricated "idle".
#[tokio::test]
async fn sessions_list_without_core_omits_live() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "s1", "one", "idle", "2026-05-18T00:00:00Z").await;
    drop(pool);

    let (stdout, code) =
        run_galley_with_tmpdir(&db, td.path(), &["sessions", "list", "--runtime", "all"]);
    assert_eq!(code, Some(0), "stdout = {stdout}");
    let row: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(row["id"], "s1");
    assert_eq!(row.get("live"), None);
    // Key order survives the `live` splice: `id` stays the first key so
    // an agent skimming NDJSON sees the identifier before anything else.
    assert!(
        stdout.trim_start().starts_with(r#"{"id":"s1""#),
        "stdout = {stdout}"
    );

    let (stdout, code) = run_galley_with_tmpdir(&db, td.path(), &["status"]);
    assert_eq!(code, Some(0), "stdout = {stdout}");
    let status: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(status.get("live"), None);
}

/// Serve one fake `sessions.run_state` answer on the tempdir socket.
/// Returns the request line Core saw so the test can assert the command
/// name and the ids the CLI asked about.
#[cfg(unix)]
fn fake_run_state_server(
    socket_path: std::path::PathBuf,
    result: serde_json::Value,
) -> tokio::task::JoinHandle<String> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixListener;
    let listener = UnixListener::bind(&socket_path).expect("bind fake socket");
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.expect("accept");
        let (read_half, mut write_half) = stream.into_split();
        let mut lines = BufReader::new(read_half).lines();
        let request = lines
            .next_line()
            .await
            .expect("read request")
            .expect("request line");
        let response = serde_json::json!({
            "ok": true,
            "requestId": null,
            "result": result,
        });
        write_half
            .write_all(response.to_string().as_bytes())
            .await
            .expect("write response");
        write_half.write_all(b"\n").await.expect("write newline");
        request
    })
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn session_brief_attaches_live_from_core() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "s-live", "busy one", "idle", "2026-05-18T00:00:00Z").await;
    drop(pool);

    let socket_path = td.path().join(format!("galley-{}.sock", current_uid()));
    let server = fake_run_state_server(
        socket_path,
        serde_json::json!({"sessions": [{
            "sessionId": "s-live", "runnerAlive": true, "agentRunning": true,
            "openRun": true, "queuedCount": 1, "busy": true,
            "askPending": false, "lastExit": "EXITED"
        }]}),
    );

    let (stdout, code) = run_galley_with_tmpdir(&db, td.path(), &["session", "brief", "s-live"]);
    let request = server.await.expect("fake socket task");
    assert_eq!(code, Some(0), "stdout = {stdout}");
    let req: serde_json::Value = serde_json::from_str(&request).expect("request json");
    assert_eq!(req["command"], "sessions.run_state");
    assert_eq!(req["args"]["sessionIds"], serde_json::json!(["s-live"]));

    let row: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    // Persisted status is untouched; the live truth rides alongside it.
    assert_eq!(row["status"], "idle");
    assert_eq!(row["live"]["busy"], true);
    assert_eq!(row["live"]["openRun"], true);
    assert_eq!(row["live"]["queuedCount"], 1);
    // galley#30 fields ride through verbatim (no typed struct in between).
    assert_eq!(row["live"]["askPending"], false);
    assert_eq!(row["live"]["lastExit"], "EXITED");
    assert_eq!(
        row["live"].get("sessionId"),
        None,
        "sessionId is redundant inside live"
    );
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn status_attaches_live_busy_and_queued_counts() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "s1", "one", "idle", "2026-05-18T00:00:00Z").await;
    drop(pool);

    let socket_path = td.path().join(format!("galley-{}.sock", current_uid()));
    let server = fake_run_state_server(
        socket_path,
        serde_json::json!({"sessions": [
            {"sessionId": "a", "runnerAlive": true, "agentRunning": true,
             "openRun": true, "queuedCount": 2, "busy": true},
            {"sessionId": "b", "runnerAlive": true, "agentRunning": false,
             "openRun": false, "queuedCount": 0, "busy": false},
            {"sessionId": "c", "runnerAlive": false, "agentRunning": false,
             "openRun": false, "queuedCount": 1, "busy": true}
        ]}),
    );

    let (stdout, code) = run_galley_with_tmpdir(&db, td.path(), &["status"]);
    let request = server.await.expect("fake socket task");
    assert_eq!(code, Some(0), "stdout = {stdout}");
    let req: serde_json::Value = serde_json::from_str(&request).expect("request json");
    assert_eq!(req["command"], "sessions.run_state");
    // Unscoped: `status` asks about everything Core holds state for.
    assert_eq!(
        req["args"].get("sessionIds"),
        Some(&serde_json::Value::Null)
    );

    let status: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(status["total"], 1);
    assert_eq!(status["live"]["busy"], 2);
    assert_eq!(status["live"]["queued"], 3);
}

/// Seed an agent (`assistant`) row carrying a persisted `tool_calls`
/// array, in the shape the GUI stores (`JSON.stringify` of the bridge's
/// `TurnEndEvent.toolCalls`).
async fn seed_agent_row_with_tool_calls(
    pool: &SqlitePool,
    id: &str,
    session_id: &str,
    turn_index: i64,
    content: &str,
    tool_calls: &serde_json::Value,
) {
    sqlx::query(
        "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, \
            tool_calls, created_at) \
         VALUES (?, ?, ?, 1, 'assistant', ?, ?, '2026-05-18T00:00:00Z')",
    )
    .bind(id)
    .bind(session_id)
    .bind(turn_index)
    .bind(content)
    .bind(tool_calls.to_string())
    .execute(pool)
    .await
    .expect("seed agent row");
}

/// Serve `sessions.run_state` on the tempdir socket for every
/// connection: the n-th probe gets `answers[n]`, the last answer repeats.
/// Returns the request lines seen so far; abort the task when done.
#[cfg(unix)]
fn fake_run_state_server_seq(
    socket_path: std::path::PathBuf,
    answers: Vec<serde_json::Value>,
) -> (
    tokio::task::JoinHandle<()>,
    std::sync::Arc<std::sync::Mutex<Vec<String>>>,
) {
    fake_run_state_server_with_write(socket_path, answers, None)
}

/// A DB write the fake Core fires `delay` after answering probe number
/// `after_probe` (0-based): a row that lands shortly after Core reported
/// the run ended, the way the GUI persists `turn_end`.
#[cfg(unix)]
struct LateWrite {
    after_probe: usize,
    delay: std::time::Duration,
    db: std::path::PathBuf,
    sql: &'static str,
}

/// [`fake_run_state_server_seq`] plus an optional [`LateWrite`].
#[cfg(unix)]
fn fake_run_state_server_with_write(
    socket_path: std::path::PathBuf,
    answers: Vec<serde_json::Value>,
    write: Option<LateWrite>,
) -> (
    tokio::task::JoinHandle<()>,
    std::sync::Arc<std::sync::Mutex<Vec<String>>>,
) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixListener;
    let listener = UnixListener::bind(&socket_path).expect("bind fake socket");
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen_by_server = seen.clone();
    let task = tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.expect("accept");
            let (read_half, mut write_half) = stream.into_split();
            let mut lines = BufReader::new(read_half).lines();
            let Ok(Some(request)) = lines.next_line().await else {
                continue;
            };
            let n = {
                let mut seen = seen_by_server.lock().unwrap();
                seen.push(request);
                seen.len() - 1
            };
            if let Some(late) = write.as_ref().filter(|w| w.after_probe == n) {
                let (delay, db, sql) = (late.delay, late.db.clone(), late.sql);
                tokio::spawn(async move {
                    tokio::time::sleep(delay).await;
                    let opts = SqliteConnectOptions::new().filename(db);
                    let pool = SqlitePool::connect_with(opts).await.expect("open db");
                    sqlx::raw_sql(sql).execute(&pool).await.expect("late write");
                    pool.close().await;
                });
            }
            let result = answers[n.min(answers.len() - 1)].clone();
            let response = serde_json::json!({"ok": true, "requestId": null, "result": result});
            let _ = write_half
                .write_all(format!("{response}\n").as_bytes())
                .await;
        }
    });
    (task, seen)
}

#[cfg(unix)]
fn run_state_answer(id: &str, open_run: bool, ask_pending: bool, queued: u32) -> serde_json::Value {
    serde_json::json!({"sessions": [{
        "sessionId": id, "runnerAlive": true, "agentRunning": open_run,
        "openRun": open_run, "queuedCount": queued,
        "busy": open_run || queued > 0,
        "askPending": ask_pending, "lastExit": if open_run { "EXITED" } else { "CURRENT_TASK_DONE" }
    }]})
}

/// galley#30: a mid-run step has content, so the default wait completes
/// on it; both frames now carry `live` like `session brief`.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn session_wait_frames_carry_live_and_default_mode_ignores_it() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "s-run", "run", "idle", "2026-05-18T00:00:00Z").await;
    seed_message_with_role(&pool, "m1", "s-run", 4, 0, "user", "go", None).await;
    seed_message_with_role(
        &pool,
        "m2",
        "s-run",
        4,
        1,
        "assistant",
        "<summary>step</summary>",
        None,
    )
    .await;
    drop(pool);

    let socket_path = td.path().join(format!("galley-{}.sock", current_uid()));
    let (server, seen) =
        fake_run_state_server_seq(socket_path, vec![run_state_answer("s-run", true, false, 0)]);
    let (stdout, code) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &[
            "session",
            "wait",
            "s-run",
            "--after-turn=4",
            "--timeout=5",
            "--poll=1",
        ],
    );
    server.abort();
    assert_eq!(code, Some(0), "stdout = {stdout}");
    let lines = parse_ndjson(&stdout);
    assert_eq!(lines.len(), 3, "stdout = {stdout}");
    assert_eq!(lines[1]["status"], "completed");
    for frame in &lines[..2] {
        assert_eq!(frame["session"]["id"], "s-run");
        assert_eq!(frame["session"]["live"]["openRun"], true);
        assert_eq!(frame["session"]["live"]["lastExit"], "EXITED");
        assert_eq!(frame["session"]["live"].get("sessionId"), None);
    }
    let requests = seen.lock().unwrap().clone();
    assert_eq!(requests.len(), 2, "initial + final probe: {requests:?}");
    let req: serde_json::Value = serde_json::from_str(&requests[0]).expect("request json");
    assert_eq!(req["command"], "sessions.run_state");
    assert_eq!(req["args"]["sessionIds"], serde_json::json!(["s-run"]));
}

/// galley#30: `--until-idle` keeps waiting past a progress step until
/// Core reports the run ended.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn session_wait_until_idle_waits_for_the_run_to_end() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "s-run", "run", "idle", "2026-05-18T00:00:00Z").await;
    seed_message_with_role(&pool, "m1", "s-run", 4, 0, "user", "go", None).await;
    seed_message_with_role(
        &pool,
        "m2",
        "s-run",
        4,
        1,
        "assistant",
        "<summary>step</summary>",
        None,
    )
    .await;
    drop(pool);

    let socket_path = td.path().join(format!("galley-{}.sock", current_uid()));
    let (server, seen) = fake_run_state_server_seq(
        socket_path,
        vec![
            run_state_answer("s-run", true, false, 0),  // initial
            run_state_answer("s-run", true, false, 1),  // poll 1: queue draining
            run_state_answer("s-run", false, false, 0), // poll 2: ended, then confirmed
        ],
    );
    let (stdout, code) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &[
            "session",
            "wait",
            "s-run",
            "--after-turn=4",
            "--until-idle",
            "--timeout=20",
            "--poll=1",
        ],
    );
    server.abort();
    assert_eq!(code, Some(0), "stdout = {stdout}");
    let lines = parse_ndjson(&stdout);
    assert_eq!(lines.len(), 3, "stdout = {stdout}");
    assert_eq!(lines[0]["session"]["live"]["openRun"], true);
    assert_eq!(lines[1]["phase"], "final");
    assert_eq!(lines[1]["status"], "completed");
    assert_eq!(lines[1]["session"]["live"]["openRun"], false);
    assert_eq!(lines[1]["session"]["live"]["lastExit"], "CURRENT_TASK_DONE");
    assert_eq!(lines[2]["reason"], "completed");
    assert_eq!(
        seen.lock().unwrap().len(),
        4,
        "one probe per poll, plus the confirming probe after the grace"
    );
}

/// galley#30: an ended run is re-checked after the grace. Here the next
/// queued run reopened the gate in between, so the wait keeps polling
/// and completes on a later confirmed read.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn session_wait_until_idle_keeps_polling_when_the_recheck_sees_a_new_run() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "s-next", "next", "idle", "2026-05-18T00:00:00Z").await;
    seed_message_with_role(&pool, "m1", "s-next", 4, 0, "user", "go", None).await;
    seed_message_with_role(
        &pool,
        "m2",
        "s-next",
        4,
        1,
        "assistant",
        "<summary>step</summary>",
        None,
    )
    .await;
    drop(pool);

    let socket_path = td.path().join(format!("galley-{}.sock", current_uid()));
    let (server, seen) = fake_run_state_server_seq(
        socket_path,
        vec![
            run_state_answer("s-next", false, false, 0), // initial: ended
            run_state_answer("s-next", true, false, 0),  // recheck: reopened
            run_state_answer("s-next", false, false, 0), // poll 1, then confirmed
        ],
    );
    let (stdout, code) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &[
            "session",
            "wait",
            "s-next",
            "--after-turn=4",
            "--until-idle",
            "--timeout=20",
            "--poll=1",
        ],
    );
    server.abort();
    assert_eq!(code, Some(0), "stdout = {stdout}");
    let lines = parse_ndjson(&stdout);
    assert_eq!(lines.len(), 3, "stdout = {stdout}");
    assert_eq!(lines[0]["session"]["live"]["openRun"], false);
    assert_eq!(lines[1]["status"], "completed");
    assert_eq!(lines[1]["session"]["live"]["openRun"], false);
    assert_eq!(
        seen.lock().unwrap().len(),
        4,
        "initial, recheck (reopened), poll, confirming recheck"
    );
}

/// galley#30: the GUI persists the final row slightly after Core closed
/// the run. Here it lands 300ms after Core first reports the run ended:
/// an immediate re-read would miss it, the read after the 1s grace (which
/// builds the final frame) has it.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn session_wait_until_idle_final_frame_includes_a_row_that_landed_during_the_grace() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "s-late", "late", "idle", "2026-05-18T00:00:00Z").await;
    seed_message_with_role(&pool, "m1", "s-late", 4, 0, "user", "go", None).await;
    seed_message_with_role(
        &pool,
        "m2",
        "s-late",
        4,
        1,
        "assistant",
        "<summary>step</summary>",
        None,
    )
    .await;
    drop(pool);

    let socket_path = td.path().join(format!("galley-{}.sock", current_uid()));
    let (server, seen) = fake_run_state_server_with_write(
        socket_path,
        vec![run_state_answer("s-late", false, false, 0)],
        Some(LateWrite {
            after_probe: 0,
            delay: std::time::Duration::from_millis(300),
            db: db.clone(),
            sql: "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, \
                    final_answer, created_at) \
                  VALUES ('m3', 's-late', 5, 1, 'assistant', 'all done', 'all done', \
                    '2026-05-18T00:00:01Z')",
        }),
    );
    let (stdout, code) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &[
            "session",
            "wait",
            "s-late",
            "--after-turn=4",
            "--until-idle",
            "--timeout=20",
            "--poll=1",
        ],
    );
    server.abort();
    assert_eq!(code, Some(0), "stdout = {stdout}");
    let lines = parse_ndjson(&stdout);
    assert_eq!(lines.len(), 3, "stdout = {stdout}");
    assert_eq!(lines[0]["messages"].as_array().unwrap().len(), 2);
    assert_eq!(lines[1]["status"], "completed");
    let messages = lines[1]["messages"].as_array().expect("messages");
    assert_eq!(messages.len(), 3, "stdout = {stdout}");
    assert_eq!(messages[2]["finalAnswer"], "all done");
    assert_eq!(seen.lock().unwrap().len(), 2, "initial + confirming probe");
}

/// galley#30: a run that ended on an ask_user question is idle for
/// `--until-idle` even with messages held behind it (`busy` true); the
/// final frame carries `live.askPending` and the asking row's `askUser`.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn session_wait_until_idle_completes_on_a_pending_question() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "s-ask", "ask", "idle", "2026-05-18T00:00:00Z").await;
    seed_message_with_role(&pool, "m1", "s-ask", 4, 0, "user", "go", None).await;
    seed_agent_row_with_tool_calls(
        &pool,
        "m2",
        "s-ask",
        4,
        "<summary>need a choice</summary>",
        &serde_json::json!([
            {"toolName": "ask_user", "args": {"question": "Which DB?", "candidates": ["sqlite"]}},
            {"toolName": "ask_user", "args": {"question": "Which DB?", "candidates": ["postgres"]}},
        ]),
    )
    .await;
    drop(pool);

    let socket_path = td.path().join(format!("galley-{}.sock", current_uid()));
    let (server, _seen) =
        fake_run_state_server_seq(socket_path, vec![run_state_answer("s-ask", false, true, 2)]);
    let (stdout, code) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &[
            "session",
            "wait",
            "s-ask",
            "--after-turn=4",
            "--until-idle",
            "--timeout=5",
            "--poll=1",
        ],
    );
    server.abort();
    assert_eq!(code, Some(0), "stdout = {stdout}");
    let lines = parse_ndjson(&stdout);
    assert_eq!(lines[1]["status"], "completed", "stdout = {stdout}");
    let live = &lines[1]["session"]["live"];
    assert_eq!(live["askPending"], true);
    assert_eq!(live["busy"], true);
    assert_eq!(live["queuedCount"], 2);
    let messages = lines[1]["messages"].as_array().expect("messages");
    assert_eq!(messages[0].get("askUser"), None, "user row");
    assert_eq!(
        messages[1]["askUser"],
        serde_json::json!({"question": "Which DB?", "candidates": ["sqlite", "postgres"]})
    );
}

/// galley#30: with Core unreachable, `--until-idle` falls back to the
/// output condition for that poll, and frames carry no `live`.
#[tokio::test]
async fn session_wait_until_idle_without_core_falls_back_to_output() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "s-run", "run", "idle", "2026-05-18T00:00:00Z").await;
    seed_message_with_role(&pool, "m1", "s-run", 4, 0, "user", "go", None).await;
    seed_message_with_role(&pool, "m2", "s-run", 4, 1, "assistant", "", Some("done")).await;
    drop(pool);

    let (stdout, code) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &[
            "session",
            "wait",
            "s-run",
            "--after-turn=4",
            "--until-idle",
            "--timeout=5",
        ],
    );
    assert_eq!(code, Some(0), "stdout = {stdout}");
    let lines = parse_ndjson(&stdout);
    assert_eq!(lines[1]["status"], "completed", "stdout = {stdout}");
    assert_eq!(lines[0]["session"].get("live"), None);
    assert_eq!(lines[1]["session"].get("live"), None);
}

/// galley#30: `session show` derives `askUser` from the asking row's
/// persisted tool_calls; other rows carry no such key.
#[tokio::test]
async fn session_show_carries_ask_user_on_the_asking_row() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_session(&pool, "s-ask", "ask", "idle", "2026-05-18T00:00:00Z").await;
    seed_message_with_role(&pool, "m1", "s-ask", 1, 0, "user", "go", None).await;
    seed_agent_row_with_tool_calls(
        &pool,
        "m2",
        "s-ask",
        1,
        "reading",
        &serde_json::json!([{"toolName": "file_read", "args": {"path": "ask_user.md"}}]),
    )
    .await;
    // Persisted shape copied from a real row (keys as the GUI stores them).
    seed_agent_row_with_tool_calls(
        &pool,
        "m3",
        "s-ask",
        2,
        "<summary>ask</summary>",
        &serde_json::json!([{"args": {"candidates": ["A", "B"], "question": "Pick one"},
                             "toolName": "ask_user"}]),
    )
    .await;
    drop(pool);

    let (stdout, code) = run_galley_with_tmpdir(&db, td.path(), &["session", "show", "s-ask"]);
    assert_eq!(code, Some(0), "stdout = {stdout}");
    let rows = parse_ndjson(&stdout);
    assert_eq!(rows.len(), 3, "stdout = {stdout}");
    assert_eq!(rows[0].get("askUser"), None);
    // `ask_user` appears in its tool_calls text but it is no ask_user call.
    assert_eq!(rows[1].get("askUser"), None);
    assert_eq!(
        rows[2]["askUser"],
        serde_json::json!({"question": "Pick one", "candidates": ["A", "B"]})
    );
}

// ---------------- ticket 03b: windows into a transcript ----------------

/// `turns` turns in session `s-w`, each a user row and an agent row
/// (`u{turn}` / `a{turn}`), one minute apart from 2026-10-08T00:00Z.
async fn seed_minute_transcript(pool: &SqlitePool, turns: i64) {
    seed_session(pool, "s-w", "w", "idle", "2026-10-08T00:00:00Z").await;
    for turn in 0..turns {
        for (seq, role, prefix) in [(0i64, "user", "u"), (1, "assistant", "a")] {
            let minute = turn * 2 + seq;
            let id = format!("{prefix}{turn}");
            sqlx::query(
                "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, \
                    created_at) VALUES (?, 's-w', ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(turn)
            .bind(seq)
            .bind(role)
            .bind(format!("{id} body"))
            .bind(format!(
                "2026-10-08T{:02}:{:02}:00+00:00",
                minute / 60,
                minute % 60
            ))
            .execute(pool)
            .await
            .expect("seed message");
        }
    }
}

fn row_ids(stdout: &str) -> Vec<String> {
    parse_ndjson(stdout)
        .iter()
        .map(|row| row["id"].as_str().expect("id").to_string())
        .collect()
}

/// `run_galley_with_tmpdir` with a fixed `TZ`, so a bare date means a
/// known local day (Unix `chrono::Local` reads `TZ`).
fn run_galley_in_tz(
    db: &std::path::Path,
    tmp: &std::path::Path,
    tz: &str,
    args: &[&str],
) -> (String, Option<i32>) {
    let out = Command::new(galley_bin())
        .args(args)
        .env("GALLEY_DB_PATH", db)
        .env("TMPDIR", tmp)
        .env("TZ", tz)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("spawn galley");
    (
        String::from_utf8_lossy(&out.stdout).into_owned(),
        out.status.code(),
    )
}

#[tokio::test]
async fn session_show_around_reads_a_message_in_context() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_minute_transcript(&pool, 15).await;
    drop(pool);
    let show = |args: &[&str]| run_galley_with_tmpdir(&db, td.path(), args);

    // Default context: 10 rows each side, 21 in all, oldest first.
    let (stdout, code) = show(&["session", "show", "s-w", "--around=a7"]);
    assert_eq!(code, Some(0), "stdout = {stdout}");
    let ids = row_ids(&stdout);
    assert_eq!(ids.len(), 21, "{ids:?}");
    assert_eq!(
        (ids[0].as_str(), ids[10].as_str(), ids[20].as_str()),
        ("a2", "a7", "a12")
    );
    // Explicit context; space-separated flags work the same.
    let (stdout, code) = show(&["session", "show", "s-w", "--around", "u8", "--context", "2"]);
    assert_eq!(code, Some(0), "stdout = {stdout}");
    assert_eq!(row_ids(&stdout), ["u7", "a7", "u8", "a8", "u9"]);
    // Near either end the window is cut short.
    let (stdout, _) = show(&["session", "show", "s-w", "--around=u0", "--context=3"]);
    assert_eq!(row_ids(&stdout), ["u0", "a0", "u1", "a1"]);
    let (stdout, _) = show(&["session", "show", "s-w", "--around=a14", "--context=1"]);
    assert_eq!(row_ids(&stdout), ["u14", "a14"]);
    let (stdout, _) = show(&["session", "show", "s-w", "--around=a14", "--context=0"]);
    assert_eq!(row_ids(&stdout), ["a14"]);
    // Rows are full MessageBriefs, as `session show` prints them.
    let rows = parse_ndjson(&stdout);
    assert_eq!(rows[0]["role"], "agent");
    assert_eq!(rows[0]["turnIndex"], 14);
    assert_eq!(rows[0]["createdAt"], "2026-10-08T00:29:00+00:00");

    // A message the session does not have: exit 3 not_found.
    for (session, message) in [("s-w", "nope"), ("s-missing", "a7")] {
        let (stdout, code) = show(&["session", "show", session, &format!("--around={message}")]);
        assert_eq!(code, Some(3), "stdout = {stdout}");
        let err: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
        assert_eq!(err["error"], "not_found");
    }
}

#[tokio::test]
async fn session_show_reads_a_time_window() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_minute_transcript(&pool, 15).await;
    drop(pool);
    let show = |args: &[&str]| run_galley_with_tmpdir(&db, td.path(), args);

    // Instants: since inclusive, until exclusive.
    let (stdout, code) = show(&[
        "session",
        "show",
        "s-w",
        "--since=2026-10-08T00:10:00Z",
        "--until=2026-10-08T08:14:00+08:00",
    ]);
    assert_eq!(code, Some(0), "stdout = {stdout}");
    assert_eq!(row_ids(&stdout), ["u5", "a5", "u6", "a6"]);
    // `--tail` keeps the window's last rows.
    let (stdout, _) = show(&[
        "session",
        "show",
        "s-w",
        "--since=2026-10-08T00:10:00Z",
        "--until=2026-10-08T00:14:00Z",
        "--tail=1",
    ]);
    assert_eq!(row_ids(&stdout), ["a6"]);
    // Either bound alone.
    let (stdout, _) = show(&["session", "show", "s-w", "--until=2026-10-08T00:02:00Z"]);
    assert_eq!(row_ids(&stdout), ["u0", "a0"]);
    let (stdout, _) = show(&["session", "show", "s-w", "--since=2026-10-08T00:28:00Z"]);
    assert_eq!(row_ids(&stdout), ["u14", "a14"]);
    // A window with nothing in it: empty output, exit 0.
    let (stdout, code) = show(&["session", "show", "s-w", "--since=2026-10-09T00:00:00Z"]);
    assert_eq!(code, Some(0));
    assert_eq!(stdout, "");

    // Local days and local times (`TZ` is read on Unix only; the zone
    // math itself is unit-tested in `core/src/api/transcript_window.rs`).
    if cfg!(unix) {
        let local = |args: &[&str]| run_galley_in_tz(&db, td.path(), "Asia/Shanghai", args);
        // The rows fall on 2026-10-08 08:00–08:29 in Shanghai.
        let (stdout, code) = local(&[
            "session",
            "show",
            "s-w",
            "--since=2026-10-08",
            "--until=2026-10-08",
        ]);
        assert_eq!(code, Some(0), "stdout = {stdout}");
        assert_eq!(row_ids(&stdout).len(), 30);
        let (stdout, _) = local(&["session", "show", "s-w", "--until=2026-10-07"]);
        assert_eq!(stdout, "");
        let (stdout, _) = local(&["session", "show", "s-w", "--since=2026-10-09"]);
        assert_eq!(stdout, "");
        let (stdout, _) = local(&["session", "show", "s-w", "--since=2026-10-08T08:28"]);
        assert_eq!(row_ids(&stdout), ["u14", "a14"]);
        let (stdout, _) = local(&["session", "show", "s-w", "--until=2026-10-08 08:01"]);
        assert_eq!(row_ids(&stdout), ["u0"], "until is exclusive");
    }
}

#[tokio::test]
async fn session_show_refuses_window_flags_that_do_not_combine() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_minute_transcript(&pool, 2).await;
    drop(pool);

    for args in [
        &["--around=a1", "--tail=5"][..],
        &["--around=a1", "--since=2026-10-08"],
        &["--around=a1", "--until=2026-10-08"],
        &["--context=3"],
        &["--since=2026-10-09", "--until=2026-10-08"],
        &[
            "--since=2026-10-08T00:10:00Z",
            "--until=2026-10-08T00:10:00Z",
        ],
        &["--since=yesterday"],
        &["--until=2026-10-08T25:00"],
    ] {
        let mut full = vec!["session", "show", "s-w"];
        full.extend_from_slice(args);
        let (stdout, code) = run_galley_with_tmpdir(&db, td.path(), &full);
        assert_eq!(code, Some(2), "{args:?}: stdout = {stdout}");
        let err: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
        assert_eq!(err["error"], "invalid_args", "{args:?}");
    }
}

/// Seed of the golden test below: the same rows the pre-03b binary was
/// run against to capture the expected lines.
async fn seed_golden_transcript(pool: &SqlitePool) {
    seed_session(pool, "s-g", "g", "idle", "2026-05-18T00:00:00Z").await;
    for (i, (id, turn, seq, role, content, final_answer, summary)) in [
        ("g1", 0, 0, "user", "找一下上周的“方案”", None, None),
        (
            "g2",
            0,
            1,
            "assistant",
            "<summary>查</summary>正在找",
            Some("好的，方案在这里"),
            Some("查方案"),
        ),
        ("g3", 1, 0, "user", "谢谢", None, None),
    ]
    .into_iter()
    .enumerate()
    {
        sqlx::query(
            "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, \
                final_answer, summary, created_at) VALUES (?, 's-g', ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(turn)
        .bind(seq)
        .bind(role)
        .bind(content)
        .bind(final_answer)
        .bind(summary)
        .bind(format!("2026-05-18T00:00:0{i}Z"))
        .execute(pool)
        .await
        .expect("seed message");
        sqlx::query(
            "INSERT INTO messages_fts (message_id, session_id, role, turn_index, body) \
             VALUES (?, 's-g', ?, ?, ?)",
        )
        .bind(id)
        .bind(role)
        .bind(turn)
        .bind(final_answer.unwrap_or(content))
        .execute(pool)
        .await
        .expect("seed fts row");
    }
}

/// Ticket 03b is additive: `session show` without the new flags prints
/// exactly what it printed before (lines captured from the pre-03b
/// binary), and a search hit keeps its four fields, in order and with
/// the same values, ahead of the three new ones — under every schema pin.
#[tokio::test]
async fn existing_show_and_search_output_is_unchanged() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_golden_transcript(&pool).await;
    drop(pool);

    let g1 = r#"{"id":"g1","sessionId":"s-g","role":"user","content":"找一下上周的“方案”","createdAt":"2026-05-18T00:00:00Z","turnIndex":0,"visibility":"visible","origin":{"via":"gui"}}"#;
    let g2 = r#"{"id":"g2","sessionId":"s-g","role":"agent","content":"<summary>查</summary>正在找","finalAnswer":"好的，方案在这里","createdAt":"2026-05-18T00:00:01Z","summary":"查方案","turnIndex":0,"visibility":"visible","origin":{"via":"gui"}}"#;
    let g3 = r#"{"id":"g3","sessionId":"s-g","role":"user","content":"谢谢","createdAt":"2026-05-18T00:00:02Z","turnIndex":1,"visibility":"visible","origin":{"via":"gui"}}"#;
    for pin in [
        None,
        Some("--schema=1"),
        Some("--schema=2"),
        Some("--schema=3"),
    ] {
        let with_pin = |args: &[&str]| {
            let mut full: Vec<&str> = pin.into_iter().collect();
            full.extend_from_slice(args);
            run_galley_with_tmpdir(&db, td.path(), &full)
        };
        let (stdout, code) = with_pin(&["session", "show", "s-g"]);
        assert_eq!(code, Some(0));
        assert_eq!(stdout, format!("{g1}\n{g2}\n{g3}\n"), "pin {pin:?}");
        let (stdout, _) = with_pin(&["session", "show", "s-g", "--tail=1"]);
        assert_eq!(stdout, format!("{g3}\n"), "pin {pin:?}");
        let (stdout, code) = with_pin(&["session", "show", "s-missing"]);
        assert_eq!((stdout.as_str(), code), ("", Some(0)));

        // LIKE path (2 chars): the old line, three fields appended.
        let (stdout, _) = with_pin(&["sessions", "search", "方案", "--runtime", "all"]);
        assert_eq!(
            stdout,
            "{\"sessionId\":\"s-g\",\"messageId\":\"g1\",\"snippet\":\"找一下上周的“方案”\",\
             \"rank\":0.0,\"createdAt\":\"2026-05-18T00:00:00Z\",\"role\":\"user\",\
             \"turnIndex\":0}\n",
            "pin {pin:?}"
        );
        // FTS path: same keys in the same order, rank from BM25.
        let (stdout, _) = with_pin(&["sessions", "search", "上周的", "--runtime", "all"]);
        let line = stdout.trim();
        assert!(
            line.starts_with(
                "{\"sessionId\":\"s-g\",\"messageId\":\"g1\",\
                 \"snippet\":\"找一下<mark>上周的</mark>“方案”\",\"rank\":-"
            ),
            "pin {pin:?}: {line}"
        );
        assert!(
            line.ends_with(
                ",\"createdAt\":\"2026-05-18T00:00:00Z\",\"role\":\"user\",\"turnIndex\":0}"
            ),
            "pin {pin:?}: {line}"
        );
    }
}

#[tokio::test]
async fn sessions_search_session_filter_and_hit_fields() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_minute_transcript(&pool, 3).await;
    seed_session(&pool, "s-x", "x", "idle", "2026-10-09T00:00:00Z").await;
    for (id, session, turn, seq, role, content) in [
        ("a1", "s-w", 1, 1, "assistant", "the needle answer"),
        ("x1", "s-x", 4, 0, "user", "another needle"),
    ] {
        sqlx::query(
            "INSERT INTO messages_fts (message_id, session_id, role, turn_index, body) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(session)
        .bind(role)
        .bind(turn)
        .bind(content)
        .execute(&pool)
        .await
        .expect("seed fts row");
        if session == "s-x" {
            sqlx::query(
                "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, \
                    created_at) VALUES (?, ?, ?, ?, ?, ?, '2026-10-09T01:00:00+00:00')",
            )
            .bind(id)
            .bind(session)
            .bind(turn)
            .bind(seq)
            .bind(role)
            .bind(content)
            .execute(&pool)
            .await
            .expect("seed message");
        }
    }
    drop(pool);

    let (stdout, code) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &["sessions", "search", "needle", "--runtime", "all"],
    );
    assert_eq!(code, Some(0), "stdout = {stdout}");
    assert_search_session_ids(&stdout, &["s-w", "s-x"]);

    for pin in ["--schema=1", "--schema=2", "--schema=3"] {
        let (stdout, code) = run_galley_with_tmpdir(
            &db,
            td.path(),
            &[
                pin,
                "sessions",
                "search",
                "needle",
                "--runtime",
                "all",
                "--session=s-w",
            ],
        );
        assert_eq!(code, Some(0), "stdout = {stdout}");
        let hits = parse_ndjson(&stdout);
        assert_eq!(hits.len(), 1, "{pin}: {stdout}");
        assert_eq!(hits[0]["messageId"], "a1");
        assert_eq!(hits[0]["role"], "agent");
        assert_eq!(hits[0]["turnIndex"], 1);
        assert_eq!(hits[0]["createdAt"], "2026-10-08T00:03:00+00:00");

        // The hit, read in context.
        let (stdout, code) = run_galley_with_tmpdir(
            &db,
            td.path(),
            &[pin, "session", "show", "s-w", "--around=a1", "--context=1"],
        );
        assert_eq!(code, Some(0), "stdout = {stdout}");
        assert_eq!(row_ids(&stdout), ["u1", "a1", "u2"]);
    }
    // The filter applies on top of the runtime scope (`s-w` is external).
    let (stdout, _) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &[
            "sessions",
            "search",
            "needle",
            "--runtime",
            "managed",
            "--session=s-w",
        ],
    );
    assert_eq!(stdout, "");
    let (stdout, _) = run_galley_with_tmpdir(
        &db,
        td.path(),
        &[
            "sessions",
            "search",
            "needle",
            "--runtime",
            "all",
            "--session=s-missing",
        ],
    );
    assert_eq!(stdout, "");
}

/// `galley sessions list | head` closes stdout early. That must end the
/// process quietly (exit 0, empty stderr) — not with a Rust panic trace,
/// which is what `println!` produced on a broken pipe.
#[cfg(unix)]
#[tokio::test]
async fn closed_stdout_ends_quietly_without_panic() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    for i in 0..200 {
        seed_session(
            &pool,
            &format!("s{i}"),
            &format!("session number {i} with a title long enough to fill pipes"),
            "idle",
            "2026-05-18T00:00:00Z",
        )
        .await;
    }
    drop(pool);

    let bin = std::path::PathBuf::from(env!("CARGO_BIN_EXE_galley"));
    let out = Command::new("sh")
        .arg("-c")
        .arg(format!(
            "\"{}\" sessions list --runtime all | head -c 10 >/dev/null",
            bin.display()
        ))
        .env("GALLEY_DB_PATH", &db)
        .env("TMPDIR", td.path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("spawn shell");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        !stderr.contains("panicked"),
        "broken pipe must not panic: stderr = {stderr}"
    );
    assert!(
        !stderr.contains("Broken pipe"),
        "broken pipe must be silent: stderr = {stderr}"
    );
}

/// Variant of run_galley that also sets TMPDIR so the CLI's
/// `socket_path()` helper resolves to a tempdir-relative socket — keeps
/// these tests from accidentally picking up a real Galley Core socket
/// on the dev machine.
fn run_galley_with_tmpdir(
    db: &std::path::Path,
    tmp: &std::path::Path,
    args: &[&str],
) -> (String, Option<i32>) {
    let bin = std::path::PathBuf::from(env!("CARGO_BIN_EXE_galley"));
    let out = Command::new(&bin)
        .args(args)
        .env("GALLEY_DB_PATH", db)
        .env("TMPDIR", tmp)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("spawn galley");
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    (stdout, out.status.code())
}

// RAII tempdir — drops the directory when the `TempDir` is dropped.
// Each test binds the value with `let _td = tempdir();` (or similar)
// so cleanup runs at the end of the test body.
fn tempdir() -> TempDir {
    tempfile::Builder::new()
        .prefix("galley-cli-test-")
        .tempdir()
        .expect("create tempdir")
}

#[cfg(unix)]
fn current_uid() -> u32 {
    extern "C" {
        fn getuid() -> u32;
    }
    unsafe { getuid() }
}
