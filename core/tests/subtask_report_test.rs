//! Subtask reports waking the main chat (`galley_core_lib::subtask_report`,
//! main chat ticket 29), against an in-memory database, a scripted runner
//! registry with the run gate's rules, and a fake managed spawn env:
//!
//! - which runs report: finished, asking, at the step limit, failed, the
//!   runner gone mid-run; not a stopped run, a promoted subtask, another
//!   session; a tag that started nothing; each end once;
//! - when: at once when the main chat is idle; after its run, behind the
//!   user's queued messages; held while it waits for its own answer, and
//!   the desktop told;
//! - what: one message for several reports, read again first (a subtask
//!   running again, answered, promoted or deleted drops out), written as
//!   the report row and dispatched on the shared runner path;
//! - a wake that cannot be delivered keeps its reports, tells the desktop
//!   once, and goes out on the next try;
//! - send-backs: counted from the rows, an answer not counted, announced
//!   on the assistant's send;
//! - the main chat's replayed history (and the turns a new segment
//!   carries) shows a report as one line per subtask;
//! - the desktop's search leaves reports and silent replies out, the
//!   Agent API's does not.
//!
//! The wording, the outcome table and the store are unit-tested in
//! `core/src/subtask_report.rs`; the `<no-reply/>` derivation in
//! `turn_persistence::derive` and the shared golden fixtures.

use async_trait::async_trait;
use chrono::{Duration as ChronoDuration, Utc};
use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, MessageVisibility, Origin, RuntimeKind, SearchScope, SessionId,
    SubtaskDispatch, SubtaskFailure, ASSISTANT_SUPERVISOR, SUBTASK_DISPATCHED_EVENT,
    SUBTASK_REPORT_SUPERVISOR, SUBTASK_REPORT_UNDELIVERED_EVENT,
};
use galley_core_lib::db::{MainChatSeed, PersistAssistantMessage, SqliteGalley};
use galley_core_lib::ipc::{HistoryLoadedEvent, IpcCommand, IpcEvent, ReadyEvent};
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    is_side_question, BroadcastItem, HeldClose, QueueOffer, ReadySnapshot, RunSignal, RunState,
    RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::session_runner::{RunnerHost, SpawnEnv};
use galley_core_lib::socket_listener::RunnerPort;
use galley_core_lib::subtask::announce_send_back;
use galley_core_lib::subtask_report::{
    deliver, record_not_started, record_run_end, take_due, wake_if_due, ReportOutcome,
    SubtaskReports, WakeOutcome,
};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

const MAIN: &str = "s-main";

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

/// A fresh database with the main chat, on model `m-1`.
async fn with_main_chat() -> (SqlitePool, SqliteGalley) {
    let (pool, galley) = fresh().await;
    galley
        .get_or_create_main_chat(MAIN, Origin::desktop(), &MainChatSeed::default())
        .await
        .expect("main chat");
    sqlx::query("UPDATE sessions SET llm_key = 'm-1', llm_display_name = 'Model' WHERE id = ?")
        .bind(MAIN)
        .execute(&pool)
        .await
        .expect("main chat model");
    (pool, galley)
}

fn input(id: &str, title: &str) -> CreateSessionInput {
    CreateSessionInput {
        id: id.into(),
        title: title.into(),
        project_id: None,
        selected_llm_index: None,
        selected_llm_key: None,
        selected_llm_display_name: None,
        ga_runtime_kind: Some(RuntimeKind::Managed),
        ga_runtime_id: None,
        prompt_profile: None,
    }
}

/// A subtask as the dispatch makes it: its row, its instructions, and the
/// record of its tag (the next tag of the main chat's turn 0).
async fn subtask(galley: &SqliteGalley, id: &str, title: &str) {
    let ordinal = galley
        .subtask_dispatches(&SessionId(MAIN.into()))
        .await
        .expect("records")
        .len() as i64;
    galley
        .create_subtask_session(
            input(id, title),
            Origin::subtask(),
            &SessionId(MAIN.into()),
            Some(format!("{title}\n细节")),
        )
        .await
        .expect("subtask");
    galley
        .record_subtask_dispatch(&SubtaskDispatch {
            parent_session_id: MAIN.into(),
            turn_index: 0,
            ordinal,
            message_id: SubtaskDispatch::reply_message_id(MAIN, 0),
            session_id: Some(id.into()),
            title: title.into(),
            failure: None,
            failure_detail: None,
            created_at: "2026-10-15T00:00:00Z".into(),
            send_backs: 0,
        })
        .await
        .expect("dispatch record");
}

/// An assistant row of `turn_index`, written the way Core writes them.
async fn step(
    galley: &SqliteGalley,
    sid: &str,
    turn_index: i64,
    final_answer: Option<&str>,
    preamble: Option<&str>,
    tool_calls: Value,
) {
    galley
        .persist_assistant_message(PersistAssistantMessage {
            session_id: SessionId(sid.into()),
            turn_index: turn_index as u32,
            content: final_answer.or(preamble).unwrap_or_default().into(),
            tool_calls: Some(tool_calls.to_string()),
            tool_results: None,
            thinking: None,
            final_answer: final_answer.map(str::to_string),
            summary: None,
            preamble: preamble.map(str::to_string),
            visibility: MessageVisibility::Visible,
            telemetry: None,
        })
        .await
        .expect("assistant row");
    galley
        .bump_session_after_turn(SessionId(sid.into()), None, None, false)
        .await
        .expect("bump");
}

/// The latest user row's turn index of a session.
async fn last_user_turn(galley: &SqliteGalley, sid: &str) -> i64 {
    galley
        .latest_user_turn_index(sid)
        .await
        .expect("read")
        .expect("a user row")
}

/// A user message written into `sid` with `origin`; its turn index.
async fn user_says(galley: &SqliteGalley, sid: &str, text: &str, origin: Origin) -> i64 {
    i64::from(
        galley
            .send_message(SessionId(sid.into()), text.into(), origin)
            .await
            .expect("user row")
            .turn_index
            .expect("turn index"),
    )
}

