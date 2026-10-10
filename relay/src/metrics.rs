//! Counters without identifiers (design §4.4): no channel key, no peer
//! id, no IP, no token. Served as JSON on the loopback metrics port;
//! [`Metrics::snapshot`] lists every key.
//!
//! Counters run from process start. A per-day figure is the difference
//! between two reads (the deployment's job, ticket 06c).

use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::time::Instant;

use galley_remote_protocol::frame::{PushStatus, Role};
use serde_json::{json, Map, Value};

/// Why a connection was closed or a frame refused, as counted under
/// `errors`. The first five are [`galley_remote_protocol::frame::FrameError::label`].
pub const ERROR_LABELS: &[&str] = &[
    "empty",
    "unknown_type",
    "truncated",
    "trailing_bytes",
    "invalid_field",
    // A text WebSocket message (relay frames are binary).
    "text_message",
    // A WebSocket message over the largest relay frame.
    "oversize",
    // WebSocket framing broken below the relay frame layer.
    "ws_protocol",
    // A frame type the sender's role may not send (`PEER`, `PONG`,
    // `PUSH_RESULT` from anyone; `PUSH` from a client).
    "wrong_direction",
    // A client's `DATA` naming a peer other than 0.
    "bad_peer",
    "idle_timeout",
    // Did not drain its queue within the stall timeout.
    "slow_consumer",
    // Answered 101 but the upgrade never completed.
    "upgrade_failed",
];

/// Why an HTTP request was refused before any upgrade, under `rejected`.
pub const REJECT_LABELS: &[&str] = &[
    "not_found",
    "method_not_allowed",
    // Not a valid WebSocket upgrade, or a query string on the URL.
    "bad_request",
    "bad_relay_version",
    "bad_role",
    "bad_channel",
    "channel_full",
];

/// Frames the relay could not deliver because the other side was not
/// there, under `dropped`. Not errors: the `PEER` notice is on its way.
pub const DROP_LABELS: &[&str] = &[
    // Host `DATA` for a client id that is not connected.
    "unknown_peer",
    // Client `DATA` while no host is connected.
    "no_host",
];

struct Labeled {
    labels: &'static [&'static str],
    values: Vec<AtomicU64>,
}

impl Labeled {
    fn new(labels: &'static [&'static str]) -> Self {
        Self {
            labels,
            values: labels.iter().map(|_| AtomicU64::new(0)).collect(),
        }
    }

    fn inc(&self, label: &str) {
        match self.labels.iter().position(|l| *l == label) {
            Some(i) => {
                self.values[i].fetch_add(1, Relaxed);
            }
            None => debug_assert!(false, "unknown counter label {label}"),
        }
    }

    fn to_json(&self) -> Value {
        let map: Map<String, Value> = self
            .labels
            .iter()
            .zip(&self.values)
            .map(|(label, v)| ((*label).to_string(), json!(v.load(Relaxed))))
            .collect();
        Value::Object(map)
    }
}

/// Process-wide counters.
pub(crate) struct Metrics {
    started: Instant,
    hosts: AtomicU64,
    clients: AtomicU64,
    hosts_total: AtomicU64,
    clients_total: AtomicU64,
    hosts_replaced: AtomicU64,
    bytes_in: AtomicU64,
    bytes_out: AtomicU64,
    frames_in: AtomicU64,
    frames_out: AtomicU64,
    pushes_requested: AtomicU64,
    pushes_ok: AtomicU64,
    pushes_unregistered: AtomicU64,
    pushes_failed: AtomicU64,
    errors: Labeled,
    rejected: Labeled,
    dropped: Labeled,
}

impl Default for Metrics {
    fn default() -> Self {
        Self {
            started: Instant::now(),
            hosts: AtomicU64::new(0),
            clients: AtomicU64::new(0),
            hosts_total: AtomicU64::new(0),
            clients_total: AtomicU64::new(0),
            hosts_replaced: AtomicU64::new(0),
            bytes_in: AtomicU64::new(0),
            bytes_out: AtomicU64::new(0),
            frames_in: AtomicU64::new(0),
            frames_out: AtomicU64::new(0),
            pushes_requested: AtomicU64::new(0),
            pushes_ok: AtomicU64::new(0),
            pushes_unregistered: AtomicU64::new(0),
            pushes_failed: AtomicU64::new(0),
            errors: Labeled::new(ERROR_LABELS),
            rejected: Labeled::new(REJECT_LABELS),
            dropped: Labeled::new(DROP_LABELS),
        }
    }
}

