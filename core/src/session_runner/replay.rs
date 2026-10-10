//! History replay (ticket 02b, `.scratch/ios-client/issues/02-core-send-takeover.md`).
//!
//! A runner starts with an empty GA history. Before it takes a turn for a
//! session that already has a conversation, Core sends it the session's
//! persisted messages as `load_history` (`docs/ipc-protocol.md` §5.5, §7) and
//! waits for the runner to confirm with `history_loaded`. Until 02b the GUI
//! did this on every `ready` it saw, so a runner Core started on its own —
//! a Goal turn on a cold session, the phone — ran on an empty history.
//!
//! This module holds the two halves [`super::ensure_session_runner`] uses:
//!
//! - [`rows_to_conversation_messages`]: persisted rows → `load_history`
//!   messages, rule for rule what the GUI's `rowsToConversationMessages`
//!   did. `core/tests/fixtures/history-replay-cases.json` pins it (the
//!   cases were proven against the TypeScript original before it was
//!   removed);
//! - [`replay_once`]: one attempt — wait for `ready`, send, wait for the
//!   runner's answer — announced to the GUI as `runner-history-replay`.

use super::RunnerHost;
use crate::api::{GalleyApi, SessionId};
use crate::db::PersistedMessageRow;
use crate::error::GalleyError;
use crate::ipc::{IpcCommand, IpcEvent, LoadHistoryCommand};
use crate::notify::notify;
use crate::runner_manager::BroadcastItem;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::sync::broadcast::{self, error::RecvError};
use tokio::time::Instant;

/// Tauri event around every `load_history` Core sends: `started` right
/// before it, then `done` or `failed` — once per attempt, so a restart
/// shows as a second `started`. The GUI shows "restoring" on it; a phone
/// will too.
pub const RUNNER_HISTORY_REPLAY_EVENT: &str = "runner-history-replay";

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HistoryReplayPayload {
    pub session_id: String,
    pub phase: HistoryReplayPhase,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HistoryReplayPhase {
    Started,
    Done,
    Failed,
}

/// How long one replay attempt waits. The defaults are the GUI's own
/// bounds before 02b: `BRIDGE_READY_WAIT_MS` for `ready`
/// (`gui/src/stores/runtime/bridge-slice.ts`) and
/// `HISTORY_REPLAY_TIMEOUT_MS` for the answer, counted from the moment
/// `load_history` is sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReplayTimeouts {
    pub ready: Duration,
    pub history: Duration,
}

impl Default for ReplayTimeouts {
    fn default() -> Self {
        Self {
            ready: Duration::from_secs(30),
            history: Duration::from_secs(8),
        }
    }
}

/// One `load_history` message (`docs/ipc-protocol.md` §5.5). `images` is
/// present only on a user message whose row had attachments — empty when
/// none of them was an image, exactly as the GUI sent it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
}

