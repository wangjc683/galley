use std::time::Duration;

use serde_json::Value;

use crate::api::{
    ManagedModelAuthKind, ManagedModelCredentialStatus, ManagedModelProtocol, ManagedModelRecord,
};
use crate::credential_store;
use crate::db::SqliteGalley;
use crate::error::{GalleyError, Result};

const DEFAULT_READ_TIMEOUT_SECS: u64 = 180;
const DEFAULT_MAX_TOKENS: u64 = 1024;
const CONTINUATION_TOOL_RESULT_MAX_CHARS: usize = 64 * 1024;
const WORKING_CHECKPOINT_PROMPT_MAX_CHARS: usize = 8 * 1024;
const INITIAL_SYSTEM_PROMPT: &str = "You are Galley Native. Answer directly when no tool is needed. If you need a tool, emit only one JSON tool call, such as {\"tool\":\"file_read\",\"arguments\":{\"path\":\"notes.txt\"}}. Available native tools: file_read, file_patch, file_write, code_run, web_scan, web_execute_js, ask_user, update_working_checkpoint, start_long_term_update. file_read can read workspace files, read-only workspace:// resources, read-only memory:// resources, and read-only capability:// resources when available. Use workspace://snapshot to understand the current Project workspace or scratch root, and workspace://index for file mention paths. file_patch, file_write, code_run, and web_execute_js require approval before side effects. web_scan reads the connected Browser Control tab/page; web_execute_js runs JavaScript through Browser Control. update_working_checkpoint stores short-lived session-local working state, not durable memory. start_long_term_update can store low-risk text memory with evidence; high-risk memory, capability, script, tool, and browser changes require approval or are not implemented yet. code_run cannot execute capability:// scripts in this slice. Do not claim full Goal Hive, full Morphling, unrestricted workspace access, or browser access when Browser Control is unavailable.";
const TOOL_RESULT_SYSTEM_PROMPT: &str = "You are Galley Native. You have received tool results from Galley Core. Use them to produce the final user-facing answer. Do not emit another tool call in this continuation. If the tool result is insufficient or failed, explain the concrete next step.";

