//! Sign in with ChatGPT (SIWC): Galley's ChatGPT-plan sign-in.
//!
//! The user authorizes Galley (under its own dynamically registered OAuth
//! client) to spend their ChatGPT plan's usage through `api.openai.com`.
//! It is the only sign-in of the ChatGPT provider (`mp_chatgpt_codex`,
//! auth kind `chatgpt_codex_oauth`: names kept from the removed Codex CLI
//! login, which borrowed the Codex CLI's identity; PRD rulings 5–6,
//! `.scratch/chatgpt-siwc/`). Its credential carries `"flow": "siwc"`;
//! anything else stored for the provider counts as no credential, and
//! the startup sweep in `legacy` deletes it.
//!
//! Submodules by domain: `login` (authorize URL, PKCE, pending sign-in,
//! code exchange), `callback` (the one-shot loopback redirect listener —
//! the narrow Rule 2 exception), `id_token` (RS256 / JWKS verification),
//! `secret` (credential + registration models, flow detection), `refresh`
//! (token resolution behind a per-ref gate), `probe` (model list and
//! connection test), `logout` (revocation), `legacy` (retiring Codex CLI
//! login credentials at startup). This file keeps the shared constants
//! and types, the typed error, the persistence step and the status read.

mod callback;
mod id_token;
mod legacy;
mod login;
mod logout;
mod probe;
mod refresh;
mod secret;
#[cfg(test)]
mod tests;

pub use legacy::{retire_codex_cli_credentials, LegacySweepOutcome};
pub use login::{
    cancel_login, complete_login, start_login, CancelChatgptPlanLoginInput, ChatgptPlanLoginStart,
    CompleteChatgptPlanLoginInput,
};
pub use logout::{logout, ChatgptPlanLogoutResult};
pub use probe::{
    list_model_slugs, list_models, test_connection, ChatgptPlanModel, ChatgptPlanModelList,
};
pub use refresh::resolve_access_token;
pub use secret::is_siwc_secret;

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::api::{
    ManagedModelAuthKind, ManagedModelConnectionResult, ManagedModelProtocol,
    ManagedModelProviderRecord, ManagedModelRecord,
};
use crate::commands::MANAGED_MODEL_DEFAULT_CONTEXT_WIN;
use crate::credential_store;
use crate::db::{SqliteGalley, UpsertManagedModelMetadata, UpsertManagedModelProviderMetadata};
use crate::error::GalleyError;

use secret::{read_registration, SiwcSecret};

/// The ChatGPT provider. The id (and [`CHATGPT_MODEL_ID`]) date from the
/// removed Codex CLI login and stay: stored models, sessions and the GUI
/// preset refer to them.
pub const CHATGPT_PROVIDER_ID: &str = "mp_chatgpt_codex";
/// The ChatGPT provider's model record a sign-in creates or takes over.
pub const CHATGPT_MODEL_ID: &str = "mm_chatgpt_codex_gpt_55";
/// Reasoning effort of a new ChatGPT model record and the probe default.
pub const DEFAULT_REASONING_EFFORT: &str = "medium";
/// The provider name the Codex CLI login gave it; a sign-in replaces it.
const LEGACY_PROVIDER_DISPLAY_NAME: &str = "ChatGPT / Codex";
/// The `flow` value that marks a Sign in with ChatGPT credential.
pub const SIWC_FLOW: &str = "siwc";
/// Inference base for ChatGPT-plan requests (also the OAuth `resource`).
pub const SIWC_API_BASE: &str = "https://api.openai.com/v1";
/// Fallback model for a sign-in that creates the model record while the
/// plan's catalog cannot be fetched or is empty. Normally the first entry
/// the catalog lists is the default (JC, 2026-10-20).
pub const SIWC_DEFAULT_MODEL: &str = "gpt-5.6-sol";
/// Provider name a plan sign-in gives the ChatGPT provider (matches the
/// GUI preset label). The Codex CLI login's default name is replaced by it;
/// a name the user chose is kept.
pub const SIWC_DISPLAY_NAME: &str = "ChatGPT";

