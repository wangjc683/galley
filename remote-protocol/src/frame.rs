//! Relay frames (design §4.2): the WebSocket binary messages between an
//! end (Core = `host`, phone = `client`) and the relay.
//!
//! First byte is the frame type; integers are big-endian. Every frame has
//! one exact layout and [`Frame::decode`] rejects anything else —
//! truncation, trailing bytes, out-of-range fields, unknown types — with a
//! [`FrameError`] whose [`FrameError::label`] the relay can count.
//!
//! | Type | Byte | Direction | Layout after the type byte |
//! |---|---|---|---|
//! | `DATA` | `0x01` | both | `peer u32` ‖ Noise message (1..=65535 bytes) |
//! | `PEER` | `0x02` | relay → end | `peer u32` ‖ `role u8` ‖ `online u8` |
//! | `PUSH` | `0x03` | host → relay | `request_id u32` ‖ `env u8` ‖ `priority u8` ‖ `token_len u16` ‖ token ‖ `collapse_len u8` ‖ collapse id ‖ sealed push |
//! | `PUSH_RESULT` | `0x04` | relay → host | `request_id u32` ‖ `status u8` ‖ `apns_status u16` ‖ `reason_len u8` ‖ reason |
//! | `PING` | `0x05` | end → relay | `nonce u64` |
//! | `PONG` | `0x06` | relay → end | `nonce u64` (echoed) |
//!
//! Peers: the relay numbers each client connection of a channel with a
//! nonzero [`PeerId`]; [`PeerId::HOST`] (`0`) is the host. A host's `DATA`
//! names the client it is for, the relay stamps a client's `DATA` with that
//! client's id before handing it to the host; between a client and the
//! relay the peer is always `0`. `PING` / `PONG` are hop-by-hop: the relay
//! answers them and never forwards them.

use std::fmt;

use serde::{Deserialize, Serialize};

/// `X-Galley-Relay` header value: the version of this frame layer.
pub const RELAY_PROTOCOL_VERSION: u8 = 1;
/// Path of the WebSocket upgrade, appended to the relay base URL.
pub const CONNECT_PATH: &str = "/v1/connect";
/// Connect header carrying `base64url(channel_secret)`
/// ([`crate::keys::ChannelSecret::to_header_value`]).
pub const HEADER_CHANNEL: &str = "X-Galley-Channel";
/// Connect header carrying [`Role::as_str`].
pub const HEADER_ROLE: &str = "X-Galley-Role";
/// Connect header carrying [`RELAY_PROTOCOL_VERSION`].
pub const HEADER_RELAY_VERSION: &str = "X-Galley-Relay";

pub const TYPE_DATA: u8 = 0x01;
pub const TYPE_PEER: u8 = 0x02;
pub const TYPE_PUSH: u8 = 0x03;
pub const TYPE_PUSH_RESULT: u8 = 0x04;
pub const TYPE_PING: u8 = 0x05;
pub const TYPE_PONG: u8 = 0x06;

/// Largest Noise message (Noise spec §3), so the largest `DATA` payload.
pub const MAX_DATA_PAYLOAD: usize = 65535;
/// Largest frame of any type: a full `DATA` frame. The relay's WebSocket
/// message limit.
pub const MAX_FRAME_LEN: usize = 1 + 4 + MAX_DATA_PAYLOAD;
/// Longest APNs device token carried (Apple: do not assume a length; it
/// is 32 bytes today).
pub const MAX_DEVICE_TOKEN_LEN: usize = 1024;
/// APNs `apns-collapse-id` limit.
pub const MAX_COLLAPSE_ID_LEN: usize = 64;
/// Longest sealed push a `PUSH` may carry: the most whose APNs payload
/// ([`crate::push::apns_payload`]) still fits APNs' 4096-byte limit.
pub const MAX_PUSH_SEALED_LEN: usize = 2994;

/// Which side of a channel a connection is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    /// Galley Core. One per channel; a new host displaces the old one.
    Host,
    /// A phone.
    Client,
}

