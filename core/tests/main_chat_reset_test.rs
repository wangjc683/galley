//! Resetting the main chat (`galley_core_lib::main_chat_reset`, main chat
//! ticket 15, PRD ruling 59), against an in-memory database, a recording
//! runner registry and a temp directory laid out like the real data
//! directory. Nothing here resolves a real path: every directory the
//! reset may delete is passed in, and each test first asserts it sits
//! inside its own temp dir.
//!
//! - What goes: the main chat, its unpromoted subtasks (archived ones
//!   too) with their messages, attachment rows and files, segments,
//!   dispatch records and search rows; the memory beyond the seed; every
//!   pre-migration backup. What stays: promoted subtasks (now ordinary
//!   conversations), other sessions, `temp/`, the data directory.
//! - The new main chat opens with the greeting in the UI language.
//! - Refused, with nothing changed, while a conversation runs, on the
//!   external runtime, without a main chat; a failed memory copy changes
//!   nothing either. A held queue is not a run; a deleted session's
//!   queued drafts are dropped.
//! - Broadcast: each deletion, then the new main chat; runners closed for
//!   the deleted sessions only; the new main chat's runner asked for once
//!   (so GA writes its memory files from its templates), never on a
//!   refusal or failure, and a start that fails or hangs holds nothing up.

use async_trait::async_trait;
use galley_core_lib::api::{
    CreateSessionInput, GalleyApi, MessageRole, MessageVisibility, Origin, QueuedMessage,
    RuntimeKind, SessionId, SubtaskDispatch,
};
use galley_core_lib::db::{
    PersistAssistantMessage, SqliteGalley, MAIN_CHAT_GREETING_EN, MAIN_CHAT_GREETING_ZH,
};
use galley_core_lib::ipc::IpcCommand;
use galley_core_lib::main_chat_reset::{
    reset_main_chat, ResetMainChatError, ResetPaths, RunnerStarter, StartRunner,
};
use galley_core_lib::notify::Notifier;
use galley_core_lib::runner_manager::{
    BroadcastItem, RunState, RunnerSpawnError, SendCommandError, ShutdownError, SpawnArgs,
};
use galley_core_lib::session_writes::{Writes, VIA_GUI};
use galley_core_lib::socket_listener::RunnerPort;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tokio::sync::broadcast;

// ---------------- fixtures ----------------

async fn fresh(active: &str) -> (SqlitePool, SqliteGalley) {
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
        .set_pref_json("active_runtime_kind", json!(active))
        .await
        .expect("active runtime");
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
    /// `(event, session id)` in emit order.
    fn sessions(&self) -> Vec<(String, String)> {
        self.events
            .lock()
            .unwrap()
            .iter()
            .map(|(name, payload)| {
                let id = payload["sessionId"]
                    .as_str()
                    .or_else(|| payload["session"]["id"].as_str())
                    .unwrap_or_default()
                    .to_string();
                (name.clone(), id)
            })
            .collect()
    }
    fn clear(&self) {
        self.events.lock().unwrap().clear();
    }
}

/// A runner registry that knows the run states and queues it is given,
/// and records every runner it is asked to close and every queued
/// message it is asked to drop.
#[derive(Default)]
struct Runner {
    states: Mutex<HashMap<String, RunState>>,
    queues: Mutex<HashMap<String, Vec<QueuedMessage>>>,
    closed: Mutex<Vec<String>>,
    dropped: Mutex<Vec<(String, String)>>,
}

impl Runner {
    fn with_state(session_id: &str, state: RunState) -> Self {
        let runner = Self::default();
        runner
            .states
            .lock()
            .unwrap()
            .insert(session_id.to_string(), state);
        runner
    }
    fn closed(&self) -> Vec<String> {
        let mut closed = self.closed.lock().unwrap().clone();
        closed.sort();
        closed.dedup();
        closed
    }
    fn queue(&self, session_id: &str, queue_id: &str) {
        self.queues
            .lock()
            .unwrap()
            .entry(session_id.to_string())
            .or_default()
            .push(QueuedMessage {
                queue_id: queue_id.to_string(),
                text: "排着队的话".into(),
                origin: None,
                queued_at: "2026-10-14T00:00:00Z".into(),
            });
    }
}

