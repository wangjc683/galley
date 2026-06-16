//! # Galley Core API surface (single source of truth)
//!
//! All commands the GUI, the CLI, and (B4+) Supervisor agents can issue
//! against Galley Core are defined as [`GalleyApi`] trait methods.
//! Both transports — Tauri's `invoke()` and the future Unix-socket /
//! named-pipe daemon — thin-wrap this trait. See
//! [invariants.md §I5](../../docs/refactor/invariants.md) for the
//! corollary rule.
//!
//! **B1 scope:** read-only methods. Write methods (`send_message`,
//! `create_session`, `archive_session`, …) land in B2 once runner
//! ownership migrates into Rust.

pub mod goal;
pub mod health;
pub mod message;
pub mod model;
pub mod origin;
pub mod project;
pub mod search;
pub mod session;
pub mod status;

pub use goal::{
    goal_checkpoint_deadline_reached, goal_checkpoint_first_material,
    goal_checkpoint_planning_started, goal_checkpoint_workers_started, goal_launch_ack,
    goal_synthesizing, ClaimGoalTaskInput, CreateGoalEventInput, CreateGoalProposalInput,
    CreateGoalTaskInput, GoalBrief, GoalDeliverable, GoalEventBrief, GoalEventType, GoalId,
    GoalLocale, GoalProposalBrief, GoalProposalId, GoalProposalStatus, GoalStatus,
    GoalStatusSnapshot, GoalTaskBrief, GoalTaskId, GoalTaskStatus, GoalWriteMode,
    UpdateGoalTaskInput, DEFAULT_GOAL_BUDGET_SECONDS, DEFAULT_GOAL_WORKER_LIMIT,
    GOAL_CONFIRMATION_PHRASE, MAX_GOAL_WORKER_LIMIT, MIN_GOAL_WORKER_LIMIT,
};
pub use health::{HealthCheck, HealthReport, HealthStatus};
pub use message::{
    MessageAttachmentBrief, MessageBrief, MessageId, MessageRole, MessageVisibility,
};
pub use model::{
    ManagedModelAuthKind, ManagedModelConnectionResult, ManagedModelCredentialStatus,
    ManagedModelListResult, ManagedModelProbeInput, ManagedModelProtocol,
    ManagedModelProviderRecord, ManagedModelRecord, ReorderManagedModelsInput,
    SaveManagedModelInput, SaveManagedProviderInput,
};
pub use origin::{Origin, OriginVia};
pub use project::{CreateProjectInput, ProjectBrief, ProjectId, ProjectPatch};
pub use search::{SearchHit, SearchScope};
pub use session::{
    CreateSessionInput, RuntimeKind, SessionBrief, SessionFilter, SessionId, SessionStatus,
};
pub use status::StatusSummary;

use async_trait::async_trait;

use crate::error::Result;

#[async_trait]
pub trait GalleyApi: Send + Sync {
    /// List sessions matching the filter. Default sort: pinned first,
    /// then `lastActivityAt` desc.
    async fn list_sessions(&self, filter: SessionFilter) -> Result<Vec<SessionBrief>>;

    /// Brief projection of one session by id.
    async fn session_brief(&self, id: SessionId) -> Result<SessionBrief>;

    /// Persisted messages for a session, oldest first. `tail` caps the
    /// returned count to the last N — useful for "what's the latest"
    /// quick reads from agents.
    async fn session_messages(
        &self,
        id: SessionId,
        tail: Option<usize>,
    ) -> Result<Vec<MessageBrief>>;

    /// FTS5 search across messages.
    async fn search_messages(
        &self,
        query: String,
        scope: SearchScope,
        runtime_kind: Option<RuntimeKind>,
    ) -> Result<Vec<SearchHit>>;

    /// Aggregate counts useful for status dashboards.
    async fn status(&self) -> Result<StatusSummary>;

    /// Health probe — files exist, deps reachable, etc. B1 ships a
    /// partial set (filesystem-checkable only); Python-dependent probes
    /// land in B4 once the daemon mode exists. Each unimplemented check
    /// surfaces as [`HealthStatus::DeferredB4`].
    async fn health(&self) -> Result<HealthReport>;

    /// Persist a user message into a session. Writes the row to the
    /// `messages` table with the supplied [`Origin`] triple. Does NOT
    /// dispatch to the runner subprocess — the socket transport layer
    /// (or B3 Tauri command layer) wires `send_message` to
    /// [`RunnerManager::send_command`](crate::runner_manager::RunnerManager::send_command)
    /// after a successful persist.
    ///
    /// Returns the persisted [`MessageBrief`] with its server-assigned
    /// id and timestamp.
    async fn send_message(
        &self,
        session_id: SessionId,
        content: String,
        origin: Origin,
    ) -> Result<MessageBrief>;

