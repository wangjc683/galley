use serde::{Deserialize, Serialize};

use super::origin::Origin;
use super::session::SessionId;

/// Opaque message identifier. The `messages.id` column is `TEXT` —
/// runner / GUI assign string ids like `msg_…`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MessageId(pub String);

/// Role of a message in the conversation history. Mirrors GA's roles
/// plus Galley's "system" pseudo-role for /btw side questions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    User,
    Agent,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageVisibility {
    Visible,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAttachmentBrief {
    pub id: String,
    pub message_id: MessageId,
    pub session_id: SessionId,
    pub kind: String,
    pub path: String,
    pub mime_type: String,
    pub byte_size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub created_at: String,
}

/// Optional per-final-answer usage metadata. Token fields are present only
/// when the runner can collect them without mutating user-owned GA runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageTelemetry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_create_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_used_chars: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_limit_chars: Option<i64>,
}

/// Summary of one persisted message. Full conversation rendering needs
/// more fields (tool calls, approvals, etc.); B1's read APIs surface
/// just enough for sidebar peek + agent CLI display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageBrief {
    pub id: MessageId,
    pub session_id: SessionId,
    pub role: MessageRole,
    pub content: String,
    /// Final answer produced by the runner when available. Assistant
    /// messages can have intermediate step content before this lands.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_answer: Option<String>,
    /// ISO 8601.
    pub created_at: String,
    /// One-line digest produced by the runner at turn_end; falls back
    /// to the first line of content when absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Turn index this message belongs to (the user_message that started
    /// the agent loop). Useful for grouping replies.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<MessageVisibility>,
    /// Goal this row belongs to (`messages.goal_id`, migration 031): the
    /// objective turn that opened a goal carries its id, so frontends
    /// bracket the goal episode by exact id. Additive (v0.4.17+).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<MessageAttachmentBrief>,
    /// Where this message came from (B2 M5+). Optional on read APIs to
    /// keep backward-compatible JSON shape; always present on
    /// `send_message` responses.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
}
