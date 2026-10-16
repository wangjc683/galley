//! Deleting one message of the main chat (`galley_core_lib::message_delete`,
//! main chat ticket 32, PRD ruling 83), against an in-memory database, a
//! runner registry that records what it is asked, and a temp directory for
//! the attachment files.
//!
//! - Only the main chat; refused, with nothing changed, while it runs or
//!   waits for an answer (live, or a latest reply ending on a question),
//!   for a reply with subtask cards, and when an attachment directory
//!   cannot be moved aside.
//! - Your message: that row, its attachment row and files, its search
//!   rows; nothing else. A reply: every row of its run, steps and
//!   question included, your rows kept; a subtask report's reply takes its
//!   hidden report row along. The greeting can go, and so can everything:
//!   the main chat carries on without a new greeting.
//! - Turn indices are never handed out again; `turn_count` never goes
//!   down; the summary no longer quotes a deleted reply.
//! - Search (the desktop's and the Agent API's) and the replay no longer
//!   see it; a live runner is retired and started again, none is started
//!   when none was live. Broadcast: `message-deleted`, then the row.
//!
//! The grouping rules alone are unit-tested in `core/src/message_delete.rs`;
//! the replay into a runner and the carried turns of a new segment in
//! `main_chat_segment_test.rs`.

use async_trait::async_trait;
use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, MessageVisibility, Origin, RuntimeKind, SearchScope, SessionId,
    SubtaskDispatch,
};
use galley_core_lib::db::{MainChatSeed, PersistAssistantMessage, SqliteGalley};
use galley_core_lib::ipc::IpcCommand;
use galley_core_lib::main_chat_reset::{RunnerStarter, StartRunner};
use galley_core_lib::message_delete::{
    delete_main_chat_message, DeleteMessageError, MessageDeletedPayload, MESSAGE_DELETED_EVENT,
};
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    BroadcastItem, RunState, RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::session_runner::{rows_to_conversation_messages, ReplayRow};
use galley_core_lib::socket_listener::RunnerPort;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
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
    galley
        .get_or_create_main_chat(
            MAIN,
            Origin::desktop(),
            &MainChatSeed {
                greeting: Some("你好，我是你的私人助理。".into()),
            },
        )
        .await
        .expect("main chat");
    (pool, galley)
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
    fn names(&self) -> Vec<String> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .map(|(name, _)| name.clone())
            .collect()
    }
    fn payload(&self, name: &str) -> Value {
        self.events
            .lock()
            .unwrap()
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, p)| p.clone())
            .unwrap_or_else(|| panic!("no {name}"))
    }
}

/// A registry with the run state and live runner it is given, recording
/// every runner it retires.
#[derive(Default)]
struct Runner {
    state: Mutex<RunState>,
    live: Mutex<HashMap<String, u32>>,
    retired: Mutex<Vec<(String, u32)>>,
}

impl Runner {
    fn with_state(state: RunState) -> Self {
        Self {
            state: Mutex::new(state),
            ..Self::default()
        }
    }
    fn live(sid: &str, pid: u32) -> Self {
        let runner = Self::default();
        runner.live.lock().unwrap().insert(sid.into(), pid);
        runner
    }
    fn retired(&self) -> Vec<(String, u32)> {
        self.retired.lock().unwrap().clone()
    }
}

#[async_trait]
impl RunnerPort for Runner {
    async fn spawn(&self, _: SpawnArgs, _: Option<&str>) -> Result<u32, RunnerSpawnError> {
        panic!("a deletion spawns through the starter")
    }
    async fn send_command(&self, _: &str, _: &IpcCommand) -> Result<(), SendCommandError> {
        panic!("a deletion sends no command")
    }
    async fn subscribe(&self, _: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        None
    }
    async fn pid(&self, sid: &str) -> Option<u32> {
        self.live.lock().unwrap().get(sid).copied()
    }
    async fn agent_running(&self, _: &str) -> bool {
        self.state.lock().unwrap().agent_running
    }
    async fn shutdown(&self, _: &str, _: Option<std::time::Duration>) -> Result<(), ShutdownError> {
        panic!("a deletion retires, it does not shut down")
    }
    async fn retire(&self, sid: &str, pid: u32) -> bool {
        self.retired.lock().unwrap().push((sid.into(), pid));
        self.live.lock().unwrap().remove(sid);
        true
    }
    async fn run_state(&self, _: &str) -> RunState {
        self.state.lock().unwrap().clone()
    }
}

