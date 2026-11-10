//! Integration tests for the scheduler's fire path, driven through the
//! same `HandlerCtx` seam the socket write handlers are tested with:
//! in-memory DB (`DbSource::Pool`), a fake `RunnerPort`, and a recording
//! `Notifier`. What `due_fire` decides is unit-tested in
//! `core/src/scheduler.rs`; this file pins what `fire` *does* — session
//! creation through the production `session.new` dispatch, and the
//! failure-consumes-period contract that keeps a broken runner from
//! being retried every minute.
//!
//! Shared setup (`fresh_galley` + migrations, fakes) is intentionally
//! duplicated from `socket_write_handlers_test.rs` — cargo compiles each
//! `tests/*.rs` as its own crate root, and a `tests/common/` scaffold
//! isn't worth it yet.

use async_trait::async_trait;
use chrono::Utc;
use galley_core_lib::api::schedule::{
    CreateScheduledTaskInput, ScheduledTaskBrief, ScheduledTaskRepeat,
};
use galley_core_lib::api::{GalleyApi, Origin, OriginVia};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::ipc::IpcCommand;
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    BroadcastItem, RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::scheduler::fire;
use galley_core_lib::socket_listener::{DbSource, HandlerCtx, RunnerPort};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::Mutex;
use tokio::sync::broadcast;

async fn fresh_galley() -> SqliteGalley {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    galley_core_lib::apply_all_migrations_for_tests(&pool)
        .await
        .expect("migrations");
    SqliteGalley::from_pool(pool)
}

#[derive(Default)]
struct RecordingNotifier {
    events: Mutex<Vec<(String, Value)>>,
}

impl Notifier for RecordingNotifier {
    fn emit(&self, event: &str, payload: Value) {
        self.events
            .lock()
            .unwrap()
            .push((event.to_string(), payload));
    }
}

impl RecordingNotifier {
    fn names(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .map(|(n, _)| n.clone())
            .collect()
    }
}

/// Fake runner: spawn succeeds or fails per flag; dispatch always lands.
struct FakeRunner {
    spawn_ok: bool,
    sent_commands: Mutex<Vec<String>>,
}