#[async_trait]
impl RunnerPort for Runner {
    async fn spawn(
        &self,
        _args: SpawnArgs,
        _active_session_id: Option<&str>,
    ) -> Result<u32, RunnerSpawnError> {
        panic!("a reset starts no runner")
    }
    async fn send_command(
        &self,
        _session_id: &str,
        _cmd: &IpcCommand,
    ) -> Result<(), SendCommandError> {
        panic!("a reset sends no command")
    }
    async fn subscribe(&self, _session_id: &str) -> Option<broadcast::Receiver<BroadcastItem>> {
        None
    }
    async fn pid(&self, _session_id: &str) -> Option<u32> {
        None
    }
    async fn agent_running(&self, _session_id: &str) -> bool {
        false
    }
    async fn shutdown(
        &self,
        session_id: &str,
        _grace: Option<std::time::Duration>,
    ) -> Result<(), ShutdownError> {
        self.closed.lock().unwrap().push(session_id.to_string());
        Ok(())
    }
    async fn run_state(&self, session_id: &str) -> RunState {
        self.states
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .unwrap_or_default()
    }
    async fn known_session_ids(&self) -> Vec<String> {
        self.states.lock().unwrap().keys().cloned().collect()
    }
    async fn queue_snapshot(&self, session_id: &str) -> Vec<QueuedMessage> {
        self.queues
            .lock()
            .unwrap()
            .get(session_id)
            .cloned()
            .unwrap_or_default()
    }
    async fn queue_remove(&self, session_id: &str, queue_id: &str) -> Option<QueuedMessage> {
        let mut queues = self.queues.lock().unwrap();
        let queue = queues.get_mut(session_id)?;
        let at = queue.iter().position(|m| m.queue_id == queue_id)?;
        self.dropped
            .lock()
            .unwrap()
            .push((session_id.to_string(), queue_id.to_string()));
        Some(queue.remove(at))
    }
}

/// How the fake start of a runner ends.
#[derive(Default, Clone, Copy)]
enum StartEnds {
    #[default]
    Started,
    Fails,
    Hangs,
}

/// Records each runner start a reset asks for.
#[derive(Default)]
struct Starter {
    started: Mutex<Vec<String>>,
    ends: StartEnds,
}

impl Starter {
    fn ending(ends: StartEnds) -> Self {
        Self {
            ends,
            ..Self::default()
        }
    }
    fn started(&self) -> Vec<String> {
        self.started.lock().unwrap().clone()
    }
}

impl RunnerStarter for Starter {
    fn start(&self, session_id: SessionId) -> StartRunner {
        self.started.lock().unwrap().push(session_id.0);
        match self.ends {
            StartEnds::Started => Box::pin(async { Ok(()) }),
            StartEnds::Fails => Box::pin(async { Err("python not found".to_string()) }),
            StartEnds::Hangs => Box::pin(std::future::pending()),
        }
    }
}

/// A temp directory laid out like the real ones: the data directory with
/// the database's attachments, the engine state and two backups beside
/// it, and the app resources with the memory seed (a copy of the one the
/// app ships).
struct Disk {
    tmp: tempfile::TempDir,
    paths: ResetPaths,
    temp_dir: PathBuf,
    backups: Vec<PathBuf>,
}

impl Disk {
    fn new() -> Self {
        let tmp = tempfile::tempdir().expect("tempdir");
        let support = tmp.path().join("Application Support");
        let data_dir = support.join("app.galley");
        let state = data_dir.join("managed-ga-state");
        let paths = ResetPaths {
            memory_seed_dir: tmp.path().join("Resources/managed-ga/state-seed/memory"),
            memory_dir: state.join("memory"),
            data_dir: data_dir.clone(),
            attachments_root: data_dir.join("conversation-attachments"),
        };
        let temp_dir = state.join("temp");
        // Everything a reset may move or delete is in this test's temp dir.
        for path in [
            &paths.memory_seed_dir,
            &paths.memory_dir,
            &paths.data_dir,
            &paths.attachments_root,
            &temp_dir,
        ] {
            assert!(path.starts_with(tmp.path()), "{}", path.display());
        }

        let repo_seed = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repo root")
            .join("managed-ga/state-seed/memory");
        copy_tree(&repo_seed, &paths.memory_seed_dir);
        for (rel, body) in [
            ("global_mem.txt", "# [Global Memory - L2]\n用户喜欢喝茶"),
            ("global_mem_insight.txt", "[insight]"),
            ("memory_management_sop.md", "edited by the engine"),
            ("tea_sop.md", "a way of working it learned"),
        ] {
            write(&paths.memory_dir.join(rel), body);
        }
        write(&data_dir.join("workbench.db"), "the live database");
        write(&temp_dir.join("report.xlsx"), "a file it made for you");
        write(
            &temp_dir.join("model_responses/model_responses_123456.txt"),
            "=== Prompt ===",
        );
        let backups: Vec<PathBuf> = ["20260901T000000Z", "20261001T000000Z"]
            .iter()
            .map(|stamp| support.join(format!("app.galley.backup.{stamp}")))
            .collect();
        for backup in &backups {
            assert!(backup.starts_with(tmp.path()));
            write(&backup.join("workbench.db"), "an old copy");
            write(
                &backup.join("managed-ga-state/memory/global_mem.txt"),
                "old memory",
            );
        }
        Self {
            tmp,
            paths,
            temp_dir,
            backups,
        }
    }

