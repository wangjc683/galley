//! Scheduled tasks waking the assistant (main chat ticket 33): the
//! scheduler's half (`galley_core_lib::scheduler`: what is due, the fire
//! stamped pending) and the wake pipeline's (`galley_core_lib::subtask_report`:
//! pending fires read back, delivered, settled, or handed to a
//! notification), against an in-memory database, a scripted runner
//! registry with the run gate's rules, and a fake managed spawn env —
//! the same fakes as `subtask_report_test.rs`, duplicated because each
//! `tests/*.rs` is its own crate root.
//!
//! - a one-off fires once, at its time; asleep for days it fires late and
//!   says how late; never twice;
//! - `target = assistant` starts no session and wakes the main chat; two
//!   due at once go in one wake; delivered when the turn ends;
//! - not delivered — the main chat waiting for its answer, its runner not
//!   starting, the turn ending on an error — is consumed and handed to a
//!   notification with the task's words, never retried;
//! - a restart sends what was fired and not delivered;
//! - a cancelled task drops out;
//! - a session a `target = session` task started reports its run to the
//!   main chat and stays an ordinary session; not once someone wrote in it,
//!   and not under the external runtime;
//! - the turn the assistant made a task in is settled to its reply.

use async_trait::async_trait;
use chrono::{DateTime, Duration as ChronoDuration, Local, Utc};
use galley_core_lib::api::schedule::{
    instant_to_utc_iso, CreateScheduledTaskInput, ScheduleTarget, ScheduledTaskBrief,
    ScheduledTaskRepeat, ScheduledWake, SCHEDULED_REMINDER_UNDELIVERED_EVENT,
    SCHEDULED_TASKS_CHANGED_EVENT,
};
use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, MessageVisibility, Origin, OriginVia, RuntimeKind, SessionId,
    ASSISTANT_SUPERVISOR, SUBTASK_REPORT_SUPERVISOR,
};
use galley_core_lib::db::{MainChatSeed, PersistAssistantMessage, SqliteGalley};
use galley_core_lib::ipc::{HistoryLoadedEvent, IpcCommand, IpcEvent, ReadyEvent};
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    is_side_question, BroadcastItem, HeldClose, QueueOffer, ReadySnapshot, RunSignal, RunState,
    RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::scheduler::{due_at, fire_reminder, SCHEDULER_SUPERVISOR};
