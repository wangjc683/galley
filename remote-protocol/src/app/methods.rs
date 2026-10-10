//! P0 methods (design §6.3): phone → Core requests.
//!
//! Each method is a unit type implementing [`Method`] (its wire name, its
//! params and result types); [`ClientRequest`] is the decoded request Core
//! dispatches on, with unknown methods answered `unknown_method`.

use serde::{Deserialize, Serialize};

use super::types::{Message, Project, Session, SessionRunState};
use super::{ErrorBody, Method, ProtocolVersion, Request};
use crate::frame::PushEnv;

/// `{}`: params of a method that takes none, result of one that returns
/// nothing.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Empty {}

/// `hello` params: the phone's first request (design §6.2).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloParams {
    pub protocol: ProtocolVersion,
    pub app_version: String,
}

/// Core's hello: the payload of Noise handshake message 2, and the result
/// of `hello`. A phone whose major differs shows which side to update and
/// disconnects; Core answers its `hello` with `protocol_mismatch` and
/// closes ([`crate::noise::CloseReason::VersionMismatch`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreHello {
    pub protocol: ProtocolVersion,
    /// Galley desktop version (`0.6.2`).
    pub core_version: String,
    pub desktop_name: String,
}

/// `sessions.list` result: everything the session list needs, in full
/// (no incremental form; deletions are hard deletes, design §6.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsListResult {
    /// Non-archived sessions of the managed runtime.
    pub sessions: Vec<Session>,
    /// All projects, for grouping.
    pub projects: Vec<Project>,
    /// Run state of every session whose state is not the idle default; a
    /// session missing here is idle.
    pub run_states: Vec<SessionRunState>,
}

/// Default page size of `session.messages`.
pub const MESSAGES_PAGE_DEFAULT: u32 = 50;
/// Largest page `session.messages` returns; larger `limit`s are clamped.
pub const MESSAGES_PAGE_MAX: u32 = 200;

/// `session.messages` params: a page of the newest visible rows older than
/// `before`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessagesParams {
    pub session_id: String,
    /// A message id from an earlier page; `null` for the tail.
    pub before: Option<String>,
    /// `null` for [`MESSAGES_PAGE_DEFAULT`]; clamped to
    /// [`MESSAGES_PAGE_MAX`].
    pub limit: Option<u32>,
}

/// `session.messages` result, oldest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessagesResult {
    pub messages: Vec<Message>,
    /// Older rows exist before the first one returned.
    pub has_more: bool,
}

/// At most this many images on one message (`core/src/commands/session.rs`).
pub const MAX_IMAGES_PER_MESSAGE: usize = 4;
/// Largest image, decoded.
pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
/// Largest total of one message's images, decoded.
pub const MAX_MESSAGE_IMAGE_BYTES: usize = 25 * 1024 * 1024;

/// One image of a send: PNG, JPEG or WebP, compressed on the phone first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageUpload {
    /// `image/png` | `image/jpeg` | `image/webp`.
    pub mime_type: String,
    /// Standard base64 of the image bytes.
    pub data: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// `session.send` params (Core `session_send::send_user_message`, sent as
/// `via = gui`, `client = ios`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSendParams {
    pub session_id: String,
    pub text: String,
    #[serde(default)]
    pub images: Vec<ImageUpload>,
    /// The phone's id for this send, echoed on `message.persisted` so the
    /// phone can match the row to its optimistic echo (02c's rule).
    pub client_request_id: Option<String>,
}

/// What a send did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SendOutcome {
    /// Persisted and handed to the runner.
    Dispatched,
    /// Waiting behind an open run (text only).
    Queued,
    /// A `/btw` side question: dispatched, not persisted.
    SideQuestion,
    #[serde(other)]
    Unknown,
}

/// Where a queued send sits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedPlacement {
    pub queue_id: String,
    /// 0-based within the session's queue.
    pub position: u32,
}

/// `session.send` result (Core `SendUserMessageResult` minus the runner's
/// pid).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSendResult {
    pub outcome: SendOutcome,
    /// The persisted row, on `dispatched`.
    pub message: Option<Message>,
    /// On `queued`.
    pub queue: Option<QueuedPlacement>,
}

/// Params naming one session: `session.stop`, `session.markRead`,
/// `session.subscribe`, `session.unsubscribe`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdParams {
    pub session_id: String,
}

/// What `session.stop` did (Core `StopOutcome`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopDispatch {
    AbortSent,
    AlreadyStopped,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStopResult {
    pub dispatch: StopDispatch,
}

/// `session.create` params. Core mints the id and fills the managed
/// runtime and the default model.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCreateParams {
    pub project_id: Option<String>,
    /// `null` for Core's default title.
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCreateResult {
    pub session: Session,
}

/// `attachment.read` params. Core reads only files under the session's
/// `conversation-attachments/` directory (design §6.3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentReadParams {
    pub session_id: String,
    pub attachment_id: String,
}

/// `attachment.read` result; usually larger than one record, so it
/// arrives chunked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentReadResult {
    pub attachment_id: String,
    pub mime_type: String,
    pub byte_size: u64,
    /// Standard base64 of the file.
    pub data: String,
}

/// `device.registerPush` params: the phone's APNs token for Core to keep
/// (prefs) and send pushes to. The relay never stores it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterPushParams {
    /// Device token as hex ([`crate::frame::device_token_from_hex`]).
    pub token: String,
    /// Sandbox for development builds.
    pub env: PushEnv,
}

