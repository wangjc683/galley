//! Per-session outbound message queue (galley#19 / #20).
//!
//! State model — one entry per session, in-memory only:
//!
//! - `open_run`: a user_message / ask_user_response has been dispatched
//!   and its `RunCompleteEvent` has not arrived yet. This is the queue's
//!   own gate, deliberately NOT [`RunnerProcess::agent_running`]: that
//!   AtomicBool clears on every `TurnEnd`, so it reads `false` in the
//!   inter-turn gap of a multi-turn run — dispatching there would
//!   corrupt the bridge's serial event bookkeeping. `open_run` closes
//!   only on `RunComplete` (or bridge close).
//! - `ask_pending`: the run ended on an `ask_user` question. Auto-drain
//!   holds while it is set — feeding an unrelated queued message to an
//!   agent that explicitly asked the user something is wrong. Cleared
//!   when an answer (or a preempting user message) is dispatched.
//! - `items`: FIFO of [`QueuedMessage`]s. Strict order, no merging —
//!   the no-message-loss guarantee outranks "last one wins".
//!
//! Ordering safety of [`RunnerManager::queue_offer`]'s rule
//! ("enqueue when `open_run` OR items pending, else reserve+dispatch"):
//! a new send can never overtake an already-queued item, because a
//! non-empty queue always routes to the back; and a message can never
//! strand (enqueue with `open_run == false` and an empty queue never
//! happens — that case dispatches).
//!
//! Queue entries survive bridge crash / respawn (they hang off the
//! session key, not the process). They do not survive Core restart —
//! decided scope (PRD 定案 2): a queued message has the standing of an
//! unsent draft.

use crate::api::QueuedMessage;
#[cfg(doc)]
use crate::runner_manager::RunSignal;
use std::collections::VecDeque;

/// Queue + run-gate state for one session.
#[derive(Debug, Default)]
pub(super) struct SessionQueueState {
    pub(super) open_run: bool,
    pub(super) ask_pending: bool,
    pub(super) items: VecDeque<QueuedMessage>,
    /// Who opened the current run: a user-initiated turn (any
    /// `send_command` that opens the gate) or a Goal v2 continuation the
    /// engine stamped right after dispatching. Read back through
    /// [`RunOutcome::continuation`] when the run settles.
    pub(super) run_kind: RunKind,
    /// Facts the per-spawn forwarder collects while the run is open —
    /// the final turn's `<goal-status>` tag, a fatal error — and folds
    /// into the [`RunOutcome`] it stores on `RunComplete`.
    pub(super) draft: RunOutcomeDraft,
    /// Outcome of the most recently settled run, taken (and cleared) by
    /// the drain task's goal evaluation.
    pub(super) last_outcome: Option<RunOutcome>,
    /// The forwarder already announced this run's first `TurnStart`
    /// ([`RunSignal::UserRunStarted`]); reset when the run settles.
    pub(super) started_notified: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum RunKind {
    #[default]
    UserTurn,
    GoalContinuation,
}

#[derive(Debug, Default, Clone)]
pub(super) struct RunOutcomeDraft {
    pub(super) goal_tag: Option<String>,
    pub(super) summary: Option<String>,
    pub(super) errored: Option<String>,
}

/// How the last run on a session ended, as far as the Goal v2 engine
/// cares (.scratch/goal-simplify/PRD.md §3.3). Assembled by the
/// forwarder from the event stream and handed to the drain task with
/// the `RunComplete` signal.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunOutcome {
    /// The run was cut short by `IpcCommand::Abort` (the bridge marks
    /// its synthesized run_complete with `ABORTED`).
    pub aborted: bool,
    /// A fatal (non-business, error-severity) bridge / runtime error
    /// was reported during the run — its message.
    pub errored: Option<String>,
    /// `<goal-status>` tag on the final turn: `"complete"` / `"blocked"`.
    pub goal_tag: Option<String>,
    /// GA's one-line summary of the final turn — what a completed or
    /// blocked goal records as its `latest_summary`.
    pub summary: Option<String>,
    /// The run was a Goal continuation the engine dispatched, not a
    /// user-initiated turn.
    pub continuation: bool,
}

/// Outcome of [`RunnerManager::queue_offer`].
#[derive(Debug)]
pub enum QueueOffer {
    /// The message was queued. `position` is 0-based within the queue.
    Queued { queue_id: String, position: usize },
    /// The session is idle with an empty queue: the caller must persist
    /// and dispatch NOW. `open_run` has already been reserved so a
    /// concurrent offer routes behind this message; on dispatch failure
    /// the caller must call [`RunnerManager::queue_release_run`].
    DispatchNow,
}

/// Outcome of [`RunnerManager::queue_jump`].
#[derive(Debug)]
pub enum QueueJump {
    /// Item moved to the front and an abort is required: the caller
    /// sends `IpcCommand::Abort`; the RunComplete drain then dispatches
    /// the front item.
    AbortThenDrain,
    /// Session already idle: the item was popped (run reserved) and the
    /// caller must persist + dispatch it now (failure →
    /// [`RunnerManager::queue_release_run`] + re-queue front).
    DispatchNow(QueuedMessage),
    NotFound,
}

/// Same timestamp + counter + pid mint as `mint_session_id`
/// (socket_listener/session_cmds.rs) — collision-safe within one Core
/// process, which is the queue id's entire lifetime.
pub(crate) fn mint_queue_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static QUEUE_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let counter = QUEUE_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nonce = (dur.as_nanos() as u64)
        ^ counter.rotate_left(17)
        ^ (u64::from(std::process::id())).rotate_left(32);
    format!("qm_{:x}{:04x}", nonce, counter & 0xffff)
}

pub(crate) fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