use galley_core_lib::session_runner::{RunnerHost, SpawnEnv};
use galley_core_lib::socket_listener::RunnerPort;
use galley_core_lib::subtask_report::{
    record_run_end, record_wake_run_end, restore_pending_reminders, take_due, wake_if_due,
    ReportOutcome, SubtaskReports, WakeOutcome,
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

fn assistant() -> Origin {
    Origin {
        via: OriginVia::Supervisor,
        supervisor: Some(ASSISTANT_SUPERVISOR.into()),
        reason: Some("reminder".into()),
        client: None,
    }
}

fn once_input(id: &str, prompt: &str, fire_at: DateTime<Utc>) -> CreateScheduledTaskInput {
    CreateScheduledTaskInput {
        id: id.into(),
        project_id: None,
        prompt: prompt.into(),
        repeat: ScheduledTaskRepeat::Once,
        time_of_day: String::new(),
        llm_name: None,
        enabled: true,
        fire_at: Some(instant_to_utc_iso(&fire_at)),
        target: ScheduleTarget::Assistant,
    }
}

/// A one-off the assistant set for ten minutes from now.
async fn reminder(galley: &SqliteGalley, id: &str, prompt: &str) -> ScheduledTaskBrief {
    galley
        .create_scheduled_task(
            once_input(id, prompt, Utc::now() + ChronoDuration::minutes(10)),
            assistant(),
        )
        .await
        .expect("create reminder")
}

/// The computer slept through it: its time is `ago` in the past.
async fn slept_through(pool: &SqlitePool, id: &str, ago: ChronoDuration) -> String {
    let at = instant_to_utc_iso(&(Utc::now() - ago));
    sqlx::query("UPDATE scheduled_tasks SET fire_at = ? WHERE id = ?")
        .bind(&at)
        .bind(id)
        .execute(pool)
        .await
        .expect("move fire_at");
    at
}

/// The scheduler tick's half for the assistant's tasks: fire what is due
/// now. How many fired.
async fn tick(galley: &SqliteGalley, rec: &Recorder) -> usize {
    let now = Local::now();
    let mut fired = 0;
    for task in galley.list_scheduled_tasks().await.expect("list") {
        if task.target != ScheduleTarget::Assistant {
            continue;
        }
        if let Some(at) = due_at(&task, &Local, &now) {
            assert!(fire_reminder(galley, rec, &task, &at, &now).await);
            fired += 1;
        }
    }
    fired
}

async fn wake_state(galley: &SqliteGalley, id: &str) -> Option<ScheduledWake> {
    galley.scheduled_task(id).await.expect("task").last_wake
}

async fn session_count(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(pool)
        .await
        .expect("count")
}

// ---------------- one-offs ----------------

#[tokio::test]
async fn a_one_off_fires_once_and_a_late_one_says_how_late() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    reminder(&galley, "sched_water", "提醒用户喝水").await;
    // Not yet.
    assert_eq!(tick(&galley, &rec).await, 0);
    // Asleep for two days and three hours.
    let planned = slept_through(
        &pool,
        "sched_water",
        ChronoDuration::hours(51) + ChronoDuration::seconds(5),
    )
    .await;
    assert_eq!(tick(&galley, &rec).await, 1);
    assert_eq!(tick(&galley, &rec).await, 0, "never twice");
    let task = galley.scheduled_task("sched_water").await.unwrap();
    assert_eq!(task.last_wake, Some(ScheduledWake::Pending));
    assert_eq!(task.last_due_at.as_deref(), Some(planned.as_str()));
    assert!(task.next_fire_at.is_none(), "fired");
    assert!(!rec.named(SCHEDULED_TASKS_CHANGED_EVENT).is_empty());

    assert_eq!(
        restore_pending_reminders(&reports, &galley)
            .await
            .as_deref(),
        Some(MAIN)
    );
    let host = host(&galley, &runner, &env, rec.clone());
    let Some(WakeOutcome::Delivered { message, .. }) = wake_if_due(&reports, &host, MAIN).await
    else {
        panic!("not delivered");
    };
    // No session: the main chat is the only one.
    assert_eq!(session_count(&pool).await, 1);
    let sent = runner.user_messages(MAIN);
    assert_eq!(sent.len(), 1);
    assert!(
        sent[0].starts_with("[Galley — not a message from the user] A reminder you set came due.")
    );
    assert!(sent[0].contains("Reminder `sched_water` (one-off) came due."));
    assert!(sent[0].contains("2 days 3 hours late"), "{}", sent[0]);
    assert!(sent[0].contains("<<<\n提醒用户喝水\n>>>"));
    // The wake row: Galley's, hidden by its label, the task in its note.
    let row: (String, Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT created_via, supervisor, origin_note, summary FROM messages WHERE id = ?",
    )
    .bind(&message.id.0)
    .fetch_one(&pool)
    .await
    .expect("row");
    assert_eq!(row.0, "system");
    assert_eq!(row.1.as_deref(), Some(SUBTASK_REPORT_SUPERVISOR));
    assert_eq!(row.2.as_deref(), Some("sched_water"));
    let summary = row.3.unwrap();
    assert!(summary.starts_with("[Galley: reminder sched_water came due (planned "));
    assert!(summary.ends_with(" late) — details: schedule show sched_water]"));

    // Still pending while its turn runs; delivered when it ends.
    assert_eq!(
        wake_state(&galley, "sched_water").await,
        Some(ScheduledWake::Pending)
    );
    assert_eq!(reports.in_flight(MAIN).len(), 1);
    runner.run_ended(MAIN, "CURRENT_TASK_DONE", false);
    record_wake_run_end(&reports, &galley, &runner, rec.as_ref(), &complete(MAIN)).await;
    assert_eq!(
        wake_state(&galley, "sched_water").await,
        Some(ScheduledWake::Delivered)
    );
    assert!(rec.named(SCHEDULED_REMINDER_UNDELIVERED_EVENT).is_empty());
    // Nothing left to send, in this process or after a restart.
    assert!(restore_pending_reminders(&reports, &galley).await.is_none());
    assert!(restore_pending_reminders(&SubtaskReports::new(), &galley)
        .await
        .is_none());
}

