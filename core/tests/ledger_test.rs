//! Affairs ledger (`galley_core_lib::ledger`, .scratch/main-chat ticket
//! 01) against an in-memory DB, a temp managed state root and a scripted
//! fake runner registry:
//!
//! - which turns are read: GUI-created managed sessions only, the
//!   human's messages only, from `since`, minus "not used to understand
//!   me" sessions and projects; never CLI / supervisor / system sessions;
//! - the marks themselves (migration 045);
//! - one run end to end: attach mode does nothing, nothing new costs no
//!   model call, the hidden session, and the processed position moving
//!   only after a run that completed successfully.
//!
//! The pure parts (IM log parsing, batch layout, the run verdict, the
//! daily due rule) are unit-tested next to their code.

use async_trait::async_trait;
use chrono::{DateTime, FixedOffset, Utc};
use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, Origin, OriginVia, RuntimeKind, SessionFilter, SessionId,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::ipc::{IpcCommand, IpcEvent, RunCompleteEvent};
use galley_core_lib::ledger::config::SWITCH_PREF;
use galley_core_lib::ledger::control::{
    self, LedgerControl, SwitchChange, LEDGER_BUSY, MANAGED_ONLY, NOT_FOUND,
};
use galley_core_lib::ledger::im_archive::FILE_HINT;
use galley_core_lib::ledger::state::LedgerState;
use galley_core_lib::ledger::{
    forgotten, global_memory, is_mining_session, run, sources, LedgerConfig, LedgerPaths,
    LedgerSwitch, LedgerTarget, MiningDeps, RunReport, Trigger, LEDGER_SUPERVISOR,
};
use galley_core_lib::runner_manager::{
    BroadcastItem, RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::session_runner::SpawnEnv;
use galley_core_lib::socket_listener::RunnerPort;
use serde_json::json;
use sqlx::SqlitePool;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::broadcast;

// ---------------- fixtures ----------------

async fn fresh() -> (SqlitePool, SqliteGalley) {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    galley_core_lib::apply_all_migrations_for_tests(&pool)
        .await
        .expect("migrate");
    let galley = SqliteGalley::from_pool(pool.clone());
    galley
        .set_pref_json("active_runtime_kind", json!("managed"))
        .await
        .expect("managed runtime");
    (pool, galley)
}

async fn project(pool: &SqlitePool, id: &str) {
    sqlx::query(
        "INSERT INTO projects (id, name, last_activity_at, created_at, updated_at) \
         VALUES (?, ?, '2026-10-01T00:00:00+00:00', '2026-10-01T00:00:00+00:00', '2026-10-01T00:00:00+00:00')",
    )
    .bind(id)
    .bind(id)
    .execute(pool)
    .await
    .expect("insert project");
}

async fn session(pool: &SqlitePool, id: &str, via: &str, runtime: &str, project: Option<&str>) {
    sqlx::query(
        "INSERT INTO sessions (id, project_id, title, status, last_activity_at, created_at, \
           updated_at, created_via, ga_runtime_kind) \
         VALUES (?, ?, 't', 'idle', '2026-10-01T00:00:00+00:00', '2026-10-01T00:00:00+00:00', \
           '2026-10-01T00:00:00+00:00', ?, ?)",
    )
    .bind(id)
    .bind(project)
    .bind(via)
    .bind(runtime)
    .execute(pool)
    .await
    .expect("insert session");
}

#[allow(clippy::too_many_arguments)]
async fn message(
    pool: &SqlitePool,
    session: &str,
    turn: i64,
    role: &str,
    via: &str,
    visibility: &str,
    at: &str,
    content: &str,
) {
    sqlx::query(
        "INSERT INTO messages (id, session_id, turn_index, sequence, role, content, created_at, \
           created_via, visibility) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)",
    )
    .bind(format!("msg_{session}_{turn}_{role}"))
    .bind(session)
    .bind(turn)
    .bind(role)
    .bind(content)
    .bind(at)
    .bind(via)
    .bind(visibility)
    .execute(pool)
    .await
    .expect("insert message");
}

/// A human says `text` in GUI session `session` at `at`.
async fn said(pool: &SqlitePool, session: &str, turn: i64, at: &str, text: &str) {
    message(pool, session, turn, "user", "gui", "visible", at, text).await;
}

fn shanghai() -> FixedOffset {
    FixedOffset::east_opt(8 * 3600).unwrap()
}

fn config() -> LedgerConfig {
    LedgerConfig {
        // 2026-10-10 00:00 in Shanghai.
        since: "2026-10-09T16:00:00Z".parse().unwrap(),
        look_back: false,
    }
}

fn utc(s: &str) -> DateTime<Utc> {
    s.parse().unwrap()
}

/// The full mix of sessions the selection rule has to sort out.
async fn seed_mix(pool: &SqlitePool) {
    project(pool, "p-private").await;
    session(pool, "s-gui", "gui", "managed", None).await;
    session(pool, "s-external", "gui", "external", None).await;
    session(pool, "s-cli", "cli", "managed", None).await;
    session(pool, "s-supervisor", "supervisor", "managed", None).await;
    session(pool, "s-system", "system", "managed", None).await;
    session(pool, "s-excluded", "gui", "managed", None).await;
    session(pool, "s-in-private", "gui", "managed", Some("p-private")).await;

    said(
        pool,
        "s-gui",
        0,
        "2026-10-09T15:59:59+00:00",
        "since 之前的一句",
    )
    .await;
    said(
        pool,
        "s-gui",
        1,
        "2026-10-10T01:00:00+00:00",
        "我在准备十一月的半马",
    )
    .await;
    message(
        pool,
        "s-gui",
        2,
        "assistant",
        "gui",
        "visible",
        "2026-10-10T01:00:05+00:00",
        "助理的回答",
    )
    .await;
    // A supervisor typed into the human's session through the CLI.
    message(
        pool,
        "s-gui",
        3,
        "user",
        "cli",
        "visible",
        "2026-10-10T01:10:00+00:00",
        "CLI 写进来的",
    )
    .await;
    message(
        pool,
        "s-gui",
        4,
        "user",
        "gui",
        "internal",
        "2026-10-10T01:20:00+00:00",
        "内部消息",
    )
    .await;
    // The GUI's older millisecond `Z` shape still parses.
    said(pool, "s-gui", 5, "2026-10-10T02:00:00.123Z", "周六去看房").await;
    said(
        pool,
        "s-external",
        0,
        "2026-10-10T01:00:00+00:00",
        "外置内核里说的",
    )
    .await;
    said(
        pool,
        "s-cli",
        0,
        "2026-10-10T01:00:00+00:00",
        "CLI 会话的任务",
    )
    .await;
    said(
        pool,
        "s-supervisor",
        0,
        "2026-10-10T01:00:00+00:00",
        "supervisor 派的活",
    )
    .await;
    said(
        pool,
        "s-system",
        0,
        "2026-10-10T01:00:00+00:00",
        "系统建的会话",
    )
    .await;
    said(
        pool,
        "s-excluded",
        0,
        "2026-10-10T01:00:00+00:00",
        "这段不要用来了解我",
    )
    .await;
    said(
        pool,
        "s-in-private",
        0,
        "2026-10-10T01:00:00+00:00",
        "私人项目里的话",
    )
    .await;
}

/// [`seed_mix`] with its two "not used to understand me" marks set.
async fn seed_mix_marked(pool: &SqlitePool, galley: &SqliteGalley) {
    seed_mix(pool).await;
    for target in [
        LedgerTarget::Session("s-excluded".into()),
        LedgerTarget::Project("p-private".into()),
    ] {
        galley.set_ledger_excluded(&target, true).await.unwrap();
    }
}

fn texts(turns: &[sources::GuiTurn]) -> Vec<&str> {
    turns.iter().map(|t| t.text.as_str()).collect()
}

// ---------------- source selection ----------------

#[tokio::test]
async fn reads_only_what_a_human_typed_into_gui_managed_sessions_since() {
    let (pool, galley) = fresh().await;
    seed_mix(&pool).await;
    galley
        .set_ledger_excluded(&LedgerTarget::Session("s-excluded".into()), true)
        .await
        .unwrap();
    galley
        .set_ledger_excluded(&LedgerTarget::Project("p-private".into()), true)
        .await
        .unwrap();

    let since = config().since;
    let turns = sources::gui_turns(&galley, since, utc("2026-10-11T00:00:00Z"))
        .await
        .unwrap();
    assert_eq!(texts(&turns), vec!["我在准备十一月的半马", "周六去看房"]);
    assert!(turns.iter().all(|t| t.session_id == "s-gui"));
    assert_eq!(turns[1].at, utc("2026-10-10T02:00:00.123Z"));

    // `until` is exclusive.
    let turns = sources::gui_turns(&galley, since, utc("2026-10-10T02:00:00.123Z"))
        .await
        .unwrap();
    assert_eq!(texts(&turns), vec!["我在准备十一月的半马"]);

    // Unmarking brings them back.
    galley
        .set_ledger_excluded(&LedgerTarget::Session("s-excluded".into()), false)
        .await
        .unwrap();
    galley
        .set_ledger_excluded(&LedgerTarget::Project("p-private".into()), false)
        .await
        .unwrap();
    let turns = sources::gui_turns(&galley, since, utc("2026-10-11T00:00:00Z"))
        .await
        .unwrap();
    assert_eq!(turns.len(), 4);
}

#[tokio::test]
async fn exclusion_marks_are_idempotent_listed_and_go_with_their_target() {
    let (pool, galley) = fresh().await;
    project(&pool, "p1").await;
    session(&pool, "s1", "gui", "managed", Some("p1")).await;
    let s1 = LedgerTarget::Session("s1".into());
    let p1 = LedgerTarget::Project("p1".into());
    galley.set_ledger_excluded(&s1, true).await.unwrap();
    galley.set_ledger_excluded(&s1, true).await.unwrap();
    galley.set_ledger_excluded(&p1, true).await.unwrap();
    let marks = galley.list_ledger_exclusions().await.unwrap();
    assert_eq!(
        marks.iter().map(|m| m.target.clone()).collect::<Vec<_>>(),
        vec![s1.clone(), p1.clone()]
    );

    let missing = galley
        .set_ledger_excluded(&LedgerTarget::Session("nope".into()), true)
        .await
        .unwrap_err();
    assert!(missing.to_string().contains("not found"), "{missing}");

    // Deleting the session takes its mark; unmarking an unmarked target
    // is fine.
    sqlx::query("DELETE FROM sessions WHERE id = 's1'")
        .execute(&pool)
        .await
        .unwrap();
    galley.set_ledger_excluded(&p1, false).await.unwrap();
    galley.set_ledger_excluded(&p1, false).await.unwrap();
    assert!(galley.list_ledger_exclusions().await.unwrap().is_empty());
}

// ---------------- one run ----------------

/// Managed-runtime stand-in for the Tauri app.
struct FakeEnv;

#[async_trait]
impl SpawnEnv for FakeEnv {
    fn bundled_python(&self) -> Option<PathBuf> {
        None
    }
    fn bridge_cwd(&self) -> Result<PathBuf, String> {
        Ok(PathBuf::from("/galley"))
    }
    async fn prepare_managed(&self, mut args: SpawnArgs) -> Result<SpawnArgs, RunnerSpawnError> {
        args.ga_path = PathBuf::from("/managed/code");
        Ok(args)
    }
}

/// Fake registry: every spawn succeeds; dispatching the task writes
/// `writes` (the model editing the ledger) and plays `script` on the
/// session's broadcast.
struct FakeRunner {
    script: Vec<BroadcastItem>,
    writes: Vec<(PathBuf, String)>,
    channel: broadcast::Sender<BroadcastItem>,
    spawned: Mutex<Vec<SpawnArgs>>,
    tasks: Mutex<Vec<(String, String)>>,
    shutdowns: Mutex<Vec<String>>,
}

impl FakeRunner {
    fn new(script: Vec<BroadcastItem>) -> Self {
        Self::writing(script, Vec::new())
    }

    fn writing(script: Vec<BroadcastItem>, writes: Vec<(PathBuf, String)>) -> Self {
        Self {
            script,
            writes,
            channel: broadcast::channel(64).0,
            spawned: Mutex::new(Vec::new()),
            tasks: Mutex::new(Vec::new()),
            shutdowns: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait]
impl RunnerPort for FakeRunner {
    async fn spawn(
        &self,
        args: SpawnArgs,
        _active_session_id: Option<&str>,
    ) -> Result<u32, RunnerSpawnError> {
        self.spawned.lock().unwrap().push(args);
        Ok(4242)
    }
    async fn send_command(
        &self,
        session_id: &str,
        cmd: &IpcCommand,
    ) -> Result<(), SendCommandError> {
        if let IpcCommand::UserMessage(m) = cmd {
            self.tasks
                .lock()
                .unwrap()
                .push((session_id.to_string(), m.text.clone()));
            for (path, body) in &self.writes {
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, body).unwrap();
            }
            for item in &self.script {
                let _ = self.channel.send(item.clone());
            }
        }
        Ok(())
    }
    async fn subscribe(&self, _session_id: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        Some(self.channel.subscribe())
    }
    async fn pid(&self, _session_id: &str) -> Option<u32> {
        Some(4242)
    }
    async fn agent_running(&self, _session_id: &str) -> bool {
        false
    }
    async fn shutdown(
        &self,
        session_id: &str,
        _grace: Option<Duration>,
    ) -> Result<(), ShutdownError> {
        self.shutdowns.lock().unwrap().push(session_id.to_string());
        Ok(())
    }
}

fn run_complete(result: &str) -> BroadcastItem {
    BroadcastItem::Event(Box::new(IpcEvent::RunComplete(RunCompleteEvent {
        session_id: "x".into(),
        exit_reason: json!({ "result": result, "data": null }),
        final_content: "更新了 activities.md".into(),
        total_turns: 4,
        visibility: None,
        timestamp: "t".into(),
    })))
}

async fn run_at(
    galley: &SqliteGalley,
    runner: &FakeRunner,
    paths: &LedgerPaths,
    trigger: Trigger,
    now: &str,
) -> RunReport {
    let deps = MiningDeps {
        galley,
        runner,
        env: Some(&FakeEnv),
    };
    run::run_once(
        &deps,
        paths,
        &config(),
        trigger,
        utc(now),
        &shanghai(),
        Duration::from_secs(5),
        &run::RunHooks::default(),
    )
    .await
}

fn state(paths: &LedgerPaths) -> LedgerState {
    LedgerState::load(&paths.state_file()).unwrap()
}

async fn rows_of(pool: &SqlitePool, table: &str, session_id: &str) -> i64 {
    sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM {table} WHERE session_id = ?"
    ))
    .bind(session_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Rule 4: nothing of a mining session stays in the database — not the
/// row, not its messages, not its search-index rows.
async fn assert_session_gone(pool: &SqlitePool, galley: &SqliteGalley, session_id: &str) {
    assert!(
        galley
            .session_brief(SessionId(session_id.to_string()))
            .await
            .is_err(),
        "{session_id} is still there"
    );
    assert_eq!(rows_of(pool, "messages", session_id).await, 0);
    assert_eq!(rows_of(pool, "messages_fts", session_id).await, 0);
}

/// An IM turn in a native-protocol engine log, Shanghai wall time.
fn write_im_log(paths: &LedgerPaths, name: &str, ts: &str, words: &str) {
    let dir = paths.model_responses_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let block = json!({"type": "text", "text": format!("{FILE_HINT}\n\n{words}")});
    let body = format!(
        "=== Prompt === {ts}\n{{\"role\": \"user\", \"content\": [\n{block}]}}\n\n=== Response === {ts}\n[{{'type': 'text', 'text': '好的'}}]\n\n"
    );
    std::fs::write(dir.join(name), body).unwrap();
}

#[tokio::test]
async fn attach_mode_runs_nothing_and_writes_nothing() {
    let (pool, galley) = fresh().await;
    seed_mix(&pool).await;
    galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    let runner = FakeRunner::new(vec![run_complete("CURRENT_TASK_DONE")]);

    let report = run_at(
        &galley,
        &runner,
        &paths,
        Trigger::Manual,
        "2026-10-11T01:00:00Z",
    )
    .await;
    assert!(matches!(report, RunReport::Skipped { .. }), "{report:?}");
    assert!(!paths.state_root().exists());
    assert!(runner.spawned.lock().unwrap().is_empty());
}

#[tokio::test]
async fn nothing_new_moves_the_position_without_a_model_call() {
    let (_pool, galley) = fresh().await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    let runner = FakeRunner::new(vec![run_complete("CURRENT_TASK_DONE")]);

    let report = run_at(
        &galley,
        &runner,
        &paths,
        Trigger::Scheduled,
        "2026-10-11T01:00:00Z",
    )
    .await;
    assert_eq!(report, RunReport::Empty);
    assert!(runner.spawned.lock().unwrap().is_empty());
    let s = state(&paths);
    assert_eq!(s.mined.unwrap().gui_until, "2026-10-11T01:00:00+00:00");
    assert_eq!(s.last_attempt_date.as_deref(), Some("2026-10-11"));
    assert!(!paths.batch_file().exists());
}

#[tokio::test]
async fn a_successful_run_reads_the_batch_in_a_hidden_session_and_then_moves_the_position() {
    let (pool, galley) = fresh().await;
    seed_mix_marked(&pool, &galley).await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    write_im_log(
        &paths,
        "model_responses_100.txt",
        "2026-10-10 21:30:00",
        "飞书里说：周五体检",
    );
    let runner = FakeRunner::new(vec![run_complete("CURRENT_TASK_DONE")]);

    let report = run_at(
        &galley,
        &runner,
        &paths,
        Trigger::Scheduled,
        "2026-10-11T01:00:00Z",
    )
    .await;
    let RunReport::Succeeded { session_id, turns } = report else {
        panic!("{report:?}");
    };
    assert_eq!(turns, 3);

    // The batch: the human's words only, IM included, hint stripped.
    let batch = std::fs::read_to_string(paths.batch_file()).unwrap();
    for present in [
        "我在准备十一月的半马",
        "周六去看房",
        "飞书里说：周五体检",
        "SESSION: s-gui",
    ] {
        assert!(batch.contains(present), "{present} missing:\n{batch}");
    }
    for absent in [
        "since 之前",
        "助理的回答",
        "CLI 写进来的",
        "内部消息",
        "外置内核",
        "CLI 会话的任务",
        "supervisor 派的活",
        "系统建的会话",
        "这段不要用来了解我",
        "私人项目里的话",
        FILE_HINT,
    ] {
        assert!(!batch.contains(absent), "{absent} leaked:\n{batch}");
    }

    // The task: dispatched to the hidden session, pointing at the batch.
    let tasks = runner.tasks.lock().unwrap().clone();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0].0, session_id);
    assert!(tasks[0]
        .1
        .contains(&paths.batch_file().display().to_string()));
    assert!(tasks[0].1.contains("salient_mining_sop.md"));
    // Default model: no explicit choice.
    let spawned = runner.spawned.lock().unwrap();
    assert_eq!(
        (spawned[0].llm_index, spawned[0].llm_key.as_deref()),
        (None, None)
    );
    drop(spawned);

    // The session: runner stopped, then deleted with everything it held
    // (its origin while it runs: `switching_off_mid_run_…`).
    assert_eq!(
        runner.shutdowns.lock().unwrap().as_slice(),
        &[session_id.clone()]
    );
    assert_session_gone(&pool, &galley, &session_id).await;
    // Its own messages are never read back as the human's.
    let again = sources::gui_turns(
        &galley,
        utc("2026-10-01T00:00:00Z"),
        utc("2027-01-01T00:00:00Z"),
    )
    .await
    .unwrap();
    assert!(again.iter().all(|t| t.session_id == "s-gui"));
    let listed = galley
        .list_sessions(SessionFilter {
            project_id: None,
            status: None,
            archived: None,
            runtime_kind: None,
        })
        .await
        .unwrap();
    assert_eq!(listed.iter().filter(|s| is_mining_session(s)).count(), 0);
    // A successful run keeps what it wrote: no snapshot left.
    assert!(!paths.rollback_dir().exists());

    // The position moved to what the batch covered.
    let s = state(&paths);
    let mined = s.mined.expect("mined");
    assert_eq!(mined.gui_until, "2026-10-11T01:00:00+00:00");
    assert_eq!(
        mined.im_archive_offset,
        std::fs::metadata(paths.archive_file()).unwrap().len()
    );
    assert!(s.pending.is_none());
    assert_eq!(s.last_run.unwrap().outcome, "succeeded");

    // Next day, one new message: only it is in the next batch.
    said(
        &pool,
        "s-gui",
        6,
        "2026-10-11T03:00:00+00:00",
        "体检改到下周了",
    )
    .await;
    let runner2 = FakeRunner::new(vec![run_complete("CURRENT_TASK_DONE")]);
    let report = run_at(
        &galley,
        &runner2,
        &paths,
        Trigger::Scheduled,
        "2026-10-12T01:00:00Z",
    )
    .await;
    assert!(
        matches!(report, RunReport::Succeeded { turns: 1, .. }),
        "{report:?}"
    );
    let batch = std::fs::read_to_string(paths.batch_file()).unwrap();
    assert!(batch.contains("体检改到下周了"));
    assert!(!batch.contains("周六去看房"));
    assert!(!batch.contains("周五体检"));
}

