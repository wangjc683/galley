//! The relay connection (design §2, §4.2): Core's one outbound WebSocket,
//! kept up while the module runs.
//!
//! [`supervise`] connects (`GET /v1/connect` as `host`, the channel
//! secret in a header, never in the URL), runs the connection until it
//! drops, and reconnects with exponential backoff and jitter. Nothing
//! here listens (Rule 2).
//!
//! While connected, one loop owns every phone ([`super::phone::Phone`],
//! keyed by the relay's peer id) and multiplexes:
//!
//! - relay frames: `DATA` to its phone, `PEER` on- / offline, `PONG`,
//!   `PUSH_RESULT`;
//! - requests: each runs on its own task ([`super::methods`]); the answer
//!   comes back here to be queued for the phone that asked;
//! - converted events ([`super::events`]): fanned out to phones, a
//!   `runner.event` only to phones subscribed to its session;
//! - sending: one record at a time, control frames (`PING`, `PUSH`)
//!   first, then the phones round-robin, sealed only as it leaves; a
//!   writer task owns the socket's sending half, so a slow relay never
//!   stops the loop from reading;
//! - a `PING` every 25 s, and session expiry (24 h → `CLOSE Expired`).
//!
//! A dropped connection drops every phone with it: their sessions end
//! without `CLOSE` (truncated, design §5), and each phone re-handshakes
//! and re-syncs once Core is back (`PEER` host online).

use super::events::{PhoneEvent, PhoneFilter};
use super::methods::{self, Effect, MethodCtx};
use super::phone::{Inbound, Kind, Phone};
use super::push::remove_push_device;
use super::{RemoteTuning, StatusCell};
use futures_util::{SinkExt, StreamExt};
use galley_remote_protocol::app::{error_code, Envelope, ErrorBody, Request, Response};
use galley_remote_protocol::frame::{
    Frame, PeerId, PushRequest, PushResult, PushStatus, Role, HEADER_CHANNEL, HEADER_RELAY_VERSION,
    HEADER_ROLE, MAX_FRAME_LEN, RELAY_PROTOCOL_VERSION,
};
use galley_remote_protocol::keys::{NoisePsk, RelayUrl};
use galley_remote_protocol::noise::CloseReason;
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Frames handed to the writer task ahead of it; beyond this the loop
/// keeps records unsealed in the phones' queues.
const WRITER_QUEUE: usize = 32;
/// Phones (peer ids) tracked at once; the relay allows 4 clients.
const MAX_PHONES: usize = 8;
/// `PUSH` frames awaiting their `PUSH_RESULT`.
const MAX_PENDING_PUSHES: usize = 1024;
/// How long a stop may take to say goodbye before the socket is dropped.
const CLOSE_GRACE: Duration = Duration::from_secs(2);
/// The relay's WebSocket close code for "a new host took this channel"
/// (another Core with the same pairing key). Like every other close
/// (4002 heartbeat timeout, 4003 slow receiver, 1008 protocol violation,
/// 1009 oversize, 1001 relay shutdown) it means: reconnect with backoff.
const CLOSE_REPLACED_BY_HOST: u16 = 4001;

/// From the module to the running connection task.
pub(super) enum Control {
    /// Close every phone's session with `reason`, then the connection,
    /// and end the task.
    Stop(CloseReason),
    /// Send these `PUSH` frames (each with its device's hex token, to
    /// forget the token on a 410). `reply` gets `false` when the relay is
    /// not connected.
    Push {
        requests: Vec<(PushRequest, String)>,
        reply: tokio::sync::oneshot::Sender<bool>,
    },
}

/// What a connection run shares with its tasks.
pub(super) struct RunCtx {
    pub(super) methods: Arc<MethodCtx>,
    pub(super) relay: RelayUrl,
    /// `X-Galley-Channel`: base64url of the channel secret.
    pub(super) channel_header: String,
    pub(super) psk: NoisePsk,
    /// Core's hello JSON, the handshake answer's payload.
    pub(super) hello: Vec<u8>,
    pub(super) tuning: RemoteTuning,
    pub(super) status: Arc<StatusCell>,
    pub(super) filter: Arc<PhoneFilter>,
    /// Phone session numbering, unique for the module's life.
    pub(super) generations: Arc<AtomicU64>,
}