#[tokio::test]
async fn two_due_at_once_wake_the_main_chat_once() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    reminder(&galley, "sched_a", "带身份证").await;
    reminder(&galley, "sched_b", "给妈妈打电话").await;
    slept_through(&pool, "sched_a", ChronoDuration::seconds(30)).await;
    slept_through(&pool, "sched_b", ChronoDuration::seconds(20)).await;
    assert_eq!(tick(&galley, &rec).await, 2);
    restore_pending_reminders(&reports, &galley).await;
    let host = host(&galley, &runner, &env, rec.clone());
    assert!(matches!(
        wake_if_due(&reports, &host, MAIN).await,
        Some(WakeOutcome::Delivered { .. })
    ));
    let sent = runner.user_messages(MAIN);
    assert_eq!(sent.len(), 1, "one wake");
    assert!(sent[0].contains("`sched_a`") && sent[0].contains("`sched_b`"));
    assert!(sent[0].ends_with("Reply once, covering all of them."));
    // On time: nothing about lateness.
    assert!(!sent[0].contains(" late"));
}

// ---------------- not delivered ----------------

#[tokio::test]
async fn waiting_for_its_answer_the_main_chat_gets_a_notification_instead() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    let host = host(&galley, &runner, &env, rec.clone());
    runner.edit_gate(MAIN, |g| g.ask_pending = true);
    reminder(&galley, "sched_water", "提醒用户喝水").await;
    slept_through(&pool, "sched_water", ChronoDuration::seconds(10)).await;
    tick(&galley, &rec).await;
    restore_pending_reminders(&reports, &galley).await;

    assert!(take_due(&reports, &host, MAIN).await.is_none());
    assert!(runner.user_messages(MAIN).is_empty(), "not sent");
    assert_eq!(
        rec.named(SCHEDULED_REMINDER_UNDELIVERED_EVENT),
        vec![json!({"taskId": "sched_water", "prompt": "提醒用户喝水", "reason": "asking"})]
    );
    // Consumed: not tried again, now or after a restart.
    assert_eq!(
        wake_state(&galley, "sched_water").await,
        Some(ScheduledWake::Notified)
    );
    assert!(reports.waiting(MAIN).is_empty());
    runner.edit_gate(MAIN, |g| g.ask_pending = false);
    assert!(wake_if_due(&reports, &host, MAIN).await.is_none());
    assert!(restore_pending_reminders(&SubtaskReports::new(), &galley)
        .await
        .is_none());
    assert_eq!(rec.named(SCHEDULED_REMINDER_UNDELIVERED_EVENT).len(), 1);
}