fn assistant_origin(reason: &str) -> Origin {
    Origin::cli(Some(ASSISTANT_SUPERVISOR.into()), Some(reason.into()))
}

fn ask_user(question: &str, candidates: &[&str]) -> Value {
    json!([{"toolName": "ask_user", "args": {"question": question, "candidates": candidates}}])
}

#[derive(Default)]
struct Recorder {
    events: Mutex<Vec<(String, Value)>>,
}

impl Notifier for Recorder {
    fn emit(&self, event: &str, payload: Value) {
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload));
    }
}

impl Recorder {
    fn named(&self, name: &str) -> Vec<Value> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|(n, _)| n == name)
            .map(|(_, p)| p.clone())
            .collect()
    }
}

struct FakeEnv;

#[async_trait]
impl SpawnEnv for FakeEnv {
    fn bundled_python(&self) -> Option<PathBuf> {
        Some(PathBuf::from("/bundle/python/bin/python3"))
    }
    fn bridge_cwd(&self) -> Result<PathBuf, String> {
        Ok(PathBuf::from("/galley"))
    }
    async fn prepare_managed(&self, mut args: SpawnArgs) -> Result<SpawnArgs, RunnerSpawnError> {
        args.ga_path = PathBuf::from("/managed/code");
        args.bridge_cwd = PathBuf::from("/galley");
        Ok(args)
    }
}

// ---------------- scripted runner registry ----------------

#[derive(Debug, Default, Clone)]
struct Gate {
    open_run: bool,
    ask_pending: bool,
    queued: usize,
    last_exit: Option<String>,
}

/// Registry fake with the run gate's rules: a spawn registers a live
/// runner that reports `ready` at once (unless `fail_spawn`),
/// `load_history` is always loaded, a delivered `user_message` opens the
/// run gate (unless `fail_dispatch` refuses it), and the gate is reserved
/// only with no run open and nothing queued (or a question pending).
#[derive(Default)]
struct Runner {
    fail_spawn: AtomicBool,
    fail_dispatch: AtomicBool,
    next_pid: AtomicU32,
    alive: Mutex<HashMap<String, u32>>,
    confirmed: Mutex<HashMap<String, u32>>,
    ready: Mutex<HashMap<String, ReadySnapshot>>,
    channels: Mutex<HashMap<String, broadcast::Sender<BroadcastItem>>>,
    gates: Mutex<HashMap<String, Gate>>,
    sent: Mutex<Vec<(String, IpcCommand)>>,
    errors: Mutex<HashMap<String, String>>,
}

impl Runner {
    fn gate(&self, sid: &str) -> Gate {
        self.gates
            .lock()
            .unwrap()
            .get(sid)
            .cloned()
            .unwrap_or_default()
    }
    fn edit_gate(&self, sid: &str, edit: impl FnOnce(&mut Gate)) {
        edit(self.gates.lock().unwrap().entry(sid.into()).or_default());
    }
    /// A run of `sid` ended as the watcher reports it: the gate still
    /// open (the queue step closes it), why it ended, a question.
    fn run_ended(&self, sid: &str, last_exit: &str, asking: bool) {
        self.edit_gate(sid, |g| {
            g.open_run = true;
            g.last_exit = Some(last_exit.into());
            g.ask_pending = asking;
        });
    }
    /// The queue step: the gate closes.
    fn settle(&self, sid: &str) {
        self.edit_gate(sid, |g| g.open_run = false);
    }
    fn user_messages(&self, sid: &str) -> Vec<String> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .filter(|(s, _)| s == sid)
            .filter_map(|(_, cmd)| match cmd {
                IpcCommand::UserMessage(m) => Some(m.text.clone()),
                _ => None,
            })
            .collect()
    }
    fn load_histories(&self) -> Vec<Vec<Value>> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(_, cmd)| match cmd {
                IpcCommand::LoadHistory(load) => Some(load.messages.clone()),
                _ => None,
            })
            .collect()
    }
    async fn spawn_inner(&self, args: SpawnArgs) -> Result<u32, RunnerSpawnError> {
        if self.fail_spawn.load(Ordering::SeqCst) {
            return Err(RunnerSpawnError::SpawnIo {
                detail: "fork failed".into(),
            });
        }
        let sid = args.session_id.clone();
        let pid = 7000 + self.next_pid.fetch_add(1, Ordering::SeqCst);
        self.alive.lock().unwrap().insert(sid.clone(), pid);
        self.confirmed.lock().unwrap().remove(&sid);
        self.ready.lock().unwrap().insert(sid.clone(), ready(&sid));
        let (tx, _) = broadcast::channel(64);
        self.channels.lock().unwrap().insert(sid, tx);
        Ok(pid)
    }
}

fn ready(sid: &str) -> ReadySnapshot {
    ReadyEvent {
        session_id: sid.into(),
        protocol_version: "0.1".into(),
        ga_commit: "c".into(),
        ga_commit_date: "d".into(),
        ga_path: "/ga".into(),
        llm_name: "B/b".into(),
        cwd: "/".into(),
        pid: 77,
        available_llms: vec![],
        images_supported: true,
        reasoning_effort: None,
        configured_reasoning_effort: None,
        timestamp: "t".into(),
    }
}

