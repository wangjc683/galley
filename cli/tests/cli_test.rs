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

use std::fs;
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
        MIG_021, MIG_022, MIG_023,
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
        .env_remove("GALLEY_NATIVE_EXPERIMENTAL")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("spawn galley");
    let stdout = String::from_utf8(out.stdout).expect("utf8 stdout");
    (stdout, out.status.code())
}

fn run_galley_native_enabled(db_path: &std::path::Path, args: &[&str]) -> (String, Option<i32>) {
    let out = Command::new(galley_bin())
        .args(args)
        .env("GALLEY_DB_PATH", db_path)
        .env("GALLEY_NATIVE_EXPERIMENTAL", "1")
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

#[tokio::test]
async fn version_subcommand_prints_schema_v1() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;
    let (stdout, code) = run_galley(&db, &["version"]);
    assert_eq!(code, Some(0));
    let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    // B4 M6 freeze: version output uses camelCase to align with the rest
    // of the wire format (sessions/projects/etc all camelCase).
    assert_eq!(payload["schemaVersion"], 1);
    assert!(payload.get("galleyVersion").is_some());
}

#[tokio::test]
async fn schema_pin_matching_v1_passes_through() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;
    // B4 M6: --schema=1 against a v1 binary passes through to the command.
    let (stdout, code) = run_galley(&db, &["--schema", "1", "version"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(payload["schemaVersion"], 1);
}

#[tokio::test]
async fn schema_pin_mismatch_exits_2_invalid_args() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;
    // B4 M6: pinning to an unknown schema → exit 2 invalid_args with
    // `schema_mismatch:` prefix in the message.
    let (stdout, code) = run_galley(&db, &["--schema", "99", "version"]);
    assert_eq!(code, Some(2), "stdout: {stdout}");
    let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(payload["error"], "invalid_args");
    let msg = payload["message"].as_str().expect("message string");
    assert!(
        msg.starts_with("schema_mismatch:"),
        "message should start with schema_mismatch: — got {msg}"
    );
}

