use serde::{Deserialize, Serialize};

use super::origin::Origin;
use super::session::SessionId;

/// Opaque message identifier. The `messages.id` column is `TEXT` —
/// runner / GUI assign string ids like `msg_…`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MessageId(pub String);

/// Role of a message in the conversation history. Mirrors GA's roles
/// plus Galley's "system" pseudo-role for /btw side questions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    User,
    Agent,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageVisibility {
    Visible,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAttachmentBrief {
    pub id: String,
    pub message_id: MessageId,
    pub session_id: SessionId,
    pub kind: String,
    pub path: String,
    pub mime_type: String,
    pub byte_size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub created_at: String,
}

/// Optional per-final-answer usage metadata. Token fields are present only
/// when the runner can collect them without mutating user-owned GA runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageTelemetry {
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

/// Summary of one persisted message. Full conversation rendering needs
/// more fields (tool calls, step telemetry, etc.); B1's read APIs surface
/// just enough for sidebar peek + agent CLI display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageBrief {
    pub id: MessageId,
    pub session_id: SessionId,
    pub role: MessageRole,
    pub content: String,
    /// Final answer produced by the runner when available. Assistant
    /// messages can have intermediate step content before this lands.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_answer: Option<String>,
    /// ISO 8601.
    pub created_at: String,
    /// One-line digest produced by the runner at turn_end; falls back
    /// to the first line of content when absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Turn index this message belongs to (the user_message that started
    /// the agent loop). Useful for grouping replies.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<MessageVisibility>,
    /// Goal this row belongs to (`messages.goal_id`, migration 031): the
    /// objective turn that opened a goal carries its id, so frontends
    /// bracket the goal episode by exact id. Additive (v0.4.17+).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goal_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<MessageAttachmentBrief>,
    /// Where this message came from (B2 M5+). Optional on read APIs to
    /// keep backward-compatible JSON shape; always present on
    /// `send_message` responses.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
    /// The question this agent row put to the user through `ask_user`,
    /// derived on read from the persisted `tool_calls` JSON
    /// ([`AskUserBrief::from_tool_calls_json`]). Absent on every other
    /// row. Additive (2026-10-01, galley#30): `live.askPending` says a
    /// question is waiting, this says what it is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask_user: Option<AskUserBrief>,
}

/// One `ask_user` question with every candidate answer offered
/// ([`MessageBrief::ask_user`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskUserBrief {
    pub question: String,
    pub candidates: Vec<String>,
}

impl AskUserBrief {
    /// The one question a persisted `tool_calls` array asks, or `None`.
    ///
    /// Mirrors the bridge's merge rule (`runner/workbench_bridge.py`
    /// `_extract_ask_user`) and the GUI's read-side copy of it
    /// (`gui/src/lib/ask-user-candidates.ts` `mergedAskUserArgs`). Some
    /// models (grok-4.6, 2026-09-14) split one ask_user into N parallel
    /// calls, same question, one candidate each. GA serves only the
    /// first call, so the first call's question wins; later calls whose
    /// trimmed question matches merge their candidates in order,
    /// deduplicated; a call with a different question is a separate ask
    /// GA never served and is ignored.
    ///
    /// The persisted shape is the bridge's `TurnEndEvent.toolCalls`
    /// stored verbatim by the GUI: `[{"toolName": "...", "args": {...}}]`.
    /// Read-side only and never an error: JSON that is not an array, or
    /// a first ask_user call without a string `question`, yields `None`.
    pub fn from_tool_calls_json(raw: &str) -> Option<Self> {
        let calls: Vec<serde_json::Value> = serde_json::from_str(raw).ok()?;
        let mut question: Option<String> = None;
        let mut candidates: Vec<String> = Vec::new();
        for call in &calls {
            if call.get("toolName").and_then(|v| v.as_str()) != Some("ask_user") {
                continue;
            }
            let args = call.get("args");
            let Some(q) = args
                .and_then(|a| a.get("question"))
                .and_then(|v| v.as_str())
            else {
                // Without a question there is nothing to show. On the
                // first call that is the whole ask; later, skip the call.
                if question.is_none() {
                    return None;
                }
                continue;
            };
            match &question {
                None => question = Some(q.to_string()),
                Some(first) if first.trim() != q.trim() => continue,
                Some(_) => {}
            }
            for c in candidate_list(args.and_then(|a| a.get("candidates"))) {
                if !candidates.contains(&c) {
                    candidates.push(c);
                }
            }
        }
        question.map(|question| AskUserBrief {
            question,
            candidates,
        })
    }
}

