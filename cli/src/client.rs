//! Typed socket client — the CLI's single deep module for talking to
//! Galley Core.
//!
//! Everything protocol-shaped lives behind [`SocketClient::call`] /
//! [`SocketClient::open_watch`]: request-envelope encoding, response
//! parsing, and error-tag → [`GalleyError`] mapping. Command names and
//! argument shapes come from `galley_core_lib::protocol` (the shared
//! schemaVersion 1 home) via [`SocketCommand`] — a call site can neither
//! misspell a field name nor pair a command name with the wrong args.
//!
//! The [`Transport`] seam sits at the string-line level (NDJSON in/out,
//! zero JSON knowledge), so tests replay canned lines — including
//! malformed ones the real Core would never send — without a live socket.

use crate::transport::{open_watch_lines_raw, socket_send_recv, WatchLines};
use galley_core_lib::error::GalleyError;
use galley_core_lib::protocol::{
    ErrorTag, SessionWatchArgs, SocketCommand, SocketRequest, SocketResponse, WatchFrame,
    SCHEMA_VERSION,
};
use serde_json::Value;

/// String-line transport seam. The real adapter owns connect / retry /
/// timeout against the Unix socket or named pipe; the fake adapter in
/// tests replays canned lines.
pub(crate) trait Transport {
    async fn round_trip(&self, line: String) -> Result<String, GalleyError>;
    async fn open_stream(&self, line: String) -> Result<WatchLines, GalleyError>;
}

/// Production transport: Unix socket / Windows named pipe, with the
/// connect-timeout and pipe-busy retry policy in `crate::transport`.
pub(crate) struct RealTransport;

impl Transport for RealTransport {
    async fn round_trip(&self, line: String) -> Result<String, GalleyError> {
        socket_send_recv(line).await
    }
    async fn open_stream(&self, line: String) -> Result<WatchLines, GalleyError> {
        open_watch_lines_raw(line).await
    }
}

pub(crate) struct SocketClient<T: Transport> {
    transport: T,
}

/// The client every command handler uses.
pub(crate) fn client() -> SocketClient<RealTransport> {
    SocketClient {
        transport: RealTransport,
    }
}

impl<T: Transport> SocketClient<T> {
    #[cfg(test)]
    pub(crate) fn with_transport(transport: T) -> Self {
        Self { transport }
    }

    /// One unary command round-trip. Returns the envelope's `result`
    /// verbatim (`Value`, deliberately untyped): the CLI's output contract
    /// is to print `result` as-is, and deserializing into a struct would
    /// silently drop additively-added server fields — the opposite of
    /// schemaVersion 1's evolution rule.
    pub(crate) async fn call<C: SocketCommand>(&self, args: C) -> Result<Value, GalleyError> {
        let req = SocketRequest {
            command: C::NAME.to_string(),
            args: serde_json::to_value(&args).map_err(|e| GalleyError::Internal {
                message: format!("serialize {} args: {e}", C::NAME),
            })?,
            request_id: None,
            schema_version: SCHEMA_VERSION,
        };
        let line = serde_json::to_string(&req).map_err(|e| GalleyError::Internal {
            message: format!("serialize {} request: {e}", C::NAME),
        })?;
        let resp_line = self.transport.round_trip(line).await?;
        let resp: SocketResponse =
            serde_json::from_str(&resp_line).map_err(|e| GalleyError::Internal {
                message: format!("malformed socket response: {e}"),
            })?;
        if resp.ok {
            Ok(resp.result.unwrap_or(Value::Null))
        } else {
            let tag = ErrorTag::from_wire(resp.error.as_deref().unwrap_or("internal"));
            Err(galley_error_for_tag(tag, resp.message.unwrap_or_default()))
        }
    }

    /// Open a `session.watch` subscription. Returns the raw line stream;
    /// callers classify each line with [`WatchFrame::parse`] and apply
    /// their own policy to the degenerate variants (see `WatchFrame` docs).
    pub(crate) async fn open_watch(&self, session_id: &str) -> Result<WatchLines, GalleyError> {
        let args = SessionWatchArgs {
            session_id: session_id.to_string(),
        };
        let req = SocketRequest {
            command: SessionWatchArgs::NAME.to_string(),
            args: serde_json::to_value(&args).map_err(|e| GalleyError::Internal {
                message: format!("serialize session.watch args: {e}"),
            })?,
            request_id: None,
            schema_version: SCHEMA_VERSION,
        };
        let line = serde_json::to_string(&req).map_err(|e| GalleyError::Internal {
            message: format!("serialize session.watch request: {e}"),
        })?;
        self.transport.open_stream(line).await
    }
}

