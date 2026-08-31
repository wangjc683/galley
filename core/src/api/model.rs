use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedModelProtocol {
    Anthropic,
    Openai,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedModelAuthKind {
    ApiKey,
    ChatgptCodexOauth,
    /// No-auth endpoint (e.g. a local Ollama or LAN gateway): no secret
    /// is stored, and requests go out with an empty credential — the GA
    /// engine sends the auth header unconditionally, so an empty value
    /// is equivalent to GA's hand-edited empty `mykey.py` key.
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagedModelCredentialStatus {
    /// A managed Provider has a stored local secret row.
    Present,
    /// The Provider metadata exists but the secret should be re-saved.
    Missing,
    /// Reserved for future system credential backends where passive list paths
    /// should not probe secure storage.
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedModelProviderRecord {
    pub id: String,
    pub display_name: String,
    pub protocol: ManagedModelProtocol,
    pub auth_kind: ManagedModelAuthKind,
    pub api_base: String,
    pub api_key_ref: String,
    pub credential_status: ManagedModelCredentialStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveManagedProviderInput {
    pub id: Option<String>,
    pub display_name: Option<String>,
    pub protocol: ManagedModelProtocol,
    #[serde(default)]
    pub auth_kind: Option<ManagedModelAuthKind>,
    pub api_base: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedModelRecord {
    pub id: String,
    pub provider_id: String,
    pub provider_display_name: String,
    pub display_name: String,
    pub protocol: ManagedModelProtocol,
    pub auth_kind: ManagedModelAuthKind,
    pub api_base: String,
    pub model: String,
    pub api_key_ref: String,
    pub advanced_options: serde_json::Value,
    pub is_default: bool,
    pub sort_order: i64,
    pub credential_status: ManagedModelCredentialStatus,
    pub last_validated_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveManagedModelInput {
    pub id: Option<String>,
    pub provider_id: String,
    pub display_name: Option<String>,
    pub model: String,
    pub advanced_options: Option<serde_json::Value>,
    pub make_default: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderManagedModelsInput {
    pub model_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedModelProbeInput {
    pub id: Option<String>,
    pub provider_id: Option<String>,
    pub protocol: ManagedModelProtocol,
    #[serde(default)]
    pub auth_kind: Option<ManagedModelAuthKind>,
    pub api_base: String,
    pub api_key: Option<String>,
    pub model: Option<String>,
    #[serde(default)]
    pub advanced_options: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedModelListResult {
    pub models: Vec<String>,
    pub endpoint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedModelConnectionResult {
    pub ok: bool,
    pub endpoint: String,
    pub model_found: Option<bool>,
    pub message: String,
}
