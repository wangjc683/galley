//! End-to-end session (design §5): `Noise_NNpsk0_25519_ChaChaPoly_SHA256`
//! over the relay's `DATA` frames, phone = initiator, Core = responder.
//!
//! Handshake (two messages, then transport):
//!
//! 1. phone → Core, `psk, e`: [`client_start`]. Empty payload, so exactly
//!    [`HANDSHAKE_REQUEST_LEN`] bytes. It is protected by the PSK only
//!    (replayable, no forward secrecy), which is why nothing rides on it;
//!    a replay gains nothing because Core answers with a fresh `e`.
//!    [`host_accept`] rejects any other length.
//! 2. Core → phone, `e, ee`: [`HostHandshake::finish`]. Payload is Core's
//!    hello (opaque here; [`crate::app::CoreHello`] JSON), padded with
//!    [`crate::padding::pad`], at most [`MAX_HELLO_LEN`] bytes.
//!
//! The prologue ([`prologue`]) binds the protocol generation, the relay
//! frame version and both roles into the handshake hash, so a P1 handshake
//! (`galley-remote/2`) can never be downgraded into this one.
//!
//! Transport plaintext is one record, padded ([`crate::padding`]):
//!
//! ```text
//! pad( type u8 ‖ body )
//!   type 0x01 APP    body = one app-layer message (1..=MAX_APP_RECORD_LEN bytes)
//!   type 0x02 CLOSE  body = reason u8 (CloseReason)
//! ```
//!
//! `CLOSE` is the explicit end of a session (Noise spec §13 leaves
//! truncation to the application): a side that is done sends it before
//! closing the connection. A connection that ends without a `CLOSE` —
//! the relay dropping it, a `PEER` offline — is a truncated session: the
//! receiver discards partial state (chunk reassembly, pending requests)
//! and resyncs on the next session. Nothing may follow a `CLOSE`.
//!
//! [`Transport`] refuses to go on after any failure (bad tag, bad padding,
//! bad record): on an ordered stream that is tampering or a bug, and the
//! session must be dropped.

use std::fmt;

use crate::frame::{Role, RELAY_PROTOCOL_VERSION};
use crate::keys::NoisePsk;
use crate::padding::{self, PaddingError, AEAD_TAG_LEN, MAX_NOISE_MESSAGE_LEN};

/// The one Noise protocol of P0.
pub const NOISE_PARAMS: &str = "Noise_NNpsk0_25519_ChaChaPoly_SHA256";
/// Protocol generation, first part of the prologue. P1's `XXpsk3` / `KK`
/// handshakes use `galley-remote/2`.
pub const PROLOGUE_TAG: &[u8] = b"galley-remote/1";
/// [`prologue`] length.
pub const PROLOGUE_LEN: usize = 19;
/// X25519 public key length.
pub const DH_LEN: usize = 32;
/// Handshake message 1: `e` plus the tag of the empty payload.
pub const HANDSHAKE_REQUEST_LEN: usize = DH_LEN + AEAD_TAG_LEN;
/// Largest Core hello in handshake message 2.
pub const MAX_HELLO_LEN: usize = 4096;
/// A session lives at most this long; then the phone reconnects, which
/// re-handshakes and so rekeys (design §5).
pub const SESSION_MAX_AGE_SECS: u64 = 24 * 60 * 60;
/// Record type of an app-layer message.
pub const RECORD_APP: u8 = 0x01;
/// Record type of the end-of-session marker.
pub const RECORD_CLOSE: u8 = 0x02;
/// Largest app-layer message in one record; larger ones are chunked
/// ([`crate::app::chunk`]).
pub const MAX_APP_RECORD_LEN: usize = padding::MAX_PAYLOAD_LEN - 1;

/// The prologue both ends feed into the handshake:
///
/// | Offset | Bytes | Value |
/// |---|---|---|
/// | 0 | 15 | ASCII `galley-remote/1` |
/// | 15 | 1 | `0x00` separator |
/// | 16 | 1 | relay frame version ([`RELAY_PROTOCOL_VERSION`]) |
/// | 17 | 1 | initiator role ([`Role::Client`], `0x02`) |
/// | 18 | 1 | responder role ([`Role::Host`], `0x01`) |
pub fn prologue() -> [u8; PROLOGUE_LEN] {
    let mut out = [0u8; PROLOGUE_LEN];
    out[..PROLOGUE_TAG.len()].copy_from_slice(PROLOGUE_TAG);
    out[15] = 0x00;
    out[16] = RELAY_PROTOCOL_VERSION;
    out[17] = Role::Client.code();
    out[18] = Role::Host.code();
    out
}

