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
//! - the turn the assistant made a task in is settled to its reply;
//! - a to-do's reminder (ticket 39) says which to-do and when it is due,
//!   and a to-do ticked off is not reminded of, whenever it is ticked;
//! - the morning review (ticket 73) is made once ever, wakes nobody with
//!   nothing to look at (ticket 81: only what has no alarm of its own —
//!   a to-do with no date or due within three days, a subtask not
//!   finished — and a failed read wakes it), wakes the main chat in words
//!   of its own otherwise,
//!   stays out of 已完成, and is dropped without a notification when it
//!   cannot be delivered;
//! - a routine that fired stays out of 已完成 too, a one-off that fired
//!   for its time is in it (ticket 82).
//! - since ticket 95 the review also wakes for the memos noted or changed
//!   in turns the user started since the day of the review before it (a
//!   day skipped reaches back, this morning's wait for tomorrow, one past
//!   its day or deleted does not count) and names them; its words are as
//!   before without them; run by hand it names its own window, and none
//!   the second time that day.

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

// ---------------- to-dos' reminders (ticket 39) ----------------

/// A to-do Galley noted with a reminder ten minutes from now.
async fn todo_with_reminder(
    galley: &SqliteGalley,
    title: &str,
    notes: Option<&str>,
    due: Option<&str>,
) -> galley_core_lib::api::TodoBrief {
    galley
        .create_todo(
            galley_core_lib::api::CreateTodoInput {
                title: title.into(),
                notes: notes.map(str::to_string),
                due: due.map(str::to_string),
                remind_at: Some(instant_to_utc_iso(
                    &(Utc::now() + ChronoDuration::minutes(10)),
                )),
            },
            assistant(),
            None,
        )
        .await
        .expect("to-do with a reminder")
}

fn reminder_of(todo: &galley_core_lib::api::TodoBrief) -> String {
    todo.reminder
        .as_ref()
        .expect("reminder")
        .task_id
        .as_str()
        .to_string()
}

#[tokio::test]
async fn a_to_dos_reminder_says_which_to_do_and_when_it_is_due() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    let todo =
        todo_with_reminder(&galley, "交季度报告", Some("发给王总"), Some("2026-10-21")).await;
    let task = reminder_of(&todo);
    slept_through(&pool, &task, ChronoDuration::seconds(30)).await;
    assert_eq!(tick(&galley, &rec).await, 1);
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
    let sent = runner.user_messages(MAIN);
    assert_eq!(sent.len(), 1);
    let text = &sent[0];
    assert!(text.starts_with("[Galley — not a message from the user] A reminder you set came due."));
    assert!(
        text.contains(&format!(
            "Reminder `{task}` on the user's to-do `{}` came due. Planned for ",
            todo.id
        )),
        "{text}"
    );
    assert!(text.contains(
        "The to-do is on the user's list, something to do or something coming up they want to \
         hear about:\n<<<\n交季度报告\n发给王总\n>>>\nIt is due 2026-10-21 (Wed), local time. Act \
         on it now: tell the user what is of use to them now"
    ));
    let summary: Option<String> = sqlx::query_scalar("SELECT summary FROM messages WHERE id = ?")
        .bind(&message.id.0)
        .fetch_one(&pool)
        .await
        .expect("row");
    assert!(summary.unwrap().starts_with(&format!(
        "[Galley: reminder {task} for to-do {} came due (",
        todo.id
    )));

    // Without a due date it says so; its words are the title as it is
    // now.
    let reports = SubtaskReports::new();
    runner.settle(MAIN);
    let call = todo_with_reminder(&galley, "给房东回电话", None, None).await;
    galley
        .update_todo(
            &call.id,
            galley_core_lib::api::TodoPatch {
                title: Some("明天给房东回电话".into()),
                ..Default::default()
            },
            assistant(),
        )
        .await
        .expect("rename");
    slept_through(&pool, &reminder_of(&call), ChronoDuration::seconds(30)).await;
    assert_eq!(tick(&galley, &rec).await, 1);
    restore_pending_reminders(&reports, &galley).await;
    assert!(matches!(
        wake_if_due(&reports, &host, MAIN).await,
        Some(WakeOutcome::Delivered { .. })
    ));
    let sent = runner.user_messages(MAIN);
    assert!(
        sent[1].contains("<<<\n明天给房东回电话\n>>>\nIt has no due date."),
        "{}",
        sent[1]
    );
}

