//! End-to-end app protocol (design §6): JSON messages inside the Noise
//! session, one per `APP` record ([`crate::noise::Record::App`]), larger
//! ones split into `chunk`s ([`chunk`]).
//!
//! Envelope (design §6.1), discriminated by `t`:
//!
//! ```text
//! {"t":"req","id":7,"m":"session.send","p":{...}}
//! {"t":"res","id":7,"ok":true,"r":{...}}
//! {"t":"res","id":7,"ok":false,"e":{"code":"images_not_queueable","message":"..."}}
//! {"t":"evt","n":"session.updated","p":{...}}
//! {"t":"chunk","id":3,"i":0,"last":false,"data":"<base64>"}
//! ```
//!
//! Compatibility within a protocol major ([`PROTOCOL_VERSION`]): fields
//! and methods are only added. A decoder ignores unknown fields and
//! unknown events; an unknown method is answered with
//! [`error_code::UNKNOWN_METHOD`]; an unknown enum value decodes as that
//! enum's `Unknown`. Majors that differ end the session (design §6.2).
//!
//! The types in [`types`], [`methods`] and [`events`] are the phone's own
//! (camelCase), not Core's: Core converts into them (ticket 05b), so a
//! change to a Core type cannot reach the phone by accident. `Option`
//! fields are written as explicit `null` (02d's rule: a cleared field
//! must not look like an absent one) and read back from `null` or absent.

use std::fmt;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub mod chunk;
pub mod events;
pub mod methods;
pub mod types;

pub use events::*;
pub use methods::*;
pub use types::*;

/// App protocol version: `{major, minor}`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ProtocolVersion {
    pub major: u32,
    pub minor: u32,
}

impl ProtocolVersion {
    /// Same major: the two ends can talk (design §6.2).
    pub fn is_compatible_with(&self, other: &ProtocolVersion) -> bool {
        self.major == other.major
    }
}

/// The version this crate speaks.
pub const PROTOCOL_VERSION: ProtocolVersion = ProtocolVersion { major: 1, minor: 0 };

/// Error codes of `res` messages. Core's own stable labels pass through
/// unchanged (the `GalleyError` tags, the send path's tags, the runner
/// families); a phone treats a code it does not know as a generic failure
/// and shows `message`.
pub mod error_code {
    /// The method is not one this end knows.
    pub const UNKNOWN_METHOD: &str = "unknown_method";
    /// `p` does not fit the method's params.
    pub const INVALID_PARAMS: &str = "invalid_params";
    /// The `hello` majors differ; the session is closed after this.
    pub const PROTOCOL_MISMATCH: &str = "protocol_mismatch";
    /// `GalleyError` tags (`core/src/error.rs`).
    pub const NOT_FOUND: &str = "not_found";
    pub const INVALID_ARGS: &str = "invalid_args";
    pub const DB_UNAVAILABLE: &str = "db_unavailable";
    pub const RUNNER_ERROR: &str = "runner_error";
    pub const INTERNAL: &str = "internal";
    /// Send path tags (`core/src/session_send.rs`, `SendError::tag`).
    pub const IMAGES_NOT_SUPPORTED: &str = "images_not_supported";
    pub const IMAGES_NOT_QUEUEABLE: &str = "images_not_queueable";
    pub const IMAGES_NOT_ALLOWED: &str = "images_not_allowed";
    pub const DISPATCH_FAILED: &str = "dispatch_failed";
    /// A runner could not take the session's history.
    pub const HISTORY_REPLAY: &str = "history_replay";
}

/// The `e` of a failed `res`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ErrorBody {
    /// A stable label ([`error_code`]).
    pub code: String,
    /// Human-readable detail.
    #[serde(default)]
    pub message: String,
}

impl ErrorBody {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }

    pub fn unknown_method(method: &str) -> Self {
        Self::new(
            error_code::UNKNOWN_METHOD,
            format!("unknown method {method:?}"),
        )
    }
}

