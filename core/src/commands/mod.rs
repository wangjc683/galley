use crate::api::{
    self, CreateProjectInput, CreateSessionInput, GalleyApi, GoalBrief, GoalId, GoalStatusSnapshot,
    ManagedModelAuthKind, ManagedModelProbeInput, MessageBrief, MessageVisibility, Origin,
    ProjectBrief, ProjectId, ProjectPatch, ReorderManagedModelsInput, RuntimeKind,
    SaveManagedModelInput, SaveManagedProviderInput, SessionBrief, SessionFilter, SessionId,
};
use crate::db::{
    MessageAttachmentCreate, MessageSearchHit, PersistAssistantMessage, PersistToolEventPending,
    PersistedMessageRow, SqliteGalley, ToolEventRow, UpsertManagedModelMetadata,
    UpsertManagedModelProviderMetadata,
};
use crate::{
    browser_control, codex_oauth, credential_store, error, im_supervisor, managed_model_config,
    managed_model_probe, managed_runtime, path_install, sop_install,
};
use serde::Deserialize;

mod goal;
mod managed_model;
mod project;
mod session;
mod system;

pub(crate) use goal::*;
pub(crate) use managed_model::*;
pub(crate) use project::*;
pub(crate) use session::*;
pub(crate) use system::*;

/// Stringify a [`crate::error::GalleyError`] for the Tauri invoke wire.
/// JSON-encoded so the front-end can `JSON.parse` and discriminate on
/// the `error: <category>` field (matches agent-api.md envelope).
pub(crate) fn stringify_error(e: crate::error::GalleyError) -> String {
    serde_json::to_string(&e).unwrap_or_else(|_| e.to_string())
}
