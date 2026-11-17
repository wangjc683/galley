//! Lightweight provider probes for managed model setup.
//!
//! This is intentionally not a full inference call. The setup flow only needs
//! to verify that the endpoint and credential can talk to the provider, and
//! optionally offer model ids. A real first conversation still exercises the
//! runtime path in M5.
//!
//! The test payload deliberately carries one minimal tool definition in the
//! protocol's native shape (Anthropic `input_schema` vs OpenAI `function`).
//! Galley always runs as an agent, so every real request includes tools; a
//! gateway that accepts plain chat but mistranslates tool schemas would
//! otherwise pass a tool-free probe and only fail on the first real message.

use std::time::Duration;

use ring::rand::{SecureRandom, SystemRandom};
use serde_json::Value;

use crate::api::{
    ManagedModelAuthKind, ManagedModelConnectionResult, ManagedModelListResult,
    ManagedModelProbeInput, ManagedModelProtocol,
};
use crate::chatgpt_siwc;
use crate::credential_store;
use crate::db::SqliteGalley;
use crate::error::{GalleyError, Result};

const PROBE_TIMEOUT_SECS: u64 = 20;

pub async fn list_models(input: ManagedModelProbeInput) -> Result<ManagedModelListResult> {
    if input.auth_kind == Some(ManagedModelAuthKind::ChatgptCodexOauth) {
        // The ChatGPT provider lists its plan's catalog (Sign in with
        // ChatGPT); without a usable sign-in this answers "sign in".
        let api_key_ref = resolve_api_key_ref(&input).await?;
        let galley = SqliteGalley::open().await?;
        return chatgpt_siwc::list_model_slugs(&galley, &api_key_ref)
            .await
            .map_err(Into::into);
    }
    let secret = resolve_secret(&input).await?;
    let endpoint = models_endpoint(&input.api_base)?;
    let client = probe_client()?;
    // The same headers as "Test model" (the engine never lists models, so
    // there is nothing else to mirror). A list belongs to a provider, not
    // to a model: no `[1m]` beta.
    let claude_code = ClaudeCodeIdentity::for_probe(&input)?;
    let req = apply_probe_headers(
        client.get(&endpoint),
        &input,
        &secret,
        false,
        claude_code.as_ref(),
    );
    let resp = req.send().await.map_err(|e| GalleyError::RunnerError {
        message: format!("model list request failed: {e}"),
    })?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| GalleyError::RunnerError {
        message: format!("reading model list response failed: {e}"),
    })?;
    if !status.is_success() {
        return Err(GalleyError::InvalidArgs {
            message: format!(
                "无法获取模型列表，可手动添加（HTTP {}: {}）",
                status.as_u16(),
                compact_body(&body)
            ),
        });
    }
    let json: Value = serde_json::from_str(&body).map_err(|e| GalleyError::InvalidArgs {
        message: format!("model list response is not JSON: {e}"),
    })?;
    let mut models = extract_model_ids(&json);
    models.sort();
    models.dedup();
    Ok(ManagedModelListResult { models, endpoint })
}

pub async fn test_connection(
    input: ManagedModelProbeInput,
) -> Result<ManagedModelConnectionResult> {
    let target_model = input
        .model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);
    if let Some(model) = target_model {
        return test_model(input, model).await;
    }

    let listed = list_models(input).await?;
    Ok(ManagedModelConnectionResult {
        ok: true,
        endpoint: listed.endpoint,
        model_found: None,
        message: "连接可用".into(),
    })
}

async fn test_model(
    input: ManagedModelProbeInput,
    model: String,
) -> Result<ManagedModelConnectionResult> {
    if input.auth_kind == Some(ManagedModelAuthKind::ChatgptCodexOauth) {
        let api_key_ref = resolve_api_key_ref(&input).await?;
        let reasoning = input
            .advanced_options
            .as_ref()
            .and_then(|value| value.get("reasoning_effort"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or(chatgpt_siwc::DEFAULT_REASONING_EFFORT);
        let galley = SqliteGalley::open().await?;
        return chatgpt_siwc::test_connection(&galley, &api_key_ref, &model, reasoning)
            .await
            .map_err(Into::into);
    }
    let secret = resolve_secret(&input).await?;
    let endpoint = inference_endpoint(&input.api_base, input.protocol)?;
    let client = probe_client()?;
    let (status, body) = match input.protocol {
        ManagedModelProtocol::Anthropic => {
            let claude_code = ClaudeCodeIdentity::for_probe(&input)?;
            let (model, context_1m) = split_context_1m(&model);
            let req = client
                .post(&endpoint)
                .json(&anthropic_probe_payload(&model, claude_code.as_ref()));
            send_model_test(apply_probe_headers(
                req,
                &input,
                &secret,
                context_1m,
                claude_code.as_ref(),
            ))
            .await?
        }
        ManagedModelProtocol::Openai => {
            let request = |key: TokenCapKey| {
                let req = client
                    .post(&endpoint)
                    .json(&openai_probe_payload(&model, key));
                apply_probe_headers(req, &input, &secret, false, None)
            };
            let key = TokenCapKey::guess(&model);
            let first = send_model_test(request(key)).await?;
            // A wrong guess, as the provider names it, goes again once with
            // the other key; the second answer is the result.
            match token_cap_key_retry(first.0.as_u16(), &first.1, key) {
                Some(other) => send_model_test(request(other)).await?,
                None => first,
            }
        }
    };
    if !status.is_success() {
        return Err(GalleyError::InvalidArgs {
            message: format!(
                "模型测试失败（HTTP {}: {}）",
                status.as_u16(),
                compact_body(&body)
            ),
        });
    }
    Ok(ManagedModelConnectionResult {
        ok: true,
        endpoint,
        model_found: Some(true),
        message: "模型可用".into(),
    })
}

fn probe_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
        .build()
        .map_err(|e| GalleyError::Internal {
            message: format!("building HTTP client: {e}"),
        })
}

/// Sends one "Test model" request: its status and body.
async fn send_model_test(req: reqwest::RequestBuilder) -> Result<(reqwest::StatusCode, String)> {
    let resp = req.send().await.map_err(|e| GalleyError::RunnerError {
        message: format!("model test request failed: {e}"),
    })?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| GalleyError::RunnerError {
        message: format!("reading model test response failed: {e}"),
    })?;
    Ok((status, body))
}