#[async_trait]
impl RunnerPort for Runner {
    async fn spawn(&self, args: SpawnArgs, _: Option<&str>) -> Result<u32, RunnerSpawnError> {
        self.spawn_inner(args).await
    }
    async fn spawn_held(&self, args: SpawnArgs, _: Option<&str>) -> Result<u32, RunnerSpawnError> {
        self.spawn_inner(args).await
    }
    async fn send_command(&self, sid: &str, cmd: &IpcCommand) -> Result<(), SendCommandError> {
        let gone = || SendCommandError::ProcessGone {
            session_id: sid.to_string(),
        };
        if !self.alive.lock().unwrap().contains_key(sid) {
            return Err(gone());
        }
        if matches!(cmd, IpcCommand::UserMessage(_)) && self.fail_dispatch.load(Ordering::SeqCst) {
            return Err(gone());
        }
        self.sent
            .lock()
            .unwrap()
            .push((sid.to_string(), cmd.clone()));
        match cmd {
            IpcCommand::LoadHistory(_) => {
                let tx = self.channels.lock().unwrap().get(sid).cloned();
                if let Some(tx) = tx {
                    let _ = tx.send(BroadcastItem::Event(Box::new(IpcEvent::HistoryLoaded(
                        HistoryLoadedEvent {
                            session_id: sid.into(),
                            message_count: 0,
                            timestamp: "t".into(),
                        },
                    ))));
                }
            }
            IpcCommand::UserMessage(m) if !is_side_question(&m.text) => self.edit_gate(sid, |g| {
                g.open_run = true;
                g.ask_pending = false;
            }),
            IpcCommand::AskUserResponse(_) => self.edit_gate(sid, |g| {
                g.open_run = true;
                g.ask_pending = false;
            }),
            _ => {}
        }
        Ok(())
    }
    async fn subscribe(&self, sid: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        self.channels
            .lock()
            .unwrap()
            .get(sid)
            .map(broadcast::Sender::subscribe)
    }
    async fn pid(&self, sid: &str) -> Option<u32> {
        self.alive.lock().unwrap().get(sid).copied()
    }
    async fn agent_running(&self, _: &str) -> bool {
        false
    }
    async fn shutdown(&self, _: &str, _: Option<Duration>) -> Result<(), ShutdownError> {
        Ok(())
    }
    async fn ready_snapshot(&self, sid: &str) -> Option<ReadySnapshot> {
        self.ready.lock().unwrap().get(sid).cloned()
    }
    async fn release_close(&self, sid: &str, pid: u32, confirmed: bool) -> Option<HeldClose> {
        if confirmed {
            self.confirmed.lock().unwrap().insert(sid.into(), pid);
        }
        None
    }
    async fn retire(&self, sid: &str, _pid: u32) -> bool {
        self.alive.lock().unwrap().remove(sid);
        self.ready.lock().unwrap().remove(sid);
        true
    }
    async fn history_confirmed(&self, sid: &str, pid: u32) -> bool {
        self.confirmed.lock().unwrap().get(sid) == Some(&pid)
            && self.alive.lock().unwrap().get(sid) == Some(&pid)
    }
    async fn queue_offer(&self, sid: &str, _text: String, _origin: Option<Origin>) -> QueueOffer {
        let mut gates = self.gates.lock().unwrap();
        let gate = gates.entry(sid.to_string()).or_default();
        if gate.open_run || (gate.queued > 0 && !gate.ask_pending) {
            gate.queued += 1;
            return QueueOffer::Queued {
                queue_id: "q-1".into(),
                position: gate.queued - 1,
            };
        }
        gate.open_run = true;
        QueueOffer::DispatchNow
    }
    async fn queue_try_reserve(&self, sid: &str) -> bool {
        let mut gates = self.gates.lock().unwrap();
        let gate = gates.entry(sid.to_string()).or_default();
        if gate.open_run || (gate.queued > 0 && !gate.ask_pending) {
            return false;
        }
        gate.open_run = true;
        true
    }
    async fn queue_release_run(&self, sid: &str) {
        self.edit_gate(sid, |g| g.open_run = false);
    }
    async fn run_state(&self, sid: &str) -> RunState {
        let gate = self.gate(sid);
        RunState {
            runner_alive: self.alive.lock().unwrap().contains_key(sid),
            agent_running: false,
            open_run: gate.open_run,
            queued_count: gate.queued,
            ask_pending: gate.ask_pending,
            last_exit: gate.last_exit,
        }
    }
    async fn last_run_error(&self, sid: &str) -> Option<String> {
        self.errors.lock().unwrap().get(sid).cloned()
    }
}

fn host<'a>(
    galley: &'a SqliteGalley,
    runner: &'a Runner,
    env: &'a FakeEnv,
    notifier: Arc<Recorder>,
) -> RunnerHost<'a> {
    RunnerHost {
        galley,
        runner,
        notifier,
        env: Some(env),
    }
}

fn complete(sid: &str) -> RunSignal {
    RunSignal::RunComplete {
        session_id: sid.into(),
    }
}

/// A subtask `id` that ran once and answered `answer`.
async fn finished_subtask(
    galley: &SqliteGalley,
    runner: &Runner,
    id: &str,
    title: &str,
    answer: &str,
) {
    subtask(galley, id, title).await;
    let turn = last_user_turn(galley, id).await;
    step(galley, id, turn, Some(answer), None, json!([])).await;
    runner.run_ended(id, "CURRENT_TASK_DONE", false);
}

/// What the drain task does for a subtask's run signal: record, then the
/// queue step.
async fn drain(
    reports: &SubtaskReports,
    galley: &SqliteGalley,
    runner: &Runner,
    signal: RunSignal,
) -> Option<String> {
    let main = record_run_end(reports, galley, runner, &signal).await;
    let sid = match &signal {
        RunSignal::RunComplete { session_id } | RunSignal::Closed { session_id } => session_id,
    };
    runner.settle(sid);
    main
}

// ---------------- which runs report ----------------

