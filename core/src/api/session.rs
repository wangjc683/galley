use serde::{Deserialize, Serialize};

use super::origin::Origin;

/// Opaque session identifier. Persisted shape is a short string like
/// `sess_abc123…`; treat as opaque on the agent side.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionId(pub String);

impl SessionId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for SessionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Session lifecycle states. Wire-compatible with the existing TS
/// `SessionStatus` union — snake_case on the JSON side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
}

/// GenericAgent runtime ownership for a session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeKind {
    /// Galley-owned managed / bundled GA runtime.
    Managed,
    /// User-owned attached GenericAgent checkout.
    External,
    /// Galley-owned native runtime. Hidden and experimental until the
    /// native worker reaches managed-GA parity.
    GalleyNative,
}

impl RuntimeKind {
    pub fn label(self) -> &'static str {
        match self {
            RuntimeKind::Managed => "Galley",
            RuntimeKind::External => "Attached GenericAgent",
            RuntimeKind::GalleyNative => "Galley Native",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_kind_serializes_native_as_snake_case() {
        let encoded = serde_json::to_string(&RuntimeKind::GalleyNative).unwrap();
        assert_eq!(encoded, r#""galley_native""#);
        let decoded: RuntimeKind = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, RuntimeKind::GalleyNative);
    }
}

/// Summary projection of a session — the fields a sidebar row needs.
/// "Brief" means: enough to list / display, not enough to render the
/// full conversation. For history, see [`super::MessageBrief`] plus
/// [`crate::api::GalleyApi::session_messages`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBrief {
    pub id: SessionId,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub title: String,
    pub status: SessionStatus,
    /// "Turn N · {one-line summary}" — used on the sidebar row.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_count: Option<u32>,
    /// ISO 8601. Drives sidebar bucket (today/week/earlier).
    pub last_activity_at: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    /// New activity arrived while this session wasn't the active one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_unread: Option<bool>,
    /// Where this session was created from. Optional for backward-compatible
    /// brief JSON; present for rows written after the sessions-origin
    /// migration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
    /// Last LLM the user picked for this session (`agent.set_llm` index).
    /// Kept for backwards compatibility and for the bridge's index-based
    /// command surface; new restore paths prefer `selectedLlmKey`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_llm_index: Option<u32>,
    /// Stable LLM identity for this session. Managed runtime stores
    /// Galley's `managed_models.id`; external runtime stores GA's raw
    /// `agent.list_llms()` name. This survives model reordering.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_llm_key: Option<String>,
    /// Display name of the persisted LLM. Cached alongside the index so
    /// the sidebar can label the pill before the bridge ready event
    /// re-confirms with the live `availableLLMs` list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_llm_display_name: Option<String>,
    /// CLI-facing alias for the runtime ownership. Kept alongside
    /// `gaRuntimeKind` during the managed-runtime transition so agents
    /// can speak in product terms while GUI code preserves its existing
    /// field.
    pub runtime_kind: RuntimeKind,
    pub runtime_label: String,
    pub ga_runtime_kind: RuntimeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ga_runtime_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_profile: Option<String>,
}

/// Filter / scope for `list_sessions`. All fields optional — None means
/// "no constraint on this dimension".
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFilter {
    pub project_id: Option<String>,
    pub status: Option<SessionStatus>,
    /// When None, archived sessions are excluded (matches GUI sidebar
    /// default). Set Some(true) to fetch only archived, Some(false) to
    /// force-exclude.
    pub archived: Option<bool>,
    /// When present, return sessions created for this runtime only.
    pub runtime_kind: Option<RuntimeKind>,
}

/// Payload for [`crate::api::GalleyApi::create_session`].
///
/// `id` is **caller-assigned**. The GUI currently mints
/// `s-<base36-timestamp>-<rand>` (see useAppStore.ts createSession); the
/// CLI / supervisor will follow the same shape. Rust-side id generation
/// would force the caller to round-trip before they know what to render —
/// the convention preserves the existing front-end optimistic-create
/// flow. Conflicts surface as `invalid_args` (`session id conflict`).
///
/// `title` is the seed title. The GUI passes the localized default
/// (`新对话`); the CLI / supervisor MUST pass a non-empty value.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub selected_llm_index: Option<u32>,
    #[serde(default)]
    pub selected_llm_key: Option<String>,
    #[serde(default)]
    pub selected_llm_display_name: Option<String>,
    #[serde(default)]
    pub ga_runtime_kind: Option<RuntimeKind>,
    #[serde(default)]
    pub ga_runtime_id: Option<String>,
    #[serde(default)]
    pub prompt_profile: Option<String>,
}
