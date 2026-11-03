//! Subtasks the main chat dispatches (`galley_core_lib::subtask`, main
//! chat ticket 06a), against an in-memory database, a scripted runner
//! registry with the run gate's rules, and a fake managed spawn env:
//!
//! - which replies dispatch: the main chat's final answer with tags, once;
//!   never another session's, never a question, never twice;
//! - one tag, one subtask: its parent, origin, title, first message, its
//!   runner started and the instructions dispatched; an empty tag, an
//!   unclosed one and a start that failed recorded with why;
//! - the main chat's replayed history names its subtasks instead of
//!   carrying the instructions, in the carried turns too;
//! - promotion: a person's message promotes, an answer, a subtask's own
//!   message, a CLI or socket send do not.
//! - the background a subtask is told (ticket 138): the main chat's last
//!   turns at dispatch, stored once, in the prompt of every runner it
//!   gets; none for a session no reply dispatched.
//!
//! Parsing, titles and the marker text are unit-tested in
//! `core/src/subtask.rs`; the phone list in `remote_module_test.rs`; the
//! CLI's JSON in `cli/tests/cli_test.rs`.

use async_trait::async_trait;
use chrono::{Duration as ChronoDuration, Utc};
use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, MessageVisibility, Origin, OriginVia, RuntimeKind, SessionId,
    SubtaskDispatch, SubtaskFailure,
};
use galley_core_lib::db::{MainChatSeed, PersistAssistantMessage, RenameTitleSource, SqliteGalley};
use galley_core_lib::ipc::{HistoryLoadedEvent, IpcCommand, IpcEvent, ReadyEvent};
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    is_side_question, BroadcastItem, HeldClose, QueueOffer, ReadySnapshot, RunState,
    RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::session_runner::carry::{CARRY_MAX_CHARS, CARRY_TURNS, CUT_MARKER};
use galley_core_lib::session_runner::{
    ensure_session_runner, EnsureOptions, ReplayTimeouts, RunnerHost, SpawnEnv,
};
use galley_core_lib::session_send::{send_user_message, SendOutcome, SendRequest};
use galley_core_lib::socket_listener::{
    dispatch_line_with, DbSource, DispatchResult, HandlerCtx, RunnerPort,
};
use galley_core_lib::subtask::{
    claim_pending_reply, dispatch_reply, pending_reply, PendingReply, VIA_SUBTASK,
    VIA_SUBTASK_PROMOTED,
};
use galley_core_lib::subtask_background::{prompt_section_in, SubtaskBackground, SECTION_HEADING};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
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

async fn side_chat(galley: &SqliteGalley, id: &str, runtime: RuntimeKind) {
    galley
        .create_session(
            CreateSessionInput {
                id: id.to_string(),
                title: "旁聊".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: Some(runtime),
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::desktop(),
        )
        .await
        .expect("side chat");
}

/// A user message and its reply, written the way Core writes them; the
/// reply's turn index.
async fn exchange(
    galley: &SqliteGalley,
    sid: &str,
    user: &str,
    reply: &str,
    tool_calls: Option<Value>,
) -> i64 {
    let row = galley
        .send_message(SessionId(sid.into()), user.into(), Origin::desktop())
        .await
        .expect("user row");
    let turn_index = row.turn_index.expect("turn index");
    galley
        .persist_assistant_message(PersistAssistantMessage {
            session_id: SessionId(sid.into()),
            turn_index,
            content: reply.into(),
            tool_calls: tool_calls.map(|calls| calls.to_string()),
            tool_results: None,
            thinking: None,
            final_answer: Some(reply.into()),
            summary: None,
            preamble: None,
            visibility: MessageVisibility::Visible,
            telemetry: None,
        })
        .await
        .expect("assistant row");
    galley
        .bump_session_after_turn(SessionId(sid.into()), Some(reply.into()), None, false)
        .await
        .expect("bump");
    i64::from(turn_index)
}

const REPLY: &str = "<thinking>先想想要不要写 <subtask>x</subtask></thinking>\
好，这两件交给子任务，进度看卡片。\n\
<subtask>## 把下载文件夹里的 PDF 按内容分类\n用户说：发票、合同、论文各一类。\n做完交回分类结果。</subtask>\n\
<subtask>  </subtask>\n\
<subtask>查三家打印店的报价，交回一张表</subtask>\n\
<subtask>这段没写完";

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

/// Managed spawn env stand-in (no disk, no app).
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
}

/// Registry fake: a spawn registers a live runner that reports `ready`
/// at once (or fails, with `fail_spawn`), `load_history` is always
/// loaded, a delivered `user_message` / `ask_user_response` opens the run
/// gate, and an offer queues behind an open run.
#[derive(Default)]
struct Runner {
    fail_spawn: bool,
    next_pid: AtomicU32,
    alive: Mutex<HashMap<String, u32>>,
    confirmed: Mutex<HashMap<String, u32>>,
    ready: Mutex<HashMap<String, ReadySnapshot>>,
    channels: Mutex<HashMap<String, broadcast::Sender<BroadcastItem>>>,
    gates: Mutex<HashMap<String, Gate>>,
    sent: Mutex<Vec<(String, IpcCommand)>>,
    spawned: Mutex<Vec<SpawnArgs>>,
}

