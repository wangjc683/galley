//! Core's session, project and scheduled-task writes, each broadcast
//! once (ticket 02d, `.scratch/ios-client/issues/02-core-send-takeover.md`).
//!
//! The desktop and, through the remote module, a phone must show the same
//! sessions: the list, titles, pins, projects, unread, model, reasoning
//! effort. Until 02d only the socket's writes (CLI / supervisor) were
//! broadcast; the GUI's own writes went through Tauri commands that changed
//! the database and nothing else, so no other frontend heard of them.
//! Every such write now goes through [`Writes`]: it writes the database,
//! takes the row back, and broadcasts it through the [`Notifier`] exactly
//! once. Socket handlers and Tauri commands call the same method, so
//! neither can forget the broadcast or send it twice. `via` names who
//! wrote (`"gui"` for the GUI, the socket command name for the socket).
//!
//! | Write | Event |
//! |---|---|
//! | create a session; the main chat's first ask | `session-created-external` |
//! | rename, pin, reasoning effort, unread, model | `session-updated-external` |
//! | archive / unarchive (bulk: one event per session it changed); an archived main chat's ask | `session-archived-external` / `session-unarchived-external` |
//! | delete, bulk delete, empty-session and demo sweeps (one per session) | `session-deleted-external` `{ sessionId, via }` |
//! | reset the main chat (`crate::main_chat_reset`): the old one and its unpromoted subtasks, then the new one | `session-deleted-external` per session, then `session-created-external` |
//! | move to a project | `session-moved-external` |
//! | create / update / delete a project | `project-created-external` / `project-updated-external` / `project-deleted-external` |
//! | create / update / delete a scheduled task | `scheduled-tasks:changed` (empty payload) |
//! | create / update / tick off / untick / cancel a to-do, cancel its reminder | `todos:changed` (empty payload), and `scheduled-tasks:changed` unless unticking |
//!
//! Session events carry [`SessionBriefEvent`], not [`SessionBrief`]: the
//! brief is also the CLI's JSON output and skips `None` fields, so a
//! cleared field (reasoning effort back to the model's own, a session
//! moved out of its project) would look the same as "not sent". The event
//! form writes every optional field, `null` when empty. Project events
//! likewise carry [`ProjectBriefEvent`]. These are Tauri events for the
//! GUI and, later, the phone — not the Agent API.
//!
//! The GUI still updates its stores before it calls a write (ticket 02e,
//! which applies a page's own writes from these events and drops its echo
//! by `clientRequestId`, waits for P1), so a page receives the broadcast
//! of its own write, and applying it must change nothing — see the GUI's
//! `applyExternalSession*`.
//!
//! **The main chat** (主聊天, `.scratch/main-chat` ticket 02) cannot be
//! archived or deleted from the desktop: [`Writes::protecting_main_chat`]
//! turns that guard on, and the GUI's Tauri commands always use it. The
//! socket's older writes (`session archive` and the rest) do not, on
//! purpose — refusing an existing `session archive` would change what an
//! existing command does inside a schema version (Rule 3). The commands
//! added with the main chat in place (ticket 35: `session rename / pin /
//! unpin / delete`, `project archive-sessions`) refuse or spare it from
//! the start, through [`refuse_main_chat`] and the same guard.

use crate::api::{
    CreateProjectInput, CreateScheduledTaskInput, CreateSessionInput, CreateTodoInput, GalleyApi,
    Origin, ProjectBrief, ProjectId, ProjectPatch, RuntimeKind, ScheduledTaskBrief,
    ScheduledTaskId, ScheduledTaskPatch, SessionBrief, SessionFilter, SessionId, SessionStatus,
    TodoBrief, TodoId, TodoPatch, MAIN_CHAT_PROTECTED, SCHEDULED_TASKS_CHANGED_EVENT,
    TODOS_CHANGED_EVENT,
};
use crate::db::{
    main_chat_greeting, MainChatEnsured, MainChatSeed, RenameTitleSource, SqliteGalley,
};
use crate::error::{GalleyError, Result};
use crate::ipc::{IpcCommand, SetLlmCommand, SetReasoningEffortCommand};
use crate::notify::{notify, Notifier};
use crate::socket_listener::RunnerPort;
use serde::Serialize;