impl Role {
    /// Byte in `PEER` frames and the Noise prologue.
    pub fn code(self) -> u8 {
        match self {
            Role::Host => 0x01,
            Role::Client => 0x02,
        }
    }

    pub fn from_code(code: u8) -> Option<Self> {
        match code {
            0x01 => Some(Role::Host),
            0x02 => Some(Role::Client),
            _ => None,
        }
    }

    /// `X-Galley-Role` header value.
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Host => "host",
            Role::Client => "client",
        }
    }

    pub fn from_header_value(value: &str) -> Option<Self> {
        match value {
            "host" => Some(Role::Host),
            "client" => Some(Role::Client),
            _ => None,
        }
    }
}

/// A connection within a channel, as the relay numbers it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct PeerId(pub u32);

impl PeerId {
    /// The host. Clients are numbered from 1 by the relay, never reused
    /// while the channel lives.
    pub const HOST: PeerId = PeerId(0);

    pub fn is_host(self) -> bool {
        self == Self::HOST
    }
}

/// APNs environment of a device token. Development builds register with
/// the sandbox (design §4.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PushEnv {
    /// `api.push.apple.com`. Byte `0x00`.
    Production,
    /// `api.sandbox.push.apple.com`. Byte `0x01`.
    Sandbox,
}

impl PushEnv {
    pub fn code(self) -> u8 {
        match self {
            PushEnv::Production => 0x00,
            PushEnv::Sandbox => 0x01,
        }
    }

    pub fn from_code(code: u8) -> Option<Self> {
        match code {
            0x00 => Some(PushEnv::Production),
            0x01 => Some(PushEnv::Sandbox),
            _ => None,
        }
    }
}

/// `apns-priority`; the byte is the APNs value itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PushPriority {
    /// 10: deliver now (alerts).
    Immediate,
    /// 5: by the device's power policy.
    PowerConsiderate,
    /// 1: prioritize power, do not wake the device.
    PowerSaving,
}

impl PushPriority {
    pub fn code(self) -> u8 {
        match self {
            PushPriority::Immediate => 10,
            PushPriority::PowerConsiderate => 5,
            PushPriority::PowerSaving => 1,
        }
    }

    pub fn from_code(code: u8) -> Option<Self> {
        match code {
            10 => Some(PushPriority::Immediate),
            5 => Some(PushPriority::PowerConsiderate),
            1 => Some(PushPriority::PowerSaving),
            _ => None,
        }
    }
}

/// One push for the relay to send to APNs. The relay wraps `sealed` into
/// the APNs payload with [`crate::push::apns_payload`]; it cannot open it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushRequest {
    /// Chosen by the host, echoed in the matching [`PushResult`].
    pub request_id: u32,
    pub env: PushEnv,
    pub priority: PushPriority,
    /// Raw device token (1..=[`MAX_DEVICE_TOKEN_LEN`] bytes); the relay
    /// hex-encodes it into the APNs path.
    pub device_token: Vec<u8>,
    /// Opaque `apns-collapse-id`: printable ASCII, at most 64 bytes.
    pub collapse_id: Option<String>,
    /// `nonce ‖ ciphertext` from [`crate::push::seal`].
    pub sealed: Vec<u8>,
}

/// Outcome of one [`PushRequest`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PushStatus {
    /// APNs accepted it (HTTP 200). Byte `0x00`.
    Ok,
    /// APNs 410: the token is no longer valid; the host deletes it.
    /// Byte `0x01`.
    Unregistered,
    /// Anything else: an APNs error, no answer from APNs, or the relay
    /// refused to send. Byte `0x02`.
    Failed,
}

impl PushStatus {
    pub fn code(self) -> u8 {
        match self {
            PushStatus::Ok => 0x00,
            PushStatus::Unregistered => 0x01,
            PushStatus::Failed => 0x02,
        }
    }

    pub fn from_code(code: u8) -> Option<Self> {
        match code {
            0x00 => Some(PushStatus::Ok),
            0x01 => Some(PushStatus::Unregistered),
            0x02 => Some(PushStatus::Failed),
            _ => None,
        }
    }
}

