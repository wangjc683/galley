use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const CODE_RUN_DEFAULT_TIMEOUT_SECONDS: f64 = 30.0;
const CODE_RUN_MAX_TIMEOUT_SECONDS: f64 = 120.0;
const CODE_RUN_OUTPUT_MAX_BYTES: usize = 64 * 1024;
const CODE_RUN_PROGRESS_CHUNK_MAX_BYTES: usize = 8 * 1024;
const FILE_READ_MAX_BYTES: u64 = 256 * 1024;
const FILE_PATCH_MAX_BYTES: u64 = 256 * 1024;
const FILE_WRITE_MAX_BYTES: u64 = 256 * 1024;
const WORKING_CHECKPOINT_MAX_CHARS: usize = 16 * 1024;
const NATIVE_BROWSER_TOOL_SCRIPT: &str = r#"
import importlib, json, os, sys, time, traceback

ATTEMPTED_EXECUTION = False

code_root = os.environ.get("GALLEY_NATIVE_BROWSER_CODE_ROOT")
if code_root:
    sys.path.insert(0, code_root)

def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))

def format_error(error):
    tb = traceback.extract_tb(sys.exc_info()[2])
    if tb:
        frame = tb[-1]
        return f"{type(error).__name__}: {error} @ {os.path.basename(frame.filename)}:{frame.lineno}, {frame.name}"
    return f"{type(error).__name__}: {error}"

def browser_recovery(status):
    if status == "connected_no_tabs":
        return {
            "status": "connected_no_tabs",
            "next_action": "Open any normal webpage in the connected Chrome or Edge browser, or use Settings > Browser Control > Open test page, then retry.",
            "setup_surface": "Settings > Browser Control",
        }
    if status == "not_connected":
        return {
            "status": "not_connected",
            "next_action": "Open the Chrome or Edge browser where the Galley Browser Control extension is installed, then retry. If it still fails, run Settings > Browser Control > Test connection.",
            "setup_surface": "Settings > Browser Control",
        }
    return {
        "status": status,
        "next_action": "Check Settings > Browser Control, then retry.",
        "setup_surface": "Settings > Browser Control",
    }

def main():
    global ATTEMPTED_EXECUTION
    tool = os.environ.get("GALLEY_NATIVE_BROWSER_TOOL", "web_scan")
    request = json.loads(os.environ.get("GALLEY_NATIVE_BROWSER_REQUEST", "{}"))
    wait_seconds = float(os.environ.get("GALLEY_NATIVE_BROWSER_TIMEOUT_SECONDS", "35"))
    from TMWebDriver import TMWebDriver
    driver = TMWebDriver()
    deadline = time.time() + max(0.5, wait_seconds)
    sessions = []
    bridge_status = {}
    while time.time() < deadline:
        sessions = driver.get_all_sessions()
        if sessions:
            break
        try:
            bridge_status = driver.get_status()
            if bridge_status.get("extension_connected"):
                break
        except Exception:
            bridge_status = {}
        time.sleep(0.25)
    if tool not in ("web_scan", "web_execute_js"):
        raise RuntimeError(f"Unsupported native browser tool: {tool}")
    if not sessions:
        if bridge_status.get("extension_connected"):
            emit({
                "ok": False,
                "error": "Browser Control is connected, but no operable webpage is open.",
                "recovery": browser_recovery("connected_no_tabs"),
                "attempted_execution": False,
            })
            return
        emit({
            "ok": False,
            "error": "Browser Control extension is not connected.",
            "recovery": browser_recovery("not_connected"),
            "attempted_execution": False,
        })
        return

    switch_tab_id = request.get("switch_tab_id")
    if switch_tab_id:
        driver.default_session_id = str(switch_tab_id)

    if tool == "web_execute_js":
        script = request.get("script", "")
        if not isinstance(script, str) or not script.strip():
            raise RuntimeError("web_execute_js requires a non-empty script.")
        import simphtml
        importlib.reload(simphtml)
        ATTEMPTED_EXECUTION = True
        result = simphtml.execute_js_rich(
            script,
            driver,
            no_monitor=bool(request.get("no_monitor", False)),
        )
        emit({"ok": True, "result": result})
        return

    tabs = []
    for session in driver.get_all_sessions():
        item = dict(session)
        item.pop("connected_at", None)
        item.pop("type", None)
        url = item.get("url", "") or ""
        item["url"] = url[:50] + ("..." if len(url) > 50 else "")
        tabs.append(item)
    result = {
        "status": "success",
        "metadata": {
            "tabs_count": len(tabs),
            "tabs": tabs,
            "active_tab": driver.default_session_id,
        },
    }
    if not request.get("tabs_only", False):
        import simphtml
        importlib.reload(simphtml)
        result["content"] = simphtml.get_html(
            driver,
            cutlist=True,
            maxchars=int(request.get("maxlen", 35000)),
            text_only=bool(request.get("text_only", False)),
        )
    emit({"ok": True, "result": result})

try:
    main()
except Exception as error:
    emit({
        "ok": False,
        "error": format_error(error),
        "attempted_execution": ATTEMPTED_EXECUTION,
    })