macro_rules! methods {
    ($( $(#[$doc:meta])* $method:ident = $name:literal ($params:ty => $result:ty); )*) => {
        $(
            $(#[$doc])*
            #[derive(Debug, Clone, Copy, PartialEq, Eq)]
            pub struct $method;

            impl Method for $method {
                const NAME: &'static str = $name;
                type Params = $params;
                type Result = $result;
            }
        )*

        /// Every P0 method name, in the design's order.
        pub const METHODS: &[&str] = &[$($name),*];

        /// A decoded request, one variant per method.
        #[derive(Debug, Clone, PartialEq)]
        pub enum ClientRequest {
            $( $method($params), )*
        }

        impl ClientRequest {
            pub fn method(&self) -> &'static str {
                match self {
                    $( ClientRequest::$method(_) => $name, )*
                }
            }

            /// Decode `req`'s params by its method. The error is the `e`
            /// to answer with: `unknown_method` or `invalid_params`.
            pub fn from_request(req: &Request) -> Result<Self, ErrorBody> {
                match req.method.as_str() {
                    $( $name => req.params::<$method>().map(ClientRequest::$method), )*
                    other => Err(ErrorBody::unknown_method(other)),
                }
            }

            pub fn to_request(&self, id: u64) -> Request {
                match self {
                    $( ClientRequest::$method(params) => Request::new::<$method>(id, params), )*
                }
            }
        }
    };
}

methods! {
    /// Version handshake (design §6.2).
    Hello = "hello" (HelloParams => CoreHello);
    /// The whole session list with projects and run states.
    SessionsList = "sessions.list" (Empty => SessionsListResult);
    /// A page of a session's messages.
    SessionMessages = "session.messages" (SessionMessagesParams => SessionMessagesResult);
    /// Send a user message (text, images).
    SessionSend = "session.send" (SessionSendParams => SessionSendResult);
    /// Stop the session's run.
    SessionStop = "session.stop" (SessionIdParams => SessionStopResult);
    /// Create a session.
    SessionCreate = "session.create" (SessionCreateParams => SessionCreateResult);
    /// Clear the session's unread mark.
    SessionMarkRead = "session.markRead" (SessionIdParams => Empty);
    /// Start receiving `runner.event` for this session.
    SessionSubscribe = "session.subscribe" (SessionIdParams => Empty);
    /// Stop receiving `runner.event` for this session.
    SessionUnsubscribe = "session.unsubscribe" (SessionIdParams => Empty);
    /// Read one attachment's bytes.
    AttachmentRead = "attachment.read" (AttachmentReadParams => AttachmentReadResult);
    /// Register the phone's APNs token.
    DeviceRegisterPush = "device.registerPush" (RegisterPushParams => Empty);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_method_round_trips_through_a_request() {
        let requests = vec![
            ClientRequest::Hello(HelloParams {
                protocol: super::super::PROTOCOL_VERSION,
                app_version: "1.0".into(),
            }),
            ClientRequest::SessionsList(Empty {}),
            ClientRequest::SessionMessages(SessionMessagesParams {
                session_id: "s".into(),
                before: None,
                limit: Some(20),
            }),
            ClientRequest::SessionSend(SessionSendParams {
                session_id: "s".into(),
                text: "hi".into(),
                images: vec![],
                client_request_id: None,
            }),
            ClientRequest::SessionStop(SessionIdParams {
                session_id: "s".into(),
            }),
            ClientRequest::SessionCreate(SessionCreateParams::default()),
            ClientRequest::SessionMarkRead(SessionIdParams {
                session_id: "s".into(),
            }),
            ClientRequest::SessionSubscribe(SessionIdParams {
                session_id: "s".into(),
            }),
            ClientRequest::SessionUnsubscribe(SessionIdParams {
                session_id: "s".into(),
            }),
            ClientRequest::AttachmentRead(AttachmentReadParams {
                session_id: "s".into(),
                attachment_id: "a".into(),
            }),
            ClientRequest::DeviceRegisterPush(RegisterPushParams {
                token: "ab".into(),
                env: PushEnv::Sandbox,
            }),
        ];
        assert_eq!(requests.len(), METHODS.len());
        for (i, request) in requests.iter().enumerate() {
            assert_eq!(request.method(), METHODS[i]);
            let wire = request.to_request(i as u64);
            assert_eq!(&ClientRequest::from_request(&wire).unwrap(), request);
        }
    }

    #[test]
    fn optional_params_may_be_absent_and_unknown_ones_are_ignored() {
        let req = Request {
            id: 1,
            method: "session.send".into(),
            params: serde_json::json!({"sessionId": "s", "text": "t", "future": 1}),
        };
        let ClientRequest::SessionSend(p) = ClientRequest::from_request(&req).unwrap() else {
            panic!("wrong variant")
        };
        assert!(p.images.is_empty());
        assert_eq!(p.client_request_id, None);
    }

    #[test]
    fn explicit_nulls_on_the_wire() {
        let json = serde_json::to_string(&SessionMessagesParams {
            session_id: "s".into(),
            before: None,
            limit: None,
        })
        .unwrap();
        assert_eq!(json, r#"{"sessionId":"s","before":null,"limit":null}"#);
    }

    #[test]
    fn unknown_enum_values_decode_as_unknown() {
        let r: SessionStopResult = serde_json::from_str(r#"{"dispatch":"teleported"}"#).unwrap();
        assert_eq!(r.dispatch, StopDispatch::Unknown);
    }
}
