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

async fn seeded_db_at(path: &std::path::Path) -> SqlitePool {
    let opts = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    let pool = SqlitePool::connect_with(opts).await.expect("open db");
    galley_core_lib::apply_all_migrations_for_tests(&pool)
        .await
        .expect("migrations");
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
async fn session_send_accepts_ensure_runner() {
    // `--ensure-runner` (2026-10-16) parses beside the other send flags
    // and reaches the socket: exit 4 with no Core, not a parser error
    // (exit 2).
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(
        &db,
        td.path(),
        &[
            "session",
            "send",
            "s1",
            "缺确认号",
            "--supervisor",
            "galley-assistant",
            "--reason",
            "send back",
            "--ensure-runner",
            "--jump",
        ],
    );
    assert_eq!(code, Some(4), "stdout: {stdout}");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(parsed["error"], "db_unavailable");
    // A misspelt flag is still a parser error.
    let (_, code) = run_galley_isolated(
        &db,
        td.path(),
        &["session", "send", "s1", "x", "--ensure-runners"],
    );
    assert_eq!(code, Some(2));
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
    assert_eq!(payload["schemaVersion"], 3);
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
    assert_eq!(payload["schemaVersion"], 3);
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

// ---------------- project commands against a live Core ----------------

#[cfg(unix)]
fn current_uid() -> u32 {
    extern "C" {
        fn getuid() -> u32;
    }
    // SAFETY: getuid has no preconditions and cannot fail.
    unsafe { getuid() }
}

/// A Galley Core stand-in on the tempdir socket, for the project
/// commands. It answers `ping`; it accepts every `session.watch` and then
/// writes nothing (a live runner that is quiet: Core sends no frame when
/// it accepts a subscription); and it answers the n-th
/// `sessions.run_state` probe with `answers[n]`, the last one repeating.
/// Returns the server task and the probes seen so far.
#[cfg(unix)]
fn fake_core(
    socket_path: PathBuf,
    answers: Vec<serde_json::Value>,
) -> (
    tokio::task::JoinHandle<()>,
    std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>,
) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixListener;
    let listener = UnixListener::bind(&socket_path).expect("bind fake core");
    let probes = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = probes.clone();
    let task = tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                return;
            };
            let answers = answers.clone();
            let seen = seen.clone();
            tokio::spawn(async move {
                let (read_half, mut write_half) = stream.into_split();
                let mut lines = BufReader::new(read_half).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let req: serde_json::Value = serde_json::from_str(&line).expect("request");
                    let result = match req["command"].as_str() {
                        Some("ping") => serde_json::json!({"pong": true}),
                        // Like Core's stream loop: stop reading (the CLI
                        // half-closes after subscribing) and send nothing.
                        Some("session.watch") => std::future::pending::<serde_json::Value>().await,
                        Some("sessions.run_state") => {
                            let n = {
                                let mut seen = seen.lock().unwrap();
                                seen.push(req["args"].clone());
                                seen.len() - 1
                            };
                            answers[n.min(answers.len() - 1)].clone()
                        }
                        other => panic!("fake core: unexpected command {other:?}"),
                    };
                    let response = serde_json::json!({"ok": true, "result": result});
                    if write_half
                        .write_all(format!("{response}\n").as_bytes())
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
            });
        }
    });
    (task, probes)
}

/// One session's `sessions.run_state` answer.
#[cfg(unix)]
fn run_state(id: &str, open_run: bool, agent_running: bool) -> serde_json::Value {
    serde_json::json!({
        "sessionId": id, "runnerAlive": true, "agentRunning": agent_running,
        "openRun": open_run, "queuedCount": 0, "busy": open_run || agent_running,
        "askPending": false, "lastExit": null
    })
}