impl Metrics {
    pub(crate) fn opened(&self, role: Role) {
        match role {
            Role::Host => {
                self.hosts.fetch_add(1, Relaxed);
                self.hosts_total.fetch_add(1, Relaxed);
            }
            Role::Client => {
                self.clients.fetch_add(1, Relaxed);
                self.clients_total.fetch_add(1, Relaxed);
            }
        }
    }

    pub(crate) fn closed(&self, role: Role) {
        match role {
            Role::Host => self.hosts.fetch_sub(1, Relaxed),
            Role::Client => self.clients.fetch_sub(1, Relaxed),
        };
    }

    /// Connections registered right now (including ones mid-upgrade).
    pub(crate) fn open_connections(&self) -> u64 {
        self.hosts.load(Relaxed) + self.clients.load(Relaxed)
    }

    pub(crate) fn host_replaced(&self) {
        self.hosts_replaced.fetch_add(1, Relaxed);
    }

    /// One WebSocket data message received (`bytes` of payload).
    pub(crate) fn received(&self, bytes: usize) {
        self.frames_in.fetch_add(1, Relaxed);
        self.bytes_in.fetch_add(bytes as u64, Relaxed);
    }

    /// One relay frame written to a connection.
    pub(crate) fn sent(&self, bytes: usize) {
        self.frames_out.fetch_add(1, Relaxed);
        self.bytes_out.fetch_add(bytes as u64, Relaxed);
    }

    pub(crate) fn push_requested(&self) {
        self.pushes_requested.fetch_add(1, Relaxed);
    }

    pub(crate) fn push_answered(&self, status: PushStatus) {
        match status {
            PushStatus::Ok => &self.pushes_ok,
            PushStatus::Unregistered => &self.pushes_unregistered,
            PushStatus::Failed => &self.pushes_failed,
        }
        .fetch_add(1, Relaxed);
    }

    pub(crate) fn error(&self, label: &str) {
        self.errors.inc(label);
    }

    pub(crate) fn rejected(&self, label: &str) {
        self.rejected.inc(label);
    }

    pub(crate) fn dropped(&self, label: &str) {
        self.dropped.inc(label);
    }

    /// The JSON the metrics port serves. `channels` and `jwt_refreshes`
    /// are passed in because the channel table and the APNs sender, not
    /// this struct, know them.
    pub(crate) fn snapshot(&self, channels: usize, jwt_refreshes: u64) -> Value {
        json!({
            "version": env!("CARGO_PKG_VERSION"),
            "uptimeSeconds": self.started.elapsed().as_secs(),
            "channels": channels,
            "connections": {
                "host": self.hosts.load(Relaxed),
                "client": self.clients.load(Relaxed),
            },
            "connectionsTotal": {
                "host": self.hosts_total.load(Relaxed),
                "client": self.clients_total.load(Relaxed),
            },
            "hostsReplaced": self.hosts_replaced.load(Relaxed),
            "bytesIn": self.bytes_in.load(Relaxed),
            "bytesOut": self.bytes_out.load(Relaxed),
            "framesIn": self.frames_in.load(Relaxed),
            "framesOut": self.frames_out.load(Relaxed),
            "pushes": {
                "requested": self.pushes_requested.load(Relaxed),
                "ok": self.pushes_ok.load(Relaxed),
                "unregistered": self.pushes_unregistered.load(Relaxed),
                "failed": self.pushes_failed.load(Relaxed),
                // Provider tokens signed, the first one included: about one
                // per 50 minutes of pushing, more when APNs rejected one.
                "jwtRefreshes": jwt_refreshes,
            },
            "errors": self.errors.to_json(),
            "rejected": self.rejected.to_json(),
            "dropped": self.dropped.to_json(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use galley_remote_protocol::frame::FrameError;

    #[test]
    fn frame_error_labels_are_counted() {
        let errors = [
            FrameError::Empty,
            FrameError::UnknownType(0),
            FrameError::Truncated { frame: "DATA" },
            FrameError::TrailingBytes { frame: "PING" },
            FrameError::InvalidField {
                frame: "PEER",
                field: "role",
            },
        ];
        for e in errors {
            assert!(ERROR_LABELS.contains(&e.label()), "{}", e.label());
        }
    }

    #[test]
    fn snapshot_lists_every_label_at_zero() {
        let m = Metrics::default();
        m.error("truncated");
        m.rejected("channel_full");
        let snap = m.snapshot(0, 3);
        assert_eq!(snap["errors"]["truncated"], 1);
        assert_eq!(snap["errors"]["empty"], 0);
        assert_eq!(snap["rejected"]["channel_full"], 1);
        assert_eq!(
            snap["errors"].as_object().unwrap().len(),
            ERROR_LABELS.len()
        );
        assert_eq!(snap["dropped"]["no_host"], 0);
        assert_eq!(snap["pushes"]["jwtRefreshes"], 3);
    }
}