impl Runner {
    fn failing() -> Self {
        Self {
            fail_spawn: true,
            ..Self::default()
        }
    }
    fn set_gate(&self, sid: &str, gate: Gate) {
        self.gates.lock().unwrap().insert(sid.into(), gate);
    }
    fn gate(&self, sid: &str) -> Gate {
        self.gates
            .lock()
            .unwrap()
            .get(sid)
            .cloned()
            .unwrap_or_default()
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
        if self.fail_spawn {
            return Err(RunnerSpawnError::SpawnIo {
                detail: "fork failed".into(),
            });
        }
        let sid = args.session_id.clone();
        self.spawned.lock().unwrap().push(args);
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
        if !self.alive.lock().unwrap().contains_key(sid) {
            return Err(SendCommandError::ProcessGone {
                session_id: sid.to_string(),
            });
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
            IpcCommand::UserMessage(m) if !is_side_question(&m.text) => {
                self.set_gate(
                    sid,
                    Gate {
                        open_run: true,
                        ask_pending: false,
                    },
                );
            }
            IpcCommand::AskUserResponse(_) => {
                self.set_gate(
                    sid,
                    Gate {
                        open_run: true,
                        ask_pending: false,
                    },
                );
            }
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
        if gate.open_run {
            return QueueOffer::Queued {
                queue_id: "q-1".into(),
                position: 0,
            };
        }
        gate.open_run = true;
        QueueOffer::DispatchNow
    }
    async fn queue_try_reserve(&self, sid: &str) -> bool {
        let mut gates = self.gates.lock().unwrap();
        let gate = gates.entry(sid.to_string()).or_default();
        if gate.open_run {
            return false;
        }
        gate.open_run = true;
        true
    }
    async fn queue_release_run(&self, sid: &str) {
        if let Some(gate) = self.gates.lock().unwrap().get_mut(sid) {
            gate.open_run = false;
        }
    }
    async fn run_state(&self, sid: &str) -> RunState {
        let gate = self.gate(sid);
        RunState {
            runner_alive: self.alive.lock().unwrap().contains_key(sid),
            agent_running: false,
            open_run: gate.open_run,
            queued_count: 0,
            ask_pending: gate.ask_pending,
            last_exit: None,
        }
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

fn fast() -> ReplayTimeouts {
    ReplayTimeouts {
        ready: Duration::from_millis(500),
        history: Duration::from_secs(2),
    }
}

fn request(sid: &str, text: &str, origin: Origin) -> SendRequest {
    SendRequest {
        session_id: sid.into(),
        text: text.into(),
        images: vec![],
        client_request_id: None,
        origin,
        via: "gui",
        llm_override: None,
        ga_config: None,
        timeouts: fast(),
    }
}

/// Dispatch the main chat's settled reply, as the drain task does.
async fn settle(
    galley: &SqliteGalley,
    runner: &Runner,
    notifier: Arc<Recorder>,
) -> Vec<SubtaskDispatch> {
    let env = FakeEnv;
    let reply = pending_reply(galley, MAIN)
        .await
        .expect("read")
        .expect("a reply to dispatch");
    dispatch_reply(&host(galley, runner, &env, notifier), MAIN, &reply).await
}

/// A subtask row as the dispatch makes it, without a runner.
async fn bare_subtask(galley: &SqliteGalley, id: &str) {
    galley
        .create_subtask_session(
            CreateSessionInput {
                id: id.into(),
                title: "分类 PDF".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: Some(RuntimeKind::Managed),
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::subtask(),
            &SessionId(MAIN.into()),
            None,
            RenameTitleSource::User,
        )
        .await
        .expect("subtask");
}

// ---------------- which replies dispatch ----------------

#[tokio::test]
async fn one_tag_one_subtask_and_every_tag_is_recorded() {
    let (_pool, galley) = with_main_chat().await;
    let turn = exchange(&galley, MAIN, "帮我把 PDF 分类，再查报价", REPLY, None).await;
    let runner = Runner::default();
    let rec = Arc::new(Recorder::default());

    let dispatches = settle(&galley, &runner, rec.clone()).await;

    let shape: Vec<(i64, Option<SubtaskFailure>, bool, &str)> = dispatches
        .iter()
        .map(|d| {
            (
                d.ordinal,
                d.failure,
                d.session_id.is_some(),
                d.title.as_str(),
            )
        })
        .collect();
    assert_eq!(
        shape,
        vec![
            (0, None, true, "把下载文件夹里的 PDF 按内容分类"),
            (1, Some(SubtaskFailure::Empty), false, ""),
            (2, None, true, "查三家打印店的报价，交回一张表"),
            (3, Some(SubtaskFailure::Unclosed), false, "这段没写完"),
        ]
    );
    for d in &dispatches {
        assert_eq!(d.turn_index, turn);
        assert_eq!(d.message_id, format!("msg_{MAIN}_{turn}_assistant"));
    }
    // Recorded as returned, in reply order.
    assert_eq!(
        galley
            .subtask_dispatches(&SessionId(MAIN.into()))
            .await
            .unwrap(),
        dispatches
    );

    // Each subtask: an ordinary managed session under the main chat,
    // origin `subtask`, titled by the instructions' first line, on the
    // main chat's model, its first message the instructions, running.
    let first = dispatches[0].session_id.clone().unwrap();
    let brief = galley
        .session_brief(SessionId(first.clone()))
        .await
        .unwrap();
    assert_eq!(brief.parent_session_id.as_deref(), Some(MAIN));
    assert_eq!(brief.promoted, None);
    assert_eq!(
        brief.origin.as_ref().map(|o| o.via),
        Some(OriginVia::Subtask)
    );
    assert_eq!(brief.title, "把下载文件夹里的 PDF 按内容分类");
    assert_eq!(brief.ga_runtime_kind, RuntimeKind::Managed);
    assert_eq!(brief.selected_llm_key.as_deref(), Some("m-1"));
    assert_eq!(brief.main_chat, None);
    let instructions =
        "## 把下载文件夹里的 PDF 按内容分类\n用户说：发票、合同、论文各一类。\n做完交回分类结果。";
    let messages = galley
        .session_messages(SessionId(first.clone()), None)
        .await
        .unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].content, instructions);
    assert_eq!(
        messages[0].origin.as_ref().map(|o| o.via),
        Some(OriginVia::Subtask)
    );
    assert_eq!(runner.user_messages(&first), vec![instructions.to_string()]);
    let raw = galley
        .persisted_message_rows(&SessionId(first.clone()))
        .await
        .unwrap();
    assert_eq!(raw[0].created_via.as_deref(), Some("subtask"));
    assert_eq!(raw[0].supervisor, None);
    let json = serde_json::to_value(&brief).unwrap();
    assert_eq!(json["parentSessionId"], MAIN);
    assert_eq!(json["origin"], json!({ "via": "subtask" }));
    assert!(json.get("promoted").is_none());

    let second = dispatches[2].session_id.clone().unwrap();
    assert_eq!(
        runner.user_messages(&second),
        vec!["查三家打印店的报价，交回一张表".to_string()]
    );
    assert_eq!(runner.spawned.lock().unwrap().len(), 2);

    // Announced: each session created (via `subtask`), its message
    // pending then dispatched, and each tag's record as it settled.
    let created = rec.named("session-created-external");
    assert_eq!(created.len(), 2);
    assert!(created.iter().all(|p| p["via"] == VIA_SUBTASK));
    assert!(created
        .iter()
        .all(|p| p["session"]["parentSessionId"] == MAIN && p["session"]["promoted"].is_null()));
    let persisted: Vec<(String, String)> = rec
        .named("user-message-persisted")
        .into_iter()
        .map(|p| {
            (
                p["sessionId"].as_str().unwrap().to_string(),
                p["dispatch"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    for sub in [&first, &second] {
        let phases: Vec<&str> = persisted
            .iter()
            .filter(|(sid, _)| sid == sub)
            .map(|(_, phase)| phase.as_str())
            .collect();
        assert_eq!(phases, ["pending", "dispatched"], "{sub}");
    }
    let announced = rec.named("subtask-dispatched");
    assert_eq!(announced.len(), 4, "one announcement per tag");
    let mut seen: Vec<(i64, Value)> = announced
        .iter()
        .map(|p| {
            assert_eq!(p["parentSessionId"], MAIN);
            let only = &p["dispatches"].as_array().unwrap()[..];
            assert_eq!(only.len(), 1);
            (
                only[0]["ordinal"].as_i64().unwrap(),
                only[0]["failure"].clone(),
            )
        })
        .collect();
    seen.sort_by_key(|(ordinal, _)| *ordinal);
    assert_eq!(
        seen,
        vec![
            (0, Value::Null),
            (1, json!("empty")),
            (2, Value::Null),
            (3, json!("unclosed")),
        ]
    );
    // A subtask's record is announced once its first message exists:
    // after the message's `pending`, before the runner is up.
    let names: Vec<String> = rec
        .events
        .lock()
        .unwrap()
        .iter()
        .filter(|(n, p)| {
            (n == "user-message-persisted" && p["sessionId"] == first.as_str())
                || (n == "subtask-dispatched" && p["dispatches"][0]["ordinal"] == 0)
        })
        .map(|(n, p)| format!("{n}:{}", p["dispatch"].as_str().unwrap_or("")))
        .collect();
    assert_eq!(
        names,
        [
            "user-message-persisted:pending",
            "subtask-dispatched:",
            "user-message-persisted:dispatched",
        ]
    );

    // The reply is not dispatched again.
    assert_eq!(pending_reply(&galley, MAIN).await.unwrap(), None);
}

/// Ticket 126 (PRD ruling 175): a tag's title is the subtask's own title
/// (`user`, the auto-title watcher leaves it); a tag without one, or with
/// a malformed one, is titled by its first line as `derived`, which the
/// watcher may replace. Several tags of one reply each start.
#[tokio::test]
async fn a_titled_tag_names_its_subtask_and_an_untitled_one_waits_for_a_title() {
    let (_pool, galley) = with_main_chat().await;
    exchange(
        &galley,
        MAIN,
        "发票按月归档，截图按日期放好",
        "两件交出去了。\n\
         <subtask title=\"整理发票\">把下载文件夹里的发票按月份归档到「发票/年-月」。\n交回归档后的清单。</subtask>\n\
         <subtask>把桌面上的截图按日期放进文件夹，交回文件夹路径</subtask>\n\
         <subtask title='单引号'>把「文档/合同」里的 PDF 改名成「日期-对方」</subtask>",
        None,
    )
    .await;
    let runner = Runner::default();
    let dispatches = settle(&galley, &runner, Arc::new(Recorder::default())).await;

    let titles: Vec<(&str, bool)> = dispatches
        .iter()
        .map(|d| {
            (
                d.title.as_str(),
                d.failure.is_none() && d.session_id.is_some(),
            )
        })
        .collect();
    assert_eq!(
        titles,
        vec![
            ("整理发票", true),
            ("把桌面上的截图按日期放进文件夹，交回文件夹路径", true),
            ("把「文档/合同」里的 PDF 改名成「日期-对方」", true),
        ]
    );
    assert_eq!(runner.spawned.lock().unwrap().len(), 3);
    let ids: Vec<String> = dispatches
        .iter()
        .map(|d| d.session_id.clone().unwrap())
        .collect();
    let mut sources = Vec::new();
    for id in &ids {
        sources.push(galley.session_title_source(id).await.unwrap().unwrap());
    }
    assert_eq!(sources, ["user", "derived", "derived"]);
    let brief = galley
        .session_brief(SessionId(ids[0].clone()))
        .await
        .unwrap();
    assert_eq!(brief.title, "整理发票");
    // The instructions are the tag's body; the title stays out of them.
    assert_eq!(
        runner.user_messages(&ids[0]),
        vec!["把下载文件夹里的发票按月份归档到「发票/年-月」。\n交回归档后的清单。".to_string()]
    );

    // The auto-title watcher's write: refused for the tag's title, taken
    // for a first line.
    let sid = |i: usize| SessionId(ids[i].clone());
    assert!(galley
        .try_apply_auto_title(&sid(0), "别的名字")
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        galley
            .try_apply_auto_title(&sid(1), "截图归档")
            .await
            .unwrap()
            .map(|b| b.title),
        Some("截图归档".into())
    );

    // The record keeps the title at dispatch; the replay names each
    // subtask by its session's title now.
    assert_eq!(
        galley
            .subtask_dispatches(&SessionId(MAIN.into()))
            .await
            .unwrap()[1]
            .title,
        "把桌面上的截图按日期放进文件夹，交回文件夹路径"
    );
    exchange(&galley, MAIN, "谢谢", "不客气。", None).await;
    let cold = Runner::default();
    let env = FakeEnv;
    ensure_session_runner(
        &host(&galley, &cold, &env, Arc::new(Recorder::default())),
        MAIN,
        opening(),
    )
    .await
    .expect("restore");
    let reply = format!(
        "两件交出去了。\n\n[subtask {}: 整理发票]\n[subtask {}: 截图归档]\n\
         [subtask {}: 把「文档/合同」里的 PDF 改名成「日期-对方」]",
        ids[0], ids[1], ids[2]
    );
    let mut expected = turn("发票按月归档，截图按日期放好", &reply);
    expected.extend(turn("谢谢", "不客气。"));
    assert_eq!(cold.load_histories(), vec![expected]);
}

#[tokio::test]
async fn a_subtask_that_cannot_start_is_recorded_with_why_and_never_retried() {
    let (_pool, galley) = with_main_chat().await;
    exchange(
        &galley,
        MAIN,
        "整理一下",
        "交出去了。<subtask>整理下载文件夹</subtask>",
        None,
    )
    .await;
    let runner = Runner::failing();
    let rec = Arc::new(Recorder::default());

    let dispatches = settle(&galley, &runner, rec.clone()).await;

    assert_eq!(dispatches.len(), 1);
    let d = &dispatches[0];
    assert_eq!(d.failure, Some(SubtaskFailure::StartFailed));
    assert!(
        d.failure_detail.as_deref().unwrap().contains("fork failed"),
        "{d:?}"
    );
    // The row exists, with its message saved and nothing running.
    let sub = d.session_id.clone().expect("the row was created");
    assert_eq!(
        galley
            .session_messages(SessionId(sub.clone()), None)
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(rec
        .named("user-message-persisted")
        .iter()
        .any(|p| p["dispatch"] == "persisted_only"));
    // Its card showed it starting, then not started, with why; the
    // record says so too.
    let announced: Vec<Value> = rec
        .named("subtask-dispatched")
        .into_iter()
        .map(|p| p["dispatches"][0]["failure"].clone())
        .collect();
    assert_eq!(announced, vec![Value::Null, json!("start_failed")]);
    assert_eq!(
        galley
            .subtask_dispatches(&SessionId(MAIN.into()))
            .await
            .unwrap(),
        dispatches
    );
    assert_eq!(pending_reply(&galley, MAIN).await.unwrap(), None);
}

#[tokio::test]
async fn a_session_that_cannot_be_created_starts_nothing() {
    let (_pool, galley) = with_main_chat().await;
    let runner = Runner::default();
    let env = FakeEnv;
    // A parent that is not there fails the row's foreign key.
    let reply = PendingReply {
        turn_index: 4,
        content: "<subtask>整理下载文件夹</subtask>".into(),
    };
    let dispatches = dispatch_reply(
        &host(&galley, &runner, &env, Arc::new(Recorder::default())),
        "s-gone",
        &reply,
    )
    .await;
    assert_eq!(dispatches.len(), 1);
    assert_eq!(dispatches[0].failure, Some(SubtaskFailure::StartFailed));
    assert_eq!(dispatches[0].session_id, None);
    assert!(dispatches[0].failure_detail.is_some());
    assert!(runner.spawned.lock().unwrap().is_empty());
}

#[tokio::test]
async fn only_the_main_chats_final_answer_dispatches_once() {
    let (_pool, galley) = with_main_chat().await;
    // The greeting-less main chat has said nothing yet.
    assert_eq!(pending_reply(&galley, MAIN).await.unwrap(), None);

    // A side chat (managed or attached) that writes the tag: just text.
    side_chat(&galley, "s-side", RuntimeKind::Managed).await;
    exchange(&galley, "s-side", "q", "<subtask>做点事</subtask>", None).await;
    assert_eq!(pending_reply(&galley, "s-side").await.unwrap(), None);
    side_chat(&galley, "s-attached", RuntimeKind::External).await;
    exchange(
        &galley,
        "s-attached",
        "q",
        "<subtask>做点事</subtask>",
        None,
    )
    .await;
    assert_eq!(pending_reply(&galley, "s-attached").await.unwrap(), None);

    // A reply that ends on a question is not a final answer.
    exchange(
        &galley,
        MAIN,
        "帮我整理",
        "先问一下。<subtask>整理</subtask>",
        Some(json!([{ "toolName": "ask_user", "args": { "question": "哪个文件夹？" } }])),
    )
    .await;
    assert_eq!(pending_reply(&galley, MAIN).await.unwrap(), None);

    // A plain answer without tags dispatches nothing.
    exchange(&galley, MAIN, "早", "早。", None).await;
    assert_eq!(pending_reply(&galley, MAIN).await.unwrap(), None);

    // A final answer with a tag: claimed once, even before its records.
    let turn = exchange(
        &galley,
        MAIN,
        "整理下载文件夹",
        "好。<subtask>整理下载文件夹</subtask>",
        Some(json!([{ "toolName": "no_tool", "args": {} }])),
    )
    .await;
    let claimed = claim_pending_reply(&galley, MAIN).await.unwrap();
    assert_eq!(claimed.map(|r| r.turn_index), Some(turn));
    assert_eq!(claim_pending_reply(&galley, MAIN).await.unwrap(), None);
}

// ---------------- the replayed history ----------------

fn turn(user: &str, reply: &str) -> Vec<Value> {
    vec![
        json!({"role": "user", "content": user}),
        json!({"role": "assistant", "content": reply}),
    ]
}

fn opening() -> EnsureOptions<'static> {
    EnsureOptions {
        via: "gui",
        active_session_id: None,
        llm_override: None,
        ga_config: None,
        holds_run_gate: false,
        timeouts: fast(),
    }
}

const MARKED: &str = "好，这两件交给子任务，进度看卡片。";

/// What the dispatched reply reads as in the replay: its text without
/// any `<subtask>` block (one quoted in its thinking too), then a line
/// per tag.
fn marked(dispatches: &[SubtaskDispatch]) -> String {
    format!(
        "<thinking>先想想要不要写 </thinking>{MARKED}\n\n\
         [subtask {}: 把下载文件夹里的 PDF 按内容分类]\n\
         [subtask not started: the tag was empty]\n\
         [subtask {}: 查三家打印店的报价，交回一张表]\n\
         [subtask not started: the tag was not closed]",
        dispatches[0].session_id.as_deref().unwrap(),
        dispatches[2].session_id.as_deref().unwrap(),
    )
}

#[tokio::test]
async fn the_replay_names_the_subtasks_instead_of_the_instructions() {
    let (_pool, galley) = with_main_chat().await;
    exchange(&galley, MAIN, "帮我把 PDF 分类，再查报价", REPLY, None).await;
    let dispatches = settle(&galley, &Runner::default(), Arc::new(Recorder::default())).await;
    exchange(&galley, MAIN, "谢谢", "不客气。", None).await;

    let cold = Runner::default();
    let env = FakeEnv;
    ensure_session_runner(
        &host(&galley, &cold, &env, Arc::new(Recorder::default())),
        MAIN,
        opening(),
    )
    .await
    .expect("restore");

    let mut expected = turn("帮我把 PDF 分类，再查报价", &marked(&dispatches));
    expected.extend(turn("谢谢", "不客气。"));
    assert_eq!(cold.load_histories(), vec![expected]);
    // The database keeps the reply as the model wrote it.
    let rows = galley
        .persisted_message_rows(&SessionId(MAIN.into()))
        .await
        .unwrap();
    assert!(rows.iter().any(|r| r.content == REPLY));
}

#[tokio::test]
async fn the_turns_a_new_segment_carries_name_their_subtasks_too() {
    let (pool, galley) = with_main_chat().await;
    exchange(&galley, MAIN, "帮我把 PDF 分类，再查报价", REPLY, None).await;
    let dispatches = settle(&galley, &Runner::default(), Arc::new(Recorder::default())).await;
    exchange(&galley, MAIN, "谢谢", "不客气。", None).await;
    let at = Utc::now() - ChronoDuration::hours(6);
    sqlx::query("UPDATE sessions SET last_activity_at = ? WHERE id = ?")
        .bind(at.to_rfc3339())
        .bind(MAIN)
        .execute(&pool)
        .await
        .unwrap();

    // After the idle gap the next message opens a segment, which carries
    // the turns before it.
    let runner = Runner::default();
    let env = FakeEnv;
    send_user_message(
        &host(&galley, &runner, &env, Arc::new(Recorder::default())),
        request(MAIN, "接着说", Origin::desktop()),
    )
    .await
    .expect("send");
    let mut carried = turn("帮我把 PDF 分类，再查报价", &marked(&dispatches));
    carried.extend(turn("谢谢", "不客气。"));
    assert_eq!(runner.load_histories(), vec![carried]);
}

// ---------------- promotion ----------------

fn promoted(rec: &Recorder) -> Vec<Value> {
    rec.named("session-updated-external")
        .into_iter()
        .filter(|p| p["via"] == VIA_SUBTASK_PROMOTED)
        .collect()
}

#[tokio::test]
async fn a_message_from_the_user_promotes_a_subtask_once() {
    let (_pool, galley) = with_main_chat().await;
    bare_subtask(&galley, "s-sub").await;
    let runner = Runner::default();
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());

    let outcome = send_user_message(
        &host(&galley, &runner, &env, rec.clone()),
        request("s-sub", "顺便把图片也分一下", Origin::desktop()),
    )
    .await
    .expect("send");
    assert!(matches!(outcome, SendOutcome::Dispatched { .. }));
    let brief = galley
        .session_brief(SessionId("s-sub".into()))
        .await
        .unwrap();
    assert_eq!(brief.promoted, Some(true));
    assert_eq!(brief.parent_session_id.as_deref(), Some(MAIN));
    let events = promoted(&rec);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["session"]["promoted"], true);

    // A second message promotes nothing more.
    runner.set_gate("s-sub", Gate::default());
    send_user_message(
        &host(&galley, &runner, &env, rec.clone()),
        request("s-sub", "再补一句", Origin::desktop()),
    )
    .await
    .expect("send");
    assert_eq!(promoted(&rec).len(), 1);
}

#[tokio::test]
async fn a_message_queued_behind_the_run_promotes_too() {
    let (_pool, galley) = with_main_chat().await;
    bare_subtask(&galley, "s-sub").await;
    let runner = Runner::default();
    runner.set_gate(
        "s-sub",
        Gate {
            open_run: true,
            ask_pending: false,
        },
    );
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());
    let outcome = send_user_message(
        &host(&galley, &runner, &env, rec.clone()),
        request("s-sub", "做完再看看图片", Origin::desktop()),
    )
    .await
    .expect("send");
    assert!(matches!(outcome, SendOutcome::Queued { .. }));
    assert_eq!(promoted(&rec).len(), 1);
}

#[tokio::test]
async fn an_answer_or_a_message_not_from_the_user_does_not_promote() {
    let (_pool, galley) = with_main_chat().await;
    bare_subtask(&galley, "s-sub").await;
    let env = FakeEnv;
    let rec = Arc::new(Recorder::default());

    // The answer to the subtask's question, from the card or inside it.
    let runner = Runner::default();
    runner.set_gate(
        "s-sub",
        Gate {
            open_run: false,
            ask_pending: true,
        },
    );
    send_user_message(
        &host(&galley, &runner, &env, rec.clone()),
        request("s-sub", "482913", Origin::desktop()),
    )
    .await
    .expect("answer");
    assert!(runner
        .sent
        .lock()
        .unwrap()
        .iter()
        .any(|(_, cmd)| matches!(cmd, IpcCommand::AskUserResponse(_))));

    // Sends that are not a person's.
    for origin in [Origin::subtask(), Origin::cli(Some("ga-1".into()), None)] {
        let runner = Runner::default();
        send_user_message(
            &host(&galley, &runner, &env, rec.clone()),
            request("s-sub", "继续", origin),
        )
        .await
        .expect("send");
    }
    // The socket's `session send` (CLI, supervisor) never comes through
    // Core's send at all.
    let runner = Runner::default();
    let db = DbSource::Pool(galley.clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: &runner,
        notifier: rec.clone(),
        app: None,
    };
    let line = serde_json::to_string(&json!({
        "command": "session.send",
        "args": { "sessionId": "s-sub", "content": "CLI 补一句" },
        "schemaVersion": 1,
    }))
    .unwrap();
    match dispatch_line_with(&ctx, &line).await {
        DispatchResult::Unary(resp) => assert!(resp.ok, "{resp:?}"),
        DispatchResult::Stream { .. } => panic!("unary expected"),
    }

    assert!(promoted(&rec).is_empty());
    let brief = galley
        .session_brief(SessionId("s-sub".into()))
        .await
        .unwrap();
    assert_eq!(brief.promoted, None);
}

// ---------------- the background a subtask is told (ticket 138) ----------------

/// What every runtime prompt but the main chat's and a subtask's is,
/// standing in for `managed_prompt::compose_runtime_prompt`.
const WORKBENCH_PROMPT: &str = "workbench prompt";

/// [`FakeEnv`] plus the one thing `prepare_managed_spawn_args` does for a
/// subtask (ticket 138), through the function it calls: the runtime
/// prompt gains the "Main Chat Background" section the dispatch stored,
/// read when the runner spawns. Times in UTC.
struct BackgroundEnv {
    galley: SqliteGalley,
}

#[async_trait]
impl SpawnEnv for BackgroundEnv {
    fn bundled_python(&self) -> Option<PathBuf> {
        FakeEnv.bundled_python()
    }
    fn bridge_cwd(&self) -> Result<PathBuf, String> {
        FakeEnv.bridge_cwd()
    }
    async fn prepare_managed(&self, args: SpawnArgs) -> Result<SpawnArgs, RunnerSpawnError> {
        let mut args = FakeEnv.prepare_managed(args).await?;
        let prompt = match prompt_section_in(&self.galley, &args.session_id, &Utc).await {
            Some(section) => format!("{WORKBENCH_PROMPT}\n\n{section}"),
            None => WORKBENCH_PROMPT.to_string(),
        };
        args.env.push(("GALLEY_RUNTIME_PROMPT_TEXT".into(), prompt));
        Ok(args)
    }
}

fn host_with<'a>(
    galley: &'a SqliteGalley,
    runner: &'a Runner,
    env: &'a dyn SpawnEnv,
    notifier: Arc<Recorder>,
) -> RunnerHost<'a> {
    RunnerHost {
        galley,
        runner,
        notifier,
        env: Some(env),
    }
}

/// The runtime prompt of every runner spawned for `sid`, in order.
fn prompts(runner: &Runner, sid: &str) -> Vec<String> {
    runner
        .spawned
        .lock()
        .unwrap()
        .iter()
        .filter(|args| args.session_id == sid)
        .map(|args| {
            args.env
                .iter()
                .find(|(key, _)| key == "GALLEY_RUNTIME_PROMPT_TEXT")
                .map(|(_, prompt)| prompt.clone())
                .unwrap_or_default()
        })
        .collect()
}

/// The background stored with the dispatch that created `sid`.
async fn stored_background(galley: &SqliteGalley, sid: &str) -> Option<SubtaskBackground> {
    galley
        .subtask_background(&SessionId(sid.into()))
        .await
        .expect("read")
        .map(|json| serde_json::from_str(&json).expect("stored background parses"))
}

fn user_and_reply(background: &SubtaskBackground) -> Vec<(&str, &str)> {
    background
        .turns
        .iter()
        .map(|turn| (turn.user.as_str(), turn.reply.as_str()))
        .collect()
}

/// The window is the dispatching reply's segment up to the reply, read
/// as the main chat's replay reads it: an earlier reply names its
/// subtask, the dispatching one loses its tags with no marker, nothing
/// from before the boundary or after the reply. Every subtask of the
/// reply is told the same.
#[tokio::test]
async fn the_background_is_the_segment_up_to_the_dispatching_reply() {
    let (_pool, galley) = with_main_chat().await;
    let main = SessionId(MAIN.into());
    let before = exchange(&galley, MAIN, "上一段说的", "上一段的回复", None).await;
    galley
        .record_main_chat_segment(&main, before + 1)
        .await
        .expect("boundary");
    exchange(
        &galley,
        MAIN,
        "先查报价",
        "好。\n<subtask title=\"报价\">查三家打印店的报价</subtask>",
        None,
    )
    .await;
    let earlier = settle(&galley, &Runner::default(), Arc::new(Recorder::default())).await;
    let earlier_id = earlier[0].session_id.clone().expect("a subtask");
    exchange(&galley, MAIN, "谢谢", "不客气。", None).await;
    exchange(
        &galley,
        MAIN,
        "周五去上海开会，帮我订高铁和酒店",
        "<thinking>两件事</thinking>好，两件都去办了。\n\
         <subtask title=\"订票\">订周五去上海的高铁</subtask>\n\
         <subtask title=\"订酒店\">订周五上海的酒店</subtask>",
        None,
    )
    .await;
    // A message the user sent meanwhile, waiting for its reply.
    galley
        .send_message(main.clone(), "还有别的吗".into(), Origin::desktop())
        .await
        .expect("queued message");

    let dispatches = settle(&galley, &Runner::default(), Arc::new(Recorder::default())).await;
    assert_eq!(dispatches.len(), 2);
    let ticket = dispatches[0].session_id.clone().expect("a subtask");
    let hotel = dispatches[1].session_id.clone().expect("a subtask");

    let background = stored_background(&galley, &ticket)
        .await
        .expect("a background");
    assert_eq!(
        user_and_reply(&background),
        vec![
            (
                "先查报价",
                format!("好。\n\n[subtask {earlier_id}: 报价]").as_str()
            ),
            ("谢谢", "不客气。"),
            (
                "周五去上海开会，帮我订高铁和酒店",
                "<thinking>两件事</thinking>好，两件都去办了。"
            ),
        ]
    );
    assert_eq!(stored_background(&galley, &hotel).await, Some(background));
    // The earlier subtask was told the segment as it stood then: its own
    // reply's turn alone.
    assert_eq!(
        user_and_reply(&stored_background(&galley, &earlier_id).await.expect("one")),
        vec![("先查报价", "好。")]
    );
}

/// The carry's limits hold: the last ten turns, and a latest turn over
/// the cap alone, cut where the carry cuts it.
#[tokio::test]
async fn the_background_keeps_the_carrys_ten_turns_and_its_cap() {
    let (_pool, galley) = with_main_chat().await;
    for i in 0..11 {
        exchange(&galley, MAIN, &format!("第{i}句"), &format!("回{i}"), None).await;
    }
    exchange(
        &galley,
        MAIN,
        "订票",
        "去订了。<subtask title=\"订票\">订周五的高铁</subtask>",
        None,
    )
    .await;
    let dispatches = settle(&galley, &Runner::default(), Arc::new(Recorder::default())).await;
    let background = stored_background(&galley, dispatches[0].session_id.as_deref().unwrap())
        .await
        .expect("a background");
    let users: Vec<&str> = background.turns.iter().map(|t| t.user.as_str()).collect();
    let mut expected: Vec<String> = (2..11).map(|i| format!("第{i}句")).collect();
    expected.push("订票".into());
    assert_eq!(users, expected);
    assert_eq!(background.turns.len(), CARRY_TURNS);

    // A paste too long for the cap: the older turns go, it is cut in the
    // middle and keeps the request at its end.
    let paste = format!("{}这份合同帮我找律师看看", "贴".repeat(CARRY_MAX_CHARS));
    exchange(
        &galley,
        MAIN,
        &paste,
        "好。<subtask title=\"找律师\">把合同发给律师</subtask>",
        None,
    )
    .await;
    let dispatches = settle(&galley, &Runner::default(), Arc::new(Recorder::default())).await;
    let background = stored_background(&galley, dispatches[0].session_id.as_deref().unwrap())
        .await
        .expect("a background");
    assert_eq!(background.turns.len(), 1);
    let turn = &background.turns[0];
    assert_eq!(turn.reply, "好。");
    assert!(turn.user.starts_with('贴'));
    assert!(turn.user.contains(CUT_MARKER));
    assert!(turn.user.ends_with("这份合同帮我找律师看看"));
    assert_eq!(background.chars(), CARRY_MAX_CHARS);
}

/// The subtask's first runner is told the background in its runtime
/// prompt, not its conversation; a runner started after a restart, the
/// main chat having moved on, is told the same.
#[tokio::test]
async fn every_runner_of_a_subtask_is_told_the_same_background() {
    let (_pool, galley) = with_main_chat().await;
    exchange(&galley, MAIN, "周五要去上海开会", "好的，记下了。", None).await;
    exchange(
        &galley,
        MAIN,
        "帮我订高铁",
        "去订了。\n<subtask title=\"订票\">订周五去上海的高铁，上午出发</subtask>",
        None,
    )
    .await;
    let env = BackgroundEnv {
        galley: galley.clone(),
    };
    let runner = Runner::default();
    let reply = pending_reply(&galley, MAIN).await.unwrap().unwrap();
    let dispatches = dispatch_reply(
        &host_with(&galley, &runner, &env, Arc::new(Recorder::default())),
        MAIN,
        &reply,
    )
    .await;
    let sub = dispatches[0].session_id.clone().expect("a subtask");

    // First runner: the prompt carries the turns; the first message is
    // the instructions alone, as the desktop shows it.
    let first = prompts(&runner, &sub);
    assert_eq!(first.len(), 1);
    let section = first[0]
        .strip_prefix(&format!("{WORKBENCH_PROMPT}\n\n{SECTION_HEADING}\n\n"))
        .expect("the section follows the workbench prompt");
    assert!(section
        .contains("<user>\n周五要去上海开会\n</user>\n<main-chat>\n好的，记下了。\n</main-chat>"));
    assert!(section.contains("<user>\n帮我订高铁\n</user>\n<main-chat>\n去订了。\n</main-chat>"));
    assert!(!section.contains("上午出发"));
    assert_eq!(
        runner.user_messages(&sub),
        vec!["订周五去上海的高铁，上午出发".to_string()]
    );
    let rows = galley
        .persisted_message_rows(&SessionId(sub.clone()))
        .await
        .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].content, "订周五去上海的高铁，上午出发");

    // The subtask answers; the main chat moves on.
    galley
        .persist_assistant_message(PersistAssistantMessage {
            session_id: SessionId(sub.clone()),
            turn_index: u32::try_from(rows[0].turn_index).unwrap(),
            content: "订好了：G1 次。".into(),
            tool_calls: None,
            tool_results: None,
            thinking: None,
            final_answer: Some("订好了：G1 次。".into()),
            summary: None,
            preamble: None,
            visibility: MessageVisibility::Visible,
            telemetry: None,
        })
        .await
        .unwrap();
    galley
        .bump_session_after_turn(SessionId(sub.clone()), Some("订好了".into()), None, false)
        .await
        .unwrap();
    exchange(&galley, MAIN, "改成周六吧", "好。", None).await;

    // Core restarts: a cold runner for the subtask (a send-back, the
    // desktop opening it) is told what the first one was, and gets its
    // own conversation back without the background in it.
    let cold = Runner::default();
    ensure_session_runner(
        &host_with(&galley, &cold, &env, Arc::new(Recorder::default())),
        &sub,
        opening(),
    )
    .await
    .expect("cold start");
    assert_eq!(prompts(&cold, &sub), first);
    assert_eq!(
        cold.load_histories(),
        vec![turn("订周五去上海的高铁，上午出发", "订好了：G1 次。")]
    );
    assert!(!first[0].contains("改成周六吧"));
}