/// Why the end-to-end session failed or ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NoiseError {
    /// A handshake message of the wrong length, or a Core hello that is
    /// empty or too long.
    BadHandshakeMessage,
    /// Authentication failed: wrong PSK, a tampered, replayed or
    /// reordered message.
    Decrypt,
    /// Too large for one Noise message.
    TooLarge {
        len: usize,
        max: usize,
    },
    Padding(PaddingError),
    /// Unknown record type, empty `APP` body, or a `CLOSE` body that is
    /// not one byte.
    BadRecord,
    /// A `CLOSE` was already sent (when sealing) or received (when
    /// opening).
    Closed,
    /// An earlier record failed to open; the session is unusable.
    Failed,
    /// Anything else snow refused.
    Protocol(String),
}

impl fmt::Display for NoiseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NoiseError::BadHandshakeMessage => f.write_str("malformed handshake message"),
            NoiseError::Decrypt => f.write_str("decryption failed"),
            NoiseError::TooLarge { len, max } => write!(f, "{len} bytes exceeds {max}"),
            NoiseError::Padding(e) => write!(f, "padding: {e}"),
            NoiseError::BadRecord => f.write_str("malformed record"),
            NoiseError::Closed => f.write_str("session closed"),
            NoiseError::Failed => f.write_str("session failed earlier"),
            NoiseError::Protocol(e) => write!(f, "noise: {e}"),
        }
    }
}

impl std::error::Error for NoiseError {}

impl From<PaddingError> for NoiseError {
    fn from(e: PaddingError) -> Self {
        NoiseError::Padding(e)
    }
}

fn from_snow(e: snow::Error) -> NoiseError {
    match e {
        snow::Error::Decrypt => NoiseError::Decrypt,
        other => NoiseError::Protocol(other.to_string()),
    }
}

/// Builds a handshake state the way every session does; the prologue is a
/// parameter only so the cacophony vectors can run through it.
pub(crate) fn build_handshake(
    prologue: &[u8],
    psk: &[u8; 32],
    initiator: bool,
    fixed_ephemeral: Option<&[u8; 32]>,
) -> Result<snow::HandshakeState, NoiseError> {
    let params: snow::params::NoiseParams = NOISE_PARAMS.parse().map_err(from_snow)?;
    let mut builder = snow::Builder::new(params)
        .psk(0, psk)
        .map_err(from_snow)?
        .prologue(prologue)
        .map_err(from_snow)?;
    if let Some(e) = fixed_ephemeral {
        builder = builder.fixed_ephemeral_key_for_testing_only(e);
    }
    if initiator {
        builder.build_initiator()
    } else {
        builder.build_responder()
    }
    .map_err(from_snow)
}

fn into_transport(state: snow::HandshakeState) -> Result<Transport, NoiseError> {
    let mut handshake_hash = [0u8; 32];
    handshake_hash.copy_from_slice(state.get_handshake_hash());
    Ok(Transport {
        state: state.into_transport_mode().map_err(from_snow)?,
        handshake_hash,
        sent_close: false,
        received_close: false,
        failed: false,
    })
}

fn client_start_inner(
    psk: &NoisePsk,
    fixed_ephemeral: Option<&[u8; 32]>,
) -> Result<(Vec<u8>, ClientHandshake), NoiseError> {
    let mut state = build_handshake(&prologue(), psk.expose_secret(), true, fixed_ephemeral)?;
    let mut message = vec![0u8; HANDSHAKE_REQUEST_LEN];
    let len = state.write_message(&[], &mut message).map_err(from_snow)?;
    if len != HANDSHAKE_REQUEST_LEN {
        return Err(NoiseError::Protocol(format!(
            "handshake request is {len} bytes"
        )));
    }
    Ok((message, ClientHandshake { state }))
}

fn host_accept_inner(
    psk: &NoisePsk,
    message: &[u8],
    fixed_ephemeral: Option<&[u8; 32]>,
) -> Result<HostHandshake, NoiseError> {
    if message.len() != HANDSHAKE_REQUEST_LEN {
        return Err(NoiseError::BadHandshakeMessage);
    }
    let mut state = build_handshake(&prologue(), psk.expose_secret(), false, fixed_ephemeral)?;
    let mut payload = [0u8; HANDSHAKE_REQUEST_LEN];
    let len = state
        .read_message(message, &mut payload)
        .map_err(from_snow)?;
    if len != 0 {
        return Err(NoiseError::BadHandshakeMessage);
    }
    Ok(HostHandshake { state })
}