#[tokio::test]
async fn a_runner_that_does_not_start_hands_the_reminder_to_a_notification() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    runner.fail_spawn.store(true, Ordering::SeqCst);
    reminder(&galley, "sched_water", "提醒用户喝水").await;
    slept_through(&pool, "sched_water", ChronoDuration::seconds(10)).await;
    tick(&galley, &rec).await;
    restore_pending_reminders(&reports, &galley).await;
    let host = host(&galley, &runner, &env, rec.clone());
    assert!(matches!(
        wake_if_due(&reports, &host, MAIN).await,
        Some(WakeOutcome::Failed(_))
    ));
    assert_eq!(
        rec.named(SCHEDULED_REMINDER_UNDELIVERED_EVENT),
        vec![json!({"taskId": "sched_water", "prompt": "提醒用户喝水", "reason": "not_started"})]
    );
    assert_eq!(
        wake_state(&galley, "sched_water").await,
        Some(ScheduledWake::Notified)
    );
    assert!(reports.waiting(MAIN).is_empty(), "not kept for a retry");
    assert!(!runner.gate(MAIN).open_run, "gate released");
}

#[tokio::test]
async fn a_turn_that_ends_on_an_error_hands_the_reminder_to_a_notification() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    reminder(&galley, "sched_water", "提醒用户喝水").await;
    slept_through(&pool, "sched_water", ChronoDuration::seconds(10)).await;
    tick(&galley, &rec).await;
    restore_pending_reminders(&reports, &galley).await;
    let host = host(&galley, &runner, &env, rec.clone());
    assert!(matches!(
        wake_if_due(&reports, &host, MAIN).await,
        Some(WakeOutcome::Delivered { .. })
    ));
    // The model errored: the turn ended without a reply.
    runner.run_ended(MAIN, "DONE_WITHOUT_EXIT", false);
    record_wake_run_end(&reports, &galley, &runner, rec.as_ref(), &complete(MAIN)).await;
    assert_eq!(
        wake_state(&galley, "sched_water").await,
        Some(ScheduledWake::Notified)
    );
    assert_eq!(
        rec.named(SCHEDULED_REMINDER_UNDELIVERED_EVENT),
        vec![json!({"taskId": "sched_water", "prompt": "提醒用户喝水", "reason": "no_reply"})]
    );
    assert!(reports.in_flight(MAIN).is_empty());
}

// ---------------- durable ----------------

#[tokio::test]
async fn a_restart_sends_what_fired_and_was_not_delivered() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    // Before the restart: fired while the main chat was busy (or waiting
    // for an answer) and Galley quit.
    let before = SubtaskReports::new();
    runner.edit_gate(MAIN, |g| g.open_run = true);
    reminder(&galley, "sched_water", "提醒用户喝水").await;
    slept_through(&pool, "sched_water", ChronoDuration::minutes(3)).await;
    tick(&galley, &rec).await;
    restore_pending_reminders(&before, &galley).await;
    let host = host(&galley, &runner, &env, rec.clone());
    assert!(take_due(&before, &host, MAIN).await.is_none(), "busy");
    // A tick in the same process does not add it twice.
    assert!(restore_pending_reminders(&before, &galley).await.is_none());

    // After: a fresh process, an idle main chat.
    runner.settle(MAIN);
    let after = SubtaskReports::new();
    assert_eq!(
        restore_pending_reminders(&after, &galley).await.as_deref(),
        Some(MAIN)
    );
    let waiting = after.waiting(MAIN);
    assert_eq!(waiting.len(), 1);
    assert!(
        matches!(&waiting[0].outcome, ReportOutcome::Due(due) if due.late.as_deref() == Some("3 minutes"))
    );
    assert!(matches!(
        wake_if_due(&after, &host, MAIN).await,
        Some(WakeOutcome::Delivered { .. })
    ));
    assert_eq!(runner.user_messages(MAIN).len(), 1);
}