const SIWC_ISSUER: &str = "https://auth.openai.com";
const SIWC_AUTHORIZE_URL: &str = "https://auth.openai.com/api/accounts/authorize";
const SIWC_TOKEN_URL: &str = "https://auth.openai.com/api/accounts/oauth/token";
const SIWC_REVOKE_URL: &str = "https://auth.openai.com/api/accounts/oauth/revoke";
const SIWC_JWKS_URL: &str = "https://auth.openai.com/.well-known/jwks.json";
const SIWC_RESOURCE: &str = SIWC_API_BASE;
const SIWC_SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/// The scope that lets Galley spend the user's plan usage.
const SIWC_PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
/// First sign-in on an installation registers a new client with this id.
const SIWC_DYNAMIC_CLIENT_ID: &str = "dynamic_agent_client";
const SIWC_AGENT_NAME_HINT: &str = "Galley";
const SIWC_CALLBACK_PATH: &str = "/auth/callback";
const SIWC_LOGIN_TIMEOUT_SECS: u64 = 10 * 60;
/// Credential-store ref of the per-installation registration (host id,
/// issued client id, last ID token, subject). Survives sign-out.
const SIWC_REGISTRATION_REF: &str = "chatgpt-siwc:registration";
const SIWC_PROBE_INSTRUCTIONS: &str =
    "This is a Galley model health check. Reply with a short acknowledgement.";
const REFRESH_SKEW_SECONDS: i64 = 120;
const HTTP_TIMEOUT_SECS: u64 = 20;
/// Token-endpoint error codes after which the refresh token is dead.
const TERMINAL_REFRESH_CODES: &[&str] = &[
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
];

/// The ChatGPT provider a command acts on; `None` is
/// [`CHATGPT_PROVIDER_ID`].
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptPlanProviderInput {
    #[serde(default)]
    pub provider_id: Option<String>,
}

/// What a completed sign-in stored and how its connection test went.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptPlanSetupResult {
    pub provider: ManagedModelProviderRecord,
    pub model: ManagedModelRecord,
    pub status: ManagedModelConnectionResult,
}

/// A usable access token, as the credential IPC hands it to managed GA.
/// Never the refresh token. SIWC access tokens carry no
/// `chatgpt_account_id` (probe, 2026-10-20), so there is no account id
/// to pass on.
#[derive(Debug, Clone)]
pub struct ResolvedAccessToken {
    pub access_token: String,
    pub expires_at: Option<i64>,
}

/// The preset-layer options of a new ChatGPT model record. `codex_backend`
/// is the managed engine's key for the ChatGPT backend (patch `0007`).
pub fn plan_default_advanced_options() -> Value {
    serde_json::json!({
        "context_win": MANAGED_MODEL_DEFAULT_CONTEXT_WIN,
        "api_mode": "responses",
        "reasoning_effort": DEFAULT_REASONING_EFFORT,
        "temperature": 1,
        "max_retries": 3,
        "connect_timeout": 10,
        "read_timeout": 180,
        "stream": true,
        "codex_backend": true
    })
}

/// Typed failures of the Sign in with ChatGPT commands. On the Tauri
/// transport each one is `{"error": "<code>", "message": "..."}` — the
/// same envelope as [`GalleyError`], with codes of its own so the GUI can
/// tell "the user said no" from "try again later". `Core` carries a plain
/// Galley error through unchanged.
#[derive(Debug, Clone)]
pub enum ChatgptPlanError {
    /// The user declined on the consent screen (`error=access_denied`).
    AccessDenied(String),
    /// Signed in, but the grant lacks `chatgpt.tokens.use.direct`.
    UsageNotGranted(String),
    /// The pending sign-in was cancelled or replaced by a newer one.
    LoginCancelled(String),
    /// No callback arrived within the sign-in window.
    LoginTimedOut(String),
    /// No pending sign-in has this id (or it is already being completed).
    LoginNotFound(String),
    /// The refresh token is dead; the user must sign in again.
    ReauthRequired(String),
    /// Network error / 5xx / 429: credentials kept, retry later.
    Temporary(String),
    /// Any other failure: sign-in, token exchange, ID token verification,
    /// model list or model test (the message carries HTTP status and code).
    Failed(String),
    Core(GalleyError),
}