"#;

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
    #[serde(skip)]
    pub progress_chunks: Vec<NativeToolProgressChunk>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeToolProgressChunk {
    pub stream: String,
    pub delta: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NativeToolExecutionContext {
    pub workspace_root: Option<PathBuf>,
    pub scratch_root: Option<PathBuf>,
    pub workspace_kind: Option<String>,
    pub workspace_status: Option<String>,
    pub browser: Option<NativeBrowserExecutionContext>,
    pub browser_unavailable_reason: Option<String>,
    pub resource_files: HashMap<String, String>,
}

impl NativeToolExecutionContext {
    pub fn new(workspace_root: Option<PathBuf>) -> Self {
        Self {
            workspace_root,
            scratch_root: None,
            workspace_kind: None,
            workspace_status: None,
            browser: None,
            browser_unavailable_reason: None,
            resource_files: HashMap::new(),
        }
    }

    pub fn with_browser(
        workspace_root: Option<PathBuf>,
        browser: NativeBrowserExecutionContext,
    ) -> Self {
        Self {
            workspace_root,
            scratch_root: None,
            workspace_kind: None,
            workspace_status: None,
            browser: Some(browser),
            browser_unavailable_reason: None,
            resource_files: HashMap::new(),
        }
    }

    pub fn with_browser_unavailable(
        workspace_root: Option<PathBuf>,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            workspace_root,
            scratch_root: None,
            workspace_kind: None,
            workspace_status: None,
            browser: None,
            browser_unavailable_reason: Some(reason.into()),
            resource_files: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeBrowserExecutionContext {
    pub python: PathBuf,
    pub code_root: PathBuf,
    pub state_root: PathBuf,
    pub wait_timeout_seconds: u64,
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
            "Read a file, memory:// resource, capability:// resource, workspace:// resource, or a line range from an allowed path.",
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
                "required": ["path", "old_content", "new_content"],
                "properties": {
                    "path": { "type": "string" },
                    "old_content": { "type": "string" },
                    "new_content": { "type": "string" },
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
                    "tabs_only": { "type": "boolean" },
                    "switch_tab_id": { "type": "string" },
                    "text_only": { "type": "boolean" },
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
                "required": ["script"],
                "properties": {
                    "script": { "type": "string" },
                    "code": { "type": "string" },
                    "switch_tab_id": { "type": "string" },
                    "tabId": { "type": "string" },
                    "tab_id": { "type": "string" },
                    "no_monitor": { "type": "boolean" },
                    "save_to_file": { "type": "string" }
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
                    "proposal": { "type": "string" },
                    "content": { "type": "string" },
                    "body": { "type": "string" },
                    "scope": { "type": "string" },
                    "layer": { "type": "string" },
                    "triggers": {
                        "oneOf": [
                            { "type": "string" },
                            { "type": "array", "items": { "type": "string" } }
                        ]
                    },
                    "tags": {
                        "oneOf": [
                            { "type": "string" },
                            { "type": "array", "items": { "type": "string" } }
                        ]
                    },
                    "risk": { "type": "string" },
                    "kind": { "type": "string" }
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
    if call.name == "file_patch" && !file_patch_has_preview_args(call) {
        return "none".to_string();
    }
    if call.name == "file_write" && !file_write_has_preview_args(call) {
        return "none".to_string();
    }
    if call.name == "code_run" && !code_run_has_executable_args(call) {
        return "none".to_string();
    }
    if call.name == "web_execute_js"
        && (context.browser.is_none() || !web_execute_js_has_executable_args(call))
    {
        return "none".to_string();
    }
    if call.name == "start_long_term_update" && !start_long_term_update_requires_approval(call) {
        return "none".to_string();
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

fn start_long_term_update_requires_approval(call: &NativeToolCall) -> bool {
    let risk = string_arg_any(call, &["risk", "risk_level", "riskLevel"])
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if matches!(
        risk.as_str(),
        "medium" | "high" | "risk_based" | "durable_write"
    ) {
        return true;
    }
    let kind = string_arg_any(call, &["kind", "type", "update_type", "updateType"])
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default();
    if kind.contains("capability")
        || kind.contains("pack")
        || kind.contains("script")
        || kind.contains("tool")
        || kind.contains("browser")
        || kind.contains("morphling")
    {
        return true;
    }
    [
        "capability",
        "capability_pack",
        "script",
        "tool_schema",
        "permissions",
    ]
    .iter()
    .any(|name| call.arguments_json.get(*name).is_some())
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

pub fn normalize_native_tool_call(
    mut call: NativeToolCall,
    context: &NativeToolExecutionContext,
) -> NativeToolCall {
    match call.name.as_str() {
        "code_run" => {
            call.arguments_json = normalize_code_run_arguments(call.arguments_json, context);
            call.raw_arguments_text = Some(call.arguments_json.to_string());
        }
        "file_patch" => {
            call.arguments_json = normalize_file_patch_arguments(call.arguments_json);
            call.raw_arguments_text = Some(call.arguments_json.to_string());
        }
        "file_write" => {
            call.arguments_json = normalize_file_write_arguments(call.arguments_json, context);
            call.raw_arguments_text = Some(call.arguments_json.to_string());
        }
        "web_scan" => {
            call.arguments_json = normalize_web_scan_arguments(call.arguments_json);
            call.raw_arguments_text = Some(call.arguments_json.to_string());
        }
        "web_execute_js" => {
            call.arguments_json = normalize_web_execute_js_arguments(call.arguments_json);
            call.raw_arguments_text = Some(call.arguments_json.to_string());
        }
        _ => {}
    }
    call
}

pub fn execute_native_tool(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> NativeToolStubResult {
    match call.name.as_str() {
        "code_run" => code_run_result(call, context),
        "file_read" => file_read_result(call, context),
        "file_patch" => file_patch_result(call, context),
        "file_write" => file_write_result(call, context),
        "web_scan" => web_scan_result(call, context),
        "web_execute_js" => web_execute_js_result(call, context),
        "update_working_checkpoint" => update_working_checkpoint_result(call, context),
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
        progress_chunks: Vec::new(),
    }
}

fn update_working_checkpoint_result(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> NativeToolStubResult {
    let approval = approval_for_tool_call(call, context);
    let result = update_working_checkpoint_content(call);
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
        progress_chunks: Vec::new(),
    }
}

fn update_working_checkpoint_content(call: &NativeToolCall) -> std::result::Result<String, String> {
    let content = update_working_checkpoint_content_arg(call).ok_or_else(|| {
        "update_working_checkpoint requires a non-empty string `content` argument.".to_string()
    })?;
    if content.chars().count() > WORKING_CHECKPOINT_MAX_CHARS {
        return Err(format!(
            "update_working_checkpoint refused {} chars because the cap is {} chars.",
            content.chars().count(),
            WORKING_CHECKPOINT_MAX_CHARS
        ));
    }
    let status = update_working_checkpoint_status_arg(call);
    Ok(format!(
        "update_working_checkpoint:\nstatus: {status}\n\n{content}"
    ))
}

fn code_run_result(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> NativeToolStubResult {
    let approval = approval_for_tool_call(call, context);
    let result = code_run_content(call, context);
    let (status, content, side_effects_performed, progress_chunks) = match result {
        Ok(result) => {
            let status = if result.timed_out {
                "timed_out"
            } else if result.exit_code == Some(0) {
                "success"
            } else {
                "failed"
            };
            (
                status,
                format_code_run_content(&result),
                true,
                code_run_progress_chunks(&result),
            )
        }
        Err(message) => ("failed", message, false, Vec::new()),
    };
    NativeToolStubResult {
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        status: status.to_string(),
        content,
        side_effects_performed,
        requires_user_response: false,
        approval,
        progress_chunks,
    }
}

#[derive(Debug)]
struct CodeRunExecutionResult {
    command: String,
    cwd: PathBuf,
    timeout_seconds: f64,
    duration_ms: u128,
    exit_code: Option<i32>,
    timed_out: bool,
    stdout: String,
    stderr: String,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

fn code_run_content(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> std::result::Result<CodeRunExecutionResult, String> {
    let command = code_run_command_arg(call)
        .ok_or_else(|| "code_run requires a non-empty string `command` argument.".to_string())?;
    if let Some(policy_error) = code_run_script_policy_error(call, &command) {
        return Err(policy_error);
    }
    if let Some(preview_error) = code_run_preview_error_arg(call) {
        return Err(format!(
            "code_run cannot run because the approval preview was invalid: {preview_error}"
        ));
    }
    let preview_cwd = code_run_resolved_cwd_arg(call).ok_or_else(|| {
        "code_run requires a generated `resolved_cwd` before approval.".to_string()
    })?;
    let cwd = resolve_code_run_cwd(call, context)?;
    if cwd.to_string_lossy().as_ref() != preview_cwd {
        return Err(format!(
            "code_run refused to run because cwd changed after approval preview: expected {preview_cwd}, got {}.",
            cwd.display()
        ));
    }
    let timeout_seconds = code_run_timeout_seconds_arg(call)?;
    let timeout = Duration::from_secs_f64(timeout_seconds);
    run_shell_command(command, cwd, timeout_seconds, timeout)
}

fn run_shell_command(
    command: String,
    cwd: PathBuf,
    timeout_seconds: f64,
    timeout: Duration,
) -> std::result::Result<CodeRunExecutionResult, String> {
    let mut child = shell_command(&command)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            format!(
                "code_run could not spawn command in {}: {err}",
                cwd.display()
            )
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "code_run could not capture stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "code_run could not capture stderr.".to_string())?;
    let stdout_handle = thread::spawn(move || read_capped_output(stdout));
    let stderr_handle = thread::spawn(move || read_capped_output(stderr));

    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() >= timeout => {
                timed_out = true;
                let _ = child.kill();
                break child.wait().map_err(|err| {
                    format!("code_run timed out but could not wait for killed process: {err}")
                })?;
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(err) => return Err(format!("code_run could not poll command status: {err}")),
        }
    };
    let duration_ms = start.elapsed().as_millis();
    let stdout = join_capped_output(stdout_handle, "stdout")?;
    let stderr = join_capped_output(stderr_handle, "stderr")?;

    Ok(CodeRunExecutionResult {
        command,
        cwd,
        timeout_seconds,
        duration_ms,
        exit_code: status.code(),
        timed_out,
        stdout: String::from_utf8_lossy(&stdout.bytes).to_string(),
        stderr: String::from_utf8_lossy(&stderr.bytes).to_string(),
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
    })
}

fn shell_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        let mut shell = Command::new("cmd");
        shell.args(["/C", command]);
        shell
    }
    #[cfg(not(windows))]
    {
        let mut shell = Command::new("sh");
        shell.args(["-c", command]);
        shell
    }
}

#[derive(Debug)]
struct CappedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

fn read_capped_output<R: Read>(mut reader: R) -> std::io::Result<CappedOutput> {
    let mut stored = Vec::new();
    let mut total = 0_usize;
    let mut buffer = [0_u8; 8192];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read);
        if stored.len() < CODE_RUN_OUTPUT_MAX_BYTES {
            let remaining = CODE_RUN_OUTPUT_MAX_BYTES - stored.len();
            let keep = remaining.min(read);
            stored.extend_from_slice(&buffer[..keep]);
        }
    }
    Ok(CappedOutput {
        bytes: stored,
        truncated: total > CODE_RUN_OUTPUT_MAX_BYTES,
    })
}

fn join_capped_output(
    handle: thread::JoinHandle<std::io::Result<CappedOutput>>,
    stream_name: &str,
) -> std::result::Result<CappedOutput, String> {
    handle
        .join()
        .map_err(|_| format!("code_run {stream_name} reader panicked."))?
        .map_err(|err| format!("code_run could not read {stream_name}: {err}"))
}

fn format_code_run_content(result: &CodeRunExecutionResult) -> String {
    let exit_code = result
        .exit_code
        .map(|code| code.to_string())
        .unwrap_or_else(|| "none".to_string());
    format!(
        "code_run: {}\n\
         cwd: {}\n\
         timeout_seconds: {}\n\
         duration_ms: {}\n\
         exit_code: {}\n\
         timed_out: {}\n\
         stdout_truncated: {}\n\
         stderr_truncated: {}\n\
         \n\
         stdout:\n{}\n\
         stderr:\n{}",
        result.command,
        result.cwd.display(),
        format_seconds(result.timeout_seconds),
        result.duration_ms,
        exit_code,
        result.timed_out,
        result.stdout_truncated,
        result.stderr_truncated,
        result.stdout,
        result.stderr
    )
}

fn code_run_progress_chunks(result: &CodeRunExecutionResult) -> Vec<NativeToolProgressChunk> {
    let mut chunks = Vec::new();
    push_code_run_progress_chunks(
        &mut chunks,
        "stdout",
        &result.stdout,
        result.stdout_truncated,
    );
    push_code_run_progress_chunks(
        &mut chunks,
        "stderr",
        &result.stderr,
        result.stderr_truncated,
    );
    chunks
}

fn push_code_run_progress_chunks(
    chunks: &mut Vec<NativeToolProgressChunk>,
    stream: &str,
    output: &str,
    output_truncated: bool,
) {
    if output.is_empty() {
        return;
    }
    let mut remaining = output;
    while !remaining.is_empty() {
        let (delta, rest) = split_at_byte_cap(remaining, CODE_RUN_PROGRESS_CHUNK_MAX_BYTES);
        let is_last = rest.is_empty();
        chunks.push(NativeToolProgressChunk {
            stream: stream.to_string(),
            delta: delta.to_string(),
            truncated: is_last && output_truncated,
        });
        remaining = rest;
    }
}

fn split_at_byte_cap(value: &str, byte_cap: usize) -> (&str, &str) {
    if value.len() <= byte_cap {
        return (value, "");
    }
    let mut end = byte_cap;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    value.split_at(end)
}

fn format_seconds(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as u64)
    } else {
        format!("{value:.3}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
}

fn file_read_requires_approval(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> bool {
    if file_read_resource_uri_arg(call).is_some() {
        return false;
    }
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
        progress_chunks: Vec::new(),
    }
}

fn file_read_content(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> std::result::Result<String, String> {
    if let Some(uri) = file_read_resource_uri_arg(call) {
        return file_read_resource_content(&uri, call, context);
    }
    let path = file_read_path_arg(call)
        .ok_or_else(|| "file_read requires a non-empty string `path` argument.".to_string())?;
    let resolved = resolve_existing_file_path(&path, context, "file_read")?;
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
    path_arg(call)
}

fn file_read_resource_uri_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["path"])
        .map(|path| normalize_resource_uri(&path))
        .filter(|path| is_native_resource_uri(path))
}

fn normalize_resource_uri(path: &str) -> String {
    let mut normalized = path.trim().replace('\\', "/");
    let min_len = if normalized.starts_with("capability://") {
        "capability://".len()
    } else if normalized.starts_with("workspace://") {
        "workspace://".len()
    } else {
        "memory://".len()
    };
    while normalized.ends_with('/') && normalized.len() > min_len {
        normalized.pop();
    }
    normalized
}

fn is_native_resource_uri(path: &str) -> bool {
    path.starts_with("memory://")
        || path.starts_with("capability://")
        || path.starts_with("workspace://")
}

fn file_read_resource_content(
    uri: &str,
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> std::result::Result<String, String> {
    let Some(body) = context.resource_files.get(uri) else {
        let scheme = uri.split("://").next().unwrap_or("native");
        let prefix = format!("{scheme}://");
        let mut available = context
            .resource_files
            .keys()
            .filter(|key| key.starts_with(&prefix))
            .take(20)
            .cloned()
            .collect::<Vec<_>>();
        available.sort();
        let available = if available.is_empty() {
            format!("No {prefix} resources are available in this session.")
        } else {
            format!("Available {prefix} resources:\n{}", available.join("\n"))
        };
        return Err(format!(
            "file_read native resource not found: {uri}\n\n{available}"
        ));
    };
    let (start_line, end_line) = file_read_line_range(call)?;
    let (body, truncated) = virtual_text_with_cap(body);
    let (selected, rendered_range) = select_line_range(&body, start_line, end_line)?;
    Ok(format_file_read_resource_content(
        uri,
        rendered_range.as_deref(),
        truncated,
        &selected,
    ))
}

fn file_patch_result(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> NativeToolStubResult {
    let approval = approval_for_tool_call(call, context);
    let result = file_patch_content(call, context);
    let (status, content, side_effects_performed) = match result {
        Ok((content, side_effects_performed)) => (
            if side_effects_performed {
                "success"
            } else {
                "success_no_change"
            },
            content,
            side_effects_performed,
        ),
        Err(message) => ("failed", message, false),
    };
    NativeToolStubResult {
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        status: status.to_string(),
        content,
        side_effects_performed,
        requires_user_response: false,
        approval,
        progress_chunks: Vec::new(),
    }
}

fn file_patch_content(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> std::result::Result<(String, bool), String> {
    let path = path_arg(call)
        .ok_or_else(|| "file_patch requires a non-empty string `path` argument.".to_string())?;
    let old_content = file_patch_old_content_arg(call).ok_or_else(|| {
        "file_patch requires a non-empty string `old_content` argument.".to_string()
    })?;
    let new_content = file_patch_new_content_arg(call)
        .ok_or_else(|| "file_patch requires a string `new_content` argument.".to_string())?;
    let resolved = resolve_existing_file_path(&path, context, "file_patch")?;
    let metadata = std::fs::metadata(&resolved)
        .map_err(|err| format!("file_patch could not stat {}: {err}", resolved.display()))?;
    if !metadata.is_file() {
        return Err(format!(
            "file_patch expected a regular file, got {}.",
            resolved.display()
        ));
    }
    if metadata.len() > FILE_PATCH_MAX_BYTES {
        return Err(format!(
            "file_patch refused {} because it is larger than {} bytes.",
            resolved.display(),
            FILE_PATCH_MAX_BYTES
        ));
    }
    let full_text = std::fs::read_to_string(&resolved).map_err(|err| {
        format!(
            "file_patch could not read {} as UTF-8 text: {err}",
            resolved.display()
        )
    })?;
    let count = full_text.matches(&old_content).count();
    if count == 0 {
        return Err("file_patch found no matching old_content block; read the file again and provide an exact, smaller patch.".to_string());
    }
    if count > 1 {
        return Err(format!(
            "file_patch found {count} matching old_content blocks; provide a longer, unique block with surrounding context."
        ));
    }
    if old_content == new_content {
        return Ok((
            format!(
                "file_patch: {}\nstatus: no_change\nmatched: 1\nold_content and new_content are identical; no file change was written.",
                resolved.display()
            ),
            false,
        ));
    }
    let updated_text = full_text.replacen(&old_content, &new_content, 1);
    std::fs::write(&resolved, updated_text.as_bytes())
        .map_err(|err| format!("file_patch could not write {}: {err}", resolved.display()))?;
    Ok((
        format!(
            "file_patch: {}\nstatus: success\nmatched: 1\nold_bytes: {}\nnew_bytes: {}",
            resolved.display(),
            old_content.len(),
            new_content.len()
        ),
        true,
    ))
}

fn file_write_result(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> NativeToolStubResult {
    let approval = approval_for_tool_call(call, context);
    let result = file_write_content(call, context);
    let (status, content, side_effects_performed) = match result {
        Ok((content, side_effects_performed)) => (
            if side_effects_performed {
                "success"
            } else {
                "success_no_change"
            },
            content,
            side_effects_performed,
        ),
        Err(message) => ("failed", message, false),
    };
    NativeToolStubResult {
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        status: status.to_string(),
        content,
        side_effects_performed,
        requires_user_response: false,
        approval,
        progress_chunks: Vec::new(),
    }
}

fn file_write_content(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> std::result::Result<(String, bool), String> {
    let path = path_arg(call)
        .ok_or_else(|| "file_write requires a non-empty string `path` argument.".to_string())?;
    let content = file_write_content_arg(call)
        .ok_or_else(|| "file_write requires a string `content` argument.".to_string())?;
    if content.len() as u64 > FILE_WRITE_MAX_BYTES {
        return Err(format!(
            "file_write refused {} bytes because the preview/write cap is {} bytes.",
            content.len(),
            FILE_WRITE_MAX_BYTES
        ));
    }
    let mode = file_write_mode_arg(call).ok_or_else(|| {
        "file_write supports only `mode: \"create\"` or `mode: \"overwrite\"` in Galley Native Slice 4B5.".to_string()
    })?;
    if let Some(preview_error) = file_write_preview_error_arg(call) {
        return Err(format!(
            "file_write cannot run because the approval preview was invalid: {preview_error}"
        ));
    }
    let preview_existing = file_write_existing_content_arg(call).ok_or_else(|| {
        "file_write requires a generated `existing_content` preview before approval.".to_string()
    })?;
    let resolved = resolve_writable_file_path(&path, context, "file_write")?;

    match mode.as_str() {
        "create" => {
            if !preview_existing.is_empty() {
                return Err(
                    "file_write create mode requires an empty `existing_content` preview."
                        .to_string(),
                );
            }
            if path_entry_exists(&resolved, "file_write")? {
                return Err(format!(
                    "file_write create refused {} because it already exists; use mode overwrite with a fresh preview.",
                    resolved.display()
                ));
            }
            std::fs::write(&resolved, content.as_bytes()).map_err(|err| {
                format!("file_write could not create {}: {err}", resolved.display())
            })?;
            Ok((
                format!(
                    "file_write: {}\nstatus: success\nmode: create\nnew_bytes: {}",
                    resolved.display(),
                    content.len()
                ),
                true,
            ))
        }
        "overwrite" => {
            let metadata = std::fs::metadata(&resolved).map_err(|err| {
                format!(
                    "file_write overwrite could not stat existing file {}: {err}",
                    resolved.display()
                )
            })?;
            if !metadata.is_file() {
                return Err(format!(
                    "file_write overwrite expected a regular file, got {}.",
                    resolved.display()
                ));
            }
            if metadata.len() > FILE_WRITE_MAX_BYTES {
                return Err(format!(
                    "file_write overwrite refused {} because it is larger than {} bytes.",
                    resolved.display(),
                    FILE_WRITE_MAX_BYTES
                ));
            }
            let current = std::fs::read_to_string(&resolved).map_err(|err| {
                format!(
                    "file_write overwrite could not read {} as UTF-8 text: {err}",
                    resolved.display()
                )
            })?;
            if current != preview_existing {
                return Err(format!(
                    "file_write refused {} because the file changed after the approval preview; read it again and retry.",
                    resolved.display()
                ));
            }
            if current == content {
                return Ok((
                    format!(
                        "file_write: {}\nstatus: no_change\nmode: overwrite\nexisting content already matches proposed content.",
                        resolved.display()
                    ),
                    false,
                ));
            }
            std::fs::write(&resolved, content.as_bytes()).map_err(|err| {
                format!(
                    "file_write overwrite could not write {}: {err}",
                    resolved.display()
                )
            })?;
            Ok((
                format!(
                    "file_write: {}\nstatus: success\nmode: overwrite\nold_bytes: {}\nnew_bytes: {}",
                    resolved.display(),
                    current.len(),
                    content.len()
                ),
                true,
            ))
        }
        _ => Err("file_write reached an unsupported mode after validation.".to_string()),
    }
}

fn web_scan_result(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> NativeToolStubResult {
    let approval = approval_for_tool_call(call, context);
    let result = web_scan_content(call, context);
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
        progress_chunks: Vec::new(),
    }
}

fn web_scan_content(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> std::result::Result<String, String> {
    let Some(browser) = context.browser.as_ref() else {
        return Err(format_browser_host_unavailable_content(
            "web_scan",
            context
                .browser_unavailable_reason
                .as_deref()
                .unwrap_or("native runtime host did not provide a browser bridge"),
        ));
    };
    let request = serde_json::json!({
        "tabs_only": web_scan_bool_arg(call, "tabs_only", false),
        "switch_tab_id": web_scan_switch_tab_id_arg(call),
        "text_only": web_scan_bool_arg(call, "text_only", false),
        "maxlen": 35_000
    });
    run_browser_python_tool(browser, "web_scan", request)
        .map_err(|error| error.format_content("web_scan"))
}

fn web_execute_js_result(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> NativeToolStubResult {
    let approval = approval_for_tool_call(call, context);
    let result = web_execute_js_content(call, context);
    let (status, content, side_effects_performed) = match result {
        Ok(content) => ("success", content, true),
        Err(error) => ("failed", error.message, error.attempted_execution),
    };
    NativeToolStubResult {
        tool_call_id: call.id.clone(),
        tool_name: call.name.clone(),
        status: status.to_string(),
        content,
        side_effects_performed,
        requires_user_response: false,
        approval,
        progress_chunks: Vec::new(),
    }
}

#[derive(Debug)]
struct BrowserToolExecutionError {
    message: String,
    attempted_execution: bool,
}

impl BrowserToolExecutionError {
    fn preflight(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            attempted_execution: false,
        }
    }

    fn attempted(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            attempted_execution: true,
        }
    }
}

fn web_execute_js_content(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> std::result::Result<String, BrowserToolExecutionError> {
    let Some(browser) = context.browser.as_ref() else {
        return Err(BrowserToolExecutionError::preflight(
            format_browser_host_unavailable_content(
                "web_execute_js",
                context
                    .browser_unavailable_reason
                    .as_deref()
                    .unwrap_or("native runtime host did not provide a browser bridge"),
            ),
        ));
    };
    let script = web_execute_js_script_arg(call).ok_or_else(|| {
        BrowserToolExecutionError::preflight(
            "web_execute_js requires a non-empty string `script` argument.",
        )
    })?;
    if web_execute_js_save_to_file_arg(call).is_some() {
        return Err(BrowserToolExecutionError::preflight(
            "web_execute_js `save_to_file` is not supported in Galley Native yet. Use file_write or file_patch so local file writes stay previewed and approval-gated.",
        ));
    }
    let request = serde_json::json!({
        "script": script,
        "switch_tab_id": web_execute_js_switch_tab_id_arg(call),
        "no_monitor": web_execute_js_no_monitor_arg(call),
    });
    let result =
        run_browser_python_tool_result(browser, "web_execute_js", request).map_err(|error| {
            BrowserToolExecutionError {
                message: error.format_content("web_execute_js"),
                attempted_execution: error.attempted_execution,
            }
        })?;
    let content = format_web_execute_js_content(&result);
    if matches!(
        result.get("status").and_then(Value::as_str),
        Some("error" | "failed")
    ) {
        return Err(BrowserToolExecutionError::attempted(content));
    }
    Ok(content)
}

fn format_browser_host_unavailable_content(tool_name: &str, reason: &str) -> String {
    let recovery = serde_json::json!({
        "status": "host_unavailable",
        "next_action": "Open this session in the Galley desktop app and check Settings > Browser Control, then retry.",
        "setup_surface": "Settings > Browser Control"
    });
    format!(
        "{tool_name} failed:\nBrowser Control is unavailable: {reason}\n\nrecovery:\n{}",
        serde_json::to_string_pretty(&recovery).unwrap_or_else(|_| recovery.to_string())
    )
}

fn run_browser_python_tool(
    browser: &NativeBrowserExecutionContext,
    tool_name: &str,
    request: Value,
) -> std::result::Result<String, BrowserToolHelperError> {
    let result = run_browser_python_tool_result(browser, tool_name, request)?;
    Ok(match tool_name {
        "web_execute_js" => format_web_execute_js_content(&result),
        _ => format_web_scan_content(&result),
    })
}

fn run_browser_python_tool_result(
    browser: &NativeBrowserExecutionContext,
    tool_name: &str,
    request: Value,
) -> std::result::Result<Value, BrowserToolHelperError> {
    let mut child = Command::new(&browser.python)
        .arg("-c")
        .arg(NATIVE_BROWSER_TOOL_SCRIPT)
        .current_dir(&browser.code_root)
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .env("GALLEY_NATIVE_BROWSER_CODE_ROOT", &browser.code_root)
        .env("GALLEY_GA_STATE_ROOT", &browser.state_root)
        .env("GALLEY_NATIVE_BROWSER_TOOL", tool_name)
        .env("GALLEY_NATIVE_BROWSER_REQUEST", request.to_string())
        .env(
            "GALLEY_NATIVE_BROWSER_TIMEOUT_SECONDS",
            browser.wait_timeout_seconds.to_string(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            BrowserToolHelperError::message(format!(
                "{tool_name} could not start Browser Control helper {}: {err}",
                browser.python.display()
            ))
        })?;

    let stdout = child.stdout.take().ok_or_else(|| {
        BrowserToolHelperError::message(format!("{tool_name} could not capture helper stdout."))
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        BrowserToolHelperError::message(format!("{tool_name} could not capture helper stderr."))
    })?;
    let stdout_handle = thread::spawn(move || read_capped_output(stdout));
    let stderr_handle = thread::spawn(move || read_capped_output(stderr));
    let timeout = Duration::from_secs(browser.wait_timeout_seconds.saturating_add(3));
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(BrowserToolHelperError::message(format!(
                    "{tool_name} timed out while waiting for Browser Control."
                )));
            }
            Ok(None) => thread::sleep(Duration::from_millis(25)),
            Err(err) => {
                return Err(BrowserToolHelperError::message(format!(
                    "{tool_name} could not poll helper status: {err}"
                )));
            }
        }
    };
    let stdout = join_capped_output(stdout_handle, "browser stdout")?;
    let stderr = join_capped_output(stderr_handle, "browser stderr")?;
    let stdout_text = String::from_utf8_lossy(&stdout.bytes);
    let stderr_text = String::from_utf8_lossy(&stderr.bytes);
    let parsed = stdout_text
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str::<Value>(line).ok())
        .ok_or_else(|| {
            BrowserToolHelperError::message(format!(
                "{tool_name} helper returned no JSON result. stderr: {}",
                stderr_text.trim().chars().take(240).collect::<String>()
            ))
        })?;
    if !status.success() {
        return Err(BrowserToolHelperError::message(format!(
            "{tool_name} helper exited with {status}. stderr: {}",
            stderr_text.trim().chars().take(240).collect::<String>()
        )));
    }
    if parsed.get("ok").and_then(Value::as_bool) != Some(true) {
        let message = parsed
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Browser Control helper failed");
        return Err(BrowserToolHelperError {
            message: message.to_string(),
            recovery: parsed.get("recovery").cloned(),
            attempted_execution: parsed
                .get("attempted_execution")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        });
    }
    Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
}

#[derive(Debug)]
struct BrowserToolHelperError {
    message: String,
    recovery: Option<Value>,
    attempted_execution: bool,
}

impl BrowserToolHelperError {
    fn message(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            recovery: None,
            attempted_execution: false,
        }
    }

    fn format_content(&self, tool_name: &str) -> String {
        let mut output = format!("{tool_name} failed:\n{}", self.message);
        if let Some(recovery) = &self.recovery {
            output.push_str("\n\nrecovery:\n");
            output.push_str(
                &serde_json::to_string_pretty(recovery).unwrap_or_else(|_| recovery.to_string()),
            );
        }
        output
    }
}

impl From<String> for BrowserToolHelperError {
    fn from(message: String) -> Self {
        Self::message(message)
    }
}

fn format_web_scan_content(result: &Value) -> String {
    let mut output = String::from("web_scan:\n");
    output.push_str(&serde_json::to_string_pretty(result).unwrap_or_else(|_| result.to_string()));
    output
}

fn format_web_execute_js_content(result: &Value) -> String {
    let mut output = String::from("web_execute_js:\n");
    output.push_str(&serde_json::to_string_pretty(result).unwrap_or_else(|_| result.to_string()));
    output
}

fn path_arg(call: &NativeToolCall) -> Option<PathBuf> {
    string_arg_any(call, &["path", "file_path", "filePath"])
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn code_run_has_executable_args(call: &NativeToolCall) -> bool {
    code_run_command_arg(call).is_some()
        && code_run_resolved_cwd_arg(call).is_some()
        && code_run_preview_error_arg(call).is_none()
        && code_run_timeout_seconds_arg(call).is_ok()
}

fn code_run_command_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["command", "cmd", "code"])
        .map(|command| command.trim().to_string())
        .filter(|command| !command.is_empty())
}

fn code_run_script_policy_error(call: &NativeToolCall, command: &str) -> Option<String> {
    if command.contains("capability://")
        || string_arg_any(
            call,
            &[
                "script_uri",
                "scriptUri",
                "capability_script",
                "capabilityScript",
            ],
        )
        .is_some()
    {
        return Some(
            "code_run refused capability pack script execution. Slice 5 exposes capability:// resources as read-only; executing pack scripts requires a later materialize-by-hash approval path."
                .to_string(),
        );
    }
    None
}

fn code_run_cwd_arg(call: &NativeToolCall) -> Option<PathBuf> {
    string_arg_any(call, &["cwd", "working_directory", "workingDirectory"])
        .map(|cwd| cwd.trim().to_string())
        .filter(|cwd| !cwd.is_empty())
        .map(PathBuf::from)
}

fn code_run_resolved_cwd_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["resolved_cwd", "resolvedCwd"])
        .map(|cwd| cwd.trim().to_string())
        .filter(|cwd| !cwd.is_empty())
}

fn code_run_preview_error_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["preview_error", "previewError"])
}

fn code_run_timeout_seconds_arg(call: &NativeToolCall) -> std::result::Result<f64, String> {
    code_run_timeout_seconds_value(&call.arguments_json)
}

fn file_patch_has_preview_args(call: &NativeToolCall) -> bool {
    path_arg(call).is_some()
        && file_patch_old_content_arg(call)
            .map(|value| !value.is_empty())
            .unwrap_or(false)
        && file_patch_new_content_arg(call).is_some()
}

fn file_patch_old_content_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["old_content", "oldContent"])
}