/// A request's answer on its way back to the loop.
struct Answer {
    peer: PeerId,
    generation: u64,
    response: Response,
    effect: Effect,
}

/// Run until stopped: connect, serve, reconnect.
pub(super) async fn supervise(
    ctx: Arc<RunCtx>,
    mut control: mpsc::Receiver<Control>,
    mut events: mpsc::Receiver<PhoneEvent>,
) {
    let (answer_tx, mut answer_rx) = mpsc::unbounded_channel();
    let mut backoff = Backoff::new(&ctx.tuning);
    // Two desktops with one pairing key displace each other at every
    // reconnect; say so once per streak, not on every round.
    let mut displaced_logged = false;
    loop {
        let attempt = connect(&ctx);
        tokio::pin!(attempt);
        let connected = loop {
            tokio::select! {
                result = &mut attempt => break result,
                ctl = control.recv() => {
                    if !idle_control(ctl) {
                        return;
                    }
                }
            }
        };
        match connected {
            Ok(ws) => {
                eprintln!("[remote] connected to the relay");
                let since = Instant::now();
                ctx.status.update(|s| s.relay_connected = true);
                // Converted events from before this connection are for
                // phones that are gone.
                while events.try_recv().is_ok() {}
                let exit = Connection::new(&ctx, answer_tx.clone())
                    .run(ws, &mut control, &mut events, &mut answer_rx)
                    .await;
                ctx.filter.reset();
                ctx.status.update(|s| {
                    s.relay_connected = false;
                    s.online_phones = 0;
                });
                match exit {
                    Exit::Stopped => return,
                    Exit::Lost(why, Some(CLOSE_REPLACED_BY_HOST)) => {
                        // Never a stable connection: keep backing off.
                        if !displaced_logged {
                            eprintln!(
                                "[remote] another Galley paired with this key took the relay \
                                 channel ({why}); retrying with backoff"
                            );
                            displaced_logged = true;
                        }
                    }
                    Exit::Lost(why, _) => {
                        eprintln!("[remote] relay connection lost: {why}");
                        displaced_logged = false;
                        if since.elapsed() >= ctx.tuning.stable_after {
                            backoff.reset();
                        }
                    }
                }
            }
            Err(e) => eprintln!("[remote] relay connect failed: {e}"),
        }
        let sleep = tokio::time::sleep(backoff.next_delay());
        tokio::pin!(sleep);
        loop {
            tokio::select! {
                _ = &mut sleep => break,
                ctl = control.recv() => {
                    if !idle_control(ctl) {
                        return;
                    }
                }
            }
        }
    }
}

/// A control message while not connected. `false`: stop.
fn idle_control(ctl: Option<Control>) -> bool {
    match ctl {
        None | Some(Control::Stop(_)) => false,
        Some(Control::Push { reply, .. }) => {
            let _ = reply.send(false);
            true
        }
    }
}

/// Open the WebSocket (design §4.2). The channel secret travels in a
/// header, so a relay that ever logged URLs would not log it. No
/// `Sec-WebSocket-Extensions`: no permessage-deflate (design §5).
async fn connect(ctx: &RunCtx) -> Result<Ws, String> {
    let mut request = ctx
        .relay
        .connect_url()
        .into_client_request()
        .map_err(|e| format!("bad relay URL: {e}"))?;
    let header = |name: &str| HeaderName::from_bytes(name.as_bytes()).map_err(|e| e.to_string());
    let value = |value: &str| HeaderValue::from_str(value).map_err(|e| e.to_string());
    let headers = request.headers_mut();
    headers.insert(header(HEADER_CHANNEL)?, value(&ctx.channel_header)?);
    headers.insert(header(HEADER_ROLE)?, value(Role::Host.as_str())?);
    headers.insert(
        header(HEADER_RELAY_VERSION)?,
        value(&RELAY_PROTOCOL_VERSION.to_string())?,
    );
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_FRAME_LEN))
        .max_frame_size(Some(MAX_FRAME_LEN));
    let connecting = tokio_tungstenite::connect_async_with_config(request, Some(config), true);
    match tokio::time::timeout(ctx.tuning.connect_timeout, connecting).await {
        Err(_) => Err("timed out".into()),
        Ok(Err(e)) => Err(e.to_string()),
        Ok(Ok((ws, _response))) => Ok(ws),
    }
}

