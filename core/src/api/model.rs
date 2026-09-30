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
    /// The preset-layer baseline written at creation (never user-edited).
    pub preset_options: serde_json::Value,
    /// The model's own deviations from `preset ⊕ defaults`; `null` values
    /// are tombstones. See `managed_model_layers`.
    pub advanced_overrides: serde_json::Value,
    /// Effective `preset ⊕ defaults ⊕ overrides` — what the runtime uses.
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
    /// Preset-layer seed. Required semantics: on create it is merged over
    /// the protocol defaults; on edit `None` keeps the stored baseline.
    #[serde(default)]
    pub preset_options: Option<serde_json::Value>,
    /// Replaces the stored overrides wholesale; `None` / `{}` clears them.
    #[serde(default)]
    pub advanced_overrides: Option<serde_json::Value>,
    pub make_default: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetManagedModelDefaultsInput {
    pub defaults: serde_json::Value,
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

/// One selectable model of the managed (Galley-owned) runtime, as every
/// by-name LLM surface sees it: `galley llm list` in managed scope, and
/// the `llm.set` / `session.new --llm` resolver. Built only by
/// [`managed_llm_choices`], so the names the list prints are exactly the
/// names the resolver accepts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedLlmChoice {
    /// Position among the selectable models, from 0 — the model index the
    /// managed runtime is spawned / `SetLlm`-switched with. Index 0 is the
    /// model a runtime started without a model pick uses (the Galley
    /// default, or the next usable model when the default lacks a
    /// credential).
    pub index: u32,
    /// Managed model record id — the stable `selectedLlmKey`.
    pub key: String,
    /// Display name; falls back to the provider model id when blank.
    pub display_name: String,
    /// Provider model id. The resolver accepts it as an alias.
    pub model: String,
}

/// Enumerate the selectable managed models in runtime order. `models`
/// must come from `SqliteGalley::list_managed_models` (sort order, then
/// default first). Models whose credential is `Missing` are skipped and do
/// not consume an index, mirroring the credential filter the runtime
/// applies at spawn.
pub fn managed_llm_choices(models: Vec<ManagedModelRecord>) -> Vec<ManagedLlmChoice> {
    models
        .into_iter()
        .filter(|model| model.credential_status != ManagedModelCredentialStatus::Missing)
        .enumerate()
        .map(|(index, model)| ManagedLlmChoice {
            index: index as u32,
            display_name: managed_model_display_name(&model.display_name, &model.model),
            key: model.id,
            model: model.model,
        })
        .collect()
}

/// The name a managed model is shown and matched by: the trimmed display
/// name, or the provider model id when the display name is blank.
pub fn managed_model_display_name(display_name: &str, model: &str) -> String {
    let trimmed = display_name.trim();
    if trimmed.is_empty() {
        model.to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(
        id: &str,
        display_name: &str,
        model: &str,
        credential: ManagedModelCredentialStatus,
    ) -> ManagedModelRecord {
        ManagedModelRecord {
            id: id.into(),
            provider_id: "mp".into(),
            provider_display_name: "Provider".into(),
            display_name: display_name.into(),
            protocol: ManagedModelProtocol::Openai,
            auth_kind: ManagedModelAuthKind::ApiKey,
            api_base: "https://example.test/v1".into(),
            model: model.into(),
            api_key_ref: "managed-provider:mp".into(),
            preset_options: serde_json::json!({}),
            advanced_overrides: serde_json::json!({}),
            advanced_options: serde_json::json!({}),
            is_default: false,
            sort_order: 0,
            credential_status: credential,
            last_validated_at: None,
            created_at: "2026-09-30T00:00:00Z".into(),
            updated_at: "2026-09-30T00:00:00Z".into(),
        }
    }

    #[test]
    fn managed_llm_choices_skip_missing_credentials_without_consuming_an_index() {
        use ManagedModelCredentialStatus::{Missing, Present, Unknown};
        let choices = managed_llm_choices(vec![
            record("mm_gone", "Gone", "gone-1", Missing),
            record("mm_a", "  Alpha  ", "alpha-1", Present),
            record("mm_b", "   ", "beta-1", Unknown),
            record("mm_gone2", "Gone 2", "gone-2", Missing),
            record("mm_c", "Gamma", "gamma-1", Present),
        ]);
        let expected = vec![
            ManagedLlmChoice {
                index: 0,
                key: "mm_a".into(),
                display_name: "Alpha".into(),
                model: "alpha-1".into(),
            },
            ManagedLlmChoice {
                index: 1,
                key: "mm_b".into(),
                display_name: "beta-1".into(),
                model: "beta-1".into(),
            },
            ManagedLlmChoice {
                index: 2,
                key: "mm_c".into(),
                display_name: "Gamma".into(),
                model: "gamma-1".into(),
            },
        ];
        assert_eq!(choices, expected);
    }

    #[test]
    fn managed_llm_choices_empty_library_is_empty() {
        assert!(managed_llm_choices(Vec::new()).is_empty());
    }
}