pub const SESSION_CREATED_EXTERNAL_EVENT: &str = "session-created-external";
pub const SESSION_UPDATED_EXTERNAL_EVENT: &str = "session-updated-external";
pub const SESSION_ARCHIVED_EXTERNAL_EVENT: &str = "session-archived-external";
pub const SESSION_UNARCHIVED_EXTERNAL_EVENT: &str = "session-unarchived-external";
pub const SESSION_MOVED_EXTERNAL_EVENT: &str = "session-moved-external";
pub const SESSION_DELETED_EXTERNAL_EVENT: &str = "session-deleted-external";
pub const PROJECT_CREATED_EXTERNAL_EVENT: &str = "project-created-external";
pub const PROJECT_UPDATED_EXTERNAL_EVENT: &str = "project-updated-external";
pub const PROJECT_DELETED_EXTERNAL_EVENT: &str = "project-deleted-external";

/// `via` of the GUI's own writes (Tauri commands).
pub const VIA_GUI: &str = "gui";

/// A session row as Core's events carry it: [`SessionBrief`] with every
/// optional field written out, `null` when empty, so a page can tell a
/// cleared field from one an older payload did not send.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBriefEvent {
    pub id: SessionId,
    pub project_id: Option<String>,
    pub title: String,
    pub status: SessionStatus,
    pub summary: Option<String>,
    pub turn_count: Option<u32>,
    pub last_activity_at: String,
    pub created_at: String,
    pub updated_at: String,
    pub pinned: Option<bool>,
    pub has_unread: Option<bool>,
    pub origin: Option<Origin>,
    pub selected_llm_index: Option<u32>,
    pub selected_llm_key: Option<String>,
    pub selected_llm_display_name: Option<String>,
    pub runtime_kind: RuntimeKind,
    pub runtime_label: String,
    pub ga_runtime_kind: RuntimeKind,
    pub ga_runtime_id: Option<String>,
    pub prompt_profile: Option<String>,
    pub reasoning_effort: Option<String>,
    pub main_chat: Option<bool>,
    pub parent_session_id: Option<String>,
    pub promoted: Option<bool>,
}

impl From<SessionBrief> for SessionBriefEvent {
    fn from(brief: SessionBrief) -> Self {
        // Exhaustive on purpose: a field added to the brief must be
        // added here too, or this stops compiling.
        let SessionBrief {
            id,
            project_id,
            title,
            status,
            summary,
            turn_count,
            last_activity_at,
            created_at,
            updated_at,
            pinned,
            has_unread,
            origin,
            selected_llm_index,
            selected_llm_key,
            selected_llm_display_name,
            runtime_kind,
            runtime_label,
            ga_runtime_kind,
            ga_runtime_id,
            prompt_profile,
            reasoning_effort,
            main_chat,
            parent_session_id,
            promoted,
        } = brief;
        Self {
            id,
            project_id,
            title,
            status,
            summary,
            turn_count,
            last_activity_at,
            created_at,
            updated_at,
            pinned,
            has_unread,
            origin,
            selected_llm_index,
            selected_llm_key,
            selected_llm_display_name,
            runtime_kind,
            runtime_label,
            ga_runtime_kind,
            ga_runtime_id,
            prompt_profile,
            reasoning_effort,
            main_chat,
            parent_session_id,
            promoted,
        }
    }
}

/// Payload of every `session-*-external` event but the delete.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEventPayload {
    pub session: SessionBriefEvent,
    /// Who wrote: `"gui"`, a socket command (`"session.archive"`), or a
    /// Core task (`"title-derive"`, `"auto-title"`, `"turn-persist"`).
    pub via: &'static str,
}

/// Payload of `session-deleted-external`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDeletedPayload {
    pub session_id: String,
    pub via: &'static str,
}

/// A project row as Core's events carry it — [`ProjectBrief`] with the
/// optional fields written out (`null` when empty).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBriefEvent {
    pub id: ProjectId,
    pub name: String,
    pub root_path: Option<String>,
    pub workspace_enabled: bool,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub pinned: bool,
    pub last_activity_at: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<ProjectBrief> for ProjectBriefEvent {
    fn from(brief: ProjectBrief) -> Self {
        let ProjectBrief {
            id,
            name,
            root_path,
            workspace_enabled,
            icon,
            color,
            pinned,
            last_activity_at,
            created_at,
            updated_at,
        } = brief;
        Self {
            id,
            name,
            root_path,
            workspace_enabled,
            icon,
            color,
            pinned,
            last_activity_at,
            created_at,
            updated_at,
        }
    }
}