#[derive(Debug, Clone)]
pub struct NativeModelSelection {
    pub index: Option<u32>,
    pub key: Option<String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NativeModelConfig {
    pub id: String,
    pub display_name: String,
    protocol: ManagedModelProtocol,
    pub api_base: String,
    pub model: String,
    api_key: String,
    advanced_options: Value,
}

impl NativeModelConfig {
    pub fn streaming_enabled(&self) -> bool {
        self.advanced_options
            .get("stream")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct NativeModelResponse {
    pub content: String,
    pub model_name: String,
    pub stop_reason: Option<String>,
    pub usage: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NativeModelTextRole {
    User,
    Assistant,
}

impl NativeModelTextRole {
    fn as_wire_role(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeModelTextMessage {
    role: NativeModelTextRole,
    content: String,
}

impl NativeModelTextMessage {
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: NativeModelTextRole::User,
            content: content.into(),
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: NativeModelTextRole::Assistant,
            content: content.into(),
        }
    }
}

pub async fn resolve_native_model_selection(
    galley: &SqliteGalley,
    name: Option<&str>,
) -> Result<NativeModelSelection> {
    let models = galley.list_managed_models().await?;
    let name = name.map(str::trim).filter(|value| !value.is_empty());

    if let Some(name) = name {
        let model = models
            .iter()
            .find(|model| model_name_matches(model, name))
            .ok_or_else(|| GalleyError::InvalidArgs {
                message: format!(
                    "unknown galley_native llm '{name}'; configure it in Settings > Models"
                ),
            })?;
        let config = runtime_config_for_record(galley, model).await?;
        return Ok(selection_from_config(&config));
    }

    if let Some(config) = load_first_usable_native_model(galley, &models).await? {
        return Ok(selection_from_config(&config));
    }

    Ok(NativeModelSelection {
        index: None,
        key: None,
        display_name: Some("Galley Native mock".to_string()),
    })
}

pub async fn load_selected_or_default_model(
    galley: &SqliteGalley,
    selected_model_id: Option<&str>,
) -> Result<Option<NativeModelConfig>> {
    let models = galley.list_managed_models().await?;
    if let Some(selected_model_id) = selected_model_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let model = models
            .iter()
            .find(|model| model.id == selected_model_id)
            .ok_or_else(|| GalleyError::InvalidArgs {
                message: format!("managed model {selected_model_id} not found"),
            })?;
        return runtime_config_for_record(galley, model).await.map(Some);
    }

    load_first_usable_native_model(galley, &models).await
}

pub async fn complete_no_tool_turn(
    config: &NativeModelConfig,
    task: &str,
) -> Result<NativeModelResponse> {
    complete_no_tool_turn_with_delta(config, task, |_| {}).await
}

pub async fn complete_no_tool_turn_with_delta<F>(
    config: &NativeModelConfig,
    task: &str,
    on_delta: F,
) -> Result<NativeModelResponse>
where
    F: FnMut(&str),
{
    complete_text_turn_with_delta(
        config,
        INITIAL_SYSTEM_PROMPT,
        &[NativeModelTextMessage::user(task)],
        config.streaming_enabled(),
        on_delta,
    )
    .await
}

pub(crate) fn task_with_working_checkpoint(task: &str, checkpoint: Option<&str>) -> String {
    let Some(checkpoint) = checkpoint
        .map(str::trim)
        .filter(|checkpoint| !checkpoint.is_empty())
    else {
        return task.to_string();
    };
    let (checkpoint, truncated) = truncate_chars(checkpoint, WORKING_CHECKPOINT_PROMPT_MAX_CHARS);
    let suffix = if truncated {
        "\n[Working checkpoint truncated before this turn.]"
    } else {
        ""
    };
    format!(
        "Current Galley Native working checkpoint from this session:\n```text\n{checkpoint}\n```{suffix}\n\nUser request:\n{task}"
    )
}

pub async fn complete_tool_result_turn(
    config: &NativeModelConfig,
    task: &str,
    assistant_tool_request: &str,
    tool_results: &[Value],
) -> Result<NativeModelResponse> {
    let tool_results_prompt = format_tool_results_prompt(tool_results);
    complete_text_turn_with_delta(
        config,
        TOOL_RESULT_SYSTEM_PROMPT,
        &[
            NativeModelTextMessage::user(task),
            NativeModelTextMessage::assistant(assistant_tool_request),
            NativeModelTextMessage::user(tool_results_prompt),
        ],
        false,
        |_| {},
    )
    .await
}

async fn complete_text_turn_with_delta<F>(
    config: &NativeModelConfig,
    system_prompt: &str,
    messages: &[NativeModelTextMessage],
    stream: bool,
    on_delta: F,
) -> Result<NativeModelResponse>
where
    F: FnMut(&str),
{
    let endpoint = match config.protocol {
        ManagedModelProtocol::Openai => openai_chat_completions_endpoint(&config.api_base)?,
        ManagedModelProtocol::Anthropic => anthropic_messages_endpoint(&config.api_base)?,
    };
    let timeout = read_timeout(&config.advanced_options);
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| GalleyError::Internal {
            message: format!("building native model HTTP client: {e}"),
        })?;
    let payload = match config.protocol {
        ManagedModelProtocol::Openai => openai_chat_completion_payload(
            &config.model,
            system_prompt,
            messages,
            &config.advanced_options,
            stream,
        ),
        ManagedModelProtocol::Anthropic => anthropic_messages_payload(
            &config.model,
            system_prompt,
            messages,
            &config.advanced_options,
            stream,
        ),
    };
    let req = client.post(&endpoint).json(&payload);
    let resp = apply_auth_headers(req, config.protocol, &config.api_key)
        .send()
        .await
        .map_err(|e| GalleyError::RunnerError {
            message: format!(
                "native model request failed for {}: {e}",
                config.display_name
            ),
        })?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.map_err(|e| GalleyError::RunnerError {
            message: format!("reading native model error response failed: {e}"),
        })?;
        return Err(GalleyError::RunnerError {
            message: format!(
                "native model request failed for {} (HTTP {}: {})",
                config.display_name,
                status.as_u16(),
                compact_body(&body)
            ),
        });
    }

