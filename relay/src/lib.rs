//! Galley relay: a stateless WebSocket forwarder between one desktop Core
//! (`host`) and its paired phones (`client`), per channel.
//!
//! Design: `.scratch/ios-client/issues/05-remote-protocol-design.md`
//! (cited below as "design §N"), §4 and §8. What the relay sees and does,
//! against `AGENTS.md` Rule 2:
//!
//! - It sees relay frames ([`galley_remote_protocol::frame`]): Noise
//!   ciphertext it cannot open, plus routing metadata (channel key, role,
//!   peer ids, sizes, timing, push requests with their sealed content).
//!   It wraps a push's sealed content into the APNs payload and sends it
//!   ([`apns`]); it holds no key that opens it.
//! - It stores nothing: one in-memory channel table and counters without
//!   identifiers ([`metrics`]). No access log; stderr carries startup,
//!   shutdown and server errors only.
//! - It cannot issue commands: it holds no key, and it only forwards,
//!   answers `PING`, announces `PEER` changes and reports `PUSH` outcomes.
//!
//! It listens on plain HTTP / WebSocket (Caddy terminates TLS in front of
//! it): `GET /v1/connect` upgrades after the `X-Galley-*` headers check out
//! ([`http`]); a separate loopback port serves the counters as JSON.

#![forbid(unsafe_code)]

pub mod apns;
mod channels;
mod conn;
mod http;
pub mod limits;
pub mod metrics;
mod server;

pub use apns::{ApnsClient, ApnsConfig, ApnsResponse, ApnsSender, PushUnavailable};
pub use limits::Limits;
pub use server::Server;

/// WebSocket close codes the relay sends. 1000–1015 are RFC 6455's;
/// 4000–4999 are application codes (design §4.4).
pub mod close {
    /// The relay is shutting down. Reconnect with backoff.
    pub const GOING_AWAY: u16 = 1001;
    /// A WebSocket protocol error (bad framing, invalid UTF-8 text).
    pub const PROTOCOL_ERROR: u16 = 1002;
    /// A text message: relay frames are binary.
    pub const UNSUPPORTED_DATA: u16 = 1003;
    /// A frame that does not decode, goes the wrong way, or names the
    /// wrong peer.
    pub const POLICY_VIOLATION: u16 = 1008;
    /// A message larger than the largest relay frame.
    pub const MESSAGE_TOO_BIG: u16 = 1009;
    /// A new host connected to the same channel and took over.
    pub const REPLACED: u16 = 4001;
    /// Nothing was received for [`crate::Limits::idle_timeout`].
    pub const IDLE_TIMEOUT: u16 = 4002;
    /// This connection did not read what the relay had for it within
    /// [`crate::Limits::stall_timeout`].
    pub const TOO_SLOW: u16 = 4003;
}