/// Why bytes are not a valid app message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppError {
    /// Not JSON, or a field of the wrong type.
    Json(String),
    /// A `t` this version does not know.
    UnknownType(String),
    MissingField {
        message_type: &'static str,
        field: &'static str,
    },
    /// Fields that contradict each other (`ok: true` with `e`, …).
    Inconsistent(&'static str),
    /// A chunk out of order, empty, too large, not base64, or wrapping
    /// another chunk.
    BadChunk(&'static str),
    /// A message larger than the reassembly limit.
    TooLarge { limit: usize },
    /// More chunked messages in flight than allowed.
    TooManyStreams { limit: usize },
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Json(e) => write!(f, "bad app message JSON: {e}"),
            AppError::UnknownType(t) => write!(f, "unknown app message type {t:?}"),
            AppError::MissingField {
                message_type,
                field,
            } => write!(f, "{message_type} message without {field}"),
            AppError::Inconsistent(what) => write!(f, "inconsistent app message: {what}"),
            AppError::BadChunk(what) => write!(f, "bad chunk: {what}"),
            AppError::TooLarge { limit } => write!(f, "app message exceeds {limit} bytes"),
            AppError::TooManyStreams { limit } => {
                write!(f, "more than {limit} chunked messages in flight")
            }
        }
    }
}

impl std::error::Error for AppError {}

/// A method: its wire name and its params / result types.
pub trait Method {
    const NAME: &'static str;
    type Params: Serialize + DeserializeOwned;
    type Result: Serialize + DeserializeOwned;
}

/// `{"t":"req"}`.
#[derive(Debug, Clone, PartialEq)]
pub struct Request {
    pub id: u64,
    pub method: String,
    /// Raw params; decode with [`Request::params`] or
    /// [`methods::ClientRequest::from_request`].
    pub params: Value,
}

/// `{"t":"res"}`: `Ok(r)` for `ok: true`, `Err(e)` for `ok: false`.
#[derive(Debug, Clone, PartialEq)]
pub struct Response {
    pub id: u64,
    pub outcome: Result<Value, ErrorBody>,
}

/// `{"t":"evt"}`.
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    pub name: String,
    pub payload: Value,
}

/// `{"t":"chunk"}`: piece `index` of the message `id` (a sender-local
/// stream id, not a request id); `data` is base64 on the wire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub id: u64,
    pub index: u32,
    pub last: bool,
    pub data: Vec<u8>,
}

/// One app message.
#[derive(Debug, Clone, PartialEq)]
pub enum Envelope {
    Request(Request),
    Response(Response),
    Event(Event),
    Chunk(Chunk),
}

/// Every envelope field; `t` decides which must be there. Field order is
/// the wire order.
#[derive(Serialize, Deserialize)]
struct Wire {
    t: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    m: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    n: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ok: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    p: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    r: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    e: Option<ErrorBody>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    i: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    data: Option<String>,
}

impl Wire {
    fn new(t: &str) -> Self {
        Self {
            t: t.to_string(),
            id: None,
            m: None,
            n: None,
            ok: None,
            p: None,
            r: None,
            e: None,
            i: None,
            last: None,
            data: None,
        }
    }
}

fn empty_object() -> Value {
    Value::Object(serde_json::Map::new())
}

/// Serialize an app type. Everything here is plain data (string keys, no
/// floats), so this cannot fail.
pub(crate) fn to_value<T: Serialize>(value: &T) -> Value {
    serde_json::to_value(value).expect("app protocol types always serialize")
}

impl Envelope {
    /// The JSON bytes of this message.
    pub fn to_json(&self) -> Vec<u8> {
        let wire = match self {
            Envelope::Request(req) => Wire {
                id: Some(req.id),
                m: Some(req.method.clone()),
                p: Some(req.params.clone()),
                ..Wire::new("req")
            },
            Envelope::Response(res) => {
                let mut wire = Wire {
                    id: Some(res.id),
                    ok: Some(res.outcome.is_ok()),
                    ..Wire::new("res")
                };
                match &res.outcome {
                    Ok(r) => wire.r = Some(r.clone()),
                    Err(e) => wire.e = Some(e.clone()),
                }
                wire
            }
            Envelope::Event(evt) => Wire {
                n: Some(evt.name.clone()),
                p: Some(evt.payload.clone()),
                ..Wire::new("evt")
            },
            Envelope::Chunk(chunk) => Wire {
                id: Some(chunk.id),
                i: Some(chunk.index),
                last: Some(chunk.last),
                data: Some(STANDARD.encode(&chunk.data)),
                ..Wire::new("chunk")
            },
        };
        serde_json::to_vec(&wire).expect("app envelopes always serialize")
    }