    fn attachment(&self, session_id: &str, message_id: &str) -> PathBuf {
        let path = self
            .paths
            .attachments_root
            .join(session_id)
            .join(message_id)
            .join("att_1.png");
        assert!(path.starts_with(self.tmp.path()));
        path
    }
}

fn write(path: &Path, body: &str) {
    fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    fs::write(path, body).expect("write");
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).expect("mkdir");
    for entry in fs::read_dir(from).expect("read seed") {
        let entry = entry.expect("entry");
        let target = to.join(entry.file_name());
        if entry.file_type().expect("type").is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).expect("copy");
        }
    }
}

/// Every file under `root`, by relative path, with its bytes.
fn tree(root: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    let mut out = BTreeMap::new();
    if !root.exists() {
        return out;
    }
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        for entry in fs::read_dir(&dir).expect("read dir") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                pending.push(path);
            } else {
                out.insert(
                    path.strip_prefix(root).expect("under root").to_path_buf(),
                    fs::read(&path).expect("read"),
                );
            }
        }
    }
    out
}

fn input(id: &str) -> CreateSessionInput {
    CreateSessionInput {
        id: id.to_string(),
        title: "新对话".to_string(),
        project_id: None,
        selected_llm_index: None,
        selected_llm_key: None,
        selected_llm_display_name: None,
        ga_runtime_kind: Some(RuntimeKind::Managed),
        ga_runtime_id: None,
        prompt_profile: None,
    }
}

/// A user message and its reply, written the way Core writes them; the
/// user row's id and the turn index.
async fn exchange(galley: &SqliteGalley, sid: &str, user: &str, reply: &str) -> (String, i64) {
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
            tool_calls: None,
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
    (row.id.0, i64::from(turn_index))
}

/// An image on a message: its row, and its file where Core puts it.
async fn attach(pool: &SqlitePool, disk: &Disk, session_id: &str, message_id: &str) -> PathBuf {
    let file = disk.attachment(session_id, message_id);
    write(&file, "png bytes");
    sqlx::query(
        "INSERT INTO message_attachments \
         (id, message_id, session_id, kind, file_path, mime_type, byte_size, created_at) \
         VALUES (?, ?, ?, 'image', ?, 'image/png', 9, '2026-10-14T00:00:00Z')",
    )
    .bind(format!("att_{message_id}_1"))
    .bind(message_id)
    .bind(session_id)
    .bind(file.to_string_lossy().into_owned())
    .execute(pool)
    .await
    .expect("attachment row");
    file
}

async fn count(pool: &SqlitePool, sql: &str, id: &str) -> i64 {
    sqlx::query_scalar(sql)
        .bind(id)
        .fetch_one(pool)
        .await
        .expect(sql)
}

async fn session_rows(pool: &SqlitePool, id: &str) -> i64 {
    count(pool, "SELECT COUNT(*) FROM sessions WHERE id = ?", id).await
}
async fn message_rows(pool: &SqlitePool, id: &str) -> i64 {
    count(
        pool,
        "SELECT COUNT(*) FROM messages WHERE session_id = ?",
        id,
    )
    .await
}
async fn fts_rows(pool: &SqlitePool, id: &str) -> i64 {
    count(
        pool,
        "SELECT COUNT(*) FROM messages_fts WHERE session_id = ?",
        id,
    )
    .await
}
async fn attachment_rows(pool: &SqlitePool, id: &str) -> i64 {
    count(
        pool,
        "SELECT COUNT(*) FROM message_attachments WHERE session_id = ?",
        id,
    )
    .await
}