/// Payload of `project-created-external` / `project-updated-external`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEventPayload {
    pub project: ProjectBriefEvent,
    pub via: &'static str,
}

/// Payload of `project-deleted-external` (the socket's shape since B4
/// M1.3), and what [`Writes::delete_project`] returns. The project's
/// sessions survive with their `project_id` set to NULL (FK `SET NULL`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeletedPayload {
    pub project_id: String,
    /// Number of sessions whose `project_id` was just set to NULL.
    pub detached_sessions: u32,
    pub detached_session_ids: Vec<String>,
}

/// Broadcast a session row as `event` (one of the `session-*-external`
/// events) — for writers outside [`Writes`] that own their own write:
/// socket `session.new`, the derived and the auto title, a turn's session
/// bump (`crate::turn_persistence`, `via: "turn-persist"`).
pub fn announce_session(
    notifier: &dyn Notifier,
    event: &str,
    session: SessionBrief,
    via: &'static str,
) {
    notify(
        notifier,
        event,
        &SessionEventPayload {
            session: session.into(),
            via,
        },
    );
}

/// Broadcast a session's deletion (`session-deleted-external`) — for a
/// writer outside [`Writes`] that owns its own delete: resetting the main
/// chat (`crate::main_chat_reset`, ticket 15).
pub fn announce_session_deleted(
    notifier: &dyn Notifier,
    session_id: &SessionId,
    via: &'static str,
) {
    notify(
        notifier,
        SESSION_DELETED_EXTERNAL_EVENT,
        &SessionDeletedPayload {
            session_id: session_id.0.clone(),
            via,
        },
    );
}

/// `Err(invalid_args)`, its message prefixed [`MAIN_CHAT_PROTECTED`], when
/// `id` is the main chat. The guard of [`Writes::protecting_main_chat`],
/// and of the socket's own main chat refusals (`session rename / pin /
/// unpin / delete`, main chat ticket 35), which apply whatever the
/// caller.
pub async fn refuse_main_chat(galley: &SqliteGalley, id: &SessionId, action: &str) -> Result<()> {
    if galley.main_chat_id().await?.as_ref() == Some(id) {
        return Err(GalleyError::InvalidArgs {
            message: format!(
                "{MAIN_CHAT_PROTECTED}: session {id} is the main chat; it cannot be {action}"
            ),
        });
    }
    Ok(())
}

/// The write path: one method per write, each writing the database and
/// then broadcasting the result once. Failures broadcast nothing.
pub struct Writes<'a> {
    galley: &'a SqliteGalley,
    notifier: &'a dyn Notifier,
    via: &'static str,
    protect_main_chat: bool,
}

impl<'a> Writes<'a> {
    pub fn new(galley: &'a SqliteGalley, notifier: &'a dyn Notifier, via: &'static str) -> Self {
        Self {
            galley,
            notifier,
            via,
            protect_main_chat: false,
        }
    }

    /// Refuse to archive or delete the main chat (`invalid_args`), and
    /// leave it out of bulk archives and deletes. The desktop's writes
    /// (PRD ruling 14: the main chat has no archive, no delete).
    pub fn protecting_main_chat(self) -> Self {
        Self {
            protect_main_chat: true,
            ..self
        }
    }

    /// `Err(invalid_args)` when guarding and `id` is the main chat.
    async fn refuse_main_chat(&self, id: &SessionId, action: &str) -> Result<()> {
        if !self.protect_main_chat {
            return Ok(());
        }
        refuse_main_chat(self.galley, id, action).await
    }

    /// `ids` without the main chat when guarding.
    async fn spare_main_chat(&self, mut ids: Vec<SessionId>) -> Result<Vec<SessionId>> {
        if self.protect_main_chat {
            if let Some(main) = self.galley.main_chat_id().await? {
                ids.retain(|id| *id != main);
            }
        }
        Ok(ids)
    }

    fn session_event(&self, event: &str, session: SessionBrief) {
        announce_session(self.notifier, event, session, self.via);
    }

    fn session_deleted(&self, id: &SessionId) {
        announce_session_deleted(self.notifier, id, self.via);
    }

    fn project_event(&self, event: &str, project: ProjectBrief) {
        notify(
            self.notifier,
            event,
            &ProjectEventPayload {
                project: project.into(),
                via: self.via,
            },
        );
    }