#[tokio::test]
async fn a_to_do_ticked_off_is_not_reminded_of() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let host = host(&galley, &runner, &env, rec.clone());

    // Ticked before its time: the reminder is cancelled and never fires.
    let early = todo_with_reminder(&galley, "交报告", None, None).await;
    galley
        .complete_todo(&early.id, Origin::desktop())
        .await
        .expect("tick");
    slept_through(&pool, &reminder_of(&early), ChronoDuration::seconds(30)).await;
    assert_eq!(tick(&galley, &rec).await, 0);

    // Ticked between its fire and the wake: the waiting report drops
    // out when the wake reads it again. (Closed behind the write that
    // cancels the reminder, as a tick racing the scheduler would.)
    let raced = todo_with_reminder(&galley, "打电话", None, None).await;
    slept_through(&pool, &reminder_of(&raced), ChronoDuration::seconds(30)).await;
    assert_eq!(tick(&galley, &rec).await, 1);
    let reports = SubtaskReports::new();
    assert!(restore_pending_reminders(&reports, &galley).await.is_some());
    sqlx::query("UPDATE todos SET done_at = ?, done_via = 'gui' WHERE id = ?")
        .bind(instant_to_utc_iso(&Utc::now()))
        .bind(raced.id.as_str())
        .execute(&pool)
        .await
        .expect("close");
    assert!(matches!(
        wake_if_due(&reports, &host, MAIN).await,
        Some(WakeOutcome::NothingLeft)
    ));
    assert!(runner.user_messages(MAIN).is_empty());
    // Nor after a restart.
    assert!(restore_pending_reminders(&SubtaskReports::new(), &galley)
        .await
        .is_none());

    // Due while its to-do is closed: the scheduler's check cancels it
    // instead of firing it.
    let late = todo_with_reminder(&galley, "取快递", None, None).await;
    let task = reminder_of(&late);
    slept_through(&pool, &task, ChronoDuration::seconds(30)).await;
    sqlx::query("UPDATE todos SET cancelled_at = ? WHERE id = ?")
        .bind(instant_to_utc_iso(&Utc::now()))
        .bind(late.id.as_str())
        .execute(&pool)
        .await
        .expect("close");
    let now = Local::now();
    let due: Vec<(ScheduledTaskBrief, DateTime<Local>)> = galley
        .list_scheduled_tasks()
        .await
        .expect("list")
        .into_iter()
        .filter_map(|t| due_at(&t, &Local, &now).map(|at| (t, at)))
        .collect();
    assert_eq!(due.len(), 1);
    let kept =
        galley_core_lib::scheduler::drop_reminders_of_closed_todos(&galley, rec.as_ref(), due)
            .await;
    assert!(kept.is_empty());
    let dropped = galley.scheduled_task(&task).await.expect("task");
    assert!(dropped.cancelled_at.is_some());
    // Core did it on its own (ticket 61): not the user turning it down.
    let by = dropped.cancelled_by.expect("who cancelled");
    assert_eq!(by.via, galley_core_lib::api::OriginVia::System);
    assert!(by.supervisor.is_none() && by.reason.is_none());
    assert_eq!(tick(&galley, &rec).await, 0);

    // A to-do still open: its reminder goes off as any.
    let open = todo_with_reminder(&galley, "买营养土", None, None).await;
    slept_through(&pool, &reminder_of(&open), ChronoDuration::seconds(30)).await;
    let now = Local::now();
    let due: Vec<(ScheduledTaskBrief, DateTime<Local>)> = galley
        .list_scheduled_tasks()
        .await
        .expect("list")
        .into_iter()
        .filter_map(|t| due_at(&t, &Local, &now).map(|at| (t, at)))
        .collect();
    let kept =
        galley_core_lib::scheduler::drop_reminders_of_closed_todos(&galley, rec.as_ref(), due)
            .await;
    assert_eq!(kept.len(), 1);
}

// ---------------- the morning review (ticket 73) ----------------

use galley_core_lib::assistant_todo::assistant_todo;
use galley_core_lib::runner_manager::RunnerManager;
use galley_core_lib::scheduler::{
    ensure_review, fire_review, review_times, ReviewFire, REVIEW_LOG_PREF, REVIEW_SUPERVISOR,
};

/// The review's log, as the trial snapshot reads it.
async fn review_log(galley: &SqliteGalley) -> Vec<Value> {
    match galley.get_pref_json(REVIEW_LOG_PREF).await.expect("read") {
        Some(Value::Array(entries)) => entries,
        Some(other) => panic!("not an array: {other}"),
        None => Vec::new(),
    }
}

/// Fire the review now, as the scheduler does when it comes due.
async fn fire_review_now(galley: &SqliteGalley, rec: &Recorder, id: &str) -> ReviewFire {
    let task = galley.scheduled_task(id).await.expect("review");
    let now = Local::now();
    fire_review(galley, &RunnerManager::new(), rec, &task, &now, &now).await
}

/// Today plus `days`, a day as `todo add --due` takes it, in this
/// machine's zone (the one the list reads its days in).
fn day_from_today(days: i64) -> String {
    (Local::now().date_naive() + ChronoDuration::days(days))
        .format("%Y-%m-%d")
        .to_string()
}

