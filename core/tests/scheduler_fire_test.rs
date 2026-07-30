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

const MIG_001: &str = include_str!("../migrations/001_init.sql");
const MIG_002: &str = include_str!("../migrations/002_add_has_unread.sql");
const MIG_003: &str = include_str!("../migrations/003_add_message_summary.sql");
const MIG_004: &str = include_str!("../migrations/004_add_messages_fts.sql");
const MIG_005: &str = include_str!("../migrations/005_add_message_preamble.sql");
const MIG_006: &str = include_str!("../migrations/006_messages_origin.sql");
const MIG_007: &str = include_str!("../migrations/007_sessions_origin.sql");
const MIG_008: &str = include_str!("../migrations/008_runtime_identity.sql");
const MIG_009: &str = include_str!("../migrations/009_managed_models.sql");
const MIG_010: &str = include_str!("../migrations/010_managed_model_providers.sql");
const MIG_011: &str = include_str!("../migrations/011_managed_model_sort_order.sql");
const MIG_012: &str = include_str!("../migrations/012_managed_model_local_secrets.sql");
const MIG_013: &str = include_str!("../migrations/013_session_llm_key.sql");
const MIG_014: &str = include_str!("../migrations/014_managed_model_auth_kind.sql");
const MIG_015: &str = include_str!("../migrations/015_goal_v1.sql");
const MIG_016: &str = include_str!("../migrations/016_goal_master_session.sql");
const MIG_017: &str = include_str!("../migrations/017_message_visibility.sql");
const MIG_018: &str = include_str!("../migrations/018_goal_deliverable.sql");
const MIG_019: &str = include_str!("../migrations/019_goal_workspace.sql");
const MIG_020: &str = include_str!("../migrations/020_message_attachments.sql");
const MIG_021: &str = include_str!("../migrations/021_native_session_runtime.sql");
const MIG_022: &str = include_str!("../migrations/022_native_memory_substrate.sql");
const MIG_023: &str = include_str!("../migrations/023_native_goal_runtime.sql");
const MIG_024: &str = include_str!("../migrations/024_native_default_runtime.sql");
const MIG_025: &str = include_str!("../migrations/025_restore_managed_runtime_default.sql");
const MIG_026: &str = include_str!("../migrations/026_project_workspace.sql");
const MIG_027: &str = include_str!("../migrations/027_managed_model_context_win.sql");
const MIG_028: &str = include_str!("../migrations/028_message_telemetry.sql");
const MIG_029: &str = include_str!("../migrations/029_managed_model_custom_context_win.sql");
const MIG_030: &str = include_str!("../migrations/030_single_active_goal.sql");
const MIG_031: &str = include_str!("../migrations/031_message_goal_id.sql");
const MIG_032: &str = include_str!("../migrations/032_goal_mode.sql");
const MIG_033: &str = include_str!("../migrations/033_goal_optional_project.sql");
const MIG_034: &str = include_str!("../migrations/034_session_approval_mode.sql");
const MIG_035: &str = include_str!("../migrations/035_scheduled_tasks.sql");
const MIG_036: &str = include_str!("../migrations/036_scheduled_tasks_monthly.sql");
const MIG_037: &str = include_str!("../migrations/037_scheduled_tasks_llm.sql");

async fn fresh_galley() -> SqliteGalley {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite");
    sqlx::raw_sql("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await
        .expect("enable foreign keys");
    for sql in [
        MIG_001, MIG_002, MIG_003, MIG_004, MIG_005, MIG_006, MIG_007, MIG_008, MIG_009, MIG_010,
        MIG_011, MIG_012, MIG_013, MIG_014, MIG_015, MIG_016, MIG_017, MIG_018, MIG_019, MIG_020,
        MIG_021, MIG_022, MIG_023, MIG_024, MIG_025, MIG_026, MIG_027, MIG_028, MIG_029, MIG_030,
        MIG_031, MIG_032, MIG_033, MIG_034, MIG_035, MIG_036, MIG_037,
    ] {
        sqlx::raw_sql(sql).execute(&pool).await.expect("migration");
    }
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
            },
            Origin {
                via: OriginVia::Gui,
                supervisor: None,
                reason: None,
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