    /// Broadcast a session whose write returns no row (the unread flag).
    /// The write already happened, so a failed read-back is only logged.
    async fn announce_reread(&self, id: SessionId) {
        match self.galley.session_brief(id.clone()).await {
            Ok(brief) => self.session_event(SESSION_UPDATED_EXTERNAL_EVENT, brief),
            Err(e) => eprintln!("[session-writes {id}] re-read for broadcast failed: {e}"),
        }
    }

    // ---------------- sessions ----------------

    /// The managed runtime's main chat, created on first ask
    /// ([`SqliteGalley::get_or_create_main_chat`]): broadcast as created
    /// the first time, as unarchived when it comes back from the
    /// archive, not at all when it was simply there.
    ///
    /// Created, it opens with the AI's greeting in `language` (the UI
    /// language the GUI resolved; English when none, PRD ruling 47).
    /// Restored or existing, none.
    pub async fn get_or_create_main_chat(
        &self,
        origin: Origin,
        language: Option<&str>,
    ) -> Result<MainChatEnsured> {
        let new_id = crate::socket_listener::mint_session_id();
        let seed = MainChatSeed {
            greeting: Some(main_chat_greeting(language).to_string()),
        };
        let ensured = self
            .galley
            .get_or_create_main_chat(&new_id, origin, &seed)
            .await?;
        match &ensured {
            MainChatEnsured::Existing(_) => {}
            MainChatEnsured::Created(brief) => {
                self.session_event(SESSION_CREATED_EXTERNAL_EVENT, brief.clone())
            }
            MainChatEnsured::Restored(brief) => {
                self.session_event(SESSION_UNARCHIVED_EXTERNAL_EVENT, brief.clone())
            }
        }
        Ok(ensured)
    }

    pub async fn create_session(
        &self,
        input: CreateSessionInput,
        origin: Origin,
    ) -> Result<SessionBrief> {
        let brief = self.galley.create_session(input, origin).await?;
        self.session_event(SESSION_CREATED_EXTERNAL_EVENT, brief.clone());
        Ok(brief)
    }

    pub async fn rename_session(
        &self,
        id: SessionId,
        title: String,
        source: RenameTitleSource,
        origin: Origin,
    ) -> Result<SessionBrief> {
        let brief = self
            .galley
            .rename_session_with_source(id, title, source, origin)
            .await?;
        self.session_event(SESSION_UPDATED_EXTERNAL_EVENT, brief.clone());
        Ok(brief)
    }

    pub async fn set_session_pinned(
        &self,
        id: SessionId,
        pinned: bool,
        origin: Origin,
    ) -> Result<SessionBrief> {
        let brief = self.galley.set_session_pinned(id, pinned, origin).await?;
        self.session_event(SESSION_UPDATED_EXTERNAL_EVENT, brief.clone());
        Ok(brief)
    }

    /// Persist the per-session reasoning-effort override (`None` clears
    /// it), broadcast it, then push it to the session's live runner. A
    /// missing runner is not an error — the next spawn reads the column;
    /// a failed push is logged, not rolled back (the database is
    /// authoritative and the runner catches up on its next spawn).
    pub async fn set_session_reasoning_effort(
        &self,
        runner: &dyn RunnerPort,
        id: SessionId,
        value: Option<String>,
        origin: Origin,
    ) -> Result<SessionBrief> {
        let brief = self
            .galley
            .set_session_reasoning_effort(id.clone(), value, origin)
            .await?;
        self.session_event(SESSION_UPDATED_EXTERNAL_EVENT, brief.clone());
        if runner.live_pid(id.as_str()).await.is_some() {
            let cmd = IpcCommand::SetReasoningEffort(SetReasoningEffortCommand {
                value: brief.reasoning_effort.clone(),
            });
            if let Err(e) = runner.send_command(id.as_str(), &cmd).await {
                eprintln!("[reasoning-effort] forward to runner {id} failed (DB kept): {e}");
            }
        }
        Ok(brief)
    }

    /// Persist and broadcast a session's model choice. The runner is not
    /// told: the socket's `llm.set` dispatches with its own contract, the
    /// GUI's pick goes through [`Self::pick_session_llm`].
    pub async fn set_session_llm(
        &self,
        id: SessionId,
        index: Option<u32>,
        key: Option<String>,
        display_name: Option<String>,
    ) -> Result<SessionBrief> {
        let brief = self
            .galley
            .set_session_llm(id, index, key, display_name)
            .await?;
        self.session_event(SESSION_UPDATED_EXTERNAL_EVENT, brief.clone());
        Ok(brief)
    }

