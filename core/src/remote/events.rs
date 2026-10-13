//! Core events → phone events (design §6.4).
//!
//! [`EventSink`] is the module's [`RemoteEventSink`]: every
//! `TauriNotifier` emit reaches it on the emitting thread, so it only
//! filters and copies into a bounded queue. With no phone online it does
//! not even copy, and a `runner-event` is copied only for a session some
//! phone subscribed to. When the queue is full the event is dropped and
//! the next one through tells every phone to re-read everything
//! (`sync.required` with `sessionId: null`, design §6.5).
//!
//! [`map_events`] is the task behind it: it decodes each payload with
//! Core's own type, keeps managed-runtime sessions only (PRD ruling 18),
//! converts to the phone's type, and batches each session's
//! `runner-event`s for [`super::RemoteTuning::runner_batch_window`] into
//! one `runner.event` (a state event about a session first flushes that
//! session's batch, so the phone sees them in Core's order). The
//! connection then fans the results out to the phones.

use super::convert;
use crate::api::{
    GalleyApi, MessageBrief, ProjectBrief, RuntimeKind, SessionBrief, SessionId,
    SessionQueueChangedPayload, SESSION_QUEUE_CHANGED_EVENT,
};
use crate::db::SqliteGalley;
use crate::error::GalleyError;
use crate::goal_engine::GOAL_UPDATED_EVENT;
use crate::notify::RemoteEventSink;
use crate::runner_manager::{SessionRunStatePayload, SESSION_RUN_STATE_EVENT};
use crate::session_runner::{HistoryReplayPayload, RUNNER_HISTORY_REPLAY_EVENT};
use crate::session_send::USER_MESSAGE_PERSISTED_EVENT;
use crate::session_writes::{
    PROJECT_CREATED_EXTERNAL_EVENT, PROJECT_DELETED_EXTERNAL_EVENT, PROJECT_UPDATED_EXTERNAL_EVENT,
    SESSION_ARCHIVED_EXTERNAL_EVENT, SESSION_CREATED_EXTERNAL_EVENT,
    SESSION_DELETED_EXTERNAL_EVENT, SESSION_MOVED_EXTERNAL_EVENT,
    SESSION_UNARCHIVED_EXTERNAL_EVENT, SESSION_UPDATED_EXTERNAL_EVENT,
};
use galley_remote_protocol::app::{self as phone, AppEvent, Envelope};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, PoisonError, RwLock};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::Instant;

/// Core's runner event (`runner_commands::spawn_emit_task`).
pub(super) const RUNNER_EVENT: &str = "runner-event";

/// A `runner.event` flushes early at this many events.
const MAX_BATCH_EVENTS: usize = 200;

/// The Core events phones hear about. Everything else (desktop-only
/// state, `runner-malformed`, `runner-closed`, scheduled tasks, this
/// module's own `remote-status`) stays on the desktop.
const FORWARDED: &[&str] = &[
    SESSION_CREATED_EXTERNAL_EVENT,
    SESSION_UPDATED_EXTERNAL_EVENT,
    SESSION_ARCHIVED_EXTERNAL_EVENT,
    SESSION_UNARCHIVED_EXTERNAL_EVENT,
    SESSION_MOVED_EXTERNAL_EVENT,
    SESSION_DELETED_EXTERNAL_EVENT,
    PROJECT_CREATED_EXTERNAL_EVENT,
    PROJECT_UPDATED_EXTERNAL_EVENT,
    PROJECT_DELETED_EXTERNAL_EVENT,
    USER_MESSAGE_PERSISTED_EVENT,
    RUNNER_EVENT,
    SESSION_RUN_STATE_EVENT,
    RUNNER_HISTORY_REPLAY_EVENT,
    GOAL_UPDATED_EVENT,
    SESSION_QUEUE_CHANGED_EVENT,
];

/// What the sink needs to know about the phones, kept current by the
/// connection: how many have a session, and which sessions any of them
/// subscribed to.
#[derive(Default)]
pub(super) struct PhoneFilter {
    online: AtomicUsize,
    subscribed: RwLock<BTreeSet<String>>,
}