/// One-shot unary call returning the `result` payload.
pub(crate) async fn call_value<C: SocketCommand>(args: C) -> Result<Value, GalleyError> {
    client().call(args).await
}

/// One-shot unary call that prints the `result` payload to stdout —
/// the shape every plain write command emits for agents.
pub(crate) async fn call_print<C: SocketCommand>(args: C) -> Result<(), GalleyError> {
    let result = client().call(args).await?;
    println!("{result}");
    Ok(())
}

/// Read + classify the next watch frame under the STRICT policy: an
/// `Unparseable` line is an internal error. This is the programmatic-
/// consumer path (`session follow`, goal loops). `galley session watch`
/// deliberately does NOT use this — it passes raw lines through so agents
/// can stream-parse the NDJSON themselves.
pub(crate) async fn next_watch_frame_strict(
    watch: &mut WatchLines,
) -> Result<Option<WatchFrame>, GalleyError> {
    let Some(line) = watch
        .next_line()
        .await
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("watch read: {e}"),
        })?
    else {
        return Ok(None);
    };
    match WatchFrame::parse(&line) {
        WatchFrame::Unparseable(raw) => Err(GalleyError::Internal {
            message: format!("malformed watch frame: {raw}"),
        }),
        WatchFrame::Error { tag, message } => Err(galley_error_for_tag(tag, message)),
        frame => Ok(Some(frame)),
    }
}