    /// A frontend's model choice: [`Self::set_session_llm`], then — when
    /// `forward` and the session has a live runner — `set_llm` with
    /// `index` to that runner, best effort (a failure is logged). Pass
    /// `forward: false` when the runner itself reported the choice
    /// (`ready` / `llm_changed`): sending it back could overtake a newer
    /// pick on its way to the runner.
    pub async fn pick_session_llm(
        &self,
        runner: &dyn RunnerPort,
        id: SessionId,
        index: Option<u32>,
        key: Option<String>,
        display_name: Option<String>,
        forward: bool,
    ) -> Result<SessionBrief> {
        let brief = self
            .set_session_llm(id.clone(), index, key, display_name)
            .await?;
        if let (true, Some(index)) = (forward, index) {
            if runner.live_pid(id.as_str()).await.is_some() {
                let cmd = IpcCommand::SetLlm(SetLlmCommand {
                    llm_index: i64::from(index),
                });
                if let Err(e) = runner.send_command(id.as_str(), &cmd).await {
                    eprintln!("[set-llm] forward to runner {id} failed (DB kept): {e}");
                }
            }
        }
        Ok(brief)
    }

    pub async fn mark_session_unread(&self, id: SessionId) -> Result<()> {
        self.galley.mark_session_unread(id.clone()).await?;
        self.announce_reread(id).await;
        Ok(())
    }

    pub async fn clear_session_unread(&self, id: SessionId) -> Result<()> {
        self.galley.clear_session_unread(id.clone()).await?;
        self.announce_reread(id).await;
        Ok(())
    }

    pub async fn archive_session(&self, id: SessionId, origin: Origin) -> Result<SessionBrief> {
        self.refuse_main_chat(&id, "archived").await?;
        let brief = self.galley.archive_session(id, origin).await?;
        self.session_event(SESSION_ARCHIVED_EXTERNAL_EVENT, brief.clone());
        Ok(brief)
    }

    pub async fn unarchive_session(&self, id: SessionId, origin: Origin) -> Result<SessionBrief> {
        let brief = self.galley.unarchive_session(id, origin).await?;
        self.session_event(SESSION_UNARCHIVED_EXTERNAL_EVENT, brief.clone());
        Ok(brief)
    }

    /// Archive the listed sessions that are not archived yet; one
    /// `session-archived-external` per session it changed. Returns that
    /// count.
    pub async fn bulk_archive_sessions(&self, ids: Vec<SessionId>, _origin: Origin) -> Result<u32> {
        let ids = self.spare_main_chat(ids).await?;
        let rows = self.galley.bulk_archive_session_rows(&ids).await?;
        let count = rows.len() as u32;
        for row in rows {
            self.session_event(SESSION_ARCHIVED_EXTERNAL_EVENT, row);
        }
        Ok(count)
    }

    /// The desktop's 「归档全部对话」 on a project, as one Core write (the
    /// socket's `project.archive_sessions`, main chat ticket 35): archive
    /// what that project's sidebar group lists — the project's sessions of
    /// the active runtime that are not archived, not pinned (those sit in
    /// the 置顶 section, outside the group), not the main chat, and not a
    /// subtask the user has not written in (a card under the main chat,
    /// never a sidebar row). That is the set the desktop's group hands
    /// `bulk_archive_sessions` (`SidebarProjectGroup`; the rule is
    /// `archivableProjectSessions` in `gui/src/lib/sidebar-timeline.ts`
    /// over the sidebar's rows), so the two agree. One
    /// `session-archived-external` per session; returns them, in list
    /// order. `not_found` for an unknown project.
    pub async fn archive_project_sessions(
        &self,
        project_id: ProjectId,
        _origin: Origin,
    ) -> Result<Vec<SessionBrief>> {
        self.galley.fetch_project(project_id.as_str()).await?;
        let runtime = self.galley.active_runtime_kind().await?;
        let main_chat = self.galley.main_chat_id().await?;
        let listed: Vec<SessionId> = self
            .galley
            .list_sessions(SessionFilter {
                project_id: Some(project_id.0),
                status: None,
                archived: Some(false),
                runtime_kind: Some(runtime),
            })
            .await?
            .into_iter()
            .filter(|s| {
                let unpromoted_subtask = s.parent_session_id.is_some() && s.promoted != Some(true);
                s.pinned != Some(true)
                    && s.main_chat != Some(true)
                    && main_chat.as_ref() != Some(&s.id)
                    && !unpromoted_subtask
            })
            .map(|s| s.id)
            .collect();
        let ids = self.spare_main_chat(listed).await?;
        let rows = self.galley.bulk_archive_session_rows(&ids).await?;
        for row in &rows {
            self.session_event(SESSION_ARCHIVED_EXTERNAL_EVENT, row.clone());
        }
        Ok(rows)
    }