    match (config.protocol, stream) {
        (ManagedModelProtocol::Openai, true) => {
            parse_openai_chat_completion_stream_response(resp, on_delta).await
        }
        (ManagedModelProtocol::Anthropic, true) => {
            parse_anthropic_messages_stream_response(resp, on_delta).await
        }
        (ManagedModelProtocol::Openai, false) => {
            let body = resp.text().await.map_err(|e| GalleyError::RunnerError {
                message: format!("reading native model response failed: {e}"),
            })?;
            parse_openai_chat_completion_response(&body)
        }
        (ManagedModelProtocol::Anthropic, false) => {
            let body = resp.text().await.map_err(|e| GalleyError::RunnerError {
                message: format!("reading native model response failed: {e}"),
            })?;
            parse_anthropic_messages_response(&body)
        }
    }
}

fn selection_from_config(config: &NativeModelConfig) -> NativeModelSelection {
    NativeModelSelection {
        index: None,
        key: Some(config.id.clone()),
        display_name: Some(config.display_name.clone()),
    }
}

async fn load_first_usable_native_model(
    galley: &SqliteGalley,
    models: &[ManagedModelRecord],
) -> Result<Option<NativeModelConfig>> {
    for model in models {
        if !is_native_model_supported(model) {
            continue;
        }
        if model.credential_status != ManagedModelCredentialStatus::Present {
            continue;
        }
        if let Ok(config) = runtime_config_for_record(galley, model).await {
            return Ok(Some(config));
        }
    }
    Ok(None)
}

async fn runtime_config_for_record(
    galley: &SqliteGalley,
    model: &ManagedModelRecord,
) -> Result<NativeModelConfig> {
    ensure_native_model_supported(model)?;
    let api_key = credential_store::get_secret(galley, &model.api_key_ref).await?;
    if api_key.trim().is_empty() {
        return Err(GalleyError::InvalidArgs {
            message: format!(
                "managed model {} has an empty credential; re-enter the model key in Settings > Models",
                model_display_name(model)
            ),
        });
    }
    Ok(NativeModelConfig {
        id: model.id.clone(),
        display_name: model_display_name(model),
        protocol: model.protocol,
        api_base: model.api_base.clone(),
        model: model.model.clone(),
        api_key,
        advanced_options: model.advanced_options.clone(),
    })
}

fn ensure_native_model_supported(model: &ManagedModelRecord) -> Result<()> {
    if model.auth_kind != ManagedModelAuthKind::ApiKey {
        return Err(GalleyError::InvalidArgs {
            message: format!(
                "galley_native native model adapter supports API-key managed models only; '{}' uses {:?}",
                model_display_name(model),
                model.auth_kind
            ),
        });
    }
    Ok(())
}

fn is_native_model_supported(model: &ManagedModelRecord) -> bool {
    matches!(
        model.protocol,
        ManagedModelProtocol::Openai | ManagedModelProtocol::Anthropic
    ) && model.auth_kind == ManagedModelAuthKind::ApiKey
}

fn model_name_matches(model: &ManagedModelRecord, name: &str) -> bool {
    let target = name.to_ascii_lowercase();
    model.id.to_ascii_lowercase() == target
        || model.model.to_ascii_lowercase() == target
        || model_display_name(model).to_ascii_lowercase() == target
}

fn model_display_name(model: &ManagedModelRecord) -> String {
    let trimmed = model.display_name.trim();
    if trimmed.is_empty() {
        model.model.clone()
    } else {
        trimmed.to_string()
    }
}

fn openai_chat_completions_endpoint(api_base: &str) -> Result<String> {
    provider_endpoint(api_base, "chat/completions")
}

fn anthropic_messages_endpoint(api_base: &str) -> Result<String> {
    let endpoint = provider_endpoint(api_base, "messages")?;
    if endpoint.contains('?') {
        Ok(format!("{endpoint}&beta=true"))
    } else {
        Ok(format!("{endpoint}?beta=true"))
    }
}

fn apply_auth_headers(
    req: reqwest::RequestBuilder,
    protocol: ManagedModelProtocol,
    secret: &str,
) -> reqwest::RequestBuilder {
    match protocol {
        ManagedModelProtocol::Openai => req.bearer_auth(secret),
        ManagedModelProtocol::Anthropic => {
            let req = req
                .header("anthropic-version", "2023-06-01")
                .header(
                    "anthropic-beta",
                    "claude-code-20250219,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,prompt-caching-scope-2026-01-05",
                )
                .header("anthropic-dangerous-direct-browser-access", "true")
                .header("user-agent", "claude-cli/2.1.113 (external, cli)")
                .header("x-app", "cli");
            if secret.starts_with("sk-ant-") {
                req.header("x-api-key", secret)
            } else {
                req.bearer_auth(secret)
            }
        }
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
    api_base.split('/').any(|segment| {
        segment.len() > 1
            && segment.starts_with('v')
            && segment[1..].chars().all(|c| c.is_ascii_digit())
    })
}

fn openai_chat_completion_payload(
    model: &str,
    system_prompt: &str,
    messages: &[NativeModelTextMessage],
    advanced: &Value,
    stream: bool,
) -> Value {
    let lower_model = model.to_ascii_lowercase();
    let token_key = if ["gpt-5", "o1", "o2", "o3", "o4"]
        .iter()
        .any(|prefix| lower_model.starts_with(prefix))
    {
        "max_completion_tokens"
    } else {
        "max_tokens"
    };
    let mut wire_messages = Vec::with_capacity(messages.len() + 1);
    wire_messages.push(serde_json::json!({
        "role": "system",
        "content": system_prompt
    }));
    wire_messages.extend(messages.iter().map(openai_message_value));
    let mut payload = serde_json::json!({
        "model": model,
        "messages": wire_messages,
        "stream": stream
    });
    payload[token_key] = serde_json::json!(max_tokens(advanced));
    if let Some(temperature) = advanced.get("temperature").and_then(Value::as_f64) {
        payload["temperature"] = serde_json::json!(temperature);
    }
    payload
}

fn anthropic_messages_payload(
    model: &str,
    system_prompt: &str,
    messages: &[NativeModelTextMessage],
    advanced: &Value,
    stream: bool,
) -> Value {
    let wire_messages = messages
        .iter()
        .map(anthropic_message_value)
        .collect::<Vec<_>>();
    let mut payload = serde_json::json!({
        "model": model,
        "system": system_prompt,
        "messages": wire_messages,
        "max_tokens": max_tokens(advanced),
        "stream": stream
    });
    if let Some(temperature) = advanced.get("temperature").and_then(Value::as_f64) {
        payload["temperature"] = serde_json::json!(temperature);
    }
    payload
}

fn openai_message_value(message: &NativeModelTextMessage) -> Value {
    serde_json::json!({
        "role": message.role.as_wire_role(),
        "content": message.content
    })
}

fn anthropic_message_value(message: &NativeModelTextMessage) -> Value {
    serde_json::json!({
        "role": message.role.as_wire_role(),
        "content": [
            {
                "type": "text",
                "text": message.content
            }
        ]
    })
}

fn format_tool_results_prompt(tool_results: &[Value]) -> String {
    let raw = serde_json::to_string_pretty(tool_results).unwrap_or_else(|_| "[]".to_string());
    let (body, truncated) = truncate_chars(&raw, CONTINUATION_TOOL_RESULT_MAX_CHARS);
    let suffix = if truncated {
        "\n\n[Tool results were truncated before being sent back to the model.]"
    } else {
        ""
    };
    format!("Tool results from Galley Core:\n```json\n{body}\n```{suffix}")
}

fn truncate_chars(value: &str, max_chars: usize) -> (String, bool) {
    let mut out = String::new();
    for (index, ch) in value.chars().enumerate() {
        if index >= max_chars {
            return (out, true);
        }
        out.push(ch);
    }
    (out, false)
}

fn max_tokens(advanced: &Value) -> u64 {
    advanced
        .get("max_tokens")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_MAX_TOKENS)
}

fn read_timeout(advanced: &Value) -> Duration {
    let secs = advanced
        .get("read_timeout")
        .or_else(|| advanced.get("timeout"))
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_READ_TIMEOUT_SECS);
    Duration::from_secs(secs)
}

