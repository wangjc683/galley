//! Galley IPC Protocol v0.1 — Rust mirror of `runner/ipc.py`.
//!
//! Source of truth for the wire format is [`docs/ipc-protocol.md`]. The Python
//! side (`runner/ipc.py`) emits these as JSON Lines; we parse them here.
//!
//! ## Field naming
//!
//! Wire format is camelCase (matches the existing JSON contract — the GUI's
//! `gui/src/types/ipc.ts` is also camelCase). `#[serde(rename_all = "camelCase")]`
//! at the struct level handles the conversion.
//!
//! ## Tagged enum
//!
//! Events and Commands are externally-tagged enums via the `kind` field
//! (`#[serde(tag = "kind", rename_all = "snake_case")]`). When a JSON line
//! arrives `{"kind":"turn_start","sessionId":"...","turnIndex":3,"timestamp":...}`,
//! serde reads the `kind` and dispatches to the matching variant.
//!
//! ## Synchronization with `runner/ipc.py`
//!
//! Two-source-of-truth: the Python dataclasses generate the wire format, this
//! file consumes it. Anyone adding a new event must:
//!
//!   1. Change `docs/ipc-protocol.md`
//!   2. Change `runner/ipc.py` dataclass + tests
//!   3. Add the same variant + struct here, with the same wire-level field
//!      names and types
//!
//! No codegen — manual sync. See [`docs/refactor/B2-bridge-ownership.md`]
//! gotcha G2 for why we accept the manual maintenance cost over introducing
//! a codegen toolchain.
//!
//! ## MalformedLine variant
//!
//! Not in the Python protocol — added on the Rust side so the broadcast
//! channel can fan out lines that don't parse as JSON (Python tracebacks
//! that slipped past the bridge's stdout discipline, partial buffer flushes
//! on crash, etc.) without dropping them silently. Subscribers can choose
//! to log or ignore.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Wire-format protocol version. Bumped when breaking changes happen to
/// the schema (additive field changes don't bump). Currently matches
/// `runner/ipc.py:PROTOCOL_VERSION`.
pub const PROTOCOL_VERSION: &str = "0.1";

// ---------------- Events (runner -> Galley Core) ----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IpcEvent {
    Ready(ReadyEvent),
    TurnStart(TurnStartEvent),
    ToolCallPending(ToolCallPendingEvent),
    ToolCallStart(ToolCallStartEvent),
    ToolCallEnd(ToolCallEndEvent),
    ToolCallProgress(ToolCallProgressEvent),
    TurnEnd(TurnEndEvent),
    TurnProgress(TurnProgressEvent),
    AskUser(AskUserEvent),
    RunComplete(RunCompleteEvent),
    Error(ErrorEvent),
    HistoryLoaded(HistoryLoadedEvent),
    LlmChanged(LlmChangedEvent),
    ToolsReinjected(ToolsReinjectedEvent),
    PetAttached(PetAttachedEvent),
    PetDetached(PetDetachedEvent),
    SystemMessage(SystemMessageEvent),
}