#[tokio::test]
async fn runtime_help_hides_native_experimental_value() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;

    let (stdout, code) = run_galley(&db, &["sessions", "list", "--help"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    assert!(stdout.contains("managed"));
    assert!(stdout.contains("external"));
    assert!(
        !stdout.contains("galley-native"),
        "native runtime should stay hidden from ordinary help: {stdout}"
    );
}

#[tokio::test]
async fn goal_help_hides_morphling_experimental_command() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;

    let (stdout, code) = run_galley(&db, &["goal", "--help"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    assert!(stdout.contains("propose"));
    assert!(stdout.contains("run"));
    assert!(
        !stdout.contains("morphling"),
        "Morphling should stay hidden from ordinary help: {stdout}"
    );
}

#[tokio::test]
async fn top_level_help_hides_native_parity_experimental_command() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;

    let (stdout, code) = run_galley(&db, &["--help"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    assert!(
        !stdout.contains("native-parity"),
        "native parity harness should stay hidden from ordinary help: {stdout}"
    );
}

#[tokio::test]
async fn native_parity_report_writes_fixture_bundle() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;
    let report_path = td.path().join("reports").join("slice-9d.json");
    let report_path_arg = report_path.to_string_lossy().to_string();

    let (stdout, code) = run_galley(
        &db,
        &[
            "native-parity",
            "report",
            "--scenario",
            "P01",
            "--scenario",
            "p08",
            "--scenario",
            "P19",
            "--output",
            &report_path_arg,
            "--pretty",
        ],
    );
    assert_eq!(code, Some(0), "stdout: {stdout}");

    let summary: serde_json::Value = serde_json::from_str(stdout.trim()).expect("summary json");
    assert_eq!(summary["schemaVersion"], 1);
    assert_eq!(summary["reportVersion"], 1);
    assert_eq!(summary["reportCount"], 3);
    assert_eq!(
        summary["scenarios"],
        serde_json::json!(["P01", "P08", "P19"])
    );

    let body = fs::read_to_string(report_path).expect("report file");
    let reports: serde_json::Value = serde_json::from_str(&body).expect("report json");
    let reports = reports.as_array().expect("report array");
    assert_eq!(reports.len(), 3);
    assert_eq!(reports[0]["scenarioId"], "P01");
    assert_eq!(reports[0]["verdict"], "accepted_gap");
    assert_eq!(reports[1]["scenarioId"], "P08");
    assert_eq!(reports[1]["verdict"], "blocked");
    assert_eq!(reports[1]["blockers"][0]["dimension"], "browserControl");
    assert_eq!(reports[2]["scenarioId"], "P19");
    assert_eq!(reports[2]["comparison"]["persistedState"], "match");
}

#[tokio::test]
async fn native_parity_command_mode_writes_command_evidence() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;
    let report_path = td.path().join("command-report.json");
    let workspace = td.path().join("workspace");
    let report_path_arg = report_path.to_string_lossy().to_string();
    let workspace_arg = workspace.to_string_lossy().to_string();

    let (stdout, code) = run_galley(
        &db,
        &[
            "native-parity",
            "report",
            "--mode",
            "command",
            "--scenario",
            "P14",
            "--managed-command",
            "echo managed",
            "--native-command",
            "echo native",
            "--workspace",
            &workspace_arg,
            "--output",
            &report_path_arg,
        ],
    );
    assert_eq!(code, Some(0), "stdout: {stdout}");

    let summary: serde_json::Value = serde_json::from_str(stdout.trim()).expect("summary json");
    assert_eq!(summary["harness"], "managed_native_command_comparison");
    assert_eq!(summary["reportCount"], 1);

    let body = fs::read_to_string(report_path).expect("report file");
    let reports: serde_json::Value = serde_json::from_str(&body).expect("report json");
    let report = &reports.as_array().expect("report array")[0];
    assert_eq!(report["scenarioId"], "P14");
    assert_eq!(report["verdict"], "pass");
    assert_eq!(report["harness"], "managed_native_command_comparison");
    assert_eq!(report["managed"]["commandStatus"]["exitCode"], 0);
    assert_eq!(report["native"]["commandStatus"]["exitCode"], 0);
    assert!(report["managed"]["commandStatus"]["stdoutPreview"]
        .as_str()
        .expect("managed stdout")
        .contains("managed"));
    assert!(
        workspace.join("managed").is_dir(),
        "explicit workspace should be preserved"
    );
}

#[tokio::test]
async fn native_parity_command_mode_marks_native_failure_as_fail() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;

    let (stdout, code) = run_galley(
        &db,
        &[
            "native-parity",
            "report",
            "--mode",
            "command",
            "--scenario",
            "P14",
            "--managed-command",
            "echo managed",
            "--native-command",
            "exit 7",
        ],
    );
    assert_eq!(code, Some(0), "stdout: {stdout}");

    let reports: serde_json::Value = serde_json::from_str(stdout.trim()).expect("report json");
    let report = &reports.as_array().expect("report array")[0];
    assert_eq!(report["verdict"], "fail");
    assert_eq!(report["comparison"]["outcome"], "regression");
    assert_eq!(report["native"]["commandStatus"]["exitCode"], 7);
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
async fn sessions_list_rejects_native_filter_when_gate_disabled() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;

    let (stdout, code) = run_galley(&db, &["sessions", "list", "--runtime", "galley-native"]);
    assert_eq!(code, Some(2), "stdout: {stdout}");
    let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(payload["error"], "invalid_args");
    assert!(payload["message"]
        .as_str()
        .expect("message")
        .contains("GALLEY_NATIVE_EXPERIMENTAL"));
}

#[tokio::test]
async fn sessions_list_accepts_native_filter_when_gate_enabled() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let _pool = seeded_db_at(&db).await;

    let (stdout, code) =
        run_galley_native_enabled(&db, &["sessions", "list", "--runtime", "galley-native"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    assert!(stdout.trim().is_empty(), "stdout: {stdout}");
}

#[tokio::test]
async fn p15_cli_schema_v1_lists_native_runtime_with_legacy_projection() {
    let td = tempdir();
    let db = td.path().join("workbench.db");
    let pool = seeded_db_at(&db).await;
    seed_session_with_runtime(
        &pool,
        "native",
        "native",
        "idle",
        "2026-06-17T00:00:00Z",
        "galley_native",
    )
    .await;
    drop(pool);

    let (stdout, code) = run_galley_native_enabled(
        &db,
        &[
            "--schema",
            "1",
            "sessions",
            "list",
            "--runtime",
            "galley-native",
        ],
    );
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let lines: Vec<&str> = stdout.trim().lines().collect();
    assert_eq!(lines.len(), 1, "stdout: {stdout}");
    let native: serde_json::Value = serde_json::from_str(lines[0]).expect("ndjson line");
    assert_eq!(native["id"], "native");
    assert_eq!(native["runtimeKind"], "galley_native");
    assert_eq!(native["gaRuntimeKind"], "galley_native");
    assert_eq!(native["runtimeLabel"], "Galley Native");
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
        .env_remove("GALLEY_NATIVE_EXPERIMENTAL")
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
