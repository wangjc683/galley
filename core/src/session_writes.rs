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
//! | create a session | `session-created-external` |
//! | rename, pin, reasoning effort, unread, model | `session-updated-external` |
//! | archive / unarchive (bulk: one event per session it changed) | `session-archived-external` / `session-unarchived-external` |
//! | delete, bulk delete, empty-session and demo sweeps (one per session) | `session-deleted-external` `{ sessionId, via }` |
//! | move to a project | `session-moved-external` |
//! | create / update / delete a project | `project-created-external` / `project-updated-external` / `project-deleted-external` |
//! | create / update / delete a scheduled task | `scheduled-tasks:changed` (empty payload) |
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

use crate::api::{
    CreateProjectInput, CreateScheduledTaskInput, CreateSessionInput, GalleyApi, Origin,
    ProjectBrief, ProjectId, ProjectPatch, RuntimeKind, ScheduledTaskBrief, ScheduledTaskId,
    ScheduledTaskPatch, SessionBrief, SessionFilter, SessionId, SessionStatus,
    SCHEDULED_TASKS_CHANGED_EVENT,
};
use crate::db::{RenameTitleSource, SqliteGalley};
use crate::error::Result;
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

/// The write path: one method per write, each writing the database and
/// then broadcasting the result once. Failures broadcast nothing.
pub struct Writes<'a> {
    galley: &'a SqliteGalley,
    notifier: &'a dyn Notifier,
    via: &'static str,
}

impl<'a> Writes<'a> {
    pub fn new(galley: &'a SqliteGalley, notifier: &'a dyn Notifier, via: &'static str) -> Self {
        Self {
            galley,
            notifier,
            via,
        }
    }

    fn session_event(&self, event: &str, session: SessionBrief) {
        announce_session(self.notifier, event, session, self.via);
    }

    fn session_deleted(&self, id: &SessionId) {
        notify(
            self.notifier,
            SESSION_DELETED_EXTERNAL_EVENT,
            &SessionDeletedPayload {
                session_id: id.0.clone(),
                via: self.via,
            },
        );
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
        let rows = self.galley.bulk_archive_session_rows(&ids).await?;
        let count = rows.len() as u32;
        for row in rows {
            self.session_event(SESSION_ARCHIVED_EXTERNAL_EVENT, row);
        }
        Ok(count)
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
        self.galley.delete_session(id.clone(), origin).await?;
        self.session_deleted(&id);
        Ok(())
    }

    /// Delete the listed sessions; one `session-deleted-external` per
    /// session that existed. Returns that count.
    pub async fn bulk_delete_sessions(&self, ids: Vec<SessionId>, _origin: Origin) -> Result<u32> {
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
}