    async fn send_message_with_visibility(
        &self,
        session_id: SessionId,
        content: String,
        origin: Origin,
        visibility: MessageVisibility,
    ) -> Result<MessageBrief>;

    /// Write a Galley-authored `system`-role visible message into a
    /// session (e.g. Goal master narration). Distinct from
    /// `send_message`, which always writes a `user` row: system rows
    /// render as neutral narration, not as the human operator's input,
    /// and never dispatch to the runner.
    async fn send_system_message(
        &self,
        session_id: SessionId,
        content: String,
        origin: Origin,
    ) -> Result<MessageBrief>;

    // ---------------- session writes (B3 M4a) ----------------
    //
    // All session writes return the freshly-read `SessionBrief` so the
    // caller doesn't have to round-trip a separate `session_brief` to
    // mirror the new `updated_at` / column values in-memory. `delete`
    // and the bulk variants return `()` / `u32 affected rows` instead
    // because there's no row to read back.
    //
    // The `origin` parameter captures who triggered the write — GUI
    // passes `Origin::gui()`, CLI / supervisor SOPs pass `Origin::cli()`
    // or a `Supervisor`-flavoured value. Migration 007 already stores
    // origin-of-creation on `sessions`; subsequent patches (rename /
    // archive / pin / etc.) don't currently persist a per-patch origin
    // — that lands when audit log tables join in a later phase.

    /// Create a new session with the caller-assigned id from
    /// [`CreateSessionInput`]. Frontend mints `s-…` ids before invoking
    /// to keep the optimistic-create UI flow alive.
    ///
    /// **Origin**: `created_via` / `created_by_supervisor` / `created_origin_note`
    /// land on the new row from `origin`. Any subsequent edit to the row
    /// preserves these.
    ///
    /// **Errors**:
    /// - `invalid_args` — empty title, id conflict (PRIMARY KEY violation),
    ///   or non-existent `projectId`.
    async fn create_session(
        &self,
        input: CreateSessionInput,
        origin: Origin,
    ) -> Result<SessionBrief>;

    /// Flip status → `archived`. Bumps `updated_at` but **not**
    /// `last_activity_at` (archive isn't a conversation event).
    ///
    /// **Errors**: `not_found`.
    async fn archive_session(&self, id: SessionId, origin: Origin) -> Result<SessionBrief>;

    /// Flip status → `idle` from `archived`. No-op if the row isn't
    /// archived (returns the current brief unchanged).
    ///
    /// **Errors**: `not_found`.
    async fn unarchive_session(&self, id: SessionId, origin: Origin) -> Result<SessionBrief>;

    /// Replace `title`. Server-side trim; empty-after-trim falls back to
    /// the localized default (`新对话`) to mirror the GUI behaviour and
    /// avoid persisting a literal-empty string that would render as a
    /// blank sidebar row.
    ///
    /// **Errors**: `not_found`.
    async fn rename_session(
        &self,
        id: SessionId,
        title: String,
        origin: Origin,
    ) -> Result<SessionBrief>;

    /// Toggle `pinned`. Sessions with `status = archived` cannot be
    /// pinned — request is rejected with `invalid_args` to surface the
    /// constraint instead of silently no-op'ing.
    ///
    /// **Errors**: `not_found`, `invalid_args` (archived).
    async fn set_session_pinned(
        &self,
        id: SessionId,
        pinned: bool,
        origin: Origin,
    ) -> Result<SessionBrief>;

    /// Permanently delete the session row. FK CASCADE removes the
    /// associated `messages` / `tool_events` rows in the same statement.
    ///
    /// **Errors**: `not_found`.
    async fn delete_session(&self, id: SessionId, origin: Origin) -> Result<()>;

    /// Move a session into a different project (or detach via
    /// `project_id = None`). Bumps `updated_at` but not
    /// `last_activity_at`.
    ///
    /// **Errors**: `not_found` (session), `invalid_args` (project id
    /// non-existent — FK violation).
    async fn assign_session_to_project(
        &self,
        session_id: SessionId,
        project_id: Option<String>,
        origin: Origin,
    ) -> Result<SessionBrief>;

