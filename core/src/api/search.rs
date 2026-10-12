use serde::{Deserialize, Serialize};

use super::{
    message::{MessageId, MessageRole},
    session::SessionId,
};

/// Where the search should look.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SearchScope {
    /// All messages, archived sessions included.
    All,
    /// Messages from non-archived sessions only.
    #[default]
    Active,
}

/// One match in the FTS5 trigram index.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub session_id: SessionId,
    pub message_id: MessageId,
    /// Highlighted excerpt — `<mark>…</mark>` surrounds matches; safe
    /// to insert as an HTML fragment.
    pub snippet: String,
    /// Lower = better (FTS5 BM25 ranking).
    pub rank: f64,
    /// When the message was written (ISO 8601), as `MessageBrief.createdAt`.
    /// Additive (2026-10-12): with `role` and `turnIndex`, a hit says
    /// when and by whom without a second read.
    pub created_at: String,
    /// `user / agent / system`, as `MessageBrief.role`. Additive (2026-10-12).
    pub role: MessageRole,
    /// The turn the message belongs to, as `MessageBrief.turnIndex`.
    /// Additive (2026-10-12).
    pub turn_index: u32,
}
