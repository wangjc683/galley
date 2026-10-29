//! The `todo.*` socket commands (main chat ticket 40), through the
//! production router (`dispatch_line_with`) with an in-memory database, a
//! recording notifier and a fake runner registry that only answers the run
//! gate: list (default and `all`, in its order), show, add (a due date's
//! two forms, a reminder, the refusals with their stable message
//! prefixes), update (only what is given; an empty value clears), done,
//! reopen, cancel; the origin a write records, the main chat run a to-do
//! Galley notes is tied to, the events, and the pins that serve the
//! family. Since main chat ticket 111 the items under a to-do too: `add`'s
//! `items`, `todo.item_add / item_done / item_reopen / item_update /
//! item_remove`, `show`'s items and `list`'s count; since ticket 112
//! `todo.item_move`. The CLI over a real socket is `cli/tests/todo_test.rs`; the
//! record itself is `todo_test.rs`.

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
    events: Mutex<Vec<String>>,
}

impl Notifier for Recorder {
    fn emit(&self, event: &str, _payload: Value) {
        self.events.lock().unwrap().push(event.to_string());
    }
}

impl Recorder {
    fn count(&self, name: &str) -> usize {
        self.events
            .lock()
            .unwrap()
            .iter()
            .filter(|n| *n == name)
            .count()
    }
}

