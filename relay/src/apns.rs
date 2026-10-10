//! The seam between the relay and APNs (design §4.3).
//!
//! A host's `PUSH` reaches an [`ApnsSender`]; whatever it answers goes back
//! to that host as `PUSH_RESULT`. Ticket 06b implements the real sender
//! (ES256 JWT, HTTP/2 to `api.push.apple.com` or the sandbox, the payload
//! from [`galley_remote_protocol::push::apns_payload`]). Until then the
//! relay runs with [`PushUnavailable`].

use async_trait::async_trait;
use galley_remote_protocol::frame::{PushRequest, PushStatus};

/// `reason` of [`PushUnavailable`]: this relay has no APNs sender.
pub const REASON_PUSH_UNAVAILABLE: &str = "push_unavailable";
/// `reason` when a host already has [`crate::Limits::max_pushes_in_flight`]
/// pushes waiting on APNs.
pub const REASON_PUSH_BUSY: &str = "push_busy";
/// `reason` when a sender's answer is not a valid `PUSH_RESULT` (e.g.
/// `Ok` without HTTP 200, or a reason that is not printable ASCII).
pub const REASON_RELAY_ERROR: &str = "relay_error";

/// What APNs said about one push, or why the relay did not ask it. The
/// relay adds the host's `request_id` and sends it back as `PUSH_RESULT`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApnsResponse {
    /// `Ok` must come with 200 and `Unregistered` with 410
    /// ([`galley_remote_protocol::frame::PushResult`]).
    pub status: PushStatus,
    /// APNs' HTTP status; `0` when APNs never answered.
    pub apns_status: u16,
    /// APNs' `reason` or a short relay code; printable ASCII, at most 255
    /// bytes, may be empty.
    pub reason: String,
}

impl ApnsResponse {
    /// A failure APNs never saw (`apns_status` 0).
    pub fn not_sent(reason: &str) -> Self {
        Self {
            status: PushStatus::Failed,
            apns_status: 0,
            reason: reason.to_string(),
        }
    }
}

/// Sends one push to APNs. Called once per `PUSH`, concurrently, from its
/// own task; the host's connection keeps running meanwhile.
///
/// `push.device_token` and `push.env` pick the device and endpoint;
/// `push.sealed` is opaque ciphertext for the APNs `g` field. An
/// implementation must not log or keep any of them.
#[async_trait]
pub trait ApnsSender: Send + Sync + 'static {
    async fn send(&self, push: &PushRequest) -> ApnsResponse;
}

/// The default sender until ticket 06b: every push fails with
/// [`REASON_PUSH_UNAVAILABLE`] and `apns_status` 0.
#[derive(Debug, Default, Clone, Copy)]
pub struct PushUnavailable;

#[async_trait]
impl ApnsSender for PushUnavailable {
    async fn send(&self, _push: &PushRequest) -> ApnsResponse {
        ApnsResponse::not_sent(REASON_PUSH_UNAVAILABLE)
    }
}