/// Phone side: build handshake message 1. Send it, then hand Core's answer
/// to [`ClientHandshake::finish`].
pub fn client_start(psk: &NoisePsk) -> Result<(Vec<u8>, ClientHandshake), NoiseError> {
    client_start_inner(psk, None)
}

/// [`client_start`] with a fixed ephemeral key, for golden handshakes.
#[cfg(feature = "test-hooks")]
pub fn client_start_with_fixed_ephemeral_for_testing_only(
    psk: &NoisePsk,
    ephemeral_private: &[u8; 32],
) -> Result<(Vec<u8>, ClientHandshake), NoiseError> {
    client_start_inner(psk, Some(ephemeral_private))
}

/// Core side: take handshake message 1. Fails on a wrong PSK (bad tag)
/// or any message that is not exactly [`HANDSHAKE_REQUEST_LEN`] bytes.
pub fn host_accept(psk: &NoisePsk, message: &[u8]) -> Result<HostHandshake, NoiseError> {
    host_accept_inner(psk, message, None)
}

/// [`host_accept`] with a fixed ephemeral key, for golden handshakes.
#[cfg(feature = "test-hooks")]
pub fn host_accept_with_fixed_ephemeral_for_testing_only(
    psk: &NoisePsk,
    message: &[u8],
    ephemeral_private: &[u8; 32],
) -> Result<HostHandshake, NoiseError> {
    host_accept_inner(psk, message, Some(ephemeral_private))
}

/// Phone side after message 1 went out.
pub struct ClientHandshake {
    state: snow::HandshakeState,
}

impl ClientHandshake {
    /// Read handshake message 2: returns Core's hello and the session.
    pub fn finish(mut self, message: &[u8]) -> Result<(Vec<u8>, Transport), NoiseError> {
        if message.len() > MAX_NOISE_MESSAGE_LEN {
            return Err(NoiseError::BadHandshakeMessage);
        }
        let mut plaintext = vec![0u8; message.len()];
        let len = self
            .state
            .read_message(message, &mut plaintext)
            .map_err(from_snow)?;
        let hello = padding::unpad(&plaintext[..len])?;
        if hello.is_empty() || hello.len() > MAX_HELLO_LEN {
            return Err(NoiseError::BadHandshakeMessage);
        }
        let hello = hello.to_vec();
        Ok((hello, into_transport(self.state)?))
    }
}

impl fmt::Debug for ClientHandshake {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ClientHandshake")
    }
}

/// Core side after a valid message 1.
pub struct HostHandshake {
    state: snow::HandshakeState,
}

impl HostHandshake {
    /// Write handshake message 2 carrying `hello` (1..=[`MAX_HELLO_LEN`]
    /// bytes): returns the message to send and the session.
    pub fn finish(mut self, hello: &[u8]) -> Result<(Vec<u8>, Transport), NoiseError> {
        if hello.is_empty() || hello.len() > MAX_HELLO_LEN {
            return Err(NoiseError::TooLarge {
                len: hello.len(),
                max: MAX_HELLO_LEN,
            });
        }
        let plaintext = padding::pad(hello)?;
        let mut message = vec![0u8; DH_LEN + plaintext.len() + AEAD_TAG_LEN];
        let len = self
            .state
            .write_message(&plaintext, &mut message)
            .map_err(from_snow)?;
        message.truncate(len);
        Ok((message, into_transport(self.state)?))
    }
}

impl fmt::Debug for HostHandshake {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("HostHandshake")
    }
}

/// Why a session ended, carried in the `CLOSE` record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CloseReason {
    /// `0x00`: done (app backgrounded, Core shutting down).
    Normal,
    /// `0x01`: the session reached [`SESSION_MAX_AGE_SECS`]; reconnect.
    Expired,
    /// `0x02`: app protocol majors differ (design §6.2); reconnecting will
    /// not help until one side updates.
    VersionMismatch,
    /// `0x03`: the desktop rotated its master key ("解除配对"); the phone
    /// must scan a new code.
    Unpaired,
    /// A reason this version does not know; treat as [`CloseReason::Normal`].
    Other(u8),
}

impl CloseReason {
    pub fn code(self) -> u8 {
        match self {
            CloseReason::Normal => 0x00,
            CloseReason::Expired => 0x01,
            CloseReason::VersionMismatch => 0x02,
            CloseReason::Unpaired => 0x03,
            CloseReason::Other(code) => code,
        }
    }