/// A to-do of the user's the assistant noted, due `due` (`None`: any
/// time), with a reminder ten minutes from now when `remind`.
async fn users_todo(galley: &SqliteGalley, title: &str, due: Option<String>, remind: bool) {
    galley
        .create_todo(
            galley_core_lib::api::CreateTodoInput {
                title: title.into(),
                notes: None,
                due,
                remind_at: remind
                    .then(|| instant_to_utc_iso(&(Utc::now() + ChronoDuration::minutes(10)))),
            },
            assistant(),
            None,
        )
        .await
        .expect("to-do");
}

#[tokio::test]
async fn the_review_is_made_once_and_never_again() {
    let rec = Recorder::default();
    // No main chat yet: nothing to wake, nothing made.
    let (pool, galley) = fresh().await;
    assert!(ensure_review(&galley, &rec).await.is_none());
    galley
        .get_or_create_main_chat(MAIN, Origin::desktop(), &MainChatSeed::default())
        .await
        .expect("main chat");
    // The external runtime has no assistant: nothing made either.
    galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .expect("external");
    assert!(ensure_review(&galley, &rec).await.is_none());
    galley
        .set_pref_json("active_runtime_kind", json!("managed"))
        .await
        .expect("managed");

    let review = ensure_review(&galley, &rec).await.expect("made");
    assert!(review.is_review());
    assert_eq!(review.repeat, ScheduledTaskRepeat::Daily);
    // Ticket 78: a time around 9 that people do not set, picked as it is
    // made (which one is the scheduler's unit test).
    assert!(
        review_times().contains(&review.time_of_day),
        "{}",
        review.time_of_day
    );
    assert_eq!(review.target, ScheduleTarget::Assistant);
    assert!(review.enabled && review.created_in.is_none() && review.todo_id.is_none());
    let origin = review.origin.clone().expect("origin");
    assert_eq!(origin.via, OriginVia::System);
    assert_eq!(origin.supervisor.as_deref(), Some(REVIEW_SUPERVISOR));
    // On the wire as the CLI's `schedule list` prints it (ticket 74 reads
    // the same field from the desktop's reads).
    let wire = serde_json::to_value(&review).expect("wire");
    assert_eq!(
        wire["origin"],
        json!({"via": "system", "supervisor": "galley-review"})
    );
    assert!(!rec.named(SCHEDULED_TASKS_CHANGED_EVENT).is_empty());

    // Once: there, paused, cancelled — never made again. One there keeps
    // its time.
    assert!(ensure_review(&galley, &rec).await.is_none());
    let kept = galley
        .scheduled_task(review.id.as_str())
        .await
        .expect("kept");
    assert_eq!(kept.time_of_day, review.time_of_day);
    galley
        .update_scheduled_task(
            review.id.clone(),
            galley_core_lib::api::schedule::ScheduledTaskPatch {
                enabled: Some(false),
                ..Default::default()
            },
            assistant(),
        )
        .await
        .expect("pause");
    assert!(ensure_review(&galley, &rec).await.is_none());
    galley
        .delete_scheduled_task(review.id.clone(), assistant())
        .await
        .expect("cancel");
    assert!(ensure_review(&galley, &rec).await.is_none());
    let rows: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM scheduled_tasks WHERE created_by_supervisor = 'galley-review'",
    )
    .fetch_one(&pool)
    .await
    .expect("count");
    assert_eq!(rows, 1);
    // A label another agent passes is not the review.
    let mut other = review.clone();
    other.origin = Some(Origin {
        via: OriginVia::Supervisor,
        supervisor: Some(REVIEW_SUPERVISOR.into()),
        reason: None,
        client: None,
    });
    assert!(!other.is_review());
}

