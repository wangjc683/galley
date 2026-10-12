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
use chrono::{DateTime, FixedOffset, NaiveDate, Utc};
use galley_core_lib::api::{GalleyApi, OriginVia, SessionFilter, SessionId, SessionStatus};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::ipc::{IpcCommand, IpcEvent, RunCompleteEvent};
use galley_core_lib::ledger::im_archive::FILE_HINT;
use galley_core_lib::ledger::state::LedgerState;
use galley_core_lib::ledger::{
    is_mining_session, run, sources, LedgerConfig, LedgerPaths, LedgerTarget, MiningDeps,
    RunReport, Trigger, LEDGER_SUPERVISOR,
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
        since: NaiveDate::from_ymd_opt(2026, 10, 10).unwrap(), // 2026-10-09T16:00Z
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

    let since = config().since_instant(&shanghai());
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

/// Fake registry: every spawn succeeds; dispatching the task plays
/// `script` on the session's broadcast.
struct FakeRunner {
    script: Vec<BroadcastItem>,
    channel: broadcast::Sender<BroadcastItem>,
    spawned: Mutex<Vec<SpawnArgs>>,
    tasks: Mutex<Vec<(String, String)>>,
    shutdowns: Mutex<Vec<String>>,
}

impl FakeRunner {
    fn new(script: Vec<BroadcastItem>) -> Self {
        Self {
            script,
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
    )
    .await
}

fn state(paths: &LedgerPaths) -> LedgerState {
    LedgerState::load(&paths.state_file()).unwrap()
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

    // The session: system-made, ledger-labelled, archived, runner stopped,
    // and not in a GUI-style list.
    let brief = galley
        .session_brief(SessionId(session_id.clone()))
        .await
        .unwrap();
    let origin = brief.origin.clone().expect("non-GUI origin");
    assert_eq!(origin.via, OriginVia::System);
    assert_eq!(origin.supervisor.as_deref(), Some(LEDGER_SUPERVISOR));
    assert_eq!(brief.status, SessionStatus::Archived);
    assert!(is_mining_session(&brief));
    assert_eq!(
        runner.shutdowns.lock().unwrap().as_slice(),
        &[session_id.clone()]
    );
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
    assert_eq!(
        listed.iter().filter(|s| is_mining_session(s)).count(),
        1,
        "the DB keeps it; the GUI / phone list commands filter it"
    );

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
        // Wound down all the same.
        assert_eq!(runner.shutdowns.lock().unwrap().len(), 1);
        let brief = galley
            .session_brief(SessionId(session_id.unwrap()))
            .await
            .unwrap();
        assert_eq!(brief.status, SessionStatus::Archived);
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