impl FakeRunner {
    fn new(spawn_ok: bool) -> Self {
        Self {
            spawn_ok,
            sent_commands: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait]
impl RunnerPort for FakeRunner {
    async fn spawn(
        &self,
        _args: SpawnArgs,
        _active_session_id: Option<&str>,
    ) -> Result<u32, RunnerSpawnError> {
        if self.spawn_ok {
            Ok(4242)
        } else {
            Err(RunnerSpawnError::SpawnIo {
                detail: "fork failed".into(),
            })
        }
    }
    async fn send_command(
        &self,
        session_id: &str,
        _cmd: &IpcCommand,
    ) -> Result<(), SendCommandError> {
        self.sent_commands.lock().unwrap().push(session_id.into());
        Ok(())
    }
    async fn subscribe(&self, _session_id: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        let (tx, rx) = broadcast::channel(8);
        drop(tx);
        Some(rx)
    }
    async fn pid(&self, _session_id: &str) -> Option<u32> {
        Some(4242)
    }
    async fn agent_running(&self, _session_id: &str) -> bool {
        true
    }
    async fn shutdown(
        &self,
        _session_id: &str,
        _grace: Option<std::time::Duration>,
    ) -> Result<(), ShutdownError> {
        Ok(())
    }
}

/// External runtime + a real temp dir for gaPath/bridgeCwd, so spawn-args
/// preparation needs no AppHandle (`ctx.app: None`), same as the socket
/// handler tests.
async fn seed_external_runtime(galley: &SqliteGalley, dir: &std::path::Path) {
    galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .expect("seed runtime kind");
    galley
        .set_pref_json(
            "ga_config",
            json!({
                "gaPath": dir.to_str().unwrap(),
                "bridgeCwd": dir.to_str().unwrap(),
                "python": "python3",
            }),
        )
        .await
        .expect("seed ga_config");
}

async fn seed_task(galley: &SqliteGalley) -> ScheduledTaskBrief {
    galley
        .create_scheduled_task(
            CreateScheduledTaskInput {
                id: "sched_fire_test".into(),
                project_id: None,
                prompt: "daily digest".into(),
                repeat: ScheduledTaskRepeat::Daily,
                time_of_day: "09:00".into(),
                llm_name: None,
                enabled: true,
                fire_at: None,
                target: Default::default(),
            },
            Origin {
                via: OriginVia::Gui,
                supervisor: None,
                reason: None,
                client: None,
            },
        )
        .await
        .expect("seed scheduled task")
}

async fn refetch(galley: &SqliteGalley) -> ScheduledTaskBrief {
    galley
        .list_scheduled_tasks()
        .await
        .expect("list")
        .into_iter()
        .find(|t| t.id.as_str() == "sched_fire_test")
        .expect("task present")
}

#[tokio::test]
async fn fire_creates_session_and_stamps_period() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_external_runtime(&galley, dir.path()).await;
    let task = seed_task(&galley).await;

    let db = DbSource::Pool(galley.clone());
    let runner = FakeRunner::new(true);
    let notifier = std::sync::Arc::new(RecordingNotifier::default());
    let ctx = HandlerCtx {
        db: &db,
        runner: &runner,
        notifier: notifier.clone(),
        app: None,
    };
    let now = Utc::now();

    fire(&ctx, &task, &now).await;

    let after = refetch(&galley).await;
    let fired_at = after.last_fired_at.expect("period consumed");
    // The stamp is written in the same `+00:00` UTC shape as every other
    // timestamp column (formatters unified 2026-07-27).
    assert!(fired_at.ends_with("+00:00"), "{fired_at}");
    let session_id = after.last_run_session_id.expect("session recorded");

    // The session went through the production session.new dispatch: its
    // first message reached the (fake) bridge and the GUI got the full
    // event choreography plus the scheduled-tasks change signal.
    assert_eq!(*runner.sent_commands.lock().unwrap(), vec![session_id.as_str().to_string()]);
    // The fake subscribe stream closes instantly, so the detached emit
    // task interleaves a `runner-closed` at a nondeterministic point —
    // drop it before asserting the choreography this test owns.
    let names: Vec<String> = notifier
        .names()
        .into_iter()
        .filter(|n| n != "runner-closed")
        .collect();
    assert_eq!(
        names,
        vec![
            "session-created-external",
            "runner-spawned-external",
            "user-message-persisted",
            "scheduled-tasks:changed",
        ]
    );
}

#[tokio::test]
async fn failed_fire_still_consumes_period_without_session() {
    let dir = tempfile::tempdir().unwrap();
    let galley = fresh_galley().await;
    seed_external_runtime(&galley, dir.path()).await;
    let task = seed_task(&galley).await;

    let db = DbSource::Pool(galley.clone());
    let runner = FakeRunner::new(false);
    let notifier = std::sync::Arc::new(RecordingNotifier::default());
    let ctx = HandlerCtx {
        db: &db,
        runner: &runner,
        notifier: notifier.clone(),
        app: None,
    };

    fire(&ctx, &task, &Utc::now()).await;

    // Failure consumes the period: `last_fired_at` stamped with no
    // session, which the GUI renders as a failed run — and `due_fire`'s
    // consumed-period rule stops the loop from retrying every minute.
    let after = refetch(&galley).await;
    assert!(after.last_fired_at.is_some());
    assert!(after.last_run_session_id.is_none());
    // The change event still fires so an open dialog shows the failure.
    assert!(notifier
        .names()
        .contains(&"scheduled-tasks:changed".to_string()));
    // And the failure event carries what the GUI notification needs.
    // (The success path's exact-choreography assertion above pins that
    // this event does NOT fire on success.)
    let events = notifier.events.lock().unwrap();
    let (_, payload) = events
        .iter()
        .find(|(n, _)| n == "scheduled-tasks:fire-failed")
        .expect("fire-failed event emitted");
    assert_eq!(payload["taskId"], "sched_fire_test");
    assert_eq!(payload["prompt"], "daily digest");
}