/// The relay's answer to a [`PushRequest`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushResult {
    pub request_id: u32,
    pub status: PushStatus,
    /// APNs HTTP status; `0` when APNs never answered. `Ok` must be 200
    /// and `Unregistered` 410.
    pub apns_status: u16,
    /// APNs `reason` (`BadDeviceToken`, …) or the relay's own short code;
    /// printable ASCII, at most 255 bytes, may be empty.
    pub reason: String,
}

/// One relay frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    /// One Noise message for (host → relay) or from (relay → host) a
    /// client; [`PeerId::HOST`] on a client's connection.
    Data {
        peer: PeerId,
        payload: Vec<u8>,
    },
    /// A peer came online or went offline. To a client, `peer` is
    /// [`PeerId::HOST`] with [`Role::Host`]; to the host, a client id
    /// with [`Role::Client`]. A host that connects is told about every
    /// client already there.
    Peer {
        peer: PeerId,
        role: Role,
        online: bool,
    },
    Push(PushRequest),
    PushResult(PushResult),
    Ping(u64),
    Pong(u64),
}

/// Why bytes are not a valid frame. [`FrameError::label`] is a stable
/// counter label for the relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameError {
    Empty,
    UnknownType(u8),
    /// Ended before the layout did.
    Truncated {
        frame: &'static str,
    },
    /// Bytes after the layout ended.
    TrailingBytes {
        frame: &'static str,
    },
    /// A field outside its allowed values or lengths.
    InvalidField {
        frame: &'static str,
        field: &'static str,
    },
}

impl FrameError {
    pub fn label(&self) -> &'static str {
        match self {
            FrameError::Empty => "empty",
            FrameError::UnknownType(_) => "unknown_type",
            FrameError::Truncated { .. } => "truncated",
            FrameError::TrailingBytes { .. } => "trailing_bytes",
            FrameError::InvalidField { .. } => "invalid_field",
        }
    }
}

impl fmt::Display for FrameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FrameError::Empty => f.write_str("empty frame"),
            FrameError::UnknownType(t) => write!(f, "unknown frame type 0x{t:02x}"),
            FrameError::Truncated { frame } => write!(f, "{frame} frame truncated"),
            FrameError::TrailingBytes { frame } => write!(f, "{frame} frame has trailing bytes"),
            FrameError::InvalidField { frame, field } => {
                write!(f, "{frame} frame has an invalid {field}")
            }
        }
    }
}

impl std::error::Error for FrameError {}

fn invalid(frame: &'static str, field: &'static str) -> FrameError {
    FrameError::InvalidField { frame, field }
}

fn is_printable_ascii(bytes: &[u8]) -> bool {
    bytes.iter().all(|b| b.is_ascii_graphic())
}

/// Reads one layout, tracking which frame it is for error reporting.
struct Reader<'a> {
    frame: &'static str,
    bytes: &'a [u8],
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], FrameError> {
        if self.bytes.len() < n {
            return Err(FrameError::Truncated { frame: self.frame });
        }
        let (head, rest) = self.bytes.split_at(n);
        self.bytes = rest;
        Ok(head)
    }

    fn u8(&mut self) -> Result<u8, FrameError> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, FrameError> {
        let b = self.take(2)?;
        Ok(u16::from_be_bytes([b[0], b[1]]))
    }

    fn u32(&mut self) -> Result<u32, FrameError> {
        let b = self.take(4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn u64(&mut self) -> Result<u64, FrameError> {
        let b = self.take(8)?;
        let mut a = [0u8; 8];
        a.copy_from_slice(b);
        Ok(u64::from_be_bytes(a))
    }

    fn rest(&mut self) -> &'a [u8] {
        std::mem::take(&mut self.bytes)
    }

    fn finish(self) -> Result<(), FrameError> {
        if self.bytes.is_empty() {
            Ok(())
        } else {
            Err(FrameError::TrailingBytes { frame: self.frame })
        }
    }
}