async fn resolve_secret(input: &ManagedModelProbeInput) -> Result<String> {
    if let Some(secret) = input
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Ok(secret.to_string());
    }
    if input.auth_kind == Some(ManagedModelAuthKind::None) {
        // No-auth endpoint: probe with an empty credential (the auth
        // header still goes out, mirroring the GA engine's behavior).
        return Ok(String::new());
    }
    let has_id = input
        .provider_id
        .as_deref()
        .or(input.id.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();
    if !has_id {
        return Err(GalleyError::InvalidArgs {
            message: "API key is required before testing this provider".into(),
        });
    }
    let galley = SqliteGalley::open().await?;
    let api_key_ref = resolve_api_key_ref(input).await?;
    credential_store::get_secret(&galley, &api_key_ref).await
}

async fn resolve_api_key_ref(input: &ManagedModelProbeInput) -> Result<String> {
    let id = input
        .provider_id
        .as_deref()
        .or(input.id.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| GalleyError::InvalidArgs {
            message: "managed provider id is required before testing this provider".into(),
        })?;
    let galley = SqliteGalley::open().await?;
    galley
        .list_managed_model_providers()
        .await?
        .into_iter()
        .find(|provider| provider.id == id)
        .map(|provider| provider.api_key_ref)
        .ok_or_else(|| GalleyError::InvalidArgs {
            message: format!("managed provider {id} not found"),
        })
}

// What the managed engine (`managed-ga/code/llmcore.py`) puts on its
// requests, mirrored in one place. "Test model" passing has to mean a
// conversation will pass, and a provider can decide on headers alone (on
// 2026-11-17 the official Anthropic API refused a subscription's API credit
// to a request that said it was Claude Code), so for the same provider and
// model the probe sends the headers the engine sends.
// `runner/tests/test_managed_ga_probe_parity.py` reads these constants back
// and compares them with the payload's `llmcore.py`: when a baseline upgrade
// changes the engine's values that test goes red, and the fix is here.
// Mirrored: the headers below and, on an Anthropic-protocol request that
// says it is Claude Code, the body's `metadata.user_id`. Not mirrored:
// OpenAI's `Accept: text/event-stream` (the engine streams, the probe does
// not), the rest of the body (system prompt, thinking and effort,
// `cache_control`, passthrough's Claude Code system prompt), the OpenAI
// `responses` endpoint. Galley's model config never sets the engine's
// `user_agent`, so the engine sends its class defaults below.

/// `NativeClaudeSession.native_ua`: the user agent of an Anthropic-protocol
/// engine request that says it is Claude Code.
const ENGINE_CLAUDE_USER_AGENT: &str = "claude-cli/2.1.280 (native, cli)";

/// `NativeOAISession.native_ua`: the user agent of every OpenAI-protocol
/// engine request (`_openai_stream` sends the session's `user_agent`, which
/// `NativeClaudeSession.__init__` sets to the class's `native_ua`).
const ENGINE_OPENAI_USER_AGENT: &str =
    "codex_exec/0.139.0 (Windows 10.0.26200; x86_64) unknown (codex_exec; 0.139.0)";

/// `_openai_stream`'s `originator` header.
const ENGINE_OPENAI_ORIGINATOR: &str = "codex_exec";

/// Claude Code's own `anthropic-beta` entry, first in [`ENGINE_ANTHROPIC_BETAS`].
const CLAUDE_CODE_BETA: &str = "claude-code-20250219";

/// `NativeClaudeSession.raw_ask`'s `beta_parts`, in order.
const ENGINE_ANTHROPIC_BETAS: [&str; 9] = [
    CLAUDE_CODE_BETA,
    "interleaved-thinking-2025-05-14",
    "redact-thinking-2026-02-12",
    "thinking-token-count-2026-05-13",
    "context-management-2025-06-27",
    "prompt-caching-scope-2026-01-05",
    "mid-conversation-system-2026-04-07",
    "effort-2025-11-24",
    "fallback-credit-2026-06-01",
];

/// A model id that contains this, in any case, asks for the 1M-token
/// context (see [`split_context_1m`]).
const ENGINE_CONTEXT_1M_MARKER: &str = "[1m]";

/// The beta `raw_ask` inserts for a `[1m]` model, and where.
const ENGINE_CONTEXT_1M_BETA: &str = "context-1m-2025-08-07";
const ENGINE_CONTEXT_1M_BETA_AT: usize = 1;

/// The fixed headers of every Anthropic-protocol engine request, whether it
/// says it is Claude Code or not. (`Content-Type: application/json` comes
/// from reqwest's `.json()`.)
const ENGINE_ANTHROPIC_HEADERS: [(&str, &str); 3] = [
    ("anthropic-version", "2023-06-01"),
    ("anthropic-dangerous-direct-browser-access", "true"),
    ("Accept", "application/json"),
];

/// The fixed headers an Anthropic-protocol engine request adds when it says
/// it is Claude Code: `x-app` and Claude Code's `X-Stainless-*` set.
const ENGINE_CLAUDE_CODE_HEADERS: [(&str, &str); 9] = [
    ("x-app", "cli"),
    ("X-Stainless-Arch", "x64"),
    ("X-Stainless-Lang", "js"),
    ("X-Stainless-OS", "Windows"),
    ("X-Stainless-Package-Version", "0.94.0"),
    ("X-Stainless-Retry-Count", "0"),
    ("X-Stainless-Runtime", "node"),
    ("X-Stainless-Runtime-Version", "v24.3.0"),
    ("X-Stainless-Timeout", "600"),
];

/// The header carrying [`ClaudeCodeIdentity::session_id`].
const ENGINE_CLAUDE_CODE_SESSION_HEADER: &str = "X-Claude-Code-Session-Id";

/// The host of Anthropic's official API.
const OFFICIAL_ANTHROPIC_HOST: &str = "api.anthropic.com";

/// Whether `api_base`'s host is exactly the official Anthropic API: trimmed
/// (as saving a provider trims it, so the engine gets it trimmed), parsed
/// as a URL, compared lowercased. A base with no scheme has no host and is
/// not; neither is a host that merely contains or ends in it. Same rule as
/// the managed runtime's `NativeClaudeSession.raw_ask` (managed patch
/// `0032`), so the probe and the engine agree on one endpoint.
fn is_official_anthropic_host(api_base: &str) -> bool {
    reqwest::Url::parse(api_base.trim())
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
        .is_some_and(|host| host == OFFICIAL_ANTHROPIC_HOST)
}

/// Whether an Anthropic-protocol probe says it is Claude Code
/// (`user-agent: claude-cli/…`, `x-app: cli`, the `claude-code-20250219`
/// beta, the session and Stainless headers). Toward the official API the
/// answer is always no, whether the model's "Claude Code passthrough"
/// (`fake_cc_system_prompt`) is on or off: the official API refuses a Claude
/// subscription's API credit to a request carrying those markers, with a
/// misleading "credit balance is too low" 400. Every other endpoint keeps
/// them.
fn sends_claude_code_identity(input: &ManagedModelProbeInput) -> bool {
    !is_official_anthropic_host(&input.api_base)
}

