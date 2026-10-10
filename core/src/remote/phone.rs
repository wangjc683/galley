//! One phone on the relay connection: its end-to-end Noise session
//! (design §5) and its bounded out-queue (design §6.5).
//!
//! A phone is keyed by the relay's peer id. Its first `DATA` is the Noise
//! handshake request; Core answers with its hello and the session is
//! established. From then on every `DATA` is one transport record: an
//! `APP` record carries one app message or chunk (reassembled here), a
//! `CLOSE` record ends the session. Any record that fails to open ends
//! it too ([`galley_remote_protocol::noise::Transport`] refuses to go on).
//!
//! Outgoing messages wait in [`OutQueue`] as plaintext record bodies and
//! are sealed only when they leave, so an event dropped for a slow phone
//! never costs a Noise nonce the phone would then miss. Responses are
//! never dropped; events are bounded, and when the bound is hit the
//! queued `runner.event` increments go first, state events stay, and the
//! phone is told to re-read (`sync.required`).

use galley_remote_protocol::app::{
    chunk::{Chunker, Reassembler},
    AppError, AppEvent, Envelope, SyncRequiredEvent,
};
use galley_remote_protocol::keys::NoisePsk;
use galley_remote_protocol::noise::{self, CloseReason, NoiseError, Record, Transport};
use std::collections::{BTreeSet, VecDeque};
use std::time::Instant;

/// What an outgoing message is, for the queue's shedding rules.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Kind {
    /// The answer to a request: never dropped.
    Response,
    /// A state event (`session.*`, `message.persisted`, …): kept while
    /// `runner.event`s are shed.
    State,
    /// A `runner.event` batch for one session: shed first.
    Runner(String),
    /// A queued `sync.required` (`None`: re-read everything).
    Sync(Option<String>),
    /// The handshake answer or the `CLOSE` record.
    Control,
}

impl Kind {
    fn is_event(&self) -> bool {
        matches!(self, Kind::State | Kind::Runner(_) | Kind::Sync(_))
    }
}

/// One record's worth of outgoing data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Body {
    /// An `APP` record body (one message or chunk), sealed on the way out.
    App(Vec<u8>),
    /// A handshake message, sent as it is.
    Raw(Vec<u8>),
    /// The end-of-session marker.
    Close(CloseReason),
}

impl Body {
    fn len(&self) -> usize {
        match self {
            Body::App(bytes) | Body::Raw(bytes) => bytes.len(),
            Body::Close(_) => 1,
        }
    }
}

#[derive(Debug)]
struct Item {
    kind: Kind,
    bodies: VecDeque<Body>,
    /// Bytes still queued in `bodies`.
    bytes: usize,
    /// A body already left: the rest must follow (a chunk stream cut
    /// short would leave the phone holding half a message).
    started: bool,
}

/// A phone's out-queue. Bounds apply to events only.
#[derive(Debug)]
pub(super) struct OutQueue {
    items: VecDeque<Item>,
    events: usize,
    event_bytes: usize,
    max_events: usize,
    max_event_bytes: usize,
}