impl PhoneFilter {
    pub(super) fn set(&self, online: usize, subscribed: BTreeSet<String>) {
        *self
            .subscribed
            .write()
            .unwrap_or_else(PoisonError::into_inner) = subscribed;
        self.online.store(online, Ordering::Release);
    }

    pub(super) fn reset(&self) {
        self.set(0, BTreeSet::new());
    }

    fn is_subscribed(&self, session_id: &str) -> bool {
        self.subscribed
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .contains(session_id)
    }
}

/// The module's [`RemoteEventSink`].
pub(super) struct EventSink {
    tx: mpsc::Sender<(String, Value)>,
    filter: Arc<PhoneFilter>,
    dropped: Arc<AtomicBool>,
}

impl EventSink {
    /// A sink and the receiving end for [`map_events`].
    pub(super) fn new(
        capacity: usize,
        filter: Arc<PhoneFilter>,
    ) -> (Self, mpsc::Receiver<(String, Value)>, Arc<AtomicBool>) {
        let (tx, rx) = mpsc::channel(capacity.max(1));
        let dropped = Arc::new(AtomicBool::new(false));
        (
            Self {
                tx,
                filter,
                dropped: dropped.clone(),
            },
            rx,
            dropped,
        )
    }
}

impl RemoteEventSink for EventSink {
    fn forward(&self, event: &str, payload: &Value) {
        if self.filter.online.load(Ordering::Acquire) == 0 || !FORWARDED.contains(&event) {
            return;
        }
        if event == RUNNER_EVENT {
            let session = payload.get("sessionId").and_then(Value::as_str);
            if !session.is_some_and(|id| self.filter.is_subscribed(id)) {
                return;
            }
        }
        if self
            .tx
            .try_send((event.to_string(), payload.clone()))
            .is_err()
        {
            self.dropped.store(true, Ordering::Release);
        }
    }
}

/// A converted event, for the connection to fan out.
#[derive(Debug)]
pub(super) enum PhoneEvent {
    /// For every phone with a session.
    State(Envelope),
    /// For the phones subscribed to `session_id`.
    Runner {
        session_id: String,
        envelope: Envelope,
    },
    /// Events were dropped before conversion: every phone re-reads
    /// everything.
    ResyncAll,
}