/// The main chat as the desktop has it: created on the first ask with
/// the Chinese greeting, one exchange (with an image) and a segment
/// boundary. Its id.
async fn main_chat(pool: &SqlitePool, galley: &SqliteGalley, disk: &Disk) -> String {
    let rec = Recorder::default();
    let main = Writes::new(galley, &rec, VIA_GUI)
        .get_or_create_main_chat(Origin::desktop(), Some("zh-CN"))
        .await
        .expect("main chat")
        .into_brief()
        .id
        .0;
    let (message, _) = exchange(galley, &main, "记住：我喜欢喝茶", "好的，记下了").await;
    attach(pool, disk, &main, &message).await;
    galley
        .record_main_chat_segment(&SessionId(main.clone()), 1)
        .await
        .expect("segment");
    main
}

/// A subtask of `parent` with its first message (and an image on it);
/// the first message's id.
async fn subtask(
    pool: &SqlitePool,
    galley: &SqliteGalley,
    disk: &Disk,
    parent: &str,
    id: &str,
    ordinal: i64,
) -> String {
    let (_, message) = galley
        .create_subtask_session(
            input(id),
            Origin::subtask(),
            &SessionId(parent.into()),
            Some(format!("子任务 {id} 要做的事")),
        )
        .await
        .expect("subtask");
    let message = message.expect("first message").id.0;
    attach(pool, disk, id, &message).await;
    galley
        .record_subtask_dispatch(&SubtaskDispatch {
            parent_session_id: parent.into(),
            turn_index: 0,
            ordinal,
            message_id: SubtaskDispatch::reply_message_id(parent, 0),
            session_id: Some(id.into()),
            title: format!("子任务 {id}"),
            failure: None,
            failure_detail: None,
            created_at: "2026-10-14T00:00:00Z".into(),
            send_backs: 0,
        })
        .await
        .expect("dispatch record");
    message
}

const LIVE: &str = "s-live-sub";
const ARCHIVED: &str = "s-archived-sub";
const PROMOTED: &str = "s-promoted-sub";
const OTHER: &str = "s-other";

/// A main chat with three subtasks (one live, one archived, one the user
/// wrote in) and another conversation; the main chat's id.
async fn populated(pool: &SqlitePool, galley: &SqliteGalley, disk: &Disk) -> String {
    let main = main_chat(pool, galley, disk).await;
    subtask(pool, galley, disk, &main, LIVE, 0).await;
    subtask(pool, galley, disk, &main, ARCHIVED, 1).await;
    galley
        .archive_session(SessionId(ARCHIVED.into()), Origin::desktop())
        .await
        .expect("archive");
    subtask(pool, galley, disk, &main, PROMOTED, 2).await;
    exchange(galley, PROMOTED, "我来补一句", "好").await;
    galley
        .promote_subtask(&SessionId(PROMOTED.into()))
        .await
        .expect("promote")
        .expect("promoted");
    galley
        .create_session(input(OTHER), Origin::desktop())
        .await
        .expect("other session");
    let (message, _) = exchange(galley, OTHER, "另一件事", "嗯").await;
    attach(pool, disk, OTHER, &message).await;
    main
}

async fn reset(
    galley: &SqliteGalley,
    runner: &Runner,
    rec: &Recorder,
    disk: &Disk,
    language: Option<&str>,
) -> Result<galley_core_lib::api::SessionBrief, ResetMainChatError> {
    reset_seen(galley, runner, &Starter::default(), rec, disk, language).await
}

/// [`reset`], with the runner starts it asks for recorded in `starter`.
async fn reset_seen(
    galley: &SqliteGalley,
    runner: &Runner,
    starter: &Starter,
    rec: &Recorder,
    disk: &Disk,
    language: Option<&str>,
) -> Result<galley_core_lib::api::SessionBrief, ResetMainChatError> {
    reset_main_chat(galley, runner, starter, rec, &disk.paths, language).await
}

// ---------------- what goes, what stays ----------------

