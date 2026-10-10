//! The channel table (design §4.2, §8): per channel key one host slot and
//! up to [`Limits::max_clients`] clients, in memory only. A channel exists
//! while it has a connection; nothing outlives the last one.

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};

use bytes::Bytes;
use galley_remote_protocol::frame::{Frame, PeerId, Role};
use galley_remote_protocol::keys::ChannelKey;
use tokio::sync::{mpsc, Notify};

use crate::apns::ApnsSender;
use crate::close;
use crate::limits::Limits;
use crate::metrics::Metrics;

/// Why the relay closes a connection; maps to [`crate::close`] codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Close {
    Shutdown,
    Protocol,
    TextMessage,
    Policy,
    TooBig,
    Replaced,
    IdleTimeout,
    TooSlow,
}

impl Close {
    pub(crate) fn code(self) -> u16 {
        match self {
            Close::Shutdown => close::GOING_AWAY,
            Close::Protocol => close::PROTOCOL_ERROR,
            Close::TextMessage => close::UNSUPPORTED_DATA,
            Close::Policy => close::POLICY_VIOLATION,
            Close::TooBig => close::MESSAGE_TOO_BIG,
            Close::Replaced => close::REPLACED,
            Close::IdleTimeout => close::IDLE_TIMEOUT,
            Close::TooSlow => close::TOO_SLOW,
        }
    }

    /// Close frame reason text: fixed words, no identifiers.
    pub(crate) fn reason(self) -> &'static str {
        match self {
            Close::Shutdown => "relay shutting down",
            Close::Protocol => "websocket protocol error",
            Close::TextMessage => "relay frames are binary",
            Close::Policy => "invalid relay frame",
            Close::TooBig => "message too big",
            Close::Replaced => "replaced by a new host",
            Close::IdleTimeout => "idle timeout",
            Close::TooSlow => "too slow to read",
        }
    }
}

/// Process state shared by every connection.
pub(crate) struct State {
    pub(crate) limits: Limits,
    pub(crate) metrics: Metrics,
    pub(crate) apns: Arc<dyn ApnsSender>,
    channels: Mutex<HashMap<ChannelKey, Channel>>,
    next_conn: AtomicU64,
}

#[derive(Default)]
struct Channel {
    host: Option<Member>,
    clients: BTreeMap<u32, Member>,
    /// Highest client id handed out in this channel's lifetime.
    last_client: u32,
}

struct Member {
    conn: u64,
    outbox: Outbox,
}

/// Why a connection cannot join its channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Refused {
    ChannelFull,
}

impl State {
    pub(crate) fn new(limits: Limits, apns: Arc<dyn ApnsSender>) -> Self {
        Self {
            limits,
            metrics: Metrics::default(),
            apns,
            channels: Mutex::new(HashMap::new()),
            next_conn: AtomicU64::new(1),
        }
    }

    fn table(&self) -> MutexGuard<'_, HashMap<ChannelKey, Channel>> {
        // Nothing under this lock can leave the table half-updated, so a
        // poisoned lock is still a consistent table.
        self.channels.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn channel_count(&self) -> usize {
        self.table().len()
    }