#[tokio::test]
async fn with_nothing_to_look_at_the_review_wakes_nobody() {
    let (_pool, galley) = with_main_chat().await;
    let rec = Recorder::default();
    let reports = SubtaskReports::new();
    let review = ensure_review(&galley, &rec).await.expect("made");
    // Ticket 81: what has an alarm of its own does not wake it. A to-do
    // due later, with its reminder (702) or without, four days on;
    // Galley's own one-offs, either target.
    users_todo(
        &galley,
        "702 办公室装修完工",
        Some(day_from_today(29)),
        true,
    )
    .await;
    users_todo(&galley, "交季度报告", Some(day_from_today(4)), false).await;
    reminder(&galley, "sched_water", "提醒用户喝水").await;
    galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                target: ScheduleTarget::Session,
                ..once_input(
                    "sched_weekly",
                    "整理这周的周报",
                    Utc::now() + ChronoDuration::days(1),
                )
            },
            Origin::gui(),
        )
        .await
        .expect("a one-off that starts a session");
    // A routine is not something to look at (the review is one), nor is
    // another.
    galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                repeat: ScheduledTaskRepeat::Daily,
                time_of_day: "20:00".into(),
                fire_at: None,
                ..once_input("sched_daily", "提醒用户吃药", Utc::now())
            },
            assistant(),
        )
        .await
        .expect("routine");
    assert_eq!(
        fire_review_now(&galley, &rec, review.id.as_str()).await,
        ReviewFire::Skipped
    );
    let task = galley.scheduled_task(review.id.as_str()).await.unwrap();
    assert!(task.last_fired_at.is_some() && task.last_due_at.is_some());
    assert_eq!(task.last_wake, None, "no wake");
    // Consumed: it does not come due again today.
    assert!(due_at(&task, &Local, &Local::now()).is_none());
    assert!(restore_pending_reminders(&reports, &galley).await.is_none());
    let log = review_log(&galley).await;
    assert_eq!(log.len(), 1);
    assert_eq!(log[0]["event"], "skipped");
    assert_eq!(log[0]["taskId"], review.id.as_str());
    assert_eq!(
        log[0]["firedAt"],
        task.last_fired_at.clone().unwrap().as_str()
    );
    // Not in 已完成: it did nothing by itself. In 例行, by its label.
    let todo = assistant_todo(&galley, &RunnerManager::new(), Utc::now())
        .await
        .expect("todo");
    assert!(todo.done.iter().all(|item| item.id != review.id.as_str()));
    let row = todo
        .routine
        .iter()
        .find(|item| item.id == review.id.as_str())
        .expect("in routine");
    assert_eq!(row.agent.as_deref(), Some(REVIEW_SUPERVISOR));
    // In hand all the same: the list and the "In Hand" lines are as they
    // were; only the review does not wake for them.
    assert_eq!(todo.yours.later.len(), 2);
    assert_eq!(todo.assistant.len(), 2);
    assert!(!todo.review_has_something_to_look_at(Local::now().date_naive()));
}

#[tokio::test]
async fn with_something_to_look_at_the_review_wakes_the_main_chat() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    let review = ensure_review(&galley, rec.as_ref()).await.expect("made");
    // A to-do of the user's with no date, as ticket 73 notes them.
    galley
        .create_todo(
            galley_core_lib::api::CreateTodoInput {
                title: "查清阿里云费用暴涨的原因".into(),
                notes: None,
                due: None,
                remind_at: None,
            },
            assistant(),
            None,
        )
        .await
        .expect("to-do");
    assert_eq!(
        fire_review_now(&galley, rec.as_ref(), review.id.as_str()).await,
        ReviewFire::Woke
    );
    assert_eq!(
        wake_state(&galley, review.id.as_str()).await,
        Some(ScheduledWake::Pending)
    );
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
    let sent = runner.user_messages(MAIN);
    assert_eq!(sent.len(), 1);
    assert!(sent[0]
        .starts_with("[Galley — not a message from the user] It is time for the morning review."));
    assert!(sent[0].contains(&format!(
        "The morning review `{}` (every day at {}) came due.",
        review.id, review.time_of_day
    )));
    assert!(sent[0].contains("Read \"The morning review\" in `wake.md` in your"));
    assert!(sent[0].contains("start at most two subtasks in all."));
    let note: Option<String> = sqlx::query_scalar("SELECT origin_note FROM messages WHERE id = ?")
        .bind(&message.id.0)
        .fetch_one(&pool)
        .await
        .expect("row");
    assert_eq!(note.as_deref(), Some(review.id.as_str()));
    runner.run_ended(MAIN, "CURRENT_TASK_DONE", false);
    record_wake_run_end(&reports, &galley, &runner, rec.as_ref(), &complete(MAIN)).await;
    assert_eq!(
        wake_state(&galley, review.id.as_str()).await,
        Some(ScheduledWake::Delivered)
    );
    let log = review_log(&galley).await;
    assert_eq!(log.len(), 1);
    assert_eq!(log[0]["event"], "woke");
    // A fire that woke it stays out of 已完成 too; 例行 lists it.
    let todo = assistant_todo(&galley, &RunnerManager::new(), Utc::now())
        .await
        .expect("todo");
    assert!(todo.done.iter().all(|item| item.id != review.id.as_str()));
    assert!(todo
        .routine
        .iter()
        .any(|item| item.id == review.id.as_str()
            && item.agent.as_deref() == Some(REVIEW_SUPERVISOR)));

    // Ticket 81: a to-do due within three days of today wakes it,
    // reminder or not, and so do today's and overdue ones; four days on
    // does not. Each on a database of its own.
    for (due, remind, wakes) in [
        (3, false, true),
        (3, true, true),
        (0, true, true),
        (-2, false, true),
        (4, false, false),
        (4, true, false),
    ] {
        let (_pool, galley) = with_main_chat().await;
        let rec = Recorder::default();
        let review = ensure_review(&galley, &rec).await.expect("made");
        users_todo(&galley, "交季度报告", Some(day_from_today(due)), remind).await;
        let want = if wakes {
            ReviewFire::Woke
        } else {
            ReviewFire::Skipped
        };
        assert_eq!(
            fire_review_now(&galley, &rec, review.id.as_str()).await,
            want,
            "due in {due} days, reminder {remind}"
        );
    }
    // One due late on the third day, with a time.
    let (_pool, galley) = with_main_chat().await;
    let rec = Recorder::default();
    let review = ensure_review(&galley, &rec).await.expect("made");
    users_todo(
        &galley,
        "交季度报告",
        Some(format!("{}T23:59", day_from_today(3))),
        false,
    )
    .await;
    assert_eq!(
        fire_review_now(&galley, &rec, review.id.as_str()).await,
        ReviewFire::Woke
    );

    // Its own one-off reminder to come alone does not: it wakes the main
    // chat by itself at its time.
    let (_pool, galley) = with_main_chat().await;
    let rec = Recorder::default();
    let review = ensure_review(&galley, &rec).await.expect("made");
    reminder(&galley, "sched_water", "提醒用户喝水").await;
    assert_eq!(
        fire_review_now(&galley, &rec, review.id.as_str()).await,
        ReviewFire::Skipped
    );
}

