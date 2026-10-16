//! The `schedule.*` socket commands (main chat ticket 34), through the
//! production router (`dispatch_line_with`) with an in-memory database, a
//! recording notifier and a fake runner registry that only answers the run
//! gate: list (default and `all`), show, create (one-off and repeating, the
//! refusals with their stable message prefixes), update, enable, disable,
//! delete (a cancel), run; the origin every write records, and the main
//! chat run a task the assistant makes is tied to. The CLI over a real
//! socket is `cli/tests/schedule_test.rs`.

use async_trait::async_trait;
use chrono::{Duration as ChronoDuration, Local, TimeZone, Utc};
use galley_core_lib::api::schedule::instant_to_utc_iso;
use galley_core_lib::api::{GalleyApi, Origin, SessionId};
use galley_core_lib::db::{MainChatSeed, SqliteGalley};
use galley_core_lib::ipc::IpcCommand;
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    BroadcastItem, RunState, RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::socket_listener::{
    dispatch_line_with, DbSource, DispatchResult, HandlerCtx, RunnerPort, SocketResponse,
};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast;

const MAIN: &str = "s-main";

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
    fn count(&self, name: &str) -> usize {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|(n, _)| n == name)
            .count()
    }
}

/// A registry with no runners: spawning fails, nothing is alive; only the
/// run gate of the sessions in `open` reads as open.
#[derive(Default)]
struct Runner {
    open: Mutex<HashSet<String>>,
}

#[async_trait]
impl RunnerPort for Runner {
    async fn spawn(&self, _: SpawnArgs, _: Option<&str>) -> Result<u32, RunnerSpawnError> {
        Err(RunnerSpawnError::SpawnIo {
            detail: "no runners here".into(),
        })
    }
    async fn send_command(&self, sid: &str, _: &IpcCommand) -> Result<(), SendCommandError> {
        Err(SendCommandError::ProcessGone {
            session_id: sid.to_string(),
        })
    }
    async fn subscribe(&self, _: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        None
    }
    async fn pid(&self, _: &str) -> Option<u32> {
        None
    }
    async fn agent_running(&self, _: &str) -> bool {
        false
    }
    async fn shutdown(&self, _: &str, _: Option<Duration>) -> Result<(), ShutdownError> {
        Ok(())
    }
    async fn run_state(&self, sid: &str) -> RunState {
        RunState {
            open_run: self.open.lock().unwrap().contains(sid),
            ..RunState::default()
        }
    }
}

struct Harness {
    pool: SqlitePool,
    galley: SqliteGalley,
    db: DbSource,
    runner: Runner,
    rec: Arc<Recorder>,
}

impl Harness {
    /// The managed runtime with its main chat.
    async fn new() -> Self {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite");
        sqlx::raw_sql("PRAGMA foreign_keys = ON;")
            .execute(&pool)
            .await
            .expect("foreign keys");
        galley_core_lib::apply_all_migrations_for_tests(&pool)
            .await
            .expect("migrate");
        let galley = SqliteGalley::from_pool(pool.clone());
        galley
            .set_pref_json("active_runtime_kind", json!("managed"))
            .await
            .expect("managed");
        galley
            .get_or_create_main_chat(MAIN, Origin::desktop(), &MainChatSeed::default())
            .await
            .expect("main chat");
        Self {
            pool,
            db: DbSource::Pool(galley.clone()),
            galley,
            runner: Runner::default(),
            rec: Arc::new(Recorder::default()),
        }
    }

    async fn call(&self, command: &str, args: Value) -> SocketResponse {
        self.call_pinned(command, args, 3).await
    }

    async fn call_pinned(&self, command: &str, args: Value, schema: u32) -> SocketResponse {
        let ctx = HandlerCtx {
            db: &self.db,
            runner: &self.runner,
            notifier: self.rec.clone(),
            app: None,
        };
        let line = json!({"command": command, "args": args, "schemaVersion": schema}).to_string();
        match dispatch_line_with(&ctx, &line).await {
            DispatchResult::Unary(resp) => resp,
            DispatchResult::Stream { .. } => panic!("unary expected"),
        }
    }