    /// Join a channel. Done before the 101 answer so a full channel is
    /// refused with a plain HTTP status and two racing clients cannot both
    /// take the last slot. Frames for the connection queue in the returned
    /// receiver until its WebSocket is up.
    pub(crate) fn register(
        self: &Arc<Self>,
        key: ChannelKey,
        role: Role,
    ) -> Result<(Registration, mpsc::UnboundedReceiver<Bytes>), Refused> {
        let conn = self.next_conn.fetch_add(1, Ordering::Relaxed);
        let (outbox, rx) = Outbox::new();
        let mut table = self.table();
        let peer = match role {
            Role::Host => {
                let channel = table.entry(key).or_default();
                let me = Member {
                    conn,
                    outbox: outbox.clone(),
                };
                if let Some(old) = channel.host.replace(me) {
                    old.outbox.kill(Close::Replaced);
                    self.metrics.host_replaced();
                    for client in channel.clients.values() {
                        client.outbox.push_control(peer_frame(PeerId::HOST, false));
                    }
                }
                for (&id, client) in &channel.clients {
                    client.outbox.push_control(peer_frame(PeerId::HOST, true));
                    outbox.push_control(peer_frame(PeerId(id), true));
                }
                PeerId::HOST
            }
            Role::Client => {
                // Checked before `entry` so a refusal never leaves an
                // empty channel behind.
                if let Some(channel) = table.get(&key) {
                    if channel.clients.len() >= self.limits.max_clients {
                        return Err(Refused::ChannelFull);
                    }
                }
                let channel = table.entry(key).or_default();
                // 2^32 - 1 client connections in one channel's lifetime
                // do not happen; if they did, ids are never reused, so
                // the channel stays full until it empties.
                let Some(id) = channel.last_client.checked_add(1) else {
                    return Err(Refused::ChannelFull);
                };
                channel.last_client = id;
                let peer = PeerId(id);
                if let Some(host) = &channel.host {
                    host.outbox.push_control(peer_frame(peer, true));
                }
                // A new client always learns where the host stands.
                outbox.push_control(peer_frame(PeerId::HOST, channel.host.is_some()));
                channel.clients.insert(
                    id,
                    Member {
                        conn,
                        outbox: outbox.clone(),
                    },
                );
                peer
            }
        };
        drop(table);
        self.metrics.opened(role);
        Ok((
            Registration {
                state: Arc::clone(self),
                key,
                role,
                peer,
                conn,
                outbox,
                pushes_in_flight: Arc::new(AtomicUsize::new(0)),
            },
            rx,
        ))
    }

    /// Close every connection (shutdown).
    pub(crate) fn close_all(&self, why: Close) {
        for channel in self.table().values() {
            for member in channel.host.iter().chain(channel.clients.values()) {
                member.outbox.kill(why);
            }
        }
    }
}

/// `PEER` for `peer`; the role follows from the id, so it always encodes.
fn peer_frame(peer: PeerId, online: bool) -> Vec<u8> {
    let role = if peer.is_host() {
        Role::Host
    } else {
        Role::Client
    };
    Frame::Peer { peer, role, online }
        .encode()
        .expect("PEER with a role matching its id encodes")
}

/// Where a frame from this connection goes.
pub(crate) enum Target {
    Deliver(Outbox),
    /// The addressed peer is not connected.
    NotConnected,
    /// This connection is a host that a newer host replaced; it is being
    /// closed and must not reach the channel's clients any more.
    Displaced,
}

/// One connection's membership in a channel. Dropping it leaves the
/// channel and tells the other side with `PEER` offline.
pub(crate) struct Registration {
    state: Arc<State>,
    key: ChannelKey,
    pub(crate) role: Role,
    /// [`PeerId::HOST`] for the host, the relay-assigned id for a client.
    pub(crate) peer: PeerId,
    conn: u64,
    pub(crate) outbox: Outbox,
    pub(crate) pushes_in_flight: Arc<AtomicUsize>,
}

impl Registration {
    /// For a host, client `to`; for a client, the host (`to` is ignored).
    pub(crate) fn target(&self, to: PeerId) -> Target {
        let table = self.state.table();
        let Some(channel) = table.get(&self.key) else {
            return Target::Displaced;
        };
        let member = match self.role {
            Role::Host => {
                if channel.host.as_ref().map(|h| h.conn) != Some(self.conn) {
                    return Target::Displaced;
                }
                channel.clients.get(&to.0)
            }
            Role::Client => channel.host.as_ref(),
        };
        match member {
            Some(m) => Target::Deliver(m.outbox.clone()),
            None => Target::NotConnected,
        }
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        let mut table = self.state.table();
        if let Some(channel) = table.get_mut(&self.key) {
            match self.role {
                Role::Host => {
                    if channel.host.as_ref().map(|h| h.conn) == Some(self.conn) {
                        channel.host = None;
                        for client in channel.clients.values() {
                            client.outbox.push_control(peer_frame(PeerId::HOST, false));
                        }
                    }
                }
                Role::Client => {
                    let mine = channel.clients.get(&self.peer.0).map(|c| c.conn) == Some(self.conn);
                    if mine {
                        channel.clients.remove(&self.peer.0);
                        if let Some(host) = &channel.host {
                            host.outbox.push_control(peer_frame(self.peer, false));
                        }
                    }
                }
            }
            if channel.host.is_none() && channel.clients.is_empty() {
                table.remove(&self.key);
            }
        }
        drop(table);
        self.state.metrics.closed(self.role);
    }
}