    /// Persist a session's per-bridge LLM choice. `key` is the stable
    /// identity: managed runtime stores `managed_models.id`, external
    /// runtime stores GA's raw LLM name. `index` is retained for
    /// backwards compatibility and the bridge's current index command.
    ///
    /// No `origin` parameter — `replaceLLMs` fires this every time the
    /// bridge emits a `ready` event or the user picks a new LLM, both
    /// of which are GUI-driven and don't carry the kind of audit
    /// signal an explicit user action does.
    ///
    /// **Errors**: `not_found`.
    async fn set_session_llm(
        &self,
        id: SessionId,
        index: Option<u32>,
        key: Option<String>,
        display_name: Option<String>,
    ) -> Result<SessionBrief>;

    /// Increment `turn_count`, refresh `summary` + `last_activity_at` +
    /// `updated_at`, and flip `has_unread = 1` when the call says so
    /// (typically when the bumped session isn't the active one in the
    /// GUI). `summary` is server-side truncated to 80 chars.
    ///
    /// No `origin` — this is a system-driven write triggered by the
    /// runner on `turn_end`.
    ///
    /// **Errors**: `not_found`.
    async fn bump_session_after_turn(
        &self,
        id: SessionId,
        summary: Option<String>,
        step_number: Option<u32>,
        mark_unread: bool,
    ) -> Result<SessionBrief>;

    /// Clear `has_unread`. Called when the user activates a session —
    /// the inbox metaphor says opening a session reads it. No `origin`
    /// (system write, not user action).
    ///
    /// Idempotent: clearing an already-zero row is a successful no-op.
    /// **Errors**: `not_found`.
    async fn clear_session_unread(&self, id: SessionId) -> Result<()>;

    /// Bulk archive — UPDATE WHERE id IN (…). Returns count of rows
    /// actually mutated (i.e. were not already archived). Wrapped in a
    /// transaction so partial failure rolls back.
    async fn bulk_archive_sessions(&self, ids: Vec<SessionId>, origin: Origin) -> Result<u32>;

    /// Bulk unarchive — inverse of `bulk_archive_sessions`. Returns
    /// count of rows actually flipped (i.e. were archived).
    async fn bulk_unarchive_sessions(&self, ids: Vec<SessionId>, origin: Origin) -> Result<u32>;

    /// Bulk delete — DELETE WHERE id IN (…), CASCADE handles messages /
    /// tool_events. Returns count of rows deleted.
    async fn bulk_delete_sessions(&self, ids: Vec<SessionId>, origin: Origin) -> Result<u32>;

    // ---------------- projects ----------------

    /// List all projects, ordered by `pinned DESC`, then effective
    /// non-archived project content activity desc to match the GUI
    /// Sidebar PROJECTS section sort.
    async fn list_projects(&self) -> Result<Vec<ProjectBrief>>;

    /// Create a project. `name` is trimmed server-side; empty after
    /// trim → `invalid_args`. `root_path` empty-string normalises to
    /// SQL NULL.
    async fn create_project(
        &self,
        input: CreateProjectInput,
        origin: Origin,
    ) -> Result<ProjectBrief>;

    /// Apply a [`ProjectPatch`]. Only present fields are updated;
    /// `root_path` / `icon` / `color` use double-`Option` so `Some(None)`
    /// can clear a previously-set value.
    ///
    /// **Errors**: `not_found`, `invalid_args` (empty name).
    async fn update_project(
        &self,
        id: ProjectId,
        patch: ProjectPatch,
        origin: Origin,
    ) -> Result<ProjectBrief>;

    /// Delete a project. FK `ON DELETE SET NULL` on `sessions.project_id`
    /// auto-detaches any sessions that pointed at this project; the
    /// sessions themselves stay (per PRD §7.3).
    ///
    /// **Errors**: `not_found`.
    async fn delete_project(&self, id: ProjectId, origin: Origin) -> Result<()>;

    // ---------------- goals ----------------

    async fn create_goal_proposal(
        &self,
        input: CreateGoalProposalInput,
        origin: Origin,
    ) -> Result<GoalProposalBrief>;

    async fn start_goal_from_proposal(
        &self,
        proposal_id: GoalProposalId,
        internal_confirm_token: String,
        origin: Origin,
    ) -> Result<GoalBrief>;

    async fn goal_status(&self, id: GoalId) -> Result<GoalStatusSnapshot>;

