//! `session-run-state`: a session's live [`RunState`] as an event
//! (ticket 05c, `.scratch/ios-client/issues/05-remote-protocol-design.md`
//! §7 gap 3).
//!
//! The run state lives only in [`RunnerManager`]'s memory — the run gate
//! and queue, the ask-user hold, the runner process and its mid-turn
//! flag — and until now nothing announced its changes: the GUI infers
//! "running / asking / queued" from runner events, the socket polls
//! `session.run_state`. A phone needs it pushed.
//!
//! Every place in the manager that can change one of the fields reports
//! the session id on a [`RunStateFeed`]; one publisher task
//! ([`publish_run_states`]) reads the session's state afresh and emits
//! it when it differs from the last one it emitted for that session.
//! Reading afresh, from one task, means the last event always shows the
//! state after the last change, whatever order the reports raced in, and
//! a burst of reports (a turn ending and the next starting) collapses
//! into what is actually different. Events are states, not edges: a
//! change undone before the publisher reads it (a step that starts and
//! ends within a millisecond) may never appear. The reporters never
//! wait on the publisher.

use crate::notify::{notify, Notifier};
use crate::runner_manager::{RunState, RunnerManager};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;
use tokio::sync::mpsc;

/// Tauri event carrying [`SessionRunStatePayload`].
pub const SESSION_RUN_STATE_EVENT: &str = "session-run-state";

/// Payload of [`SESSION_RUN_STATE_EVENT`]: the session's whole
/// [`RunState`] after a change, every field present (`lastExit` is
/// `null` until a run has completed in this Core process). `Deserialize`
/// for the remote module, which reads it back off the event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRunStatePayload {
    pub session_id: String,
    pub runner_alive: bool,
    pub agent_running: bool,
    pub open_run: bool,
    pub queued_count: usize,
    pub ask_pending: bool,
    pub last_exit: Option<String>,
}

impl SessionRunStatePayload {
    pub fn new(session_id: &str, state: &RunState) -> Self {
        let RunState {
            runner_alive,
            agent_running,
            open_run,
            queued_count,
            ask_pending,
            last_exit,
        } = state.clone();
        Self {
            session_id: session_id.to_string(),
            runner_alive,
            agent_running,
            open_run,
            queued_count,
            ask_pending,
            last_exit,
        }
    }
}

/// Where the manager reports "this session's run state may have
/// changed". Unwired (headless tests, the CLI) it drops the reports.
/// Clones share one slot, so a [`crate::runner_manager::RunnerCommandHandle`]
/// made before the wiring reports too.
#[derive(Clone, Default)]
pub(super) struct RunStateFeed(Arc<std::sync::RwLock<Option<mpsc::UnboundedSender<String>>>>);

impl RunStateFeed {
    pub(super) fn wire(&self, tx: mpsc::UnboundedSender<String>) {
        *self.0.write().expect("run_state_feed poisoned") = Some(tx);
    }

    pub(super) fn is_wired(&self) -> bool {
        self.0.read().expect("run_state_feed poisoned").is_some()
    }

    /// Report a possible change. Never blocks.
    pub(super) fn touch(&self, session_id: &str) {
        if let Some(tx) = self.0.read().expect("run_state_feed poisoned").as_ref() {
            let _ = tx.send(session_id.to_string());
        }
    }
}

/// The publisher: for each reported session, read its [`RunState`] and
/// emit [`SESSION_RUN_STATE_EVENT`] when it differs from the last one
/// emitted for it. A session never emitted for counts as idle
/// ([`RunState::default`]), so the first event of a session is its first
/// change away from idle; one back at idle is forgotten again. Runs
/// until every sender is gone. Wired once at app init with
/// [`RunnerManager::set_run_state_feed`].
pub async fn publish_run_states(
    manager: Arc<RunnerManager>,
    notifier: Arc<dyn Notifier>,
    mut rx: mpsc::UnboundedReceiver<String>,
) {
    let mut last: HashMap<String, RunState> = HashMap::new();
    while let Some(first) = rx.recv().await {
        let mut reported = BTreeSet::from([first]);
        while let Ok(more) = rx.try_recv() {
            reported.insert(more);
        }
        for session_id in reported {
            let state = manager.run_state(&session_id).await;
            let unchanged = match last.get(&session_id) {
                Some(previous) => *previous == state,
                None => state == RunState::default(),
            };
            if unchanged {
                continue;
            }
            notify(
                notifier.as_ref(),
                SESSION_RUN_STATE_EVENT,
                &SessionRunStatePayload::new(&session_id, &state),
            );
            if state == RunState::default() {
                last.remove(&session_id);
            } else {
                last.insert(session_id, state);
            }
        }
    }
}