#[tokio::test]
async fn a_cancelled_reminder_drops_out() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    runner.edit_gate(MAIN, |g| g.open_run = true);
    reminder(&galley, "sched_water", "提醒用户喝水").await;
    slept_through(&pool, "sched_water", ChronoDuration::seconds(10)).await;
    tick(&galley, &rec).await;
    restore_pending_reminders(&reports, &galley).await;
    galley
        .delete_scheduled_task(
            galley_core_lib::api::ScheduledTaskId("sched_water".into()),
            assistant(),
        )
        .await
        .expect("cancel");
    runner.settle(MAIN);
    let host = host(&galley, &runner, &env, rec.clone());
    assert!(matches!(
        wake_if_due(&reports, &host, MAIN).await,
        Some(WakeOutcome::NothingLeft)
    ));
    assert!(runner.user_messages(MAIN).is_empty());
    assert!(rec.named(SCHEDULED_REMINDER_UNDELIVERED_EVENT).is_empty());
    assert!(restore_pending_reminders(&SubtaskReports::new(), &galley)
        .await
        .is_none());
    // A cancelled one-off never fires either.
    reminder(&galley, "sched_tea", "泡茶").await;
    slept_through(&pool, "sched_tea", ChronoDuration::seconds(10)).await;
    galley
        .delete_scheduled_task(
            galley_core_lib::api::ScheduledTaskId("sched_tea".into()),
            assistant(),
        )
        .await
        .expect("cancel");
    assert_eq!(tick(&galley, &rec).await, 0);
}

// ---------------- what the tasks may be ----------------

#[tokio::test]
async fn a_past_time_and_a_missing_assistant_are_refused() {
    let (_pool, galley) = with_main_chat().await;
    let err = galley
        .create_scheduled_task(
            once_input("sched_past", "x", Utc::now() - ChronoDuration::minutes(1)),
            assistant(),
        )
        .await
        .expect_err("past");
    assert!(err.to_string().contains("time_in_past:"), "{err}");
    // A model belongs to sessions.
    let mut with_llm = once_input("sched_llm", "x", Utc::now() + ChronoDuration::hours(1));
    with_llm.llm_name = Some("Model".into());
    assert!(galley
        .create_scheduled_task(with_llm, assistant())
        .await
        .is_err());

    // The external runtime has no assistant to wake.
    galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .expect("external");
    let err = galley
        .create_scheduled_task(
            once_input("sched_ext", "x", Utc::now() + ChronoDuration::hours(1)),
            assistant(),
        )
        .await
        .expect_err("external");
    assert!(err.to_string().contains("assistant_unavailable:"), "{err}");
    // A session task is made as before, and reads like one.
    let made = galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                target: ScheduleTarget::Session,
                ..once_input("sched_s", "整理下载", Utc::now() + ChronoDuration::hours(1))
            },
            Origin::gui(),
        )
        .await
        .expect("session one-off");
    assert_eq!(made.target, ScheduleTarget::Session);
    assert_eq!(made.origin.as_ref().map(|o| o.via), Some(OriginVia::Gui));
}

#[tokio::test]
async fn under_the_external_runtime_pending_fires_wait() {
    let (pool, galley) = with_main_chat().await;
    let rec = Arc::new(Recorder::default());
    reminder(&galley, "sched_water", "提醒用户喝水").await;
    slept_through(&pool, "sched_water", ChronoDuration::seconds(10)).await;
    tick(&galley, &rec).await;
    galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .expect("external");
    assert!(galley
        .ensure_assistant_available("scheduler")
        .await
        .is_err());
    // Not read into the main chat's reports while external…
    assert!(restore_pending_reminders(&SubtaskReports::new(), &galley)
        .await
        .is_none());
    // …and sent once the managed runtime is back.
    galley
        .set_pref_json("active_runtime_kind", json!("managed"))
        .await
        .expect("managed");
    assert!(restore_pending_reminders(&SubtaskReports::new(), &galley)
        .await
        .is_some());
}

// ---------------- sessions a task started ----------------