impl Frame {
    /// Name used in errors and fixtures (`DATA`, `PEER`, …).
    pub fn type_name(&self) -> &'static str {
        match self {
            Frame::Data { .. } => "DATA",
            Frame::Peer { .. } => "PEER",
            Frame::Push(_) => "PUSH",
            Frame::PushResult(_) => "PUSH_RESULT",
            Frame::Ping(_) => "PING",
            Frame::Pong(_) => "PONG",
        }
    }

    /// Encode, checking the same field rules [`Frame::decode`] enforces.
    pub fn encode(&self) -> Result<Vec<u8>, FrameError> {
        let name = self.type_name();
        match self {
            Frame::Data { peer, payload } => {
                if payload.is_empty() || payload.len() > MAX_DATA_PAYLOAD {
                    return Err(invalid(name, "payload"));
                }
                let mut out = Vec::with_capacity(5 + payload.len());
                out.push(TYPE_DATA);
                out.extend_from_slice(&peer.0.to_be_bytes());
                out.extend_from_slice(payload);
                Ok(out)
            }
            Frame::Peer { peer, role, online } => {
                if peer.is_host() != (*role == Role::Host) {
                    return Err(invalid(name, "role"));
                }
                let mut out = Vec::with_capacity(7);
                out.push(TYPE_PEER);
                out.extend_from_slice(&peer.0.to_be_bytes());
                out.push(role.code());
                out.push(u8::from(*online));
                Ok(out)
            }
            Frame::Push(push) => {
                validate_push(push)?;
                let collapse = push.collapse_id.as_deref().unwrap_or("");
                let mut out = Vec::with_capacity(
                    10 + push.device_token.len() + collapse.len() + push.sealed.len(),
                );
                out.push(TYPE_PUSH);
                out.extend_from_slice(&push.request_id.to_be_bytes());
                out.push(push.env.code());
                out.push(push.priority.code());
                // Lengths were bounded by `validate_push`.
                out.extend_from_slice(&(push.device_token.len() as u16).to_be_bytes());
                out.extend_from_slice(&push.device_token);
                out.push(collapse.len() as u8);
                out.extend_from_slice(collapse.as_bytes());
                out.extend_from_slice(&push.sealed);
                Ok(out)
            }
            Frame::PushResult(result) => {
                validate_push_result(result)?;
                let mut out = Vec::with_capacity(9 + result.reason.len());
                out.push(TYPE_PUSH_RESULT);
                out.extend_from_slice(&result.request_id.to_be_bytes());
                out.push(result.status.code());
                out.extend_from_slice(&result.apns_status.to_be_bytes());
                out.push(result.reason.len() as u8);
                out.extend_from_slice(result.reason.as_bytes());
                Ok(out)
            }
            Frame::Ping(nonce) | Frame::Pong(nonce) => {
                let mut out = Vec::with_capacity(9);
                out.push(if matches!(self, Frame::Ping(_)) {
                    TYPE_PING
                } else {
                    TYPE_PONG
                });
                out.extend_from_slice(&nonce.to_be_bytes());
                Ok(out)
            }
        }
    }

    /// Strict decode of one WebSocket binary message.
    pub fn decode(bytes: &[u8]) -> Result<Frame, FrameError> {
        let (&ty, body) = bytes.split_first().ok_or(FrameError::Empty)?;
        let frame = match ty {
            TYPE_DATA => {
                let mut r = Reader {
                    frame: "DATA",
                    bytes: body,
                };
                let peer = PeerId(r.u32()?);
                let payload = r.rest();
                if payload.is_empty() {
                    return Err(FrameError::Truncated { frame: "DATA" });
                }
                if payload.len() > MAX_DATA_PAYLOAD {
                    return Err(invalid("DATA", "payload"));
                }
                Frame::Data {
                    peer,
                    payload: payload.to_vec(),
                }
            }
            TYPE_PEER => {
                let mut r = Reader {
                    frame: "PEER",
                    bytes: body,
                };
                let peer = PeerId(r.u32()?);
                let role = Role::from_code(r.u8()?).ok_or(invalid("PEER", "role"))?;
                let online = match r.u8()? {
                    0x00 => false,
                    0x01 => true,
                    _ => return Err(invalid("PEER", "online")),
                };
                r.finish()?;
                if peer.is_host() != (role == Role::Host) {
                    return Err(invalid("PEER", "role"));
                }
                Frame::Peer { peer, role, online }
            }
            TYPE_PUSH => {
                let mut r = Reader {
                    frame: "PUSH",
                    bytes: body,
                };
                let request_id = r.u32()?;
                let env = PushEnv::from_code(r.u8()?).ok_or(invalid("PUSH", "env"))?;
                let priority =
                    PushPriority::from_code(r.u8()?).ok_or(invalid("PUSH", "priority"))?;
                let token_len = usize::from(r.u16()?);
                let device_token = r.take(token_len)?.to_vec();
                let collapse_len = usize::from(r.u8()?);
                let collapse = r.take(collapse_len)?;
                let collapse_id = if collapse.is_empty() {
                    None
                } else if collapse.len() <= MAX_COLLAPSE_ID_LEN && is_printable_ascii(collapse) {
                    // Printable ASCII is UTF-8.
                    Some(
                        String::from_utf8(collapse.to_vec())
                            .map_err(|_| invalid("PUSH", "collapse_id"))?,
                    )
                } else {
                    return Err(invalid("PUSH", "collapse_id"));
                };
                let sealed = r.rest().to_vec();
                let push = PushRequest {
                    request_id,
                    env,
                    priority,
                    device_token,
                    collapse_id,
                    sealed,
                };
                validate_push(&push)?;
                Frame::Push(push)
            }
            TYPE_PUSH_RESULT => {
                let mut r = Reader {
                    frame: "PUSH_RESULT",
                    bytes: body,
                };
                let request_id = r.u32()?;
                let status =
                    PushStatus::from_code(r.u8()?).ok_or(invalid("PUSH_RESULT", "status"))?;
                let apns_status = r.u16()?;
                let reason_len = usize::from(r.u8()?);
                let reason = r.take(reason_len)?;
                r.finish()?;
                if !is_printable_ascii(reason) {
                    return Err(invalid("PUSH_RESULT", "reason"));
                }
                let result = PushResult {
                    request_id,
                    status,
                    apns_status,
                    reason: String::from_utf8(reason.to_vec())
                        .map_err(|_| invalid("PUSH_RESULT", "reason"))?,
                };
                validate_push_result(&result)?;
                Frame::PushResult(result)
            }
            TYPE_PING | TYPE_PONG => {
                let name = if ty == TYPE_PING { "PING" } else { "PONG" };
                let mut r = Reader {
                    frame: name,
                    bytes: body,
                };
                let nonce = r.u64()?;
                r.finish()?;
                if ty == TYPE_PING {
                    Frame::Ping(nonce)
                } else {
                    Frame::Pong(nonce)
                }
            }
            other => return Err(FrameError::UnknownType(other)),
        };
        Ok(frame)
    }
}

