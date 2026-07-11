use super::ErrorTag;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Wire-level schema version. Stable across additive changes; bumped on
/// breaking schema changes (and old-version clients use `?schema=1` to opt
/// into legacy framing — same convention as [docs/agent-api.md]).
pub const SCHEMA_VERSION: u32 = 1;

/// One request line. The CLI serializes this; Core deserializes it.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketRequest {
    /// Dotted command name. Examples: `"sessions.list"`, `"session.send"`.
    /// Never hand-written on the send side — comes from
    /// [`super::SocketCommand::NAME`].
    pub command: String,
    /// Command-specific args. Each command's handler parses this further.
    #[serde(default)]
    pub args: Value,
    /// Client-chosen id for demuxing in mixed request/stream sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    /// Schema version the client expects. Server checks for compatibility.
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
}

fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}

/// One unary response line. Core serializes this; the CLI deserializes it.
/// `ok` carries `#[serde(default)]` so a degenerate frame without the
/// field lands on the error branch (matching the pre-typed parser, which
/// checked `parsed["ok"] == true`).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocketResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl SocketResponse {
    pub fn ok(request_id: Option<String>, result: Value) -> Self {
        Self {
            ok: true,
            request_id,
            result: Some(result),
            error: None,
            message: None,
        }
    }

    pub fn err(request_id: Option<String>, error: ErrorTag, message: impl Into<String>) -> Self {
        Self {
            ok: false,
            request_id,
            result: None,
            error: Some(error.as_wire().to_string()),
            message: Some(message.into()),
        }
    }
}

/// One stream frame on a watch subscription, producer side. Serialize-only:
/// the consumer side is [`WatchFrame::parse`], which stays `Value`-based so
/// unknown future frame kinds degrade to pass-through events instead of
/// parse errors (frozen lenient behavior).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEnvelope {
    stream: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl StreamEnvelope {
    pub fn event(request_id: Option<String>, data: Value) -> Self {
        Self {
            stream: "event",
            request_id,
            data: Some(data),
            reason: None,
        }
    }
    pub fn end(request_id: Option<String>, reason: &str) -> Self {
        Self {
            stream: "end",
            request_id,
            data: None,
            reason: Some(reason.to_string()),
        }
    }
}

/// Classified stream frame, consumer side. `parse` is the ONLY stream-line
/// parser — policy toward the degenerate variants belongs to each caller:
///
/// - `galley session watch` passes `Unparseable` raw lines through and
///   continues (agents stream-parse the NDJSON themselves; frozen
///   behavior).
/// - Programmatic consumers (`session follow`, goal loops) treat
///   `Unparseable` as an internal error.
///
/// Both policies are explicit at the call sites; neither is hidden in the
/// parser. See ADR-0002 for why contract-bound policy stays per-caller.
#[derive(Debug)]
pub enum WatchFrame {
    /// A `stream:"event"` frame's `data` — or, for forward compatibility,
    /// a whole well-formed frame of an unknown kind (frozen behavior:
    /// unknown kinds pass through as events).
    Event(Value),
    /// A `stream:"end"` frame; the payload is `reason`.
    End(String),
    /// An `ok:false` error envelope terminating the stream.
    Error { tag: ErrorTag, message: String },
    /// A line that is not valid JSON. Never produced by a healthy Core.
    Unparseable(String),
}

impl WatchFrame {
    pub fn parse(line: &str) -> WatchFrame {
        let Ok(parsed) = serde_json::from_str::<Value>(line) else {
            return WatchFrame::Unparseable(line.to_string());
        };
        if parsed["ok"] == Value::Bool(false) {
            let tag = ErrorTag::from_wire(parsed["error"].as_str().unwrap_or("internal"));
            let message = parsed["message"].as_str().unwrap_or("").to_string();
            return WatchFrame::Error { tag, message };
        }
        if parsed["stream"] == "end" {
            let reason = parsed["reason"]
                .as_str()
                .unwrap_or("subprocess_exited")
                .to_string();
            return WatchFrame::End(reason);
        }
        if parsed["stream"] == "event" {
            return WatchFrame::Event(parsed.get("data").cloned().unwrap_or(Value::Null));
        }
        WatchFrame::Event(parsed)
    }
}

