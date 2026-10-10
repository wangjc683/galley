//! One upgraded WebSocket connection: read and route relay frames, write
//! what the channel queued for it, close it when told to.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use galley_remote_protocol::frame::{
    Frame, PeerId, PushRequest, PushResult, PushStatus, Role, MAX_FRAME_LEN,
};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;
use tokio::time::{timeout, Instant};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, Role as WsRole, WebSocketConfig};
use tokio_tungstenite::tungstenite::{Error as WsError, Message};
use tokio_tungstenite::WebSocketStream;

use crate::apns::{ApnsResponse, REASON_PUSH_BUSY, REASON_RELAY_ERROR};
use crate::channels::{Close, Outbox, Registration, State, Target};
use crate::limits::TokenBucket;

/// How long the relay tries to deliver its close frame.
const CLOSE_TIMEOUT: Duration = Duration::from_secs(2);
/// tungstenite allocates its read buffer eagerly (128 KiB by default);
/// a relay holds thousands of mostly idle connections.
const READ_BUFFER: usize = 16 * 1024;

enum End {
    /// The other end closed or the socket failed: nothing more to say.
    Gone,
    /// The relay closes, with this reason.
    Close(Close),
}

fn ws_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .read_buffer_size(READ_BUFFER)
        .max_message_size(Some(MAX_FRAME_LEN))
        .max_frame_size(Some(MAX_FRAME_LEN))
}

/// Serve one connection whose upgrade hyper completed.
pub(crate) async fn run<S>(
    io: S,
    reg: Registration,
    rx: mpsc::UnboundedReceiver<Bytes>,
    state: Arc<State>,
) where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let ws = WebSocketStream::from_raw_socket(io, WsRole::Server, Some(ws_config())).await;
    let (mut sink, mut stream) = ws.split();
    let outbox = reg.outbox.clone();
    let end = tokio::select! {
        end = read_loop(&mut stream, &reg, &state) => end,
        end = write_loop(&mut sink, rx, &outbox, &state) => end,
        why = outbox.killed() => End::Close(why),
    };
    let frame = match end {
        End::Gone => None,
        End::Close(why) => {
            if why == Close::TooSlow {
                state.metrics.error("slow_consumer");
            }
            Some(CloseFrame {
                code: CloseCode::from(why.code()),
                reason: why.reason().into(),
            })
        }
    };
    // Leave the channel before the close handshake, so the other side
    // hears `PEER` offline without waiting for it.
    drop(reg);
    let _ = timeout(CLOSE_TIMEOUT, async move {
        if let Some(frame) = frame {
            let _ = sink.send(Message::Close(Some(frame))).await;
        }
        let _ = sink.close().await;
    })
    .await;
}

fn fail(state: &State, label: &str, why: Close) -> End {
    state.metrics.error(label);
    End::Close(why)
}

async fn read_loop<S>(
    stream: &mut SplitStream<WebSocketStream<S>>,
    reg: &Registration,
    state: &Arc<State>,
) -> End
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut bucket = TokenBucket::new(&state.limits, Instant::now());
    loop {
        // Any message, WebSocket pings included, counts as alive.
        let message = match timeout(state.limits.idle_timeout, stream.next()).await {
            Err(_) => return fail(state, "idle_timeout", Close::IdleTimeout),
            Ok(None) => return End::Gone,
            Ok(Some(Ok(message))) => message,
            Ok(Some(Err(WsError::Capacity(_)))) => return fail(state, "oversize", Close::TooBig),
            Ok(Some(Err(WsError::Protocol(_) | WsError::Utf8(_)))) => {
                return fail(state, "ws_protocol", Close::Protocol)
            }
            Ok(Some(Err(_))) => return End::Gone,
        };
        let bytes = match message {
            Message::Binary(bytes) => bytes,
            Message::Text(text) => {
                state.metrics.received(text.len());
                return fail(state, "text_message", Close::TextMessage);
            }
            Message::Close(_) => return End::Gone,
            // tungstenite answers pings itself.
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => continue,
        };
        state.metrics.received(bytes.len());
        // Over the rate: read this connection more slowly instead of
        // dropping it (a 25 MB image upload is legitimate).
        let wait = bucket.charge(bytes.len(), Instant::now());
        if !wait.is_zero() {
            tokio::time::sleep(wait).await;
        }
        let frame = match Frame::decode(&bytes) {
            Ok(frame) => frame,
            Err(e) => return fail(state, e.label(), Close::Policy),
        };
        if let Some(end) = handle(frame, reg, state).await {
            return end;
        }
    }
}