/// Exponential backoff with jitter: each delay is drawn from the upper
/// half of the current step, the step doubling up to the cap.
struct Backoff {
    step: Duration,
    initial: Duration,
    max: Duration,
}

impl Backoff {
    fn new(tuning: &RemoteTuning) -> Self {
        Self {
            step: tuning.backoff_initial,
            initial: tuning.backoff_initial,
            max: tuning.backoff_max.max(tuning.backoff_initial),
        }
    }

    fn reset(&mut self) {
        self.step = self.initial;
    }

    fn next_delay(&mut self) -> Duration {
        let step = self.step;
        self.step = (self.step * 2).min(self.max);
        let half = step / 2;
        half + half.mul_f64(jitter())
    }
}

/// A fraction in `[0, 1)` from the OS random source (the clock if that
/// fails); only spreads reconnects out.
fn jitter() -> f64 {
    use ring::rand::SecureRandom;
    let mut bytes = [0u8; 4];
    let value = match ring::rand::SystemRandom::new().fill(&mut bytes) {
        Ok(()) => u32::from_be_bytes(bytes),
        Err(_) => std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0),
    };
    f64::from(value) / (f64::from(u32::MAX) + 1.0)
}

enum Exit {
    Stopped,
    /// Why, and the relay's WebSocket close code if it sent one.
    Lost(String, Option<u16>),
}

/// One connection's state.
struct Connection<'a> {
    ctx: &'a RunCtx,
    answer_tx: mpsc::UnboundedSender<Answer>,
    phones: BTreeMap<PeerId, Phone>,
    /// Encoded `PING` / `PUSH` frames, sent before phone records.
    control_out: VecDeque<Vec<u8>>,
    /// `PUSH` request id → the token it went to.
    pending_pushes: HashMap<u32, String>,
    last_pong: Instant,
    ping_nonce: u64,
}

impl<'a> Connection<'a> {
    fn new(ctx: &'a RunCtx, answer_tx: mpsc::UnboundedSender<Answer>) -> Self {
        Self {
            ctx,
            answer_tx,
            phones: BTreeMap::new(),
            control_out: VecDeque::new(),
            pending_pushes: HashMap::new(),
            last_pong: Instant::now(),
            ping_nonce: 0,
        }
    }

    async fn run(
        mut self,
        ws: Ws,
        control: &mut mpsc::Receiver<Control>,
        events: &mut mpsc::Receiver<PhoneEvent>,
        answers: &mut mpsc::UnboundedReceiver<Answer>,
    ) -> Exit {
        let (sink, mut stream) = ws.split();
        let (writer_tx, writer_rx) = mpsc::channel::<Message>(WRITER_QUEUE);
        let mut writer = tokio::spawn(write_frames(sink, writer_rx));
        let ctx = self.ctx;
        let tuning = &ctx.tuning;
        let mut ping = tokio::time::interval(tuning.ping_interval);
        ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut housekeeping = tokio::time::interval(tuning.housekeeping_interval);
        housekeeping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        let exit = loop {
            let pending = self.has_pending();
            tokio::select! {
                incoming = stream.next() => match incoming {
                    Some(Ok(Message::Binary(bytes))) => self.on_frame(&bytes),
                    Some(Ok(Message::Close(frame))) => {
                        let code = frame.map(|frame| u16::from(frame.code));
                        let why = match code {
                            Some(code) => format!("the relay closed the connection ({code})"),
                            None => "the relay closed the connection".into(),
                        };
                        break Exit::Lost(why, code);
                    }
                    None => break Exit::Lost("the connection ended".into(), None),
                    // Text is not part of the protocol; WebSocket pings are
                    // answered by tungstenite.
                    Some(Ok(_)) => {}
                    Some(Err(e)) => break Exit::Lost(format!("read failed: {e}"), None),
                },
                ctl = control.recv() => match ctl {
                    None => {
                        self.close_all(CloseReason::Normal, &writer_tx).await;
                        break Exit::Stopped;
                    }
                    Some(Control::Stop(reason)) => {
                        self.close_all(reason, &writer_tx).await;
                        break Exit::Stopped;
                    }
                    Some(Control::Push { requests, reply }) => {
                        self.queue_pushes(requests);
                        let _ = reply.send(true);
                    }
                },
                Some(answer) = answers.recv() => self.on_answer(answer),
                Some(event) = events.recv() => self.on_event(event),
                permit = writer_tx.reserve(), if pending => match permit {
                    Ok(permit) => {
                        if let Some(frame) = self.next_frame() {
                            permit.send(Message::Binary(frame.into()));
                        }
                    }
                    Err(_) => break Exit::Lost("the writer stopped".into(), None),
                },
                _ = ping.tick() => {
                    if self.last_pong.elapsed() > tuning.pong_timeout {
                        break Exit::Lost("no PONG from the relay".into(), None);
                    }
                    self.queue_ping();
                }
                _ = housekeeping.tick() => self.expire_sessions(),
                result = &mut writer => {
                    let why = match result {
                        Ok(Err(e)) => format!("write failed: {e}"),
                        _ => "the writer stopped".into(),
                    };
                    break Exit::Lost(why, None);
                }
            }
        };

        match exit {
            Exit::Stopped => {
                // The goodbyes are queued; let them out, briefly.
                drop(writer_tx);
                if tokio::time::timeout(CLOSE_GRACE, &mut writer)
                    .await
                    .is_err()
                {
                    writer.abort();
                }
            }
            Exit::Lost(..) => writer.abort(),
        }
        exit
    }