fn parse_openai_chat_completion_response(body: &str) -> Result<NativeModelResponse> {
    let json: Value = serde_json::from_str(body).map_err(|e| GalleyError::RunnerError {
        message: format!("native model response is not JSON: {e}"),
    })?;
    let choice = json
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .ok_or_else(|| GalleyError::RunnerError {
            message: "native model response has no choices".into(),
        })?;
    let content = choice
        .get("message")
        .and_then(extract_message_text)
        .unwrap_or_default();
    let content = content.trim().to_string();
    let stop_reason = choice
        .get("finish_reason")
        .and_then(Value::as_str)
        .map(str::to_string);
    if content.is_empty() {
        let reason = stop_reason.as_deref().unwrap_or("unknown");
        return Err(GalleyError::RunnerError {
            message: format!(
                "native model returned an empty response (finish_reason={reason}); check model output limits or choose another model"
            ),
        });
    }
    Ok(NativeModelResponse {
        content,
        model_name: json
            .get("model")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("openai-compatible")
            .to_string(),
        stop_reason,
        usage: json.get("usage").cloned(),
    })
}

fn parse_anthropic_messages_response(body: &str) -> Result<NativeModelResponse> {
    let json: Value = serde_json::from_str(body).map_err(|e| GalleyError::RunnerError {
        message: format!("native model response is not JSON: {e}"),
    })?;
    let content = extract_anthropic_content_text(json.get("content").ok_or_else(|| {
        GalleyError::RunnerError {
            message: "native Anthropic response has no content".into(),
        }
    })?)
    .trim()
    .to_string();
    let stop_reason = json
        .get("stop_reason")
        .and_then(Value::as_str)
        .map(str::to_string);
    if content.is_empty() {
        let reason = stop_reason.as_deref().unwrap_or("unknown");
        return Err(GalleyError::RunnerError {
            message: format!(
                "native model returned an empty response (stop_reason={reason}); check model output limits or choose another model"
            ),
        });
    }
    Ok(NativeModelResponse {
        content,
        model_name: json
            .get("model")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("anthropic-compatible")
            .to_string(),
        stop_reason,
        usage: json.get("usage").cloned(),
    })
}