// Core payloads whose Core struct carries a `&'static str` and so cannot
// be read back as is; the inner rows are Core's own types.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionEventIn {
    session: SessionBrief,
    via: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionDeletedIn {
    session_id: String,
    via: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectEventIn {
    project: ProjectBrief,
    via: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDeletedIn {
    project_id: String,
    #[serde(default)]
    detached_session_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UserMessagePersistedIn {
    session_id: String,
    message: MessageBrief,
    dispatch: String,
    #[serde(default)]
    client_request_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunnerEventIn {
    session_id: String,
    event: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoalUpdatedIn {
    goal: Value,
}

/// The conversion task's state.
struct Mapper {
    galley: SqliteGalley,
    out: mpsc::Sender<PhoneEvent>,
    /// Session id → is a managed-runtime session. A session's runtime
    /// never changes, so an answer is kept until the session is deleted.
    managed: HashMap<String, bool>,
    /// Pending `runner-event`s per session, in arrival order of sessions.
    batches: Vec<(String, Vec<Value>)>,
    deadline: Option<Instant>,
    window: Duration,
}

/// Convert the sink's events until the sink is gone or the connection
/// side stops listening.
pub(super) async fn map_events(
    galley: SqliteGalley,
    mut rx: mpsc::Receiver<(String, Value)>,
    dropped: Arc<AtomicBool>,
    out: mpsc::Sender<PhoneEvent>,
    window: Duration,
) {
    let mut mapper = Mapper {
        galley,
        out,
        managed: HashMap::new(),
        batches: Vec::new(),
        deadline: None,
        window,
    };
    loop {
        let deadline = mapper.deadline;
        let next = tokio::select! {
            next = rx.recv() => next,
            _ = tokio::time::sleep_until(deadline.unwrap_or_else(Instant::now)),
                if deadline.is_some() =>
            {
                if mapper.flush_all().await.is_err() {
                    return;
                }
                continue;
            }
        };
        let Some((name, payload)) = next else {
            return;
        };
        if dropped.swap(false, Ordering::AcqRel) {
            // Whatever is batched predates the gap; the resync covers it.
            mapper.batches.clear();
            mapper.deadline = None;
            if mapper.out.send(PhoneEvent::ResyncAll).await.is_err() {
                return;
            }
        }
        if mapper.handle(&name, payload).await.is_err() {
            return;
        }
    }
}

/// The connection side is gone.
struct Closed;

/// One Core event, converted.
// Each is built once and handed on at once; boxing would buy nothing
// (05a's `AppEvent` makes the same call).
#[allow(clippy::large_enum_variant)]
enum Mapped {
    /// Not for phones (another runtime's session, an unknown name).
    Nothing,
    /// A state event, about this session if any.
    State(Option<String>, AppEvent),
    /// One runner event of this session, to batch.
    Runner(String, Value),
}

impl Mapper {
    async fn send(&self, event: PhoneEvent) -> Result<(), Closed> {
        self.out.send(event).await.map_err(|_| Closed)
    }

    async fn flush_all(&mut self) -> Result<(), Closed> {
        self.deadline = None;
        for (session_id, events) in std::mem::take(&mut self.batches) {
            self.send_batch(session_id, events).await?;
        }
        Ok(())
    }

    async fn flush_session(&mut self, session_id: &str) -> Result<(), Closed> {
        let Some(at) = self.batches.iter().position(|(id, _)| id == session_id) else {
            return Ok(());
        };
        let (session_id, events) = self.batches.remove(at);
        if self.batches.is_empty() {
            self.deadline = None;
        }
        self.send_batch(session_id, events).await
    }

    async fn send_batch(&self, session_id: String, events: Vec<Value>) -> Result<(), Closed> {
        let envelope = Envelope::Event(
            AppEvent::RunnerEvent(phone::RunnerEventBatch {
                session_id: session_id.clone(),
                events,
            })
            .to_event(),
        );
        self.send(PhoneEvent::Runner {
            session_id,
            envelope,
        })
        .await
    }

    async fn state(&mut self, session_id: Option<&str>, event: AppEvent) -> Result<(), Closed> {
        if let Some(session_id) = session_id {
            self.flush_session(session_id).await?;
        }
        self.send(PhoneEvent::State(Envelope::Event(event.to_event())))
            .await
    }

    /// Whether `session_id` is a managed-runtime session (cached).
    async fn is_managed(&mut self, session_id: &str) -> bool {
        if let Some(managed) = self.managed.get(session_id) {
            return *managed;
        }
        match self
            .galley
            .session_brief(SessionId(session_id.to_string()))
            .await
        {
            Ok(brief) => {
                let managed = brief.ga_runtime_kind == RuntimeKind::Managed;
                self.managed.insert(session_id.to_string(), managed);
                managed
            }
            Err(GalleyError::NotFound { .. }) => false,
            Err(e) => {
                eprintln!("[remote] runtime lookup for an event failed: {e}");
                false
            }
        }
    }

    async fn handle(&mut self, name: &str, payload: Value) -> Result<(), Closed> {
        match self.convert(name, payload).await {
            Ok(Mapped::Nothing) => Ok(()),
            Ok(Mapped::State(session_id, event)) => self.state(session_id.as_deref(), event).await,
            Ok(Mapped::Runner(session_id, event)) => self.batch(session_id, event).await,
            Err(e) => {
                // A Core payload that does not decode is a Core bug; the
                // phone re-reads on its next sync either way.
                // The category only: serde's message can quote the payload.
                eprintln!(
                    "[remote] {name} payload did not decode ({:?} error)",
                    e.classify()
                );
                Ok(())
            }
        }
    }

    /// Decode one Core event and convert it, filtering out what is not
    /// a managed session's.
    async fn convert(&mut self, name: &str, payload: Value) -> Result<Mapped, serde_json::Error> {
        let session_event: Option<fn(phone::SessionEvent) -> AppEvent> = match name {
            SESSION_CREATED_EXTERNAL_EVENT => Some(AppEvent::SessionCreated),
            SESSION_UPDATED_EXTERNAL_EVENT => Some(AppEvent::SessionUpdated),
            SESSION_ARCHIVED_EXTERNAL_EVENT => Some(AppEvent::SessionArchived),
            SESSION_UNARCHIVED_EXTERNAL_EVENT => Some(AppEvent::SessionUnarchived),
            SESSION_MOVED_EXTERNAL_EVENT => Some(AppEvent::SessionMoved),
            _ => None,
        };
        if let Some(make) = session_event {
            let SessionEventIn { session, via } = serde_json::from_value(payload)?;
            let managed = session.ga_runtime_kind == RuntimeKind::Managed;
            self.managed.insert(session.id.0.clone(), managed);
            if !managed {
                return Ok(Mapped::Nothing);
            }
            let session_id = session.id.0.clone();
            let event = make(phone::SessionEvent {
                session: convert::session(session),
                via,
            });
            return Ok(Mapped::State(Some(session_id), event));
        }
        Ok(match name {
            SESSION_DELETED_EXTERNAL_EVENT => {
                let SessionDeletedIn { session_id, via } = serde_json::from_value(payload)?;
                // The row is gone: forward unless it was known external.
                if self.managed.remove(&session_id) == Some(false) {
                    return Ok(Mapped::Nothing);
                }
                let event = AppEvent::SessionDeleted(phone::SessionDeletedEvent {
                    session_id: session_id.clone(),
                    via,
                });
                Mapped::State(Some(session_id), event)
            }
            PROJECT_CREATED_EXTERNAL_EVENT | PROJECT_UPDATED_EXTERNAL_EVENT => {
                let ProjectEventIn { project, via } = serde_json::from_value(payload)?;
                let project = phone::ProjectEvent {
                    project: convert::project(project),
                    via,
                };
                let event = if name == PROJECT_CREATED_EXTERNAL_EVENT {
                    AppEvent::ProjectCreated(project)
                } else {
                    AppEvent::ProjectUpdated(project)
                };
                Mapped::State(None, event)
            }
            PROJECT_DELETED_EXTERNAL_EVENT => {
                let ProjectDeletedIn {
                    project_id,
                    detached_session_ids,
                } = serde_json::from_value(payload)?;
                let mut managed = Vec::with_capacity(detached_session_ids.len());
                for session_id in detached_session_ids {
                    if self.is_managed(&session_id).await {
                        managed.push(session_id);
                    }
                }
                let event = AppEvent::ProjectDeleted(phone::ProjectDeletedEvent {
                    project_id,
                    detached_session_ids: managed,
                });
                Mapped::State(None, event)
            }
            USER_MESSAGE_PERSISTED_EVENT => {
                let UserMessagePersistedIn {
                    session_id,
                    message,
                    dispatch,
                    client_request_id,
                } = serde_json::from_value(payload)?;
                if !self.is_managed(&session_id).await {
                    return Ok(Mapped::Nothing);
                }
                let event = AppEvent::MessagePersisted(phone::MessagePersistedEvent {
                    session_id: session_id.clone(),
                    message: convert::brief_message(message),
                    dispatch: convert::dispatch(dispatch),
                    client_request_id,
                });
                Mapped::State(Some(session_id), event)
            }
            RUNNER_EVENT => {
                // Only subscribed sessions get this far (the sink), and a
                // phone can subscribe to managed sessions only.
                let RunnerEventIn { session_id, event } = serde_json::from_value(payload)?;
                Mapped::Runner(session_id, event)
            }
            SESSION_RUN_STATE_EVENT => {
                let state: SessionRunStatePayload = serde_json::from_value(payload)?;
                if !self.is_managed(&state.session_id).await {
                    return Ok(Mapped::Nothing);
                }
                let session_id = state.session_id.clone();
                let event = AppEvent::SessionRunState(convert::run_state_event(state));
                Mapped::State(Some(session_id), event)
            }
            RUNNER_HISTORY_REPLAY_EVENT => {
                let replay: HistoryReplayPayload = serde_json::from_value(payload)?;
                if !self.is_managed(&replay.session_id).await {
                    return Ok(Mapped::Nothing);
                }
                let session_id = replay.session_id.clone();
                let event = AppEvent::HistoryReplay(convert::history_replay(replay));
                Mapped::State(Some(session_id), event)
            }
            GOAL_UPDATED_EVENT => {
                let GoalUpdatedIn { goal } = serde_json::from_value(payload)?;
                let Some(session_id) = goal
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                else {
                    return Ok(Mapped::Nothing);
                };
                if !self.is_managed(&session_id).await {
                    return Ok(Mapped::Nothing);
                }
                let event = AppEvent::GoalUpdated(phone::GoalUpdatedEvent { goal });
                Mapped::State(Some(session_id), event)
            }
            SESSION_QUEUE_CHANGED_EVENT => {
                let SessionQueueChangedPayload { session_id, items } =
                    serde_json::from_value(payload)?;
                if !self.is_managed(&session_id).await {
                    return Ok(Mapped::Nothing);
                }
                let event = AppEvent::QueueChanged(phone::QueueChangedEvent {
                    session_id: session_id.clone(),
                    items: items.into_iter().map(convert::queued_message).collect(),
                });
                Mapped::State(Some(session_id), event)
            }
            _ => Mapped::Nothing,
        })
    }

    async fn batch(&mut self, session_id: String, event: Value) -> Result<(), Closed> {
        let full = match self.batches.iter_mut().find(|(id, _)| *id == session_id) {
            Some((_, events)) => {
                events.push(event);
                events.len() >= MAX_BATCH_EVENTS
            }
            None => {
                self.batches.push((session_id.clone(), vec![event]));
                false
            }
        };
        if full {
            return self.flush_session(&session_id).await;
        }
        if self.deadline.is_none() {
            self.deadline = Some(Instant::now() + self.window);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sink(capacity: usize) -> (EventSink, mpsc::Receiver<(String, Value)>, Arc<PhoneFilter>) {
        let filter = Arc::new(PhoneFilter::default());
        let (sink, rx, _dropped) = EventSink::new(capacity, filter.clone());
        (sink, rx, filter)
    }

    #[test]
    fn nothing_is_copied_while_no_phone_is_online() {
        let (sink, mut rx, filter) = sink(8);
        sink.forward(SESSION_UPDATED_EXTERNAL_EVENT, &json!({}));
        assert!(rx.try_recv().is_err());
        filter.set(1, BTreeSet::new());
        sink.forward(SESSION_UPDATED_EXTERNAL_EVENT, &json!({}));
        assert!(rx.try_recv().is_ok());
    }

    #[test]
    fn only_forwarded_events_and_subscribed_runner_events_pass() {
        let (sink, mut rx, filter) = sink(8);
        filter.set(1, BTreeSet::from(["s1".to_string()]));
        sink.forward("remote-status", &json!({}));
        sink.forward("runner-malformed", &json!({"sessionId": "s1"}));
        sink.forward(RUNNER_EVENT, &json!({"sessionId": "s2", "event": {}}));
        sink.forward(RUNNER_EVENT, &json!({"event": {}}));
        assert!(rx.try_recv().is_err());
        sink.forward(RUNNER_EVENT, &json!({"sessionId": "s1", "event": {}}));
        assert_eq!(rx.try_recv().unwrap().0, RUNNER_EVENT);
    }

    #[test]
    fn a_full_queue_drops_and_flags() {
        let filter = Arc::new(PhoneFilter::default());
        filter.set(1, BTreeSet::new());
        let (sink, _rx, dropped) = EventSink::new(2, filter);
        for _ in 0..2 {
            sink.forward(SESSION_UPDATED_EXTERNAL_EVENT, &json!({}));
        }
        assert!(!dropped.load(Ordering::Acquire));
        sink.forward(SESSION_UPDATED_EXTERNAL_EVENT, &json!({}));
        assert!(dropped.load(Ordering::Acquire));
    }
}