/// A registry with no runners; only the run gate of the sessions in
/// `open` reads as open.
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
    /// The managed runtime, with its main chat when `main_chat`.
    async fn with(main_chat: bool) -> Self {
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
        if main_chat {
            galley
                .get_or_create_main_chat(MAIN, Origin::desktop(), &MainChatSeed::default())
                .await
                .expect("main chat");
        }
        Self {
            pool,
            db: DbSource::Pool(galley.clone()),
            galley,
            runner: Runner::default(),
            rec: Arc::new(Recorder::default()),
        }
    }

    async fn new() -> Self {
        Self::with(true).await
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

    /// `ok` with its `todo`.
    async fn todo(&self, command: &str, args: Value) -> Value {
        let resp = self.call(command, args).await;
        assert!(resp.ok, "{command}: {:?} {:?}", resp.error, resp.message);
        resp.result.expect("result")["todo"].clone()
    }

    async fn add(&self, title: &str) -> Value {
        self.todo("todo.add", json!({"title": title})).await
    }

    /// The ids `todo.list` answers, in its order.
    async fn listed(&self, all: bool) -> Vec<String> {
        let resp = self.call("todo.list", json!({"all": all})).await;
        assert!(resp.ok, "{:?}", resp.message);
        resp.result.unwrap()["todos"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["id"].as_str().unwrap().to_string())
            .collect()
    }

    /// A scheduled task as `schedule.show` answers it.
    async fn task(&self, id: &Value) -> Value {
        let resp = self.call("schedule.show", json!({"taskId": id})).await;
        assert!(resp.ok, "{:?}", resp.message);
        resp.result.unwrap()["task"].clone()
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

/// A local date `days` from today, `YYYY-MM-DD`.
fn local_day(days: i64) -> String {
    (Local::now() + ChronoDuration::days(days))
        .format("%Y-%m-%d")
        .to_string()
}

// ---------------- add ----------------

#[tokio::test]
async fn galley_notes_a_todo_in_its_running_turn() {
    let h = Harness::new().await;
    let run_turn = i64::from(
        h.galley
            .send_message(
                SessionId(MAIN.into()),
                "周五前要交季度报告，周四提醒我".into(),
                Origin::desktop(),
            )
            .await
            .unwrap()
            .turn_index
            .unwrap(),
    );
    h.runner.open.lock().unwrap().insert(MAIN.into());
    let friday = local_day(3);
    let remind = in_minutes(60);
    let todo = h
        .todo(
            "todo.add",
            json!({"title": " 交季度报告 ", "notes": "带合同", "due": friday,
                   "remindAt": remind, "supervisor": "galley-assistant",
                   "reason": "user mentioned it"}),
        )
        .await;
    let id = todo["id"].as_str().unwrap();
    assert!(id.starts_with("todo_"));
    assert_eq!(id.len(), "todo_".len() + 16);
    assert_eq!(todo["title"], "交季度报告");
    assert_eq!(todo["notes"], "带合同");
    assert_eq!(todo["due"], json!({"date": friday, "hasTime": false}));
    assert_eq!(todo["status"], "open");
    assert_eq!(
        todo["origin"],
        json!({"via": "supervisor", "supervisor": "galley-assistant",
               "reason": "user mentioned it"})
    );
    // Tied to the run (its reply is filled when the run ends).
    assert_eq!(todo["createdIn"], json!({"sessionId": MAIN}));
    let row: (Option<String>, Option<i64>) =
        sqlx::query_as("SELECT created_in_session_id, created_in_run_turn FROM todos WHERE id = ?")
            .bind(id)
            .fetch_one(&h.pool)
            .await
            .unwrap();
    assert_eq!(row, (Some(MAIN.into()), Some(run_turn)));
    // The reminder: a one-off that wakes the assistant, on this to-do.
    let reminder = &todo["reminder"];
    assert_eq!(reminder["at"], json!(remind));
    assert_eq!(reminder["state"], "scheduled");
    let task = h.task(&reminder["taskId"]).await;
    assert_eq!(task["todoId"], json!(id));
    assert_eq!(task["target"], "assistant");
    assert_eq!(task["prompt"], "交季度报告");
    assert!(
        task.get("createdIn").is_none(),
        "the to-do's card stands for it"
    );
    assert_eq!(h.rec.count("todos:changed"), 1);
    assert_eq!(h.rec.count("scheduled-tasks:changed"), 1);
}

#[tokio::test]
async fn a_todo_is_tied_to_a_run_only_when_galley_writes_during_one() {
    let h = Harness::new().await;
    let idle = h
        .todo(
            "todo.add",
            json!({"title": "a", "supervisor": "galley-assistant"}),
        )
        .await;
    assert!(idle.get("createdIn").is_none());
    h.runner.open.lock().unwrap().insert(MAIN.into());
    let other = h
        .todo(
            "todo.add",
            json!({"title": "b", "supervisor": "ga-claude-1"}),
        )
        .await;
    assert!(other.get("createdIn").is_none());
    assert_eq!(
        other["origin"],
        json!({"via": "supervisor", "supervisor": "ga-claude-1"})
    );
    let cli = h.add("c").await;
    assert_eq!(cli["origin"], json!({"via": "cli"}));
    assert!(cli.get("due").is_none() && cli.get("reminder").is_none());
    // No reminder, no scheduled-task event.
    assert_eq!(h.rec.count("todos:changed"), 3);
    assert_eq!(h.rec.count("scheduled-tasks:changed"), 0);
}

#[tokio::test]
async fn a_due_date_is_a_local_day_or_a_time() {
    let h = Harness::new().await;
    // A day: kept as the day, in every zone.
    let day = h
        .todo("todo.add", json!({"title": "x", "due": "2026-10-23"}))
        .await;
    assert_eq!(day["due"], json!({"date": "2026-10-23", "hasTime": false}));
    // A local time two days on (noon: never inside a daylight-saving gap)
    // reads in this machine's zone.
    let local = (Local::now() + ChronoDuration::days(2))
        .format("%Y-%m-%dT12:00")
        .to_string();
    let timed = h
        .todo("todo.add", json!({"title": "y", "due": local}))
        .await;
    let naive = chrono::NaiveDateTime::parse_from_str(&local, "%Y-%m-%dT%H:%M").unwrap();
    let instant = Local.from_local_datetime(&naive).earliest().unwrap();
    assert_eq!(
        timed["due"],
        json!({"date": &local[..10], "hasTime": true,
               "at": instant_to_utc_iso(&instant), "time": "12:00"})
    );
    // An instant with an offset; a past date is fine.
    let rfc = h
        .todo(
            "todo.add",
            json!({"title": "z", "due": "2020-01-01T09:00:00Z"}),
        )
        .await;
    assert_eq!(rfc["due"]["at"], "2020-01-01T09:00:00+00:00");
    assert_eq!(rfc["due"]["hasTime"], true);
    let (tag, message) = error_of(
        &h.call("todo.add", json!({"title": "w", "due": "Friday"}))
            .await,
    );
    assert_eq!(tag, "invalid_args");
    assert!(message.contains("YYYY-MM-DD"), "{message}");
}

#[tokio::test]
async fn refusals_carry_their_stable_prefixes() {
    let h = Harness::new().await;
    let (tag, message) = error_of(
        &h.call(
            "todo.add",
            json!({"title": "x", "remindAt": in_minutes(-1)}),
        )
        .await,
    );
    assert_eq!(tag, "invalid_args");
    assert!(message.starts_with("time_in_past: "), "{message}");
    // Nothing half made.
    assert!(h.listed(true).await.is_empty());
    let (tag, _) = error_of(&h.call("todo.add", json!({"title": "  "})).await);
    assert_eq!(tag, "invalid_args");
    let (tag, _) = error_of(&h.call("todo.add", json!({"notes": "no title"})).await);
    assert_eq!(tag, "invalid_args");

    // The external runtime: every write refused, the reads still answer.
    let kept = h.add("记下的事").await;
    let id = kept["id"].clone();
    h.galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .unwrap();
    for (command, args) in [
        ("todo.add", json!({"title": "x"})),
        ("todo.update", json!({"todoId": id, "title": "y"})),
        ("todo.done", json!({"todoId": id})),
        ("todo.reopen", json!({"todoId": id})),
        ("todo.cancel", json!({"todoId": id})),
    ] {
        let (tag, message) = error_of(&h.call(command, args).await);
        assert_eq!(tag, "invalid_args", "{command}");
        assert!(
            message.starts_with("assistant_unavailable: "),
            "{command}: {message}"
        );
    }
    assert_eq!(
        h.listed(false).await,
        vec![id.as_str().unwrap().to_string()]
    );
    assert_eq!(h.todo("todo.show", json!({"todoId": id})).await, kept);
}

#[tokio::test]
async fn without_a_main_chat_there_is_no_one_to_note_it() {
    let h = Harness::with(false).await;
    let (tag, message) = error_of(&h.call("todo.add", json!({"title": "x"})).await);
    assert_eq!(tag, "invalid_args");
    assert!(message.starts_with("assistant_unavailable: "), "{message}");
}

// ---------------- change ----------------

#[tokio::test]
async fn update_changes_only_what_it_is_given() {
    let h = Harness::new().await;
    let todo = h
        .todo(
            "todo.add",
            json!({"title": "回房东电话", "notes": "问维修", "due": "2026-10-23"}),
        )
        .await;
    let id = todo["id"].clone();
    // Nothing to change.
    let (tag, message) = error_of(&h.call("todo.update", json!({"todoId": id})).await);
    assert_eq!(tag, "invalid_args");
    assert!(message.contains("nothing to change"), "{message}");
    // A reminder set, then the title: the reminder's words follow.
    let at = in_minutes(30);
    let reminded = h
        .todo(
            "todo.update",
            json!({"todoId": id, "remindAt": at, "supervisor": "galley-assistant"}),
        )
        .await;
    assert_eq!(reminded["reminder"]["at"], json!(at));
    assert_eq!(reminded["notes"], "问维修");
    assert_eq!(reminded["due"]["date"], "2026-10-23");
    let task_id = reminded["reminder"]["taskId"].clone();
    let renamed = h
        .todo(
            "todo.update",
            json!({"todoId": id, "title": "给房东回电话"}),
        )
        .await;
    assert_eq!(renamed["title"], "给房东回电话");
    assert_eq!(h.task(&task_id).await["prompt"], "给房东回电话");
    // Moved: the same task.
    let later = in_minutes(90);
    let moved = h
        .todo("todo.update", json!({"todoId": id, "remindAt": later}))
        .await;
    assert_eq!(moved["reminder"]["taskId"], task_id);
    assert_eq!(moved["reminder"]["at"], json!(later));
    // An empty value clears: the notes, the due date, the reminder.
    let cleared = h
        .todo(
            "todo.update",
            json!({"todoId": id, "notes": "", "due": "", "remindAt": ""}),
        )
        .await;
    assert!(cleared.get("notes").is_none());
    assert!(cleared.get("due").is_none());
    assert!(cleared.get("reminder").is_none());
    assert!(h.task(&task_id).await["cancelledAt"].is_string());
    // Who made it stays.
    assert_eq!(cleared["origin"], json!({"via": "cli"}));
    // A past reminder; an unknown id.
    let (_, message) = error_of(
        &h.call(
            "todo.update",
            json!({"todoId": id, "remindAt": in_minutes(-5)}),
        )
        .await,
    );
    assert!(message.starts_with("time_in_past: "), "{message}");
    let (tag, _) = error_of(
        &h.call("todo.update", json!({"todoId": "todo_nope", "title": "x"}))
            .await,
    );
    assert_eq!(tag, "not_found");
}

#[tokio::test]
async fn done_cancels_the_reminder_and_reopen_does_not_bring_it_back() {
    let h = Harness::new().await;
    let todo = h
        .todo(
            "todo.add",
            json!({"title": "买营养土", "remindAt": in_minutes(45)}),
        )
        .await;
    let id = todo["id"].clone();
    let task_id = todo["reminder"]["taskId"].clone();
    let done = h
        .todo(
            "todo.done",
            json!({"todoId": id, "supervisor": "galley-assistant", "reason": "user said done"}),
        )
        .await;
    assert_eq!(done["status"], "done");
    assert!(done["doneAt"].is_string());
    assert_eq!(
        done["doneBy"],
        json!({"via": "supervisor", "supervisor": "galley-assistant",
               "reason": "user said done"})
    );
    assert!(done.get("reminder").is_none());
    assert!(h.task(&task_id).await["cancelledAt"].is_string());
    // Twice changes nothing; a done one takes no reminder.
    let again = h.todo("todo.done", json!({"todoId": id})).await;
    assert_eq!(again["doneAt"], done["doneAt"]);
    assert_eq!(again["doneBy"], done["doneBy"]);
    let (tag, message) = error_of(
        &h.call(
            "todo.update",
            json!({"todoId": id, "remindAt": in_minutes(30)}),
        )
        .await,
    );
    assert_eq!(tag, "invalid_args");
    assert!(message.contains("untick"), "{message}");
    assert!(h.listed(false).await.is_empty());
    // Reopened: open, no done stamps, the reminder still gone.
    let open = h.todo("todo.reopen", json!({"todoId": id})).await;
    assert_eq!(open["status"], "open");
    assert!(open.get("doneAt").is_none() && open.get("doneBy").is_none());
    assert!(open.get("reminder").is_none());
    assert_eq!(
        h.listed(false).await,
        vec![id.as_str().unwrap().to_string()]
    );
    let (tag, _) = error_of(&h.call("todo.done", json!({"todoId": "todo_nope"})).await);
    assert_eq!(tag, "not_found");
}

#[tokio::test]
async fn cancel_is_a_soft_delete() {
    let h = Harness::new().await;
    let todo = h
        .todo(
            "todo.add",
            json!({"title": "取快递", "remindAt": in_minutes(20)}),
        )
        .await;
    let id = todo["id"].clone();
    let gone = h
        .todo(
            "todo.cancel",
            json!({"todoId": id, "supervisor": "galley-assistant"}),
        )
        .await;
    assert_eq!(gone["status"], "cancelled");
    assert!(gone["cancelledAt"].is_string());
    assert!(gone.get("reminder").is_none());
    assert!(h.task(&todo["reminder"]["taskId"]).await["cancelledAt"].is_string());
    assert!(h.listed(false).await.is_empty());
    assert_eq!(h.listed(true).await, vec![id.as_str().unwrap().to_string()]);
    assert_eq!(h.todo("todo.show", json!({"todoId": id})).await, gone);
    // Gone for every write.
    for (command, args) in [
        ("todo.cancel", json!({"todoId": id})),
        ("todo.done", json!({"todoId": id})),
        ("todo.reopen", json!({"todoId": id})),
        ("todo.update", json!({"todoId": id, "title": "x"})),
    ] {
        let (tag, message) = error_of(&h.call(command, args).await);
        assert_eq!(tag, "not_found", "{command}");
        assert!(message.contains("cancelled"), "{command}: {message}");
    }
}

// ---------------- read ----------------

#[tokio::test]
async fn list_reads_in_the_order_of_yours_then_done_then_cancelled() {
    let h = Harness::new().await;
    let anytime = h.add("随时").await;
    let later = h
        .todo("todo.add", json!({"title": "以后", "due": local_day(5)}))
        .await;
    let overdue = h
        .todo("todo.add", json!({"title": "逾期", "due": local_day(-2)}))
        .await;
    let today = h
        .todo("todo.add", json!({"title": "今天", "due": local_day(0)}))
        .await;
    let done = h.add("做完").await;
    h.todo("todo.done", json!({"todoId": done["id"]})).await;
    let cancelled = h.add("取消").await;
    h.todo("todo.cancel", json!({"todoId": cancelled["id"]}))
        .await;
    let id = |t: &Value| t["id"].as_str().unwrap().to_string();
    assert_eq!(
        h.listed(false).await,
        vec![id(&overdue), id(&today), id(&later), id(&anytime)]
    );
    assert_eq!(
        h.listed(true).await,
        vec![
            id(&overdue),
            id(&today),
            id(&later),
            id(&anytime),
            id(&done),
            id(&cancelled)
        ]
    );
    let (tag, _) = error_of(&h.call("todo.show", json!({"todoId": "todo_nope"})).await);
    assert_eq!(tag, "not_found");
}

#[tokio::test]
async fn every_pin_serves_the_new_commands() {
    let h = Harness::new().await;
    for schema in [1, 2, 3] {
        let resp = h.call_pinned("todo.list", json!({}), schema).await;
        assert!(resp.ok, "schema {schema}");
        let resp = h
            .call_pinned("todo.add", json!({"title": "x"}), schema)
            .await;
        assert!(resp.ok, "schema {schema}");
        // The items' commands (ticket 111), as the family's.
        let todo = resp.result.unwrap()["todo"]["id"].clone();
        let resp = h
            .call_pinned(
                "todo.item_add",
                json!({"todoId": todo, "texts": ["y"]}),
                schema,
            )
            .await;
        assert!(resp.ok, "schema {schema}");
        let item = resp.result.unwrap()["todo"]["items"][0]["id"].clone();
        // Ticket 112's move, as the family's.
        let resp = h
            .call_pinned("todo.item_move", json!({"itemId": item, "to": 1}), schema)
            .await;
        assert!(resp.ok, "todo.item_move schema {schema}");
        for command in ["todo.item_done", "todo.item_reopen", "todo.item_remove"] {
            let resp = h
                .call_pinned(command, json!({"itemId": item}), schema)
                .await;
            assert!(resp.ok, "{command} schema {schema}");
        }
    }
    let resp = h.call_pinned("todo.list", json!({}), 4).await;
    assert_eq!(resp.error.as_deref(), Some("schema_mismatch"));
    let resp = h.call("todo.nope", json!({})).await;
    assert_eq!(resp.error.as_deref(), Some("unknown_command"));
    let resp = h.call("todo.show", json!({})).await;
    assert_eq!(resp.error.as_deref(), Some("invalid_args"));
}

// ---------------- items under a to-do (main chat ticket 111) ----------------

/// The items' words of a `Todo` as the wire carries them.
fn item_texts(todo: &Value) -> Vec<String> {
    todo["items"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|i| i["text"].as_str().unwrap().to_string())
                .collect()
        })
        .unwrap_or_default()
}

