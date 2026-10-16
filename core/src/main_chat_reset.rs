//! Resetting the main chat (主聊天 ticket 15, PRD ruling 59): the way out
//! of a conversation that is meant to last.
//!
//! One action, no options. The main chat and the subtasks it dispatched
//! that never became ordinary conversations are deleted, and with them
//! every to-do Galley noted and its reminder (ticket 39), a new main chat
//! starts from its greeting, the engine's long-term memory
//! (`managed-ga-state/memory/`, shared by every conversation and IM
//! channel) goes back to the seed it was installed with, and the
//! pre-migration backups go too (each is a whole copy of the database and
//! the memory). It is a data exit, not a way to tidy context: there is
//! still no everyday reopen (ruling 14; segments carry the context).
//!
//! Desktop only: the `reset_main_chat` Tauri command. No socket command,
//! no CLI, no phone method, nothing a model can call. Core decides every
//! step (Rule 5); the page only asks, after a five-second hold.
//!
//! The steps, in order:
//!
//! 1. **Refuse**, changing nothing, unless the managed runtime is active,
//!    a main chat exists, and no conversation is running: no session the
//!    runner registry knows has its run gate open or a turn going
//!    (`RunState::open_run`, `agent_running`). Messages waiting in a held
//!    queue (after a crash, or behind an unanswered question) are not a
//!    run; a deleted session's are dropped with it. IM channels run their
//!    own engine processes outside that registry, so a turn in one is not
//!    seen here.
//! 2. **Close the runners** of the main chat and its unpromoted subtasks.
//!    The main chat's runner lives on while idle, holding the current
//!    segment in memory.
//! 3. **Swap `memory/` for the seed, staged**
//!    ([`managed_runtime::stage_memory_reset`]): the old one is set aside,
//!    not deleted. A failure here changes nothing.
//! 4. **Delete the rows** in one transaction
//!    ([`SqliteGalley::delete_main_chat_for_reset`]): the sessions, and
//!    the to-dos with their reminders' tasks. If it fails, the
//!    old `memory/` goes back and nothing changed. From here on the reset
//!    has happened: the set-aside memory is deleted, runners are closed
//!    once more for every deleted session (a send that slipped in
//!    meanwhile may have started one), and anything still queued for
//!    them is dropped.
//! 5. **Delete the attachment files** of the deleted sessions.
//! 6. **Broadcast** each deletion (the to-dos' too:
//!    [`TODOS_CHANGED_EVENT`] and [`SCHEDULED_TASKS_CHANGED_EVENT`]), then
//!    **create** the new main chat
//!    through the usual path, which announces it — deletions first, so no
//!    page ever holds two main chats.
//! 7. **Start the new main chat's runner**, in the background
//!    ([`RunnerStarter`]). GA writes `global_mem.txt` and
//!    `global_mem_insight.txt` from its templates only when a runner
//!    imports `agentmain`, while every live runner and IM process reads
//!    them on each turn: until a runner starts, those turns carry no
//!    memory section at all, and a model that wrote its own
//!    `global_mem_insight.txt` meanwhile would keep GA from ever writing
//!    the template one. The desktop lands on the new main chat without
//!    starting one (its first send would), so Core starts it here through
//!    the shared path (the one the desktop's `ensure_session_runner`
//!    takes; the page attaches on `runner-spawned-external`). Not
//!    awaited: the reset answers at once, a failure is logged.
//! 8. **Delete every pre-migration backup**, then **compact** the
//!    database ([`SqliteGalley::compact`]).
//!
//! Steps 3–4 swap the ticket's order (rows, then memory) on purpose:
//! staging the memory first means a failed copy leaves the conversation
//! untouched, instead of a half reset that cleared the chat but kept the
//! memory. After step 4 the clean-up (the set-aside memory, files,
//! backups, compaction) only logs its failures: the reset itself already
//! happened. Creating the new main chat is the one later step whose
//! failure is returned, and it says so (the page's next
//! `get_or_create_main_chat` creates one).

use std::fmt;
use std::future::Future;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;