/// Records each runner start asked for.
#[derive(Default)]
struct Starter {
    started: Mutex<Vec<String>>,
}

impl Starter {
    fn started(&self) -> Vec<String> {
        self.started.lock().unwrap().clone()
    }
}

impl RunnerStarter for Starter {
    fn start(&self, session_id: SessionId) -> StartRunner {
        self.started.lock().unwrap().push(session_id.0);
        Box::pin(async { Ok(()) })
    }
}

/// What every test drives: the database, a registry, a starter, a
/// recorder and an attachment root in a temp dir.
struct World {
    pool: SqlitePool,
    galley: SqliteGalley,
    runner: Runner,
    starter: Starter,
    events: Recorder,
    tmp: tempfile::TempDir,
}

impl World {
    async fn new() -> Self {
        Self::with_runner(Runner::default()).await
    }
    async fn with_runner(runner: Runner) -> Self {
        let (pool, galley) = fresh().await;
        Self {
            pool,
            galley,
            runner,
            starter: Starter::default(),
            events: Recorder::default(),
            tmp: tempfile::tempdir().expect("tempdir"),
        }
    }
    fn root(&self) -> PathBuf {
        self.tmp.path().join("conversation-attachments")
    }
    async fn delete(
        &self,
        sid: &str,
        message_id: &str,
    ) -> Result<MessageDeletedPayload, DeleteMessageError> {
        delete_main_chat_message(
            &self.galley,
            &self.runner,
            &self.starter,
            &self.events,
            &self.root(),
            &SessionId(sid.into()),
            message_id,
        )
        .await
    }

    /// A user row; its id and turn index.
    async fn say(&self, sid: &str, text: &str) -> (String, i64) {
        let row = self
            .galley
            .send_message(SessionId(sid.into()), text.into(), Origin::desktop())
            .await
            .expect("user row");
        (row.id.0, i64::from(row.turn_index.expect("turn index")))
    }

    /// One step of a reply at `turn`, written and counted the way Core's
    /// turn persistence does: an answer when `tool` is `None`.
    async fn step(&self, sid: &str, turn: i64, text: &str, tool: Option<&str>) -> String {
        // A question carries its text, as GA's `ask_user` does.
        let args = match tool {
            Some("ask_user") => json!({ "question": text }),
            _ => json!({}),
        };
        let calls = json!([{ "toolName": tool.unwrap_or("no_tool"), "args": args }]);
        self.galley
            .persist_assistant_message(PersistAssistantMessage {
                session_id: SessionId(sid.into()),
                turn_index: turn as u32,
                content: text.into(),
                tool_calls: Some(calls.to_string()),
                tool_results: Some(json!([{ "content": format!("{text} 的结果") }]).to_string()),
                thinking: None,
                final_answer: tool.is_none().then(|| text.to_string()),
                summary: Some(format!("{text} 的一句话")),
                preamble: None,
                visibility: MessageVisibility::Visible,
                telemetry: None,
            })
            .await
            .expect("assistant row");
        self.galley
            .bump_session_after_turn(
                SessionId(sid.into()),
                Some(format!("{text} 的一句话")),
                None,
                false,
            )
            .await
            .expect("bump");
        format!("msg_{sid}_{turn}_assistant")
    }

    /// A user message and a one-step answer; the two row ids.
    async fn exchange(&self, sid: &str, user: &str, reply: &str) -> (String, String) {
        let (user_id, turn) = self.say(sid, user).await;
        let reply_id = self.step(sid, turn, reply, None).await;
        (user_id, reply_id)
    }