#[tokio::test]
async fn a_review_that_cannot_read_the_list_wakes_the_main_chat() {
    let (pool, galley) = with_main_chat().await;
    let rec = Recorder::default();
    let review = ensure_review(&galley, &rec).await.expect("made");
    // The to-dos cannot be read: one turn too many beats a review that
    // never runs.
    sqlx::query("ALTER TABLE todos RENAME TO todos_gone")
        .execute(&pool)
        .await
        .expect("hide the to-dos");
    assert!(assistant_todo(&galley, &RunnerManager::new(), Utc::now())
        .await
        .is_err());
    assert_eq!(
        fire_review_now(&galley, &rec, review.id.as_str()).await,
        ReviewFire::Woke
    );
    assert_eq!(
        wake_state(&galley, review.id.as_str()).await,
        Some(ScheduledWake::Pending)
    );
    let log = review_log(&galley).await;
    assert_eq!(log.len(), 1);
    assert_eq!(log[0]["event"], "woke");
}

#[tokio::test]
async fn a_routine_that_fired_stays_out_of_done() {
    // Ticket 82 (main chat PRD ruling 129 point 3): a fire keeps no
    // promise; the routine stays in 例行, and only a one-off that went off
    // for its time is 已完成.
    let (pool, galley) = with_main_chat().await;
    let rec = Recorder::default();
    let nightly = galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                repeat: ScheduledTaskRepeat::Daily,
                time_of_day: "22:00".into(),
                fire_at: None,
                ..once_input("sched_nightly", "提醒用户关电脑", Utc::now())
            },
            assistant(),
        )
        .await
        .expect("routine");
    let now = Local::now();
    assert!(fire_reminder(&galley, &rec, &nightly, &now, &now).await);
    reminder(&galley, "sched_water", "提醒用户喝水").await;
    slept_through(&pool, "sched_water", ChronoDuration::minutes(5)).await;
    assert_eq!(tick(&galley, &rec).await, 1);
    let nightly = galley
        .scheduled_task("sched_nightly")
        .await
        .expect("routine");
    assert!(nightly.last_fired_at.is_some());

    let todo = assistant_todo(&galley, &RunnerManager::new(), Utc::now())
        .await
        .expect("todo");
    let ids: Vec<&str> = todo.done.iter().map(|item| item.id.as_str()).collect();
    assert_eq!(ids, ["sched_water"]);
    let row = todo
        .routine
        .iter()
        .find(|item| item.id == "sched_nightly")
        .expect("in routine");
    assert_eq!(row.at, nightly.next_fire_at);
    assert!(todo.assistant.is_empty());
}

#[tokio::test]
async fn a_review_that_cannot_be_delivered_is_dropped_without_a_notification() {
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    let review = ensure_review(&galley, rec.as_ref()).await.expect("made");
    users_todo(&galley, "回头查物流", None, false).await;
    // The main chat waits for the user's answer.
    runner.edit_gate(MAIN, |g| g.ask_pending = true);
    assert_eq!(
        fire_review_now(&galley, rec.as_ref(), review.id.as_str()).await,
        ReviewFire::Woke
    );
    restore_pending_reminders(&reports, &galley).await;
    let first = host(&galley, &runner, &env, rec.clone());
    assert!(take_due(&reports, &first, MAIN).await.is_none());
    assert!(runner.user_messages(MAIN).is_empty(), "not sent");
    // No notification with its words: they are for the model.
    assert!(rec.named(SCHEDULED_REMINDER_UNDELIVERED_EVENT).is_empty());
    // Consumed, not retried, now or after a restart.
    assert_eq!(wake_state(&galley, review.id.as_str()).await, None);
    runner.edit_gate(MAIN, |g| g.ask_pending = false);
    assert!(wake_if_due(&reports, &first, MAIN).await.is_none());
    assert!(restore_pending_reminders(&SubtaskReports::new(), &galley)
        .await
        .is_none());
    let log = review_log(&galley).await;
    let events: Vec<&str> = log.iter().map(|e| e["event"].as_str().unwrap()).collect();
    assert_eq!(events, ["woke", "dropped"]);
    assert_eq!(log[1]["reason"], "asking");

    // A runner that does not start: dropped the same way.
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    let review = ensure_review(&galley, rec.as_ref()).await.expect("made");
    users_todo(&galley, "回头查物流", None, false).await;
    runner.fail_spawn.store(true, Ordering::SeqCst);
    fire_review_now(&galley, rec.as_ref(), review.id.as_str()).await;
    restore_pending_reminders(&reports, &galley).await;
    let host = host(&galley, &runner, &env, rec.clone());
    assert!(matches!(
        wake_if_due(&reports, &host, MAIN).await,
        Some(WakeOutcome::Failed(_))
    ));
    assert!(rec.named(SCHEDULED_REMINDER_UNDELIVERED_EVENT).is_empty());
    assert_eq!(wake_state(&galley, review.id.as_str()).await, None);
    let log = review_log(&galley).await;
    assert_eq!(log[1]["event"], "dropped");
    assert_eq!(log[1]["reason"], "not_started");
}