    /// Strict decode of one message. Unknown fields are ignored; a missing
    /// `p` reads as `{}`.
    pub fn from_json(bytes: &[u8]) -> Result<Envelope, AppError> {
        let wire: Wire =
            serde_json::from_slice(bytes).map_err(|e| AppError::Json(e.to_string()))?;
        let missing = |message_type: &'static str, field: &'static str| AppError::MissingField {
            message_type,
            field,
        };
        match wire.t.as_str() {
            "req" => Ok(Envelope::Request(Request {
                id: wire.id.ok_or(missing("req", "id"))?,
                method: wire.m.ok_or(missing("req", "m"))?,
                params: wire.p.unwrap_or_else(empty_object),
            })),
            "res" => {
                let id = wire.id.ok_or(missing("res", "id"))?;
                let outcome = match (wire.ok.ok_or(missing("res", "ok"))?, wire.r, wire.e) {
                    (true, Some(r), None) => Ok(r),
                    (false, None, Some(e)) => Err(e),
                    (true, None, _) => return Err(missing("res", "r")),
                    (false, _, None) => return Err(missing("res", "e")),
                    (true, Some(_), Some(_)) => return Err(AppError::Inconsistent("ok with e")),
                    (false, Some(_), Some(_)) => {
                        return Err(AppError::Inconsistent("error with r"))
                    }
                };
                Ok(Envelope::Response(Response { id, outcome }))
            }
            "evt" => Ok(Envelope::Event(Event {
                name: wire.n.ok_or(missing("evt", "n"))?,
                payload: wire.p.unwrap_or_else(empty_object),
            })),
            "chunk" => {
                let data = wire.data.ok_or(missing("chunk", "data"))?;
                Ok(Envelope::Chunk(Chunk {
                    id: wire.id.ok_or(missing("chunk", "id"))?,
                    index: wire.i.ok_or(missing("chunk", "i"))?,
                    last: wire.last.ok_or(missing("chunk", "last"))?,
                    data: STANDARD
                        .decode(data)
                        .map_err(|_| AppError::BadChunk("data is not base64"))?,
                }))
            }
            other => Err(AppError::UnknownType(other.to_string())),
        }
    }
}

impl Request {
    pub fn new<M: Method>(id: u64, params: &M::Params) -> Self {
        Self {
            id,
            method: M::NAME.to_string(),
            params: to_value(params),
        }
    }

    /// Typed params of method `M`; [`error_code::INVALID_PARAMS`] when they
    /// do not fit, [`error_code::UNKNOWN_METHOD`] when this is not `M`.
    pub fn params<M: Method>(&self) -> Result<M::Params, ErrorBody> {
        if self.method != M::NAME {
            return Err(ErrorBody::unknown_method(&self.method));
        }
        serde_json::from_value(self.params.clone())
            .map_err(|e| ErrorBody::new(error_code::INVALID_PARAMS, e.to_string()))
    }
}

impl Response {
    pub fn ok<M: Method>(id: u64, result: &M::Result) -> Self {
        Self {
            id,
            outcome: Ok(to_value(result)),
        }
    }

    pub fn error(id: u64, error: ErrorBody) -> Self {
        Self {
            id,
            outcome: Err(error),
        }
    }