    /// `ok` with its `task`.
    async fn task(&self, command: &str, args: Value) -> Value {
        let resp = self.call(command, args).await;
        assert!(resp.ok, "{command}: {:?} {:?}", resp.error, resp.message);
        resp.result.expect("result")["task"].clone()
    }
}

fn in_minutes(minutes: i64) -> String {
    instant_to_utc_iso(&(Utc::now() + ChronoDuration::minutes(minutes)))
}

fn error_of(resp: &SocketResponse) -> (String, String) {
    assert!(!resp.ok, "expected an error");
    (
        resp.error.clone().unwrap_or_default(),
        resp.message.clone().unwrap_or_default(),
    )
}

// ---------------- create ----------------

#[tokio::test]
async fn the_assistant_sets_a_reminder_in_its_running_turn() {
    let h = Harness::new().await;
    let run_turn = i64::from(
        h.galley
            .send_message(
                SessionId(MAIN.into()),
                "十分钟后提醒我喝水".into(),
                Origin::desktop(),
            )
            .await
            .unwrap()
            .turn_index
            .unwrap(),
    );
    h.runner.open.lock().unwrap().insert(MAIN.into());
    let at = in_minutes(10);
    let task = h
        .task(
            "schedule.create",
            json!({"prompt": "提醒用户喝水", "fireAt": at, "target": "assistant",
                   "supervisor": "galley-assistant", "reason": "user asked"}),
        )
        .await;
    assert!(task["id"].as_str().unwrap().starts_with("sched_"));
    assert_eq!(task["id"].as_str().unwrap().len(), "sched_".len() + 16);
    assert_eq!(task["repeat"], json!({"kind": "once"}));
    assert_eq!(task["fireAt"], json!(at));
    assert_eq!(task["nextFireAt"], json!(at));
    assert_eq!(task["target"], "assistant");
    assert_eq!(task["enabled"], true);
    assert_eq!(
        task["origin"],
        json!({"via": "supervisor", "supervisor": "galley-assistant", "reason": "user asked"})
    );
    // Tied to the run (its reply is filled when the run ends).
    assert_eq!(task["createdIn"], json!({"sessionId": MAIN}));
    let row: (Option<String>, Option<i64>) = sqlx::query_as(
        "SELECT created_in_session_id, created_in_run_turn FROM scheduled_tasks WHERE id = ?",
    )
    .bind(task["id"].as_str().unwrap())
    .fetch_one(&h.pool)
    .await
    .unwrap();
    assert_eq!(row, (Some(MAIN.into()), Some(run_turn)));
    assert_eq!(h.rec.count("scheduled-tasks:changed"), 1);
}

#[tokio::test]
async fn a_write_is_tied_to_a_run_only_when_the_assistant_writes_during_one() {
    let h = Harness::new().await;
    // The assistant's label, but no run open.
    let idle = h
        .task(
            "schedule.create",
            json!({"prompt": "a", "fireAt": in_minutes(5), "target": "assistant",
                   "supervisor": "galley-assistant"}),
        )
        .await;
    assert!(idle.get("createdIn").is_none());
    // A run open, but another agent writing.
    h.runner.open.lock().unwrap().insert(MAIN.into());
    let other = h
        .task(
            "schedule.create",
            json!({"prompt": "b", "fireAt": in_minutes(5), "supervisor": "ga-claude-1"}),
        )
        .await;
    assert!(other.get("createdIn").is_none());
    assert_eq!(other["target"], "session", "session by default");
    assert_eq!(
        other["origin"],
        json!({"via": "supervisor", "supervisor": "ga-claude-1"})
    );
    // No label at all: via cli.
    let cli = h
        .task(
            "schedule.create",
            json!({"prompt": "c", "repeat": {"kind": "daily"}, "timeOfDay": "09:00"}),
        )
        .await;
    assert_eq!(cli["origin"], json!({"via": "cli"}));
}