#[tokio::test]
async fn a_review_whose_turn_ends_on_an_error_is_dropped_and_waits_under_the_external_runtime() {
    // The turn it woke ends on an error, before a reply.
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let reports = SubtaskReports::new();
    let review = ensure_review(&galley, rec.as_ref()).await.expect("made");
    users_todo(&galley, "回头查物流", None, false).await;
    fire_review_now(&galley, rec.as_ref(), review.id.as_str()).await;
    restore_pending_reminders(&reports, &galley).await;
    let h = host(&galley, &runner, &env, rec.clone());
    assert!(matches!(
        wake_if_due(&reports, &h, MAIN).await,
        Some(WakeOutcome::Delivered { .. })
    ));
    runner.run_ended(MAIN, "DONE_WITHOUT_EXIT", false);
    record_wake_run_end(&reports, &galley, &runner, rec.as_ref(), &complete(MAIN)).await;
    assert!(rec.named(SCHEDULED_REMINDER_UNDELIVERED_EVENT).is_empty());
    assert_eq!(wake_state(&galley, review.id.as_str()).await, None);
    let log = review_log(&galley).await;
    assert_eq!(log[1]["event"], "dropped");
    assert_eq!(log[1]["reason"], "no_reply");

    // Under the external runtime (no main chat to wake): a pending fire
    // waits, as a reminder's does, and nothing is said or notified.
    let (_pool, galley) = with_main_chat().await;
    let rec = Arc::new(Recorder::default());
    let review = ensure_review(&galley, rec.as_ref()).await.expect("made");
    users_todo(&galley, "回头查物流", None, false).await;
    fire_review_now(&galley, rec.as_ref(), review.id.as_str()).await;
    galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .expect("external");
    assert!(galley
        .ensure_assistant_available("scheduler")
        .await
        .is_err());
    let reports = SubtaskReports::new();
    assert!(restore_pending_reminders(&reports, &galley).await.is_none());
    assert!(reports.waiting(MAIN).is_empty());
    assert!(rec.named(SCHEDULED_REMINDER_UNDELIVERED_EVENT).is_empty());
    assert_eq!(
        wake_state(&galley, review.id.as_str()).await,
        Some(ScheduledWake::Pending)
    );
}

// ---------------- the morning review and new memos (ticket 95) ----------------

use chrono::TimeZone;
use galley_core_lib::api::{CreateMemoInput, MemoId};

/// `days` from today at `hour`:00, this machine's wall clock (the zone the
/// review reads its days in).
fn local_at(days: i64, hour: u32) -> DateTime<Local> {
    let day = Local::now().date_naive() + ChronoDuration::days(days);
    Local
        .from_local_datetime(&day.and_hms_opt(hour, 0, 0).unwrap())
        .earliest()
        .expect("a wall-clock time")
}

/// The review came due before, at `at` (`None`: it never did).
async fn last_review(pool: &SqlitePool, id: &str, at: Option<DateTime<Local>>) {
    let at = at.map(|at| instant_to_utc_iso(&at));
    sqlx::query("UPDATE scheduled_tasks SET last_fired_at = ?, last_due_at = ? WHERE id = ?")
        .bind(&at)
        .bind(&at)
        .bind(id)
        .execute(pool)
        .await
        .expect("last review");
}