#[tokio::test]
async fn a_reset_clears_the_main_chat_its_subtasks_its_memory_and_the_backups() {
    let (pool, galley) = fresh("managed").await;
    let disk = Disk::new();
    let main = populated(&pool, &galley, &disk).await;
    let seed = tree(&disk.paths.memory_seed_dir);
    let temp_before = tree(&disk.temp_dir);
    // What the reset is about to delete is really there.
    for id in [main.as_str(), LIVE, ARCHIVED] {
        assert!(message_rows(&pool, id).await > 0, "{id}");
        assert!(fts_rows(&pool, id).await > 0, "{id}");
        assert_eq!(attachment_rows(&pool, id).await, 1, "{id}");
        assert!(disk.paths.attachments_root.join(id).is_dir(), "{id}");
    }
    assert_ne!(tree(&disk.paths.memory_dir), seed);

    // A held queue (no run open) in the main chat and in another
    // conversation: not a run, so no refusal.
    let runner = Runner::default();
    runner.queue(&main, "qm_main");
    runner.queue(OTHER, "qm_other");
    let rec = Recorder::default();
    let starter = Starter::default();
    let created = reset_seen(&galley, &runner, &starter, &rec, &disk, Some("zh-CN"))
        .await
        .expect("reset");

    // The main chat and its unpromoted subtasks, archived one included:
    // rows, messages, search rows, attachment rows and files, segments,
    // dispatch records.
    for id in [main.as_str(), LIVE, ARCHIVED] {
        assert_eq!(session_rows(&pool, id).await, 0, "{id}");
        assert_eq!(message_rows(&pool, id).await, 0, "{id}");
        assert_eq!(fts_rows(&pool, id).await, 0, "{id}");
        assert_eq!(attachment_rows(&pool, id).await, 0, "{id}");
        assert!(!disk.paths.attachments_root.join(id).exists(), "{id}");
    }
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM main_chat_segments WHERE session_id = ?",
            &main
        )
        .await,
        0
    );
    assert_eq!(
        count(
            &pool,
            "SELECT COUNT(*) FROM subtask_dispatches WHERE parent_session_id = ?",
            &main
        )
        .await,
        0
    );

    // The promoted subtask is an ordinary conversation now: kept, with
    // its messages and image, its parent gone (SET NULL).
    let promoted = galley
        .session_brief(SessionId(PROMOTED.into()))
        .await
        .expect("promoted subtask stays");
    assert_eq!(promoted.parent_session_id, None);
    assert_eq!(message_rows(&pool, PROMOTED).await, 3);
    assert_eq!(attachment_rows(&pool, PROMOTED).await, 1);
    assert!(disk.paths.attachments_root.join(PROMOTED).is_dir());
    // Other conversations are untouched.
    assert_eq!(message_rows(&pool, OTHER).await, 2);
    assert_eq!(attachment_rows(&pool, OTHER).await, 1);
    assert!(fts_rows(&pool, OTHER).await > 0);
    assert!(disk.paths.attachments_root.join(OTHER).is_dir());

    // A new main chat, only the greeting in it, in the UI language.
    assert_ne!(created.id.0, main);
    assert_eq!(created.main_chat, Some(true));
    assert_eq!(
        galley.main_chat_id().await.unwrap(),
        Some(created.id.clone())
    );
    let messages = galley
        .session_messages(created.id.clone(), None)
        .await
        .expect("messages");
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].role, MessageRole::Agent);
    assert_eq!(messages[0].content, MAIN_CHAT_GREETING_ZH);

    // The memory is the seed: its files all there, the rest (GA's
    // global_mem* included) gone, nothing set aside left behind.
    assert_eq!(tree(&disk.paths.memory_dir), seed);
    assert!(!disk.paths.memory_dir.join("global_mem.txt").exists());
    assert!(!disk
        .paths
        .memory_dir
        .join("global_mem_insight.txt")
        .exists());
    let mut state: Vec<String> = fs::read_dir(disk.paths.memory_dir.parent().unwrap())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    state.sort();
    assert_eq!(state, ["memory", "temp"]);
    // Files it made for you, and its own logs, stay.
    assert_eq!(tree(&disk.temp_dir), temp_before);

    // Every backup gone; the data directory itself stays.
    assert!(disk.backups.iter().all(|b| !b.exists()));
    assert_eq!(
        fs::read_to_string(disk.paths.data_dir.join("workbench.db")).unwrap(),
        "the live database"
    );

    // Runners closed for the deleted sessions only; the deleted main
    // chat's queued draft dropped, the other conversation's kept.
    let mut expected = vec![main.clone(), LIVE.to_string(), ARCHIVED.to_string()];
    expected.sort();
    assert_eq!(runner.closed(), expected);
    assert_eq!(
        *runner.dropped.lock().unwrap(),
        [(main.clone(), "qm_main".to_string())]
    );
    assert_eq!(runner.queues.lock().unwrap()[OTHER].len(), 1);

    // Broadcast: each deletion, then the new main chat.
    let events = rec.sessions();
    let created_at = events
        .iter()
        .position(|e| e == &("session-created-external".to_string(), created.id.0.clone()))
        .expect("new main chat announced");
    let mut deleted: Vec<String> = events[..created_at]
        .iter()
        .filter(|(name, _)| name == "session-deleted-external")
        .map(|(_, id)| id.clone())
        .collect();
    deleted.sort();
    assert_eq!(deleted, expected);
    assert_eq!(events.len(), expected.len() + 1, "{events:?}");
    assert!(rec
        .events
        .lock()
        .unwrap()
        .iter()
        .all(|(_, payload)| payload["via"] == VIA_GUI));

    // The new main chat's runner, asked for once: GA writes its memory
    // files from the templates when a runner starts.
    assert_eq!(starter.started(), [created.id.0.clone()]);
}