/// A session no reply dispatched is told nothing: a workbench session,
/// one an agent opened through the CLI, the main chat itself, and a
/// subtask recorded before ticket 138.
#[tokio::test]
async fn sessions_no_reply_dispatched_carry_no_background() {
    let (_pool, galley) = with_main_chat().await;
    exchange(&galley, MAIN, "周五要去上海开会", "好的。", None).await;
    side_chat(&galley, "s-side", RuntimeKind::Managed).await;
    galley
        .create_session(
            CreateSessionInput {
                id: "s-cli".into(),
                title: "CLI 开的".into(),
                project_id: None,
                selected_llm_index: None,
                selected_llm_key: None,
                selected_llm_display_name: None,
                ga_runtime_kind: Some(RuntimeKind::Managed),
                ga_runtime_id: None,
                prompt_profile: None,
            },
            Origin::cli(Some("ga-1".into()), None),
        )
        .await
        .expect("cli session");
    bare_subtask(&galley, "s-old").await;
    galley
        .record_subtask_dispatch(&SubtaskDispatch {
            parent_session_id: MAIN.into(),
            turn_index: 0,
            ordinal: 0,
            message_id: SubtaskDispatch::reply_message_id(MAIN, 0),
            session_id: Some("s-old".into()),
            title: "分类 PDF".into(),
            failure: None,
            failure_detail: None,
            created_at: "2026-11-01T00:00:00Z".into(),
            send_backs: 0,
        })
        .await
        .expect("record");

    let env = BackgroundEnv {
        galley: galley.clone(),
    };
    for sid in ["s-side", "s-cli", "s-old", MAIN] {
        assert_eq!(prompt_section_in(&galley, sid, &Utc).await, None, "{sid}");
        let runner = Runner::default();
        ensure_session_runner(
            &host_with(&galley, &runner, &env, Arc::new(Recorder::default())),
            sid,
            opening(),
        )
        .await
        .expect("runner");
        assert_eq!(
            prompts(&runner, sid),
            vec![WORKBENCH_PROMPT.to_string()],
            "{sid}"
        );
    }
}