    /// Typed result of method `M` (the caller knows which request `id`
    /// was): `Ok(Ok(result))`, `Ok(Err(error))`, or `Err` when `r` does
    /// not fit `M::Result`.
    pub fn result<M: Method>(&self) -> Result<Result<M::Result, ErrorBody>, AppError> {
        match &self.outcome {
            Ok(r) => serde_json::from_value(r.clone())
                .map(Ok)
                .map_err(|e| AppError::Json(e.to_string())),
            Err(e) => Ok(Err(e.clone())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(json: &str) -> Envelope {
        let env = Envelope::from_json(json.as_bytes()).unwrap();
        assert_eq!(Envelope::from_json(&env.to_json()).unwrap(), env);
        env
    }

    #[test]
    fn envelope_shapes_match_the_design() {
        let req = Envelope::Request(Request::new::<SessionStop>(
            7,
            &SessionIdParams {
                session_id: "s1".into(),
            },
        ));
        assert_eq!(
            String::from_utf8(req.to_json()).unwrap(),
            r#"{"t":"req","id":7,"m":"session.stop","p":{"sessionId":"s1"}}"#
        );
        let res = Envelope::Response(Response::error(
            7,
            ErrorBody::new(error_code::HISTORY_REPLAY, "..."),
        ));
        assert_eq!(
            String::from_utf8(res.to_json()).unwrap(),
            r#"{"t":"res","id":7,"ok":false,"e":{"code":"history_replay","message":"..."}}"#
        );
        let chunk = Envelope::Chunk(Chunk {
            id: 7,
            index: 0,
            last: false,
            data: b"hi".to_vec(),
        });
        assert_eq!(
            String::from_utf8(chunk.to_json()).unwrap(),
            r#"{"t":"chunk","id":7,"i":0,"last":false,"data":"aGk="}"#
        );
    }

    #[test]
    fn decoding_ignores_unknown_fields_and_defaults_p() {
        let env = round_trip(r#"{"t":"req","id":1,"m":"sessions.list","future":true}"#);
        let Envelope::Request(req) = env else {
            panic!("not a request")
        };
        assert_eq!(req.params, serde_json::json!({}));
        assert!(req.params::<SessionsList>().is_ok());
        round_trip(r#"{"t":"evt","n":"x.y","p":{"a":1},"extra":[1]}"#);
        round_trip(r#"{"t":"res","id":2,"ok":true,"r":{},"n":"ignored"}"#);
    }

    #[test]
    fn decoding_is_strict_about_required_fields() {
        let cases = [
            ("not json", "json"),
            (r#"{"id":1}"#, "json"),
            (r#"{"t":"push"}"#, "unknown"),
            (r#"{"t":"req","m":"hello"}"#, "missing"),
            (r#"{"t":"req","id":1}"#, "missing"),
            (r#"{"t":"req","id":-1,"m":"hello"}"#, "json"),
            (r#"{"t":"res","id":1,"r":{}}"#, "missing"),
            (r#"{"t":"res","id":1,"ok":true}"#, "missing"),
            (r#"{"t":"res","id":1,"ok":false,"r":{}}"#, "missing"),
            (
                r#"{"t":"res","id":1,"ok":true,"r":{},"e":{"code":"x"}}"#,
                "inconsistent",
            ),
            (r#"{"t":"evt","p":{}}"#, "missing"),
            (r#"{"t":"chunk","id":1,"i":0,"last":true}"#, "missing"),
            (
                r#"{"t":"chunk","id":1,"i":0,"last":true,"data":"@@"}"#,
                "chunk",
            ),
        ];
        for (json, kind) in cases {
            let err = Envelope::from_json(json.as_bytes()).unwrap_err();
            let ok = match kind {
                "json" => matches!(err, AppError::Json(_)),
                "unknown" => matches!(err, AppError::UnknownType(_)),
                "missing" => matches!(err, AppError::MissingField { .. }),
                "inconsistent" => matches!(err, AppError::Inconsistent(_)),
                "chunk" => matches!(err, AppError::BadChunk(_)),
                _ => false,
            };
            assert!(ok, "{json}: {err:?}");
        }
    }

    #[test]
    fn unknown_and_mismatched_methods() {
        let req = Request {
            id: 3,
            method: "session.fly".into(),
            params: serde_json::json!({}),
        };
        let err = ClientRequest::from_request(&req).unwrap_err();
        assert_eq!(err.code, error_code::UNKNOWN_METHOD);
        assert_eq!(
            req.params::<Hello>().unwrap_err().code,
            error_code::UNKNOWN_METHOD
        );
        let bad = Request {
            id: 4,
            method: "session.stop".into(),
            params: serde_json::json!({"sessionId": 5}),
        };
        assert_eq!(
            ClientRequest::from_request(&bad).unwrap_err().code,
            error_code::INVALID_PARAMS
        );
    }

    #[test]
    fn typed_results() {
        let res = Response::ok::<SessionStop>(
            9,
            &SessionStopResult {
                dispatch: StopDispatch::AlreadyStopped,
            },
        );
        assert_eq!(
            res.result::<SessionStop>().unwrap().unwrap().dispatch,
            StopDispatch::AlreadyStopped
        );
        let wrong = Response {
            id: 9,
            outcome: Ok(serde_json::json!({"dispatch": 1})),
        };
        assert!(wrong.result::<SessionStop>().is_err());
        let failed = Response::error(9, ErrorBody::new(error_code::NOT_FOUND, "gone"));
        assert_eq!(
            failed.result::<SessionStop>().unwrap().unwrap_err().code,
            "not_found"
        );
    }

    #[test]
    fn versions() {
        assert!(PROTOCOL_VERSION.is_compatible_with(&ProtocolVersion { major: 1, minor: 9 }));
        assert!(!PROTOCOL_VERSION.is_compatible_with(&ProtocolVersion { major: 2, minor: 0 }));
    }
}