    /// Inverse of [`Self::bulk_archive_sessions`].
    pub async fn bulk_unarchive_sessions(
        &self,
        ids: Vec<SessionId>,
        _origin: Origin,
    ) -> Result<u32> {
        let rows = self.galley.bulk_unarchive_session_rows(&ids).await?;
        let count = rows.len() as u32;
        for row in rows {
            self.session_event(SESSION_UNARCHIVED_EXTERNAL_EVENT, row);
        }
        Ok(count)
    }

    pub async fn delete_session(&self, id: SessionId, origin: Origin) -> Result<()> {
        self.refuse_main_chat(&id, "deleted").await?;
        self.galley.delete_session(id.clone(), origin).await?;
        self.session_deleted(&id);
        Ok(())
    }

    /// Delete the listed sessions; one `session-deleted-external` per
    /// session that existed. Returns that count.
    pub async fn bulk_delete_sessions(&self, ids: Vec<SessionId>, _origin: Origin) -> Result<u32> {
        let ids = self.spare_main_chat(ids).await?;
        let deleted = self.galley.bulk_delete_session_ids(&ids).await?;
        for id in &deleted {
            self.session_deleted(id);
        }
        Ok(deleted.len() as u32)
    }

    /// The launch sweep of abandoned `新对话` rows
    /// ([`SqliteGalley::delete_empty_new_sessions`]), one
    /// `session-deleted-external` per row.
    pub async fn delete_empty_new_sessions(&self) -> Result<u32> {
        let deleted = self.galley.delete_empty_new_session_ids().await?;
        for id in &deleted {
            self.session_deleted(id);
        }
        Ok(deleted.len() as u32)
    }

    /// The one-time sweep of the v0.1 demo rows, one
    /// `session-deleted-external` per row.
    pub async fn delete_demo_sessions(&self) -> Result<u32> {
        let deleted = self.galley.delete_demo_session_ids().await?;
        for id in &deleted {
            self.session_deleted(id);
        }
        Ok(deleted.len() as u32)
    }

    /// Move a session into a project, or out of any (`None`).
    pub async fn assign_session_to_project(
        &self,
        id: SessionId,
        project_id: Option<String>,
        origin: Origin,
    ) -> Result<SessionBrief> {
        let brief = self
            .galley
            .assign_session_to_project(id, project_id, origin)
            .await?;
        self.session_event(SESSION_MOVED_EXTERNAL_EVENT, brief.clone());
        Ok(brief)
    }

    // ---------------- projects ----------------

    pub async fn create_project(
        &self,
        input: CreateProjectInput,
        origin: Origin,
    ) -> Result<ProjectBrief> {
        let brief = self.galley.create_project(input, origin).await?;
        self.project_event(PROJECT_CREATED_EXTERNAL_EVENT, brief.clone());
        Ok(brief)
    }

    pub async fn update_project(
        &self,
        id: ProjectId,
        patch: ProjectPatch,
        origin: Origin,
    ) -> Result<ProjectBrief> {
        let brief = self.galley.update_project(id, patch, origin).await?;
        self.project_event(PROJECT_UPDATED_EXTERNAL_EVENT, brief.clone());
        Ok(brief)
    }

    /// Delete a project. Its sessions stay, detached (FK `SET NULL`);
    /// they are listed before the delete for the broadcast and the
    /// caller's answer — the few milliseconds between the two queries
    /// are an accepted race for a count meant for human feedback.
    pub async fn delete_project(
        &self,
        id: ProjectId,
        origin: Origin,
    ) -> Result<ProjectDeletedPayload> {
        let detached_session_ids: Vec<String> = self
            .galley
            .list_sessions(SessionFilter {
                project_id: Some(id.0.clone()),
                status: None,
                archived: None,
                runtime_kind: None,
            })
            .await?
            .into_iter()
            .map(|s| s.id.0)
            .collect();
        self.galley.delete_project(id.clone(), origin).await?;
        let payload = ProjectDeletedPayload {
            project_id: id.0,
            detached_sessions: detached_session_ids.len() as u32,
            detached_session_ids,
        };
        notify(self.notifier, PROJECT_DELETED_EXTERNAL_EVENT, &payload);
        Ok(payload)
    }