impl ChatgptPlanError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::AccessDenied(_) => "chatgpt_plan_access_denied",
            Self::UsageNotGranted(_) => "chatgpt_plan_usage_not_granted",
            Self::LoginCancelled(_) => "chatgpt_plan_login_cancelled",
            Self::LoginTimedOut(_) => "chatgpt_plan_login_timed_out",
            Self::LoginNotFound(_) => "chatgpt_plan_login_not_found",
            Self::ReauthRequired(_) => "chatgpt_plan_reauth_required",
            Self::Temporary(_) => "chatgpt_plan_temporary",
            Self::Failed(_) => "chatgpt_plan_failed",
            Self::Core(_) => "core",
        }
    }

    pub fn message(&self) -> String {
        match self {
            Self::AccessDenied(m)
            | Self::UsageNotGranted(m)
            | Self::LoginCancelled(m)
            | Self::LoginTimedOut(m)
            | Self::LoginNotFound(m)
            | Self::ReauthRequired(m)
            | Self::Temporary(m)
            | Self::Failed(m) => m.clone(),
            Self::Core(e) => e.to_string(),
        }
    }

    /// The Tauri error string: `{"error": "<code>", "message": "..."}`.
    pub fn to_wire(&self) -> String {
        if let Self::Core(e) = self {
            return serde_json::to_string(e).unwrap_or_else(|_| e.to_string());
        }
        serde_json::json!({ "error": self.code(), "message": self.message() }).to_string()
    }
}

impl std::fmt::Display for ChatgptPlanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Core(e) => write!(f, "{e}"),
            other => write!(f, "{}: {}", other.code(), other.message()),
        }
    }
}

impl std::error::Error for ChatgptPlanError {}

impl From<GalleyError> for ChatgptPlanError {
    fn from(e: GalleyError) -> Self {
        Self::Core(e)
    }
}

/// For paths that speak [`GalleyError`] (credential IPC, the generic
/// connection probe): the plan code leads the message so the runner and
/// the GUI can still recognize it.
impl From<ChatgptPlanError> for GalleyError {
    fn from(e: ChatgptPlanError) -> Self {
        match e {
            ChatgptPlanError::Core(e) => e,
            ChatgptPlanError::Temporary(_) => GalleyError::RunnerError {
                message: format!("{}: {}", e.code(), e.message()),
            },
            other => GalleyError::InvalidArgs {
                message: format!("{}: {}", other.code(), other.message()),
            },
        }
    }
}

pub(crate) type PlanResult<T> = std::result::Result<T, ChatgptPlanError>;

/// What the GUI needs to draw the ChatGPT card without ever seeing a
/// token: whether the stored credential is usable, needs a new sign-in,
/// or is absent.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptPlanStatus {
    /// `"siwc"` when a Sign in with ChatGPT credential is stored, else
    /// `null` (a leftover Codex CLI login credential counts as none).
    pub flow: Option<&'static str>,
    pub signed_in: bool,
    /// A SIWC credential whose tokens were cleared after a dead refresh.
    pub needs_reauth: bool,
    /// This installation has a SIWC client registration (kept on sign-out).
    pub registered: bool,
    pub scopes: Vec<String>,
    pub expires_at: Option<i64>,
    pub last_refresh_at: Option<String>,
    pub last_refresh_error: Option<String>,
}

pub async fn status(
    galley: &SqliteGalley,
    provider_id: Option<String>,
) -> PlanResult<ChatgptPlanStatus> {
    let api_key_ref = provider_api_key_ref(galley, provider_id).await?;
    let registered = read_registration(galley)
        .await?
        .and_then(|r| r.client_id)
        .is_some();
    let raw = credential_store::try_get_secret(galley, &api_key_ref).await?;
    Ok(status_from_secret(raw.as_deref(), registered))
}

pub(super) fn status_from_secret(raw: Option<&str>, registered: bool) -> ChatgptPlanStatus {
    let mut status = ChatgptPlanStatus {
        flow: None,
        signed_in: false,
        needs_reauth: false,
        registered,
        scopes: Vec::new(),
        expires_at: None,
        last_refresh_at: None,
        last_refresh_error: None,
    };
    let Some(raw) = raw.filter(|raw| !raw.trim().is_empty()) else {
        return status;
    };
    if !is_siwc_secret(raw) {
        return status;
    }
    status.flow = Some(SIWC_FLOW);
    match serde_json::from_str::<SiwcSecret>(raw) {
        Ok(secret) => {
            status.signed_in = secret.has_tokens();
            status.needs_reauth = !secret.has_tokens();
            status.scopes = secret.scopes.clone();
            status.expires_at = secret.expires_at;
            status.last_refresh_at = secret.last_refresh_at.clone();
            status.last_refresh_error = secret.last_refresh_error.clone();
        }
        Err(_) => status.needs_reauth = true,
    }
    status
}