    pub fn from_code(code: u8) -> Self {
        match code {
            0x00 => CloseReason::Normal,
            0x01 => CloseReason::Expired,
            0x02 => CloseReason::VersionMismatch,
            0x03 => CloseReason::Unpaired,
            other => CloseReason::Other(other),
        }
    }
}

/// One opened transport record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Record {
    /// One app-layer message (or chunk), as bytes.
    App(Vec<u8>),
    /// The peer ended the session; nothing more will open.
    Close(CloseReason),
}

/// An established session. Not `Clone`: each direction's nonce must
/// advance exactly once per message.
pub struct Transport {
    state: snow::TransportState,
    handshake_hash: [u8; 32],
    sent_close: bool,
    received_close: bool,
    failed: bool,
}

impl Transport {
    /// Seal one app-layer message (1..=[`MAX_APP_RECORD_LEN`] bytes).
    pub fn seal_app(&mut self, body: &[u8]) -> Result<Vec<u8>, NoiseError> {
        if body.is_empty() || body.len() > MAX_APP_RECORD_LEN {
            return Err(NoiseError::TooLarge {
                len: body.len(),
                max: MAX_APP_RECORD_LEN,
            });
        }
        self.seal_record(RECORD_APP, body)
    }

    /// Seal the end-of-session marker. Nothing can be sealed after it.
    pub fn seal_close(&mut self, reason: CloseReason) -> Result<Vec<u8>, NoiseError> {
        let message = self.seal_record(RECORD_CLOSE, &[reason.code()])?;
        self.sent_close = true;
        Ok(message)
    }

    fn seal_record(&mut self, record_type: u8, body: &[u8]) -> Result<Vec<u8>, NoiseError> {
        if self.sent_close {
            return Err(NoiseError::Closed);
        }
        let mut content = Vec::with_capacity(1 + body.len());
        content.push(record_type);
        content.extend_from_slice(body);
        let plaintext = padding::pad(&content)?;
        let mut message = vec![0u8; plaintext.len() + AEAD_TAG_LEN];
        let len = self
            .state
            .write_message(&plaintext, &mut message)
            .map_err(from_snow)?;
        message.truncate(len);
        Ok(message)
    }

    /// Open one transport message. Any error leaves the session failed.
    pub fn open(&mut self, message: &[u8]) -> Result<Record, NoiseError> {
        if self.failed {
            return Err(NoiseError::Failed);
        }
        if self.received_close {
            return Err(NoiseError::Closed);
        }
        let result = self.open_record(message);
        match &result {
            Ok(Record::Close(_)) => self.received_close = true,
            Ok(Record::App(_)) => {}
            Err(_) => self.failed = true,
        }
        result
    }

    fn open_record(&mut self, message: &[u8]) -> Result<Record, NoiseError> {
        if message.len() > MAX_NOISE_MESSAGE_LEN {
            return Err(NoiseError::TooLarge {
                len: message.len(),
                max: MAX_NOISE_MESSAGE_LEN,
            });
        }
        let mut plaintext = vec![0u8; message.len()];
        let len = self
            .state
            .read_message(message, &mut plaintext)
            .map_err(from_snow)?;
        let content = padding::unpad(&plaintext[..len])?;
        match content.split_first() {
            Some((&RECORD_APP, body)) if !body.is_empty() => Ok(Record::App(body.to_vec())),
            Some((&RECORD_CLOSE, &[reason])) => Ok(Record::Close(CloseReason::from_code(reason))),
            _ => Err(NoiseError::BadRecord),
        }
    }

    /// The handshake hash `h` (32 bytes), equal on both ends.
    pub fn handshake_hash(&self) -> &[u8; 32] {
        &self.handshake_hash
    }

    /// We sent `CLOSE`.
    pub fn sent_close(&self) -> bool {
        self.sent_close
    }

    /// The peer sent `CLOSE`.
    pub fn received_close(&self) -> bool {
        self.received_close
    }
}