#[tokio::test]
async fn a_finished_subtask_reports_its_final_answer() {
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let reports = SubtaskReports::new();
    subtask(&galley, "s-sub", "把 PDF 分类").await;
    let turn = last_user_turn(&galley, "s-sub").await;
    step(
        &galley,
        "s-sub",
        turn,
        Some("先看看"),
        Some("先看看"),
        json!([{"toolName": "code_run"}]),
    )
    .await;
    step(
        &galley,
        "s-sub",
        turn + 1,
        Some("分好了：发票 3 份。"),
        None,
        json!([]),
    )
    .await;
    runner.run_ended("s-sub", "CURRENT_TASK_DONE", false);

    let main = drain(&reports, &galley, &runner, complete("s-sub")).await;

    assert_eq!(main.as_deref(), Some(MAIN));
    let waiting = reports.waiting(MAIN);
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0].subtask_id.as_deref(), Some("s-sub"));
    assert_eq!(waiting[0].title, "把 PDF 分类");
    assert_eq!(waiting[0].send_backs, 0);
    assert_eq!(
        waiting[0].outcome,
        ReportOutcome::Done {
            answer: "分好了：发票 3 份。".into()
        }
    );
    // The same end is reported once.
    runner.run_ended("s-sub", "CURRENT_TASK_DONE", false);
    assert_eq!(
        drain(&reports, &galley, &runner, complete("s-sub")).await,
        None
    );
    assert_eq!(reports.waiting(MAIN).len(), 1);
}

#[tokio::test]
async fn every_way_a_run_ends_reports_what_it_says() {
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let reports = SubtaskReports::new();

    // Asking: the question and its candidates.
    subtask(&galley, "s-ask", "订机票").await;
    let turn = last_user_turn(&galley, "s-ask").await;
    step(
        &galley,
        "s-ask",
        turn,
        None,
        None,
        ask_user("要哪家航空？", &["国航", "东航"]),
    )
    .await;
    runner.run_ended("s-ask", "EXITED", true);
    drain(&reports, &galley, &runner, complete("s-ask")).await;

    // The step limit: its last words.
    subtask(&galley, "s-limit", "整理照片").await;
    let turn = last_user_turn(&galley, "s-limit").await;
    step(
        &galley,
        "s-limit",
        turn,
        Some("已经分完一半。"),
        Some("已经分完一半。"),
        json!([{"toolName": "code_run"}]),
    )
    .await;
    runner.run_ended("s-limit", "MAX_TURNS_EXCEEDED", false);
    drain(&reports, &galley, &runner, complete("s-limit")).await;

    // The engine's error.
    subtask(&galley, "s-err", "查报价").await;
    runner
        .errors
        .lock()
        .unwrap()
        .insert("s-err".into(), "429 Too Many Requests".into());
    runner.run_ended("s-err", "DONE_WITHOUT_EXIT", false);
    drain(&reports, &galley, &runner, complete("s-err")).await;

    // The runner gone while a run was open.
    subtask(&galley, "s-gone", "下载发票").await;
    runner.edit_gate("s-gone", |g| g.open_run = true);
    drain(
        &reports,
        &galley,
        &runner,
        RunSignal::Closed {
            session_id: "s-gone".into(),
        },
    )
    .await;

    let outcomes: Vec<(Option<String>, ReportOutcome)> = reports
        .waiting(MAIN)
        .into_iter()
        .map(|r| (r.subtask_id, r.outcome))
        .collect();
    assert_eq!(
        outcomes,
        vec![
            (
                Some("s-ask".into()),
                ReportOutcome::Asking {
                    question: "要哪家航空？".into(),
                    candidates: vec!["国航".into(), "东航".into()],
                }
            ),
            (
                Some("s-limit".into()),
                ReportOutcome::StepLimit {
                    last_words: "已经分完一半。".into()
                }
            ),
            (
                Some("s-err".into()),
                ReportOutcome::Error {
                    detail: "429 Too Many Requests".into()
                }
            ),
            (
                Some("s-gone".into()),
                ReportOutcome::Error {
                    detail: "its engine process exited before the run finished".into()
                }
            ),
        ]
    );
}

#[tokio::test]
async fn a_stopped_run_a_promoted_subtask_and_other_sessions_do_not_report() {
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let reports = SubtaskReports::new();

    // Stopped: a person or the assistant did it.
    finished_subtask(&galley, &runner, "s-stop", "停掉的", "x").await;
    runner.run_ended("s-stop", "ABORTED", false);
    assert_eq!(
        drain(&reports, &galley, &runner, complete("s-stop")).await,
        None
    );

    // Promoted: an ordinary conversation now.
    finished_subtask(&galley, &runner, "s-promoted", "升级的", "x").await;
    galley
        .promote_subtask(&SessionId("s-promoted".into()))
        .await
        .expect("promote");
    assert_eq!(
        drain(&reports, &galley, &runner, complete("s-promoted")).await,
        None
    );

    // A runner closing with no run open (evicted, shut down).
    subtask(&galley, "s-idle", "空闲的").await;
    let closed = RunSignal::Closed {
        session_id: "s-idle".into(),
    };
    assert_eq!(drain(&reports, &galley, &runner, closed).await, None);

    // The main chat itself, and a side chat.
    runner.run_ended(MAIN, "CURRENT_TASK_DONE", false);
    assert_eq!(
        drain(&reports, &galley, &runner, complete(MAIN)).await,
        None
    );
    galley
        .create_session(input("s-side", "旁聊"), Origin::desktop())
        .await
        .expect("side chat");
    runner.run_ended("s-side", "CURRENT_TASK_DONE", false);
    assert_eq!(
        drain(&reports, &galley, &runner, complete("s-side")).await,
        None
    );

    assert!(reports.waiting(MAIN).is_empty());
}