#[tokio::test]
async fn a_local_time_reads_in_this_machines_zone() {
    let h = Harness::new().await;
    // Noon two days on: never inside a daylight-saving gap.
    let local = (Local::now() + ChronoDuration::days(2))
        .format("%Y-%m-%dT12:00")
        .to_string();
    let task = h
        .task("schedule.create", json!({"prompt": "x", "fireAt": local}))
        .await;
    let naive = chrono::NaiveDateTime::parse_from_str(&local, "%Y-%m-%dT%H:%M").unwrap();
    let expected = instant_to_utc_iso(&Local.from_local_datetime(&naive).earliest().unwrap());
    assert_eq!(task["fireAt"], json!(expected));
    assert_eq!(task["timeOfDay"], json!(&local[11..16]));
}

#[tokio::test]
async fn repeating_rules_follow_the_forms_rules() {
    let h = Harness::new().await;
    let weekly = h
        .task(
            "schedule.create",
            json!({"prompt": "周报", "repeat": {"kind": "weekly", "weekdays": [5, 1, 5]},
                   "timeOfDay": "17:30", "projectId": null}),
        )
        .await;
    assert_eq!(
        weekly["repeat"],
        json!({"kind": "weekly", "weekdays": [1, 5]})
    );
    assert_eq!(weekly["timeOfDay"], "17:30");
    assert!(weekly.get("fireAt").is_none());
    for (args, why) in [
        (
            json!({"prompt": "x", "repeat": {"kind": "daily"}}),
            "needs a time of day",
        ),
        (
            json!({"prompt": "x", "repeat": {"kind": "daily"}, "timeOfDay": "9am"}),
            "HH:MM",
        ),
        (
            json!({"prompt": "x", "repeat": {"kind": "weekly", "weekdays": [8]}, "timeOfDay": "09:00"}),
            "1..=7",
        ),
        (
            json!({"prompt": "x", "repeat": {"kind": "daily"}, "timeOfDay": "09:00",
                   "fireAt": in_minutes(5)}),
            "not both",
        ),
        (json!({"prompt": "x"}), "give a one-off time"),
        (json!({"prompt": "  ", "fireAt": in_minutes(5)}), "prompt"),
        (json!({"prompt": "x", "fireAt": "tomorrow"}), "RFC 3339"),
    ] {
        let (tag, message) = error_of(&h.call("schedule.create", args.clone()).await);
        assert_eq!(tag, "invalid_args", "{args}");
        assert!(message.contains(why), "{args}: {message}");
    }
}

#[tokio::test]
async fn a_past_time_and_a_missing_assistant_have_stable_prefixes() {
    let h = Harness::new().await;
    let (tag, message) = error_of(
        &h.call(
            "schedule.create",
            json!({"prompt": "x", "fireAt": in_minutes(-1)}),
        )
        .await,
    );
    assert_eq!(tag, "invalid_args");
    assert!(message.starts_with("time_in_past: "), "{message}");
    // A model is for sessions.
    let (tag, _) = error_of(
        &h.call(
            "schedule.create",
            json!({"prompt": "x", "fireAt": in_minutes(5), "target": "assistant",
                   "llmName": "Model"}),
        )
        .await,
    );
    assert_eq!(tag, "invalid_args");
    // The external runtime has no assistant.
    h.galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .unwrap();
    let (tag, message) = error_of(
        &h.call(
            "schedule.create",
            json!({"prompt": "x", "fireAt": in_minutes(5), "target": "assistant"}),
        )
        .await,
    );
    assert_eq!(tag, "invalid_args");
    assert!(message.starts_with("assistant_unavailable: "), "{message}");
    // A session task is made as before.
    h.task(
        "schedule.create",
        json!({"prompt": "x", "fireAt": in_minutes(5), "target": "session"}),
    )
    .await;
}

// ---------------- read ----------------