/// Coerce an ask_user `candidates` arg to strings (bridge
/// `_candidate_list`): absent / null → none; a bare string is one
/// candidate (never split into characters), none if empty; an array maps
/// each item to text; any other value is one candidate. Non-string items
/// render as JSON text (`5`, `true`, `null`).
fn candidate_list(raw: Option<&serde_json::Value>) -> Vec<String> {
    use serde_json::Value;
    fn text(v: &Value) -> String {
        match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        }
    }
    match raw {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::String(s)) if s.is_empty() => Vec::new(),
        Some(Value::Array(items)) => items.iter().map(text).collect(),
        Some(other) => vec![text(other)],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask(raw: serde_json::Value) -> Option<AskUserBrief> {
        AskUserBrief::from_tool_calls_json(&raw.to_string())
    }

    fn brief(question: &str, candidates: &[&str]) -> Option<AskUserBrief> {
        Some(AskUserBrief {
            question: question.into(),
            candidates: candidates.iter().map(|c| c.to_string()).collect(),
        })
    }

    #[test]
    fn single_ask_user_call() {
        // Shape copied from a real persisted row (workbench.db, 2026-10-01).
        let raw =
            r#"[{"args":{"candidates":["A","B"],"question":"Which one?"},"toolName":"ask_user"}]"#;
        assert_eq!(
            AskUserBrief::from_tool_calls_json(raw),
            brief("Which one?", &["A", "B"])
        );
    }

    #[test]
    fn split_same_question_calls_merge_in_order_deduplicated() {
        // grok-4.6 style: one candidate per call, the question repeated
        // (here once with stray whitespace, which still matches).
        let raw = serde_json::json!([
            {"toolName": "ask_user", "args": {"question": "Pick", "candidates": ["A"]}},
            {"toolName": "code_run", "args": {"code": "print(1)"}},
            {"toolName": "ask_user", "args": {"question": " Pick ", "candidates": ["B"]}},
            {"toolName": "ask_user", "args": {"question": "Pick", "candidates": ["A", "C"]}},
        ]);
        assert_eq!(ask(raw), brief("Pick", &["A", "B", "C"]));
    }

    #[test]
    fn a_different_second_question_is_ignored() {
        let raw = serde_json::json!([
            {"toolName": "ask_user", "args": {"question": "First?", "candidates": ["A"]}},
            {"toolName": "ask_user", "args": {"question": "Second?", "candidates": ["B"]}},
        ]);
        assert_eq!(ask(raw), brief("First?", &["A"]));
    }

    #[test]
    fn no_ask_user_call_means_absent() {
        let raw = serde_json::json!([
            {"toolName": "file_read", "args": {"path": "a.txt"}},
        ]);
        assert_eq!(ask(raw), None);
        assert_eq!(ask(serde_json::json!([])), None);
    }

    #[test]
    fn malformed_json_or_args_means_absent() {
        assert_eq!(AskUserBrief::from_tool_calls_json("not json"), None);
        assert_eq!(AskUserBrief::from_tool_calls_json(""), None);
        assert_eq!(
            AskUserBrief::from_tool_calls_json(r#"{"toolName":"ask_user"}"#),
            None
        );
        // The asking call has no usable question.
        assert_eq!(ask(serde_json::json!([{"toolName": "ask_user"}])), None);
        assert_eq!(
            ask(serde_json::json!([{"toolName": "ask_user", "args": "Pick?"}])),
            None
        );
        assert_eq!(
            ask(serde_json::json!([{"toolName": "ask_user", "args": {"question": 5}}])),
            None
        );
        // A later malformed call is skipped; the first ask stands.
        let raw = serde_json::json!([
            {"toolName": "ask_user", "args": {"question": "Pick", "candidates": ["A"]}},
            {"toolName": "ask_user", "args": {"candidates": ["B"]}},
            "garbage",
        ]);
        assert_eq!(ask(raw), brief("Pick", &["A"]));
    }

    #[test]
    fn candidates_absent_or_odd_shapes() {
        let only_question = serde_json::json!([
            {"toolName": "ask_user", "args": {"question": "Free-form?"}},
        ]);
        assert_eq!(ask(only_question), brief("Free-form?", &[]));
        let null = serde_json::json!([
            {"toolName": "ask_user", "args": {"question": "Q", "candidates": null}},
        ]);
        assert_eq!(ask(null), brief("Q", &[]));
        // A bare string is one candidate, not a list of characters.
        let bare = serde_json::json!([
            {"toolName": "ask_user", "args": {"question": "Q", "candidates": "yes"}},
        ]);
        assert_eq!(ask(bare), brief("Q", &["yes"]));
        let empty = serde_json::json!([
            {"toolName": "ask_user", "args": {"question": "Q", "candidates": ""}},
        ]);
        assert_eq!(ask(empty), brief("Q", &[]));
        let mixed = serde_json::json!([
            {"toolName": "ask_user", "args": {"question": "Q", "candidates": ["a", 5, true]}},
        ]);
        assert_eq!(ask(mixed), brief("Q", &["a", "5", "true"]));
    }

    #[test]
    fn ask_user_field_is_omitted_when_absent() {
        let mut message = MessageBrief {
            id: MessageId("m".into()),
            session_id: SessionId("s".into()),
            role: MessageRole::Agent,
            content: "c".into(),
            final_answer: None,
            created_at: "2026-10-01T00:00:00Z".into(),
            summary: None,
            turn_index: Some(1),
            visibility: None,
            goal_id: None,
            attachments: Vec::new(),
            origin: None,
            ask_user: None,
        };
        let value = serde_json::to_value(&message).unwrap();
        assert!(value.get("askUser").is_none());
        message.ask_user = brief("Q", &["A"]);
        let value = serde_json::to_value(&message).unwrap();
        assert_eq!(
            value["askUser"],
            serde_json::json!({"question": "Q", "candidates": ["A"]})
        );
    }
}