/// A memo Galley noted in a turn the user started, as if that turn was at
/// `at`.
async fn memo_noted(
    galley: &SqliteGalley,
    pool: &SqlitePool,
    text: &str,
    at: DateTime<Local>,
) -> MemoId {
    let turn = user_says(galley, MAIN, text, Origin::desktop()).await;
    let memo = galley
        .create_memo(
            CreateMemoInput {
                text: text.into(),
                until: None,
            },
            assistant(),
            Some((SessionId(MAIN.into()), turn)),
        )
        .await
        .expect("memo")
        .memo;
    sqlx::query("UPDATE memos SET fresh_at = ? WHERE id = ?")
        .bind(instant_to_utc_iso(&at))
        .bind(memo.id.as_str())
        .execute(pool)
        .await
        .expect("when");
    memo.id
}

/// Deliver what is pending: the words the main chat got.
async fn delivered_words(galley: &SqliteGalley, runner: &Runner, rec: Arc<Recorder>) -> String {
    let reports = SubtaskReports::new();
    assert_eq!(
        restore_pending_reminders(&reports, galley).await.as_deref(),
        Some(MAIN)
    );
    let env = FakeEnv;
    let host = host(galley, runner, &env, rec);
    let before = runner.user_messages(MAIN).len();
    let Some(WakeOutcome::Delivered { .. }) = wake_if_due(&reports, &host, MAIN).await else {
        panic!("not delivered");
    };
    let sent = runner.user_messages(MAIN);
    assert_eq!(sent.len(), before + 1);
    sent.last().unwrap().clone()
}

const MEMOS_HEADER: &str =
    "Memos noted or changed since the last review, in turns the user started:";

#[tokio::test]
async fn the_review_wakes_for_the_memos_new_since_the_last_one_and_names_them() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let rec = Arc::new(Recorder::default());
    let review = ensure_review(&galley, rec.as_ref()).await.expect("made");
    // Nothing to do, so only the memos can wake it. The last review came
    // due yesterday at nine.
    last_review(&pool, review.id.as_str(), Some(local_at(-1, 9))).await;
    // In: yesterday before that review and after it.
    let early = memo_noted(&galley, &pool, "不吃香菜", local_at(-1, 8)).await;
    let late = memo_noted(&galley, &pool, "看他这周常问 76 人", local_at(-1, 20)).await;
    // Out: the day before yesterday (the last review's window), this
    // morning (tomorrow's), one past its day, one deleted, one Galley
    // wrote in a wake's turn (never fresh).
    let older = memo_noted(&galley, &pool, "住在思明区", local_at(-2, 20)).await;
    let today = memo_noted(&galley, &pool, "今天早上说的", local_at(0, 0)).await;
    let ended = memo_noted(&galley, &pool, "上周在上海出差", local_at(-1, 12)).await;
    sqlx::query("UPDATE memos SET until_date = ? WHERE id = ?")
        .bind(day_from_today(-1))
        .bind(ended.as_str())
        .execute(&pool)
        .await
        .unwrap();
    let deleted = memo_noted(&galley, &pool, "说错了的一条", local_at(-1, 13)).await;
    galley
        .delete_memo(&deleted, Origin::desktop(), None)
        .await
        .expect("deleted");
    let wake_row = galley
        .persist_subtask_report(
            &SessionId(MAIN.into()),
            "[Galley — not a message from the user] A reminder you set came due.".into(),
            Origin::subtask_report(&["sched_x".to_string()]),
            "[Galley: reminder sched_x came due]",
        )
        .await
        .unwrap();
    let woke = galley
        .create_memo(
            CreateMemoInput {
                text: "76 人进了次轮".into(),
                until: None,
            },
            assistant(),
            Some((
                SessionId(MAIN.into()),
                i64::from(wake_row.turn_index.unwrap()),
            )),
        )
        .await
        .unwrap()
        .memo
        .id;

    assert_eq!(
        fire_review_now(&galley, rec.as_ref(), review.id.as_str()).await,
        ReviewFire::Woke
    );
    let log = review_log(&galley).await;
    assert_eq!(log.last().unwrap()["event"], "woke");
    let words = delivered_words(&galley, &runner, rec.clone()).await;
    assert!(words
        .starts_with("[Galley — not a message from the user] It is time for the morning review."));
    let (said, memos) = words.split_once(MEMOS_HEADER).expect("the memos named");
    assert!(said.ends_with("your whole reply is exactly <no-reply/>.\n\n"));
    assert_eq!(
        memos,
        format!(
            "\n- `{early}`: 不吃香菜\n- `{late}`: 看他这周常问 76 人\nFor each, ask whether \
             there is something you could get done for the user that they would want to know, \
             as \"The morning review\" in `wake.md` says; most need nothing."
        )
    );
    for out in [&older, &today, &ended, &deleted, &woke] {
        assert!(!words.contains(out.as_str()), "{out}");
    }
}