/// A session the scheduler started for task `task`, its first message the
/// scheduler's, its run finished with `answer`.
async fn scheduled_session(galley: &SqliteGalley, runner: &Runner, sid: &str, task: &str) {
    let origin = Origin {
        via: OriginVia::Supervisor,
        supervisor: Some(SCHEDULER_SUPERVISOR.into()),
        reason: Some(format!("scheduled task {task}")),
        client: None,
    };
    galley
        .create_session(input(sid, "每天早上的摘要"), origin.clone())
        .await
        .expect("session");
    galley
        .send_message(SessionId(sid.into()), "每天早上的摘要".into(), origin)
        .await
        .expect("first message");
    let turn = last_user_turn(galley, sid).await;
    step(galley, sid, turn, Some("今天三件事。"), None, json!([])).await;
    runner.run_ended(sid, "CURRENT_TASK_DONE", false);
}

async fn digest_task(galley: &SqliteGalley) {
    galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                id: "sched_digest".into(),
                project_id: None,
                prompt: "每天早上的摘要".into(),
                repeat: ScheduledTaskRepeat::Daily,
                time_of_day: "09:00".into(),
                llm_name: None,
                enabled: true,
                fire_at: None,
                target: ScheduleTarget::Session,
            },
            Origin::gui(),
        )
        .await
        .expect("task");
}

#[tokio::test]
async fn a_session_a_task_started_reports_its_run_and_stays_a_session() {
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    digest_task(&galley).await;
    scheduled_session(&galley, &runner, "s-sched", "sched_digest").await;

    let main = record_run_end(&reports, &galley, &runner, &complete("s-sched")).await;
    assert_eq!(main.as_deref(), Some(MAIN));
    let waiting = reports.waiting(MAIN);
    assert_eq!(waiting.len(), 1);
    assert_eq!(waiting[0].subtask_id.as_deref(), Some("s-sched"));
    assert_eq!(
        waiting[0].scheduled_task_id.as_deref(),
        Some("sched_digest")
    );
    assert_eq!(waiting[0].title, "每天早上的摘要");
    assert_eq!(
        waiting[0].outcome,
        ReportOutcome::Done {
            answer: "今天三件事。".into()
        }
    );
    runner.settle("s-sched");
    let host = host(&galley, &runner, &env, rec.clone());
    assert!(matches!(
        wake_if_due(&reports, &host, MAIN).await,
        Some(WakeOutcome::Delivered { .. })
    ));
    let sent = runner.user_messages(MAIN);
    assert!(sent[0].starts_with("[Galley — not a message from the user] A scheduled task ran."));
    assert!(sent[0].contains(
        "Scheduled task `sched_digest` ran in session `s-sched` (\"每天早上的摘要\") and finished."
    ));
    // Still an ordinary session.
    let brief = galley
        .session_brief(SessionId("s-sched".into()))
        .await
        .unwrap();
    assert!(brief.parent_session_id.is_none());
    assert!(brief.promoted.is_none());

    // Once someone wrote in it from an app, it is theirs: no report.
    user_says(&galley, "s-sched", "再详细点", Origin::desktop()).await;
    let turn = last_user_turn(&galley, "s-sched").await;
    step(&galley, "s-sched", turn, Some("好的。"), None, json!([])).await;
    runner.run_ended("s-sched", "CURRENT_TASK_DONE", false);
    assert!(
        record_run_end(&reports, &galley, &runner, &complete("s-sched"))
            .await
            .is_none()
    );
}

#[tokio::test]
async fn under_the_external_runtime_a_task_session_reports_nothing() {
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let reports = SubtaskReports::new();
    digest_task(&galley).await;
    scheduled_session(&galley, &runner, "s-sched", "sched_digest").await;
    galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .expect("external");
    assert!(
        record_run_end(&reports, &galley, &runner, &complete("s-sched"))
            .await
            .is_none()
    );
    assert!(reports.waiting(MAIN).is_empty());
}