#[tokio::test]
async fn a_tag_that_started_nothing_reports_once() {
    let reports = SubtaskReports::new();
    let record = |ordinal: i64,
                  session_id: Option<&str>,
                  failure: Option<SubtaskFailure>,
                  detail: Option<&str>| SubtaskDispatch {
        parent_session_id: MAIN.into(),
        turn_index: 3,
        ordinal,
        message_id: SubtaskDispatch::reply_message_id(MAIN, 3),
        session_id: session_id.map(str::to_string),
        title: if failure == Some(SubtaskFailure::Empty) {
            String::new()
        } else {
            "查报价".into()
        },
        failure,
        failure_detail: detail.map(str::to_string),
        created_at: "t".into(),
        send_backs: 0,
    };
    let dispatches = vec![
        record(0, Some("s-ok"), None, None),
        record(1, None, Some(SubtaskFailure::Empty), None),
        record(2, None, Some(SubtaskFailure::Unclosed), None),
        record(
            3,
            Some("s-dead"),
            Some(SubtaskFailure::StartFailed),
            Some("Spawn(fork\nfailed)"),
        ),
    ];
    assert_eq!(
        record_not_started(&reports, &dispatches).as_deref(),
        Some(MAIN)
    );
    let waiting = reports.waiting(MAIN);
    let shape: Vec<(Option<&str>, &str, ReportOutcome)> = waiting
        .iter()
        .map(|r| (r.subtask_id.as_deref(), r.title.as_str(), r.outcome.clone()))
        .collect();
    let not_started = |why: &str| ReportOutcome::NotStarted { why: why.into() };
    assert_eq!(
        shape,
        vec![
            (None, "", not_started("the tag was empty")),
            (None, "查报价", not_started("the tag was not closed")),
            (Some("s-dead"), "查报价", not_started("Spawn(fork failed)")),
        ]
    );
    // Recorded once.
    assert_eq!(record_not_started(&reports, &dispatches), None);
    assert_eq!(reports.waiting(MAIN).len(), 3);
}

// ---------------- when and what ----------------

#[tokio::test]
async fn an_idle_main_chat_is_woken_at_once_with_the_report_row() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    finished_subtask(&galley, &runner, "s-sub", "把 PDF 分类", "分好了").await;
    drain(&reports, &galley, &runner, complete("s-sub")).await;

    let outcome = wake_if_due(&reports, &host(&galley, &runner, &env, rec.clone()), MAIN)
        .await
        .expect("due");

    let WakeOutcome::Delivered {
        message,
        subtask_ids,
        ..
    } = outcome
    else {
        panic!("not delivered: {outcome:?}");
    };
    assert_eq!(subtask_ids, vec!["s-sub".to_string()]);
    // Dispatched to the main chat, whose run gate it now holds.
    let sent = runner.user_messages(MAIN);
    assert_eq!(sent.len(), 1);
    assert!(sent[0].starts_with("[Galley — not a message from the user]"));
    assert!(sent[0].contains("Subtask `s-sub` \"把 PDF 分类\" (round 1) finished."));
    assert!(runner.gate(MAIN).open_run);
    assert!(reports.waiting(MAIN).is_empty());

    // The row: a visible user row from Galley, the subtask ids as its
    // note, its replay line as its summary, no client.
    let row: (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT role, created_via, supervisor, origin_note, summary, visibility, client \
             FROM messages WHERE id = ?",
    )
    .bind(&message.id.0)
    .fetch_one(&pool)
    .await
    .expect("row");
    assert_eq!(
        row,
        (
            "user".into(),
            "system".into(),
            Some(SUBTASK_REPORT_SUPERVISOR.into()),
            Some("s-sub".into()),
            Some(
                "[Galley: subtask s-sub \"把 PDF 分类\" finished — details: session show s-sub]"
                    .into()
            ),
            "visible".into(),
            None,
        )
    );
    assert_eq!(message.content, sent[0]);

    // Announced as Core's send announces a message: pending, dispatched.
    let persisted = rec.named("user-message-persisted");
    let dispatches: Vec<&str> = persisted
        .iter()
        .map(|p| p["dispatch"].as_str().unwrap())
        .collect();
    assert_eq!(dispatches, vec!["pending", "dispatched"]);
    assert_eq!(persisted[0]["sessionId"], MAIN);
    assert_eq!(persisted[0]["message"]["origin"]["via"], "system");
    assert_eq!(
        persisted[0]["message"]["origin"]["supervisor"],
        SUBTASK_REPORT_SUPERVISOR
    );
    assert_eq!(persisted[0]["message"]["origin"]["reason"], "s-sub");
    assert!(rec.named(SUBTASK_REPORT_UNDELIVERED_EVENT).is_empty());
    // The shared runner path started the main chat's runner.
    let spawned = rec.named("runner-spawned-external");
    assert_eq!(spawned.len(), 1);
    assert_eq!(spawned[0]["via"], "subtask-report");
}

#[tokio::test]
async fn a_busy_main_chat_is_woken_after_its_run_and_after_the_users_queue() {
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    let host = host(&galley, &runner, &env, rec.clone());
    // The main chat is running, with a message of the user's queued.
    runner.edit_gate(MAIN, |g| {
        g.open_run = true;
        g.queued = 1;
    });
    finished_subtask(&galley, &runner, "s-sub", "分类", "好了").await;
    drain(&reports, &galley, &runner, complete("s-sub")).await;

    assert!(take_due(&reports, &host, MAIN).await.is_none(), "busy");
    // Its run completes and the queue step hands it the user's message.
    runner.edit_gate(MAIN, |g| g.queued = 0);
    assert!(
        take_due(&reports, &host, MAIN).await.is_none(),
        "the user's message runs"
    );
    // That run completes too: now the report goes.
    runner.settle(MAIN);
    let job = take_due(&reports, &host, MAIN).await.expect("idle now");
    assert!(matches!(
        deliver(&reports, &host, job).await,
        WakeOutcome::Delivered { .. }
    ));
    assert_eq!(runner.user_messages(MAIN).len(), 1);
    assert!(rec.named(SUBTASK_REPORT_UNDELIVERED_EVENT).is_empty());
}