fn file_patch_new_content_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["new_content", "newContent"])
}

fn file_write_has_preview_args(call: &NativeToolCall) -> bool {
    path_arg(call).is_some()
        && file_write_content_arg(call)
            .map(|content| content.len() as u64 <= FILE_WRITE_MAX_BYTES)
            .unwrap_or(false)
        && file_write_mode_arg(call).is_some()
        && file_write_existing_content_arg(call).is_some()
        && file_write_preview_error_arg(call).is_none()
}

fn file_write_content_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["content"])
}

fn file_write_existing_content_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["existing_content", "existingContent"])
}

fn file_write_preview_error_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["preview_error", "previewError"])
}

fn file_write_mode_arg(call: &NativeToolCall) -> Option<String> {
    file_write_mode_value(&call.arguments_json)
}

fn web_scan_bool_arg(call: &NativeToolCall, name: &str, default: bool) -> bool {
    call.arguments_json
        .get(name)
        .and_then(Value::as_bool)
        .unwrap_or(default)
}

fn web_scan_switch_tab_id_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["switch_tab_id", "switchTabId", "tabId", "tab_id"])
        .map(|tab_id| tab_id.trim().to_string())
        .filter(|tab_id| !tab_id.is_empty())
}

fn web_execute_js_has_executable_args(call: &NativeToolCall) -> bool {
    web_execute_js_script_arg(call).is_some() && web_execute_js_save_to_file_arg(call).is_none()
}