/// The fields of a persisted message row the conversion reads (the
/// `session_message_rows` shape, snake_case).
#[derive(Debug, Clone, Deserialize)]
pub struct ReplayRow {
    pub role: String,
    pub turn_index: i64,
    pub content: String,
    #[serde(default)]
    pub attachments: Vec<ReplayAttachment>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReplayAttachment {
    pub kind: String,
    pub path: String,
}

impl From<PersistedMessageRow> for ReplayRow {
    fn from(row: PersistedMessageRow) -> Self {
        Self {
            role: row.role,
            turn_index: row.turn_index,
            content: row.content,
            attachments: row
                .attachments
                .into_iter()
                .map(|a| ReplayAttachment {
                    kind: a.kind,
                    path: a.path,
                })
                .collect(),
        }
    }
}

/// A session's persisted rows (conversation order) → the history its
/// runner gets. `completed_turn_count` is the session row's `turn_count`,
/// which a turn bumps only when it ends.
///
/// - Only `user` / `assistant` rows count.
/// - A row past `completed_turn_count` is input still waiting for its
///   reply (the message just persisted for this very dispatch), not
///   history: replayed, GA would see it twice.
/// - A user row's image attachments ride along as `images`.
/// - Adjacent rows of one role merge: content joined by a blank line,
///   images concatenated (a multi-step run is one assistant message).
/// - A trailing user message is dropped — GA's history must not end on
///   an unanswered user turn.
pub fn rows_to_conversation_messages(
    rows: impl IntoIterator<Item = ReplayRow>,
    completed_turn_count: i64,
) -> Vec<ConversationMessage> {
    let mut messages: Vec<ConversationMessage> = Vec::new();
    for row in rows {
        if row.role != "user" && row.role != "assistant" {
            continue;
        }
        if row.turn_index > completed_turn_count {
            continue;
        }
        let images = (row.role == "user" && !row.attachments.is_empty()).then(|| {
            row.attachments
                .into_iter()
                .filter(|a| a.kind == "image")
                .map(|a| a.path)
                .collect::<Vec<_>>()
        });
        match messages.last_mut() {
            Some(prev) if prev.role == row.role => {
                prev.content.push_str("\n\n");
                prev.content.push_str(&row.content);
                if let Some(images) = images.filter(|images| !images.is_empty()) {
                    prev.images.get_or_insert_with(Vec::new).extend(images);
                }
            }
            _ => messages.push(ConversationMessage {
                role: row.role,
                content: row.content,
                images,
            }),
        }
    }
    if messages.last().is_some_and(|m| m.role == "user") {
        messages.pop();
    }
    messages
}

/// How one replay attempt ended.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Attempt {
    /// The runner confirmed with `history_loaded` — or there was nothing
    /// to load, its empty history already being the session's.
    Confirmed,
    /// Why it did not: no `ready`, a refusal, an exit, or no answer in time.
    Failed(String),
}

/// One replay attempt into runner `pid`: wait for its `ready` (the cache
/// answers for a runner that already reported), read the session's rows,
/// send `load_history`, wait for the answer. A `warning`-severity
/// `load_history` error is not an answer: the runner sends one for an
/// unvalidated backend and still loads (`_load_history` in
/// `runner/workbench_bridge.py`). Only reading the session fails the
/// call itself.
pub(super) async fn replay_once(
    host: &RunnerHost<'_>,
    session_id: &str,
    pid: u32,
    timeouts: ReplayTimeouts,
) -> Result<Attempt, GalleyError> {
    // Subscribe, then look: a `ready` broadcast before the subscription is
    // in the cache (folded before it is broadcast), a later one arrives on
    // `rx`; an exit before it shows as a dead pid, a later one on `rx`.
    let Some(mut rx) = host.runner.subscribe(session_id).await else {
        return Ok(Attempt::Failed("the runner is gone".into()));
    };
    if host.runner.live_pid(session_id).await != Some(pid) {
        return Ok(Attempt::Failed(
            "the runner exited before its history was restored".into(),
        ));
    }
    if host.runner.ready_snapshot(session_id).await.is_none() {
        if let Err(reason) = wait_for_ready(&mut rx, timeouts.ready).await {
            return Ok(Attempt::Failed(reason));
        }
    }

    let sid = SessionId(session_id.to_string());
    let completed = i64::from(
        host.galley
            .session_brief(sid.clone())
            .await?
            .turn_count
            .unwrap_or(0),
    );
    let rows = host.galley.persisted_message_rows(&sid).await?;
    let messages = rows_to_conversation_messages(rows.into_iter().map(ReplayRow::from), completed);
    if messages.is_empty() {
        return Ok(Attempt::Confirmed);
    }
    let command = IpcCommand::LoadHistory(LoadHistoryCommand {
        messages: messages
            .iter()
            .map(|m| serde_json::to_value(m).expect("a conversation message serializes"))
            .collect(),
    });

    announce(host, session_id, HistoryReplayPhase::Started);
    let started_at = Instant::now();
    let deadline = started_at + timeouts.history;
    let outcome = match host.runner.send_command(session_id, &command).await {
        Ok(()) => wait_for_history_loaded(&mut rx, deadline, timeouts.history).await,
        Err(e) => Attempt::Failed(format!("load_history was not delivered: {e}")),
    };
    eprintln!(
        "[session_runner {session_id}] load_history ({} messages) into pid {pid}: {} in {:.1}ms",
        messages.len(),
        match &outcome {
            Attempt::Confirmed => "confirmed".to_string(),
            Attempt::Failed(reason) => format!("failed ({reason})"),
        },
        started_at.elapsed().as_secs_f64() * 1000.0
    );
    announce(
        host,
        session_id,
        match outcome {
            Attempt::Confirmed => HistoryReplayPhase::Done,
            Attempt::Failed(_) => HistoryReplayPhase::Failed,
        },
    );
    Ok(outcome)
}