/// The Claude Code session of an Anthropic-protocol probe that says it is
/// Claude Code, fresh for every probe as the engine's is for every session
/// (`NativeClaudeSession.__init__`).
struct ClaudeCodeIdentity {
    /// `str(uuid.uuid4())`: [`ENGINE_CLAUDE_CODE_SESSION_HEADER`] and the
    /// user id's `session_id`.
    session_id: String,
    /// `uuid.uuid4().hex + uuid.uuid4().hex[:32]`: 64 hex digits.
    device_id: String,
}

/// `metadata.user_id`, field for field and in the engine's order.
#[derive(serde::Serialize)]
struct ClaudeCodeUserId<'a> {
    device_id: &'a str,
    account_uuid: &'a str,
    session_id: &'a str,
}

impl ClaudeCodeIdentity {
    /// `Some` for an Anthropic-protocol probe that says it is Claude Code
    /// ([`sends_claude_code_identity`]); `None` toward the official API,
    /// and for OpenAI.
    fn for_probe(input: &ManagedModelProbeInput) -> Result<Option<Self>> {
        if input.protocol != ManagedModelProtocol::Anthropic || !sends_claude_code_identity(input) {
            return Ok(None);
        }
        Ok(Some(Self {
            session_id: uuid_hyphenated(&random_uuid_v4()?),
            device_id: format!("{}{}", hex(&random_uuid_v4()?), hex(&random_uuid_v4()?)),
        }))
    }

    /// The body's `metadata.user_id`: what the engine's
    /// `json.dumps({...}, separators=(',', ':'))` writes.
    fn user_id(&self) -> String {
        serde_json::to_string(&ClaudeCodeUserId {
            device_id: &self.device_id,
            account_uuid: "",
            session_id: &self.session_id,
        })
        .unwrap_or_default()
    }
}

/// A random (version 4, RFC 4122 variant) UUID, as Python's `uuid.uuid4()`.
fn random_uuid_v4() -> Result<[u8; 16]> {
    let mut bytes = [0_u8; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| GalleyError::Internal {
            message: "generating random bytes failed".into(),
        })?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(bytes)
}

/// Lowercase hex, as Python's `UUID.hex`.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `8-4-4-4-12` lowercase hex, as Python's `str(UUID)`.
fn uuid_hyphenated(bytes: &[u8; 16]) -> String {
    let hex = hex(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// The engine's `[1m]` rule (`NativeClaudeSession.raw_ask`): a model id that
/// contains [`ENGINE_CONTEXT_1M_MARKER`] in any case asks for the 1M-token
/// context. It goes out without `[1m]` / `[1M]`, and the betas gain
/// [`ENGINE_CONTEXT_1M_BETA`]. Returns the id to send and whether it asked.
fn split_context_1m(model: &str) -> (String, bool) {
    if !model.to_lowercase().contains(ENGINE_CONTEXT_1M_MARKER) {
        return (model.to_string(), false);
    }
    let upper = ENGINE_CONTEXT_1M_MARKER.to_uppercase();
    let stripped = model
        .replace(ENGINE_CONTEXT_1M_MARKER, "")
        .replace(&upper, "");
    (stripped, true)
}

/// The `anthropic-beta` header, as `raw_ask` joins it: the engine's list,
/// the `[1m]` beta inserted where the engine inserts it, then Claude Code's
/// own beta filtered out when the request does not say it is Claude Code
/// (managed patch `0032`), the others keeping their order.
fn anthropic_betas(context_1m: bool, claude_code: bool) -> String {
    let mut betas = ENGINE_ANTHROPIC_BETAS.to_vec();
    if context_1m {
        betas.insert(ENGINE_CONTEXT_1M_BETA_AT, ENGINE_CONTEXT_1M_BETA);
    }
    betas.retain(|beta| claude_code || *beta != CLAUDE_CODE_BETA);
    betas.join(",")
}

/// A probe's headers: what the engine sends for the same provider and model
/// (see the constants above), then the auth header. `context_1m` is
/// [`split_context_1m`]'s answer for the model under test; `claude_code` is
/// [`ClaudeCodeIdentity::for_probe`]'s. When an Anthropic-protocol request
/// does not say it is Claude Code (managed patch `0032`), it sends Galley's
/// own user agent, the one Sign in with ChatGPT sends, and no Claude Code
/// beta, `x-app`, session or Stainless headers.
fn apply_probe_headers(
    req: reqwest::RequestBuilder,
    input: &ManagedModelProbeInput,
    secret: &str,
    context_1m: bool,
    claude_code: Option<&ClaudeCodeIdentity>,
) -> reqwest::RequestBuilder {
    match input.protocol {
        ManagedModelProtocol::Openai => req
            .header("user-agent", ENGINE_OPENAI_USER_AGENT)
            .header("originator", ENGINE_OPENAI_ORIGINATOR)
            .bearer_auth(secret),
        ManagedModelProtocol::Anthropic => {
            let mut req = req.header(
                "anthropic-beta",
                anthropic_betas(context_1m, claude_code.is_some()),
            );
            for (name, value) in ENGINE_ANTHROPIC_HEADERS {
                req = req.header(name, value);
            }
            match claude_code {
                Some(identity) => {
                    req = req
                        .header("user-agent", ENGINE_CLAUDE_USER_AGENT)
                        .header(ENGINE_CLAUDE_CODE_SESSION_HEADER, &identity.session_id);
                    for (name, value) in ENGINE_CLAUDE_CODE_HEADERS {
                        req = req.header(name, value);
                    }
                }
                None => req = req.header("user-agent", chatgpt_siwc::galley_user_agent()),
            }
            if secret.starts_with("sk-ant-") {
                req.header("x-api-key", secret)
            } else {
                req.bearer_auth(secret)
            }
        }
    }
}

fn models_endpoint(api_base: &str) -> Result<String> {
    provider_endpoint(api_base, "models")
}

fn inference_endpoint(api_base: &str, protocol: ManagedModelProtocol) -> Result<String> {
    match protocol {
        ManagedModelProtocol::Anthropic => {
            let endpoint = provider_endpoint(api_base, "messages")?;
            Ok(with_beta_query(&endpoint))
        }
        ManagedModelProtocol::Openai => provider_endpoint(api_base, "chat/completions"),
    }
}

fn provider_endpoint(api_base: &str, path: &str) -> Result<String> {
    let trimmed = api_base.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(GalleyError::InvalidArgs {
            message: "Base URL is required".into(),
        });
    }
    if let Some(exact) = trimmed.strip_suffix('$') {
        return Ok(exact.trim_end_matches('/').to_string());
    }
    let target_suffix = format!("/{path}");
    if trimmed.ends_with(&target_suffix) {
        return Ok(trimmed.to_string());
    }
    let base = trimmed
        .strip_suffix("/chat/completions")
        .or_else(|| trimmed.strip_suffix("/responses"))
        .or_else(|| trimmed.strip_suffix("/messages"))
        .or_else(|| trimmed.strip_suffix("/models"))
        .unwrap_or(trimmed)
        .trim_end_matches('/');
    if has_version_segment(base) {
        Ok(format!("{base}/{path}"))
    } else {
        Ok(format!("{base}/v1/{path}"))
    }
}

fn has_version_segment(api_base: &str) -> bool {
    api_base.split('/').any(is_version_segment)
}

/// `v` + digits, optionally followed by a lowercase alphanumeric qualifier:
/// `v1`, `v1beta` (Gemini's `/v1beta/openai`), `v2alpha1`, but not words
/// that merely start with `v` (`vendor`, `video`) or an uppercase `V1`.
/// Same rule as the managed runtime's `auto_make_url` (`llmcore.py`,
/// managed patch `0027`), so the probe and the engine resolve one URL.
fn is_version_segment(segment: &str) -> bool {
    let Some(rest) = segment.strip_prefix('v') else {
        return false;
    };
    let qualifier = rest.trim_start_matches(|c: char| c.is_ascii_digit());
    qualifier.len() < rest.len()
        && qualifier
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

fn with_beta_query(endpoint: &str) -> String {
    if endpoint.contains('?') {
        format!("{endpoint}&beta=true")
    } else {
        format!("{endpoint}?beta=true")
    }
}

/// The Anthropic "Test model" body. `model` is the id as it goes out
/// ([`split_context_1m`] already applied); a probe that says it is Claude
/// Code carries the engine's `metadata.user_id`.
fn anthropic_probe_payload(model: &str, claude_code: Option<&ClaudeCodeIdentity>) -> Value {
    let mut payload = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "ping"
                    }
                ]
            }
        ],
        "max_tokens": 1,
        "stream": false,
        "tools": [
            {
                "name": "ping",
                "description": "Connectivity probe tool. Never invoked.",
                "input_schema": {
                    "type": "object",
                    "properties": {}
                }
            }
        ]
    });
    if let Some(identity) = claude_code {
        payload["metadata"] = serde_json::json!({ "user_id": identity.user_id() });
    }
    payload
}