async fn parse_openai_chat_completion_stream_response<F>(
    mut resp: reqwest::Response,
    mut on_delta: F,
) -> Result<NativeModelResponse>
where
    F: FnMut(&str),
{
    let mut buffer = String::new();
    let mut content = String::new();
    let mut model_name: Option<String> = None;
    let mut stop_reason: Option<String> = None;
    let mut usage: Option<Value> = None;
    let mut done = false;

    while let Some(chunk) = resp.chunk().await.map_err(|e| GalleyError::RunnerError {
        message: format!("reading native model stream failed: {e}"),
    })? {
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        drain_sse_lines(
            &mut buffer,
            &mut content,
            &mut model_name,
            &mut stop_reason,
            &mut usage,
            &mut done,
            &mut on_delta,
        )?;
        if done {
            break;
        }
    }

    if !buffer.trim().is_empty() {
        buffer.push('\n');
        drain_sse_lines(
            &mut buffer,
            &mut content,
            &mut model_name,
            &mut stop_reason,
            &mut usage,
            &mut done,
            &mut on_delta,
        )?;
    }

    let content = content.trim().to_string();
    if content.is_empty() {
        let reason = stop_reason.as_deref().unwrap_or("unknown");
        return Err(GalleyError::RunnerError {
            message: format!(
                "native model returned an empty streaming response (finish_reason={reason}); check model output limits or choose another model"
            ),
        });
    }

    Ok(NativeModelResponse {
        content,
        model_name: model_name.unwrap_or_else(|| "openai-compatible".to_string()),
        stop_reason,
        usage,
    })
}

async fn parse_anthropic_messages_stream_response<F>(
    mut resp: reqwest::Response,
    mut on_delta: F,
) -> Result<NativeModelResponse>
where
    F: FnMut(&str),
{
    let mut buffer = String::new();
    let mut content = String::new();
    let mut model_name: Option<String> = None;
    let mut stop_reason: Option<String> = None;
    let mut usage: Option<Value> = None;
    let mut done = false;

    while let Some(chunk) = resp.chunk().await.map_err(|e| GalleyError::RunnerError {
        message: format!("reading native model stream failed: {e}"),
    })? {
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        drain_anthropic_sse_lines(
            &mut buffer,
            &mut content,
            &mut model_name,
            &mut stop_reason,
            &mut usage,
            &mut done,
            &mut on_delta,
        )?;
        if done {
            break;
        }
    }

    if !buffer.trim().is_empty() {
        buffer.push('\n');
        drain_anthropic_sse_lines(
            &mut buffer,
            &mut content,
            &mut model_name,
            &mut stop_reason,
            &mut usage,
            &mut done,
            &mut on_delta,
        )?;
    }

    let content = content.trim().to_string();
    if content.is_empty() {
        let reason = stop_reason.as_deref().unwrap_or("unknown");
        return Err(GalleyError::RunnerError {
            message: format!(
                "native model returned an empty streaming response (stop_reason={reason}); check model output limits or choose another model"
            ),
        });
    }

    Ok(NativeModelResponse {
        content,
        model_name: model_name.unwrap_or_else(|| "anthropic-compatible".to_string()),
        stop_reason,
        usage,
    })
}

fn drain_sse_lines<F>(
    buffer: &mut String,
    content: &mut String,
    model_name: &mut Option<String>,
    stop_reason: &mut Option<String>,
    usage: &mut Option<Value>,
    done: &mut bool,
    on_delta: &mut F,
) -> Result<()>
where
    F: FnMut(&str),
{
    while let Some(newline) = buffer.find('\n') {
        let mut line = buffer[..newline].to_string();
        buffer.replace_range(..=newline, "");
        line = line.trim_end_matches('\r').trim().to_string();
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            *done = true;
            continue;
        }
        apply_openai_stream_data(data, content, model_name, stop_reason, usage, on_delta)?;
    }
    Ok(())
}

fn drain_anthropic_sse_lines<F>(
    buffer: &mut String,
    content: &mut String,
    model_name: &mut Option<String>,
    stop_reason: &mut Option<String>,
    usage: &mut Option<Value>,
    done: &mut bool,
    on_delta: &mut F,
) -> Result<()>
where
    F: FnMut(&str),
{
    while let Some(newline) = buffer.find('\n') {
        let mut line = buffer[..newline].to_string();
        buffer.replace_range(..=newline, "");
        line = line.trim_end_matches('\r').trim().to_string();
        if line.is_empty() || line.starts_with(':') || line.starts_with("event:") {
            continue;
        }
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            *done = true;
            continue;
        }
        apply_anthropic_stream_data(data, content, model_name, stop_reason, usage, on_delta)?;
    }
    Ok(())
}