impl OutQueue {
    pub(super) fn new(max_events: usize, max_event_bytes: usize) -> Self {
        Self {
            items: VecDeque::new(),
            events: 0,
            event_bytes: 0,
            max_events: max_events.max(1),
            max_event_bytes: max_event_bytes.max(1),
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    fn push_item(&mut self, kind: Kind, bodies: Vec<Body>) {
        if bodies.is_empty() {
            return;
        }
        let bytes = bodies.iter().map(Body::len).sum();
        if kind.is_event() {
            self.events += 1;
            self.event_bytes += bytes;
        }
        self.items.push_back(Item {
            kind,
            bodies: bodies.into(),
            bytes,
            started: false,
        });
    }

    /// A response or control message: always queued.
    pub(super) fn push(&mut self, kind: Kind, bodies: Vec<Body>) {
        debug_assert!(!kind.is_event());
        self.push_item(kind, bodies);
    }

    /// Queue `CLOSE` after the responses already waiting (a
    /// `protocol_mismatch` answer must reach the phone before it), dropping
    /// unsent events: the phone re-syncs on its next session anyway.
    pub(super) fn push_close(&mut self, reason: CloseReason) {
        self.retain_unstarted(|item| !item.kind.is_event());
        self.push_item(Kind::Control, vec![Body::Close(reason)]);
    }

    fn fits(&self, bytes: usize) -> bool {
        self.events < self.max_events && self.event_bytes + bytes <= self.max_event_bytes
    }

    /// Queue an event (`kind` is [`Kind::State`] or [`Kind::Runner`]).
    /// Over the bound: shed the queued `runner.event`s (and this one, if
    /// it is one), keep the state events, and queue a `sync.required` per
    /// session that lost increments; if state events alone still do not
    /// fit, shed every unsent event and queue one `sync.required` for
    /// everything. Returns `true` when anything was shed.
    pub(super) fn push_event(&mut self, kind: Kind, bodies: Vec<Body>) -> bool {
        debug_assert!(matches!(kind, Kind::State | Kind::Runner(_)));
        let bytes: usize = bodies.iter().map(Body::len).sum();
        if self.fits(bytes) {
            self.push_item(kind, bodies);
            return false;
        }
        let mut lost = BTreeSet::new();
        self.retain_unstarted(|item| match &item.kind {
            Kind::Runner(session) => {
                lost.insert(session.clone());
                false
            }
            _ => true,
        });
        let state_fits = match kind {
            Kind::Runner(session) => {
                lost.insert(session);
                true
            }
            other => {
                let fits = self.fits(bytes);
                if fits {
                    self.push_item(other, bodies);
                }
                fits
            }
        };
        if !state_fits {
            self.require_full_sync();
            return true;
        }
        // The markers are a few dozen bytes, at most one per session, and
        // always admitted: they are what makes shedding safe.
        for session in lost {
            self.require_sync(Some(session));
        }
        true
    }

    /// Queue `sync.required` for everything, dropping every unsent event
    /// (the phone re-reads all of it anyway).
    pub(super) fn require_full_sync(&mut self) {
        self.retain_unstarted(|item| !item.kind.is_event());
        self.require_sync(None);
    }

    /// Queue `sync.required` for `session` unless an unsent one already
    /// covers it.
    fn require_sync(&mut self, session: Option<String>) {
        let covered = self.items.iter().any(|item| {
            !item.started
                && match &item.kind {
                    Kind::Sync(None) => true,
                    Kind::Sync(queued) => session.is_some() && *queued == session,
                    _ => false,
                }
        });
        if covered {
            return;
        }
        let event = AppEvent::SyncRequired(SyncRequiredEvent {
            session_id: session.clone(),
        })
        .to_event();
        // A `sync.required` is far below one record.
        let body = Envelope::Event(event).to_json();
        self.push_item(Kind::Sync(session), vec![Body::App(body)]);
    }

    /// Keep the unstarted items `keep` accepts (started items always stay).
    fn retain_unstarted(&mut self, mut keep: impl FnMut(&Item) -> bool) {
        let mut events = 0;
        let mut event_bytes = 0;
        self.items.retain(|item| {
            let stays = item.started || keep(item);
            if stays && item.kind.is_event() {
                events += 1;
                event_bytes += item.bytes;
            }
            stays
        });
        self.events = events;
        self.event_bytes = event_bytes;
    }

    /// The next record to send, in order.
    pub(super) fn pop(&mut self) -> Option<Body> {
        let item = self.items.front_mut()?;
        let body = item.bodies.pop_front()?;
        item.started = true;
        item.bytes -= body.len();
        let is_event = item.kind.is_event();
        if is_event {
            self.event_bytes -= body.len();
        }
        if item.bodies.is_empty() {
            self.items.pop_front();
            if is_event {
                self.events -= 1;
            }
        }
        Some(body)
    }

    #[cfg(test)]
    fn kinds(&self) -> Vec<Kind> {
        self.items.iter().map(|item| item.kind.clone()).collect()
    }
}

/// An established end-to-end session.
pub(super) struct Session {
    transport: Transport,
    since: Instant,
    reassembler: Reassembler,
    chunker: Chunker,
}

pub(super) enum Stage {
    /// Waiting for the Noise handshake request.
    Handshake,
    Established(Box<Session>),
}

/// What one received `DATA` amounted to.
pub(super) enum Inbound {
    /// The handshake succeeded; its answer is queued.
    Established,
    /// A complete app message.
    Message(Envelope),
    /// A record that carried nothing complete yet (a chunk), or a message
    /// the phone garbled at the app layer (logged, skipped).
    Nothing,
    /// The phone ended the session.
    Closed(CloseReason),
    /// The session is unusable (bad handshake, a record that failed to
    /// open); the phone is dropped.
    Failed(&'static str),
}

/// What went wrong with a phone's message, without quoting it: a JSON
/// error's text can carry the plaintext.
fn app_error_label(error: &AppError) -> &'static str {
    match error {
        AppError::Json(_) => "not valid JSON",
        AppError::UnknownType(_) => "unknown message type",
        AppError::MissingField { .. } => "missing field",
        AppError::Inconsistent(_) => "inconsistent fields",
        AppError::BadChunk(what) => what,
        AppError::TooLarge { .. } => "over the reassembly limit",
        AppError::TooManyStreams { .. } => "too many chunked messages in flight",
    }
}

/// One phone on the current relay connection.
pub(super) struct Phone {
    /// Unique per session across the module's life, so a response from a
    /// request of an earlier session never reaches a later one.
    pub(super) generation: u64,
    pub(super) stage: Stage,
    pub(super) queue: OutQueue,
    /// Sessions this phone receives `runner.event` for.
    pub(super) subscriptions: BTreeSet<String>,
    /// Records sent, for round-robin fairness between phones.
    pub(super) sent: u64,
    /// A `CLOSE` is queued: nothing new is queued or read.
    closing: bool,
    /// A `CLOSE` was sealed: drop the phone once it is out.
    pub(super) closed: bool,
}

impl Phone {
    pub(super) fn new(generation: u64, max_events: usize, max_event_bytes: usize) -> Self {
        Self {
            generation,
            stage: Stage::Handshake,
            queue: OutQueue::new(max_events, max_event_bytes),
            subscriptions: BTreeSet::new(),
            sent: 0,
            closing: false,
            closed: false,
        }
    }

    pub(super) fn closing(&self) -> bool {
        self.closing
    }

    /// End the session after what is already queued for it: queue `CLOSE`
    /// (see [`OutQueue::push_close`]) and accept nothing new.
    pub(super) fn begin_close(&mut self, reason: CloseReason) {
        if self.closing || self.closed || !self.is_established() {
            return;
        }
        self.closing = true;
        self.queue.push_close(reason);
    }

    pub(super) fn is_established(&self) -> bool {
        matches!(self.stage, Stage::Established(_))
    }

    /// When the session was established.
    pub(super) fn established_at(&self) -> Option<Instant> {
        match &self.stage {
            Stage::Established(session) => Some(session.since),
            Stage::Handshake => None,
        }
    }

    /// Handle one `DATA` payload from this phone.
    pub(super) fn receive(&mut self, psk: &NoisePsk, hello: &[u8], payload: &[u8]) -> Inbound {
        match &mut self.stage {
            Stage::Handshake => {
                let accepted =
                    noise::host_accept(psk, payload).and_then(|handshake| handshake.finish(hello));
                match accepted {
                    Ok((reply, transport)) => {
                        self.stage = Stage::Established(Box::new(Session {
                            transport,
                            since: Instant::now(),
                            reassembler: Reassembler::new(),
                            chunker: Chunker::new(),
                        }));
                        self.queue.push(Kind::Control, vec![Body::Raw(reply)]);
                        Inbound::Established
                    }
                    Err(NoiseError::Decrypt) => Inbound::Failed("handshake: wrong key"),
                    Err(_) => Inbound::Failed("handshake: malformed"),
                }
            }
            Stage::Established(session) => match session.transport.open(payload) {
                Ok(Record::Close(reason)) => Inbound::Closed(reason),
                Ok(Record::App(body)) => {
                    let envelope = match Envelope::from_json(&body) {
                        Ok(envelope) => envelope,
                        Err(e) => {
                            let why = app_error_label(&e);
                            eprintln!("[remote] dropped an unreadable app message ({why})");
                            return Inbound::Nothing;
                        }
                    };
                    match session.reassembler.push(envelope) {
                        Ok(Some(message)) => Inbound::Message(message),
                        Ok(None) => Inbound::Nothing,
                        Err(e) => {
                            let why = app_error_label(&e);
                            eprintln!("[remote] dropped a chunked message ({why})");
                            Inbound::Nothing
                        }
                    }
                }
                Err(_) => Inbound::Failed("record failed to open"),
            },
        }
    }

    /// Record bodies for `envelope` (chunked when large), or `None`
    /// before the session is established.
    pub(super) fn encode(&mut self, envelope: &Envelope) -> Option<Result<Vec<Body>, String>> {
        let Stage::Established(session) = &mut self.stage else {
            return None;
        };
        Some(
            session
                .chunker
                .encode(envelope)
                .map(|bodies| bodies.into_iter().map(Body::App).collect())
                .map_err(|e| e.to_string()),
        )
    }

    /// Seal and return the next Noise message to send. `Err` means the
    /// session cannot seal any more (drop the phone).
    pub(super) fn next_message(&mut self) -> Option<Result<Vec<u8>, NoiseError>> {
        if self.closed {
            return None;
        }
        let body = self.queue.pop()?;
        let sealed = match body {
            Body::Raw(message) => Ok(message),
            Body::App(bytes) => match &mut self.stage {
                Stage::Established(session) => session.transport.seal_app(&bytes),
                Stage::Handshake => Err(NoiseError::Failed),
            },
            Body::Close(reason) => {
                self.closed = true;
                match &mut self.stage {
                    Stage::Established(session) => session.transport.seal_close(reason),
                    Stage::Handshake => Err(NoiseError::Failed),
                }
            }
        };
        self.sent += 1;
        Some(sealed)
    }

    /// Seal `CLOSE` at once, past anything queued (the connection is
    /// going away). `None` before the session is established.
    pub(super) fn seal_close_now(&mut self, reason: CloseReason) -> Option<Vec<u8>> {
        if self.closed {
            return None;
        }
        let Stage::Established(session) = &mut self.stage else {
            return None;
        };
        self.closed = true;
        session.transport.seal_close(reason).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(n: usize) -> Vec<Body> {
        vec![Body::App(vec![b'x'; n])]
    }

    fn runner(session: &str) -> Kind {
        Kind::Runner(session.into())
    }

    fn sync(session: Option<&str>) -> Kind {
        Kind::Sync(session.map(str::to_string))
    }

    #[test]
    fn responses_are_never_shed_and_do_not_count() {
        let mut q = OutQueue::new(2, 1000);
        for _ in 0..10 {
            q.push(Kind::Response, body(500));
        }
        assert!(!q.push_event(Kind::State, body(10)));
        assert!(!q.push_event(runner("s1"), body(10)));
        assert_eq!(q.kinds().len(), 12);
    }

    #[test]
    fn overflow_sheds_runner_events_first_and_asks_for_their_sessions() {
        let mut q = OutQueue::new(4, 10_000);
        assert!(!q.push_event(runner("s1"), body(10)));
        assert!(!q.push_event(Kind::State, body(10)));
        assert!(!q.push_event(runner("s2"), body(10)));
        assert!(!q.push_event(runner("s1"), body(10)));
        // Full: the runner events go, the state event stays, the new
        // state event is queued, each session that lost increments gets
        // its own sync.required.
        assert!(q.push_event(Kind::State, body(10)));
        assert_eq!(
            q.kinds(),
            vec![Kind::State, Kind::State, sync(Some("s1")), sync(Some("s2"))]
        );
        // A runner event arriving at a full queue is shed itself; the
        // session already has a sync queued, so no duplicate.
        assert!(q.push_event(runner("s1"), body(10)));
        assert_eq!(
            q.kinds(),
            vec![Kind::State, Kind::State, sync(Some("s1")), sync(Some("s2"))]
        );
    }

    #[test]
    fn state_events_alone_overflowing_collapse_into_one_full_sync() {
        let mut q = OutQueue::new(3, 10_000);
        for _ in 0..3 {
            assert!(!q.push_event(Kind::State, body(10)));
        }
        assert!(q.push_event(Kind::State, body(10)));
        assert_eq!(q.kinds(), vec![sync(None)]);
        // The full sync covers per-session ones too.
        assert!(!q.push_event(runner("s1"), body(10)));
        assert!(!q.push_event(Kind::State, body(10)));
        assert!(q.push_event(runner("s2"), body(10)));
        assert_eq!(q.kinds(), vec![sync(None), Kind::State]);
    }

    #[test]
    fn the_byte_bound_counts_too() {
        let mut q = OutQueue::new(100, 100);
        assert!(!q.push_event(runner("s1"), body(60)));
        assert!(q.push_event(Kind::State, body(60)));
        assert_eq!(q.kinds(), vec![Kind::State, sync(Some("s1"))]);
    }

    #[test]
    fn a_started_message_is_finished_before_anything_is_shed() {
        let mut q = OutQueue::new(1, 10_000);
        q.push_event(
            runner("s1"),
            vec![Body::App(b"chunk0".to_vec()), Body::App(b"chunk1".to_vec())],
        );
        assert_eq!(q.pop(), Some(Body::App(b"chunk0".to_vec())));
        // Over the bound, but the half-sent stream stays.
        assert!(q.push_event(runner("s1"), body(5)));
        assert_eq!(q.pop(), Some(Body::App(b"chunk1".to_vec())));
        let Some(Body::App(json)) = q.pop() else {
            panic!("sync.required expected");
        };
        let text = String::from_utf8(json).unwrap();
        assert!(
            text.contains("sync.required") && text.contains("s1"),
            "{text}"
        );
        assert_eq!(q.pop(), None);
        assert!(q.is_empty());
    }

    #[test]
    fn close_follows_waiting_responses_and_drops_waiting_events() {
        let mut q = OutQueue::new(10, 10_000);
        q.push_event(Kind::State, body(3));
        q.push(Kind::Response, body(4));
        q.push_event(runner("s1"), body(3));
        q.push_close(CloseReason::VersionMismatch);
        assert_eq!(q.pop(), Some(Body::App(vec![b'x'; 4])));
        assert_eq!(q.pop(), Some(Body::Close(CloseReason::VersionMismatch)));
        assert_eq!(q.pop(), None);
    }
}