async fn handle(frame: Frame, reg: &Registration, state: &Arc<State>) -> Option<End> {
    match (reg.role, frame) {
        (_, Frame::Ping(nonce)) => reg
            .outbox
            .push_control(Frame::Pong(nonce).encode().expect("PONG always encodes")),
        (Role::Host, Frame::Data { peer, payload }) => {
            // To the client the peer is always 0.
            forward(reg, state, peer, PeerId::HOST, payload).await;
        }
        (Role::Client, Frame::Data { peer, payload }) => {
            if !peer.is_host() {
                return Some(fail(state, "bad_peer", Close::Policy));
            }
            // To the host, stamped with this client's id.
            forward(reg, state, PeerId::HOST, reg.peer, payload).await;
        }
        (Role::Host, Frame::Push(push)) => send_push(push, reg, state),
        // `PEER`, `PONG` and `PUSH_RESULT` only go relay → end, and only a
        // host may push.
        _ => return Some(fail(state, "wrong_direction", Close::Policy)),
    }
    None
}

async fn forward(
    reg: &Registration,
    state: &Arc<State>,
    to: PeerId,
    stamp: PeerId,
    payload: Vec<u8>,
) {
    let outbox = match reg.target(to) {
        Target::Deliver(outbox) => outbox,
        Target::NotConnected => {
            state.metrics.dropped(match reg.role {
                Role::Host => "unknown_peer",
                Role::Client => "no_host",
            });
            return;
        }
        Target::Displaced => return,
    };
    let bytes = Frame::Data {
        peer: stamp,
        payload,
    }
    .encode()
    .expect("a decoded DATA payload re-encodes");
    outbox.push_data(bytes, &state.limits).await;
}

/// Releases one in-flight push slot, also if the sender panics.
struct InFlight(Arc<AtomicUsize>);

impl Drop for InFlight {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

fn send_push(push: PushRequest, reg: &Registration, state: &Arc<State>) {
    state.metrics.push_requested();
    let request_id = push.request_id;
    let outbox = reg.outbox.clone();
    let slots = Arc::clone(&reg.pushes_in_flight);
    if slots.fetch_add(1, Ordering::AcqRel) >= state.limits.max_pushes_in_flight {
        slots.fetch_sub(1, Ordering::AcqRel);
        answer_push(
            &outbox,
            state,
            request_id,
            ApnsResponse::not_sent(REASON_PUSH_BUSY),
        );
        return;
    }
    let state = Arc::clone(state);
    tokio::spawn(async move {
        let slot = InFlight(slots);
        let response = state.apns.send(&push).await;
        drop(slot);
        answer_push(&outbox, &state, request_id, response);
    });
}

fn answer_push(outbox: &Outbox, state: &State, request_id: u32, response: ApnsResponse) {
    let status = response.status;
    let encoded = Frame::PushResult(PushResult {
        request_id,
        status,
        apns_status: response.apns_status,
        reason: response.reason,
    })
    .encode();
    let (status, bytes) = match encoded {
        Ok(bytes) => (status, bytes),
        // The sender broke the PUSH_RESULT rules; the host still gets an
        // answer.
        Err(_) => (
            PushStatus::Failed,
            Frame::PushResult(PushResult {
                request_id,
                status: PushStatus::Failed,
                apns_status: 0,
                reason: REASON_RELAY_ERROR.to_string(),
            })
            .encode()
            .expect("a failure with a constant reason encodes"),
        ),
    };
    state.metrics.push_answered(status);
    outbox.push_control(bytes);
}

async fn write_loop<S>(
    sink: &mut SplitSink<WebSocketStream<S>, Message>,
    mut rx: mpsc::UnboundedReceiver<Bytes>,
    outbox: &Outbox,
    state: &State,
) -> End
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    while let Some(bytes) = rx.recv().await {
        let len = bytes.len();
        if sink.send(Message::Binary(bytes)).await.is_err() {
            return End::Gone;
        }
        outbox.written(len);
        state.metrics.sent(len);
    }
    End::Gone
}