#[tokio::test]
async fn add_takes_items_and_show_lists_them_while_list_counts_them() {
    let h = Harness::new().await;
    let todo = h
        .todo(
            "todo.add",
            json!({"title": "下周三去上海出差", "due": local_day(5),
                   "items": ["订酒店", " 订机票 ", "换港币"],
                   "supervisor": "galley-assistant"}),
        )
        .await;
    assert_eq!(item_texts(&todo), ["订酒店", "订机票", "换港币"]);
    assert_eq!(todo["itemCount"], json!({"done": 0, "total": 3}));
    let item = &todo["items"][0];
    assert!(item["id"].as_str().unwrap().starts_with("item_"));
    assert_eq!(item["done"], false);
    assert!(item["createdAt"].is_string());
    let shown = h.todo("todo.show", json!({"todoId": todo["id"]})).await;
    assert_eq!(item_texts(&shown), ["订酒店", "订机票", "换港币"]);
    let resp = h.call("todo.list", json!({})).await;
    let listed = &resp.result.unwrap()["todos"][0];
    assert!(listed.get("items").is_none(), "{listed}");
    assert_eq!(listed["itemCount"], json!({"done": 0, "total": 3}));
    // An item with no words: invalid_args, nothing written.
    let resp = h
        .call("todo.add", json!({"title": "交报告", "items": ["写", ""]}))
        .await;
    let (tag, message) = error_of(&resp);
    assert_eq!(tag, "invalid_args");
    assert!(message.contains("an item needs words"), "{message}");
    assert_eq!(h.listed(false).await.len(), 1);
}