/// The field that caps an OpenAI chat completion's length. Newer OpenAI
/// models refuse `max_tokens` ("Unsupported parameter: 'max_tokens' is not
/// supported with this model. Use 'max_completion_tokens' instead."); most
/// other OpenAI-compatible endpoints only know `max_tokens`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TokenCapKey {
    MaxTokens,
    MaxCompletionTokens,
}

impl TokenCapKey {
    fn name(self) -> &'static str {
        match self {
            Self::MaxTokens => "max_tokens",
            Self::MaxCompletionTokens => "max_completion_tokens",
        }
    }

    fn other(self) -> Self {
        match self {
            Self::MaxTokens => Self::MaxCompletionTokens,
            Self::MaxCompletionTokens => Self::MaxTokens,
        }
    }

    /// The first guess, from the model id lowercased: `gpt-<n>…` with
    /// n ≥ 5, or `o<digit>…`, caps with `max_completion_tokens`; any other
    /// id, a vendor-prefixed one such as `openai/gpt-5` included, with
    /// `max_tokens`. The prefix table this replaces (`gpt-5`, `o1`–`o4`,
    /// the engine's own in `_openai_stream`, which applies only when a
    /// model sets `max_tokens` and Galley never does) is a special case.
    fn guess(model: &str) -> Self {
        let model = model.to_ascii_lowercase();
        let completion = if let Some(rest) = model.strip_prefix("gpt-") {
            let end = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            // Too many digits for a u64 is a large generation number too.
            end > 0 && rest[..end].parse::<u64>().map_or(true, |n| n >= 5)
        } else if let Some(rest) = model.strip_prefix('o') {
            rest.starts_with(|c: char| c.is_ascii_digit())
        } else {
            false
        };
        if completion {
            Self::MaxCompletionTokens
        } else {
            Self::MaxTokens
        }
    }
}

/// Whether a failed OpenAI "Test model" should go again with the other
/// token cap key: the response is a 400 and its error says the key it sent
/// is not supported, either by naming it in `error.param`, or with
/// `error.code` `unsupported_parameter` and the other key in
/// `error.message`. Works in both directions; the caller retries once.
fn token_cap_key_retry(status: u16, body: &str, sent: TokenCapKey) -> Option<TokenCapKey> {
    if status != 400 {
        return None;
    }
    let json: Value = serde_json::from_str(body).ok()?;
    let error = json.get("error")?;
    let text = |field: &str| error.get(field).and_then(Value::as_str);
    let other = sent.other();
    let names_sent = text("param") == Some(sent.name());
    let points_to_other = text("code") == Some("unsupported_parameter")
        && text("message").is_some_and(|message| message.contains(other.name()));
    (names_sent || points_to_other).then_some(other)
}

/// The OpenAI "Test model" body, its one-token cap under `token_key`.
fn openai_probe_payload(model: &str, token_key: TokenCapKey) -> Value {
    let mut payload = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": "ping"
            }
        ],
        "stream": false,
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "ping",
                    "description": "Connectivity probe tool. Never invoked.",
                    "parameters": {
                        "type": "object",
                        "properties": {}
                    }
                }
            }
        ]
    });
    payload[token_key.name()] = serde_json::json!(1);
    payload
}

fn extract_model_ids(json: &Value) -> Vec<String> {
    let candidates = json
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| json.get("models").and_then(Value::as_array));
    let Some(items) = candidates else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            item.get("id")
                .or_else(|| item.get("name"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned)
        })
        .collect()
}