#[tokio::test]
async fn a_main_chat_waiting_for_its_answer_holds_the_report_and_says_so_once() {
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    let host = host(&galley, &runner, &env, rec.clone());
    runner.edit_gate(MAIN, |g| g.ask_pending = true);
    finished_subtask(&galley, &runner, "s-sub", "分类", "好了").await;
    drain(&reports, &galley, &runner, complete("s-sub")).await;

    assert!(take_due(&reports, &host, MAIN).await.is_none());
    assert!(take_due(&reports, &host, MAIN).await.is_none());
    // Told once; nothing reached the main chat, whose gate stays free.
    assert_eq!(
        rec.named(SUBTASK_REPORT_UNDELIVERED_EVENT),
        vec![json!({"mainChatId": MAIN, "subtaskIds": ["s-sub"]})]
    );
    assert!(runner.user_messages(MAIN).is_empty());
    assert!(!runner.gate(MAIN).open_run);
    assert_eq!(reports.waiting(MAIN).len(), 1);

    // The user answers; that run ends: the report goes as usual.
    runner.edit_gate(MAIN, |g| g.ask_pending = false);
    assert!(matches!(
        wake_if_due(&reports, &host, MAIN).await,
        Some(WakeOutcome::Delivered { .. })
    ));
    assert_eq!(rec.named(SUBTASK_REPORT_UNDELIVERED_EVENT).len(), 1);
}

#[tokio::test]
async fn reports_waiting_together_go_in_one_message_and_stale_ones_drop() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    let host = host(&galley, &runner, &env, rec.clone());
    runner.edit_gate(MAIN, |g| g.open_run = true);

    finished_subtask(&galley, &runner, "s-a", "甲", "甲好了").await;
    drain(&reports, &galley, &runner, complete("s-a")).await;
    finished_subtask(&galley, &runner, "s-b", "乙", "乙好了").await;
    drain(&reports, &galley, &runner, complete("s-b")).await;
    // Running again by the time the main chat is free.
    finished_subtask(&galley, &runner, "s-again", "丙", "丙好了").await;
    drain(&reports, &galley, &runner, complete("s-again")).await;
    runner.edit_gate("s-again", |g| g.open_run = true);
    // Its question answered meanwhile.
    subtask(&galley, "s-answered", "丁").await;
    let turn = last_user_turn(&galley, "s-answered").await;
    step(
        &galley,
        "s-answered",
        turn,
        None,
        None,
        ask_user("哪个？", &[]),
    )
    .await;
    runner.run_ended("s-answered", "EXITED", true);
    drain(&reports, &galley, &runner, complete("s-answered")).await;
    runner.edit_gate("s-answered", |g| g.ask_pending = false);
    // Promoted, and deleted.
    finished_subtask(&galley, &runner, "s-promoted", "戊", "x").await;
    drain(&reports, &galley, &runner, complete("s-promoted")).await;
    galley
        .promote_subtask(&SessionId("s-promoted".into()))
        .await
        .expect("promote");
    finished_subtask(&galley, &runner, "s-deleted", "己", "x").await;
    drain(&reports, &galley, &runner, complete("s-deleted")).await;
    sqlx::query("DELETE FROM sessions WHERE id = 's-deleted'")
        .execute(&pool)
        .await
        .expect("delete");
    assert_eq!(reports.waiting(MAIN).len(), 6);

    runner.settle(MAIN);
    let Some(WakeOutcome::Delivered {
        message,
        subtask_ids,
        ..
    }) = wake_if_due(&reports, &host, MAIN).await
    else {
        panic!("not delivered");
    };
    assert_eq!(subtask_ids, vec!["s-a".to_string(), "s-b".to_string()]);
    let sent = runner.user_messages(MAIN);
    assert_eq!(sent.len(), 1, "one message");
    assert_eq!(
        sent[0]
            .matches("[Galley — not a message from the user]")
            .count(),
        1
    );
    assert!(sent[0].contains("`s-a`") && sent[0].contains("`s-b`"));
    assert!(sent[0].ends_with("Reply once, covering all of them."));
    for gone in ["s-again", "s-answered", "s-promoted", "s-deleted"] {
        assert!(!sent[0].contains(gone), "{gone} dropped");
    }
    assert_eq!(message.origin.unwrap().reason.as_deref(), Some("s-a,s-b"));
    assert!(reports.waiting(MAIN).is_empty());
}

#[tokio::test]
async fn nothing_left_after_the_reread_sends_nothing_and_frees_the_gate() {
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    let host = host(&galley, &runner, &env, rec.clone());
    finished_subtask(&galley, &runner, "s-sub", "分类", "好了").await;
    drain(&reports, &galley, &runner, complete("s-sub")).await;
    runner.edit_gate("s-sub", |g| g.open_run = true);

    assert!(matches!(
        wake_if_due(&reports, &host, MAIN).await,
        Some(WakeOutcome::NothingLeft)
    ));
    assert!(!runner.gate(MAIN).open_run);
    assert!(runner.user_messages(MAIN).is_empty());
    assert!(rec.named("user-message-persisted").is_empty());
}

// ---------------- not delivered ----------------