fn apply_openai_stream_data<F>(
    data: &str,
    content: &mut String,
    model_name: &mut Option<String>,
    stop_reason: &mut Option<String>,
    usage: &mut Option<Value>,
    on_delta: &mut F,
) -> Result<()>
where
    F: FnMut(&str),
{
    let json: Value = serde_json::from_str(data).map_err(|e| GalleyError::RunnerError {
        message: format!("native model stream chunk is not JSON: {e}"),
    })?;
    if model_name.is_none() {
        *model_name = json
            .get("model")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);
    }
    if let Some(chunk_usage) = json.get("usage").filter(|value| !value.is_null()) {
        *usage = Some(chunk_usage.clone());
    }
    if let Some(choice) = json
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
    {
        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            *stop_reason = Some(reason.to_string());
        }
        if let Some(delta) = choice.get("delta").and_then(extract_message_text) {
            if !delta.is_empty() {
                content.push_str(&delta);
                on_delta(&delta);
            }
        }
    }
    Ok(())
}

fn apply_anthropic_stream_data<F>(
    data: &str,
    content: &mut String,
    model_name: &mut Option<String>,
    stop_reason: &mut Option<String>,
    usage: &mut Option<Value>,
    on_delta: &mut F,
) -> Result<()>
where
    F: FnMut(&str),
{
    let json: Value = serde_json::from_str(data).map_err(|e| GalleyError::RunnerError {
        message: format!("native model stream chunk is not JSON: {e}"),
    })?;
    if model_name.is_none() {
        *model_name = json
            .get("message")
            .and_then(|message| message.get("model"))
            .or_else(|| json.get("model"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);
    }
    if let Some(message_usage) = json
        .get("message")
        .and_then(|message| message.get("usage"))
        .filter(|value| !value.is_null())
    {
        *usage = Some(message_usage.clone());
    }
    if let Some(delta_usage) = json.get("usage").filter(|value| !value.is_null()) {
        *usage = Some(merge_anthropic_usage(usage.take(), delta_usage.clone()));
    }
    if let Some(reason) = json
        .get("delta")
        .and_then(|delta| delta.get("stop_reason"))
        .and_then(Value::as_str)
    {
        *stop_reason = Some(reason.to_string());
    }
    if matches!(
        json.get("type").and_then(Value::as_str),
        Some("message_stop")
    ) {
        return Ok(());
    }
    if let Some(delta) = json.get("delta").and_then(extract_anthropic_delta_text) {
        if !delta.is_empty() {
            content.push_str(&delta);
            on_delta(&delta);
        }
    }
    Ok(())
}

fn extract_message_text(message: &Value) -> Option<String> {
    if let Some(text) = message.get("content").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    if let Some(parts) = message.get("content").and_then(Value::as_array) {
        let text = parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| part.get("content").and_then(Value::as_str))
            })
            .collect::<Vec<_>>()
            .join("");
        return Some(text);
    }
    message
        .get("refusal")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn extract_anthropic_content_text(content: &Value) -> String {
    let Some(parts) = content.as_array() else {
        return String::new();
    };
    parts
        .iter()
        .filter_map(|part| {
            part.get("text")
                .and_then(Value::as_str)
                .or_else(|| part.get("content").and_then(Value::as_str))
        })
        .collect::<Vec<_>>()
        .join("")
}