fn compact_body(body: &str) -> String {
    let trimmed = body.trim().replace('\n', " ");
    if trimmed.chars().count() <= 240 {
        return trimmed;
    }
    let prefix: String = trimmed.chars().take(240).collect();
    format!("{prefix}...")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_endpoint_normalizes_common_provider_bases() {
        assert_eq!(
            models_endpoint("https://api.openai.com/v1").unwrap(),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            models_endpoint("https://relay.example/v1/chat/completions").unwrap(),
            "https://relay.example/v1/models"
        );
        assert_eq!(
            models_endpoint("https://relay.example/v1/responses").unwrap(),
            "https://relay.example/v1/models"
        );
        assert_eq!(
            models_endpoint("https://api.anthropic.com/v1/models").unwrap(),
            "https://api.anthropic.com/v1/models"
        );
        assert_eq!(
            models_endpoint("https://api.anthropic.com").unwrap(),
            "https://api.anthropic.com/v1/models"
        );
        assert_eq!(
            models_endpoint("https://api.deepseek.com/anthropic").unwrap(),
            "https://api.deepseek.com/anthropic/v1/models"
        );
        assert_eq!(
            models_endpoint("https://relay.example/v1/messages").unwrap(),
            "https://relay.example/v1/models"
        );
        // galley#32: Gemini's OpenAI-compatible base, as documented and as the
        // full chat URL the old rule forced as a workaround.
        for gemini in [
            "https://generativelanguage.googleapis.com/v1beta/openai/",
            "https://generativelanguage.googleapis.com/v1beta/openai",
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        ] {
            assert_eq!(
                models_endpoint(gemini).unwrap(),
                "https://generativelanguage.googleapis.com/v1beta/openai/models"
            );
        }
        assert_eq!(
            models_endpoint("https://relay.example/vendor/api").unwrap(),
            "https://relay.example/vendor/api/v1/models"
        );
    }

    #[test]
    fn inference_endpoint_matches_managed_runtime_url_rules() {
        assert_eq!(
            inference_endpoint("https://api.anthropic.com", ManagedModelProtocol::Anthropic)
                .unwrap(),
            "https://api.anthropic.com/v1/messages?beta=true"
        );
        assert_eq!(
            inference_endpoint(
                "https://api.deepseek.com/anthropic",
                ManagedModelProtocol::Anthropic
            )
            .unwrap(),
            "https://api.deepseek.com/anthropic/v1/messages?beta=true"
        );
        assert_eq!(
            inference_endpoint(
                "https://relay.example/v1/messages",
                ManagedModelProtocol::Anthropic
            )
            .unwrap(),
            "https://relay.example/v1/messages?beta=true"
        );
        assert_eq!(
            inference_endpoint("https://openrouter.ai/api/v1", ManagedModelProtocol::Openai)
                .unwrap(),
            "https://openrouter.ai/api/v1/chat/completions"
        );
        for gemini in [
            "https://generativelanguage.googleapis.com/v1beta/openai/",
            "https://generativelanguage.googleapis.com/v1beta/openai",
        ] {
            assert_eq!(
                inference_endpoint(gemini, ManagedModelProtocol::Openai).unwrap(),
                "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
            );
        }
    }

    /// `(base, path, expected)` for the cases where Core's `provider_endpoint`
    /// and the managed runtime's `llmcore.auto_make_url` must agree: the
    /// `$` pin, a base that already ends with the path, and the version-
    /// segment rule (galley#32). Rust-only behavior stays out of this table
    /// (Core also strips a `/models`, `/responses`, … suffix and trims
    /// whitespace; the engine does not). `runner/tests/test_managed_ga_url.py`
    /// parses this table and runs it against the payload's `auto_make_url`,
    /// so keep each entry a plain three-string tuple.
    const AUTO_MAKE_URL_CASES: &[(&str, &str, &str)] = &[
        (
            "https://generativelanguage.googleapis.com/v1beta/openai/",
            "chat/completions",
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        ),
        (
            "https://generativelanguage.googleapis.com/v1beta/openai",
            "chat/completions",
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        ),
        (
            "https://generativelanguage.googleapis.com/v1beta/openai/",
            "responses",
            "https://generativelanguage.googleapis.com/v1beta/openai/responses",
        ),
        (
            "https://relay.example/v1beta1",
            "chat/completions",
            "https://relay.example/v1beta1/chat/completions",
        ),
        (
            "https://relay.example/v2alpha/api",
            "chat/completions",
            "https://relay.example/v2alpha/api/chat/completions",
        ),
        (
            "https://api.openai.com/v1",
            "chat/completions",
            "https://api.openai.com/v1/chat/completions",
        ),
        (
            "https://openrouter.ai/api/v1/",
            "chat/completions",
            "https://openrouter.ai/api/v1/chat/completions",
        ),
        (
            "https://relay.example",
            "chat/completions",
            "https://relay.example/v1/chat/completions",
        ),
        (
            "https://api.anthropic.com",
            "messages",
            "https://api.anthropic.com/v1/messages",
        ),
        (
            "https://api.deepseek.com/anthropic",
            "messages",
            "https://api.deepseek.com/anthropic/v1/messages",
        ),
        (
            "https://relay.example/custom/endpoint/$",
            "chat/completions",
            "https://relay.example/custom/endpoint",
        ),
        (
            "https://relay.example/v1/chat/completions",
            "chat/completions",
            "https://relay.example/v1/chat/completions",
        ),
        (
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            "chat/completions",
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        ),
        (
            "https://relay.example/v1/messages",
            "messages",
            "https://relay.example/v1/messages",
        ),
        (
            "https://relay.example/vendor/api",
            "chat/completions",
            "https://relay.example/vendor/api/v1/chat/completions",
        ),
        (
            "https://relay.example/v/x",
            "chat/completions",
            "https://relay.example/v/x/v1/chat/completions",
        ),
        (
            "https://relay.example/video",
            "chat/completions",
            "https://relay.example/video/v1/chat/completions",
        ),
        (
            "https://relay.example/version/api",
            "chat/completions",
            "https://relay.example/version/api/v1/chat/completions",
        ),
        (
            "https://relay.example/V1",
            "chat/completions",
            "https://relay.example/V1/v1/chat/completions",
        ),
        (
            "https://relay.example/v1.5",
            "chat/completions",
            "https://relay.example/v1.5/v1/chat/completions",
        ),
        (
            "https://v1.relay.example/api",
            "chat/completions",
            "https://v1.relay.example/api/v1/chat/completions",
        ),
    ];

    #[test]
    fn provider_endpoint_agrees_with_engine_auto_make_url() {
        for (base, path, expected) in AUTO_MAKE_URL_CASES {
            assert_eq!(
                provider_endpoint(base, path).unwrap(),
                *expected,
                "base {base:?}, path {path:?}"
            );
        }
    }

    #[test]
    fn version_segment_allows_a_lowercase_qualifier_only() {
        for segment in ["v1", "v2", "v10", "v1beta", "v1beta1", "v2alpha", "v1beta3"] {
            assert!(is_version_segment(segment), "{segment}");
        }
        for segment in [
            "", "v", "vendor", "version", "video", "V1", "v1Beta", "v1.5", "v1-beta", "beta1",
        ] {
            assert!(!is_version_segment(segment), "{segment}");
        }
    }

    #[test]
    fn probe_payload_carries_protocol_native_tool_schema() {
        // Anthropic tools must be {name, description, input_schema} — never the
        // OpenAI {type:function, function:{...}} shape, or an Anthropic-compatible
        // gateway fronting an OpenAI upstream rejects the request (issue #10).
        let anthropic = anthropic_probe_payload("claude-x", None);
        let tool = &anthropic["tools"][0];
        assert!(tool.get("name").is_some());
        assert!(tool.get("input_schema").is_some());
        assert!(tool.get("function").is_none());

        // OpenAI tools must be {type:function, function:{name, parameters}}.
        let openai = openai_probe_payload("gpt-4o", TokenCapKey::MaxTokens);
        let tool = &openai["tools"][0];
        assert_eq!(tool["type"], "function");
        assert!(tool["function"].get("name").is_some());
        assert!(tool["function"].get("parameters").is_some());
        assert!(tool.get("input_schema").is_none());
    }

    #[test]
    fn extract_model_ids_handles_openai_and_anthropic_shapes() {
        let openai = serde_json::json!({
            "data": [{"id": "gpt-4.1"}, {"id": "gpt-4o"}]
        });
        assert_eq!(extract_model_ids(&openai), vec!["gpt-4.1", "gpt-4o"]);

        let fallback = serde_json::json!({
            "models": [{"name": "claude-sonnet-4-6"}]
        });
        assert_eq!(extract_model_ids(&fallback), vec!["claude-sonnet-4-6"]);
    }

    const ANTHROPIC_KEY: &str = "sk-ant-api03-test";
    const RELAY_KEY: &str = "relay-key";

    fn probe_input(
        protocol: ManagedModelProtocol,
        api_base: &str,
        advanced_options: Option<Value>,
    ) -> ManagedModelProbeInput {
        ManagedModelProbeInput {
            id: None,
            provider_id: None,
            protocol,
            auth_kind: None,
            api_base: api_base.to_string(),
            api_key: None,
            model: Some("claude-test".into()),
            advanced_options,
        }
    }

    /// A built request's headers, sorted by name (HTTP does not order them;
    /// a header sent twice shows up twice).
    fn header_list(req: reqwest::RequestBuilder) -> Vec<(String, String)> {
        let mut headers: Vec<_> = req
            .build()
            .expect("probe request builds")
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.as_str().to_string(),
                    value.to_str().expect("ASCII header").to_string(),
                )
            })
            .collect();
        headers.sort();
        headers
    }

    /// The headers "Test model" sends for `input` and `model`, built the way
    /// `test_model` builds them, and the Claude Code session they carry.
    fn probe_request(
        input: &ManagedModelProbeInput,
        secret: &str,
        model: &str,
    ) -> (Vec<(String, String)>, Option<ClaudeCodeIdentity>) {
        let claude_code = ClaudeCodeIdentity::for_probe(input).expect("random bytes");
        let (_, context_1m) = split_context_1m(model);
        let req = reqwest::Client::new().post("https://probe.invalid/v1/messages");
        let headers = header_list(apply_probe_headers(
            req,
            input,
            secret,
            context_1m,
            claude_code.as_ref(),
        ));
        (headers, claude_code)
    }

    fn probe_headers(input: &ManagedModelProbeInput, secret: &str) -> Vec<(String, String)> {
        probe_request(input, secret, "claude-test").0
    }

    fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
        headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    fn sorted_headers<'a>(
        headers: impl IntoIterator<Item = (&'a str, String)>,
        secret: &str,
    ) -> Vec<(String, String)> {
        let auth = if secret.starts_with("sk-ant-") {
            ("x-api-key", secret.to_string())
        } else {
            ("authorization", format!("Bearer {secret}"))
        };
        let mut headers: Vec<_> = headers
            .into_iter()
            .chain([auth])
            .map(|(name, value)| (name.to_ascii_lowercase(), value))
            .collect();
        headers.sort();
        headers
    }

    /// What the engine sends on an Anthropic-protocol request that says it
    /// is Claude Code, from the engine constants
    /// (`runner/tests/test_managed_ga_probe_parity.py` holds them to the
    /// payload's `llmcore.py`).
    fn engine_claude_code_headers(
        secret: &str,
        session_id: &str,
        betas: &str,
    ) -> Vec<(String, String)> {
        let fixed = ENGINE_ANTHROPIC_HEADERS
            .iter()
            .chain(&ENGINE_CLAUDE_CODE_HEADERS)
            .map(|(name, value)| (*name, value.to_string()));
        sorted_headers(
            fixed.chain([
                ("anthropic-beta", betas.to_string()),
                ("user-agent", ENGINE_CLAUDE_USER_AGENT.to_string()),
                (ENGINE_CLAUDE_CODE_SESSION_HEADER, session_id.to_string()),
            ]),
            secret,
        )
    }

    /// What the engine sends on an Anthropic-protocol request that does not
    /// say it is Claude Code (managed patch `0032`).
    fn engine_galley_headers(secret: &str, betas: &str) -> Vec<(String, String)> {
        let fixed = ENGINE_ANTHROPIC_HEADERS
            .iter()
            .map(|(name, value)| (*name, value.to_string()));
        sorted_headers(
            fixed.chain([
                ("anthropic-beta", betas.to_string()),
                ("user-agent", chatgpt_siwc::galley_user_agent()),
            ]),
            secret,
        )
    }

    #[test]
    fn official_anthropic_host_is_an_exact_host_match() {
        for base in [
            "https://api.anthropic.com",
            "https://api.anthropic.com/",
            "https://api.anthropic.com/v1",
            "https://API.Anthropic.COM/v1/messages$",
            "http://api.anthropic.com:443/v1",
            " https://api.anthropic.com ",
        ] {
            assert!(is_official_anthropic_host(base), "{base}");
        }
        for base in [
            "api.anthropic.com",
            "api.anthropic.com/v1",
            "https://api.anthropic.com.example.net",
            "https://relay.example/api.anthropic.com",
            "relay.example/api.anthropic.com",
            "https://xapi.anthropic.com",
            "https://anthropic.com",
            "https://api.kimi.com/coding",
            "",
        ] {
            assert!(!is_official_anthropic_host(base), "{base}");
        }
    }

    #[test]
    fn official_anthropic_probe_sends_the_engines_galley_headers_passthrough_or_not() {
        let betas = ENGINE_ANTHROPIC_BETAS[1..].join(",");
        for options in [
            None,
            Some(serde_json::json!({})),
            Some(serde_json::json!({"fake_cc_system_prompt": false})),
            Some(serde_json::json!({"fake_cc_system_prompt": true})),
            Some(serde_json::json!({"thinking_type": "adaptive", "stream": true})),
        ] {
            for base in ["https://api.anthropic.com", "https://API.anthropic.com/v1"] {
                let input = probe_input(ManagedModelProtocol::Anthropic, base, options.clone());
                let context = format!("{base} {options:?}");
                for secret in [ANTHROPIC_KEY, RELAY_KEY] {
                    let (headers, claude_code) = probe_request(&input, secret, "claude-test");
                    assert!(claude_code.is_none(), "{context}");
                    assert_eq!(headers, engine_galley_headers(secret, &betas), "{context}");
                }

                let headers = probe_headers(&input, ANTHROPIC_KEY);
                assert_eq!(header(&headers, "x-app"), None, "{context}");
                assert_eq!(header(&headers, "x-claude-code-session-id"), None);
                assert!(!headers
                    .iter()
                    .any(|(name, _)| name.starts_with("x-stainless-")));
                let user_agent = header(&headers, "user-agent").unwrap_or_default();
                assert!(
                    user_agent.starts_with("Galley ("),
                    "{context}: {user_agent}"
                );
                let betas = header(&headers, "anthropic-beta").unwrap_or_default();
                assert!(!betas.contains(CLAUDE_CODE_BETA), "{context}");
                assert_eq!(header(&headers, "accept"), Some("application/json"));
            }
        }
        // A relay-style key on the official host still goes as a bearer token.
        let input = probe_input(
            ManagedModelProtocol::Anthropic,
            "https://api.anthropic.com",
            None,
        );
        let headers = probe_headers(&input, RELAY_KEY);
        assert_eq!(header(&headers, "authorization"), Some("Bearer relay-key"));
        assert_eq!(header(&headers, "x-app"), None);
    }

    #[test]
    fn other_anthropic_endpoints_send_the_engines_claude_code_headers() {
        for base in [
            "https://api.kimi.com/coding",
            "https://api.deepseek.com/anthropic",
            "https://api.anthropic.com.example.net",
            "https://relay.example/api.anthropic.com",
            "relay.example/api.anthropic.com",
            "api.anthropic.com",
        ] {
            for options in [
                None,
                Some(serde_json::json!({"fake_cc_system_prompt": false})),
                Some(serde_json::json!({"fake_cc_system_prompt": true})),
            ] {
                let input = probe_input(ManagedModelProtocol::Anthropic, base, options.clone());
                for secret in [ANTHROPIC_KEY, RELAY_KEY] {
                    let (headers, claude_code) = probe_request(&input, secret, "claude-test");
                    let session_id = claude_code.expect("says it is Claude Code").session_id;
                    assert_eq!(
                        headers,
                        engine_claude_code_headers(
                            secret,
                            &session_id,
                            &ENGINE_ANTHROPIC_BETAS.join(",")
                        ),
                        "{base} {options:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn a_1m_model_goes_out_as_the_engine_sends_it() {
        for (model, sent) in [
            ("claude-opus-4-8[1m]", "claude-opus-4-8"),
            ("claude-opus-4-8[1M]", "claude-opus-4-8"),
            ("Claude-Opus-4-8[1m]", "Claude-Opus-4-8"),
        ] {
            assert_eq!(split_context_1m(model), (sent.to_string(), true), "{model}");
        }
        for model in ["claude-opus-4-8", "claude-1m", "claude-[1x]"] {
            assert_eq!(
                split_context_1m(model),
                (model.to_string(), false),
                "{model}"
            );
        }

        let mut with_1m = ENGINE_ANTHROPIC_BETAS.to_vec();
        with_1m.insert(ENGINE_CONTEXT_1M_BETA_AT, ENGINE_CONTEXT_1M_BETA);
        assert_eq!(with_1m[1], "context-1m-2025-08-07");
        // Claude Code: the 1M beta second, right after Claude Code's own.
        let relay = probe_input(
            ManagedModelProtocol::Anthropic,
            "https://relay.example",
            None,
        );
        let (headers, _) = probe_request(&relay, RELAY_KEY, "claude-opus-4-8[1m]");
        assert_eq!(
            header(&headers, "anthropic-beta"),
            Some(with_1m.join(",").as_str())
        );
        // Not Claude Code (0032 filters after the insert): the 1M beta first.
        let official = probe_input(
            ManagedModelProtocol::Anthropic,
            "https://api.anthropic.com",
            None,
        );
        let (headers, _) = probe_request(&official, ANTHROPIC_KEY, "claude-opus-4-8[1M]");
        assert_eq!(
            header(&headers, "anthropic-beta"),
            Some(with_1m[1..].join(",").as_str())
        );
        // A model without the marker: no 1M beta.
        let (headers, _) = probe_request(&relay, RELAY_KEY, "claude-opus-4-8");
        assert_eq!(
            header(&headers, "anthropic-beta"),
            Some(ENGINE_ANTHROPIC_BETAS.join(",").as_str())
        );
    }

    #[test]
    fn a_claude_code_probe_carries_a_fresh_session_shaped_like_the_engines() {
        let relay = probe_input(
            ManagedModelProtocol::Anthropic,
            "https://relay.example",
            None,
        );
        let first = ClaudeCodeIdentity::for_probe(&relay).unwrap().unwrap();
        let second = ClaudeCodeIdentity::for_probe(&relay).unwrap().unwrap();
        assert_ne!(first.session_id, second.session_id);
        assert_ne!(first.device_id, second.device_id);

        // str(uuid.uuid4()): 8-4-4-4-12 lowercase hex, version 4, RFC 4122 variant.
        let id = &first.session_id;
        let groups: Vec<_> = id.split('-').map(str::len).collect();
        assert_eq!(groups, [8, 4, 4, 4, 12], "{id}");
        assert!(id
            .chars()
            .all(|c| c == '-' || c.is_ascii_digit() || ('a'..='f').contains(&c)));
        assert_eq!(&id[14..15], "4", "{id}");
        assert!("89ab".contains(&id[19..20]), "{id}");
        // uuid4().hex + uuid4().hex[:32]: 64 lowercase hex digits.
        let device = &first.device_id;
        assert_eq!(device.len(), 64, "{device}");
        assert!(device
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)));

        // json.dumps({...}, separators=(',', ':')), the engine's key order.
        let user_id = format!(
            r#"{{"device_id":"{}","account_uuid":"","session_id":"{}"}}"#,
            first.device_id, first.session_id
        );
        assert_eq!(first.user_id(), user_id);
        let body = anthropic_probe_payload("claude-test", Some(&first));
        assert_eq!(body["metadata"], serde_json::json!({ "user_id": user_id }));
        // The session header and the body name the same session.
        let req = reqwest::Client::new().post("https://probe.invalid/v1/messages");
        let headers = header_list(apply_probe_headers(
            req,
            &relay,
            RELAY_KEY,
            false,
            Some(&first),
        ));
        assert_eq!(
            header(&headers, "x-claude-code-session-id"),
            Some(first.session_id.as_str())
        );
    }

    #[test]
    fn only_a_claude_code_probe_carries_a_session_and_metadata() {
        let none = [
            probe_input(
                ManagedModelProtocol::Anthropic,
                "https://api.anthropic.com",
                None,
            ),
            probe_input(
                ManagedModelProtocol::Anthropic,
                "https://api.anthropic.com",
                Some(serde_json::json!({"fake_cc_system_prompt": true})),
            ),
            probe_input(
                ManagedModelProtocol::Openai,
                "https://api.openai.com/v1",
                None,
            ),
            probe_input(ManagedModelProtocol::Openai, "https://relay.example", None),
        ];
        for input in &none {
            assert!(ClaudeCodeIdentity::for_probe(input).unwrap().is_none());
        }
        let body = anthropic_probe_payload("claude-test", None);
        assert!(body.get("metadata").is_none());
        assert_eq!(body["model"], "claude-test");
    }

    #[test]
    fn openai_probe_sends_the_engines_user_agent_and_originator() {
        for base in ["https://api.anthropic.com", "https://api.openai.com/v1"] {
            let input = probe_input(ManagedModelProtocol::Openai, base, None);
            let expected = sorted_headers(
                [
                    ("user-agent", ENGINE_OPENAI_USER_AGENT.to_string()),
                    ("originator", ENGINE_OPENAI_ORIGINATOR.to_string()),
                ],
                RELAY_KEY,
            );
            assert_eq!(probe_headers(&input, RELAY_KEY), expected, "{base}");
        }
    }

    #[test]
    fn token_cap_key_first_guess_covers_new_openai_generations() {
        for model in [
            "gpt-5",
            "gpt-5.1",
            "GPT-5-mini",
            "gpt-50",
            "gpt-6",
            "gpt-6.1-sol",
            "gpt-10",
            "gpt-99999999999999999999999",
            "o1",
            "o1-mini",
            "o3-pro",
            "O4-mini",
            "o5",
        ] {
            assert_eq!(
                TokenCapKey::guess(model),
                TokenCapKey::MaxCompletionTokens,
                "{model}"
            );
        }
        for model in [
            "gpt-4o",
            "gpt-4.1",
            "gpt-3.5-turbo",
            "gpt-",
            "gpt-x",
            "openai/gpt-5",
            "openai/gpt-6.1-sol",
            "openrouter/o3",
            "chatgpt-4o-latest",
            "omni-moderation-latest",
            "o",
            "deepseek-chat",
            "",
        ] {
            assert_eq!(TokenCapKey::guess(model), TokenCapKey::MaxTokens, "{model}");
        }
        // The prefix table it replaces is a special case.
        for prefix in ["gpt-5", "o1", "o2", "o3", "o4"] {
            assert_eq!(TokenCapKey::guess(prefix), TokenCapKey::MaxCompletionTokens);
        }
    }

    #[test]
    fn openai_probe_payload_caps_under_the_given_key_only() {
        for key in [TokenCapKey::MaxTokens, TokenCapKey::MaxCompletionTokens] {
            let payload = openai_probe_payload("gpt-6", key);
            assert_eq!(payload[key.name()], 1);
            assert!(payload.get(key.other().name()).is_none());
        }
    }

    /// The official API's answer to `max_tokens` on a `gpt-6` model
    /// (2026-11-17).
    const MAX_TOKENS_UNSUPPORTED: &str = r#"{
  "error": {
    "message": "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
    "type": "invalid_request_error",
    "param": "max_tokens",
    "code": "unsupported_parameter"
  }
}"#;

    #[test]
    fn a_wrong_token_cap_key_goes_again_with_the_other_one() {
        use TokenCapKey::{MaxCompletionTokens, MaxTokens};
        assert_eq!(
            token_cap_key_retry(400, MAX_TOKENS_UNSUPPORTED, MaxTokens),
            Some(MaxCompletionTokens)
        );
        // The other direction.
        let reverse = serde_json::json!({"error": {
            "message": "Unsupported parameter: 'max_completion_tokens' is not supported with this model. Use 'max_tokens' instead.",
            "type": "invalid_request_error",
            "param": "max_completion_tokens",
            "code": "unsupported_parameter",
        }})
        .to_string();
        assert_eq!(
            token_cap_key_retry(400, &reverse, MaxCompletionTokens),
            Some(MaxTokens)
        );
        // Either half of the rule is enough.
        let param_only = serde_json::json!({"error": {"param": "max_tokens"}}).to_string();
        assert_eq!(
            token_cap_key_retry(400, &param_only, MaxTokens),
            Some(MaxCompletionTokens)
        );
        let code_and_text = serde_json::json!({"error": {
            "message": "max_tokens is not supported; use max_completion_tokens",
            "code": "unsupported_parameter",
        }})
        .to_string();
        assert_eq!(
            token_cap_key_retry(400, &code_and_text, MaxTokens),
            Some(MaxCompletionTokens)
        );
    }

    #[test]
    fn other_failures_do_not_retry_the_token_cap_key() {
        use TokenCapKey::{MaxCompletionTokens, MaxTokens};
        // Not a 400.
        for status in [200, 401, 404, 422, 429, 500] {
            assert_eq!(
                token_cap_key_retry(status, MAX_TOKENS_UNSUPPORTED, MaxTokens),
                None
            );
        }
        // It names the key we did not send, and not as unsupported.
        let not_sent = serde_json::json!({"error": {
            "message": "max_tokens is too large",
            "param": "max_tokens",
            "code": "invalid_value",
        }})
        .to_string();
        assert_eq!(
            token_cap_key_retry(400, &not_sent, MaxCompletionTokens),
            None
        );
        // Another parameter is the problem.
        let temperature = serde_json::json!({"error": {
            "message": "Unsupported parameter: 'temperature' is not supported with this model.",
            "param": "temperature",
            "code": "unsupported_parameter",
        }})
        .to_string();
        assert_eq!(token_cap_key_retry(400, &temperature, MaxTokens), None);
        // The other key in the text, but not as an unsupported parameter.
        let other_code = serde_json::json!({"error": {
            "message": "max_completion_tokens must be at least 1",
            "param": "messages",
            "code": "invalid_value",
        }})
        .to_string();
        assert_eq!(token_cap_key_retry(400, &other_code, MaxTokens), None);
        // Bodies without an error object.
        for body in [
            "",
            "Bad Request",
            r#"{"error": "max_tokens is not supported"}"#,
            r#"{"message": "x", "param": "max_tokens"}"#,
        ] {
            assert_eq!(token_cap_key_retry(400, body, MaxTokens), None, "{body}");
        }
    }
}