/// Golden wire-shape snapshots, recorded BEFORE the protocol-module
/// migration (2026-07-11) against the then-current `socket_listener::wire`
/// types. These byte-exact strings are the schemaVersion 1 response
/// contract as served on that day; any edit that breaks one is a breaking
/// wire change and requires `schemaVersion: 2`. Requests are asserted at
/// `Value` level in [`super::commands`] (JSON object key order is not part
/// of the contract).
#[cfg(test)]
mod golden {
    use super::*;

    #[test]
    fn response_ok_with_request_id() {
        let r = SocketResponse::ok(Some("r1".into()), serde_json::json!({"pong": true}));
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            r#"{"ok":true,"requestId":"r1","result":{"pong":true}}"#
        );
    }

    #[test]
    fn response_ok_without_request_id_trims_field() {
        let r = SocketResponse::ok(None, serde_json::json!({"sessionId": "s1"}));
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            r#"{"ok":true,"result":{"sessionId":"s1"}}"#
        );
    }

    #[test]
    fn response_err_shape() {
        let r = SocketResponse::err(
            Some("r2".into()),
            ErrorTag::InvalidArgs,
            "session.send args: boom",
        );
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            r#"{"ok":false,"requestId":"r2","error":"invalid_args","message":"session.send args: boom"}"#
        );
    }

    #[test]
    fn response_err_without_request_id() {
        let r = SocketResponse::err(None, ErrorTag::DbUnavailable, "open: locked");
        assert_eq!(
            serde_json::to_string(&r).unwrap(),
            r#"{"ok":false,"error":"db_unavailable","message":"open: locked"}"#
        );
    }

    #[test]
    fn stream_event_shape() {
        let e = StreamEnvelope::event(Some("w1".into()), serde_json::json!({"type":"turn_end"}));
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"stream":"event","requestId":"w1","data":{"type":"turn_end"}}"#
        );
    }

    #[test]
    fn stream_end_shape() {
        let e = StreamEnvelope::end(None, "subprocess_exited");
        assert_eq!(
            serde_json::to_string(&e).unwrap(),
            r#"{"stream":"end","reason":"subprocess_exited"}"#
        );
    }

    #[test]
    fn request_shape_omits_absent_request_id() {
        let req = SocketRequest {
            command: "session.send".into(),
            args: serde_json::json!({"sessionId": "s1"}),
            request_id: None,
            schema_version: SCHEMA_VERSION,
        };
        assert_eq!(
            serde_json::to_string(&req).unwrap(),
            r#"{"command":"session.send","args":{"sessionId":"s1"},"schemaVersion":1}"#
        );
    }
}

#[cfg(test)]
mod watch_frame_tests {
    use super::*;

    #[test]
    fn classifies_event_frame() {
        let f = WatchFrame::parse(r#"{"stream":"event","data":{"type":"turn_end"}}"#);
        let WatchFrame::Event(data) = f else {
            panic!("expected Event, got {f:?}")
        };
        assert_eq!(data["type"], "turn_end");
    }

    #[test]
    fn classifies_end_frame_with_default_reason() {
        let f = WatchFrame::parse(r#"{"stream":"end"}"#);
        let WatchFrame::End(reason) = f else {
            panic!("expected End, got {f:?}")
        };
        assert_eq!(reason, "subprocess_exited");
    }

    #[test]
    fn classifies_error_envelope() {
        let f = WatchFrame::parse(r#"{"ok":false,"error":"not_found","message":"no session"}"#);
        let WatchFrame::Error { tag, message } = f else {
            panic!("expected Error, got {f:?}")
        };
        assert_eq!(tag, ErrorTag::NotFound);
        assert_eq!(message, "no session");
    }

    #[test]
    fn unknown_stream_kind_passes_through_as_event() {
        // Frozen forward-compat behavior: a future frame kind must reach
        // the agent as data, not crash the watcher.
        let f = WatchFrame::parse(r#"{"stream":"heartbeat","seq":7}"#);
        let WatchFrame::Event(data) = f else {
            panic!("expected Event pass-through, got {f:?}")
        };
        assert_eq!(data["stream"], "heartbeat");
    }

    #[test]
    fn malformed_line_is_unparseable_not_a_panic() {
        let f = WatchFrame::parse("not json at all {");
        let WatchFrame::Unparseable(raw) = f else {
            panic!("expected Unparseable, got {f:?}")
        };
        assert_eq!(raw, "not json at all {");
    }
}