    fn has_pending(&self) -> bool {
        !self.control_out.is_empty()
            || self
                .phones
                .values()
                .any(|phone| !phone.closed && !phone.queue.is_empty())
    }

    /// The next frame to write: control frames first, then the phone
    /// that has sent the least.
    fn next_frame(&mut self) -> Option<Vec<u8>> {
        if let Some(frame) = self.control_out.pop_front() {
            return Some(frame);
        }
        loop {
            let peer = self
                .phones
                .iter()
                .filter(|(_, phone)| !phone.closed && !phone.queue.is_empty())
                .min_by_key(|(_, phone)| phone.sent)
                .map(|(peer, _)| *peer)?;
            let phone = self.phones.get_mut(&peer).expect("picked above");
            let sealed = phone.next_message()?;
            let closed = phone.closed;
            let frame = sealed.map_err(|e| e.to_string()).and_then(|payload| {
                Frame::Data { peer, payload }
                    .encode()
                    .map_err(|e| e.to_string())
            });
            match frame {
                Ok(frame) => {
                    if closed {
                        // Its CLOSE is this frame: nothing follows it.
                        self.remove_phone(peer, "session closed");
                    }
                    return Some(frame);
                }
                Err(e) => {
                    eprintln!("[remote] phone {} dropped: sealing failed ({e})", peer.0);
                    self.remove_phone(peer, "sealing failed");
                }
            }
        }
    }

    fn on_frame(&mut self, bytes: &[u8]) {
        let frame = match Frame::decode(bytes) {
            Ok(frame) => frame,
            Err(e) => {
                eprintln!("[remote] ignored a relay frame: {}", e.label());
                return;
            }
        };
        match frame {
            Frame::Data { peer, payload } if !peer.is_host() => self.on_data(peer, &payload),
            Frame::Peer {
                peer,
                role: Role::Client,
                online,
            } => {
                // Online or offline, whatever session that peer had is
                // over; a phone (re)starts with a handshake.
                self.remove_phone(peer, if online { "reconnected" } else { "offline" });
            }
            Frame::Pong(_) => self.last_pong = Instant::now(),
            Frame::PushResult(result) => self.on_push_result(result),
            // Not for a host: DATA from peer 0, the host's own PEER, PING,
            // PUSH.
            _ => {}
        }
    }