#[tokio::test]
async fn the_new_main_chat_greets_in_the_ui_language() {
    let (pool, galley) = fresh("managed").await;
    let disk = Disk::new();
    main_chat(&pool, &galley, &disk).await;

    let created = reset(
        &galley,
        &Runner::default(),
        &Recorder::default(),
        &disk,
        Some("en-US"),
    )
    .await
    .expect("reset");

    let messages = galley.session_messages(created.id, None).await.unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].content, MAIN_CHAT_GREETING_EN);
}

// ---------------- refusals change nothing ----------------

/// What a refused or failed reset must leave exactly as it was.
struct Snapshot {
    main_chat: Option<SessionId>,
    sessions: i64,
    messages: i64,
    memory: BTreeMap<PathBuf, Vec<u8>>,
    attachments: BTreeMap<PathBuf, Vec<u8>>,
    backups: usize,
}

async fn snapshot(pool: &SqlitePool, galley: &SqliteGalley, disk: &Disk) -> Snapshot {
    Snapshot {
        main_chat: galley.main_chat_id().await.unwrap(),
        sessions: sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(pool)
            .await
            .unwrap(),
        messages: sqlx::query_scalar("SELECT COUNT(*) FROM messages")
            .fetch_one(pool)
            .await
            .unwrap(),
        memory: tree(&disk.paths.memory_dir),
        attachments: tree(&disk.paths.attachments_root),
        backups: disk.backups.iter().filter(|b| b.is_dir()).count(),
    }
}

fn assert_unchanged(before: &Snapshot, after: &Snapshot) {
    assert_eq!(after.main_chat, before.main_chat);
    assert_eq!(after.sessions, before.sessions);
    assert_eq!(after.messages, before.messages);
    assert_eq!(after.memory, before.memory);
    assert_eq!(after.attachments, before.attachments);
    assert_eq!(after.backups, before.backups);
}

#[tokio::test]
async fn a_reset_is_refused_while_any_conversation_runs() {
    let (pool, galley) = fresh("managed").await;
    let disk = Disk::new();
    populated(&pool, &galley, &disk).await;
    let before = snapshot(&pool, &galley, &disk).await;

    // A run open (dispatched, not complete) or a turn going, in any
    // session.
    for state in [
        RunState {
            open_run: true,
            ..RunState::default()
        },
        RunState {
            agent_running: true,
            ..RunState::default()
        },
    ] {
        let runner = Runner::with_state(OTHER, state);
        let rec = Recorder::default();
        let starter = Starter::default();
        let err = reset_seen(&galley, &runner, &starter, &rec, &disk, None)
            .await
            .expect_err("refused");
        assert!(
            matches!(&err, ResetMainChatError::Running { detail } if detail.contains(OTHER)),
            "{err:?}"
        );
        assert!(runner.closed().is_empty());
        assert!(starter.started().is_empty());
        assert!(rec.sessions().is_empty());
        assert_unchanged(&before, &snapshot(&pool, &galley, &disk).await);
    }

    // An idle runner, a question waiting for an answer, a held queue:
    // nothing runs.
    let runner = Runner::with_state(
        OTHER,
        RunState {
            runner_alive: true,
            ask_pending: true,
            queued_count: 1,
            ..RunState::default()
        },
    );
    reset(&galley, &runner, &Recorder::default(), &disk, None)
        .await
        .expect("nothing runs");
}

