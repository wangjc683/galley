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
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
        .build()
        .map_err(|e| GalleyError::Internal {
            message: format!("building HTTP client: {e}"),
        })?;
    let mut req = client.get(&endpoint);
    req = apply_auth_headers(req, &input, &secret);
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
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(PROBE_TIMEOUT_SECS))
        .build()
        .map_err(|e| GalleyError::Internal {
            message: format!("building HTTP client: {e}"),
        })?;
    let payload = probe_payload(input.protocol, &model);
    let mut req = client.post(&endpoint).json(&payload);
    req = apply_auth_headers(req, &input, &secret);
    let resp = req.send().await.map_err(|e| GalleyError::RunnerError {
        message: format!("model test request failed: {e}"),
    })?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| GalleyError::RunnerError {
        message: format!("reading model test response failed: {e}"),
    })?;
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

/// Claude Code's own `anthropic-beta` entry, first in [`ANTHROPIC_PROBE_BETAS`].
const CLAUDE_CODE_BETA: &str = "claude-code-20250219";

/// The `anthropic-beta` list of every Anthropic-protocol probe, in order.
const ANTHROPIC_PROBE_BETAS: [&str; 4] = [
    CLAUDE_CODE_BETA,
    "interleaved-thinking-2025-05-14",
    "redact-thinking-2026-02-12",
    "prompt-caching-scope-2026-01-05",
];

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
/// beta). Toward the official API the answer is no unless the model's
/// "Claude Code passthrough" (`fake_cc_system_prompt`) is on: the official
/// API refuses a Claude subscription's API credit to a request carrying
/// those markers, with a misleading "credit balance is too low" 400.
/// Every other endpoint keeps them. "Test model" sends the model's
/// effective options; the model list (a provider's, not a model's) sends
/// none, so toward the official API it never says it is Claude Code.
fn sends_claude_code_identity(input: &ManagedModelProbeInput) -> bool {
    let passthrough = input
        .advanced_options
        .as_ref()
        .and_then(|options| options.get("fake_cc_system_prompt"))
        .and_then(Value::as_bool)
        == Some(true);
    passthrough || !is_official_anthropic_host(&input.api_base)
}