    /// An image on `message_id`: its row, and its file where Core puts it.
    async fn attach(&self, sid: &str, message_id: &str) -> PathBuf {
        let file = self.root().join(sid).join(message_id).join("att_1.png");
        assert!(file.starts_with(self.tmp.path()));
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "png bytes").unwrap();
        sqlx::query(
            "INSERT INTO message_attachments \
             (id, message_id, session_id, kind, file_path, mime_type, byte_size, created_at) \
             VALUES (?, ?, ?, 'image', ?, 'image/png', 9, '2026-10-16T00:00:00Z')",
        )
        .bind(format!("att_{message_id}_1"))
        .bind(message_id)
        .bind(sid)
        .bind(file.to_string_lossy().into_owned())
        .execute(&self.pool)
        .await
        .expect("attachment row");
        file
    }

    /// The session's rows, `(id, role)`, in conversation order.
    async fn rows(&self, sid: &str) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT id FROM messages WHERE session_id = ? ORDER BY turn_index, sequence, id",
        )
        .bind(sid)
        .fetch_all(&self.pool)
        .await
        .expect("rows")
    }

    async fn count(&self, sql: &str, bind: &str) -> i64 {
        sqlx::query_scalar(sql)
            .bind(bind)
            .fetch_one(&self.pool)
            .await
            .expect(sql)
    }

    async fn turn_count(&self, sid: &str) -> i64 {
        self.count("SELECT turn_count FROM sessions WHERE id = ?", sid)
            .await
    }

    /// Hits for `text` in both searches: the desktop's (⌘K, find in the
    /// conversation) and the Agent API's (`sessions search`, the history
    /// lookup).
    async fn hits(&self, text: &str) -> (usize, usize) {
        let desktop = self
            .galley
            .search_message_hits(text.into(), 50, None, None)
            .await
            .expect("desktop search")
            .len();
        let api = self
            .galley
            .search_messages(text.into(), SearchScope::All, None, None)
            .await
            .expect("api search")
            .len();
        (desktop, api)
    }

    /// What a runner of the main chat would be given back now.
    async fn replay(&self) -> Vec<(String, String)> {
        let rows = self
            .galley
            .persisted_message_rows(&SessionId(MAIN.into()))
            .await
            .expect("rows");
        let completed = self.turn_count(MAIN).await;
        rows_to_conversation_messages(rows.into_iter().map(ReplayRow::from), completed)
            .into_iter()
            .map(|m| (m.role, m.content))
            .collect()
    }
}

fn greeting() -> String {
    format!("msg_{MAIN}_greeting")
}

fn ids(payload: &MessageDeletedPayload) -> Vec<&str> {
    payload.message_ids.iter().map(String::as_str).collect()
}

// ---------------- refusals ----------------