#[tokio::test]
async fn a_failed_run_leaves_the_position_so_the_next_batch_repeats_it() {
    let (pool, galley) = fresh().await;
    seed_mix_marked(&pool, &galley).await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    write_im_log(
        &paths,
        "model_responses_100.txt",
        "2026-10-10 21:30:00",
        "周五体检",
    );

    for script in [
        vec![run_complete("ABORTED")],
        vec![run_complete("MAX_TURNS_EXCEEDED")],
        vec![BroadcastItem::Closed {
            code: Some(1),
            signal: None,
            quiet: false,
        }],
    ] {
        let runner = FakeRunner::new(script);
        let report = run_at(
            &galley,
            &runner,
            &paths,
            Trigger::Manual,
            "2026-10-11T01:00:00Z",
        )
        .await;
        let RunReport::Failed { session_id, .. } = report else {
            panic!("{report:?}");
        };
        // Wound down all the same: runner stopped, session deleted.
        assert_eq!(runner.shutdowns.lock().unwrap().len(), 1);
        assert_session_gone(&pool, &galley, &session_id.unwrap()).await;
        let s = state(&paths);
        assert!(s.mined.is_none(), "position must not move on failure");
        assert!(s.pending.is_none());
        assert_eq!(s.last_run.unwrap().outcome, "failed");
    }

    // The archive kept its own progress: the IM turn is archived once.
    let archive = std::fs::read_to_string(paths.archive_file()).unwrap();
    assert_eq!(archive.lines().count(), 1);

    // The next run gets the same turns again and, succeeding, moves on.
    let runner = FakeRunner::new(vec![run_complete("CURRENT_TASK_DONE")]);
    let report = run_at(
        &galley,
        &runner,
        &paths,
        Trigger::Manual,
        "2026-10-11T02:00:00Z",
    )
    .await;
    assert!(
        matches!(report, RunReport::Succeeded { turns: 3, .. }),
        "{report:?}"
    );
    assert!(state(&paths).mined.is_some());
}