#[tokio::test]
async fn a_reset_is_refused_on_the_external_runtime() {
    let (pool, galley) = fresh("managed").await;
    let disk = Disk::new();
    populated(&pool, &galley, &disk).await;
    galley
        .set_pref_json("active_runtime_kind", json!("external"))
        .await
        .unwrap();
    let before = snapshot(&pool, &galley, &disk).await;

    let runner = Runner::default();
    let rec = Recorder::default();
    let starter = Starter::default();
    let err = reset_seen(&galley, &runner, &starter, &rec, &disk, None)
        .await
        .expect_err("refused");

    assert!(
        matches!(err, ResetMainChatError::NotManaged { .. }),
        "{err:?}"
    );
    assert!(runner.closed().is_empty());
    assert!(starter.started().is_empty());
    assert!(rec.sessions().is_empty());
    assert_unchanged(&before, &snapshot(&pool, &galley, &disk).await);
}

#[tokio::test]
async fn a_reset_without_a_main_chat_is_refused() {
    let (pool, galley) = fresh("managed").await;
    let disk = Disk::new();
    let before = snapshot(&pool, &galley, &disk).await;

    let starter = Starter::default();
    let err = reset_seen(
        &galley,
        &Runner::default(),
        &starter,
        &Recorder::default(),
        &disk,
        None,
    )
    .await
    .expect_err("refused");

    assert!(
        matches!(err, ResetMainChatError::NoMainChat { .. }),
        "{err:?}"
    );
    assert!(starter.started().is_empty());
    assert_unchanged(&before, &snapshot(&pool, &galley, &disk).await);
}

#[tokio::test]
async fn a_reset_with_a_broken_seed_changes_nothing() {
    let (pool, galley) = fresh("managed").await;
    let disk = Disk::new();
    populated(&pool, &galley, &disk).await;
    fs::remove_file(disk.paths.memory_seed_dir.join("plan_sop.md")).unwrap();
    let before = snapshot(&pool, &galley, &disk).await;

    let rec = Recorder::default();
    let starter = Starter::default();
    let err = reset_seen(&galley, &Runner::default(), &starter, &rec, &disk, None)
        .await
        .expect_err("failed");

    assert!(
        matches!(&err, ResetMainChatError::Failed { detail } if detail.contains("nothing was deleted")),
        "{err:?}"
    );
    assert!(rec.sessions().is_empty());
    assert!(starter.started().is_empty());
    assert_unchanged(&before, &snapshot(&pool, &galley, &disk).await);
}

/// The copy itself failing half way (a seed file it cannot read), not
/// just a missing seed: memory/ comes back as it was and no row goes.
#[cfg(unix)]
#[tokio::test]
async fn a_failed_memory_copy_changes_nothing() {
    use std::os::unix::fs::PermissionsExt;

    let (pool, galley) = fresh("managed").await;
    let disk = Disk::new();
    populated(&pool, &galley, &disk).await;
    let unreadable = disk.paths.memory_seed_dir.join("zz_unreadable_sop.md");
    write(&unreadable, "cannot be read");
    fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000)).unwrap();
    if fs::read(&unreadable).is_ok() {
        // Running as root: permissions do not stop it, nothing to test.
        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o644)).unwrap();
        return;
    }
    let before = snapshot(&pool, &galley, &disk).await;

    let rec = Recorder::default();
    let starter = Starter::default();
    let err = reset_seen(&galley, &Runner::default(), &starter, &rec, &disk, None)
        .await
        .expect_err("failed");
    fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o644)).unwrap();

    assert!(
        matches!(&err, ResetMainChatError::Failed { detail } if detail.contains("back as it was")),
        "{err:?}"
    );
    assert!(rec.sessions().is_empty());
    assert!(starter.started().is_empty());
    assert_unchanged(&before, &snapshot(&pool, &galley, &disk).await);
    let mut state: Vec<String> = fs::read_dir(disk.paths.memory_dir.parent().unwrap())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    state.sort();
    assert_eq!(state, ["memory", "temp"]);
}

/// The runner start is the reset's last ask, not part of its answer: one
/// that fails or never ends neither fails nor holds up the reset.
#[tokio::test]
async fn a_runner_start_that_fails_or_hangs_holds_nothing_up() {
    for ends in [StartEnds::Fails, StartEnds::Hangs] {
        let (pool, galley) = fresh("managed").await;
        let disk = Disk::new();
        main_chat(&pool, &galley, &disk).await;
        let starter = Starter::ending(ends);

        let created = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            reset_seen(
                &galley,
                &Runner::default(),
                &starter,
                &Recorder::default(),
                &disk,
                None,
            ),
        )
        .await
        .expect("the reset answers without waiting for the runner")
        .expect("reset");

        assert_eq!(starter.started(), [created.id.0.clone()]);
        assert_eq!(
            galley.main_chat_id().await.unwrap(),
            Some(created.id.clone())
        );
        assert!(disk.backups.iter().all(|b| !b.exists()));
    }
}