    /// Append a new deliverable anchor version for a goal. `version` is
    /// assigned as the current max + 1. Content over the size cap is
    /// truncated on a char boundary with a marker note.
    async fn set_goal_deliverable(
        &self,
        goal_id: GoalId,
        content: String,
        note: Option<String>,
        author_session_id: Option<SessionId>,
    ) -> Result<GoalDeliverable>;

    /// Latest (highest-version) deliverable anchor for a goal, if any.
    async fn latest_goal_deliverable(&self, goal_id: GoalId) -> Result<Option<GoalDeliverable>>;

    async fn list_active_goals(&self) -> Result<Vec<GoalBrief>>;

    async fn list_visible_goals(&self) -> Result<Vec<GoalBrief>>;

    /// All goals whose master session is `master_session_id`, any
    /// status (including terminal + already-seen), oldest run first.
    /// Read-only; powers the in-thread Goal commission / terminal
    /// markers, which must persist after a goal leaves the active /
    /// visible lists so reopening a finished run is not amnesiac.
    async fn list_goals_for_session(&self, master_session_id: SessionId) -> Result<Vec<GoalBrief>>;

    async fn mark_goal_result_seen(&self, id: GoalId, origin: Origin) -> Result<GoalBrief>;

    async fn request_goal_stop(&self, id: GoalId, origin: Origin) -> Result<GoalBrief>;

    async fn update_goal_state(
        &self,
        id: GoalId,
        status: GoalStatus,
        latest_summary: Option<String>,
    ) -> Result<GoalBrief>;

    async fn create_goal_task(&self, input: CreateGoalTaskInput) -> Result<GoalTaskBrief>;

    async fn claim_goal_task(&self, input: ClaimGoalTaskInput) -> Result<GoalTaskBrief>;

    async fn update_goal_task(&self, input: UpdateGoalTaskInput) -> Result<GoalTaskBrief>;

    async fn create_goal_event(&self, input: CreateGoalEventInput) -> Result<GoalEventBrief>;

    // ---------------- B4 M1 · transaction-aware variants ----------------
    //
    // `session.new` (B4 M1) atomically persists a session + its first
    // message in a single SQLite transaction (sub-plan O1 resolution).
    // The `_in_tx` siblings of `create_session` and `send_message` take
    // a borrowed `Transaction` so the socket handler can wrap both
    // writes with a single BEGIN / COMMIT (or ROLLBACK on failure).
    //
    // The owned-pool variants above stay byte-identical for GUI Tauri
    // command callers — only `session.new` socket handler uses these
    // tx variants. Implementation reuses shared inner helpers so SQL +
    // validation logic is single-sourced.

    /// Same as [`Self::create_session`] but writes through a caller-owned
    /// transaction. The caller is responsible for `commit()` or letting
    /// the tx drop to roll back.
    async fn create_session_in_tx<'c>(
        &self,
        tx: &mut sqlx::Transaction<'c, sqlx::Sqlite>,
        input: CreateSessionInput,
        origin: Origin,
    ) -> Result<SessionBrief>;

    /// Same as [`Self::send_message`] but writes through a caller-owned
    /// transaction. Validation (session exists, not archived) runs
    /// inside the same tx so a concurrent archive can't sneak in
    /// between check and write.
    async fn send_message_in_tx<'c>(
        &self,
        tx: &mut sqlx::Transaction<'c, sqlx::Sqlite>,
        session_id: SessionId,
        content: String,
        origin: Origin,
    ) -> Result<MessageBrief>;

    /// Open a transaction against the underlying pool. Returned handle is
    /// the socket handler's BEGIN; calling `.commit()` is the COMMIT,
    /// dropping it without commit triggers ROLLBACK.
    ///
    /// Exposed on the trait so socket handlers can wrap multiple
    /// `_in_tx` calls without holding a concrete `SqliteGalley` ref.
    async fn begin_tx(&self) -> Result<sqlx::Transaction<'_, sqlx::Sqlite>>;

    // ---------------- B4 M1 · generic prefs read ----------------
    //
    // The CLI's `llm list` (M1.3) reads the `llm_list` pref cache that
    // GUI writes after warmup. Generic read keeps the SQL in one place
    // and lets future prefs reads (B4 M3 supervisor discovery, etc.)
    // reuse the same path without per-key trait methods.

    /// Read a JSON-encoded pref. Returns `None` if the key is absent;
    /// `Err(InvalidArgs)` if the stored value can't deserialize to `T`
    /// (means GUI wrote a different shape — schema drift signal).
    async fn get_pref_json(&self, key: &str) -> Result<Option<serde_json::Value>>;
}