#[tokio::test]
async fn scheduled_runs_once_a_day_manual_runs_whenever() {
    let (pool, galley) = fresh().await;
    seed_mix(&pool).await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));

    // 03:59 Shanghai: not yet.
    let runner = FakeRunner::new(vec![run_complete("CURRENT_TASK_DONE")]);
    let report = run_at(
        &galley,
        &runner,
        &paths,
        Trigger::Scheduled,
        "2026-10-10T19:59:00Z",
    )
    .await;
    assert!(matches!(report, RunReport::Skipped { .. }), "{report:?}");
    // 09:00 Shanghai: due, even after a failure it is not retried today.
    let failing = FakeRunner::new(vec![run_complete("ABORTED")]);
    let report = run_at(
        &galley,
        &failing,
        &paths,
        Trigger::Scheduled,
        "2026-10-11T01:00:00Z",
    )
    .await;
    assert!(matches!(report, RunReport::Failed { .. }), "{report:?}");
    let report = run_at(
        &galley,
        &runner,
        &paths,
        Trigger::Scheduled,
        "2026-10-11T05:00:00Z",
    )
    .await;
    assert!(matches!(report, RunReport::Skipped { .. }), "{report:?}");
    // A manual run is not bound by the day.
    let report = run_at(
        &galley,
        &runner,
        &paths,
        Trigger::Manual,
        "2026-10-11T05:00:00Z",
    )
    .await;
    assert!(matches!(report, RunReport::Succeeded { .. }), "{report:?}");
}