    // ---------------- scheduled tasks ----------------

    fn scheduled_tasks_changed(&self) {
        notify(self.notifier, SCHEDULED_TASKS_CHANGED_EVENT, &());
    }

    pub async fn create_scheduled_task(
        &self,
        input: CreateScheduledTaskInput,
        origin: Origin,
    ) -> Result<ScheduledTaskBrief> {
        let brief = self.galley.create_scheduled_task(input, origin).await?;
        self.scheduled_tasks_changed();
        Ok(brief)
    }

    /// [`Self::create_scheduled_task`], recording the main chat run it
    /// was made in ([`SqliteGalley::create_scheduled_task_in`]).
    pub async fn create_scheduled_task_in(
        &self,
        input: CreateScheduledTaskInput,
        origin: Origin,
        created_in: Option<(SessionId, i64)>,
    ) -> Result<ScheduledTaskBrief> {
        let brief = self
            .galley
            .create_scheduled_task_in(input, origin, created_in)
            .await?;
        self.scheduled_tasks_changed();
        Ok(brief)
    }

    pub async fn update_scheduled_task(
        &self,
        id: ScheduledTaskId,
        patch: ScheduledTaskPatch,
        origin: Origin,
    ) -> Result<ScheduledTaskBrief> {
        let brief = self.galley.update_scheduled_task(id, patch, origin).await?;
        self.scheduled_tasks_changed();
        Ok(brief)
    }

    pub async fn delete_scheduled_task(&self, id: ScheduledTaskId, origin: Origin) -> Result<()> {
        self.galley.delete_scheduled_task(id, origin).await?;
        self.scheduled_tasks_changed();
        Ok(())
    }

    // ---------------- to-dos (main chat ticket 39) ----------------

    /// Broadcast after a to-do write, whatever it returned: a write that
    /// failed halfway (its reminder refused after the to-do changed) may
    /// still have changed something, and a page that reads again only
    /// reads the truth. `reminder`: the write may have touched the
    /// reminder's task.
    fn todos_changed<T>(&self, result: Result<T>, reminder: bool) -> Result<T> {
        notify(self.notifier, TODOS_CHANGED_EVENT, &());
        if reminder {
            self.scheduled_tasks_changed();
        }
        result
    }

    /// [`SqliteGalley::create_todo`].
    pub async fn create_todo(
        &self,
        input: CreateTodoInput,
        origin: Origin,
        created_in: Option<(SessionId, i64)>,
    ) -> Result<TodoBrief> {
        let reminder = input.remind_at.is_some();
        let result = self.galley.create_todo(input, origin, created_in).await;
        self.todos_changed(result, reminder)
    }

    /// [`SqliteGalley::update_todo`].
    pub async fn update_todo(
        &self,
        id: &TodoId,
        patch: TodoPatch,
        origin: Origin,
    ) -> Result<TodoBrief> {
        let result = self.galley.update_todo(id, patch, origin).await;
        self.todos_changed(result, true)
    }

    /// [`SqliteGalley::complete_todo`]: the desktop's tick, Galley's
    /// `todo done`.
    pub async fn complete_todo(&self, id: &TodoId, origin: Origin) -> Result<TodoBrief> {
        let result = self.galley.complete_todo(id, origin).await;
        self.todos_changed(result, true)
    }

    /// [`SqliteGalley::reopen_todo`].
    pub async fn reopen_todo(&self, id: &TodoId, origin: Origin) -> Result<TodoBrief> {
        let result = self.galley.reopen_todo(id, origin).await;
        self.todos_changed(result, false)
    }

    /// [`SqliteGalley::cancel_todo`].
    pub async fn cancel_todo(&self, id: &TodoId, origin: Origin) -> Result<TodoBrief> {
        let result = self.galley.cancel_todo(id, origin).await;
        self.todos_changed(result, true)
    }

    /// [`SqliteGalley::cancel_todo_reminder`].
    pub async fn cancel_todo_reminder(&self, id: &TodoId, origin: Origin) -> Result<TodoBrief> {
        let result = self.galley.cancel_todo_reminder(id, origin).await;
        self.todos_changed(result, true)
    }
}