#[tokio::test]
async fn a_session_without_a_task_label_reports_nothing() {
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let reports = SubtaskReports::new();
    galley
        .create_session(input("s-plain", "普通会话"), Origin::desktop())
        .await
        .expect("session");
    galley
        .send_message(
            SessionId("s-plain".into()),
            "你好".into(),
            Origin::cli(
                Some("ga-claude-1".into()),
                Some("scheduled task sched_x".into()),
            ),
        )
        .await
        .expect("message");
    let turn = last_user_turn(&galley, "s-plain").await;
    step(&galley, "s-plain", turn, Some("嗨"), None, json!([])).await;
    runner.run_ended("s-plain", "CURRENT_TASK_DONE", false);
    assert!(
        record_run_end(&reports, &galley, &runner, &complete("s-plain"))
            .await
            .is_none()
    );
}

// ---------------- where it was made ----------------

#[tokio::test]
async fn a_task_made_in_a_main_chat_run_hangs_under_its_reply() {
    let (_pool, galley) = with_main_chat().await;
    let run_turn = user_says(&galley, MAIN, "十分钟后提醒我喝水", Origin::desktop()).await;
    let made = galley
        .create_scheduled_task_in(
            once_input(
                "sched_water",
                "提醒用户喝水",
                Utc::now() + ChronoDuration::minutes(10),
            ),
            assistant(),
            Some((SessionId(MAIN.into()), run_turn)),
        )
        .await
        .expect("create");
    let created_in = made.created_in.expect("made in the main chat");
    assert_eq!(created_in.session_id.as_str(), MAIN);
    assert_eq!(created_in.turn_index, None, "the run is still open");
    assert_eq!(
        made.origin.as_ref().and_then(|o| o.supervisor.as_deref()),
        Some(ASSISTANT_SUPERVISOR)
    );
    // No reply yet: nothing to settle.
    assert_eq!(galley.settle_scheduled_created_in(MAIN).await.unwrap(), 0);
    // The run writes a step and its reply; it ends.
    step(
        &galley,
        MAIN,
        run_turn,
        None,
        Some("好"),
        json!([{"toolName": "code_run"}]),
    )
    .await;
    step(
        &galley,
        MAIN,
        run_turn + 1,
        Some("好，十分钟后提醒你。"),
        None,
        json!([]),
    )
    .await;
    assert_eq!(galley.settle_scheduled_created_in(MAIN).await.unwrap(), 1);
    let settled = galley.scheduled_task("sched_water").await.unwrap();
    assert_eq!(settled.created_in.unwrap().turn_index, Some(run_turn + 1));
    let wire = serde_json::to_value(galley.scheduled_task("sched_water").await.unwrap()).unwrap();
    assert_eq!(
        wire["createdIn"],
        json!({"sessionId": MAIN, "turnIndex": run_turn + 1})
    );
    // A later run does not move it.
    let next = user_says(&galley, MAIN, "谢谢", Origin::desktop()).await;
    step(&galley, MAIN, next, Some("不客气"), None, json!([])).await;
    assert_eq!(galley.settle_scheduled_created_in(MAIN).await.unwrap(), 0);
}

#[tokio::test]
async fn reading_a_one_off_on_the_wire() {
    let (_pool, galley) = with_main_chat().await;
    let task = reminder(&galley, "sched_wire", "带伞").await;
    let wire = serde_json::to_value(&task).unwrap();
    assert_eq!(wire["repeat"], json!({"kind": "once"}));
    assert_eq!(wire["target"], "assistant");
    assert_eq!(wire["fireAt"], wire["nextFireAt"]);
    assert_eq!(
        wire["origin"],
        json!({"via": "supervisor", "supervisor": "galley-assistant", "reason": "reminder"})
    );
    // timeOfDay is the local wall clock of fireAt.
    let fire_at = DateTime::parse_from_rfc3339(wire["fireAt"].as_str().unwrap()).unwrap();
    assert_eq!(
        wire["timeOfDay"],
        fire_at.with_timezone(&Local).format("%H:%M").to_string()
    );
    assert!(wire.get("lastWake").is_none());
    assert!(wire.get("cancelledAt").is_none());
}
