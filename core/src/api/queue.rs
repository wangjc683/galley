//! Per-session outbound message queue — wire types.
//!
//! Messages sent while a session's run is open are held in an
//! in-memory queue owned by [`RunnerManager`](crate::runner_manager)
//! (galley#19 / #20; `.scratch/message-queue/PRD.md`). Queued items
//! are NOT persisted: they reach `messages` (SQLite) only at dequeue
//! time, so a removed item leaves no ghost row and the transcript
//! order always matches execution order. App restart drops the queue
//! — same standing as an unsent draft.

use serde::{Deserialize, Serialize};

use super::Origin;

/// Tauri event fired on any queue mutation (enqueue / dequeue / jump /
/// remove / crash-hold). Payload is the full snapshot for one session
/// — queues are short (human-scale), so snapshot beats delta.
pub const SESSION_QUEUE_CHANGED_EVENT: &str = "session-queue:changed";

/// One queued (not yet dispatched) user message. v1 is text-only —
/// same scope as the CLI write contract; the GUI blocks image
/// attachments while a run is open (PRD 定案 6).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedMessage {
    /// Queue-local id (`qm_<random>`), NOT a message id — the message
    /// id is minted at dequeue when the row is actually persisted.
    pub queue_id: String,
    /// Full text — the GUI's "edit = remove + refill composer" flow
    /// needs it verbatim, and queues are human-scale (a handful of
    /// prompts), so snapshots stay small.
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
    /// ISO 8601 enqueue instant.
    pub queued_at: String,
}

/// Payload of [`SESSION_QUEUE_CHANGED_EVENT`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionQueueChangedPayload {
    pub session_id: String,
    pub items: Vec<QueuedMessage>,
}