use serde::Serialize;

use crate::api::{
    Origin, RuntimeKind, SessionBrief, SessionId, SCHEDULED_TASKS_CHANGED_EVENT,
    TODOS_CHANGED_EVENT,
};
use crate::db::{MainChatEnsured, SqliteGalley};
use crate::managed_runtime;
use crate::migration_backup;
use crate::notify::Notifier;
use crate::runner_manager::RunnerManager;
use crate::session_runner::{ensure_session_runner, EnsureOptions, RunnerHost};
use crate::session_writes::{announce_session_deleted, Writes, VIA_GUI};
use crate::socket_listener::RunnerPort;

/// `via` of the new main chat's `runner-spawned-external`.
pub const VIA_MAIN_CHAT_RESET: &str = "main-chat-reset";

/// Why a reset did not happen, or did not finish. On the Tauri wire it
/// is `{"error": "<tag>", "detail": "..."}`, like the runner errors: the
/// page tells `running` apart (it says what to wait for) and shows the
/// rest as a failure, with the detail to copy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "error", rename_all = "snake_case")]
pub enum ResetMainChatError {
    /// A conversation is running: a session's run gate is open or a
    /// turn is going. Nothing changed.
    Running { detail: String },
    /// The attached external GA is the active runtime. It has no main
    /// chat, and its files are not Galley's to touch (Rule 1). Nothing
    /// changed.
    NotManaged { detail: String },
    /// There is no main chat to reset. Nothing changed.
    NoMainChat { detail: String },
    /// Something failed; `detail` says what, and whether anything had
    /// changed by then.
    Failed { detail: String },
}

impl fmt::Display for ResetMainChatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Running { detail } => write!(f, "running: {detail}"),
            Self::NotManaged { detail } => write!(f, "not_managed: {detail}"),
            Self::NoMainChat { detail } => write!(f, "no_main_chat: {detail}"),
            Self::Failed { detail } => write!(f, "failed: {detail}"),
        }
    }
}

impl std::error::Error for ResetMainChatError {}

/// Where a reset reads and writes on disk. Passed in, so tests work on
/// temp dirs and never resolve the real data directory.
#[derive(Debug, Clone)]
pub struct ResetPaths {
    /// The memory seed the app was installed with
    /// (`managed-ga/state-seed/memory`).
    pub memory_seed_dir: PathBuf,
    /// The engine's long-term memory (`managed-ga-state/memory`).
    pub memory_dir: PathBuf,
    /// The data directory: its `app.galley.backup.*` siblings are the
    /// pre-migration backups.
    pub data_dir: PathBuf,
    /// `conversation-attachments/` next to `workbench.db`, one directory
    /// per session.
    pub attachments_root: PathBuf,
}

impl ResetPaths {
    /// The running app's paths, resolved as the code that writes each of
    /// them resolves it.
    pub fn for_app(app: &tauri::AppHandle) -> io::Result<Self> {
        let (memory_seed_dir, memory_dir) = managed_runtime::memory_paths_for_app(app)?;
        let data_dir = migration_backup::resolve_data_dir().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "app data directory unavailable")
        })?;
        let attachments_root =
            crate::app_paths::conversation_attachments_root().ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    "conversation attachment directory unavailable",
                )
            })?;
        Ok(Self {
            memory_seed_dir,
            memory_dir,
            data_dir,
            attachments_root,
        })
    }
}

/// A runner start the reset spawns and does not wait for.
pub type StartRunner = Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'static>>;

/// Starts the new main chat's runner after a reset (step 7). Behind a
/// trait so a test can see the ask without spawning an engine.
pub trait RunnerStarter: Send + Sync {
    /// The start of `session_id`'s runner, as a future the reset spawns
    /// in the background; its error is logged, never returned.
    fn start(&self, session_id: SessionId) -> StartRunner;
}