impl IpcEvent {
    /// Session id that owns this event. All events carry one — used by the
    /// router to dispatch to the right subscriber set.
    pub fn session_id(&self) -> &str {
        match self {
            IpcEvent::Ready(e) => &e.session_id,
            IpcEvent::TurnStart(e) => &e.session_id,
            IpcEvent::ToolCallPending(e) => &e.session_id,
            IpcEvent::ToolCallStart(e) => &e.session_id,
            IpcEvent::ToolCallEnd(e) => &e.session_id,
            IpcEvent::ToolCallProgress(e) => &e.session_id,
            IpcEvent::TurnEnd(e) => &e.session_id,
            IpcEvent::TurnProgress(e) => &e.session_id,
            IpcEvent::AskUser(e) => &e.session_id,
            IpcEvent::RunComplete(e) => &e.session_id,
            IpcEvent::Error(e) => &e.session_id,
            IpcEvent::HistoryLoaded(e) => &e.session_id,
            IpcEvent::LlmChanged(e) => &e.session_id,
            IpcEvent::ToolsReinjected(e) => &e.session_id,
            IpcEvent::PetAttached(e) => &e.session_id,
            IpcEvent::PetDetached(e) => &e.session_id,
            IpcEvent::SystemMessage(e) => &e.session_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyEvent {
    pub session_id: String,
    pub protocol_version: String,
    pub ga_commit: String,
    pub ga_commit_date: String,
    pub ga_path: String,
    pub llm_name: String,
    pub cwd: String,
    pub pid: i64,
    /// Acronym quirk: Python emits `availableLLMs` (the LLM acronym
    /// preserves caps); serde's camelCase rule would map
    /// `available_llms` → `availableLlms` (single capital), so we have
    /// to spell the wire name explicitly. Without this rename the
    /// field falls through to `#[serde(default)]` and the GUI sees an
    /// empty list. Same convention as runner/ipc.py
    /// (`availableLLMs: list[dict]`) and gui/src/types/ipc.ts.
    #[serde(default, rename = "availableLLMs")]
    pub available_llms: Vec<Value>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartEvent {
    pub session_id: String,
    pub turn_index: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallPendingEvent {
    pub session_id: String,
    pub approval_id: String,
    pub turn_index: i64,
    #[serde(default)]
    pub absolute_turn_index: Option<i64>,
    pub tool_name: String,
    pub args: Value,
    pub args_preview: String,
    /// "low" | "medium" | "high"
    pub risk_level: String,
    pub reason: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallStartEvent {
    pub session_id: String,
    pub tool_call_id: String,
    pub turn_index: i64,
    #[serde(default)]
    pub absolute_turn_index: Option<i64>,
    pub tool_name: String,
    pub args: Value,
    pub args_preview: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallEndEvent {
    pub session_id: String,
    pub tool_call_id: String,
    /// "success" | "failed" | "denied" | "cancelled"
    pub status: String,
    pub result_preview: String,
    pub elapsed_ms: i64,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallProgressEvent {
    pub session_id: String,
    pub tool_call_id: String,
    pub text: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnEndEvent {
    pub session_id: String,
    pub turn_index: i64,
    pub summary: String,
    pub tool_calls: Vec<Value>,
    pub tool_results: Vec<Value>,
    pub response_content: String,
    #[serde(default)]
    pub exit_reason: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telemetry: Option<TurnTelemetry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
    #[serde(default)]
    pub absolute_turn_index: Option<i64>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TurnTelemetry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elapsed_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_create_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read_tokens: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_used_chars: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_limit_chars: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnProgressEvent {
    pub session_id: String,
    pub delta: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskUserEvent {
    pub session_id: String,
    pub question: String,
    pub candidates: Vec<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCompleteEvent {
    pub session_id: String,
    pub exit_reason: Value,
    pub final_content: String,
    pub total_turns: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEvent {
    pub session_id: String,
    pub message: String,
    /// "bridge" | "runtime" | "business"
    #[serde(default = "default_error_category")]
    pub category: String,
    /// "error" | "warning" | "info"
    #[serde(default = "default_error_severity")]
    pub severity: String,
    #[serde(default)]
    pub retryable: bool,
    #[serde(default)]
    pub hint: Option<String>,
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default)]
    pub traceback: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
    pub timestamp: String,
}

fn default_error_category() -> String {
    "bridge".to_string()
}

fn default_error_severity() -> String {
    "error".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryLoadedEvent {
    pub session_id: String,
    pub message_count: i64,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChangedEvent {
    pub session_id: String,
    pub index: i64,
    pub name: String,
    pub display_name: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsReinjectedEvent {
    pub session_id: String,
    pub blocks_added: i64,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetAttachedEvent {
    pub session_id: String,
    pub port: i64,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PetDetachedEvent {
    pub session_id: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMessageEvent {
    pub session_id: String,
    pub content: String,
    #[serde(default = "default_system_variant")]
    pub variant: String,
    pub timestamp: String,
}

fn default_system_variant() -> String {
    "system".to_string()
}

// ---------------- Commands (Galley Core -> runner) ----------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IpcCommand {
    UserMessage(UserMessageCommand),
    ApprovalResponse(ApprovalResponseCommand),
    AskUserResponse(AskUserResponseCommand),
    Abort,
    LoadHistory(LoadHistoryCommand),
    SetApprovalRules(SetApprovalRulesCommand),
    SetYoloMode(SetYoloModeCommand),
    SetLlm(SetLlmCommand),
    Shutdown,
    ReinjectTools,
    AttachPet(AttachPetCommand),
    DetachPet,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMessageCommand {
    pub text: String,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility: Option<String>,
    #[serde(default)]
    pub absolute_turn_index: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalResponseCommand {
    pub approval_id: String,
    /// "allow_once" | "deny" | "always_allow_project" | "always_allow_global"
    pub decision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskUserResponseCommand {
    pub text: String,
    #[serde(default)]
    pub absolute_turn_index: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadHistoryCommand {
    pub messages: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetApprovalRulesCommand {
    #[serde(default)]
    pub always_allow_global: Vec<String>,
    #[serde(default)]
    pub always_allow_project: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetYoloModeCommand {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetLlmCommand {
    pub llm_index: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachPetCommand {
    /// Local HTTP port the Desktop Pet subprocess binds to. Default
    /// 41983 (matches GA's `stapp.py`). Python `runner/ipc.py`
    /// `AttachPetCommand` declares `port: int = 41983`, so this field
    /// must round-trip end-to-end: TS → Rust → Python. We use
    /// `skip_serializing_if = Option::is_none` so omitting it from the
    /// wire (when the TS caller doesn't specify) lets Python fall back
    /// to its own default — sending `null` would error against Python's
    /// strict-int dataclass.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ready_event() {
        let line = r#"{"kind":"ready","sessionId":"s1","protocolVersion":"0.1","gaCommit":"abc","gaCommitDate":"2026-05-18T12:00:00+08:00","gaPath":"/ga","llmName":"claude","cwd":"/tmp","pid":42,"timestamp":"2026-05-19T10:00:00+08:00"}"#;
        let event: IpcEvent = serde_json::from_str(line).expect("parse ready");
        match event {
            IpcEvent::Ready(r) => {
                assert_eq!(r.session_id, "s1");
                assert_eq!(r.pid, 42);
                assert_eq!(r.available_llms.len(), 0);
            }
            _ => panic!("expected Ready variant"),
        }
    }

    /// Regression guard: Python emits `availableLLMs` (uppercase LL —
    /// matches the LLM acronym). Without the explicit `#[serde(rename]`,
    /// serde's camelCase rule maps `available_llms` to `availableLlms`
    /// (single capital L) and the parse silently drops the field,
    /// surfacing as `undefined` on the GUI side. Caught 2026-05-19 in
    /// JC's dogfood — first time the ready event flowed end-to-end
    /// through Rust core.
    #[test]
    fn parse_ready_event_carries_available_llms() {
        let line = r#"{"kind":"ready","sessionId":"s1","protocolVersion":"0.1","gaCommit":"abc","gaCommitDate":"d","gaPath":"/ga","llmName":"x","cwd":"/","pid":1,"availableLLMs":[{"index":0,"name":"llm-a"},{"index":1,"name":"llm-b"}],"timestamp":"t"}"#;
        let event: IpcEvent = serde_json::from_str(line).expect("parse ready");
        if let IpcEvent::Ready(r) = event {
            assert_eq!(r.available_llms.len(), 2);
            // Round-trip: when Rust re-serializes for the
            // runner-event Tauri emit, the wire name must stay
            // availableLLMs so the TS side reads it correctly.
            let out = serde_json::to_string(&r).unwrap();
            assert!(
                out.contains("\"availableLLMs\":[{"),
                "expected availableLLMs in re-serialized output, got: {out}"
            );
        } else {
            panic!("expected Ready");
        }
    }

    #[test]
    fn parse_turn_start() {
        let line = r#"{"kind":"turn_start","sessionId":"s1","turnIndex":3,"timestamp":"2026-05-19T10:00:00+08:00"}"#;
        let event: IpcEvent = serde_json::from_str(line).expect("parse");
        if let IpcEvent::TurnStart(t) = event {
            assert_eq!(t.turn_index, 3);
        } else {
            panic!("wrong variant");
        }
    }

    #[test]
    fn parse_error_with_defaults() {
        // Old-style error event without the new triage fields — should
        // populate from `#[serde(default)]`.
        let line = r#"{"kind":"error","sessionId":"s1","message":"boom","timestamp":"2026-05-19T10:00:00+08:00"}"#;
        let event: IpcEvent = serde_json::from_str(line).expect("parse error");
        if let IpcEvent::Error(e) = event {
            assert_eq!(e.category, "bridge");
            assert_eq!(e.severity, "error");
            assert!(!e.retryable);
            assert!(e.hint.is_none());
        } else {
            panic!("wrong variant");
        }
    }

    #[test]
    fn parse_turn_end_with_telemetry() {
        let line = r#"{"kind":"turn_end","sessionId":"s1","turnIndex":2,"summary":"done","toolCalls":[],"toolResults":[],"responseContent":"ok","exitReason":{"result":"CURRENT_TASK_DONE","data":null},"telemetry":{"elapsedMs":135000,"inputTokens":18400,"outputTokens":1200,"cacheCreateTokens":0,"cacheReadTokens":0,"requestCount":3,"contextUsedChars":126000,"contextLimitChars":300000},"timestamp":"2026-05-19T10:00:00+08:00"}"#;
        let event: IpcEvent = serde_json::from_str(line).expect("parse turn_end");
        if let IpcEvent::TurnEnd(t) = event {
            let telemetry = t.telemetry.expect("telemetry");
            assert_eq!(telemetry.elapsed_ms, Some(135000));
            assert_eq!(telemetry.input_tokens, Some(18400));
            assert_eq!(telemetry.output_tokens, Some(1200));
            assert_eq!(telemetry.context_used_chars, Some(126000));
            assert_eq!(telemetry.context_limit_chars, Some(300000));
        } else {
            panic!("wrong variant");
        }
    }

    #[test]
    fn session_id_accessor_works_for_all_variants() {
        // Smoke: at least Ready / TurnStart / Error have session_id().
        let ready: IpcEvent = serde_json::from_str(r#"{"kind":"ready","sessionId":"r1","protocolVersion":"0.1","gaCommit":"a","gaCommitDate":"x","gaPath":"/","llmName":"l","cwd":"/","pid":1,"timestamp":"t"}"#).unwrap();
        assert_eq!(ready.session_id(), "r1");
        let ts: IpcEvent = serde_json::from_str(
            r#"{"kind":"turn_start","sessionId":"r2","turnIndex":1,"timestamp":"t"}"#,
        )
        .unwrap();
        assert_eq!(ts.session_id(), "r2");
    }

    #[test]
    fn serialize_command_user_message() {
        let cmd = IpcCommand::UserMessage(UserMessageCommand {
            text: "hello".to_string(),
            images: vec![],
            visibility: None,
            absolute_turn_index: None,
        });
        let s = serde_json::to_string(&cmd).unwrap();
        // The wire format uses "kind" tag + snake_case variants.
        assert!(s.contains("\"kind\":\"user_message\""));
        assert!(s.contains("\"text\":\"hello\""));
        assert!(
            !s.contains("visibility"),
            "None visibility should be omitted so Python uses its default: {s}"
        );
        // Verify Python side can parse this — round-trip back.
        let parsed: IpcCommand = serde_json::from_str(&s).unwrap();
        match parsed {
            IpcCommand::UserMessage(m) => assert_eq!(m.text, "hello"),
            _ => panic!("wrong"),
        }
    }

    #[test]
    fn serialize_optional_visibility_omits_none() {
        let event = IpcEvent::TurnProgress(TurnProgressEvent {
            session_id: "s1".to_string(),
            delta: "partial".to_string(),
            source: "workbench".to_string(),
            visibility: None,
            timestamp: "t".to_string(),
        });
        let s = serde_json::to_string(&event).unwrap();
        assert!(s.contains("\"kind\":\"turn_progress\""));
        assert!(
            !s.contains("visibility"),
            "None visibility should serialize as an omitted optional field, not null: {s}"
        );
    }

    #[test]
    fn serialize_command_shutdown() {
        let cmd = IpcCommand::Shutdown;
        let s = serde_json::to_string(&cmd).unwrap();
        assert_eq!(s, r#"{"kind":"shutdown"}"#);
    }

    #[test]
    fn serialize_command_set_llm() {
        let cmd = IpcCommand::SetLlm(SetLlmCommand { llm_index: 2 });
        let s = serde_json::to_string(&cmd).unwrap();
        assert!(s.contains("\"kind\":\"set_llm\""));
        assert!(s.contains("\"llmIndex\":2"));
    }

    #[test]
    fn protocol_version_constant() {
        assert_eq!(PROTOCOL_VERSION, "0.1");
    }

    /// Regression guard: the Rust↔Python `AttachPetCommand` schemas
    /// must stay aligned. Python `runner/ipc.py` declares
    /// `AttachPetCommand(port: int = 41983, kind: str = "attach_pet")`
    /// and decodes via `cls(**payload)` — *strict* kwargs that error
    /// on any unknown field. The original B2 mirror added a
    /// speculative `variant` field on the Rust side; TS sent
    /// `{kind, port: 41983}`, Rust dropped `port` and re-serialized
    /// with `{kind, variant: null}`, Python raised
    /// `AttachPetCommand.__init__() got an unexpected keyword argument
    /// 'variant'`. Caught 2026-05-19 in JC's dogfood. Two invariants
    /// guard against the same class of drift:
    ///   1. The wire field is `port`, not `variant`
    ///   2. When `port` is None, it's omitted (not serialized as
    ///      `null`) so Python's int-typed default kicks in
    #[test]
    fn attach_pet_wire_uses_port_not_variant() {
        let with_port = IpcCommand::AttachPet(AttachPetCommand { port: Some(41983) });
        let s = serde_json::to_string(&with_port).unwrap();
        assert!(s.contains("\"kind\":\"attach_pet\""), "{s}");
        assert!(s.contains("\"port\":41983"), "{s}");
        assert!(!s.contains("variant"), "Rust must not emit 'variant': {s}");

        // Omitted port → field skipped, Python falls back to its
        // 41983 default. Critical: must NOT serialize as `"port":null`.
        let no_port = IpcCommand::AttachPet(AttachPetCommand { port: None });
        let s = serde_json::to_string(&no_port).unwrap();
        assert_eq!(
            s, r#"{"kind":"attach_pet"}"#,
            "None port must be omitted (Python uses int default), not serialized as null"
        );

        // Round-trip: TS-style input parses + re-serializes
        // identically.
        let from_ts = r#"{"kind":"attach_pet","port":41983}"#;
        let parsed: IpcCommand = serde_json::from_str(from_ts).unwrap();
        let reserialized = serde_json::to_string(&parsed).unwrap();
        assert_eq!(reserialized, from_ts);
    }
}