#[tokio::test]
async fn the_reviews_window_reaches_back_to_the_last_review_and_no_further() {
    // (when the review last came due, when the memo was noted) → wakes.
    for (last, noted, wakes, case) in [
        (Some(-1), -1, true, "reviewed yesterday, noted yesterday"),
        (
            Some(-1),
            -2,
            false,
            "reviewed yesterday, noted the day before",
        ),
        (
            Some(-2),
            -2,
            true,
            "a day skipped: noted the day before yesterday",
        ),
        (Some(-2), -1, true, "a day skipped: noted yesterday"),
        (None, -1, true, "never reviewed, noted yesterday"),
        (
            None,
            -2,
            false,
            "never reviewed, noted the day before yesterday",
        ),
        (Some(0), -1, false, "it came due already today"),
    ] {
        let (pool, galley) = with_main_chat().await;
        let rec = Recorder::default();
        let review = ensure_review(&galley, &rec).await.expect("made");
        last_review(&pool, review.id.as_str(), last.map(|d| local_at(d, 0))).await;
        memo_noted(&galley, &pool, "不吃香菜", local_at(noted, 12)).await;
        let want = if wakes {
            ReviewFire::Woke
        } else {
            ReviewFire::Skipped
        };
        assert_eq!(
            fire_review_now(&galley, &rec, review.id.as_str()).await,
            want,
            "{case}"
        );
    }
    // Only one past its day, or only one deleted: nobody woken.
    for deleted in [false, true] {
        let (pool, galley) = with_main_chat().await;
        let rec = Recorder::default();
        let review = ensure_review(&galley, &rec).await.expect("made");
        last_review(&pool, review.id.as_str(), Some(local_at(-1, 9))).await;
        let id = memo_noted(&galley, &pool, "上周在上海出差", local_at(-1, 12)).await;
        if deleted {
            galley
                .delete_memo(&id, assistant(), None)
                .await
                .expect("deleted");
        } else {
            sqlx::query("UPDATE memos SET until_date = ? WHERE id = ?")
                .bind(day_from_today(-1))
                .bind(id.as_str())
                .execute(&pool)
                .await
                .unwrap();
        }
        assert_eq!(
            fire_review_now(&galley, &rec, review.id.as_str()).await,
            ReviewFire::Skipped,
            "deleted {deleted}"
        );
        let task = galley.scheduled_task(review.id.as_str()).await.unwrap();
        assert_eq!(task.last_wake, None);
        assert_eq!(
            review_log(&galley).await.last().unwrap()["event"],
            "skipped"
        );
    }
}

#[tokio::test]
async fn with_a_to_do_and_no_new_memo_the_reviews_words_are_as_before() {
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let rec = Arc::new(Recorder::default());
    let review = ensure_review(&galley, rec.as_ref()).await.expect("made");
    last_review(&pool, review.id.as_str(), Some(local_at(-1, 9))).await;
    users_todo(&galley, "回头查物流", None, false).await;
    memo_noted(&galley, &pool, "住在思明区", local_at(-3, 12)).await;
    assert_eq!(
        fire_review_now(&galley, rec.as_ref(), review.id.as_str()).await,
        ReviewFire::Woke
    );
    let words = delivered_words(&galley, &runner, rec).await;
    assert!(!words.contains("Memos noted"), "{words}");
    assert!(words.ends_with("your whole reply is exactly <no-reply/>."));
}

#[tokio::test]
async fn run_by_hand_the_review_names_its_own_window_and_again_today_none() {
    use galley_core_lib::socket_listener::{DbSource, HandlerCtx};
    let (pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let rec = Arc::new(Recorder::default());
    let review = ensure_review(&galley, rec.as_ref()).await.expect("made");
    last_review(&pool, review.id.as_str(), Some(local_at(-1, 9))).await;
    let memo = memo_noted(&galley, &pool, "想学吉他", local_at(-1, 21)).await;
    let db = DbSource::Pool(galley.clone());
    let run = || {
        let ctx = HandlerCtx {
            db: &db,
            runner: &runner,
            notifier: rec.clone(),
            app: None,
        };
        let id = review.id.as_str().to_string();
        async move {
            galley_core_lib::scheduler::run_now(&ctx, None, &id)
                .await
                .expect("run")
        }
    };
    let ran = run().await;
    assert_eq!(ran.last_wake, Some(ScheduledWake::Pending));
    let words = delivered_words(&galley, &runner, rec.clone()).await;
    assert!(
        words.contains(&format!("{MEMOS_HEADER}\n- `{memo}`: 想学吉他\n")),
        "{words}"
    );
    runner.run_ended(MAIN, "CURRENT_TASK_DONE", false);
    let reports = SubtaskReports::new();
    record_wake_run_end(&reports, &galley, &runner, rec.as_ref(), &complete(MAIN)).await;
    runner.settle(MAIN);
    // Again the same day: its window is empty.
    run().await;
    let words = delivered_words(&galley, &runner, rec.clone()).await;
    assert!(!words.contains("Memos noted"), "{words}");
    // And the scheduled one today, after it: nothing new, nothing to do.
    let rec = Recorder::default();
    assert_eq!(
        fire_review_now(&galley, &rec, review.id.as_str()).await,
        ReviewFire::Skipped
    );
}