    fn on_data(&mut self, peer: PeerId, payload: &[u8]) {
        if !self.phones.contains_key(&peer) {
            if self.phones.len() >= MAX_PHONES {
                return;
            }
            let generation = self.ctx.generations.fetch_add(1, Ordering::Relaxed);
            let tuning = &self.ctx.tuning;
            self.phones.insert(
                peer,
                Phone::new(
                    generation,
                    tuning.phone_queue_events,
                    tuning.phone_queue_bytes,
                ),
            );
        }
        let phone = self.phones.get_mut(&peer).expect("inserted above");
        if phone.closed || phone.closing() {
            return;
        }
        match phone.receive(&self.ctx.psk, &self.ctx.hello, payload) {
            Inbound::Established => {
                eprintln!("[remote] phone {} connected", peer.0);
                self.ctx.status.update(|s| {
                    s.last_phone_connected_at = Some(
                        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    )
                });
                self.phones_changed();
            }
            Inbound::Message(Envelope::Request(request)) => self.spawn_request(peer, request),
            // A phone sends requests only.
            Inbound::Message(_) | Inbound::Nothing => {}
            Inbound::Closed(reason) => {
                let why = format!("closed by the phone, reason {}", reason.code());
                self.remove_phone(peer, &why);
            }
            Inbound::Failed(why) => {
                eprintln!("[remote] phone {} dropped: {why}", peer.0);
                self.remove_phone(peer, why);
            }
        }
    }

    fn spawn_request(&self, peer: PeerId, request: Request) {
        let Some(phone) = self.phones.get(&peer) else {
            return;
        };
        let generation = phone.generation;
        let subscriptions = phone.subscriptions.clone();
        let methods = self.ctx.methods.clone();
        let answers = self.answer_tx.clone();
        tokio::spawn(async move {
            let (response, effect) = methods::handle(&methods, request, &subscriptions).await;
            let _ = answers.send(Answer {
                peer,
                generation,
                response,
                effect,
            });
        });
    }

    fn on_answer(&mut self, answer: Answer) {
        let Some(phone) = self.phones.get_mut(&answer.peer) else {
            return;
        };
        if phone.generation != answer.generation || phone.closed || phone.closing() {
            return;
        }
        let mut subscriptions_changed = false;
        match &answer.effect {
            Effect::Subscribe(session) => {
                subscriptions_changed = phone.subscriptions.insert(session.clone());
            }
            Effect::Unsubscribe(session) => {
                subscriptions_changed = phone.subscriptions.remove(session);
            }
            Effect::None | Effect::Close(_) => {}
        }
        let id = answer.response.id;
        let bodies = match phone.encode(&Envelope::Response(answer.response)) {
            Some(Ok(bodies)) => Some(bodies),
            Some(Err(e)) => {
                let error = Response::error(
                    id,
                    ErrorBody::new(error_code::INTERNAL, format!("response not sent: {e}")),
                );
                phone
                    .encode(&Envelope::Response(error))
                    .and_then(Result::ok)
            }
            None => None,
        };
        if let Some(bodies) = bodies {
            phone.queue.push(Kind::Response, bodies);
        }
        if let Effect::Close(reason) = answer.effect {
            phone.begin_close(reason);
        }
        if subscriptions_changed {
            self.phones_changed();
        }
    }

    fn on_event(&mut self, event: PhoneEvent) {
        for (peer, phone) in &mut self.phones {
            if !phone.is_established() || phone.closed || phone.closing() {
                continue;
            }
            let (kind, envelope) = match &event {
                PhoneEvent::State(envelope) => (Kind::State, envelope),
                PhoneEvent::Runner {
                    session_id,
                    envelope,
                } => {
                    if !phone.subscriptions.contains(session_id) {
                        continue;
                    }
                    (Kind::Runner(session_id.clone()), envelope)
                }
                PhoneEvent::ResyncAll => {
                    phone.queue.require_full_sync();
                    continue;
                }
            };
            let bodies = match phone.encode(envelope) {
                Some(Ok(bodies)) => bodies,
                Some(Err(e)) => {
                    eprintln!("[remote] an event for phone {} was too large: {e}", peer.0);
                    phone.queue.require_full_sync();
                    continue;
                }
                None => continue,
            };
            if phone.queue.push_event(kind, bodies) {
                eprintln!(
                    "[remote] phone {} fell behind; dropped events and asked it to re-read",
                    peer.0
                );
            }
        }
    }

    fn queue_ping(&mut self) {
        self.ping_nonce = self.ping_nonce.wrapping_add(1);
        if let Ok(frame) = Frame::Ping(self.ping_nonce).encode() {
            self.control_out.push_back(frame);
        }
    }