fn extract_anthropic_delta_text(delta: &Value) -> Option<String> {
    if matches!(
        delta.get("type").and_then(Value::as_str),
        Some("text_delta")
    ) {
        return delta
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    delta
        .get("text")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn merge_anthropic_usage(existing: Option<Value>, delta: Value) -> Value {
    let Some(mut existing) = existing else {
        return delta;
    };
    if let (Some(existing_obj), Some(delta_obj)) = (existing.as_object_mut(), delta.as_object()) {
        for (key, value) in delta_obj {
            existing_obj.insert(key.clone(), value.clone());
        }
        existing
    } else {
        delta
    }
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
    fn openai_endpoint_normalizes_common_bases() {
        assert_eq!(
            openai_chat_completions_endpoint("https://api.openai.com").unwrap(),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            openai_chat_completions_endpoint("https://relay.example/v1").unwrap(),
            "https://relay.example/v1/chat/completions"
        );
        assert_eq!(
            openai_chat_completions_endpoint("https://relay.example/v1/responses").unwrap(),
            "https://relay.example/v1/chat/completions"
        );
    }

    #[test]
    fn anthropic_endpoint_adds_messages_path_and_beta_query() {
        assert_eq!(
            anthropic_messages_endpoint("https://api.anthropic.com").unwrap(),
            "https://api.anthropic.com/v1/messages?beta=true"
        );
        assert_eq!(
            anthropic_messages_endpoint("https://relay.example/v1/messages").unwrap(),
            "https://relay.example/v1/messages?beta=true"
        );
    }

    #[test]
    fn payload_uses_completion_tokens_for_gpt5_family() {
        let payload = openai_chat_completion_payload(
            "gpt-5.1",
            INITIAL_SYSTEM_PROMPT,
            &[NativeModelTextMessage::user("hello")],
            &serde_json::json!({}),
            false,
        );
        assert_eq!(payload["max_completion_tokens"], DEFAULT_MAX_TOKENS);
        assert!(payload.get("max_tokens").is_none());
    }

    #[test]
    fn payload_can_enable_streaming() {
        let payload = openai_chat_completion_payload(
            "gpt-test",
            INITIAL_SYSTEM_PROMPT,
            &[NativeModelTextMessage::user("hello")],
            &serde_json::json!({}),
            true,
        );
        assert_eq!(payload["stream"], true);
    }

    #[test]
    fn initial_prompt_advertises_landed_native_tools() {
        assert!(INITIAL_SYSTEM_PROMPT.contains("file_read"));
        assert!(INITIAL_SYSTEM_PROMPT.contains("file_patch"));
        assert!(INITIAL_SYSTEM_PROMPT.contains("file_write"));
        assert!(INITIAL_SYSTEM_PROMPT.contains("code_run"));
        assert!(INITIAL_SYSTEM_PROMPT.contains("web_scan"));
        assert!(INITIAL_SYSTEM_PROMPT.contains("web_execute_js"));
        assert!(INITIAL_SYSTEM_PROMPT.contains("memory://"));
        assert!(INITIAL_SYSTEM_PROMPT.contains("capability://"));
        assert!(INITIAL_SYSTEM_PROMPT.contains("workspace://snapshot"));
        assert!(INITIAL_SYSTEM_PROMPT.contains("low-risk text memory"));
        assert!(INITIAL_SYSTEM_PROMPT.contains("cannot execute capability:// scripts"));
        assert!(INITIAL_SYSTEM_PROMPT.contains("session-local working state"));
        assert!(!INITIAL_SYSTEM_PROMPT.contains("file_read is the only real local executor"));
    }

    #[test]
    fn task_with_working_checkpoint_injects_session_state() {
        let task = task_with_working_checkpoint(
            "Continue the implementation.",
            Some("update_working_checkpoint:\nstatus: active\n\nTests are next."),
        );

        assert!(task.contains("Current Galley Native working checkpoint"));
        assert!(task.contains("Tests are next."));
        assert!(task.contains("User request:\nContinue the implementation."));
    }

    #[test]
    fn task_without_working_checkpoint_is_unchanged() {
        assert_eq!(
            task_with_working_checkpoint("Continue.", Some("   ")),
            "Continue."
        );
        assert_eq!(task_with_working_checkpoint("Continue.", None), "Continue.");
    }

    #[test]
    fn anthropic_payload_uses_content_blocks_and_stream_flag() {
        let payload = anthropic_messages_payload(
            "claude-test",
            INITIAL_SYSTEM_PROMPT,
            &[NativeModelTextMessage::user("hello")],
            &serde_json::json!({}),
            true,
        );
        assert_eq!(payload["model"], "claude-test");
        assert_eq!(payload["stream"], true);
        assert_eq!(payload["messages"][0]["content"][0]["type"], "text");
        assert_eq!(payload["messages"][0]["content"][0]["text"], "hello");
    }

    #[test]
    fn continuation_payload_carries_tool_request_and_result() {
        let tool_results = vec![serde_json::json!({
            "toolName": "file_read",
            "status": "success",
            "content": "file_read: /tmp/notes.txt\n\nhello from file"
        })];
        let prompt = format_tool_results_prompt(&tool_results);
        let payload = openai_chat_completion_payload(
            "gpt-test",
            TOOL_RESULT_SYSTEM_PROMPT,
            &[
                NativeModelTextMessage::user("Read notes.txt"),
                NativeModelTextMessage::assistant(
                    r#"{"tool":"file_read","arguments":{"path":"notes.txt"}}"#,
                ),
                NativeModelTextMessage::user(prompt),
            ],
            &serde_json::json!({}),
            false,
        );

        assert_eq!(payload["stream"], false);
        assert!(payload["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("tool results"));
        assert!(payload["messages"][2]["content"]
            .as_str()
            .unwrap()
            .contains("\"tool\":\"file_read\""));
        assert!(payload["messages"][3]["content"]
            .as_str()
            .unwrap()
            .contains("hello from file"));
    }

    #[test]
    fn parses_openai_fixture_response() {
        let response = parse_openai_chat_completion_response(
            r#"{
              "model":"gpt-test",
              "choices":[{"message":{"role":"assistant","content":"native answer"},"finish_reason":"stop"}],
              "usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}
            }"#,
        )
        .unwrap();
        assert_eq!(response.content, "native answer");
        assert_eq!(response.model_name, "gpt-test");
        assert_eq!(response.stop_reason.as_deref(), Some("stop"));
        assert_eq!(response.usage.unwrap()["total_tokens"], 5);
    }

    #[test]
    fn parses_text_block_content_fixture_response() {
        let response = parse_openai_chat_completion_response(
            r#"{
              "choices":[{"message":{"content":[{"type":"text","text":"hello "},{"type":"text","text":"world"}]},"finish_reason":"stop"}]
            }"#,
        )
        .unwrap();
        assert_eq!(response.content, "hello world");
    }

    #[test]
    fn parses_anthropic_fixture_response() {
        let response = parse_anthropic_messages_response(
            r#"{
              "model":"claude-test",
              "content":[{"type":"text","text":"native claude answer"}],
              "stop_reason":"end_turn",
              "usage":{"input_tokens":4,"output_tokens":5}
            }"#,
        )
        .unwrap();
        assert_eq!(response.content, "native claude answer");
        assert_eq!(response.model_name, "claude-test");
        assert_eq!(response.stop_reason.as_deref(), Some("end_turn"));
        assert_eq!(response.usage.unwrap()["output_tokens"], 5);
    }

    #[test]
    fn rejects_empty_model_response() {
        let err = parse_openai_chat_completion_response(
            r#"{"choices":[{"message":{"content":"   "},"finish_reason":"length"}]}"#,
        )
        .unwrap_err();
        assert!(matches!(err, GalleyError::RunnerError { .. }));
        assert!(err.to_string().contains("empty response"));
    }

    #[test]
    fn stream_data_accumulates_deltas_stop_reason_and_usage() {
        let mut content = String::new();
        let mut model_name = None;
        let mut stop_reason = None;
        let mut usage = None;
        let mut deltas = Vec::new();
        apply_openai_stream_data(
            r#"{"model":"gpt-test","choices":[{"delta":{"content":"hello "},"finish_reason":null}]}"#,
            &mut content,
            &mut model_name,
            &mut stop_reason,
            &mut usage,
            &mut |delta| deltas.push(delta.to_string()),
        )
        .unwrap();
        apply_openai_stream_data(
            r#"{"model":"gpt-test","choices":[{"delta":{"content":[{"type":"text","text":"world"}]},"finish_reason":"stop"}],"usage":{"total_tokens":7}}"#,
            &mut content,
            &mut model_name,
            &mut stop_reason,
            &mut usage,
            &mut |delta| deltas.push(delta.to_string()),
        )
        .unwrap();

        assert_eq!(content, "hello world");
        assert_eq!(deltas, vec!["hello ", "world"]);
        assert_eq!(model_name.as_deref(), Some("gpt-test"));
        assert_eq!(stop_reason.as_deref(), Some("stop"));
        assert_eq!(usage.unwrap()["total_tokens"], 7);
    }

    #[test]
    fn anthropic_stream_data_accumulates_deltas_stop_reason_and_usage() {
        let mut content = String::new();
        let mut model_name = None;
        let mut stop_reason = None;
        let mut usage = None;
        let mut deltas = Vec::new();
        apply_anthropic_stream_data(
            r#"{"type":"message_start","message":{"model":"claude-test","usage":{"input_tokens":4}}}"#,
            &mut content,
            &mut model_name,
            &mut stop_reason,
            &mut usage,
            &mut |delta| deltas.push(delta.to_string()),
        )
        .unwrap();
        apply_anthropic_stream_data(
            r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello "}}"#,
            &mut content,
            &mut model_name,
            &mut stop_reason,
            &mut usage,
            &mut |delta| deltas.push(delta.to_string()),
        )
        .unwrap();
        apply_anthropic_stream_data(
            r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}"#,
            &mut content,
            &mut model_name,
            &mut stop_reason,
            &mut usage,
            &mut |delta| deltas.push(delta.to_string()),
        )
        .unwrap();
        apply_anthropic_stream_data(
            r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}"#,
            &mut content,
            &mut model_name,
            &mut stop_reason,
            &mut usage,
            &mut |delta| deltas.push(delta.to_string()),
        )
        .unwrap();

        assert_eq!(content, "hello world");
        assert_eq!(deltas, vec!["hello ", "world"]);
        assert_eq!(model_name.as_deref(), Some("claude-test"));
        assert_eq!(stop_reason.as_deref(), Some("end_turn"));
        let usage = usage.unwrap();
        assert_eq!(usage["input_tokens"], 4);
        assert_eq!(usage["output_tokens"], 5);
    }
}