/// The app's [`RunnerStarter`]: the shared path the desktop's
/// `ensure_session_runner` command takes (spawn from the session's
/// persisted configuration, announce `runner-spawned-external`).
/// Deleting a main chat message uses it too (`crate::message_delete`).
pub struct AppRunnerStarter {
    pub app: tauri::AppHandle,
    pub galley: SqliteGalley,
    pub manager: Arc<RunnerManager>,
    /// `via` of the `runner-spawned-external` it announces
    /// ([`VIA_MAIN_CHAT_RESET`] for a reset).
    pub via: &'static str,
}

impl RunnerStarter for AppRunnerStarter {
    fn start(&self, session_id: SessionId) -> StartRunner {
        let app = self.app.clone();
        let galley = self.galley.clone();
        let manager = self.manager.clone();
        let via = self.via;
        Box::pin(async move {
            let host = RunnerHost {
                galley: &galley,
                runner: manager.as_ref(),
                notifier: crate::notify::TauriNotifier::new(app.clone()),
                env: Some(&app),
            };
            ensure_session_runner(
                &host,
                session_id.as_str(),
                EnsureOptions {
                    via,
                    active_session_id: Some(session_id.as_str()),
                    llm_override: None,
                    ga_config: None,
                    holds_run_gate: false,
                    timeouts: Default::default(),
                },
            )
            .await
            .map(|_| ())
            .map_err(|e| format!("{e:?}"))
        })
    }
}

/// Reset the main chat (see the module docs for the steps). Returns the
/// new main chat, which opens with the greeting in `language` (the UI
/// language the page resolved; English without one, as for
/// `get_or_create_main_chat`); its runner is being started by `starter`
/// when this returns.
pub async fn reset_main_chat(
    galley: &SqliteGalley,
    runner: &dyn RunnerPort,
    starter: &dyn RunnerStarter,
    notifier: &dyn Notifier,
    paths: &ResetPaths,
    language: Option<&str>,
) -> Result<SessionBrief, ResetMainChatError> {
    // 1. Refusals.
    let runtime = galley
        .active_runtime_kind()
        .await
        .map_err(|e| failed(format!("reading the active runtime failed: {e}")))?;
    if runtime != RuntimeKind::Managed {
        return Err(ResetMainChatError::NotManaged {
            detail: "the main chat exists only on the managed runtime".into(),
        });
    }
    let main = galley
        .main_chat_id()
        .await
        .map_err(|e| failed(format!("reading the main chat failed: {e}")))?
        .ok_or_else(|| ResetMainChatError::NoMainChat {
            detail: "there is no main chat to reset".into(),
        })?;
    if let Some(running) = first_running_session(runner).await {
        return Err(ResetMainChatError::Running {
            detail: format!("session {running} is running"),
        });
    }
    let subtasks = galley
        .unpromoted_subtask_ids(&main)
        .await
        .map_err(|e| failed(format!("reading the main chat's subtasks failed: {e}")))?;

    // 2. Their runners.
    let mut doomed = subtasks;
    doomed.push(main.clone());
    shut_down(runner, &doomed).await;

    // 3. The memory, staged.
    let staged = managed_runtime::stage_memory_reset(&paths.memory_seed_dir, &paths.memory_dir)
        .map_err(|e| {
            failed(format!(
                "putting the memory back to the seed failed, nothing was deleted: {e}"
            ))
        })?;

    // 4. The rows. Past this point the reset has happened.
    let deletion = match galley.delete_main_chat_for_reset(&main).await {
        Ok(deletion) => deletion,
        Err(e) => {
            let memory = match staged.rollback() {
                Ok(()) => "the memory is back as it was".to_string(),
                Err(re) => format!("putting the memory back failed too: {re}"),
            };
            return Err(failed(format!(
                "deleting the main chat failed, nothing was deleted ({memory}): {e}"
            )));
        }
    };
    if let Err(e) = staged.commit() {
        eprintln!("[main-chat-reset] deleting the old memory failed: {e}");
    }
    let deleted: Vec<SessionId> = deletion.session_ids().cloned().collect();
    shut_down(runner, &deleted).await;
    drop_queued(runner, &deleted).await;

    // 5. Attachment files.
    for id in &deleted {
        remove_attachment_dir(&paths.attachments_root, id);
    }

    // 6. Deletions out, then the new main chat in.
    for id in &deleted {
        announce_session_deleted(notifier, id, VIA_GUI);
    }
    if deletion.todos > 0 {
        crate::notify::notify(notifier, TODOS_CHANGED_EVENT, &());
        crate::notify::notify(notifier, SCHEDULED_TASKS_CHANGED_EVENT, &());
    }
    let created = Writes::new(galley, notifier, VIA_GUI)
        .get_or_create_main_chat(Origin::desktop(), language)
        .await
        .map(MainChatEnsured::into_brief)
        .map_err(|e| {
            failed(format!(
                "the main chat was reset, but creating the new one failed: {e}"
            ))
        })?;

    // 7. Its runner, in the background.
    let start = starter.start(created.id.clone());
    let new_id = created.id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = start.await {
            eprintln!("[main-chat-reset] starting the runner of {new_id} failed: {e}");
        }
    });

    // 8. Backups, then the database file.
    let backups = migration_backup::delete_all_backups_in(&paths.data_dir);
    for (path, e) in &backups.failed {
        eprintln!(
            "[main-chat-reset] deleting backup {} failed: {e}",
            path.display()
        );
    }
    if let Err(e) = galley.compact().await {
        eprintln!("[main-chat-reset] compacting the database failed: {e}");
    }
    eprintln!(
        "[main-chat-reset] reset: deleted {} session(s), {} backup(s); new main chat {}",
        deleted.len(),
        backups.removed.len(),
        created.id
    );
    Ok(created)
}