    fn queue_pushes(&mut self, requests: Vec<(PushRequest, String)>) {
        for (request, token) in requests {
            let request_id = request.request_id;
            match Frame::Push(request).encode() {
                Ok(frame) => {
                    if self.pending_pushes.len() >= MAX_PENDING_PUSHES {
                        // Results that never came; forget them.
                        self.pending_pushes.clear();
                    }
                    self.pending_pushes.insert(request_id, token);
                    self.control_out.push_back(frame);
                }
                Err(e) => eprintln!("[remote] push not sent: {e}"),
            }
        }
    }

    fn on_push_result(&mut self, result: PushResult) {
        let Some(token) = self.pending_pushes.remove(&result.request_id) else {
            return;
        };
        match result.status {
            PushStatus::Ok => {}
            PushStatus::Unregistered => {
                // APNs 410: the token is dead (app removed, push turned
                // off); forget it.
                let galley = self.ctx.methods.deps.galley.clone();
                tokio::spawn(async move {
                    if let Err(e) = remove_push_device(&galley, &token).await {
                        eprintln!("[remote] removing an unregistered push token failed: {e}");
                    }
                });
            }
            PushStatus::Failed => eprintln!(
                "[remote] push failed: APNs status {} {}",
                result.apns_status, result.reason
            ),
        }
    }

    fn expire_sessions(&mut self) {
        let max_age = self.ctx.tuning.session_max_age;
        for phone in self.phones.values_mut() {
            if phone
                .established_at()
                .is_some_and(|since| since.elapsed() >= max_age)
            {
                phone.begin_close(CloseReason::Expired);
            }
        }
    }

    /// Seal `CLOSE` for every phone and write it, then close the socket
    /// (the module is stopping or unpairing). Bounded by [`CLOSE_GRACE`].
    async fn close_all(&mut self, reason: CloseReason, writer: &mpsc::Sender<Message>) {
        let mut frames = Vec::new();
        for (peer, phone) in &mut self.phones {
            if let Some(payload) = phone.seal_close_now(reason) {
                if let Ok(frame) = (Frame::Data {
                    peer: *peer,
                    payload,
                })
                .encode()
                {
                    frames.push(frame);
                }
            }
        }
        let goodbye = async {
            for frame in frames {
                writer.send(Message::Binary(frame.into())).await?;
            }
            writer.send(Message::Close(None)).await
        };
        let _ = tokio::time::timeout(CLOSE_GRACE, goodbye).await;
        self.phones.clear();
        self.phones_changed();
    }

    fn remove_phone(&mut self, peer: PeerId, why: &str) {
        if let Some(phone) = self.phones.remove(&peer) {
            if phone.is_established() {
                eprintln!("[remote] phone {} disconnected ({why})", peer.0);
            }
            self.phones_changed();
        }
    }

    /// Phones or subscriptions changed: update the sink's filter and the
    /// status.
    fn phones_changed(&self) {
        let established: Vec<&Phone> = self
            .phones
            .values()
            .filter(|phone| phone.is_established() && !phone.closed)
            .collect();
        let subscribed: BTreeSet<String> = established
            .iter()
            .flat_map(|phone| phone.subscriptions.iter().cloned())
            .collect();
        self.ctx.filter.set(established.len(), subscribed);
        let online = u32::try_from(established.len()).unwrap_or(u32::MAX);
        self.ctx.status.update(|s| s.online_phones = online);
    }
}

/// The writer task: owns the sending half, writes what the loop hands
/// it, flushing once per burst. Ends after a `Close` or when the loop
/// drops its sender.
async fn write_frames(
    mut sink: futures_util::stream::SplitSink<Ws, Message>,
    mut rx: mpsc::Receiver<Message>,
) -> Result<(), tokio_tungstenite::tungstenite::Error> {
    while let Some(message) = rx.recv().await {
        let mut closing = matches!(message, Message::Close(_));
        sink.feed(message).await?;
        while !closing {
            match rx.try_recv() {
                Ok(more) => {
                    closing = matches!(more, Message::Close(_));
                    sink.feed(more).await?;
                }
                Err(_) => break,
            }
        }
        sink.flush().await?;
        if closing {
            break;
        }
    }
    let _ = sink.close().await;
    Ok(())
}