#[tokio::test]
async fn item_writes_answer_with_the_to_do_and_record_who_ticked() {
    let h = Harness::new().await;
    let todo = h.add("去上海出差").await;
    let rec_before = h.rec.count("todos:changed");
    let todo = h
        .todo(
            "todo.item_add",
            json!({"todoId": todo["id"], "texts": ["订酒店", "订机票"],
                   "supervisor": "galley-assistant"}),
        )
        .await;
    assert_eq!(item_texts(&todo), ["订酒店", "订机票"]);
    let hotel = todo["items"][0]["id"].clone();
    let ticked = h
        .todo(
            "todo.item_done",
            json!({"itemId": hotel, "supervisor": "galley-assistant",
                   "reason": "user said the hotel is booked"}),
        )
        .await;
    assert_eq!(ticked["items"][0]["done"], true);
    assert_eq!(
        ticked["items"][0]["doneBy"],
        json!({"via": "supervisor", "supervisor": "galley-assistant",
               "reason": "user said the hotel is booked"})
    );
    assert_eq!(ticked["itemCount"], json!({"done": 1, "total": 2}));
    // The to-do itself stays open.
    assert_eq!(ticked["status"], "open");
    let unticked = h.todo("todo.item_reopen", json!({"itemId": hotel})).await;
    assert_eq!(unticked["items"][0]["done"], false);
    assert!(unticked["items"][0].get("doneBy").is_none());
    let changed = h
        .todo(
            "todo.item_update",
            json!({"itemId": hotel, "text": "订虹桥的酒店"}),
        )
        .await;
    assert_eq!(item_texts(&changed), ["订虹桥的酒店", "订机票"]);
    // Ticket 112: moved to its place, past the last the last.
    let moved = h
        .todo(
            "todo.item_move",
            json!({"itemId": hotel, "to": 2, "supervisor": "galley-assistant",
                   "reason": "user asked"}),
        )
        .await;
    assert_eq!(item_texts(&moved), ["订机票", "订虹桥的酒店"]);
    let moved = h
        .todo("todo.item_move", json!({"itemId": hotel, "to": 1}))
        .await;
    assert_eq!(item_texts(&moved), ["订虹桥的酒店", "订机票"]);
    let moved = h
        .todo("todo.item_move", json!({"itemId": hotel, "to": 9}))
        .await;
    assert_eq!(item_texts(&moved), ["订机票", "订虹桥的酒店"]);
    assert_eq!(moved["itemCount"], json!({"done": 0, "total": 2}));
    let removed = h.todo("todo.item_remove", json!({"itemId": hotel})).await;
    assert_eq!(item_texts(&removed), ["订机票"]);
    // Eight writes, eight broadcasts; no reminder moved.
    assert_eq!(h.rec.count("todos:changed") - rec_before, 8);
    assert_eq!(h.rec.count("scheduled-tasks:changed"), 0);
}

