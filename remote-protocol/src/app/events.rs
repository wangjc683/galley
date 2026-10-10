//! Events (design §6.4): Core → phone, best effort. A missed event is
//! repaired by re-reading (design §6.5), the same rule the GUI follows
//! (`core/src/notify.rs`). An event name this version does not know is
//! ignored ([`AppEvent::from_event`] returns `None`).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::types::{Message, Project, QueuedMessage, Session, SessionRunState};
use super::{to_value, AppError, Event};

/// `session.created` / `updated` / `archived` / `unarchived` / `moved`
/// (Core's `session-*-external`, ticket 02d). Always the whole row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEvent {
    pub session: Session,
    /// Who wrote: `gui`, a socket command name, or a Core task.
    pub via: String,
}

/// `session.deleted`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDeletedEvent {
    pub session_id: String,
    pub via: String,
}

/// `project.created` / `project.updated`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEvent {
    pub project: Project,
    pub via: String,
}

/// `project.deleted`. The project's sessions survive, moved out of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeletedEvent {
    pub project_id: String,
    pub detached_session_ids: Vec<String>,
}

/// Where a persisted user message stands (Core `user-message-persisted`
/// `dispatch`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Dispatch {
    /// Saved; the runner has not taken it yet.
    Pending,
    Dispatched,
    /// Saved, but nothing is running it.
    PersistedOnly,
    #[serde(other)]
    Unknown,
}

/// `message.persisted`: a user message reached the database, from any
/// sender. One message can be announced twice with the same id
/// (`pending`, then `dispatched` or `persisted_only`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagePersistedEvent {
    pub session_id: String,
    pub message: Message,
    pub dispatch: Dispatch,
    /// The sender's own id for the send; `null` from other senders.
    pub client_request_id: Option<String>,
}

/// `runner.event`: runner IPC events of a subscribed session, in order.
/// Core batches them (`turn_progress` over 100 ms), so one message may
/// carry several.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerEventBatch {
    pub session_id: String,
    /// Each one runner event exactly as Core's `IpcEvent` serializes it
    /// (`kind`-tagged, camelCase; `core/src/ipc.rs`,
    /// `docs/ipc-protocol.md`). Passed through untyped: the runner
    /// protocol owns the shape, and `turn_end` carries whole tool calls
    /// and results.
    pub events: Vec<Value>,
}

/// Replay phase of a runner taking a session's history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayPhase {
    Started,
    Done,
    Failed,
    #[serde(other)]
    Unknown,
}

/// `history.replay` (Core `runner-history-replay`): the phone shows
/// "restoring" on `started`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryReplayEvent {
    pub session_id: String,
    pub phase: ReplayPhase,
}

/// `goal.updated` (Core `goal-updated`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalUpdatedEvent {
    /// Core's `GoalBrief` as it serializes (camelCase), passed through:
    /// the Goal family's shape belongs to the Agent API (schema 2).
    pub goal: Value,
}

/// `queue.changed` (Core `session-queue:changed`): the whole queue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueChangedEvent {
    pub session_id: String,
    pub items: Vec<QueuedMessage>,
}

/// `sync.required`: Core dropped events for this phone (its queue was
/// full, design §6.5), so the phone must re-read instead of trusting its
/// state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequiredEvent {
    /// Re-read this session's messages; `null`: re-read everything
    /// (session list and the open session).
    pub session_id: Option<String>,
}

macro_rules! events {
    ($( $(#[$doc:meta])* $variant:ident = $name:literal ($payload:ty); )*) => {
        /// Every event name, in the design's order.
        pub const EVENTS: &[&str] = &[$($name),*];

        /// A decoded event, one variant per name.
        // Each event is built or decoded once and handed on; boxing the
        // message-carrying variants would buy nothing.
        #[allow(clippy::large_enum_variant)]
        #[derive(Debug, Clone, PartialEq)]
        pub enum AppEvent {
            $( $(#[$doc])* $variant($payload), )*
        }

        impl AppEvent {
            pub fn name(&self) -> &'static str {
                match self {
                    $( AppEvent::$variant(_) => $name, )*
                }
            }

            pub fn to_event(&self) -> Event {
                let payload = match self {
                    $( AppEvent::$variant(payload) => to_value(payload), )*
                };
                Event {
                    name: self.name().to_string(),
                    payload,
                }
            }

            /// `Ok(None)` for an event name this version does not know
            /// (ignore it); `Err` when a known event's payload does not fit.
            pub fn from_event(event: &Event) -> Result<Option<Self>, AppError> {
                let decoded = match event.name.as_str() {
                    $( $name => serde_json::from_value(event.payload.clone()).map(AppEvent::$variant), )*
                    _ => return Ok(None),
                };
                decoded.map(Some).map_err(|e| AppError::Json(e.to_string()))
            }
        }
    };
}

events! {
    SessionCreated = "session.created" (SessionEvent);
    SessionUpdated = "session.updated" (SessionEvent);
    SessionArchived = "session.archived" (SessionEvent);
    SessionUnarchived = "session.unarchived" (SessionEvent);
    SessionMoved = "session.moved" (SessionEvent);
    SessionDeleted = "session.deleted" (SessionDeletedEvent);
    ProjectCreated = "project.created" (ProjectEvent);
    ProjectUpdated = "project.updated" (ProjectEvent);
    ProjectDeleted = "project.deleted" (ProjectDeletedEvent);
    MessagePersisted = "message.persisted" (MessagePersistedEvent);
    /// Only for subscribed sessions.
    RunnerEvent = "runner.event" (RunnerEventBatch);
    SessionRunState = "session.runState" (SessionRunState);
    HistoryReplay = "history.replay" (HistoryReplayEvent);
    GoalUpdated = "goal.updated" (GoalUpdatedEvent);
    QueueChanged = "queue.changed" (QueueChangedEvent);
    SyncRequired = "sync.required" (SyncRequiredEvent);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_events_are_ignored_and_bad_payloads_are_errors() {
        let unknown = Event {
            name: "session.teleported".into(),
            payload: serde_json::json!({}),
        };
        assert_eq!(AppEvent::from_event(&unknown).unwrap(), None);
        let bad = Event {
            name: "history.replay".into(),
            payload: serde_json::json!({"sessionId": 1}),
        };
        assert!(AppEvent::from_event(&bad).is_err());
    }

    #[test]
    fn event_round_trip_and_names() {
        let event = AppEvent::SyncRequired(SyncRequiredEvent { session_id: None });
        let wire = event.to_event();
        assert_eq!(wire.name, "sync.required");
        assert_eq!(wire.payload, serde_json::json!({"sessionId": null}));
        assert_eq!(AppEvent::from_event(&wire).unwrap(), Some(event));
        let unique: std::collections::HashSet<_> = EVENTS.iter().collect();
        assert_eq!(unique.len(), EVENTS.len());
    }
}