fn validate_push(push: &PushRequest) -> Result<(), FrameError> {
    if push.device_token.is_empty() || push.device_token.len() > MAX_DEVICE_TOKEN_LEN {
        return Err(invalid("PUSH", "device_token"));
    }
    if let Some(id) = &push.collapse_id {
        if id.is_empty() || id.len() > MAX_COLLAPSE_ID_LEN || !is_printable_ascii(id.as_bytes()) {
            return Err(invalid("PUSH", "collapse_id"));
        }
    }
    let min_sealed = crate::push::NONCE_LEN + crate::push::TAG_LEN;
    if push.sealed.len() < min_sealed || push.sealed.len() > MAX_PUSH_SEALED_LEN {
        return Err(invalid("PUSH", "sealed"));
    }
    Ok(())
}

fn validate_push_result(result: &PushResult) -> Result<(), FrameError> {
    if result.reason.len() > usize::from(u8::MAX) || !is_printable_ascii(result.reason.as_bytes()) {
        return Err(invalid("PUSH_RESULT", "reason"));
    }
    let consistent = match result.status {
        PushStatus::Ok => result.apns_status == 200,
        PushStatus::Unregistered => result.apns_status == 410,
        PushStatus::Failed => true,
    };
    if !consistent {
        return Err(invalid("PUSH_RESULT", "apns_status"));
    }
    Ok(())
}

