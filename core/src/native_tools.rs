use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};

const FILE_READ_MAX_BYTES: u64 = 256 * 1024;

pub const PARITY_TOOL_NAMES: [&str; 9] = [
    "code_run",
    "file_read",
    "file_patch",
    "file_write",
    "web_scan",
    "web_execute_js",
    "update_working_checkpoint",
    "ask_user",
    "start_long_term_update",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeToolCallSource {
    Structured,
    TextFallback,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeToolParseClassification {
    NoTool,
    ToolCalls,
    MalformedToolCall,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolParseOutcome {
    pub classification: NativeToolParseClassification,
    pub calls: Vec<NativeToolCall>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolCall {
    pub id: String,
    pub name: String,
    pub arguments_json: Value,
    pub raw_arguments_text: Option<String>,
    pub source: NativeToolCallSource,
    pub risk_hint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub native_owner: String,
    pub default_approval: String,
    pub side_effect_mode: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeToolStubResult {
    pub tool_call_id: String,
    pub tool_name: String,
    pub status: String,
    pub content: String,
    pub side_effects_performed: bool,
    pub requires_user_response: bool,
    pub approval: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NativeToolExecutionContext {
    pub workspace_root: Option<PathBuf>,
}

impl NativeToolExecutionContext {
    pub fn new(workspace_root: Option<PathBuf>) -> Self {
        Self { workspace_root }
    }
}

#[derive(Debug)]
struct ParsedToolCall {
    id: Option<String>,
    name: String,
    arguments_json: Value,
    raw_arguments_text: Option<String>,
}

pub fn parity_tool_specs() -> Vec<NativeToolSpec> {
    vec![
        spec(
            "code_run",
            "Execute a local command in a controlled workspace.",
            "core_tool_runner",
            "risk_based",
            serde_json::json!({
                "type": "object",
                "required": ["command"],
                "properties": {
                    "command": { "type": "string" },
                    "cwd": { "type": "string" },
                    "timeoutSeconds": { "type": "number" }
                }
            }),
        ),
        spec(
            "file_read",
            "Read a file or a line range from an allowed path.",
            "core_file_tool",
            "none",
            serde_json::json!({
                "type": "object",
                "required": ["path"],
                "properties": {
                    "path": { "type": "string" },
                    "startLine": { "type": "number" },
                    "endLine": { "type": "number" }
                }
            }),
        ),
        spec(
            "file_patch",
            "Apply a targeted patch to an existing file.",
            "core_file_tool",
            "risk_based",
            serde_json::json!({
                "type": "object",
                "required": ["path", "patch"],
                "properties": {
                    "path": { "type": "string" },
                    "patch": { "type": "string" },
                    "explanation": { "type": "string" }
                }
            }),
        ),
        spec(
            "file_write",
            "Create or deliberately replace file contents.",
            "core_file_tool",
            "risk_based",
            serde_json::json!({
                "type": "object",
                "required": ["path", "content"],
                "properties": {
                    "path": { "type": "string" },
                    "content": { "type": "string" },
                    "overwrite": { "type": "boolean" }
                }
            }),
        ),
        spec(
            "web_scan",
            "Inspect browser tab and page state through Browser Control.",
            "browser_bridge",
            "none",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "target": { "type": "string" },
                    "tabId": { "type": "string" }
                }
            }),
        ),
        spec(
            "web_execute_js",
            "Execute JavaScript in a controlled browser tab.",
            "browser_bridge",
            "risk_based",
            serde_json::json!({
                "type": "object",
                "required": ["code"],
                "properties": {
                    "tabId": { "type": "string" },
                    "code": { "type": "string" }
                }
            }),
        ),
        spec(
            "update_working_checkpoint",
            "Update the current task checkpoint.",
            "native_session_state",
            "none",
            serde_json::json!({
                "type": "object",
                "required": ["content"],
                "properties": {
                    "content": { "type": "string" },
                    "status": { "type": "string" }
                }
            }),
        ),
        spec(
            "ask_user",
            "Ask the human operator for input and pause the loop.",
            "core_ask_user_event",
            "always_visible",
            serde_json::json!({
                "type": "object",
                "required": ["question"],
                "properties": {
                    "question": { "type": "string" },
                    "context": { "type": "string" }
                }
            }),
        ),
        spec(
            "start_long_term_update",
            "Launch a verified memory or capability update.",
            "native_memory_worker",
            "durable_write",
            serde_json::json!({
                "type": "object",
                "required": ["topic"],
                "properties": {
                    "topic": { "type": "string" },
                    "proposal": { "type": "string" }
                }
            }),
        ),
    ]
}

pub fn tool_spec(name: &str) -> Option<NativeToolSpec> {
    parity_tool_specs()
        .into_iter()
        .find(|spec| spec.name == name)
}

pub fn approval_required(default_approval: &str) -> bool {
    matches!(default_approval, "risk_based" | "durable_write")
}

pub fn approval_for_tool_call(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> String {
    if call.name == "file_read" && file_read_requires_approval(call, context) {
        return "risk_based".to_string();
    }
    call.risk_hint
        .as_deref()
        .filter(|hint| is_approval_policy(hint))
        .map(str::to_string)
        .or_else(|| tool_spec(&call.name).map(|spec| spec.default_approval))
        .unwrap_or_else(|| "unsupported".to_string())
}

fn is_approval_policy(value: &str) -> bool {
    matches!(
        value,
        "none" | "risk_based" | "durable_write" | "always_visible" | "unsupported"
    )
}

pub fn parse_structured_tool_calls(value: &Value) -> NativeToolParseOutcome {
    let calls = normalize_calls(collect_tool_calls(value), NativeToolCallSource::Structured);
    if calls.is_empty() {
        NativeToolParseOutcome {
            classification: NativeToolParseClassification::NoTool,
            calls,
            warning: None,
        }
    } else {
        NativeToolParseOutcome {
            classification: NativeToolParseClassification::ToolCalls,
            calls,
            warning: None,
        }
    }
}

pub fn parse_text_tool_calls(text: &str) -> NativeToolParseOutcome {
    let mut saw_tool_shaped_parse_error = false;

    for candidate in json_candidates(text) {
        match serde_json::from_str::<Value>(&candidate) {
            Ok(value) => {
                let calls = normalize_calls(
                    collect_tool_calls(&value),
                    NativeToolCallSource::TextFallback,
                );
                if !calls.is_empty() {
                    return NativeToolParseOutcome {
                        classification: NativeToolParseClassification::ToolCalls,
                        calls,
                        warning: None,
                    };
                }
            }
            Err(_)
                if candidate.trim_start().starts_with(['{', '['])
                    && candidate.to_ascii_lowercase().contains("tool") =>
            {
                saw_tool_shaped_parse_error = true;
            }
            Err(_) => {}
        }
    }

    if saw_tool_shaped_parse_error {
        NativeToolParseOutcome {
            classification: NativeToolParseClassification::MalformedToolCall,
            calls: Vec::new(),
            warning: Some("tool-shaped JSON could not be parsed".to_string()),
        }
    } else {
        NativeToolParseOutcome {
            classification: NativeToolParseClassification::NoTool,
            calls: Vec::new(),
            warning: None,
        }
    }
}

pub fn execute_native_tool(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> NativeToolStubResult {
    match call.name.as_str() {
        "file_read" => file_read_result(call, context),
        _ => stub_tool_result(call),
    }
}

pub fn stub_tool_result(call: &NativeToolCall) -> NativeToolStubResult {
    let approval = tool_spec(&call.name)
        .map(|spec| spec.default_approval)
        .unwrap_or_else(|| "unsupported".to_string());
    let (status, content, requires_user_response) = match call.name.as_str() {
        "ask_user" => (
            "waiting_for_user",
            "ask_user was recognized. Native emits an ask_user event and waits for the next session.send response before continuing.",
            true,
        ),
        "update_working_checkpoint" => (
            "stub_checkpoint_observed",
            "update_working_checkpoint was recognized. Slice 4A records only the event/result stub and writes no durable checkpoint state.",
            false,
        ),
        "start_long_term_update" => (
            "stub_long_term_update_deferred",
            "start_long_term_update was recognized. Durable memory or capability writes are deferred to the native memory slices.",
            false,
        ),
        name if tool_spec(name).is_some() => (
            "stubbed_no_side_effects",
            "Tool call recognized and routed to the Slice 4A deterministic stub. No file, process, browser, memory, or Goal side effect was performed.",
            false,
        ),
        _ => (
            "unsupported_tool",
            "Tool call name is not registered in the Galley Native parity tool registry.",
            false,
        ),
    };

    NativeToolStubResult {
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        status: status.to_string(),
        content: content.to_string(),
        side_effects_performed: false,
        requires_user_response,
        approval,
    }
}

fn file_read_requires_approval(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> bool {
    let Some(path) = file_read_path_arg(call) else {
        return false;
    };
    if !path.is_absolute() {
        return false;
    }
    let Ok(canonical_path) = path.canonicalize() else {
        return false;
    };
    match canonical_workspace_root(context) {
        Some(root) => !canonical_path.starts_with(root),
        None => true,
    }
}

fn file_read_result(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> NativeToolStubResult {
    let approval = approval_for_tool_call(call, context);
    let result = file_read_content(call, context);
    let (status, content) = match result {
        Ok(content) => ("success", content),
        Err(message) => ("failed", message),
    };
    NativeToolStubResult {
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        status: status.to_string(),
        content,
        side_effects_performed: false,
        requires_user_response: false,
        approval,
    }
}

fn file_read_content(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> std::result::Result<String, String> {
    let path = file_read_path_arg(call)
        .ok_or_else(|| "file_read requires a non-empty string `path` argument.".to_string())?;
    let resolved = resolve_file_read_path(&path, context)?;
    let metadata = std::fs::metadata(&resolved)
        .map_err(|err| format!("file_read could not stat {}: {err}", resolved.display()))?;
    if !metadata.is_file() {
        return Err(format!(
            "file_read expected a regular file, got {}.",
            resolved.display()
        ));
    }
    let (start_line, end_line) = file_read_line_range(call)?;
    let (body, truncated) = read_text_with_cap(&resolved)?;
    let (selected, rendered_range) = select_line_range(&body, start_line, end_line)?;
    Ok(format_file_read_content(
        &resolved,
        rendered_range.as_deref(),
        truncated,
        &selected,
    ))
}

fn file_read_path_arg(call: &NativeToolCall) -> Option<PathBuf> {
    call.arguments_json
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn resolve_file_read_path(
    path: &Path,
    context: &NativeToolExecutionContext,
) -> std::result::Result<PathBuf, String> {
    if path.is_absolute() {
        return path
            .canonicalize()
            .map_err(|err| format!("file_read could not resolve {}: {err}", path.display()));
    }

    let Some(raw_root) = context.workspace_root.as_ref() else {
        return Err(
            "file_read relative paths require a Galley Native Project workspace; use an absolute path and approve the read, or bind a workspace in a later native workspace slice."
                .to_string(),
        );
    };
    let root = raw_root.canonicalize().map_err(|err| {
        format!(
            "file_read Project workspace {} is unavailable: {err}",
            raw_root.display()
        )
    })?;
    let resolved = root.join(path);
    let canonical = resolved.canonicalize().map_err(|err| {
        format!(
            "file_read could not resolve {} inside workspace {}: {err}",
            path.display(),
            root.display()
        )
    })?;
    if !canonical.starts_with(&root) {
        return Err(format!(
            "file_read refused {} because it resolves outside workspace {}.",
            path.display(),
            root.display()
        ));
    }
    Ok(canonical)
}

fn canonical_workspace_root(context: &NativeToolExecutionContext) -> Option<PathBuf> {
    context
        .workspace_root
        .as_ref()
        .and_then(|root| root.canonicalize().ok())
}

fn file_read_line_range(
    call: &NativeToolCall,
) -> std::result::Result<(Option<usize>, Option<usize>), String> {
    let start = optional_positive_usize(call.arguments_json.get("startLine"), "startLine")?;
    let end = optional_positive_usize(call.arguments_json.get("endLine"), "endLine")?;
    if let (Some(start), Some(end)) = (start, end) {
        if start > end {
            return Err(format!(
                "file_read invalid line range: startLine {start} is greater than endLine {end}."
            ));
        }
    }
    Ok((start, end))
}

fn optional_positive_usize(
    value: Option<&Value>,
    name: &str,
) -> std::result::Result<Option<usize>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let Some(raw) = value.as_u64() else {
        return Err(format!("file_read `{name}` must be a positive integer."));
    };
    if raw == 0 {
        return Err(format!("file_read `{name}` must be 1 or greater."));
    }
    usize::try_from(raw)
        .map(Some)
        .map_err(|_| format!("file_read `{name}` is too large."))
}

fn read_text_with_cap(path: &Path) -> std::result::Result<(String, bool), String> {
    let file = std::fs::File::open(path)
        .map_err(|err| format!("file_read could not open {}: {err}", path.display()))?;
    let mut reader = file.take(FILE_READ_MAX_BYTES + 1);
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .map_err(|err| format!("file_read could not read {}: {err}", path.display()))?;
    let truncated = bytes.len() as u64 > FILE_READ_MAX_BYTES;
    if truncated {
        bytes.truncate(FILE_READ_MAX_BYTES as usize);
    }
    Ok((String::from_utf8_lossy(&bytes).to_string(), truncated))
}

fn select_line_range(
    body: &str,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> std::result::Result<(String, Option<String>), String> {
    if start_line.is_none() && end_line.is_none() {
        return Ok((body.to_string(), None));
    }
    let start = start_line.unwrap_or(1);
    let end = end_line.unwrap_or(usize::MAX);
    let mut selected = Vec::new();
    let mut last_seen = 0_usize;
    for (index, line) in body.lines().enumerate() {
        let line_number = index + 1;
        last_seen = line_number;
        if line_number >= start && line_number <= end {
            selected.push(line);
        }
        if line_number > end {
            break;
        }
    }
    if start > last_seen.saturating_add(1) {
        return Err(format!(
            "file_read startLine {start} is beyond the file length ({last_seen} lines)."
        ));
    }
    let rendered_end = if end == usize::MAX {
        last_seen.max(start)
    } else {
        end.min(last_seen.max(start))
    };
    Ok((selected.join("\n"), Some(format!("{start}-{rendered_end}"))))
}

fn format_file_read_content(
    path: &Path,
    range: Option<&str>,
    truncated: bool,
    body: &str,
) -> String {
    let mut header = format!("file_read: {}", path.display());
    if let Some(range) = range {
        header.push_str(&format!("\nlines: {range}"));
    }
    if truncated {
        header.push_str(&format!(
            "\ntruncated: true ({} bytes)",
            FILE_READ_MAX_BYTES
        ));
    }
    format!("{header}\n\n{body}")
}

fn spec(
    name: &str,
    description: &str,
    native_owner: &str,
    default_approval: &str,
    input_schema: Value,
) -> NativeToolSpec {
    NativeToolSpec {
        name: name.to_string(),
        description: description.to_string(),
        input_schema,
        native_owner: native_owner.to_string(),
        default_approval: default_approval.to_string(),
        side_effect_mode: "slice_4a_stub_no_side_effects".to_string(),
    }
}

fn collect_tool_calls(value: &Value) -> Vec<ParsedToolCall> {
    let mut calls = Vec::new();
    collect_tool_calls_inner(value, &mut calls);
    calls
}

fn collect_tool_calls_inner(value: &Value, calls: &mut Vec<ParsedToolCall>) {
    if let Some(call) = parse_single_tool_call(value) {
        calls.push(call);
        return;
    }

    if let Some(items) = value.get("tool_calls").or_else(|| value.get("toolCalls")) {
        collect_tool_calls_inner(items, calls);
        return;
    }
    if let Some(item) = value.get("tool_call").or_else(|| value.get("toolCall")) {
        collect_tool_calls_inner(item, calls);
        return;
    }
    if let Some(array) = value.as_array() {
        for item in array {
            collect_tool_calls_inner(item, calls);
        }
    }
}

fn parse_single_tool_call(value: &Value) -> Option<ParsedToolCall> {
    let object = value.as_object()?;

    if let Some(function) = object.get("function").and_then(Value::as_object) {
        if let Some(name) = string_prop(function, &["name"]) {
            let (arguments_json, raw_arguments_text) = arguments_value(
                function
                    .get("arguments")
                    .or_else(|| object.get("arguments")),
            );
            return Some(ParsedToolCall {
                id: string_prop(object, &["id"]),
                name,
                arguments_json,
                raw_arguments_text,
            });
        }
    }

    let name = string_prop(object, &["tool", "name", "tool_name", "toolName"])?;
    let (arguments_json, raw_arguments_text) = arguments_value(
        object
            .get("arguments")
            .or_else(|| object.get("args"))
            .or_else(|| object.get("input"))
            .or_else(|| object.get("parameters")),
    );
    Some(ParsedToolCall {
        id: string_prop(object, &["id", "tool_call_id", "toolCallId"]),
        name,
        arguments_json,
        raw_arguments_text,
    })
}

fn string_prop(object: &serde_json::Map<String, Value>, names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        object
            .get(*name)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    })
}

fn arguments_value(value: Option<&Value>) -> (Value, Option<String>) {
    match value {
        Some(Value::String(raw)) => {
            let parsed =
                serde_json::from_str::<Value>(raw).unwrap_or_else(|_| Value::String(raw.clone()));
            (parsed, Some(raw.clone()))
        }
        Some(value) => (value.clone(), Some(value.to_string())),
        None => (serde_json::json!({}), None),
    }
}

fn normalize_calls(
    parsed: Vec<ParsedToolCall>,
    source: NativeToolCallSource,
) -> Vec<NativeToolCall> {
    parsed
        .into_iter()
        .enumerate()
        .map(|(index, call)| {
            let risk_hint = tool_spec(&call.name).map(|spec| spec.default_approval);
            NativeToolCall {
                id: call
                    .id
                    .unwrap_or_else(|| format!("native_tool_{}_{}", index + 1, call.name)),
                name: call.name,
                arguments_json: call.arguments_json,
                raw_arguments_text: call.raw_arguments_text,
                source: source.clone(),
                risk_hint,
            }
        })
        .collect()
}

fn json_candidates(text: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let trimmed = text.trim();
    if !trimmed.is_empty() {
        candidates.push(trimmed.to_string());
    }
    candidates.extend(fenced_json_candidates(text));
    candidates.extend(balanced_json_candidates(text));
    candidates
}

fn fenced_json_candidates(text: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("```") {
        rest = &rest[start + 3..];
        let Some(end) = rest.find("```") else {
            break;
        };
        let block = &rest[..end];
        let body = block
            .strip_prefix("json")
            .or_else(|| block.strip_prefix("JSON"))
            .unwrap_or(block)
            .trim_start_matches(|c| c == '\n' || c == '\r')
            .trim();
        if !body.is_empty() {
            candidates.push(body.to_string());
        }
        rest = &rest[end + 3..];
    }
    candidates
}

fn balanced_json_candidates(text: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    for opener in ['{', '['] {
        if let Some(candidate) = first_balanced_json(text, opener) {
            candidates.push(candidate);
        }
    }
    candidates
}

fn first_balanced_json(text: &str, opener: char) -> Option<String> {
    let closer = if opener == '{' { '}' } else { ']' };
    let mut depth = 0_i32;
    let mut start_byte = None;
    let mut in_string = false;
    let mut escape = false;

    for (idx, ch) in text.char_indices() {
        if start_byte.is_none() {
            if ch == opener {
                start_byte = Some(idx);
                depth = 1;
            }
            continue;
        }

        if escape {
            escape = false;
            continue;
        }
        if ch == '\\' && in_string {
            escape = true;
            continue;
        }
        if ch == '"' {
            in_string = !in_string;
            continue;
        }
        if in_string {
            continue;
        }
        if ch == opener {
            depth += 1;
        } else if ch == closer {
            depth -= 1;
            if depth == 0 {
                let start = start_byte.expect("start byte set when depth is positive");
                return Some(text[start..=idx].to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tool_call(name: &str, arguments_json: Value) -> NativeToolCall {
        NativeToolCall {
            id: format!("call_{name}"),
            name: name.to_string(),
            arguments_json,
            raw_arguments_text: None,
            source: NativeToolCallSource::Structured,
            risk_hint: tool_spec(name).map(|spec| spec.default_approval),
        }
    }

    #[test]
    fn registry_contains_exact_ga_parity_tool_names() {
        let names = parity_tool_specs()
            .into_iter()
            .map(|spec| spec.name)
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            PARITY_TOOL_NAMES
                .iter()
                .map(|name| (*name).to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn parses_structured_openai_style_tool_call() {
        let value = serde_json::json!({
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "file_read",
                        "arguments": "{\"path\":\"README.md\"}"
                    }
                }
            ]
        });

        let outcome = parse_structured_tool_calls(&value);

        assert_eq!(
            outcome.classification,
            NativeToolParseClassification::ToolCalls
        );
        assert_eq!(outcome.calls[0].id, "call_1");
        assert_eq!(outcome.calls[0].name, "file_read");
        assert_eq!(outcome.calls[0].arguments_json["path"], "README.md");
        assert_eq!(outcome.calls[0].source, NativeToolCallSource::Structured);
    }

    #[test]
    fn parses_fenced_text_fallback_tool_call() {
        let text = r#"I need a tool.

```json
{"tool":"code_run","arguments":{"command":"pwd"}}
```
"#;

        let outcome = parse_text_tool_calls(text);

        assert_eq!(
            outcome.classification,
            NativeToolParseClassification::ToolCalls
        );
        assert_eq!(outcome.calls[0].name, "code_run");
        assert_eq!(outcome.calls[0].arguments_json["command"], "pwd");
        assert_eq!(outcome.calls[0].source, NativeToolCallSource::TextFallback);
    }

    #[test]
    fn no_tool_response_is_classified_without_warning() {
        let outcome = parse_text_tool_calls("Here is a normal answer with no tool request.");

        assert_eq!(
            outcome.classification,
            NativeToolParseClassification::NoTool
        );
        assert!(outcome.calls.is_empty());
        assert!(outcome.warning.is_none());
    }

    #[test]
    fn malformed_tool_json_is_recoverable_classification() {
        let outcome = parse_text_tool_calls("```json\n{\"tool\":\"file_read\",\n```");

        assert_eq!(
            outcome.classification,
            NativeToolParseClassification::MalformedToolCall
        );
        assert!(outcome.calls.is_empty());
        assert!(outcome.warning.is_some());
    }

    #[test]
    fn every_parity_tool_routes_to_no_side_effect_stub() {
        for name in PARITY_TOOL_NAMES {
            let call = tool_call(name, serde_json::json!({}));

            let result = stub_tool_result(&call);

            assert_eq!(result.tool_name, name);
            assert!(!result.status.is_empty());
            assert!(!result.side_effects_performed);
        }
    }

    #[test]
    fn file_read_reads_workspace_relative_line_range_without_approval() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.txt");
        fs::write(&path, "alpha\nbeta\ngamma\n").unwrap();
        let call = tool_call(
            "file_read",
            serde_json::json!({
                "path": "notes.txt",
                "startLine": 2,
                "endLine": 3
            }),
        );

        let result = execute_native_tool(
            &call,
            &NativeToolExecutionContext::new(Some(dir.path().to_path_buf())),
        );

        assert_eq!(result.status, "success");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("lines: 2-3"));
        assert!(result.content.contains("beta\ngamma"));
        assert!(!result.content.contains("\nalpha\n"));
    }

    #[test]
    fn file_read_rejects_relative_path_without_workspace() {
        let call = tool_call(
            "file_read",
            serde_json::json!({
                "path": "notes.txt"
            }),
        );

        let result = execute_native_tool(&call, &NativeToolExecutionContext::default());

        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "none");
        assert!(result.content.contains("relative paths require"));
        assert!(!result.side_effects_performed);
    }

    #[test]
    fn file_read_marks_existing_absolute_path_outside_workspace_for_approval() {
        let file = tempfile::NamedTempFile::new().unwrap();
        fs::write(file.path(), "outside workspace").unwrap();
        let call = tool_call(
            "file_read",
            serde_json::json!({
                "path": file.path().to_string_lossy()
            }),
        );

        let approval = approval_for_tool_call(&call, &NativeToolExecutionContext::default());
        let result = execute_native_tool(&call, &NativeToolExecutionContext::default());

        assert_eq!(approval, "risk_based");
        assert_eq!(result.status, "success");
        assert_eq!(result.approval, "risk_based");
        assert!(result.content.contains("outside workspace"));
        assert!(!result.side_effects_performed);
    }

    #[test]
    fn file_read_rejects_invalid_line_range() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "alpha\nbeta\n").unwrap();
        let call = tool_call(
            "file_read",
            serde_json::json!({
                "path": "notes.txt",
                "startLine": 3,
                "endLine": 2
            }),
        );

        let result = execute_native_tool(
            &call,
            &NativeToolExecutionContext::new(Some(dir.path().to_path_buf())),
        );

        assert_eq!(result.status, "failed");
        assert!(result.content.contains("invalid line range"));
    }
}