fn web_execute_js_script_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["script", "code"])
        .map(|script| script.trim().to_string())
        .filter(|script| !script.is_empty())
}

fn web_execute_js_switch_tab_id_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["switch_tab_id", "switchTabId", "tabId", "tab_id"])
        .map(|tab_id| tab_id.trim().to_string())
        .filter(|tab_id| !tab_id.is_empty())
}

fn web_execute_js_no_monitor_arg(call: &NativeToolCall) -> bool {
    call.arguments_json
        .get("no_monitor")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn web_execute_js_save_to_file_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["save_to_file", "saveToFile"])
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
}

fn update_working_checkpoint_content_arg(call: &NativeToolCall) -> Option<String> {
    string_arg_any(call, &["content", "checkpoint", "summary"])
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
}

fn update_working_checkpoint_status_arg(call: &NativeToolCall) -> String {
    string_arg_any(call, &["status", "state"])
        .map(|status| status.trim().to_ascii_lowercase())
        .filter(|status| !status.is_empty())
        .unwrap_or_else(|| "active".to_string())
}

fn string_arg_any(call: &NativeToolCall, names: &[&str]) -> Option<String> {
    string_value_any(&call.arguments_json, names)
}

fn string_value_any(value: &Value, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_str).map(str::to_string))
}