/// The SOP's Project-group wait (`--until-idle --final-show`) used to end
/// with `project_idle` at the first quiet window because it read the
/// persisted status, which Core writes only as `idle`. It now asks Core:
/// a session persisted `idle` whose run is open keeps the follow going,
/// and the follow ends once Core reports the run ended.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn project_follow_until_idle_waits_for_a_run_core_reports_open() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_project(&pool, "proj_batch", "Release check", "2026-05-20T00:00:00Z").await;
    seed_project_session(
        &pool,
        "s_child",
        "proj_batch",
        "Child",
        "idle",
        "2026-05-20T00:00:02Z",
    )
    .await;
    seed_message(&pool, "m1", "s_child", 0, 0, "user", "do the work").await;
    drop(pool);

    let running = serde_json::json!({"sessions": [run_state("s_child", true, false)]});
    let ended = serde_json::json!({"sessions": [run_state("s_child", false, false)]});
    let socket_path = td.path().join(format!("galley-{}.sock", current_uid()));
    let (server, probes) = fake_core(
        socket_path,
        vec![
            running.clone(), // initial snapshot's followState
            running,         // first quiet window: still running, keep following
            ended.clone(),   // second quiet window: ended
            ended,           // final snapshot's followState
        ],
    );
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
    server.abort();
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let lines: Vec<serde_json::Value> = stdout
        .trim()
        .lines()
        .map(|l| serde_json::from_str(l).expect("ndjson line"))
        .collect();
    assert_eq!(lines.len(), 3, "stdout: {stdout}");
    assert_eq!(lines[0]["phase"], "initial");
    assert_eq!(lines[0]["followState"]["state"], "active_status_sessions");
    assert_eq!(lines[0]["followState"]["activeStatusSessions"], 1);
    assert_eq!(lines[0]["followState"]["idleStatusSessions"], 0);
    assert_eq!(lines[1]["phase"], "final");
    assert_eq!(lines[1]["followState"]["activeStatusSessions"], 0);
    assert_eq!(lines[1]["followState"]["idleStatusSessions"], 1);
    assert_eq!(lines[2]["stream"], "end");
    assert_eq!(lines[2]["reason"], "project_idle");

    // The follow did not end while Core reported the run open: it ended
    // at the check that saw it ended, then read the final state.
    let probes = probes.lock().unwrap().clone();
    assert_eq!(probes.len(), 4, "probes: {probes:?}");
    for args in &probes {
        assert_eq!(args["sessionIds"], serde_json::json!(["s_child"]));
    }
}

/// `project brief`'s `runningSessions` is what Core reports running, not
/// the persisted status (always `idle`), when Core answers.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread")]
async fn project_brief_running_sessions_come_from_core() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_project(&pool, "proj_batch", "Release check", "2026-05-20T00:00:00Z").await;
    for (id, ts) in [
        ("s_busy", "2026-05-20T00:00:03Z"),
        ("s_step", "2026-05-20T00:00:02Z"),
        ("s_done", "2026-05-20T00:00:01Z"),
    ] {
        seed_project_session(&pool, id, "proj_batch", id, "idle", ts).await;
    }
    drop(pool);

    let socket_path = td.path().join(format!("galley-{}.sock", current_uid()));
    let (server, probes) = fake_core(
        socket_path,
        vec![serde_json::json!({"sessions": [
            run_state("s_busy", true, false),
            run_state("s_step", false, true),
            run_state("s_done", false, false),
        ]})],
    );
    let (stdout, code) = run_galley_isolated(&db, td.path(), &["project", "brief", "proj_batch"]);
    server.abort();
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let payload: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(payload["statusCounts"]["idle"], 3);
    let running: Vec<&str> = payload["runningSessions"]
        .as_array()
        .expect("runningSessions")
        .iter()
        .map(|s| s["id"].as_str().expect("id"))
        .collect();
    assert_eq!(running, ["s_busy", "s_step"]);
    assert_eq!(probes.lock().unwrap().len(), 1);
}

// ---------------- llm.* (mixed: SQLite reads + socket writes) ----------------
//
// The three `llm_list_*` cache tests below pin `--runtime external`: the
// seeded DB's `active_runtime_kind` is `managed` (migration 008 default),
// so the default `current` scope would read the Galley model store.

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

    let (stdout, code) =
        run_galley_isolated(&db, td.path(), &["llm", "list", "--runtime", "external"]);
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
    let (stdout, code) =
        run_galley_isolated(&db, td.path(), &["llm", "list", "--runtime", "external"]);
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

    let (stdout, code) =
        run_galley_isolated(&db, td.path(), &["llm", "list", "--runtime", "external"]);
    assert_eq!(code, Some(2), "stdout: {stdout}");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(parsed["error"], "invalid_args");
}