impl fmt::Debug for Transport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Transport")
            .field("sent_close", &self.sent_close)
            .field("received_close", &self.received_close)
            .field("failed", &self.failed)
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::MasterKey;

    fn psk(seed: u8) -> NoisePsk {
        MasterKey::from_bytes([seed; 32]).derive().noise_psk
    }

    fn pair() -> (Transport, Transport) {
        let (m1, client) = client_start(&psk(1)).unwrap();
        let host = host_accept(&psk(1), &m1).unwrap();
        let (m2, host_t) = host.finish(br#"{"hello":1}"#).unwrap();
        let (hello, client_t) = client.finish(&m2).unwrap();
        assert_eq!(hello, br#"{"hello":1}"#);
        assert_eq!(client_t.handshake_hash(), host_t.handshake_hash());
        (client_t, host_t)
    }

    #[test]
    fn prologue_bytes() {
        assert_eq!(
            prologue(),
            *b"galley-remote/1\x00\x01\x02\x01",
            "tag, separator, relay version, initiator client, responder host"
        );
    }

    #[test]
    fn handshake_and_records_both_ways() {
        let (mut client, mut host) = pair();
        let m = client.seal_app(b"ping").unwrap();
        assert_eq!(m.len(), 256 + AEAD_TAG_LEN, "small records pad to 256");
        assert_eq!(host.open(&m).unwrap(), Record::App(b"ping".to_vec()));
        let big = vec![b'x'; MAX_APP_RECORD_LEN];
        let m = host.seal_app(&big).unwrap();
        assert_eq!(m.len(), MAX_NOISE_MESSAGE_LEN);
        assert_eq!(client.open(&m).unwrap(), Record::App(big));
        assert!(matches!(
            host.seal_app(&vec![0; MAX_APP_RECORD_LEN + 1]),
            Err(NoiseError::TooLarge { .. })
        ));
        assert!(matches!(
            host.seal_app(&[]),
            Err(NoiseError::TooLarge { .. })
        ));
    }

    #[test]
    fn close_ends_each_direction() {
        let (mut client, mut host) = pair();
        let close = client.seal_close(CloseReason::Expired).unwrap();
        assert_eq!(client.seal_app(b"late"), Err(NoiseError::Closed));
        assert_eq!(
            host.open(&close).unwrap(),
            Record::Close(CloseReason::Expired)
        );
        assert!(host.received_close());
        // Host may still answer until it closes too; the client reads it.
        let m = host.seal_app(b"bye").unwrap();
        assert_eq!(client.open(&m).unwrap(), Record::App(b"bye".to_vec()));
        let m = host.seal_app(b"after").unwrap();
        assert_eq!(
            host.open(&m),
            Err(NoiseError::Closed),
            "nothing opens after CLOSE"
        );
        assert_eq!(CloseReason::from_code(0x7f), CloseReason::Other(0x7f));
    }

    #[test]
    fn wrong_psk_fails_at_message_one() {
        let (m1, _client) = client_start(&psk(1)).unwrap();
        assert_eq!(host_accept(&psk(2), &m1).unwrap_err(), NoiseError::Decrypt);
        assert_eq!(
            host_accept(&psk(1), &m1[..47]).unwrap_err(),
            NoiseError::BadHandshakeMessage
        );
        let mut longer = m1.clone();
        longer.push(0);
        assert_eq!(
            host_accept(&psk(1), &longer).unwrap_err(),
            NoiseError::BadHandshakeMessage
        );
    }

    #[test]
    fn tampered_message_two_is_rejected() {
        let (m1, client) = client_start(&psk(1)).unwrap();
        let (mut m2, _) = host_accept(&psk(1), &m1).unwrap().finish(b"{}").unwrap();
        let last = m2.len() - 1;
        m2[last] ^= 1;
        assert_eq!(client.finish(&m2).unwrap_err(), NoiseError::Decrypt);
    }

    #[test]
    fn hello_size_limits() {
        let (m1, _) = client_start(&psk(1)).unwrap();
        let host = host_accept(&psk(1), &m1).unwrap();
        assert!(matches!(host.finish(&[]), Err(NoiseError::TooLarge { .. })));
        let host = host_accept(&psk(1), &m1).unwrap();
        assert!(matches!(
            host.finish(&vec![b'a'; MAX_HELLO_LEN + 1]),
            Err(NoiseError::TooLarge { .. })
        ));
    }

    #[test]
    fn tampering_replay_and_reordering_fail_the_session() {
        let (mut client, mut host) = pair();
        let first = client.seal_app(b"one").unwrap();
        let second = client.seal_app(b"two").unwrap();
        // Reordered: the second message cannot open first.
        assert_eq!(host.open(&second), Err(NoiseError::Decrypt));
        assert_eq!(
            host.open(&first),
            Err(NoiseError::Failed),
            "session is dead"
        );

        let (mut client, mut host) = pair();
        let m = client.seal_app(b"one").unwrap();
        assert!(host.open(&m).is_ok());
        assert_eq!(host.open(&m), Err(NoiseError::Decrypt), "replay");

        let (mut client, mut host) = pair();
        let mut m = client.seal_app(b"one").unwrap();
        m[3] ^= 0x80;
        assert_eq!(host.open(&m), Err(NoiseError::Decrypt));
    }

    #[test]
    fn malformed_records_fail_the_session() {
        // Seal raw plaintexts that are valid Noise but not valid records.
        let raw = |plaintext: &[u8]| {
            let (mut client, host) = pair();
            let mut m = vec![0u8; plaintext.len() + AEAD_TAG_LEN];
            let n = client.state.write_message(plaintext, &mut m).unwrap();
            m.truncate(n);
            (host, m)
        };
        let cases: Vec<(Vec<u8>, NoiseError)> = vec![
            (padding::pad(&[0x09, 1]).unwrap(), NoiseError::BadRecord),
            (padding::pad(&[RECORD_APP]).unwrap(), NoiseError::BadRecord),
            (
                padding::pad(&[RECORD_CLOSE]).unwrap(),
                NoiseError::BadRecord,
            ),
            (
                padding::pad(&[RECORD_CLOSE, 0, 0]).unwrap(),
                NoiseError::BadRecord,
            ),
            (padding::pad(&[]).unwrap(), NoiseError::BadRecord),
            (
                vec![0, 1, RECORD_APP],
                NoiseError::Padding(PaddingError::NonCanonicalSize {
                    expected: 256,
                    actual: 3,
                }),
            ),
        ];
        for (plaintext, expected) in cases {
            let (mut host, m) = raw(&plaintext);
            assert_eq!(host.open(&m), Err(expected));
            assert_eq!(host.open(&m), Err(NoiseError::Failed));
        }
    }

    /// The cacophony NNpsk0 vector, through the same builder every session
    /// uses (only the prologue and the ephemerals come from the vector).
    #[test]
    fn cacophony_nnpsk0_through_the_session_builder() {
        let file: serde_json::Value =
            serde_json::from_str(include_str!("../tests/vectors/cacophony-subset.json")).unwrap();
        let vector = file["vectors"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["protocol_name"] == NOISE_PARAMS)
            .expect("vendored NNpsk0 vector");
        let hex = |key: &str| decode_hex(vector[key].as_str().unwrap());
        let key32 = |bytes: Vec<u8>| -> [u8; 32] { bytes.try_into().unwrap() };
        let psk = key32(decode_hex(vector["init_psks"][0].as_str().unwrap()));
        let mut init = build_handshake(
            &hex("init_prologue"),
            &psk,
            true,
            Some(&key32(hex("init_ephemeral"))),
        )
        .unwrap();
        let mut resp = build_handshake(
            &hex("resp_prologue"),
            &psk,
            false,
            Some(&key32(hex("resp_ephemeral"))),
        )
        .unwrap();
        let messages = vector["messages"].as_array().unwrap();
        let mut buf = vec![0u8; MAX_NOISE_MESSAGE_LEN];
        let mut out = vec![0u8; MAX_NOISE_MESSAGE_LEN];
        for (i, m) in messages.iter().take(2).enumerate() {
            let payload = decode_hex(m["payload"].as_str().unwrap());
            let (send, recv) = if i == 0 {
                (&mut init, &mut resp)
            } else {
                (&mut resp, &mut init)
            };
            let n = send.write_message(&payload, &mut buf).unwrap();
            assert_eq!(
                buf[..n],
                decode_hex(m["ciphertext"].as_str().unwrap())[..],
                "message {i}"
            );
            let k = recv.read_message(&buf[..n], &mut out).unwrap();
            assert_eq!(out[..k], payload[..]);
        }
        assert_eq!(init.get_handshake_hash(), &hex("handshake_hash")[..]);
        let mut init = init.into_transport_mode().unwrap();
        let mut resp = resp.into_transport_mode().unwrap();
        for (i, m) in messages.iter().enumerate().skip(2) {
            let payload = decode_hex(m["payload"].as_str().unwrap());
            let (send, recv) = if i % 2 == 0 {
                (&mut init, &mut resp)
            } else {
                (&mut resp, &mut init)
            };
            let n = send.write_message(&payload, &mut buf).unwrap();
            assert_eq!(
                buf[..n],
                decode_hex(m["ciphertext"].as_str().unwrap())[..],
                "message {i}"
            );
            let k = recv.read_message(&buf[..n], &mut out).unwrap();
            assert_eq!(out[..k], payload[..]);
        }
    }

    fn decode_hex(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }
}