fn normalize_file_patch_arguments(value: Value) -> Value {
    let Some(object) = value.as_object() else {
        return value;
    };
    let mut object = object.clone();
    copy_string_alias(&mut object, "path", &["file_path", "filePath"]);
    copy_string_alias(&mut object, "old_content", &["oldContent"]);
    copy_string_alias(&mut object, "new_content", &["newContent"]);
    Value::Object(object)
}

fn normalize_code_run_arguments(value: Value, context: &NativeToolExecutionContext) -> Value {
    let Some(object) = value.as_object() else {
        return value;
    };
    let mut object = object.clone();
    copy_string_alias(&mut object, "command", &["cmd", "code"]);
    copy_string_alias(
        &mut object,
        "cwd",
        &["working_directory", "workingDirectory"],
    );
    copy_number_alias(&mut object, "timeoutSeconds", &["timeout_seconds"]);
    if object.get("timeoutSeconds").is_none() {
        object.insert(
            "timeoutSeconds".to_string(),
            serde_json::Number::from_f64(CODE_RUN_DEFAULT_TIMEOUT_SECONDS)
                .map(Value::Number)
                .unwrap_or(Value::Null),
        );
    }
    object.remove("resolved_cwd");
    object.remove("resolvedCwd");
    object.remove("preview_error");
    object.remove("previewError");

    let normalized = Value::Object(object.clone());
    match preview_code_run(&normalized, context) {
        Ok(resolved_cwd) => {
            object.insert("resolved_cwd".to_string(), Value::String(resolved_cwd));
        }
        Err(message) => {
            object.insert("preview_error".to_string(), Value::String(message));
        }
    }

    Value::Object(object)
}

fn preview_code_run(
    value: &Value,
    context: &NativeToolExecutionContext,
) -> std::result::Result<String, String> {
    string_value_any(value, &["command", "cmd", "code"])
        .map(|command| command.trim().to_string())
        .filter(|command| !command.is_empty())
        .ok_or_else(|| "code_run preview requires a non-empty string `command`.".to_string())?;
    code_run_timeout_seconds_value(value)?;
    let cwd = resolve_code_run_cwd_from_value(value, context)?;
    Ok(cwd.to_string_lossy().to_string())
}

fn normalize_file_write_arguments(value: Value, context: &NativeToolExecutionContext) -> Value {
    let Some(object) = value.as_object() else {
        return value;
    };
    let mut object = object.clone();
    copy_string_alias(&mut object, "path", &["file_path", "filePath"]);

    if object.get("mode").and_then(Value::as_str).is_none() {
        let mode = match object.get("overwrite").and_then(Value::as_bool) {
            Some(true) => "overwrite",
            Some(false) | None => "create",
        };
        object.insert("mode".to_string(), Value::String(mode.to_string()));
    } else if let Some(mode) = object
        .get("mode")
        .and_then(Value::as_str)
        .map(normalize_file_write_mode_text)
    {
        object.insert("mode".to_string(), Value::String(mode));
    }

    object.remove("existing_content");
    object.remove("existingContent");
    object.remove("preview_error");
    object.remove("previewError");

    let normalized = Value::Object(object.clone());
    let preview = preview_file_write_existing_content(&normalized, context);
    match preview {
        Ok(existing_content) => {
            object.insert(
                "existing_content".to_string(),
                Value::String(existing_content),
            );
        }
        Err(message) => {
            object.insert("preview_error".to_string(), Value::String(message));
        }
    }

    Value::Object(object)
}

fn normalize_web_scan_arguments(value: Value) -> Value {
    let Some(object) = value.as_object() else {
        return value;
    };
    let mut object = object.clone();
    copy_bool_alias(&mut object, "tabs_only", &["tabsOnly"]);
    copy_bool_alias(&mut object, "text_only", &["textOnly"]);
    copy_string_alias(
        &mut object,
        "switch_tab_id",
        &["switchTabId", "tabId", "tab_id"],
    );
    Value::Object(object)
}

fn normalize_web_execute_js_arguments(value: Value) -> Value {
    let Some(object) = value.as_object() else {
        return value;
    };
    let mut object = object.clone();
    copy_string_alias(&mut object, "script", &["code"]);
    copy_string_alias(
        &mut object,
        "switch_tab_id",
        &["switchTabId", "tabId", "tab_id"],
    );
    copy_bool_alias(&mut object, "no_monitor", &["noMonitor"]);
    copy_string_alias(&mut object, "save_to_file", &["saveToFile"]);
    Value::Object(object)
}

fn preview_file_write_existing_content(
    value: &Value,
    context: &NativeToolExecutionContext,
) -> std::result::Result<String, String> {
    let path = string_value_any(value, &["path", "file_path", "filePath"])
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "file_write preview requires a non-empty string `path`.".to_string())?;
    let content = string_value_any(value, &["content"])
        .ok_or_else(|| "file_write preview requires a string `content`.".to_string())?;
    if content.len() as u64 > FILE_WRITE_MAX_BYTES {
        return Err(format!(
            "file_write preview refused {} bytes because the cap is {} bytes.",
            content.len(),
            FILE_WRITE_MAX_BYTES
        ));
    }
    let mode = file_write_mode_value(value)
        .ok_or_else(|| "file_write preview supports only mode create or overwrite.".to_string())?;
    let resolved = resolve_writable_file_path(&path, context, "file_write")?;
    match mode.as_str() {
        "create" => {
            if path_entry_exists(&resolved, "file_write")? {
                Err(format!(
                    "file_write create preview refused {} because it already exists.",
                    resolved.display()
                ))
            } else {
                Ok(String::new())
            }
        }
        "overwrite" => read_file_write_existing_text(&resolved),
        _ => Err("file_write preview reached an unsupported mode.".to_string()),
    }
}

fn read_file_write_existing_text(path: &Path) -> std::result::Result<String, String> {
    let metadata = std::fs::metadata(path).map_err(|err| {
        format!(
            "file_write overwrite preview could not stat {}: {err}",
            path.display()
        )
    })?;
    if !metadata.is_file() {
        return Err(format!(
            "file_write overwrite preview expected a regular file, got {}.",
            path.display()
        ));
    }
    if metadata.len() > FILE_WRITE_MAX_BYTES {
        return Err(format!(
            "file_write overwrite preview refused {} because it is larger than {} bytes.",
            path.display(),
            FILE_WRITE_MAX_BYTES
        ));
    }
    std::fs::read_to_string(path).map_err(|err| {
        format!(
            "file_write overwrite preview could not read {} as UTF-8 text: {err}",
            path.display()
        )
    })
}

fn file_write_mode_value(value: &Value) -> Option<String> {
    value
        .get("mode")
        .and_then(Value::as_str)
        .map(normalize_file_write_mode_text)
        .filter(|mode| matches!(mode.as_str(), "create" | "overwrite"))
}