/// Map a wire [`ErrorTag`] onto the CLI's typed error so `exit_code_for`
/// lands on the documented exit category
/// (docs/agent-api/stability-and-versioning.md §2/§2A/§3).
///
/// Deliberately exhaustive — no `_` arm. When Core grows a new tag, this
/// match stops compiling until the new variant is mapped, instead of the
/// tag silently landing in the exit-1 bucket at runtime. `Other` is the
/// runtime forward-compat path (older CLI, newer Core) and keeps the
/// documented exit-1 collapse.
pub(crate) fn galley_error_for_tag(tag: ErrorTag, message: String) -> GalleyError {
    match tag {
        ErrorTag::NotFound => GalleyError::NotFound { message },
        ErrorTag::InvalidArgs => GalleyError::InvalidArgs { message },
        ErrorTag::DbUnavailable => GalleyError::DbUnavailable { message },
        ErrorTag::RunnerError
        | ErrorTag::PythonNotFound
        | ErrorTag::GaPathInvalid
        | ErrorTag::ManagedRuntimeInvalid
        | ErrorTag::ManagedModelNotConfigured
        | ErrorTag::BridgeCwdInvalid
        | ErrorTag::PathEncoding
        | ErrorTag::SpawnIo
        | ErrorTag::PipeUnavailable => GalleyError::RunnerError { message },
        // Transport/protocol-level failures collapse to internal / exit 1
        // by documented design (stability-and-versioning.md §2A).
        ErrorTag::SchemaMismatch
        | ErrorTag::UnknownCommand
        | ErrorTag::AppUnavailable
        | ErrorTag::IdleTimeout
        | ErrorTag::Internal
        | ErrorTag::Other(_) => GalleyError::Internal { message },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use galley_core_lib::protocol::SessionSendArgs;
    use std::sync::Mutex;

    /// Canned-line fake: `round_trip` pops the next queued response line
    /// and records the request line it was sent.
    struct FakeTransport {
        responses: Mutex<Vec<String>>,
        sent: Mutex<Vec<String>>,
    }

    impl FakeTransport {
        fn replying(lines: &[&str]) -> Self {
            Self {
                responses: Mutex::new(lines.iter().rev().map(|s| s.to_string()).collect()),
                sent: Mutex::new(Vec::new()),
            }
        }
    }

    impl Transport for FakeTransport {
        async fn round_trip(&self, line: String) -> Result<String, GalleyError> {
            self.sent.lock().unwrap().push(line);
            self.responses
                .lock()
                .unwrap()
                .pop()
                .ok_or_else(|| GalleyError::Internal {
                    message: "fake transport: no canned response left".into(),
                })
        }
        async fn open_stream(&self, _line: String) -> Result<WatchLines, GalleyError> {
            unimplemented!("unary tests only")
        }
    }

    fn send_args() -> SessionSendArgs {
        SessionSendArgs {
            session_id: "s1".into(),
            content: "hello".into(),
            supervisor: None,
            reason: None,
        }
    }

    #[tokio::test]
    async fn call_success_returns_result_verbatim_and_sends_typed_request() {
        let fake = FakeTransport::replying(&[
            r#"{"ok":true,"result":{"sessionId":"s1","futureField":42}}"#,
        ]);
        let client = SocketClient::with_transport(fake);
        let result = client.call(send_args()).await.unwrap();
        // Additive server fields must survive verbatim (no typed-result
        // round-trip that would drop them).
        assert_eq!(result["futureField"], 42);
        let sent = client.transport.sent.lock().unwrap();
        let req: serde_json::Value = serde_json::from_str(&sent[0]).unwrap();
        assert_eq!(req["command"], "session.send");
        assert_eq!(req["schemaVersion"], 1);
        assert_eq!(req["args"]["sessionId"], "s1");
    }

    #[tokio::test]
    async fn call_maps_error_tags_to_exit_code_classes() {
        for (tag, want_class) in [
            ("not_found", "not_found"),
            ("invalid_args", "invalid_args"),
            ("db_unavailable", "db_unavailable"),
            ("python_not_found", "runner_error"),
            ("unknown_command", "internal"),
            ("some_future_tag", "internal"),
        ] {
            let fake = FakeTransport::replying(&[&format!(
                r#"{{"ok":false,"error":"{tag}","message":"m"}}"#
            )]);
            let client = SocketClient::with_transport(fake);
            let err = client.call(send_args()).await.unwrap_err();
            let got = match err {
                GalleyError::NotFound { .. } => "not_found",
                GalleyError::InvalidArgs { .. } => "invalid_args",
                GalleyError::DbUnavailable { .. } => "db_unavailable",
                GalleyError::RunnerError { .. } => "runner_error",
                GalleyError::Internal { .. } => "internal",
            };
            assert_eq!(got, want_class, "tag {tag}");
        }
    }

    #[tokio::test]
    async fn call_rejects_malformed_response_as_internal() {
        let fake = FakeTransport::replying(&["this is not json {"]);
        let client = SocketClient::with_transport(fake);
        let err = client.call(send_args()).await.unwrap_err();
        assert!(matches!(err, GalleyError::Internal { .. }));
    }

    #[tokio::test]
    async fn call_treats_missing_ok_as_error_envelope() {
        // Legacy parser semantics: no `ok:true` → error branch with the
        // `internal` default tag.
        let fake = FakeTransport::replying(&[r#"{"result":{"x":1}}"#]);
        let client = SocketClient::with_transport(fake);
        let err = client.call(send_args()).await.unwrap_err();
        assert!(matches!(err, GalleyError::Internal { .. }));
    }

    #[tokio::test]
    async fn strict_frame_reader_flags_unparseable_and_maps_errors() {
        let mut watch = WatchLines::from_canned_lines(&[
            r#"{"stream":"event","data":{"type":"turn_end"}}"#,
            r#"{"stream":"end","reason":"subprocess_exited"}"#,
        ]);
        let f1 = next_watch_frame_strict(&mut watch).await.unwrap().unwrap();
        assert!(matches!(f1, WatchFrame::Event(_)));
        let f2 = next_watch_frame_strict(&mut watch).await.unwrap().unwrap();
        let WatchFrame::End(reason) = f2 else {
            panic!("expected End");
        };
        assert_eq!(reason, "subprocess_exited");

        let mut bad = WatchLines::from_canned_lines(&["not json {"]);
        let err = next_watch_frame_strict(&mut bad).await.unwrap_err();
        assert!(matches!(err, GalleyError::Internal { .. }));

        let mut not_found = WatchLines::from_canned_lines(&[
            r#"{"ok":false,"error":"not_found","message":"no session"}"#,
        ]);
        let err = next_watch_frame_strict(&mut not_found).await.unwrap_err();
        assert!(matches!(err, GalleyError::NotFound { .. }));
    }
}