/// Parse a device token as iOS apps usually print it (hex, either case)
/// into the raw bytes a `PUSH` carries.
pub fn device_token_from_hex(hex: &str) -> Option<Vec<u8>> {
    if hex.is_empty() || !hex.len().is_multiple_of(2) || hex.len() > 2 * MAX_DEVICE_TOKEN_LEN {
        return None;
    }
    fn nibble(b: u8) -> Option<u8> {
        char::from(b).to_digit(16).map(|d| d as u8)
    }
    hex.as_bytes()
        .chunks(2)
        .map(|pair| Some((nibble(pair[0])? << 4) | nibble(pair[1])?))
        .collect()
}

/// Lowercase hex of a device token, as the APNs path wants it.
pub fn device_token_to_hex(token: &[u8]) -> String {
    token.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push() -> PushRequest {
        PushRequest {
            request_id: 7,
            env: PushEnv::Sandbox,
            priority: PushPriority::Immediate,
            device_token: vec![0xab; 32],
            collapse_id: Some("c1".into()),
            sealed: vec![0x11; crate::push::SEALED_LEN],
        }
    }

    fn all_frames() -> Vec<Frame> {
        vec![
            Frame::Data {
                peer: PeerId(3),
                payload: vec![1, 2, 3],
            },
            Frame::Data {
                peer: PeerId::HOST,
                payload: vec![0; MAX_DATA_PAYLOAD],
            },
            Frame::Peer {
                peer: PeerId::HOST,
                role: Role::Host,
                online: false,
            },
            Frame::Peer {
                peer: PeerId(9),
                role: Role::Client,
                online: true,
            },
            Frame::Push(push()),
            Frame::Push(PushRequest {
                collapse_id: None,
                ..push()
            }),
            Frame::PushResult(PushResult {
                request_id: 7,
                status: PushStatus::Unregistered,
                apns_status: 410,
                reason: "Unregistered".into(),
            }),
            Frame::PushResult(PushResult {
                request_id: 8,
                status: PushStatus::Failed,
                apns_status: 0,
                reason: String::new(),
            }),
            Frame::Ping(u64::MAX),
            Frame::Pong(0),
        ]
    }

    #[test]
    fn every_frame_round_trips() {
        for frame in all_frames() {
            let bytes = frame.encode().unwrap();
            assert!(bytes.len() <= MAX_FRAME_LEN);
            assert_eq!(Frame::decode(&bytes).unwrap(), frame);
        }
    }

    #[test]
    fn every_truncation_and_extension_is_rejected() {
        for frame in all_frames() {
            let bytes = frame.encode().unwrap();
            // DATA's payload and PUSH's sealed push are "the rest", so
            // only cuts that leave them too short are truncation.
            let cuts: Vec<usize> = match &frame {
                Frame::Data { .. } => (0..=5).collect(),
                Frame::Push(p) => {
                    let header = bytes.len() - p.sealed.len();
                    (0..header + crate::push::NONCE_LEN + crate::push::TAG_LEN).collect()
                }
                _ => (0..bytes.len()).collect(),
            };
            for cut in cuts {
                assert!(
                    Frame::decode(&bytes[..cut]).is_err(),
                    "{} accepted at {cut} bytes",
                    frame.type_name()
                );
            }
            if !matches!(frame, Frame::Data { .. } | Frame::Push(_)) {
                let mut longer = bytes.clone();
                longer.push(0);
                assert!(matches!(
                    Frame::decode(&longer),
                    Err(FrameError::TrailingBytes { .. })
                ));
            }
        }
    }

    #[test]
    fn bad_fields_are_rejected_with_labels() {
        assert_eq!(Frame::decode(&[]).unwrap_err().label(), "empty");
        assert_eq!(
            Frame::decode(&[0x00]).unwrap_err(),
            FrameError::UnknownType(0x00)
        );
        assert_eq!(
            Frame::decode(&[0x07, 0]).unwrap_err().label(),
            "unknown_type"
        );
        assert_eq!(
            Frame::decode(&[TYPE_DATA, 0, 0, 0, 1]).unwrap_err().label(),
            "truncated"
        );
        let mut huge = vec![TYPE_DATA, 0, 0, 0, 1];
        huge.extend(vec![0u8; MAX_DATA_PAYLOAD + 1]);
        assert_eq!(Frame::decode(&huge).unwrap_err().label(), "invalid_field");
        // PEER: unknown role, online not 0/1, host id with client role.
        for bad in [
            [TYPE_PEER, 0, 0, 0, 1, 3, 1],
            [TYPE_PEER, 0, 0, 0, 1, 2, 2],
            [TYPE_PEER, 0, 0, 0, 0, 2, 1],
            [TYPE_PEER, 0, 0, 0, 1, 1, 1],
        ] {
            assert_eq!(
                Frame::decode(&bad).unwrap_err().label(),
                "invalid_field",
                "{bad:?}"
            );
        }
        // PUSH: env, priority, empty token, bad collapse id, short sealed.
        let good = Frame::Push(push()).encode().unwrap();
        let mut bad_env = good.clone();
        bad_env[5] = 2;
        let mut bad_priority = good.clone();
        bad_priority[6] = 9;
        for bad in [bad_env, bad_priority] {
            assert_eq!(Frame::decode(&bad).unwrap_err().label(), "invalid_field");
        }
        for push in [
            PushRequest {
                device_token: vec![],
                ..push()
            },
            PushRequest {
                collapse_id: Some("a b".into()),
                ..push()
            },
            PushRequest {
                collapse_id: Some("x".repeat(65)),
                ..push()
            },
            PushRequest {
                collapse_id: Some(String::new()),
                ..push()
            },
            PushRequest {
                sealed: vec![0; 27],
                ..push()
            },
            PushRequest {
                sealed: vec![0; MAX_PUSH_SEALED_LEN + 1],
                ..push()
            },
        ] {
            assert!(Frame::Push(push).encode().is_err());
        }
        // PUSH_RESULT: status / HTTP status must agree, reason printable.
        for result in [
            PushResult {
                request_id: 1,
                status: PushStatus::Ok,
                apns_status: 400,
                reason: String::new(),
            },
            PushResult {
                request_id: 1,
                status: PushStatus::Unregistered,
                apns_status: 200,
                reason: String::new(),
            },
            PushResult {
                request_id: 1,
                status: PushStatus::Failed,
                apns_status: 0,
                reason: "a\nb".into(),
            },
        ] {
            assert!(Frame::PushResult(result).encode().is_err());
        }
        assert_eq!(
            Frame::decode(&[TYPE_PUSH_RESULT, 0, 0, 0, 1, 3, 0, 0, 0])
                .unwrap_err()
                .label(),
            "invalid_field"
        );
        // DATA with an empty payload cannot be built either.
        assert!(Frame::Data {
            peer: PeerId(1),
            payload: vec![]
        }
        .encode()
        .is_err());
    }

    #[test]
    fn device_token_hex() {
        assert_eq!(
            device_token_from_hex("00aBff"),
            Some(vec![0x00, 0xab, 0xff])
        );
        assert_eq!(device_token_to_hex(&[0x00, 0xab, 0xff]), "00abff");
        for bad in ["", "abc", "zz", "+1", "é1"] {
            assert_eq!(device_token_from_hex(bad), None, "{bad}");
        }
    }

    #[test]
    fn roles_and_headers() {
        for role in [Role::Host, Role::Client] {
            assert_eq!(Role::from_code(role.code()), Some(role));
            assert_eq!(Role::from_header_value(role.as_str()), Some(role));
        }
        assert_eq!(Role::from_header_value("Host"), None);
    }
}