fn normalize_file_write_mode_text(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn code_run_timeout_seconds_value(value: &Value) -> std::result::Result<f64, String> {
    let Some(raw) = value
        .get("timeoutSeconds")
        .or_else(|| value.get("timeout_seconds"))
    else {
        return Ok(CODE_RUN_DEFAULT_TIMEOUT_SECONDS);
    };
    let Some(seconds) = raw.as_f64() else {
        return Err("code_run `timeoutSeconds` must be a number.".to_string());
    };
    if !seconds.is_finite() || seconds <= 0.0 {
        return Err("code_run `timeoutSeconds` must be greater than 0.".to_string());
    }
    if seconds > CODE_RUN_MAX_TIMEOUT_SECONDS {
        return Err(format!(
            "code_run `timeoutSeconds` must be <= {}.",
            format_seconds(CODE_RUN_MAX_TIMEOUT_SECONDS)
        ));
    }
    Ok(seconds)
}

fn copy_string_alias(
    object: &mut serde_json::Map<String, Value>,
    canonical: &str,
    aliases: &[&str],
) {
    if object.get(canonical).and_then(Value::as_str).is_some() {
        return;
    }
    if let Some(value) = aliases
        .iter()
        .find_map(|alias| object.get(*alias).and_then(Value::as_str))
    {
        object.insert(canonical.to_string(), Value::String(value.to_string()));
    }
}

fn copy_number_alias(
    object: &mut serde_json::Map<String, Value>,
    canonical: &str,
    aliases: &[&str],
) {
    if object.get(canonical).and_then(Value::as_f64).is_some() {
        return;
    }
    if let Some(value) = aliases
        .iter()
        .find_map(|alias| object.get(*alias).and_then(Value::as_f64))
        .and_then(serde_json::Number::from_f64)
    {
        object.insert(canonical.to_string(), Value::Number(value));
    }
}

fn copy_bool_alias(object: &mut serde_json::Map<String, Value>, canonical: &str, aliases: &[&str]) {
    if object.get(canonical).and_then(Value::as_bool).is_some() {
        return;
    }
    if let Some(value) = aliases
        .iter()
        .find_map(|alias| object.get(*alias).and_then(Value::as_bool))
    {
        object.insert(canonical.to_string(), Value::Bool(value));
    }
}

fn resolve_existing_file_path(
    path: &Path,
    context: &NativeToolExecutionContext,
    tool_name: &str,
) -> std::result::Result<PathBuf, String> {
    if path.is_absolute() {
        return path
            .canonicalize()
            .map_err(|err| format!("{tool_name} could not resolve {}: {err}", path.display()));
    }

    let Some(raw_root) = context.workspace_root.as_ref() else {
        return Err(format!(
            "{tool_name} relative paths require a Galley Native Project workspace; use an absolute path and approve it, or bind a workspace in a later native workspace slice."
        ));
    };
    let root = raw_root.canonicalize().map_err(|err| {
        format!(
            "{tool_name} Project workspace {} is unavailable: {err}",
            raw_root.display()
        )
    })?;
    let resolved = root.join(path);
    let canonical = resolved.canonicalize().map_err(|err| {
        format!(
            "{tool_name} could not resolve {} inside workspace {}: {err}",
            path.display(),
            root.display()
        )
    })?;
    if !canonical.starts_with(&root) {
        return Err(format!(
            "{tool_name} refused {} because it resolves outside workspace {}.",
            path.display(),
            root.display()
        ));
    }
    Ok(canonical)
}

fn resolve_code_run_cwd(
    call: &NativeToolCall,
    context: &NativeToolExecutionContext,
) -> std::result::Result<PathBuf, String> {
    if let Some(cwd) = code_run_cwd_arg(call) {
        resolve_code_run_cwd_path(Some(&cwd), context)
    } else {
        resolve_code_run_cwd_path(None, context)
    }
}

fn resolve_code_run_cwd_from_value(
    value: &Value,
    context: &NativeToolExecutionContext,
) -> std::result::Result<PathBuf, String> {
    let cwd = string_value_any(value, &["cwd", "working_directory", "workingDirectory"])
        .map(|cwd| cwd.trim().to_string())
        .filter(|cwd| !cwd.is_empty())
        .map(PathBuf::from);
    resolve_code_run_cwd_path(cwd.as_deref(), context)
}

fn resolve_code_run_cwd_path(
    cwd: Option<&Path>,
    context: &NativeToolExecutionContext,
) -> std::result::Result<PathBuf, String> {
    let Some(cwd) = cwd else {
        let Some(raw_root) = context.workspace_root.as_ref() else {
            return Err(
                "code_run requires a Galley Native Project workspace when `cwd` is omitted."
                    .to_string(),
            );
        };
        let root = raw_root.canonicalize().map_err(|err| {
            format!(
                "code_run Project workspace {} is unavailable: {err}",
                raw_root.display()
            )
        })?;
        return require_directory(&root, "code_run");
    };

    if cwd.is_absolute() {
        let canonical = cwd
            .canonicalize()
            .map_err(|err| format!("code_run could not resolve cwd {}: {err}", cwd.display()))?;
        return require_directory(&canonical, "code_run");
    }

    let Some(raw_root) = context.workspace_root.as_ref() else {
        return Err(
            "code_run relative cwd requires a Galley Native Project workspace.".to_string(),
        );
    };
    let root = raw_root.canonicalize().map_err(|err| {
        format!(
            "code_run Project workspace {} is unavailable: {err}",
            raw_root.display()
        )
    })?;
    let canonical = root.join(cwd).canonicalize().map_err(|err| {
        format!(
            "code_run could not resolve cwd {} inside workspace {}: {err}",
            cwd.display(),
            root.display()
        )
    })?;
    if !canonical.starts_with(&root) {
        return Err(format!(
            "code_run refused cwd {} because it resolves outside workspace {}.",
            cwd.display(),
            root.display()
        ));
    }
    require_directory(&canonical, "code_run")
}

fn resolve_writable_file_path(
    path: &Path,
    context: &NativeToolExecutionContext,
    tool_name: &str,
) -> std::result::Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("{tool_name} requires a file path, got {}.", path.display()))?;

    if path.is_absolute() {
        let parent = path.parent().ok_or_else(|| {
            format!(
                "{tool_name} requires a parent directory for {}.",
                path.display()
            )
        })?;
        let canonical_parent = parent.canonicalize().map_err(|err| {
            format!(
                "{tool_name} could not resolve parent directory {}: {err}",
                parent.display()
            )
        })?;
        let target = canonical_parent.join(file_name);
        if path_entry_exists(&target, tool_name)? {
            return target.canonicalize().map_err(|err| {
                format!("{tool_name} could not resolve {}: {err}", target.display())
            });
        }
        return Ok(target);
    }

    let Some(raw_root) = context.workspace_root.as_ref() else {
        return Err(format!(
            "{tool_name} relative paths require a Galley Native Project workspace; use an absolute path and approve it, or bind a workspace in a later native workspace slice."
        ));
    };
    let root = raw_root.canonicalize().map_err(|err| {
        format!(
            "{tool_name} Project workspace {} is unavailable: {err}",
            raw_root.display()
        )
    })?;
    let parent = path.parent().unwrap_or_else(|| Path::new(""));
    let candidate_parent = root.join(parent);
    let canonical_parent = candidate_parent.canonicalize().map_err(|err| {
        format!(
            "{tool_name} could not resolve parent directory {} inside workspace {}: {err}",
            parent.display(),
            root.display()
        )
    })?;
    if !canonical_parent.starts_with(&root) {
        return Err(format!(
            "{tool_name} refused {} because its parent resolves outside workspace {}.",
            path.display(),
            root.display()
        ));
    }
    let target = canonical_parent.join(file_name);
    if path_entry_exists(&target, tool_name)? {
        let canonical_target = target
            .canonicalize()
            .map_err(|err| format!("{tool_name} could not resolve {}: {err}", target.display()))?;
        if !canonical_target.starts_with(&root) {
            return Err(format!(
                "{tool_name} refused {} because it resolves outside workspace {}.",
                path.display(),
                root.display()
            ));
        }
        Ok(canonical_target)
    } else {
        Ok(target)
    }
}

fn require_directory(path: &Path, tool_name: &str) -> std::result::Result<PathBuf, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|err| format!("{tool_name} could not stat {}: {err}", path.display()))?;
    if !metadata.is_dir() {
        return Err(format!(
            "{tool_name} expected a directory, got {}.",
            path.display()
        ));
    }
    Ok(path.to_path_buf())
}

fn path_entry_exists(path: &Path, tool_name: &str) -> std::result::Result<bool, String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(format!(
            "{tool_name} could not inspect {}: {err}",
            path.display()
        )),
    }
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

fn virtual_text_with_cap(body: &str) -> (String, bool) {
    let cap = FILE_READ_MAX_BYTES as usize;
    if body.len() <= cap {
        return (body.to_string(), false);
    }
    let mut end = cap;
    while end > 0 && !body.is_char_boundary(end) {
        end -= 1;
    }
    (body[..end].to_string(), true)
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

fn format_file_read_resource_content(
    uri: &str,
    range: Option<&str>,
    truncated: bool,
    body: &str,
) -> String {
    let mut header = format!("file_read: {uri}");
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
        side_effect_mode: side_effect_mode(name).to_string(),
    }
}