/// What the relay has queued for one connection, and the switch that
/// closes it. Cloned into the channel table and into forwarding.
#[derive(Clone)]
pub(crate) struct Outbox {
    tx: mpsc::UnboundedSender<Bytes>,
    shared: Arc<OutboxShared>,
}

struct OutboxShared {
    /// Bytes handed to the queue and not yet written to the socket.
    queued: AtomicUsize,
    /// Signalled after each write, and on kill.
    drained: Notify,
    killed: OnceLock<Close>,
    kill_signal: Notify,
}

impl Outbox {
    fn new() -> (Self, mpsc::UnboundedReceiver<Bytes>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let shared = Arc::new(OutboxShared {
            queued: AtomicUsize::new(0),
            drained: Notify::new(),
            killed: OnceLock::new(),
            kill_signal: Notify::new(),
        });
        (Self { tx, shared }, rx)
    }

    /// Queue a small relay-made frame (`PEER`, `PONG`, `PUSH_RESULT`)
    /// without waiting: these are bounded by the traffic that causes them.
    pub(crate) fn push_control(&self, bytes: Vec<u8>) {
        if self.is_killed() {
            return;
        }
        self.shared.queued.fetch_add(bytes.len(), Ordering::AcqRel);
        let _ = self.tx.send(Bytes::from(bytes));
    }

    /// Queue a forwarded `DATA` frame. While the queue is over `limit`,
    /// waits for the writer to make progress; if it makes none for
    /// `stall`, closes this (receiving) connection as too slow and drops
    /// the frame. Returns whether the frame was queued.
    pub(crate) async fn push_data(&self, bytes: Vec<u8>, limits: &Limits) -> bool {
        let len = bytes.len();
        loop {
            if self.is_killed() {
                return false;
            }
            let drained = self.shared.drained.notified();
            tokio::pin!(drained);
            // Register before checking, so a write between the check and
            // the wait still wakes us.
            drained.as_mut().enable();
            let reserved = self
                .shared
                .queued
                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |queued| {
                    (queued == 0 || queued + len <= limits.outbound_queue_bytes)
                        .then_some(queued + len)
                })
                .is_ok();
            if reserved {
                let _ = self.tx.send(Bytes::from(bytes));
                return true;
            }
            if tokio::time::timeout(limits.stall_timeout, drained)
                .await
                .is_err()
            {
                self.kill(Close::TooSlow);
                return false;
            }
        }
    }

    /// The writer wrote `len` bytes of this queue to the socket.
    pub(crate) fn written(&self, len: usize) {
        self.shared.queued.fetch_sub(len, Ordering::AcqRel);
        self.shared.drained.notify_waiters();
    }

    /// Close this connection. The first reason wins.
    pub(crate) fn kill(&self, why: Close) {
        if self.shared.killed.set(why).is_ok() {
            self.shared.kill_signal.notify_one();
            self.shared.drained.notify_waiters();
        }
    }

    fn is_killed(&self) -> bool {
        self.shared.killed.get().is_some()
    }

    /// Resolves once [`Outbox::kill`] was called, with its reason. One
    /// waiter (the connection task).
    pub(crate) async fn killed(&self) -> Close {
        loop {
            if let Some(why) = self.shared.killed.get() {
                return *why;
            }
            self.shared.kill_signal.notified().await;
        }
    }
}