fn apply_auth_headers(
    req: reqwest::RequestBuilder,
    input: &ManagedModelProbeInput,
    secret: &str,
) -> reqwest::RequestBuilder {
    match input.protocol {
        ManagedModelProtocol::Openai => req.bearer_auth(secret),
        ManagedModelProtocol::Anthropic => {
            let identity = sends_claude_code_identity(input);
            let betas = ANTHROPIC_PROBE_BETAS
                .into_iter()
                .filter(|beta| identity || *beta != CLAUDE_CODE_BETA)
                .collect::<Vec<_>>()
                .join(",");
            let req = req
                .header("anthropic-version", "2023-06-01")
                .header("anthropic-beta", betas)
                .header("anthropic-dangerous-direct-browser-access", "true");
            let req = if identity {
                req.header("user-agent", "claude-cli/2.1.113 (external, cli)")
                    .header("x-app", "cli")
            } else {
                req.header("user-agent", "Galley")
            };
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

fn probe_payload(protocol: ManagedModelProtocol, model: &str) -> Value {
    match protocol {
        ManagedModelProtocol::Anthropic => serde_json::json!({
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
        }),
        ManagedModelProtocol::Openai => {
            let lower_model = model.to_ascii_lowercase();
            let token_key = if ["gpt-5", "o1", "o2", "o3", "o4"]
                .iter()
                .any(|prefix| lower_model.starts_with(prefix))
            {
                "max_completion_tokens"
            } else {
                "max_tokens"
            };
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
            payload[token_key] = serde_json::json!(1);
            payload
        }
    }
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
        let anthropic = probe_payload(ManagedModelProtocol::Anthropic, "claude-x");
        let tool = &anthropic["tools"][0];
        assert!(tool.get("name").is_some());
        assert!(tool.get("input_schema").is_some());
        assert!(tool.get("function").is_none());

        // OpenAI tools must be {type:function, function:{name, parameters}}.
        let openai = probe_payload(ManagedModelProtocol::Openai, "gpt-4o");
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

    /// A built request's headers, in the order they go out.
    fn header_list(req: reqwest::RequestBuilder) -> Vec<(String, String)> {
        req.build()
            .expect("probe request builds")
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.as_str().to_string(),
                    value.to_str().expect("ASCII header").to_string(),
                )
            })
            .collect()
    }

    fn probe_headers(input: &ManagedModelProbeInput, secret: &str) -> Vec<(String, String)> {
        let req = reqwest::Client::new().post("https://probe.invalid/v1/messages");
        header_list(apply_auth_headers(req, input, secret))
    }

    fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
        headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    /// What every Anthropic-protocol probe sent before managed patch `0032`'s
    /// rule, written out by hand: the rule must leave it unchanged wherever
    /// it does not apply.
    fn claude_code_headers(secret: &str) -> Vec<(String, String)> {
        let req = reqwest::Client::new()
            .post("https://probe.invalid/v1/messages")
            .header("anthropic-version", "2023-06-01")
            .header(
                "anthropic-beta",
                "claude-code-20250219,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,prompt-caching-scope-2026-01-05",
            )
            .header("anthropic-dangerous-direct-browser-access", "true")
            .header("user-agent", "claude-cli/2.1.113 (external, cli)")
            .header("x-app", "cli");
        header_list(if secret.starts_with("sk-ant-") {
            req.header("x-api-key", secret)
        } else {
            req.bearer_auth(secret)
        })
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
    fn official_anthropic_probe_without_passthrough_says_it_is_galley() {
        for options in [
            None,
            Some(serde_json::json!({})),
            Some(serde_json::json!({"fake_cc_system_prompt": false})),
            Some(serde_json::json!({"thinking_type": "adaptive", "stream": true})),
        ] {
            for base in ["https://api.anthropic.com", "https://API.anthropic.com/v1"] {
                let input = probe_input(ManagedModelProtocol::Anthropic, base, options.clone());
                let headers = probe_headers(&input, ANTHROPIC_KEY);
                let context = format!("{base} {options:?}");

                assert_eq!(header(&headers, "x-app"), None, "{context}");
                assert_eq!(header(&headers, "user-agent"), Some("Galley"), "{context}");
                assert_eq!(
                    header(&headers, "anthropic-beta"),
                    Some(
                        "interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,prompt-caching-scope-2026-01-05"
                    ),
                    "{context}"
                );
                // Everything else is what the probe always sent.
                let expected: Vec<_> = claude_code_headers(ANTHROPIC_KEY)
                    .into_iter()
                    .filter(|(name, _)| {
                        !matches!(name.as_str(), "x-app" | "user-agent" | "anthropic-beta")
                    })
                    .collect();
                let rest: Vec<_> = headers
                    .iter()
                    .filter(|(name, _)| !matches!(name.as_str(), "user-agent" | "anthropic-beta"))
                    .cloned()
                    .collect();
                assert_eq!(rest, expected, "{context}");
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
    fn official_anthropic_probe_with_passthrough_keeps_claude_code_identity() {
        let input = probe_input(
            ManagedModelProtocol::Anthropic,
            "https://api.anthropic.com",
            Some(serde_json::json!({"fake_cc_system_prompt": true})),
        );
        for secret in [ANTHROPIC_KEY, RELAY_KEY] {
            assert_eq!(probe_headers(&input, secret), claude_code_headers(secret));
        }
    }

    #[test]
    fn other_anthropic_endpoints_keep_claude_code_identity() {
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
                    assert_eq!(
                        probe_headers(&input, secret),
                        claude_code_headers(secret),
                        "{base} {options:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn openai_probe_headers_are_unchanged() {
        for base in ["https://api.anthropic.com", "https://api.openai.com/v1"] {
            let input = probe_input(ManagedModelProtocol::Openai, base, None);
            let expected = header_list(
                reqwest::Client::new()
                    .post("https://probe.invalid/v1/messages")
                    .bearer_auth(RELAY_KEY),
            );
            assert_eq!(probe_headers(&input, RELAY_KEY), expected, "{base}");
        }
    }
}