/// The credential ref of the ChatGPT provider: the stored provider's
/// `api_key_ref`, or the default ref for its id.
pub(super) async fn provider_api_key_ref(
    galley: &SqliteGalley,
    provider_id: Option<String>,
) -> PlanResult<String> {
    let provider_id = provider_id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| CHATGPT_PROVIDER_ID.into());
    Ok(galley
        .list_managed_model_providers()
        .await?
        .into_iter()
        .find(|provider| provider.id == provider_id)
        .map(|provider| provider.api_key_ref)
        .unwrap_or_else(|| credential_store::managed_provider_api_key_ref(&provider_id)))
}

/// The provider name after a plan sign-in: a new provider, or one still
/// carrying the Codex CLI login's default name, becomes
/// [`SIWC_DISPLAY_NAME`]; any other name is the user's and stays.
pub(super) fn plan_provider_display_name(existing: Option<&str>) -> String {
    match existing.map(str::trim) {
        Some(name) if !name.is_empty() && name != LEGACY_PROVIDER_DISPLAY_NAME => name.to_string(),
        _ => SIWC_DISPLAY_NAME.to_string(),
    }
}

/// Persist a fresh SIWC credential, take over the ChatGPT provider and
/// its model record, then run one connection test.
async fn persist_and_probe(
    galley: &SqliteGalley,
    secret: SiwcSecret,
    http: &reqwest::Client,
) -> PlanResult<ChatgptPlanSetupResult> {
    let api_key_ref = credential_store::managed_provider_api_key_ref(CHATGPT_PROVIDER_ID);
    {
        // Under the refresh gate: a refresh already in flight for this
        // ref must not overwrite the credential we are about to store.
        let gate = refresh::refresh_gate(&api_key_ref);
        let _guard = gate.lock().await;
        refresh::save_secret(galley, &api_key_ref, &secret).await?;
    }
    let existing_provider = galley
        .list_managed_model_providers()
        .await?
        .into_iter()
        .find(|provider| provider.id == CHATGPT_PROVIDER_ID);
    let provider = galley
        .upsert_managed_model_provider_metadata(UpsertManagedModelProviderMetadata {
            id: CHATGPT_PROVIDER_ID.into(),
            display_name: plan_provider_display_name(
                existing_provider
                    .as_ref()
                    .map(|provider| provider.display_name.as_str()),
            ),
            protocol: ManagedModelProtocol::Openai,
            auth_kind: ManagedModelAuthKind::ChatgptCodexOauth,
            api_base: SIWC_API_BASE.into(),
            api_key_ref: api_key_ref.clone(),
        })
        .await?;

    // Best effort: an unreachable model list must not fail a sign-in
    // that already succeeded; the stored slug (or the default) stands.
    let visible = probe::fetch_visible_models(http, &secret.access_token)
        .await
        .ok()
        .map(|models| models.into_iter().map(|m| m.slug).collect::<Vec<_>>());
    let existing_model = galley
        .list_managed_models()
        .await?
        .into_iter()
        .find(|model| model.id == CHATGPT_MODEL_ID);
    let upsert = plan_model_upsert(existing_model.as_ref(), visible.as_deref());
    let model = galley.upsert_managed_model_metadata(upsert).await?;

    let effort = model
        .advanced_options
        .get("reasoning_effort")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_REASONING_EFFORT)
        .to_string();
    let probed =
        probe::probe_with_access_token(http, &secret.access_token, &model.model, &effort).await;
    let probed = probe::clear_if_revoked(galley, &api_key_ref, &secret.access_token, probed).await;
    let status = match probed {
        Ok(status) => status,
        // The credential, provider and model are stored: a failing
        // probe is a connection status, not a failed sign-in.
        Err(e) => ManagedModelConnectionResult {
            ok: false,
            endpoint: format!("{SIWC_API_BASE}/responses"),
            model_found: None,
            message: e.message(),
        },
    };
    Ok(ChatgptPlanSetupResult {
        provider,
        model,
        status,
    })
}