async fn set_active_runtime(pool: &SqlitePool, kind: &str) {
    sqlx::query(
        "INSERT INTO prefs (key, value, updated_at) VALUES ('active_runtime_kind', ?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(format!("\"{kind}\""))
    .bind("2026-09-30T00:00:00Z")
    .execute(pool)
    .await
    .expect("set active runtime");
}

/// Seed one managed provider. `with_secret` stores a (dummy) encrypted
/// secret row, which is all `credential_status` looks at.
async fn seed_managed_provider(pool: &SqlitePool, id: &str, with_secret: bool) {
    let ts = "2026-09-30T00:00:00Z";
    let api_key_ref = format!("managed-provider:{id}");
    sqlx::query(
        "INSERT INTO managed_model_providers \
           (id, display_name, protocol, auth_kind, api_base, api_key_ref, created_at, updated_at) \
         VALUES (?, ?, 'openai', 'api_key', 'https://example.test/v1', ?, ?, ?)",
    )
    .bind(id)
    .bind(id)
    .bind(&api_key_ref)
    .bind(ts)
    .bind(ts)
    .execute(pool)
    .await
    .expect("seed managed provider");
    if with_secret {
        sqlx::query(
            "INSERT OR IGNORE INTO managed_model_secret_keys (key_id, key_material, created_at) \
             VALUES ('test-key', zeroblob(32), ?)",
        )
        .bind(ts)
        .execute(pool)
        .await
        .expect("seed secret key");
        sqlx::query(
            "INSERT INTO managed_model_secrets \
               (api_key_ref, key_id, algorithm, nonce, ciphertext, created_at, updated_at) \
             VALUES (?, 'test-key', 'test', zeroblob(12), x'00', ?, ?)",
        )
        .bind(&api_key_ref)
        .bind(ts)
        .bind(ts)
        .execute(pool)
        .await
        .expect("seed secret");
    }
}

