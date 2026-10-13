//! Subtasks the main chat dispatches (main chat ticket 06a, migration
//! 048). The dispatch logic lives in [`crate::subtask`]; these are the
//! shapes the desktop reads.

use serde::{Deserialize, Serialize};

/// Tauri event for each dispatch record as it is written, payload
/// [`SubtaskDispatchedPayload`]: a subtask's once its session and first
/// message exist (before its runner is up), and again when its runner
/// then did not start. Desktop only: not the Agent API, and not forwarded
/// to a phone (its cards are iOS 07's).
pub const SUBTASK_DISPATCHED_EVENT: &str = "subtask-dispatched";

/// Why a `<subtask>` tag started nothing, or did not start running.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubtaskFailure {
    /// `<subtask></subtask>` with nothing but whitespace in it.
    Empty,
    /// A `<subtask>` the reply never closed.
    Unclosed,
    /// Creating the session failed (no `session_id`), or its runner did
    /// not start (with a `session_id`); `failure_detail` says why.
    StartFailed,
}

impl SubtaskFailure {
    /// The stored value (`subtask_dispatches.failure`).
    pub fn as_sql(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::Unclosed => "unclosed",
            Self::StartFailed => "start_failed",
        }
    }

    pub fn from_sql(value: &str) -> Option<Self> {
        match value {
            "empty" => Some(Self::Empty),
            "unclosed" => Some(Self::Unclosed),
            "start_failed" => Some(Self::StartFailed),
            _ => None,
        }
    }
}

/// One `<subtask>` tag of one main chat reply and what came of it — the
/// record a card finds its subtask by (`subtask_dispatches`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskDispatch {
    /// The main chat.
    pub parent_session_id: String,
    /// The reply's `turn_index`.
    pub turn_index: i64,
    /// Which tag of the reply, from 0, in reply order.
    pub ordinal: i64,
    /// The reply's row: `msg_{parent}_{turn}_assistant`, the id the
    /// desktop's turn carries live and restored.
    pub message_id: String,
    /// The subtask; `None` when no session was created.
    pub session_id: Option<String>,
    /// The instructions' first line (empty for an empty tag).
    pub title: String,
    pub failure: Option<SubtaskFailure>,
    /// What went wrong, for [`SubtaskFailure::StartFailed`].
    pub failure_detail: Option<String>,
    pub created_at: String,
}

impl SubtaskDispatch {
    /// The reply row a dispatch belongs to.
    pub fn reply_message_id(parent_session_id: &str, turn_index: i64) -> String {
        format!("msg_{parent_session_id}_{turn_index}_assistant")
    }
}

/// Payload of [`SUBTASK_DISPATCHED_EVENT`]: records of one reply (Core
/// sends one per event); a later record for the same tag replaces it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtaskDispatchedPayload {
    pub parent_session_id: String,
    pub dispatches: Vec<SubtaskDispatch>,
}