#[tokio::test]
async fn a_wake_that_cannot_be_delivered_is_kept_said_once_and_sent_next_time() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    let host = host(&galley, &runner, &env, rec.clone());
    finished_subtask(&galley, &runner, "s-sub", "分类", "好了").await;
    drain(&reports, &galley, &runner, complete("s-sub")).await;

    // The runner does not start: nothing written, the gate freed.
    runner.fail_spawn.store(true, Ordering::SeqCst);
    assert!(matches!(
        wake_if_due(&reports, &host, MAIN).await,
        Some(WakeOutcome::Failed(_))
    ));
    assert!(!runner.gate(MAIN).open_run);
    let report_rows: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM messages WHERE session_id = ? AND supervisor = ?")
            .bind(MAIN)
            .bind(SUBTASK_REPORT_SUPERVISOR)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(report_rows, 0);
    assert_eq!(reports.waiting(MAIN).len(), 1);
    // A second failure (the runner up, the message refused) says nothing
    // new; the message was written and announced as persisted only.
    runner.fail_spawn.store(false, Ordering::SeqCst);
    runner.fail_dispatch.store(true, Ordering::SeqCst);
    assert!(matches!(
        wake_if_due(&reports, &host, MAIN).await,
        Some(WakeOutcome::Failed(_))
    ));
    assert_eq!(
        rec.named(SUBTASK_REPORT_UNDELIVERED_EVENT),
        vec![json!({"mainChatId": MAIN, "subtaskIds": ["s-sub"]})]
    );
    let dispatches: Vec<String> = rec
        .named("user-message-persisted")
        .iter()
        .map(|p| p["dispatch"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(dispatches, vec!["pending", "persisted_only"]);
    assert!(!runner.gate(MAIN).open_run);

    // The next try goes through.
    runner.fail_dispatch.store(false, Ordering::SeqCst);
    assert!(matches!(
        wake_if_due(&reports, &host, MAIN).await,
        Some(WakeOutcome::Delivered { .. })
    ));
    assert_eq!(runner.user_messages(MAIN).len(), 1);
    assert!(reports.waiting(MAIN).is_empty());
}

// ---------------- send-backs ----------------

#[tokio::test]
async fn send_backs_count_the_assistants_messages_but_not_its_answers() {
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    subtask(&galley, "s-sub", "订机票").await;
    let sid = SessionId("s-sub".into());
    let turn = last_user_turn(&galley, "s-sub").await;
    step(&galley, "s-sub", turn, None, None, ask_user("哪天？", &[])).await;
    // An answer to its question: not a send-back.
    let origin = assistant_origin("answer");
    let t = user_says(&galley, "s-sub", "周五", origin.clone()).await;
    announce_send_back(&galley, rec.as_ref(), "s-sub", &origin).await;
    assert_eq!(galley.subtask_send_backs(&sid).await.unwrap(), 0);
    step(&galley, "s-sub", t, Some("订好了"), None, json!([])).await;
    // Sent back after an answer: one.
    let origin = assistant_origin("send back");
    let t = user_says(&galley, "s-sub", "缺确认号", origin.clone()).await;
    announce_send_back(&galley, rec.as_ref(), "s-sub", &origin).await;
    assert_eq!(galley.subtask_send_backs(&sid).await.unwrap(), 1);
    // A person's message never counts.
    step(&galley, "s-sub", t, Some("确认号 123"), None, json!([])).await;
    let t = user_says(&galley, "s-sub", "再查一下", Origin::desktop()).await;
    step(&galley, "s-sub", t, Some("查了"), None, json!([])).await;
    // Sent back again: two.
    let origin = assistant_origin("send back");
    user_says(&galley, "s-sub", "还差发票", origin.clone()).await;
    announce_send_back(&galley, rec.as_ref(), "s-sub", &origin).await;
    assert_eq!(galley.subtask_send_backs(&sid).await.unwrap(), 2);

    // The record carries it, announced on each of the assistant's sends.
    let announced: Vec<Value> = rec
        .named(SUBTASK_DISPATCHED_EVENT)
        .iter()
        .map(|p| p["dispatches"][0]["sendBacks"].clone())
        .collect();
    assert_eq!(announced, vec![json!(0), json!(1), json!(2)]);
    let records = galley
        .subtask_dispatches(&SessionId(MAIN.into()))
        .await
        .unwrap();
    assert_eq!(records[0].send_backs, 2);
    assert_eq!(
        serde_json::to_value(&records[0]).unwrap()["sendBacks"],
        json!(2)
    );
    // A message from anyone else announces nothing.
    announce_send_back(
        &galley,
        rec.as_ref(),
        "s-sub",
        &Origin::cli(Some("ga-1".into()), None),
    )
    .await;
    assert_eq!(rec.named(SUBTASK_DISPATCHED_EVENT).len(), 3);

    // The report says the round and that two is enough.
    runner.run_ended("s-sub", "CURRENT_TASK_DONE", false);
    let t = last_user_turn(&galley, "s-sub").await;
    step(&galley, "s-sub", t, Some("发票也有了"), None, json!([])).await;
    drain(&reports, &galley, &runner, complete("s-sub")).await;
    let waiting = reports.waiting(MAIN);
    assert_eq!(waiting[0].send_backs, 2);
    let text = galley_core_lib::subtask_report::report_text(&waiting);
    assert!(text.contains("(round 3) finished"));
    assert!(text.contains("do not send it back again"));
}

// ---------------- replay ----------------

/// A report turn already answered in the main chat: the report row and a
/// silent reply.
async fn answered_report(galley: &SqliteGalley, runner: &Runner, env: &FakeEnv, id: &str) {
    let reports = SubtaskReports::new();
    finished_subtask(galley, runner, id, "把 PDF 分类", "分好了").await;
    drain(&reports, galley, runner, complete(id)).await;
    let rec = Arc::new(Recorder::default());
    let Some(WakeOutcome::Delivered { message, .. }) =
        wake_if_due(&reports, &host(galley, runner, env, rec), MAIN).await
    else {
        panic!("not delivered");
    };
    galley
        .persist_assistant_message(PersistAssistantMessage {
            session_id: SessionId(MAIN.into()),
            turn_index: message.turn_index.unwrap(),
            content: "<no-reply/>".into(),
            tool_calls: Some("[]".into()),
            tool_results: None,
            thinking: None,
            final_answer: None,
            summary: None,
            preamble: None,
            visibility: MessageVisibility::Visible,
            telemetry: None,
        })
        .await
        .expect("silent reply");
    galley
        .bump_session_after_turn(SessionId(MAIN.into()), None, None, false)
        .await
        .expect("bump");
    runner.settle(MAIN);
}

const REPORT_LINE: &str =
    "[Galley: subtask s-sub \"把 PDF 分类\" finished — details: session show s-sub]";

#[tokio::test]
async fn the_replayed_history_shows_a_report_as_its_line() {
    let (_pool, galley) = with_main_chat().await;
    let env = FakeEnv;
    let first = Runner::default();
    user_says(&galley, MAIN, "帮我把 PDF 分类", Origin::desktop()).await;
    step(&galley, MAIN, 0, Some("交给子任务了。"), None, json!([])).await;
    answered_report(&galley, &first, &env, "s-sub").await;

    // A cold runner (a restart) gets the line, then the silent reply.
    let after = Runner::default();
    galley_core_lib::session_runner::ensure_session_runner(
        &host(&galley, &after, &env, Arc::new(Recorder::default())),
        MAIN,
        galley_core_lib::session_runner::EnsureOptions {
            via: "gui",
            active_session_id: Some(MAIN),
            llm_override: None,
            ga_config: None,
            holds_run_gate: false,
            timeouts: Default::default(),
        },
    )
    .await
    .expect("ensure");
    assert_eq!(
        after.load_histories(),
        vec![vec![
            json!({"role": "user", "content": "帮我把 PDF 分类"}),
            json!({"role": "assistant", "content": "交给子任务了。\n\n[subtask s-sub: 把 PDF 分类]"}),
            json!({"role": "user", "content": REPORT_LINE}),
            json!({"role": "assistant", "content": "<no-reply/>"}),
        ]]
    );
}

#[tokio::test]
async fn a_report_after_an_idle_gap_opens_a_segment_that_carries_the_line() {
    let (pool, galley) = with_main_chat().await;
    let env = FakeEnv;
    let first = Runner::default();
    user_says(&galley, MAIN, "帮我把 PDF 分类", Origin::desktop()).await;
    step(&galley, MAIN, 0, Some("交给子任务了。"), None, json!([])).await;
    answered_report(&galley, &first, &env, "s-sub").await;
    let start = 2;
    sqlx::query("UPDATE sessions SET last_activity_at = ? WHERE id = ?")
        .bind((Utc::now() - ChronoDuration::hours(5)).to_rfc3339())
        .bind(MAIN)
        .execute(&pool)
        .await
        .expect("backdate");

    // The next report wakes it after the gap: a new segment, opening with
    // the turns before it, the earlier report as its line.
    let runner = Runner::default();
    let reports = SubtaskReports::new();
    finished_subtask(&galley, &runner, "s-next", "查报价", "三家都问了").await;
    drain(&reports, &galley, &runner, complete("s-next")).await;
    let Some(WakeOutcome::Delivered { message, .. }) = wake_if_due(
        &reports,
        &host(&galley, &runner, &env, Arc::new(Recorder::default())),
        MAIN,
    )
    .await
    else {
        panic!("not delivered");
    };
    assert_eq!(
        galley
            .main_chat_segment_starts(&SessionId(MAIN.into()))
            .await
            .unwrap(),
        vec![start]
    );
    assert_eq!(i64::from(message.turn_index.unwrap()), start);
    assert_eq!(
        runner.load_histories(),
        vec![vec![
            json!({"role": "user", "content": "帮我把 PDF 分类"}),
            json!({
                "role": "assistant",
                "content": "交给子任务了。\n\n[subtask s-sub: 把 PDF 分类]\n[subtask s-next: 查报价]"
            }),
            json!({"role": "user", "content": REPORT_LINE}),
            json!({"role": "assistant", "content": "<no-reply/>"}),
        ]]
    );
}

// ---------------- search ----------------

#[tokio::test]
async fn the_desktop_search_leaves_out_reports_and_silent_replies() {
    let (_pool, galley) = with_main_chat().await;
    let env = FakeEnv;
    let runner = Runner::default();
    user_says(&galley, MAIN, "帮我把 PDF 分类", Origin::desktop()).await;
    step(
        &galley,
        MAIN,
        0,
        Some("交给子任务了，分类好会告诉你。"),
        None,
        json!([]),
    )
    .await;
    answered_report(&galley, &runner, &env, "s-sub").await;
    // A side chat that talks about the silent reply is found as before.
    galley
        .create_session(input("s-side", "旁聊"), Origin::desktop())
        .await
        .expect("side chat");
    let t = user_says(&galley, "s-side", "no-reply 是什么", Origin::desktop()).await;
    step(
        &galley,
        "s-side",
        t,
        None,
        Some("查一下 no-reply"),
        json!([{"toolName": "code_run"}]),
    )
    .await;

    // Index every row the way a rebuild does (the silent reply has no
    // final answer, so only a rebuild puts it in the index).
    galley.backfill_fts_if_empty().await.expect("rebuild index");

    let hits = |query: &'static str| {
        let galley = galley.clone();
        async move {
            let mut hits = galley
                .search_message_hits(query.into(), 50, None, None)
                .await
                .expect("search")
                .into_iter()
                .map(|hit| (hit.session_id, hit.role))
                .collect::<Vec<_>>();
            hits.sort();
            hits
        }
    };
    let side_rows = vec![
        ("s-side".to_string(), "assistant".to_string()),
        ("s-side".to_string(), "user".to_string()),
    ];
    // The report's text and the silent reply: through the index, and
    // through the two-character LIKE fallback.
    assert!(hits("not a message from the user").await.is_empty());
    assert_eq!(hits("no-reply").await, side_rows);
    assert_eq!(hits("ly").await, side_rows);
    assert!(hits("Ga").await.is_empty());
    // Ordinary rows of the main chat are found.
    assert_eq!(
        hits("分类好会告诉你").await,
        vec![(MAIN.to_string(), "assistant".to_string())]
    );

    // The Agent API's search still finds the report.
    let cli = galley
        .search_messages(
            "not a message from the user".into(),
            SearchScope::Active,
            None,
            None,
        )
        .await
        .expect("cli search");
    assert_eq!(cli.len(), 1);
    assert_eq!(cli[0].session_id.as_str(), MAIN);
}