#[tokio::test]
async fn a_second_reset_starts_from_the_new_main_chat() {
    let (pool, galley) = fresh("managed").await;
    let disk = Disk::new();
    main_chat(&pool, &galley, &disk).await;
    let rec = Recorder::default();
    let first = reset(&galley, &Runner::default(), &rec, &disk, None)
        .await
        .expect("first reset");
    rec.clear();

    let second = reset(&galley, &Runner::default(), &rec, &disk, None)
        .await
        .expect("second reset");

    assert_ne!(second.id, first.id);
    assert_eq!(session_rows(&pool, first.id.as_str()).await, 0);
    assert_eq!(
        rec.sessions(),
        [
            ("session-deleted-external".to_string(), first.id.0.clone()),
            ("session-created-external".to_string(), second.id.0.clone()),
        ]
    );
}

// ---------------- the database file ----------------

/// On a database file in WAL mode, as Core opens `workbench.db`, the
/// deleted main chat's text is gone from the bytes on disk afterwards —
/// rows, search index and WAL alike — while another conversation's text
/// is still there.
#[tokio::test]
async fn the_deleted_text_leaves_no_trace_in_the_database_file() {
    use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};

    let disk = Disk::new();
    let db = disk.tmp.path().join("compact").join("workbench.db");
    fs::create_dir_all(db.parent().unwrap()).unwrap();
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&db)
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .busy_timeout(std::time::Duration::from_secs(5)),
        )
        .await
        .expect("open file db");
    galley_core_lib::apply_all_migrations_for_tests(&pool)
        .await
        .expect("migrate");
    let galley = SqliteGalley::from_pool(pool.clone());
    galley
        .set_pref_json("active_runtime_kind", json!("managed"))
        .await
        .unwrap();
    let main = main_chat(&pool, &galley, &disk).await;
    const SECRET: &str = "secret-ledger-7f3a9c-my-bank-pin";
    const KEPT: &str = "kept-note-2b8d41-other-chat";
    exchange(&galley, &main, SECRET, SECRET).await;
    galley
        .create_session(input(OTHER), Origin::desktop())
        .await
        .unwrap();
    exchange(&galley, OTHER, KEPT, KEPT).await;
    let on_disk = |needle: &str| {
        ["workbench.db", "workbench.db-wal"].iter().any(|name| {
            let bytes = fs::read(db.with_file_name(name)).unwrap_or_default();
            bytes
                .windows(needle.len())
                .any(|window| window == needle.as_bytes())
        })
    };
    assert!(on_disk(SECRET), "the text is on disk before the reset");

    reset(
        &galley,
        &Runner::default(),
        &Recorder::default(),
        &disk,
        None,
    )
    .await
    .expect("reset");

    assert!(!on_disk(SECRET), "the deleted text is gone from the file");
    assert!(on_disk(KEPT), "another conversation's text stays");
    pool.close().await;
}

#[tokio::test]
async fn the_database_half_deletes_only_the_main_chat() {
    let (pool, galley) = fresh("managed").await;
    let disk = Disk::new();
    let main = populated(&pool, &galley, &disk).await;

    for id in [OTHER, PROMOTED, LIVE, "s-missing"] {
        let err = galley
            .delete_main_chat_for_reset(&SessionId(id.into()))
            .await
            .expect_err("not the main chat");
        assert!(err.to_string().contains("not the main chat"), "{err}");
    }
    for id in [main.as_str(), LIVE, ARCHIVED, PROMOTED, OTHER] {
        assert_eq!(session_rows(&pool, id).await, 1, "{id}");
    }

    let deletion = galley
        .delete_main_chat_for_reset(&SessionId(main.clone()))
        .await
        .expect("delete");
    assert_eq!(deletion.main_chat.0, main);
    let mut subtasks: Vec<&str> = deletion.subtasks.iter().map(|s| s.as_str()).collect();
    subtasks.sort();
    assert_eq!(subtasks, [ARCHIVED, LIVE]);
}