fn announce(host: &RunnerHost<'_>, session_id: &str, phase: HistoryReplayPhase) {
    notify(
        host.notifier.as_ref(),
        RUNNER_HISTORY_REPLAY_EVENT,
        &HistoryReplayPayload {
            session_id: session_id.to_string(),
            phase,
        },
    );
}

async fn wait_for_ready(
    rx: &mut broadcast::Receiver<BroadcastItem>,
    within: Duration,
) -> Result<(), String> {
    let deadline = Instant::now() + within;
    loop {
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            Ok(Ok(BroadcastItem::Event(event))) => {
                if matches!(*event, IpcEvent::Ready(_)) {
                    return Ok(());
                }
            }
            Ok(Ok(BroadcastItem::Malformed(_))) | Ok(Err(RecvError::Lagged(_))) => {}
            Ok(Ok(BroadcastItem::Closed { .. })) | Ok(Err(RecvError::Closed)) => {
                return Err("the runner exited before it was ready".into());
            }
            Err(_) => {
                return Err(format!(
                    "the runner did not report ready within {}s",
                    within.as_secs()
                ));
            }
        }
    }
}

async fn wait_for_history_loaded(
    rx: &mut broadcast::Receiver<BroadcastItem>,
    deadline: Instant,
    within: Duration,
) -> Attempt {
    loop {
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            Ok(Ok(BroadcastItem::Event(event))) => match *event {
                IpcEvent::HistoryLoaded(_) => return Attempt::Confirmed,
                IpcEvent::Error(e)
                    if e.context.as_deref() == Some("load_history") && e.severity != "warning" =>
                {
                    return Attempt::Failed(format!(
                        "the runner refused load_history: {}",
                        e.message
                    ));
                }
                _ => {}
            },
            Ok(Ok(BroadcastItem::Malformed(_))) | Ok(Err(RecvError::Lagged(_))) => {}
            Ok(Ok(BroadcastItem::Closed { .. })) | Ok(Err(RecvError::Closed)) => {
                return Attempt::Failed("the runner exited while restoring history".into());
            }
            Err(_) => {
                return Attempt::Failed(format!(
                    "the runner did not confirm load_history within {}s",
                    within.as_secs()
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// The shared golden cases. Each holds the rows and completed turn
    /// count of a session and the messages Core must send for them.
    #[test]
    fn golden_cases_convert_exactly() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/history-replay-cases.json"
        ))
        .expect("fixture parses");
        let cases = fixture["cases"].as_array().expect("cases array");
        assert!(cases.len() >= 10, "the fixture covers every rule");
        for case in cases {
            let name = case["name"].as_str().expect("name");
            let rows: Vec<ReplayRow> =
                serde_json::from_value(case["rows"].clone()).expect("rows parse");
            let completed = case["completedTurnCount"].as_i64().expect("count");
            let got = serde_json::to_value(rows_to_conversation_messages(rows, completed))
                .expect("messages serialize");
            assert_eq!(got, case["messages"], "case: {name}");
        }
    }
}
