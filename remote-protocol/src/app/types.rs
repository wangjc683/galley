//! Data the phone reads: sessions, projects, messages, run state
//! (design §6.3, §6.4).
//!
//! Each type names the Core type it is converted from (ticket 05b) and
//! what it leaves out. Enums of open sets end in `Unknown`, which a value
//! this version does not know decodes as.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Session lifecycle (Core `SessionStatus`, `core/src/api/session.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Idle,
    Connecting,
    Running,
    WaitingApproval,
    Error,
    Completed,
    Cancelled,
    Archived,
    #[serde(other)]
    Unknown,
}

/// Who triggered a write (Core `OriginVia`, `core/src/api/origin.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginVia {
    Gui,
    Cli,
    Supervisor,
    System,
    #[serde(other)]
    Unknown,
}

/// Core `Origin`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Origin {
    pub via: OriginVia,
    pub supervisor: Option<String>,
    pub reason: Option<String>,
}

/// One session row (from Core `SessionBriefEvent`,
/// `core/src/session_writes.rs`). Leaves out the runtime fields (the phone
/// only shows managed sessions, PRD ruling 18), the legacy
/// `selectedLlmIndex`, and `promptProfile`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub status: SessionStatus,
    /// "Turn N · one-line summary".
    pub summary: Option<String>,
    pub turn_count: Option<u32>,
    /// ISO 8601.
    pub last_activity_at: String,
    pub created_at: String,
    pub updated_at: String,
    pub pinned: Option<bool>,
    pub has_unread: Option<bool>,
    pub origin: Option<Origin>,
    pub selected_llm_key: Option<String>,
    pub selected_llm_display_name: Option<String>,
    /// Per-session override (`none` … `max`); `null` follows the model.
    pub reasoning_effort: Option<String>,
}

/// One project (from Core `ProjectBriefEvent`). Leaves out `rootPath` and
/// `workspaceEnabled`, which only mean something on the desktop.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub pinned: bool,
    pub last_activity_at: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Live run state of one session (Core `RunState`,
/// `core/src/runner_manager/manager.rs`; the `session-run-state` event of
/// ticket 05c). The phone shows "running / asking you / queued" from it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRunState {
    pub session_id: String,
    /// A runner process is up.
    pub runner_alive: bool,
    /// Mid-turn (flickers false between turns of one run).
    pub agent_running: bool,
    /// A run is open (the gate; steady across a multi-turn run).
    pub open_run: bool,
    pub queued_count: u32,
    /// The last run ended on an unanswered `ask_user` question.
    pub ask_pending: bool,
    /// `exitReason.result` of the last completed run, verbatim.
    pub last_exit: Option<String>,
}

/// Author of a message row (Core `MessageRole`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    User,
    Agent,
    System,
    #[serde(other)]
    Unknown,
}

/// An `ask_user` question with its candidate answers (Core `AskUserBrief`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskUser {
    pub question: String,
    pub candidates: Vec<String>,
}

/// Per-answer usage (Core `MessageTelemetry`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageTelemetry {
    pub elapsed_ms: Option<i64>,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_create_tokens: Option<i64>,
    pub cache_read_tokens: Option<i64>,
    pub request_count: Option<i64>,
    pub context_used_chars: Option<i64>,
    pub context_limit_chars: Option<i64>,
}

/// A file attached to a message (Core `MessageAttachmentBrief`). The
/// desktop `path` is left out; the phone fetches bytes with
/// `attachment.read`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub message_id: String,
    pub session_id: String,
    /// `image` today.
    pub kind: String,
    pub mime_type: String,
    pub byte_size: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub created_at: String,
}

/// One visible conversation row. Converted from Core `PersistedMessageRow`
/// (`session.messages`) or `MessageBrief` (`message.persisted`, send
/// results); fields one source lacks are `null` (`MessageBrief` has no
/// `sequence`, tool calls, thinking, preamble or telemetry).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub session_id: String,
    pub role: MessageRole,
    pub content: String,
    pub turn_index: Option<i64>,
    pub sequence: Option<i64>,
    pub final_answer: Option<String>,
    pub summary: Option<String>,
    pub thinking: Option<String>,
    pub preamble: Option<String>,
    /// Core's persisted `tool_calls` JSON, parsed and passed through as
    /// is: an array of tool calls as the runner's `turn_end` carries them
    /// (`docs/ipc-protocol.md`). Large and owned by the runner protocol,
    /// so not typed here.
    pub tool_calls: Option<Value>,
    /// Same for `tool_results`.
    pub tool_results: Option<Value>,
    /// The question this row asked through `ask_user`, if any.
    pub ask_user: Option<AskUser>,
    pub telemetry: Option<MessageTelemetry>,
    pub goal_id: Option<String>,
    pub origin: Option<Origin>,
    pub attachments: Vec<Attachment>,
    pub created_at: String,
}

/// A queued (not yet persisted) user message (Core `QueuedMessage`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedMessage {
    /// Queue-local id, not a message id.
    pub queue_id: String,
    pub text: String,
    pub queued_at: String,
}