#[tokio::test]
async fn item_refusals_are_the_familys() {
    let h = Harness::new().await;
    let todo = h
        .todo(
            "todo.add",
            json!({"title": "去上海出差", "items": ["订酒店"]}),
        )
        .await;
    let hotel = todo["items"][0]["id"].clone();
    // Unknown item: not_found; no words: invalid_args; a missing field:
    // invalid_args.
    let (tag, _) = error_of(
        &h.call("todo.item_done", json!({"itemId": "item_nope"}))
            .await,
    );
    assert_eq!(tag, "not_found");
    let (tag, _) = error_of(
        &h.call("todo.item_update", json!({"itemId": hotel, "text": "  "}))
            .await,
    );
    assert_eq!(tag, "invalid_args");
    let (tag, _) = error_of(&h.call("todo.item_add", json!({"todoId": todo["id"]})).await);
    assert_eq!(tag, "invalid_args");
    let (tag, _) = error_of(
        &h.call("todo.item_add", json!({"todoId": todo["id"], "texts": []}))
            .await,
    );
    assert_eq!(tag, "invalid_args");
    // Ticket 112: a move to a place below 1, or with none, is invalid_args;
    // an unknown item not_found.
    let (tag, message) = error_of(
        &h.call("todo.item_move", json!({"itemId": hotel, "to": 0}))
            .await,
    );
    assert_eq!(tag, "invalid_args");
    assert!(message.contains("a place counts from 1"), "{message}");
    let (tag, _) = error_of(&h.call("todo.item_move", json!({"itemId": hotel})).await);
    assert_eq!(tag, "invalid_args");
    let (tag, _) = error_of(
        &h.call("todo.item_move", json!({"itemId": "item_nope", "to": 1}))
            .await,
    );
    assert_eq!(tag, "not_found");
    // The to-do cancelled: every item write is not_found.
    h.todo("todo.cancel", json!({"todoId": todo["id"]})).await;
    let (tag, message) = error_of(&h.call("todo.item_done", json!({"itemId": hotel})).await);
    assert_eq!(tag, "not_found");
    assert!(message.contains("cancelled"), "{message}");
    // No main chat: assistant_unavailable.
    let bare = Harness::with(false).await;
    let (tag, message) = error_of(
        &bare
            .call("todo.item_add", json!({"todoId": "todo_x", "texts": ["y"]}))
            .await,
    );
    assert_eq!(tag, "invalid_args");
    assert!(message.starts_with("assistant_unavailable:"), "{message}");
}