fn side_effect_mode(name: &str) -> &'static str {
    match name {
        "file_read" | "web_scan" => "read_only",
        "file_patch" | "file_write" => "approval_gated_write",
        "code_run" => "approval_gated_process",
        "web_execute_js" => "approval_gated_browser_action",
        _ => "slice_4a_stub_no_side_effects",
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

    #[cfg(not(windows))]
    fn slow_command() -> &'static str {
        "sleep 2"
    }

    #[cfg(windows)]
    fn slow_command() -> &'static str {
        "ping -n 3 127.0.0.1 > nul"
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
    fn code_run_normalizes_command_cwd_timeout_for_preview() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        let call = tool_call(
            "code_run",
            serde_json::json!({
                "cmd": "echo hi",
                "cwd": "sub",
                "timeout_seconds": 2
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));

        let call = normalize_native_tool_call(call, &context);

        assert_eq!(call.arguments_json["command"], "echo hi");
        assert_eq!(call.arguments_json["timeoutSeconds"].as_f64(), Some(2.0));
        assert_eq!(
            call.arguments_json["resolved_cwd"].as_str(),
            Some(
                dir.path()
                    .join("sub")
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .as_ref()
            )
        );
        assert_eq!(approval_for_tool_call(&call, &context), "risk_based");
    }

    #[test]
    fn code_run_without_preview_args_fails_without_approval() {
        let dir = tempfile::tempdir().unwrap();
        let call = tool_call(
            "code_run",
            serde_json::json!({
                "command": "echo hi"
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));

        assert_eq!(approval_for_tool_call(&call, &context), "none");
        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("resolved_cwd"));
    }

    #[test]
    fn code_run_executes_workspace_command_and_captures_stdout() {
        let dir = tempfile::tempdir().unwrap();
        let call = tool_call(
            "code_run",
            serde_json::json!({
                "command": "echo hi",
                "timeoutSeconds": 2
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));
        let call = normalize_native_tool_call(call, &context);

        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "success");
        assert_eq!(result.approval, "risk_based");
        assert!(result.side_effects_performed);
        assert!(result.content.contains("exit_code: 0"));
        assert!(result.content.contains("stdout:"));
        assert!(result.content.contains("hi"));
    }

    #[test]
    fn code_run_refuses_capability_pack_script_uri() {
        let dir = tempfile::tempdir().unwrap();
        let call = tool_call(
            "code_run",
            serde_json::json!({
                "command": "python capability://morphling/scripts/promote.py",
                "timeoutSeconds": 2
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));
        let call = normalize_native_tool_call(call, &context);

        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "risk_based");
        assert!(!result.side_effects_performed);
        assert!(result
            .content
            .contains("refused capability pack script execution"));
        assert!(result.content.contains("materialize-by-hash approval path"));
    }

    #[test]
    fn code_run_reports_nonzero_exit_status() {
        let dir = tempfile::tempdir().unwrap();
        let call = tool_call(
            "code_run",
            serde_json::json!({
                "command": "exit 7",
                "timeoutSeconds": 2
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));
        let call = normalize_native_tool_call(call, &context);

        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "failed");
        assert!(result.side_effects_performed);
        assert!(result.content.contains("exit_code: 7"));
    }

    #[test]
    fn code_run_times_out_and_kills_process() {
        let dir = tempfile::tempdir().unwrap();
        let call = tool_call(
            "code_run",
            serde_json::json!({
                "command": slow_command(),
                "timeoutSeconds": 0.1
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));
        let call = normalize_native_tool_call(call, &context);

        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "timed_out");
        assert!(result.side_effects_performed);
        assert!(result.content.contains("timed_out: true"));
    }

    #[test]
    fn update_working_checkpoint_records_session_local_state_without_approval() {
        let call = tool_call(
            "update_working_checkpoint",
            serde_json::json!({
                "content": "Read the API docs; next step is adding tests.",
                "status": "Active"
            }),
        );

        let result = execute_native_tool(&call, &NativeToolExecutionContext::default());

        assert_eq!(result.status, "success");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(!result.requires_user_response);
        assert!(result.content.contains("status: active"));
        assert!(result.content.contains("Read the API docs"));
    }

    #[test]
    fn update_working_checkpoint_rejects_empty_content() {
        let call = tool_call(
            "update_working_checkpoint",
            serde_json::json!({
                "content": "   "
            }),
        );

        let result = execute_native_tool(&call, &NativeToolExecutionContext::default());

        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("non-empty"));
    }

    #[test]
    fn web_scan_without_browser_context_fails_without_stub() {
        let call = tool_call("web_scan", serde_json::json!({ "tabs_only": true }));
        let context =
            NativeToolExecutionContext::with_browser_unavailable(None, "Browser Control not ready");

        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("Browser Control is unavailable"));
        assert!(result.content.contains("\"status\": \"host_unavailable\""));
        assert!(!result.content.contains("Slice 4A deterministic stub"));
    }

    #[test]
    fn web_scan_tabs_only_uses_browser_bridge_context() {
        let dir = tempfile::tempdir().unwrap();
        let code_root = dir.path().join("code");
        let state_root = dir.path().join("state");
        fs::create_dir_all(&code_root).unwrap();
        fs::create_dir_all(&state_root).unwrap();
        fs::write(
            code_root.join("TMWebDriver.py"),
            r#"
class TMWebDriver:
    def __init__(self):
        self.default_session_id = None
    def get_all_sessions(self):
        return [{
            "id": "101",
            "url": "https://example.com/some/very/long/path/that/gets/truncated",
            "title": "Example",
            "connected_at": 1,
            "type": "ext_ws",
        }]
    def get_status(self):
        return {"extension_connected": True, "tab_count": 1}
"#,
        )
        .unwrap();
        let python = std::env::var_os("PYTHON")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "python" } else { "python3" }));
        let context = NativeToolExecutionContext::with_browser(
            None,
            NativeBrowserExecutionContext {
                python,
                code_root,
                state_root,
                wait_timeout_seconds: 1,
            },
        );
        let call = normalize_native_tool_call(
            tool_call(
                "web_scan",
                serde_json::json!({
                    "tabsOnly": true,
                    "tabId": "101",
                    "textOnly": true
                }),
            ),
            &context,
        );

        let result = execute_native_tool(&call, &context);

        assert_eq!(call.arguments_json["tabs_only"], true);
        assert_eq!(call.arguments_json["switch_tab_id"], "101");
        assert_eq!(call.arguments_json["text_only"], true);
        assert_eq!(result.status, "success");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("\"tabs_count\": 1"));
        assert!(result.content.contains("\"active_tab\": \"101\""));
        assert!(result.content.contains("\"id\": \"101\""));
    }

    #[test]
    fn web_scan_connected_no_tabs_returns_recovery_hint() {
        let dir = tempfile::tempdir().unwrap();
        let code_root = dir.path().join("code");
        let state_root = dir.path().join("state");
        fs::create_dir_all(&code_root).unwrap();
        fs::create_dir_all(&state_root).unwrap();
        fs::write(
            code_root.join("TMWebDriver.py"),
            r#"
class TMWebDriver:
    def get_all_sessions(self):
        return []
    def get_status(self):
        return {"extension_connected": True, "tab_count": 0}
"#,
        )
        .unwrap();
        let python = std::env::var_os("PYTHON")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "python" } else { "python3" }));
        let context = NativeToolExecutionContext::with_browser(
            None,
            NativeBrowserExecutionContext {
                python,
                code_root,
                state_root,
                wait_timeout_seconds: 1,
            },
        );
        let call = tool_call("web_scan", serde_json::json!({ "tabs_only": true }));

        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("recovery:"));
        assert!(result.content.contains("\"status\": \"connected_no_tabs\""));
        assert!(result.content.contains("Open any normal webpage"));
    }

    #[test]
    fn web_execute_js_without_browser_context_fails_without_stub() {
        let call = normalize_native_tool_call(
            tool_call(
                "web_execute_js",
                serde_json::json!({ "script": "document.title" }),
            ),
            &NativeToolExecutionContext::default(),
        );
        let context =
            NativeToolExecutionContext::with_browser_unavailable(None, "Browser Control not ready");

        let result = execute_native_tool(&call, &context);

        assert_eq!(approval_for_tool_call(&call, &context), "none");
        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("Browser Control is unavailable"));
        assert!(result.content.contains("\"status\": \"host_unavailable\""));
        assert!(!result.content.contains("Slice 4A deterministic stub"));
    }

    #[test]
    fn web_execute_js_save_to_file_is_rejected_before_approval() {
        let dir = tempfile::tempdir().unwrap();
        let context = NativeToolExecutionContext::with_browser(
            None,
            NativeBrowserExecutionContext {
                python: PathBuf::from(if cfg!(windows) { "python" } else { "python3" }),
                code_root: dir.path().join("code"),
                state_root: dir.path().join("state"),
                wait_timeout_seconds: 1,
            },
        );
        let call = normalize_native_tool_call(
            tool_call(
                "web_execute_js",
                serde_json::json!({
                    "script": "document.body.innerText",
                    "saveToFile": "page.txt"
                }),
            ),
            &context,
        );

        let result = execute_native_tool(&call, &context);

        assert_eq!(call.arguments_json["save_to_file"], "page.txt");
        assert_eq!(approval_for_tool_call(&call, &context), "none");
        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("save_to_file"));
    }

    #[test]
    fn web_execute_js_not_connected_returns_recovery_without_side_effects() {
        let dir = tempfile::tempdir().unwrap();
        let code_root = dir.path().join("code");
        let state_root = dir.path().join("state");
        fs::create_dir_all(&code_root).unwrap();
        fs::create_dir_all(&state_root).unwrap();
        fs::write(
            code_root.join("TMWebDriver.py"),
            r#"
class TMWebDriver:
    def get_all_sessions(self):
        return []
    def get_status(self):
        return {"extension_connected": False, "tab_count": 0}
"#,
        )
        .unwrap();
        let python = std::env::var_os("PYTHON")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "python" } else { "python3" }));
        let context = NativeToolExecutionContext::with_browser(
            None,
            NativeBrowserExecutionContext {
                python,
                code_root,
                state_root,
                wait_timeout_seconds: 1,
            },
        );
        let call = normalize_native_tool_call(
            tool_call(
                "web_execute_js",
                serde_json::json!({ "script": "document.title" }),
            ),
            &context,
        );

        let result = execute_native_tool(&call, &context);

        assert_eq!(approval_for_tool_call(&call, &context), "risk_based");
        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "risk_based");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("recovery:"));
        assert!(result.content.contains("\"status\": \"not_connected\""));
        assert!(result.content.contains("Test connection"));
    }

    #[test]
    fn web_execute_js_uses_browser_bridge_context() {
        let dir = tempfile::tempdir().unwrap();
        let code_root = dir.path().join("code");
        let state_root = dir.path().join("state");
        fs::create_dir_all(&code_root).unwrap();
        fs::create_dir_all(&state_root).unwrap();
        fs::write(
            code_root.join("TMWebDriver.py"),
            r#"
class TMWebDriver:
    def __init__(self):
        self.default_session_id = None
    def get_all_sessions(self):
        return [{
            "id": "101",
            "url": "https://example.com/",
            "title": "Example",
            "connected_at": 1,
            "type": "ext_ws",
        }]
    def get_status(self):
        return {"extension_connected": True, "tab_count": 1}
    def execute_js(self, script, timeout=15, session_id=None):
        return {
            "echo": script,
            "session": session_id or self.default_session_id,
            "timeout": timeout,
        }
"#,
        )
        .unwrap();
        fs::write(
            code_root.join("simphtml.py"),
            r#"
def execute_js_rich(script, driver, no_monitor=False):
    return {
        "status": "success",
        "js_return": driver.execute_js(script, timeout=15),
        "no_monitor": no_monitor,
        "active_tab": driver.default_session_id,
    }
"#,
        )
        .unwrap();
        let python = std::env::var_os("PYTHON")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "python" } else { "python3" }));
        let context = NativeToolExecutionContext::with_browser(
            None,
            NativeBrowserExecutionContext {
                python,
                code_root,
                state_root,
                wait_timeout_seconds: 1,
            },
        );
        let call = normalize_native_tool_call(
            tool_call(
                "web_execute_js",
                serde_json::json!({
                    "code": "document.title",
                    "tabId": "101",
                    "noMonitor": true
                }),
            ),
            &context,
        );

        let result = execute_native_tool(&call, &context);

        assert_eq!(call.arguments_json["script"], "document.title");
        assert_eq!(call.arguments_json["switch_tab_id"], "101");
        assert_eq!(call.arguments_json["no_monitor"], true);
        assert_eq!(approval_for_tool_call(&call, &context), "risk_based");
        assert_eq!(result.status, "success");
        assert_eq!(result.approval, "risk_based");
        assert!(result.side_effects_performed);
        assert!(result.content.contains("web_execute_js:"));
        assert!(result.content.contains("\"active_tab\": \"101\""));
        assert!(result.content.contains("\"echo\": \"document.title\""));
        assert!(result.content.contains("\"no_monitor\": true"));
    }

    #[test]
    fn web_execute_js_marks_ga_error_result_failed() {
        let dir = tempfile::tempdir().unwrap();
        let code_root = dir.path().join("code");
        let state_root = dir.path().join("state");
        fs::create_dir_all(&code_root).unwrap();
        fs::create_dir_all(&state_root).unwrap();
        fs::write(
            code_root.join("TMWebDriver.py"),
            r#"
class TMWebDriver:
    def __init__(self):
        self.default_session_id = None
    def get_all_sessions(self):
        return [{
            "id": "101",
            "url": "https://example.com/",
            "title": "Example",
            "connected_at": 1,
            "type": "ext_ws",
        }]
    def get_status(self):
        return {"extension_connected": True, "tab_count": 1}
"#,
        )
        .unwrap();
        fs::write(
            code_root.join("simphtml.py"),
            r#"
def execute_js_rich(script, driver, no_monitor=False):
    return {"status": "error", "msg": "script failed"}
"#,
        )
        .unwrap();
        let python = std::env::var_os("PYTHON")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "python" } else { "python3" }));
        let context = NativeToolExecutionContext::with_browser(
            None,
            NativeBrowserExecutionContext {
                python,
                code_root,
                state_root,
                wait_timeout_seconds: 1,
            },
        );
        let call = normalize_native_tool_call(
            tool_call(
                "web_execute_js",
                serde_json::json!({ "script": "throw new Error('x')" }),
            ),
            &context,
        );

        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "risk_based");
        assert!(result.side_effects_performed);
        assert!(result.content.contains("\"status\": \"error\""));
        assert!(result.content.contains("script failed"));
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
    fn file_read_reads_memory_resource_without_approval() {
        let call = tool_call(
            "file_read",
            serde_json::json!({
                "path": "memory://global/l1",
                "startLine": 2,
                "endLine": 2
            }),
        );
        let mut context = NativeToolExecutionContext::default();
        context.resource_files.insert(
            "memory://global/l1".to_string(),
            "heading\nindexed trigger\nbody".to_string(),
        );

        let approval = approval_for_tool_call(&call, &context);
        let result = execute_native_tool(&call, &context);

        assert_eq!(approval, "none");
        assert_eq!(result.status, "success");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("file_read: memory://global/l1"));
        assert!(result.content.contains("lines: 2-2"));
        assert!(result.content.contains("indexed trigger"));
        assert!(!result.content.contains("\nheading\n"));
    }

    #[test]
    fn file_read_missing_memory_resource_lists_available_resources() {
        let call = tool_call(
            "file_read",
            serde_json::json!({
                "path": "memory://global/l2/missing"
            }),
        );
        let mut context = NativeToolExecutionContext::default();
        context.resource_files.insert(
            "memory://global/l1".to_string(),
            "existing index".to_string(),
        );

        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "none");
        assert!(result.content.contains("native resource not found"));
        assert!(result.content.contains("memory://global/l1"));
    }

    #[test]
    fn file_read_reads_capability_resource_without_approval() {
        let call = tool_call(
            "file_read",
            serde_json::json!({
                "path": "capability://morphling/sops/main",
                "startLine": 2,
                "endLine": 2
            }),
        );
        let mut context = NativeToolExecutionContext::default();
        context.resource_files.insert(
            "capability://morphling/sops/main".to_string(),
            "heading\nMorphling SOP\nbody".to_string(),
        );

        let approval = approval_for_tool_call(&call, &context);
        let result = execute_native_tool(&call, &context);

        assert_eq!(approval, "none");
        assert_eq!(result.status, "success");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(result
            .content
            .contains("file_read: capability://morphling/sops/main"));
        assert!(result.content.contains("Morphling SOP"));
        assert!(!result.content.contains("\nheading\n"));
    }

    #[test]
    fn file_read_reads_workspace_resource_without_approval() {
        let call = tool_call(
            "file_read",
            serde_json::json!({
                "path": "workspace://index",
                "startLine": 2,
                "endLine": 3
            }),
        );
        let mut context = NativeToolExecutionContext::default();
        context.resource_files.insert(
            "workspace://index".to_string(),
            "heading\n- @src/main.rs\n- @Cargo.toml\n".to_string(),
        );

        let approval = approval_for_tool_call(&call, &context);
        let result = execute_native_tool(&call, &context);

        assert_eq!(approval, "none");
        assert_eq!(result.status, "success");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("file_read: workspace://index"));
        assert!(result.content.contains("@src/main.rs"));
        assert!(result.content.contains("@Cargo.toml"));
        assert!(!result.content.contains("\nheading\n"));
    }

    #[test]
    fn file_read_missing_capability_resource_lists_capability_resources() {
        let call = tool_call(
            "file_read",
            serde_json::json!({
                "path": "capability://morphling/sops/missing"
            }),
        );
        let mut context = NativeToolExecutionContext::default();
        context
            .resource_files
            .insert("memory://global/l1".to_string(), "memory index".to_string());
        context.resource_files.insert(
            "capability://morphling/sops/main".to_string(),
            "Morphling SOP".to_string(),
        );

        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "none");
        assert!(result.content.contains("native resource not found"));
        assert!(result.content.contains("capability://morphling/sops/main"));
        assert!(!result.content.contains("memory://global/l1"));
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

    #[test]
    fn file_patch_normalizes_camel_case_args_for_preview() {
        let call = tool_call(
            "file_patch",
            serde_json::json!({
                "filePath": "notes.txt",
                "oldContent": "alpha",
                "newContent": "bravo"
            }),
        );

        let call = normalize_native_tool_call(call, &NativeToolExecutionContext::default());

        assert_eq!(call.arguments_json["path"], "notes.txt");
        assert_eq!(call.arguments_json["old_content"], "alpha");
        assert_eq!(call.arguments_json["new_content"], "bravo");
        assert_eq!(
            approval_for_tool_call(&call, &NativeToolExecutionContext::default()),
            "risk_based"
        );
    }

    #[test]
    fn file_patch_without_preview_args_fails_without_approval() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "alpha\n").unwrap();
        let call = tool_call(
            "file_patch",
            serde_json::json!({
                "path": "notes.txt",
                "patch": "@@ opaque patch @@"
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));

        assert_eq!(approval_for_tool_call(&call, &context), "none");
        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("old_content"));
        assert_eq!(
            fs::read_to_string(dir.path().join("notes.txt")).unwrap(),
            "alpha\n"
        );
    }

    #[test]
    fn file_patch_applies_unique_workspace_relative_replacement() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "alpha\nbeta\ngamma\n").unwrap();
        let call = tool_call(
            "file_patch",
            serde_json::json!({
                "path": "notes.txt",
                "old_content": "beta\n",
                "new_content": "bravo\n"
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));

        assert_eq!(approval_for_tool_call(&call, &context), "risk_based");
        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "success");
        assert_eq!(result.approval, "risk_based");
        assert!(result.side_effects_performed);
        assert!(result.content.contains("matched: 1"));
        assert_eq!(
            fs::read_to_string(dir.path().join("notes.txt")).unwrap(),
            "alpha\nbravo\ngamma\n"
        );
    }

    #[test]
    fn file_patch_rejects_ambiguous_old_content_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "alpha\nalpha\n").unwrap();
        let call = tool_call(
            "file_patch",
            serde_json::json!({
                "path": "notes.txt",
                "old_content": "alpha\n",
                "new_content": "bravo\n"
            }),
        );

        let result = execute_native_tool(
            &call,
            &NativeToolExecutionContext::new(Some(dir.path().to_path_buf())),
        );

        assert_eq!(result.status, "failed");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("2 matching"));
        assert_eq!(
            fs::read_to_string(dir.path().join("notes.txt")).unwrap(),
            "alpha\nalpha\n"
        );
    }

    #[test]
    fn file_write_normalizes_overwrite_bool_and_existing_content_for_preview() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "alpha\n").unwrap();
        let call = tool_call(
            "file_write",
            serde_json::json!({
                "filePath": "notes.txt",
                "content": "bravo\n",
                "overwrite": true
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));

        let call = normalize_native_tool_call(call, &context);

        assert_eq!(call.arguments_json["path"], "notes.txt");
        assert_eq!(call.arguments_json["mode"], "overwrite");
        assert_eq!(call.arguments_json["existing_content"], "alpha\n");
        assert_eq!(approval_for_tool_call(&call, &context), "risk_based");
        assert_eq!(
            fs::read_to_string(dir.path().join("notes.txt")).unwrap(),
            "alpha\n"
        );
    }

    #[test]
    fn file_write_replaces_model_supplied_existing_content_with_core_preview() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "alpha\n").unwrap();
        let call = tool_call(
            "file_write",
            serde_json::json!({
                "path": "notes.txt",
                "content": "bravo\n",
                "mode": "overwrite",
                "existing_content": "fake\n",
                "preview_error": "fake error"
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));

        let call = normalize_native_tool_call(call, &context);

        assert_eq!(call.arguments_json["existing_content"], "alpha\n");
        assert!(call.arguments_json.get("preview_error").is_none());
        assert_eq!(approval_for_tool_call(&call, &context), "risk_based");
        assert_eq!(
            fs::read_to_string(dir.path().join("notes.txt")).unwrap(),
            "alpha\n"
        );
    }

    #[test]
    fn file_write_creates_new_workspace_file_after_preview() {
        let dir = tempfile::tempdir().unwrap();
        let call = tool_call(
            "file_write",
            serde_json::json!({
                "path": "draft.txt",
                "content": "hello\n",
                "mode": "create"
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));
        let call = normalize_native_tool_call(call, &context);

        assert_eq!(approval_for_tool_call(&call, &context), "risk_based");
        assert_eq!(call.arguments_json["existing_content"], "");
        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "success");
        assert_eq!(result.approval, "risk_based");
        assert!(result.side_effects_performed);
        assert!(result.content.contains("mode: create"));
        assert_eq!(
            fs::read_to_string(dir.path().join("draft.txt")).unwrap(),
            "hello\n"
        );
    }

    #[test]
    fn file_write_without_preview_args_fails_without_approval() {
        let dir = tempfile::tempdir().unwrap();
        let call = tool_call(
            "file_write",
            serde_json::json!({
                "path": "draft.txt",
                "content": "hello\n",
                "mode": "create"
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));

        assert_eq!(approval_for_tool_call(&call, &context), "none");
        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "failed");
        assert_eq!(result.approval, "none");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("existing_content"));
        assert!(!dir.path().join("draft.txt").exists());
    }

    #[test]
    fn file_write_overwrite_refuses_stale_preview_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "alpha\n").unwrap();
        let call = tool_call(
            "file_write",
            serde_json::json!({
                "path": "notes.txt",
                "content": "bravo\n",
                "mode": "overwrite"
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));
        let call = normalize_native_tool_call(call, &context);

        fs::write(dir.path().join("notes.txt"), "changed\n").unwrap();
        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "failed");
        assert!(!result.side_effects_performed);
        assert!(result
            .content
            .contains("changed after the approval preview"));
        assert_eq!(
            fs::read_to_string(dir.path().join("notes.txt")).unwrap(),
            "changed\n"
        );
    }

    #[test]
    fn file_write_rejects_append_mode_without_approval() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("notes.txt"), "alpha\n").unwrap();
        let call = tool_call(
            "file_write",
            serde_json::json!({
                "path": "notes.txt",
                "content": "bravo\n",
                "mode": "append"
            }),
        );
        let context = NativeToolExecutionContext::new(Some(dir.path().to_path_buf()));
        let call = normalize_native_tool_call(call, &context);

        assert_eq!(approval_for_tool_call(&call, &context), "none");
        let result = execute_native_tool(&call, &context);

        assert_eq!(result.status, "failed");
        assert!(!result.side_effects_performed);
        assert!(result.content.contains("create"));
        assert_eq!(
            fs::read_to_string(dir.path().join("notes.txt")).unwrap(),
            "alpha\n"
        );
    }
}