// ---------------- ticket 04: the switch, the cap, the page ----------------

async fn switch_on(galley: &SqliteGalley, config: LedgerConfig) {
    galley
        .set_pref_json(SWITCH_PREF, LedgerSwitch::On(config).to_pref().unwrap())
        .await
        .unwrap();
}

/// One attempt through the control, as the resident tick makes it.
#[allow(clippy::too_many_arguments)]
async fn control_run(
    control: &LedgerControl,
    galley: &SqliteGalley,
    runner: &FakeRunner,
    paths: &LedgerPaths,
    trigger: Trigger,
    now: &str,
    timeout: Duration,
) -> RunReport {
    let deps = MiningDeps {
        galley,
        runner,
        env: Some(&FakeEnv),
    };
    control
        .run(&deps, paths, trigger, utc(now), &shanghai(), timeout, None)
        .await
}

/// Until a run is going and its task has been dispatched.
async fn until_running(control: &LedgerControl, runner: &FakeRunner) {
    for _ in 0..500 {
        if control.is_running() && !runner.tasks.lock().unwrap().is_empty() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("the run never got going");
}

fn files_under(dir: &std::path::Path) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            out.extend(files_under(&path));
        } else {
            out.push(path.display().to_string());
        }
    }
    out
}

#[tokio::test]
async fn undecided_or_off_runs_nothing_and_creates_nothing() {
    let (pool, galley) = fresh().await;
    seed_mix(&pool).await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    let control = LedgerControl::new();
    let runner = FakeRunner::new(vec![run_complete("CURRENT_TASK_DONE")]);

    assert_eq!(
        control::get_switch(&galley).await.unwrap(),
        LedgerSwitch::Undecided
    );
    for _ in 0..2 {
        let report = control_run(
            &control,
            &galley,
            &runner,
            &paths,
            Trigger::Manual,
            "2026-10-11T01:00:00Z",
            Duration::from_secs(5),
        )
        .await;
        assert!(matches!(report, RunReport::Skipped { .. }), "{report:?}");
        galley
            .set_pref_json(SWITCH_PREF, json!({"on": false}))
            .await
            .unwrap();
    }
    assert!(!paths.state_root().exists());
    assert!(runner.spawned.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_external_runtime_gets_managed_only_from_every_page_command() {
    let (pool, galley) = fresh().await;
    seed_mix(&pool).await;
    galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    let control = LedgerControl::new();
    let now = utc("2026-10-11T01:00:00Z");
    let only = Err::<(), String>(MANAGED_ONLY.into());

    assert_eq!(control::get_switch(&galley).await.map(|_| ()), only);
    assert_eq!(
        control
            .overview(&galley, &paths, now, &shanghai())
            .await
            .map(|_| ()),
        only
    );
    for change in [
        SwitchChange::Enable { look_back: true },
        SwitchChange::Disable { clear: true },
    ] {
        assert_eq!(
            control
                .set_switch(&galley, &paths, change, now)
                .await
                .map(|_| ()),
            only
        );
    }
    assert_eq!(
        control.delete_entry(&galley, &paths, "A001", now).await,
        only
    );
    assert_eq!(control.unforget(&galley, &paths, "A001").await, only);
    assert_eq!(
        control
            .write_global_memory(&galley, &paths, "global_mem.txt", "x", "r")
            .await
            .map(|_| ()),
        only
    );
    // Nothing read into existence, nothing written, the switch untouched.
    assert!(!dir.path().join("managed-ga-state").exists());
    assert_eq!(galley.get_pref_json(SWITCH_PREF).await.unwrap(), None);
}

#[tokio::test]
async fn turning_on_from_now_skips_what_was_said_before_and_waits_for_four() {
    let (pool, galley) = fresh().await;
    seed_mix(&pool).await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    let control = LedgerControl::new();

    // 2026-10-11 10:00 in Shanghai: everything seeded is earlier.
    let switch = control
        .set_switch(
            &galley,
            &paths,
            SwitchChange::Enable { look_back: false },
            utc("2026-10-11T02:00:00.600Z"),
        )
        .await
        .unwrap();
    assert_eq!(
        serde_json::to_value(switch).unwrap(),
        json!({"state": "on", "since": "2026-10-11T02:00:00+00:00", "lookBack": false})
    );
    assert_eq!(control::get_switch(&galley).await.unwrap(), switch);
    // Nothing written on the way: "from now" has nothing to schedule.
    assert!(!paths.state_root().exists());

    said(
        &pool,
        "s-gui",
        10,
        "2026-10-11T03:00:00+00:00",
        "打开之后说的",
    )
    .await;
    let runner = FakeRunner::new(vec![run_complete("CURRENT_TASK_DONE")]);
    // Same day, after it was turned on: not due.
    let report = control_run(
        &control,
        &galley,
        &runner,
        &paths,
        Trigger::Scheduled,
        "2026-10-11T08:00:00Z",
        Duration::from_secs(5),
    )
    .await;
    assert!(matches!(report, RunReport::Skipped { .. }), "{report:?}");
    // Next day, 04:00 Shanghai.
    let report = control_run(
        &control,
        &galley,
        &runner,
        &paths,
        Trigger::Scheduled,
        "2026-10-11T20:00:00Z",
        Duration::from_secs(5),
    )
    .await;
    assert!(
        matches!(report, RunReport::Succeeded { turns: 1, .. }),
        "{report:?}"
    );
    let batch = std::fs::read_to_string(paths.batch_file()).unwrap();
    assert!(batch.contains("打开之后说的"));
    assert!(!batch.contains("我在准备十一月的半马"));
}

#[tokio::test]
async fn turning_on_with_look_back_reads_everything_within_a_minute() {
    let (pool, galley) = fresh().await;
    seed_mix_marked(&pool, &galley).await;
    said(
        &pool,
        "s-gui",
        10,
        "2025-01-01T00:00:00+00:00",
        "很久以前说的",
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    let control = LedgerControl::new();
    let now = "2026-10-11T02:00:00Z"; // 10:00 Shanghai
    let switch = control
        .set_switch(
            &galley,
            &paths,
            SwitchChange::Enable { look_back: true },
            utc(now),
        )
        .await
        .unwrap();
    assert_eq!(switch.config().unwrap().since.timestamp(), 0);
    assert_eq!(
        state(&paths).due_at.as_deref(),
        Some("2026-10-11T02:00:00+00:00")
    );

    let runner = FakeRunner::new(vec![run_complete("CURRENT_TASK_DONE")]);
    let report = control_run(
        &control,
        &galley,
        &runner,
        &paths,
        Trigger::Scheduled,
        "2026-10-11T02:00:30Z",
        Duration::from_secs(5),
    )
    .await;
    // The three said from 2026-10-10 on, and the one long before.
    assert!(
        matches!(report, RunReport::Succeeded { turns: 4, .. }),
        "{report:?}"
    );
    let batch = std::fs::read_to_string(paths.batch_file()).unwrap();
    assert!(batch.contains("很久以前说的"));
    assert!(batch.contains("since 之前的一句"));
    // Exclusions still hold with no lower bound.
    assert!(!batch.contains("私人项目里的话"));
    assert_eq!(state(&paths).due_at, None);
}

#[tokio::test]
async fn the_read_cap_splits_a_long_history_and_the_rest_follows_ten_minutes_later() {
    let (pool, galley) = fresh().await;
    session(&pool, "s-long", "gui", "managed", None).await;
    let block = |c: &str| c.repeat(run::READ_CAP_CHARS / 3);
    for (turn, (at, ch)) in [
        ("2026-10-10T01:00:00+00:00", "甲"),
        ("2026-10-10T02:00:00+00:00", "乙"),
        ("2026-10-10T03:00:00+00:00", "丙"),
        ("2026-10-10T04:00:00+00:00", "丁"),
    ]
    .into_iter()
    .enumerate()
    {
        said(&pool, "s-long", turn as i64, at, &block(ch)).await;
    }
    switch_on(&galley, config()).await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    let control = LedgerControl::new();
    let runner = FakeRunner::new(vec![run_complete("CURRENT_TASK_DONE")]);
    let run_at_time = |now: &'static str| {
        control_run(
            &control,
            &galley,
            &runner,
            &paths,
            Trigger::Scheduled,
            now,
            Duration::from_secs(5),
        )
    };

    // Three blocks are exactly the cap; the fourth waits.
    let report = run_at_time("2026-10-11T01:00:00Z").await;
    assert!(
        matches!(report, RunReport::Succeeded { turns: 3, .. }),
        "{report:?}"
    );
    let batch = std::fs::read_to_string(paths.batch_file()).unwrap();
    assert!(batch.contains(&block("丙")) && !batch.contains("丁"));
    let s = state(&paths);
    assert_eq!(
        s.mined.as_ref().unwrap().gui_until,
        "2026-10-10T04:00:00+00:00"
    );
    let due_at: DateTime<Utc> = s.due_at.as_deref().unwrap().parse().unwrap();
    let after = due_at - utc("2026-10-11T01:00:00Z");
    assert!(
        after >= chrono::Duration::minutes(10) && after < chrono::Duration::minutes(11),
        "{after:?}"
    );

    // Not before the ten minutes, then the rest.
    let report = run_at_time("2026-10-11T01:05:00Z").await;
    assert!(matches!(report, RunReport::Skipped { .. }), "{report:?}");
    let report = run_at_time("2026-10-11T01:11:00Z").await;
    assert!(
        matches!(report, RunReport::Succeeded { turns: 1, .. }),
        "{report:?}"
    );
    let batch = std::fs::read_to_string(paths.batch_file()).unwrap();
    assert!(batch.contains(&block("丁")) && !batch.contains("甲"));
    let s = state(&paths);
    assert_eq!(s.due_at, None);
    assert_eq!(
        s.mined.unwrap().gui_until,
        "2026-10-11T01:11:00+00:00",
        "read to the end"
    );
}

#[tokio::test]
async fn a_failed_run_with_more_to_read_waits_for_the_next_day() {
    let (pool, galley) = fresh().await;
    session(&pool, "s-long", "gui", "managed", None).await;
    for turn in 0..4 {
        said(
            &pool,
            "s-long",
            turn,
            &format!("2026-10-10T0{}:00:00+00:00", turn + 1),
            &"字".repeat(run::READ_CAP_CHARS / 3),
        )
        .await;
    }
    switch_on(&galley, config()).await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    let control = LedgerControl::new();
    let runner = FakeRunner::new(vec![run_complete("ABORTED")]);
    let report = control_run(
        &control,
        &galley,
        &runner,
        &paths,
        Trigger::Scheduled,
        "2026-10-11T01:00:00Z",
        Duration::from_secs(5),
    )
    .await;
    assert!(matches!(report, RunReport::Failed { .. }), "{report:?}");
    let s = state(&paths);
    assert_eq!((s.due_at, s.mined, s.pending_more), (None, None, false));
}

#[tokio::test]
async fn switching_off_mid_run_stops_it_and_clearing_leaves_nothing_behind() {
    let (pool, galley) = fresh().await;
    seed_mix(&pool).await;
    switch_on(&galley, config()).await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    std::fs::create_dir_all(paths.insight_dir()).unwrap();
    std::fs::write(paths.activities_file(), "## 持续活动\n### A001｜半马\n").unwrap();
    // A mining session archived before ticket 04 deleted them.
    old_mining_session(&galley, "s-old-mining").await;
    let control = LedgerControl::new();
    // A runner that writes half the ledger and never finishes on its own.
    let runner = FakeRunner::writing(Vec::new(), half_written(&paths));

    let (report, (switch, busy)) = tokio::join!(
        control_run(
            &control,
            &galley,
            &runner,
            &paths,
            Trigger::Manual,
            "2026-10-11T01:00:00Z",
            Duration::from_secs(60),
        ),
        async {
            until_running(&control, &runner).await;
            // While it runs, its session is a system one, ledger-labelled,
            // so the GUI and phone lists leave it out.
            let live = runner.tasks.lock().unwrap()[0].0.clone();
            let brief = galley.session_brief(SessionId(live)).await.unwrap();
            let origin = brief.origin.clone().expect("non-GUI origin");
            assert_eq!(origin.via, OriginVia::System);
            assert_eq!(origin.supervisor.as_deref(), Some(LEDGER_SUPERVISOR));
            assert!(is_mining_session(&brief));
            // A delete does not queue behind the run.
            let busy = control
                .delete_entry(&galley, &paths, "A001", utc("2026-10-11T01:00:01Z"))
                .await;
            let switch = control
                .set_switch(
                    &galley,
                    &paths,
                    SwitchChange::Disable { clear: true },
                    utc("2026-10-11T01:00:02Z"),
                )
                .await;
            (switch, busy)
        }
    );
    assert_eq!(busy, Err(LEDGER_BUSY.into()));
    assert_eq!(switch, Ok(LedgerSwitch::Off));
    let RunReport::Failed { reason, session_id } = report else {
        panic!("{report:?}");
    };
    assert_eq!(reason, run::STOPPED_REASON);
    // Its runner was shut down and its session deleted; so was the old one.
    let session_id = session_id.unwrap();
    assert_eq!(
        runner.shutdowns.lock().unwrap().as_slice(),
        &[session_id.clone()]
    );
    assert_session_gone(&pool, &galley, &session_id).await;
    assert_session_gone(&pool, &galley, "s-old-mining").await;
    // Everyone else's sessions are untouched.
    assert!(galley
        .session_brief(SessionId("s-gui".into()))
        .await
        .is_ok());
    assert!(rows_of(&pool, "messages", "s-gui").await > 0);
    // The run's rollback and last state write came before the clear:
    // nothing is back.
    assert!(
        !paths.insight_dir().exists(),
        "{:?}",
        files_under(dir.path())
    );
    assert!(!control.is_running());
    assert_eq!(
        galley.get_pref_json(SWITCH_PREF).await.unwrap(),
        Some(json!({"on": false}))
    );
}

/// What a run "writes" mid-way: one file rewritten, two created.
fn half_written(paths: &LedgerPaths) -> Vec<(PathBuf, String)> {
    vec![
        (paths.activities_file(), "# 活动知识层\n\n## 持续".into()),
        (
            paths.emotions_file(),
            "# 情绪事件\n\n## E001｜写了一".into(),
        ),
        (paths.affairs_file(), "- A001｜".into()),
    ]
}

/// A mining session as ticket 01 left them: archived, with its task
/// message (and so a search-index row).
async fn old_mining_session(galley: &SqliteGalley, id: &str) {
    let origin = Origin {
        via: OriginVia::System,
        supervisor: Some(LEDGER_SUPERVISOR.into()),
        reason: Some("affairs ledger mining".into()),
        client: None,
    };
    let mut tx = galley.begin_tx().await.unwrap();
    galley
        .create_session_in_tx(
            &mut tx,
            CreateSessionInput {
                id: id.into(),
                title: "事项账本整理 2026-10-01".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: Some(RuntimeKind::Managed),
                ga_runtime_id: None,
                prompt_profile: None,
            },
            origin.clone(),
        )
        .await
        .unwrap();
    galley
        .send_message_in_tx(
            &mut tx,
            SessionId(id.into()),
            "用户删掉过下面这些条目：A003｜日语 N3 备考".into(),
            origin.clone(),
        )
        .await
        .unwrap();
    tx.commit().await.unwrap();
    galley
        .archive_session(SessionId(id.into()), origin)
        .await
        .unwrap();
}

#[tokio::test]
async fn switching_off_and_keeping_leaves_the_files_and_the_position() {
    let (pool, galley) = fresh().await;
    seed_mix(&pool).await;
    switch_on(&galley, config()).await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    std::fs::create_dir_all(paths.insight_dir()).unwrap();
    let before = "## 持续活动\n### A001｜半马\n- 现状：在练\n";
    std::fs::write(paths.activities_file(), before).unwrap();
    let control = LedgerControl::new();
    let runner = FakeRunner::writing(Vec::new(), half_written(&paths));

    let (report, _) = tokio::join!(
        control_run(
            &control,
            &galley,
            &runner,
            &paths,
            Trigger::Manual,
            "2026-10-11T01:00:00Z",
            Duration::from_secs(60),
        ),
        async {
            until_running(&control, &runner).await;
            control
                .set_switch(
                    &galley,
                    &paths,
                    SwitchChange::Disable { clear: false },
                    utc("2026-10-11T01:00:02Z"),
                )
                .await
                .unwrap()
        }
    );
    assert!(matches!(report, RunReport::Failed { .. }), "{report:?}");
    let s = state(&paths);
    assert!(s.mined.is_none(), "a stopped run moves nothing");
    let last = s.last_run.unwrap();
    assert_eq!(
        (last.outcome.as_str(), last.detail.as_deref()),
        ("failed", Some(run::STOPPED_REASON))
    );
    assert!(paths.batch_file().exists());
    // No half-written state: the files are as the run found them.
    assert_eq!(
        std::fs::read_to_string(paths.activities_file()).unwrap(),
        before
    );
    assert!(!paths.emotions_file().exists());
    assert!(!paths.affairs_file().exists());
    assert!(!paths.rollback_dir().exists());

    // Off: the tick does nothing; on again, the position is where it was.
    let runner = FakeRunner::new(vec![run_complete("CURRENT_TASK_DONE")]);
    let report = control_run(
        &control,
        &galley,
        &runner,
        &paths,
        Trigger::Manual,
        "2026-10-11T02:00:00Z",
        Duration::from_secs(5),
    )
    .await;
    assert!(matches!(report, RunReport::Skipped { .. }), "{report:?}");
}

const ACTIVITIES: &str = "# 活动知识层

## 持续活动

### A001｜杭州半程马拉松备赛
- 现状：离半马还有八周。
- 最近：2026-09-27
- 会话：`s-gui`

### A002｜日语 N3 备考
- 现状：这周落后，下周补两课。
- 最近：2026-09-27
- 会话：`s-gui`

## 已消失事项

### A003｜中秋活动页
- 现状：9 月 16 日上线。
";

const EMOTIONS: &str = "# 情绪事件

## E001｜手术等待时的焦急
- 时间：2026-09-10 15:40
- 原文：“手术还没出来”
";

fn write_outputs(paths: &LedgerPaths) {
    std::fs::create_dir_all(paths.insight_dir()).unwrap();
    std::fs::write(paths.activities_file(), ACTIVITIES).unwrap();
    std::fs::write(paths.emotions_file(), EMOTIONS).unwrap();
    std::fs::write(
        paths.affairs_file(),
        "- A001｜半马备赛：离比赛八周\n- A002｜日语 N3：下周补两课\n",
    )
    .unwrap();
}

#[tokio::test]
async fn deleting_an_entry_is_exact_and_the_next_task_lists_it() {
    let (pool, galley) = fresh().await;
    seed_mix(&pool).await;
    switch_on(&galley, config()).await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    write_outputs(&paths);
    let control = LedgerControl::new();
    let now = utc("2026-10-11T01:00:00Z");

    control
        .delete_entry(&galley, &paths, "A002", now)
        .await
        .unwrap();
    let start = ACTIVITIES.find("### A002").unwrap();
    let end = ACTIVITIES.find("## 已消失事项").unwrap();
    assert_eq!(
        std::fs::read_to_string(paths.activities_file()).unwrap(),
        format!("{}{}", &ACTIVITIES[..start], &ACTIVITIES[end..])
    );
    assert_eq!(
        std::fs::read_to_string(paths.affairs_file()).unwrap(),
        "- A001｜半马备赛：离比赛八周\n"
    );
    let list = forgotten::load(&paths.forgotten_file()).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(
        (list[0].id.as_str(), list[0].title.as_str()),
        ("A002", "日语 N3 备考")
    );
    assert_eq!(list[0].deleted_at, "2026-10-11T01:00:00+00:00");

    // Gone is gone; ids that are no entry are not found.
    for id in ["A002", "A999", "X1", ""] {
        assert_eq!(
            control.delete_entry(&galley, &paths, id, now).await,
            Err(NOT_FOUND.into()),
            "{id}"
        );
    }
    control
        .delete_entry(&galley, &paths, "E001", now)
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(paths.emotions_file()).unwrap(),
        "# 情绪事件\n\n"
    );

    // The next run's task tells the model what not to rebuild.
    let runner = FakeRunner::new(vec![run_complete("CURRENT_TASK_DONE")]);
    let report = control_run(
        &control,
        &galley,
        &runner,
        &paths,
        Trigger::Manual,
        "2026-10-11T02:00:00Z",
        Duration::from_secs(5),
    )
    .await;
    assert!(matches!(report, RunReport::Succeeded { .. }), "{report:?}");
    let task = runner.tasks.lock().unwrap()[0].1.clone();
    assert!(task.contains("用户删掉过下面这些条目"), "{task}");
    assert!(task.contains("\nA002｜日语 N3 备考\n"), "{task}");
    assert!(task.contains("\nE001｜手术等待时的焦急\n"), "{task}");

    // "Unforget" takes it off the list, and only that.
    control.unforget(&galley, &paths, "A002").await.unwrap();
    control.unforget(&galley, &paths, "A002").await.unwrap();
    let list = forgotten::load(&paths.forgotten_file()).unwrap();
    assert_eq!(
        list.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        ["E001"]
    );
}

#[tokio::test]
async fn the_overview_shows_the_switch_the_entries_the_marks_and_the_global_memory() {
    let (pool, galley) = fresh().await;
    seed_mix_marked(&pool, &galley).await;
    sqlx::query(
        "UPDATE sessions SET title = '私密会话', status = 'archived' WHERE id = 's-excluded'",
    )
    .execute(&pool)
    .await
    .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    let control = LedgerControl::new();
    let now = utc("2026-10-11T02:00:00Z"); // 10:00 Shanghai

    // Undecided, nothing on disk: reading creates nothing.
    let overview = serde_json::to_value(
        control
            .overview(&galley, &paths, now, &shanghai())
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(overview["ledger"]["switch"], json!({"state": "undecided"}));
    assert_eq!(overview["ledger"]["running"], json!(false));
    assert_eq!(overview["ledger"]["activities"], json!({"kind": "absent"}));
    assert_eq!(overview["ledger"]["emotions"], json!({"kind": "absent"}));
    assert!(overview["ledger"].get("nextRunAt").is_none());
    assert!(overview["ledger"].get("lastRun").is_none());
    assert_eq!(
        overview["ledger"]["exclusions"],
        json!([
            {"target": {"kind": "session", "id": "s-excluded"},
             "createdAt": overview["ledger"]["exclusions"][0]["createdAt"],
             "title": "私密会话"},
            {"target": {"kind": "project", "id": "p-private"},
             "createdAt": overview["ledger"]["exclusions"][1]["createdAt"],
             "title": "p-private"},
        ])
    );
    assert_eq!(
        overview["globalMemory"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| (f["name"].clone(), f["exists"].clone()))
            .collect::<Vec<_>>(),
        vec![
            (json!("global_mem.txt"), json!(false)),
            (json!("global_mem_insight.txt"), json!(false)),
        ]
    );
    assert!(!paths.state_root().exists());

    // On, with outputs and an interrupted run on record.
    switch_on(&galley, config()).await;
    write_outputs(&paths);
    let mut s = LedgerState::default();
    s.last_attempt_date = Some("2026-10-11".into());
    s.last_run = Some(galley_core_lib::ledger::state::LastRun {
        started_at: "2026-10-10T20:00:00+00:00".into(),
        outcome: "running".into(),
        detail: None,
        turns: 7,
    });
    s.save(&paths.state_file()).unwrap();
    std::fs::write(
        paths.memory_dir().join("global_mem.txt"),
        "# [Global Memory - L2]\n",
    )
    .unwrap();

    let overview = serde_json::to_value(
        control
            .overview(&galley, &paths, now, &shanghai())
            .await
            .unwrap(),
    )
    .unwrap();
    let ledger = &overview["ledger"];
    assert_eq!(ledger["switch"]["state"], json!("on"));
    assert_eq!(ledger["lastRun"]["outcome"], json!("failed"));
    assert_eq!(ledger["lastRun"]["turns"], json!(7));
    assert!(ledger["lastRun"]["detail"]
        .as_str()
        .unwrap()
        .starts_with("interrupted"));
    // Attempted today: tomorrow 04:00 Shanghai.
    assert_eq!(ledger["nextRunAt"], json!("2026-10-11T20:00:00+00:00"));
    assert_eq!(ledger["activities"]["kind"], json!("parsed"));
    assert_eq!(ledger["activities"]["ongoing"][1]["id"], json!("A002"));
    assert_eq!(
        ledger["activities"]["ended"][0]["title"],
        json!("中秋活动页")
    );
    assert_eq!(
        ledger["emotions"]["entries"][0]["at"],
        json!("2026-09-10 15:40")
    );
    assert_eq!(ledger["forgotten"], json!([]));
    let gm = &overview["globalMemory"][0];
    assert_eq!(gm["exists"], json!(true));
    assert_eq!(gm["content"], json!("# [Global Memory - L2]\n"));

    // An edit from that revision lands; a stale one is refused.
    let revision = gm["revision"].as_str().unwrap();
    let next = control
        .write_global_memory(&galley, &paths, "global_mem.txt", "改过的\n", revision)
        .await
        .unwrap();
    assert_eq!(next, global_memory::revision("改过的\n".as_bytes()));
    assert_eq!(
        control
            .write_global_memory(&galley, &paths, "global_mem.txt", "再改", revision)
            .await,
        Err(control::CHANGED_ON_DISK.into())
    );
    assert_eq!(
        control
            .write_global_memory(&galley, &paths, "other.txt", "x", revision)
            .await,
        Err(NOT_FOUND.into())
    );
}

// ---------------- ticket 04: nothing in the database, nothing half-done ----------------

#[tokio::test]
async fn a_failed_run_puts_the_files_back_and_a_successful_one_keeps_them() {
    let (pool, galley) = fresh().await;
    seed_mix(&pool).await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    std::fs::create_dir_all(paths.insight_dir()).unwrap();
    let before = "## 持续活动\n### A001｜半马\n";
    std::fs::write(paths.activities_file(), before).unwrap();

    for script in [
        vec![run_complete("ABORTED")],
        vec![run_complete("MAX_TURNS_EXCEEDED")],
        vec![BroadcastItem::Closed {
            code: Some(1),
            signal: None,
            quiet: false,
        }],
    ] {
        let runner = FakeRunner::writing(script, half_written(&paths));
        let report = run_at(
            &galley,
            &runner,
            &paths,
            Trigger::Manual,
            "2026-10-11T01:00:00Z",
        )
        .await;
        assert!(matches!(report, RunReport::Failed { .. }), "{report:?}");
        assert_eq!(
            std::fs::read_to_string(paths.activities_file()).unwrap(),
            before
        );
        assert!(!paths.emotions_file().exists());
        assert!(!paths.affairs_file().exists());
        assert!(!paths.rollback_dir().exists());
        assert!(state(&paths).mined.is_none());
    }

    // The same batch again, now succeeding: what it wrote stays.
    let runner = FakeRunner::writing(
        vec![run_complete("CURRENT_TASK_DONE")],
        half_written(&paths),
    );
    let report = run_at(
        &galley,
        &runner,
        &paths,
        Trigger::Manual,
        "2026-10-11T02:00:00Z",
    )
    .await;
    assert!(matches!(report, RunReport::Succeeded { .. }), "{report:?}");
    assert_eq!(
        std::fs::read_to_string(paths.affairs_file()).unwrap(),
        "- A001｜"
    );
    assert!(paths.emotions_file().exists());
    assert!(!paths.rollback_dir().exists());
}

#[tokio::test]
async fn an_interrupted_runs_snapshot_is_restored_before_the_next_run() {
    let (pool, galley) = fresh().await;
    seed_mix(&pool).await;
    let dir = tempfile::tempdir().unwrap();
    let paths = LedgerPaths::new(dir.path().join("managed-ga-state"));
    std::fs::create_dir_all(paths.insight_dir()).unwrap();
    let before = "## 持续活动\n### A001｜半马\n";
    std::fs::write(paths.activities_file(), before).unwrap();
    // Galley quit mid-run: the snapshot was taken, the model wrote, no
    // settle.
    galley_core_lib::ledger::rollback::snapshot(&paths).unwrap();
    for (path, body) in half_written(&paths) {
        std::fs::write(path, body).unwrap();
    }

    // The next run starts from the files as they were.
    let runner = FakeRunner::new(vec![run_complete("CURRENT_TASK_DONE")]);
    let report = run_at(
        &galley,
        &runner,
        &paths,
        Trigger::Manual,
        "2026-10-11T01:00:00Z",
    )
    .await;
    assert!(matches!(report, RunReport::Succeeded { .. }), "{report:?}");
    assert_eq!(
        std::fs::read_to_string(paths.activities_file()).unwrap(),
        before
    );
    assert!(!paths.emotions_file().exists());
    assert!(!paths.affairs_file().exists());
}

#[tokio::test]
async fn the_launch_sweep_deletes_leftover_mining_sessions_only() {
    let (pool, galley) = fresh().await;
    seed_mix(&pool).await;
    old_mining_session(&galley, "s-old-mining").await;
    old_mining_session(&galley, "s-interrupted").await;
    galley
        .unarchive_session(
            SessionId("s-interrupted".into()),
            Origin {
                via: OriginVia::System,
                supervisor: Some(LEDGER_SUPERVISOR.into()),
                reason: None,
                client: None,
            },
        )
        .await
        .unwrap();
    assert!(rows_of(&pool, "messages_fts", "s-old-mining").await > 0);
    let control = LedgerControl::new();
    assert_eq!(control.sweep_mining_sessions(&galley).await, Ok(2));
    assert_session_gone(&pool, &galley, "s-old-mining").await;
    assert_session_gone(&pool, &galley, "s-interrupted").await;
    // `system` sessions without the label, and everything else, stay.
    for kept in ["s-gui", "s-system", "s-cli", "s-supervisor"] {
        assert!(
            galley.session_brief(SessionId(kept.into())).await.is_ok(),
            "{kept}"
        );
    }
    assert_eq!(control.sweep_mining_sessions(&galley).await, Ok(0));
}

/// The ordinary session delete takes the session's search-index rows
/// along (`messages_fts` has no foreign key): one session or several.
#[tokio::test]
async fn deleting_a_session_drops_its_search_index_rows() {
    let (pool, galley) = fresh().await;
    let origin = Origin {
        via: OriginVia::Gui,
        supervisor: None,
        reason: None,
        client: None,
    };
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
                origin.clone(),
            )
            .await
            .unwrap();
        galley
            .send_message_in_tx(
                &mut tx,
                SessionId(id.into()),
                format!("{id} 里说过的一段话"),
                origin.clone(),
            )
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(rows_of(&pool, "messages_fts", id).await, 1);
    }
    galley
        .delete_session(SessionId("s-a".into()), origin.clone())
        .await
        .unwrap();
    assert_eq!(rows_of(&pool, "messages_fts", "s-a").await, 0);
    assert_eq!(
        galley
            .bulk_delete_sessions(vec![SessionId("s-b".into())], origin)
            .await
            .unwrap(),
        1
    );
    assert_eq!(rows_of(&pool, "messages_fts", "s-b").await, 0);
    assert_eq!(rows_of(&pool, "messages_fts", "s-c").await, 1);
}