#[tokio::test]
async fn only_the_main_chat() {
    let w = World::new().await;
    w.galley
        .create_session(
            CreateSessionInput {
                id: "s-side".into(),
                title: "旁聊".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: Some(RuntimeKind::Managed),
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::desktop(),
        )
        .await
        .expect("side chat");
    let (user, _) = w.exchange("s-side", "旁聊里的话", "旁聊里的回答").await;

    let refused = w.delete("s-side", &user).await.unwrap_err();
    assert!(
        matches!(refused, DeleteMessageError::NotMainChat { .. }),
        "{refused:?}"
    );
    assert_eq!(w.rows("s-side").await.len(), 2);
    // A row of another session named under the main chat is not found.
    let refused = w.delete(MAIN, &user).await.unwrap_err();
    assert!(
        matches!(refused, DeleteMessageError::NotFound { .. }),
        "{refused:?}"
    );
    assert_eq!(w.rows("s-side").await.len(), 2);
    assert!(w.events.names().is_empty());
}

#[tokio::test]
async fn refused_while_it_runs_or_waits_for_an_answer() {
    for state in [
        RunState {
            open_run: true,
            ..RunState::default()
        },
        RunState {
            agent_running: true,
            ..RunState::default()
        },
        RunState {
            ask_pending: true,
            ..RunState::default()
        },
    ] {
        let w = World::with_runner(Runner::with_state(state.clone())).await;
        let (user, _) = w.exchange(MAIN, "第一句", "第一答").await;
        let refused = w.delete(MAIN, &user).await.unwrap_err();
        assert!(
            matches!(refused, DeleteMessageError::Busy { .. }),
            "{state:?}"
        );
        assert_eq!(w.rows(MAIN).await.len(), 3, "{state:?}");
        assert!(w.events.names().is_empty());
    }

    // The latest reply ends on a question nobody answered: after a
    // restart Core no longer remembers, the database does.
    let w = World::new().await;
    let (user, turn) = w.say(MAIN, "帮我订票").await;
    w.step(MAIN, turn, "哪天出发？", Some("ask_user")).await;
    let refused = w.delete(MAIN, &user).await.unwrap_err();
    assert!(
        matches!(refused, DeleteMessageError::Busy { .. }),
        "{refused:?}"
    );
    assert_eq!(w.rows(MAIN).await.len(), 3);
}

#[tokio::test]
async fn a_reply_with_subtask_cards_is_refused() {
    let w = World::new().await;
    let (user, turn) = w.say(MAIN, "查一下三家酒店").await;
    let step = w.step(MAIN, turn, "我派出去查", Some("web_scan")).await;
    let answer = w.step(MAIN, turn + 1, "派出去了", None).await;
    w.galley
        .record_subtask_dispatch(&SubtaskDispatch {
            parent_session_id: MAIN.into(),
            turn_index: turn + 1,
            ordinal: 0,
            message_id: SubtaskDispatch::reply_message_id(MAIN, turn + 1),
            session_id: None,
            title: "查酒店".into(),
            failure: None,
            failure_detail: None,
            created_at: "2026-10-16T00:00:00Z".into(),
            send_backs: 0,
        })
        .await
        .expect("dispatch record");

    for anchor in [&step, &answer] {
        let refused = w.delete(MAIN, anchor).await.unwrap_err();
        assert!(
            matches!(refused, DeleteMessageError::HasSubtasks { .. }),
            "{refused:?}"
        );
    }
    assert_eq!(
        w.rows(MAIN).await,
        vec![greeting(), user.clone(), step, answer]
    );
    // Your message above it can still go.
    w.delete(MAIN, &user).await.expect("your message");
}

// Unix only: the failure is made by a file where the directory would go,
// which `remove_dir_all` refuses there.
#[cfg(unix)]
#[tokio::test]
async fn files_that_cannot_be_moved_aside_refuse_the_deletion() {
    let w = World::new().await;
    let (user, _) = w.exchange(MAIN, "看这张图", "看到了").await;
    let file = w.attach(MAIN, &user).await;
    // Where the files would move to is taken by something that cannot be
    // cleared away (a file, not a directory).
    fs::write(w.root().join(MAIN).join(format!(".deleted-{user}")), "x").unwrap();

    let refused = w.delete(MAIN, &user).await.unwrap_err();
    assert!(
        matches!(refused, DeleteMessageError::Failed { .. }),
        "{refused:?}"
    );
    assert!(file.exists());
    assert_eq!(w.rows(MAIN).await.len(), 3);
    assert_eq!(
        w.count(
            "SELECT COUNT(*) FROM message_attachments WHERE session_id = ?",
            MAIN
        )
        .await,
        1
    );
    assert!(w.events.names().is_empty());
}

// ---------------- what goes ----------------

#[tokio::test]
async fn your_message_goes_with_its_files_and_search_rows_and_nothing_else() {
    let w = World::new().await;
    let (secret, secret_reply) = w.exchange(MAIN, "我的密钥是蓝鲸4721", "收到").await;
    let file = w.attach(MAIN, &secret).await;
    let (later, later_reply) = w.exchange(MAIN, "今天天气如何", "晴").await;
    assert_eq!(w.hits("蓝鲸4721").await, (1, 1));
    let turn_count = w.turn_count(MAIN).await;

    let deleted = w.delete(MAIN, &secret).await.expect("delete");
    assert_eq!(ids(&deleted), [secret.as_str()]);
    assert_eq!(
        w.rows(MAIN).await,
        vec![greeting(), secret_reply.clone(), later, later_reply]
    );
    // Its image: the row, the file and its directory, nothing left aside.
    assert_eq!(
        w.count(
            "SELECT COUNT(*) FROM message_attachments WHERE session_id = ?",
            MAIN
        )
        .await,
        0
    );
    assert!(!file.exists());
    let left: Vec<_> = fs::read_dir(w.root().join(MAIN)).unwrap().collect();
    assert!(left.is_empty(), "{left:?}");
    // Search and the replay.
    assert_eq!(w.hits("蓝鲸4721").await, (0, 0));
    assert_eq!(
        w.count(
            "SELECT COUNT(*) FROM messages_fts WHERE message_id = ?",
            &secret
        )
        .await,
        0
    );
    let replay = w.replay().await;
    assert!(
        replay.iter().all(|(_, text)| !text.contains("蓝鲸")),
        "{replay:?}"
    );
    assert_eq!(w.turn_count(MAIN).await, turn_count);

    // Broadcast: the rows, then the session.
    assert_eq!(
        w.events.names(),
        [MESSAGE_DELETED_EVENT, "session-updated-external"]
    );
    assert_eq!(
        w.events.payload(MESSAGE_DELETED_EVENT),
        json!({"sessionId": MAIN, "messageIds": [secret], "via": "gui"})
    );
    // No runner was live: none retired, none started.
    assert!(w.runner.retired().is_empty());
    assert!(w.starter.started().is_empty());
}

#[tokio::test]
async fn a_reply_goes_whole_its_process_and_question_included() {
    let w = World::new().await;
    let (user, turn) = w.say(MAIN, "帮我查一下航班").await;
    let s0 = w.step(MAIN, turn, "先打开航旅网站", Some("web_scan")).await;
    let q1 = w.step(MAIN, turn + 1, "哪天出发？", Some("ask_user")).await;
    let (answer, answer_turn) = w.say(MAIN, "周五").await;
    let s2 = w
        .step(MAIN, answer_turn, "查周五的航班", Some("web_scan"))
        .await;
    let final_answer = w
        .step(MAIN, answer_turn + 1, "周五有三班，最早七点", None)
        .await;
    assert_eq!(w.hits("周五有三班").await, (1, 1));
    let (after, after_reply) = w.exchange(MAIN, "谢谢", "不客气").await;

    // Any of its rows names it: here the question.
    let deleted = w.delete(MAIN, &q1).await.expect("delete");
    assert_eq!(
        ids(&deleted),
        [s0.as_str(), q1.as_str(), s2.as_str(), final_answer.as_str()]
    );
    assert_eq!(
        w.rows(MAIN).await,
        vec![greeting(), user, answer, after, after_reply]
    );
    // Tool results went with the rows; search no longer finds the answer.
    assert_eq!(w.hits("周五有三班").await, (0, 0));
}

#[tokio::test]
async fn a_report_rounds_reply_takes_its_hidden_report_row() {
    let w = World::new().await;
    w.exchange(MAIN, "派个活", "好").await;
    let report = w
        .galley
        .persist_subtask_report(
            &SessionId(MAIN.into()),
            "[Galley — not a message from the user] …".into(),
            Origin::subtask_report(&["s-sub".to_string()]),
            "[Galley: subtask s-sub \"查\" finished — details: session show s-sub]",
        )
        .await
        .expect("report row");
    let turn = i64::from(report.turn_index.expect("turn"));
    let reply = w.step(MAIN, turn, "查完了，结果在桌面", None).await;

    // The report row alone is no message.
    let refused = w.delete(MAIN, &report.id.0).await.unwrap_err();
    assert!(
        matches!(refused, DeleteMessageError::NotFound { .. }),
        "{refused:?}"
    );
    let deleted = w.delete(MAIN, &reply).await.expect("delete");
    assert_eq!(ids(&deleted), [report.id.0.as_str(), reply.as_str()]);
    assert_eq!(w.rows(MAIN).await.len(), 3);
}

#[tokio::test]
async fn the_greeting_and_then_everything_can_go() {
    let w = World::new().await;
    let (user, reply) = w.exchange(MAIN, "你好", "你好呀").await;
    for id in [greeting(), reply, user] {
        let deleted = w.delete(MAIN, &id).await.expect("delete");
        assert_eq!(ids(&deleted), [id.as_str()]);
    }
    assert!(w.rows(MAIN).await.is_empty());
    assert_eq!(w.replay().await, Vec::<(String, String)>::new());

    // It carries on: the next message is written, after every index used,
    // and no new greeting appears.
    let (next, turn) = w.say(MAIN, "还在吗").await;
    assert_eq!(turn, 1);
    let ensured = w
        .galley
        .get_or_create_main_chat(
            "s-other",
            Origin::desktop(),
            &MainChatSeed {
                greeting: Some("你好".into()),
            },
        )
        .await
        .expect("main chat");
    assert_eq!(ensured.brief().id.as_str(), MAIN);
    assert_eq!(w.rows(MAIN).await, vec![next]);
}

// ---------------- turn indices, the summary ----------------

#[tokio::test]
async fn turn_indices_are_never_handed_out_again() {
    let w = World::new().await;
    w.exchange(MAIN, "第一句", "第一答").await;
    let (user, turn) = w.say(MAIN, "第二句").await;
    w.step(MAIN, turn, "查一下", Some("web_scan")).await;
    let answer = w.step(MAIN, turn + 1, "第二答", None).await;
    let before = w.turn_count(MAIN).await;
    assert_eq!(before, turn + 2);

    // The latest reply goes: the highest indices leave a hole.
    w.delete(MAIN, &answer).await.expect("delete");
    assert_eq!(w.turn_count(MAIN).await, before);
    let facts = w
        .galley
        .main_chat_segment_facts(&SessionId(MAIN.into()))
        .await
        .expect("facts");
    assert_eq!(facts.next_turn_index, before);
    let (_, next) = w.say(MAIN, "第三句").await;
    assert_eq!(next, before, "the next message lands at turn_count");

    // A message that never got a reply holds an index turn_count does not
    // count; deleting it still does not hand that index out again.
    let (unanswered, unanswered_turn) = w.say(MAIN, "没人回的一句").await;
    w.delete(MAIN, &unanswered).await.expect("delete");
    assert!(w.turn_count(MAIN).await > unanswered_turn);
    let (_, after) = w.say(MAIN, "再一句").await;
    assert!(after > unanswered_turn, "{after} reuses {unanswered_turn}");
    // Your earlier message is still where it was.
    assert!(w.rows(MAIN).await.contains(&user));
}

#[tokio::test]
async fn the_summary_no_longer_quotes_a_deleted_reply() {
    let w = World::new().await;
    w.exchange(MAIN, "第一句", "第一答").await;
    let (_, last) = w.exchange(MAIN, "第二句", "第二答里的秘密").await;
    let summary = |w: &World| {
        let galley = w.galley.clone();
        async move {
            galley
                .session_brief(SessionId(MAIN.into()))
                .await
                .expect("brief")
                .summary
        }
    };
    assert_eq!(
        summary(&w).await.as_deref(),
        Some("第二答里的秘密 的一句话")
    );
    w.delete(MAIN, &last).await.expect("delete");
    assert_eq!(summary(&w).await.as_deref(), Some("第一答 的一句话"));
    // The row Core broadcast carries it.
    assert_eq!(
        w.events.payload("session-updated-external")["session"]["summary"],
        json!("第一答 的一句话")
    );
}

// ---------------- the runner ----------------

#[tokio::test]
async fn a_live_runner_is_retired_and_started_again() {
    let w = World::with_runner(Runner::live(MAIN, 4242)).await;
    let (user, _) = w.exchange(MAIN, "第一句", "第一答").await;
    w.delete(MAIN, &user).await.expect("delete");
    assert_eq!(w.runner.retired(), vec![(MAIN.to_string(), 4242)]);
    assert_eq!(w.starter.started(), vec![MAIN.to_string()]);
}