fn failed(detail: String) -> ResetMainChatError {
    ResetMainChatError::Failed { detail }
}

/// The first session with a run going: its run gate open (a message
/// dispatched, its run not complete) or a turn in progress. The run gate
/// is what every dispatch opens (`RunnerManager::send_command`), so a
/// GUI, phone, CLI, scheduled or subtask run all count. Queued messages
/// alone do not: with no run open, nothing will dispatch them (a crashed
/// runner holds its queue, an unanswered question holds the drain).
/// Sessions the registry does not know are idle by construction.
async fn first_running_session(runner: &dyn RunnerPort) -> Option<String> {
    for id in runner.known_session_ids().await {
        let state = runner.run_state(&id).await;
        if state.open_run || state.agent_running {
            return Some(id);
        }
    }
    None
}

/// Drop what is still queued for deleted sessions. A queued message is
/// an unsent draft (never written to the database), and its session is
/// gone; left behind, it would keep the session listed with a queue
/// (`sessions.run_state`).
async fn drop_queued(runner: &dyn RunnerPort, ids: &[SessionId]) {
    for id in ids {
        for item in runner.queue_snapshot(id.as_str()).await {
            runner.queue_remove(id.as_str(), &item.queue_id).await;
        }
    }
}

/// Close the runners of `ids`, concurrently. A session without one is
/// fine; another failure is logged (the manager kills what does not exit
/// in time).
async fn shut_down(runner: &dyn RunnerPort, ids: &[SessionId]) {
    let results =
        futures_util::future::join_all(ids.iter().map(|id| runner.shutdown(id.as_str(), None)))
            .await;
    for (id, result) in ids.iter().zip(results) {
        match result {
            Ok(()) | Err(crate::runner_manager::ShutdownError::NotFound { .. }) => {}
            Err(e) => eprintln!("[main-chat-reset] closing the runner of {id} failed: {e}"),
        }
    }
}

/// Delete one session's attachment directory under `root`. Only for an
/// id that is one plain path component, so no id can point the delete
/// anywhere else.
fn remove_attachment_dir(root: &Path, id: &SessionId) {
    let mut components = Path::new(id.as_str()).components();
    let single = matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(_)), None)
    );
    if !single {
        eprintln!("[main-chat-reset] not deleting attachments of odd session id {id:?}");
        return;
    }
    match std::fs::remove_dir_all(root.join(id.as_str())) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => eprintln!("[main-chat-reset] deleting the attachments of {id} failed: {e}"),
    }
}