#[tokio::test]
async fn list_shows_what_may_fire_and_all_shows_everything() {
    let h = Harness::new().await;
    let active = h
        .task(
            "schedule.create",
            json!({"prompt": "on", "fireAt": in_minutes(5)}),
        )
        .await;
    let paused = h
        .task(
            "schedule.create",
            json!({"prompt": "off", "fireAt": in_minutes(5)}),
        )
        .await;
    h.task("schedule.disable", json!({"taskId": paused["id"]}))
        .await;
    let fired = h
        .task(
            "schedule.create",
            json!({"prompt": "fired", "fireAt": in_minutes(5)}),
        )
        .await;
    sqlx::query("UPDATE scheduled_tasks SET fire_at = ?, last_fired_at = ? WHERE id = ?")
        .bind(in_minutes(-10))
        .bind(in_minutes(-9))
        .bind(fired["id"].as_str().unwrap())
        .execute(&h.pool)
        .await
        .unwrap();
    let cancelled = h
        .task(
            "schedule.create",
            json!({"prompt": "gone", "fireAt": in_minutes(5)}),
        )
        .await;
    h.task("schedule.delete", json!({"taskId": cancelled["id"]}))
        .await;

    let ids = |resp: SocketResponse| -> Vec<String> {
        resp.result.unwrap()["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["id"].as_str().unwrap().to_string())
            .collect()
    };
    assert_eq!(
        ids(h.call("schedule.list", json!({})).await),
        vec![active["id"].as_str().unwrap().to_string()]
    );
    let mut all = ids(h.call("schedule.list", json!({"all": true})).await);
    all.sort();
    let mut want: Vec<String> = [&active, &paused, &fired, &cancelled]
        .iter()
        .map(|t| t["id"].as_str().unwrap().to_string())
        .collect();
    want.sort();
    assert_eq!(all, want);

    // show reads a cancelled one too; an unknown id is not_found.
    let shown = h
        .task("schedule.show", json!({"taskId": cancelled["id"]}))
        .await;
    assert!(shown["cancelledAt"].is_string());
    assert!(shown.get("nextFireAt").is_none());
    let (tag, _) = error_of(
        &h.call("schedule.show", json!({"taskId": "sched_nope"}))
            .await,
    );
    assert_eq!(tag, "not_found");
}

// ---------------- change ----------------

#[tokio::test]
async fn update_changes_only_what_it_is_given() {
    let h = Harness::new().await;
    let task = h
        .task(
            "schedule.create",
            json!({"prompt": "早报", "repeat": {"kind": "daily"}, "timeOfDay": "09:00",
                   "llmName": "Model"}),
        )
        .await;
    let id = task["id"].clone();
    let renamed = h
        .task(
            "schedule.update",
            json!({"taskId": id, "prompt": "晨报", "supervisor": "galley-assistant"}),
        )
        .await;
    assert_eq!(renamed["prompt"], "晨报");
    assert_eq!(renamed["timeOfDay"], "09:00");
    assert_eq!(renamed["llmName"], "Model");
    assert_eq!(renamed["repeat"], json!({"kind": "daily"}));
    // An empty value clears.
    let cleared = h
        .task("schedule.update", json!({"taskId": id, "llmName": ""}))
        .await;
    assert!(cleared.get("llmName").is_none());
    // A fire time makes it a one-off; the target can change with it.
    let at = in_minutes(30);
    let once = h
        .task(
            "schedule.update",
            json!({"taskId": id, "fireAt": at, "target": "assistant"}),
        )
        .await;
    assert_eq!(once["repeat"], json!({"kind": "once"}));
    assert_eq!(once["fireAt"], json!(at));
    assert_eq!(once["target"], "assistant");
    // And a rule makes it repeating again (it needs its time back).
    let (tag, message) = error_of(
        &h.call(
            "schedule.update",
            json!({"taskId": id, "repeat": {"kind": "daily"}}),
        )
        .await,
    );
    assert_eq!(tag, "invalid_args");
    assert!(message.contains("time of day"), "{message}");
    let back = h
        .task(
            "schedule.update",
            json!({"taskId": id, "repeat": {"kind": "monthly", "monthdays": [1]},
                   "timeOfDay": "08:00"}),
        )
        .await;
    assert_eq!(back["repeat"], json!({"kind": "monthly", "monthdays": [1]}));
    assert!(back.get("fireAt").is_none());
    // A past time is refused here too.
    let (_, message) = error_of(
        &h.call(
            "schedule.update",
            json!({"taskId": id, "fireAt": in_minutes(-5)}),
        )
        .await,
    );
    assert!(message.starts_with("time_in_past: "), "{message}");
    let (tag, _) = error_of(
        &h.call(
            "schedule.update",
            json!({"taskId": "sched_nope", "prompt": "x"}),
        )
        .await,
    );
    assert_eq!(tag, "not_found");
}

#[tokio::test]
async fn enable_disable_and_delete() {
    let h = Harness::new().await;
    let task = h
        .task(
            "schedule.create",
            json!({"prompt": "x", "fireAt": in_minutes(5)}),
        )
        .await;
    let id = task["id"].clone();
    let off = h.task("schedule.disable", json!({"taskId": id})).await;
    assert_eq!(off["enabled"], false);
    assert!(off.get("nextFireAt").is_none());
    let on = h.task("schedule.enable", json!({"taskId": id})).await;
    assert_eq!(on["enabled"], true);
    let gone = h
        .task(
            "schedule.delete",
            json!({"taskId": id, "supervisor": "galley-assistant", "reason": "user said no"}),
        )
        .await;
    assert!(gone["cancelledAt"].is_string());
    // Cancelled is gone for every write.
    for command in [
        "schedule.delete",
        "schedule.enable",
        "schedule.disable",
        "schedule.run",
    ] {
        let (tag, message) = error_of(&h.call(command, json!({"taskId": id})).await);
        assert_eq!(tag, "not_found", "{command}");
        assert!(message.contains("cancelled"), "{command}: {message}");
    }
    let (tag, _) = error_of(
        &h.call("schedule.update", json!({"taskId": id, "prompt": "y"}))
            .await,
    );
    assert_eq!(tag, "not_found");
}

#[tokio::test]
async fn run_fires_through_the_scheduled_path() {
    let h = Harness::new().await;
    // A session task: its session cannot start here (no runners), so the
    // fire is recorded as failed — as the scheduler records it.
    let session = h
        .task(
            "schedule.create",
            json!({"prompt": "整理下载", "repeat": {"kind": "daily"}, "timeOfDay": "09:00"}),
        )
        .await;
    let ran = h
        .task("schedule.run", json!({"taskId": session["id"]}))
        .await;
    assert!(ran["lastFiredAt"].is_string());
    assert!(ran.get("lastRunSessionId").is_none());
    assert_eq!(h.rec.count("scheduled-tasks:fire-failed"), 1);
    // An assistant task: no session, a pending wake planned for now.
    let reminder = h
        .task(
            "schedule.create",
            json!({"prompt": "喝水", "fireAt": in_minutes(60), "target": "assistant"}),
        )
        .await;
    let ran = h
        .task("schedule.run", json!({"taskId": reminder["id"]}))
        .await;
    assert_eq!(ran["lastWake"], "pending");
    assert_eq!(ran["lastDueAt"], ran["lastFiredAt"]);
    // The planned fire an hour from now still happens.
    assert_eq!(ran["nextFireAt"], reminder["fireAt"]);
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(sessions, 1, "only the main chat");
    // Under the external runtime an assistant task cannot run.
    h.galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .unwrap();
    let (_, message) = error_of(
        &h.call("schedule.run", json!({"taskId": reminder["id"]}))
            .await,
    );
    assert!(message.starts_with("assistant_unavailable: "), "{message}");
}

#[tokio::test]
async fn every_pin_serves_the_new_commands() {
    let h = Harness::new().await;
    for schema in [1, 2, 3] {
        let resp = h.call_pinned("schedule.list", json!({}), schema).await;
        assert!(resp.ok, "schema {schema}");
    }
    let resp = h.call_pinned("schedule.list", json!({}), 4).await;
    assert_eq!(resp.error.as_deref(), Some("schema_mismatch"));
    let resp = h.call("schedule.nope", json!({})).await;
    assert_eq!(resp.error.as_deref(), Some("unknown_command"));
    let resp = h.call("schedule.show", json!({})).await;
    assert_eq!(resp.error.as_deref(), Some("invalid_args"));
    // The GalleyApi read the desktop uses still leaves cancelled tasks out.
    let task = h
        .task(
            "schedule.create",
            json!({"prompt": "x", "fireAt": in_minutes(5)}),
        )
        .await;
    h.task("schedule.delete", json!({"taskId": task["id"]}))
        .await;
    assert!(h.galley.list_scheduled_tasks().await.unwrap().is_empty());
}