async fn seed_managed_model(
    pool: &SqlitePool,
    id: &str,
    provider_id: &str,
    display_name: &str,
    model: &str,
    sort_order: i64,
    is_default: bool,
) {
    let ts = "2026-09-30T00:00:00Z";
    sqlx::query(
        "INSERT INTO managed_models \
           (id, provider_id, display_name, model, is_default, sort_order, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(provider_id)
    .bind(display_name)
    .bind(model)
    .bind(i64::from(is_default))
    .bind(sort_order)
    .bind(ts)
    .bind(ts)
    .execute(pool)
    .await
    .expect("seed managed model");
}

fn ndjson(stdout: &str) -> Vec<serde_json::Value> {
    stdout
        .trim()
        .lines()
        .map(|line| serde_json::from_str(line).expect("ndjson line"))
        .collect()
}

/// A managed model store plus a stale external cache — the shape of the
/// bug: the external cache must not leak into the managed answer.
async fn seed_managed_store_and_stale_external_cache(pool: &SqlitePool) {
    seed_managed_provider(pool, "mp_key", true).await;
    seed_managed_provider(pool, "mp_nokey", false).await;
    seed_managed_model(
        pool,
        "mm_sol",
        "mp_key",
        "GPT 6.1 Sol",
        "gpt-6.1-sol",
        0,
        true,
    )
    .await;
    seed_managed_model(pool, "mm_nokey", "mp_nokey", "No Key", "nokey-1", 1, false).await;
    seed_managed_model(pool, "mm_blank", "mp_key", "  ", "glm-5.3-flash", 2, false).await;
    seed_pref(
        pool,
        "llm_list",
        r#"[{"index":0,"name":"gpt-6-astra"},{"index":1,"name":"glm-5.3-flash","isCurrent":true}]"#,
    )
    .await;
}

#[tokio::test]
async fn llm_list_managed_reads_model_store_with_llm_set_rules() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_managed_store_and_stale_external_cache(&pool).await;
    drop(pool);

    let expected = vec![
        serde_json::json!({
            "index": 0, "name": "GPT 6.1 Sol", "key": "mm_sol",
            "displayName": "GPT 6.1 Sol", "isCurrent": true,
        }),
        // Missing-credential model skipped without consuming an index;
        // blank display name falls back to the model id.
        serde_json::json!({
            "index": 1, "name": "glm-5.3-flash", "key": "mm_blank",
            "displayName": "glm-5.3-flash", "isCurrent": false,
        }),
    ];
    for args in [
        &["llm", "list", "--runtime", "managed"][..],
        // Seeded DB's active runtime is managed, so the default follows it.
        &["llm", "list"][..],
    ] {
        let (stdout, code) = run_galley_isolated(&db, td.path(), args);
        assert_eq!(code, Some(0), "{args:?} stdout: {stdout}");
        assert_eq!(ndjson(&stdout), expected, "{args:?}");
        // Managed rows have a fixed key order.
        assert!(
            stdout.starts_with(r#"{"index":0,"name":"GPT 6.1 Sol","key":"mm_sol","displayName":"GPT 6.1 Sol","isCurrent":true}"#),
            "{args:?} stdout: {stdout}"
        );
    }
}

#[tokio::test]
async fn llm_list_managed_current_falls_back_when_default_lacks_credential() {
    // The default model has no credential: the runtime skips it, so the
    // first usable model is what an unpicked runtime starts with.
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_managed_provider(&pool, "mp_key", true).await;
    seed_managed_provider(&pool, "mp_nokey", false).await;
    seed_managed_model(
        &pool,
        "mm_default",
        "mp_nokey",
        "Default",
        "default-1",
        0,
        true,
    )
    .await;
    seed_managed_model(&pool, "mm_next", "mp_key", "Next", "next-1", 1, false).await;
    drop(pool);

    let (stdout, code) =
        run_galley_isolated(&db, td.path(), &["llm", "list", "--runtime", "managed"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let rows = ndjson(&stdout);
    assert_eq!(rows.len(), 1, "stdout: {stdout}");
    assert_eq!(rows[0]["key"], "mm_next");
    assert_eq!(rows[0]["index"], 0);
    assert_eq!(rows[0]["isCurrent"], true);
}

#[tokio::test]
async fn llm_list_managed_empty_store_returns_empty_stdout_exit_0() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    // A warm external cache must not stand in for the empty managed store.
    seed_pref(&pool, "llm_list", r#"[{"index":0,"name":"glm-4.5-x"}]"#).await;
    drop(pool);
    let (stdout, code) =
        run_galley_isolated(&db, td.path(), &["llm", "list", "--runtime", "managed"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    assert!(
        stdout.trim().is_empty(),
        "expected empty stdout, got: {stdout}"
    );
}

#[tokio::test]
async fn llm_list_current_follows_active_runtime_kind() {
    let td = tempdir();
    let db = td.path().join("test.db");
    let pool = seeded_db_at(&db).await;
    seed_managed_store_and_stale_external_cache(&pool).await;

    set_active_runtime(&pool, "external").await;
    let (stdout, code) = run_galley_isolated(&db, td.path(), &["llm", "list"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    // External scope prints the cache as stored.
    assert_eq!(
        stdout,
        "{\"index\":0,\"name\":\"gpt-6-astra\"}\n{\"index\":1,\"name\":\"glm-5.3-flash\",\"isCurrent\":true}\n"
    );

    set_active_runtime(&pool, "managed").await;
    drop(pool);
    let (stdout, code) = run_galley_isolated(&db, td.path(), &["llm", "list"]);
    assert_eq!(code, Some(0), "stdout: {stdout}");
    let keys: Vec<serde_json::Value> = ndjson(&stdout)
        .iter()
        .map(|row| row["key"].clone())
        .collect();
    assert_eq!(keys, vec!["mm_sol", "mm_blank"]);
}

#[tokio::test]
async fn llm_list_rejects_runtime_all() {
    let td = tempdir();
    let db = td.path().join("test.db");
    drop(seeded_db_at(&db).await);
    let (stdout, code) = run_galley_isolated(&db, td.path(), &["llm", "list", "--runtime", "all"]);
    assert_eq!(code, Some(2), "stdout: {stdout}");
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).expect("json");
    assert_eq!(parsed["error"], "invalid_args");
    assert!(
        parsed["message"]
            .as_str()
            .unwrap_or("")
            .starts_with("llm list: --runtime all"),
        "stdout: {stdout}"
    );
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