/// The model record a sign-in writes. `visible` is the plan catalog's
/// `visibility == "list"` slugs in the order `/v1/models` returns them.
/// The existing `mm_chatgpt_codex_gpt_55` keeps its slug when the catalog
/// lists it (the user's choice); otherwise it moves to the catalog's first
/// entry, the plan's default. Without a catalog (unreachable or empty) the
/// stored slug stands, and a new record gets [`SIWC_DEFAULT_MODEL`]. A
/// display name that merely echoed the old slug follows the new one; a
/// user-chosen name and the stored option layers are kept.
pub(super) fn plan_model_upsert(
    existing: Option<&ManagedModelRecord>,
    visible: Option<&[String]>,
) -> UpsertManagedModelMetadata {
    let current = existing
        .map(|model| model.model.trim())
        .filter(|s| !s.is_empty());
    // An empty list says nothing about what the plan offers.
    let visible = visible.filter(|visible| !visible.is_empty());
    let slug = match (current, visible) {
        (Some(current), Some(visible)) if visible.iter().any(|s| s == current) => {
            current.to_string()
        }
        (_, Some(visible)) => visible[0].clone(),
        (Some(current), None) => current.to_string(),
        (None, None) => SIWC_DEFAULT_MODEL.to_string(),
    };
    match existing {
        Some(model) => {
            let display = model.display_name.trim();
            let display_name = if display.is_empty() || display == model.model.trim() {
                slug.clone()
            } else {
                display.to_string()
            };
            UpsertManagedModelMetadata {
                id: CHATGPT_MODEL_ID.into(),
                provider_id: CHATGPT_PROVIDER_ID.into(),
                display_name,
                model: slug,
                preset_options: None,
                advanced_overrides: None,
                make_default: false,
            }
        }
        None => UpsertManagedModelMetadata {
            id: CHATGPT_MODEL_ID.into(),
            provider_id: CHATGPT_PROVIDER_ID.into(),
            display_name: slug.clone(),
            model: slug,
            preset_options: Some(plan_default_advanced_options()),
            advanced_overrides: Some(serde_json::json!({})),
            make_default: false,
        },
    }
}

/// `Galley (<os>; <arch>)` — the User-Agent of every SIWC request. The
/// names follow Python's `platform.system()` / `platform.machine()` so
/// Core and the managed runner (ticket 03) send the same string.
pub fn galley_user_agent() -> String {
    format!("Galley ({}; {})", platform_system(), platform_machine())
}

fn platform_system() -> &'static str {
    match std::env::consts::OS {
        "macos" => "Darwin",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    }
}

fn platform_machine() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "arm64",
        ("windows", "x86_64") => "AMD64",
        ("windows", "aarch64") => "ARM64",
        (_, arch) => arch,
    }
}

fn http_client() -> PlanResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .user_agent(galley_user_agent())
        .build()
        .map_err(|e| {
            ChatgptPlanError::Core(GalleyError::Internal {
                message: format!("building HTTP client: {e}"),
            })
        })
}

/// The error code of an OAuth or OpenAI error body: `{"error": "<code>"}`
/// (OAuth), `{"error": {"code": "<code>"}}` (OpenAI), or a top-level
/// `code`.
pub(super) fn error_code_from_body(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let code = match value.get("error") {
        Some(Value::String(code)) => Some(code.as_str()),
        Some(Value::Object(error)) => error
            .get("code")
            .and_then(Value::as_str)
            .or_else(|| error.get("type").and_then(Value::as_str)),
        _ => value.get("code").and_then(Value::as_str),
    }?;
    let code = code.trim();
    (!code.is_empty()).then(|| code.to_string())
}

/// A short, single-line excerpt of a response body with every known
/// secret replaced — error bodies are shown to the user.
pub(super) fn compact_body_redacted(body: &str, secrets: &[&str]) -> String {
    let mut redacted = body.to_string();
    for secret in secrets {
        let secret = secret.trim();
        if !secret.is_empty() {
            redacted = redacted.replace(secret, "[redacted]");
        }
    }
    let trimmed = redacted.trim().replace(['\n', '\r'], " ");
    if trimmed.chars().count() <= 240 {
        return trimmed;
    }
    let prefix: String = trimmed.chars().take(240).collect();
    format!("{prefix}...")
}
