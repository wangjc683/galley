//! What the user says while the main chat's run is going (main chat ticket
//! 136, `.scratch/main-chat/issues/136-interject-mid-run.md`, PRD ruling
//! 186).
//!
//! Before this, a message sent while a run was open waited in Core's queue
//! until the run ended (ruling 71, point 4): a correction such as 「算了，查
//! 后天」 reached the assistant only after it had finished the thing it
//! corrected. Now, in the managed main chat, it reaches the run's next step
//! through GA's own seam, `intervene` (`managed-ga/code/ga.py`
//! `turn_end_callback`: each step's end reads it into the next step's
//! prompt as `[MASTER] …`), and the model decides what to do with it.
//!
//! **The message is a queue item until the run reads it.** Core's send
//! (`crate::session_send`, the phone) and socket `session.send` offer it
//! with [`RunnerManager::queue_offer_interjection`]: queued marked
//! `interjected` (only while a run is open, no stop is on its way and only
//! interjections wait), then handed to the runner ([`hand_over`], the
//! `interject` command). Two ways out of the queue, exactly one taken:
//!
//! - the runner reports `interject_delivered` after the `turn_end` of the
//!   step whose end read it: the runner watcher takes it out of the queue
//!   and [`persist_delivered`] writes it right after that step — same
//!   `turn_index`, `sequence` 2 and up, so the transcript and the replayed
//!   history put it where the model read it, and it takes no index of its
//!   own (`SqliteGalley::persist_interjections`);
//! - the run ends first (its last step was the reply, it asked, it
//!   stopped, it failed): the runner clears `intervene` and reports
//!   `interject_returned` (logged; the queue is the authority), and the
//!   item, still queued, goes out after `run_complete` as any queued
//!   message — as the answer when the run ended on a question
//!   ([`RunnerManager::queue_take_next_item`]). Whatever interjections
//!   are still queued then are handed to that new run
//!   ([`hand_over_queued`]).
//!
//! **Only the managed main chat** ([`takes_interjections`]):
//! `intervene` is GA's own attribute, and attach mode may not write GA
//! state (CLAUDE.md Rule 1); workbench sessions, subtasks and the IM
//! channels queue as before. The runner checks the same itself
//! (`runner/workbench_bridge.py` `_interjections_allowed`).
//!
//! [`RunnerManager::queue_offer_interjection`]: crate::runner_manager::RunnerManager::queue_offer_interjection
//! [`RunnerManager::queue_take_next_item`]: crate::runner_manager::RunnerManager::queue_take_next_item

use crate::api::{GalleyApi, Origin, OriginVia, QueuedMessage, RuntimeKind, SessionId};
use crate::db::SqliteGalley;
use crate::ipc::{InterjectCommand, InterjectDeliveredEvent, InterjectItem, IpcCommand};
use crate::notify::{notify, Notifier};
use crate::session_send::{UserMessagePersistedPayload, USER_MESSAGE_PERSISTED_EVENT};
use crate::socket_listener::RunnerPort;

/// What goes before the user's words in the step that reads them (ruling
/// 186, point 2): that they came while it worked, and that what to do
/// about them is its call. The meaning and nothing more; no rules.
pub const INTERJECTION_PREAMBLE: &str = "The user sent this while you were working. \
It is your call whether to carry on, change course, or hand what you are doing to a \
subtask and answer them first.";

/// `dispatch` of the `user-message-persisted` that writes an interjection
/// the run read.
pub const DISPATCH_INTERJECTED: &str = "interjected";

/// Whether a message sent to `session_id` while a run is open may go to
/// that run: the main chat, on the managed runtime. A failed read says no
/// (the message then queues as before).
pub async fn takes_interjections(galley: &SqliteGalley, session_id: &str) -> bool {
    match galley
        .session_brief(SessionId(session_id.to_string()))
        .await
    {
        Ok(session) => {
            session.main_chat == Some(true) && session.ga_runtime_kind == RuntimeKind::Managed
        }
        Err(_) => false,
    }
}

/// Hand `items` (queue id, text) to the session's runner (`interject`). A
/// runner that is gone or cannot take them changes nothing: the items
/// stay queued and go out after the run.
pub async fn hand_over(runner: &dyn RunnerPort, session_id: &str, items: Vec<InterjectItem>) {
    if items.is_empty() {
        return;
    }
    let cmd = IpcCommand::Interject(InterjectCommand {
        items,
        preamble: INTERJECTION_PREAMBLE.to_string(),
    });
    if let Err(e) = runner.send_command(session_id, &cmd).await {
        eprintln!("[interject {session_id}] not handed to the runner, sent after the run: {e}");
    }
}

/// A run just opened: hand it the interjections still queued (ones an
/// earlier run never read, or that reached the queue while this one was
/// being started). The runner takes each once per run.
pub async fn hand_over_queued(runner: &dyn RunnerPort, session_id: &str) {
    let items: Vec<InterjectItem> = runner
        .queue_snapshot(session_id)
        .await
        .into_iter()
        .filter(|item| item.interjected)
        .map(|item| InterjectItem {
            id: item.queue_id,
            text: item.text,
        })
        .collect();
    hand_over(runner, session_id, items).await;
}

/// The runner watcher's half: `items` (taken out of the queue) were read
/// at the end of the step `event` names. Write them right after that
/// step and announce each as `user-message-persisted` (`dispatch:
/// "interjected"`, with its queue id and its sender's request id). The
/// model has read them, so a failed write is logged, never re-queued (that
/// would send them twice).
pub async fn persist_delivered(
    galley: &SqliteGalley,
    notifier: &dyn Notifier,
    session_id: &str,
    event: &InterjectDeliveredEvent,
    items: Vec<QueuedMessage>,
) {
    if items.is_empty() {
        return;
    }
    let turn_index = match event.absolute_turn_index {
        Some(index) => index,
        // Core supplies the base on every dispatch; this is the runner's
        // own formula on the run's opener, as for a `turn_end`.
        None => match galley.latest_user_turn_index(session_id).await {
            Ok(Some(base)) => base + (event.turn_index - 1).max(0),
            Ok(None) => event.turn_index,
            Err(e) => {
                eprintln!("[interject {session_id}] no turn index to write at: {e}");
                return;
            }
        },
    };
    let messages: Vec<(String, Origin)> = items
        .iter()
        .map(|item| {
            (
                item.text.clone(),
                item.origin.clone().unwrap_or(Origin {
                    via: OriginVia::Gui,
                    supervisor: None,
                    reason: None,
                    client: None,
                }),
            )
        })
        .collect();
    let ids = format!("session={session_id} turn={turn_index}");
    let sid = SessionId(session_id.to_string());
    let Some(briefs) =
        crate::turn_persistence::with_contention_retry("interjection rows", &ids, || {
            galley.persist_interjections(&sid, turn_index, &messages)
        })
        .await
    else {
        return;
    };
    for (message, item) in briefs.into_iter().zip(items) {
        notify(
            notifier,
            USER_MESSAGE_PERSISTED_EVENT,
            &UserMessagePersistedPayload {
                session_id: session_id.to_string(),
                message,
                dispatch: DISPATCH_INTERJECTED,
                client_request_id: item.client_request_id,
                queue_id: Some(item.queue_id),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_preamble_says_what_it_is_and_whose_call_it_is() {
        // One or two sentences, English, no rules (ruling 186 point 2).
        assert!(INTERJECTION_PREAMBLE.starts_with("The user sent this while you were working."));
        assert!(INTERJECTION_PREAMBLE.contains("your call"));
        assert!(INTERJECTION_PREAMBLE.contains("subtask"));
        assert!(!INTERJECTION_PREAMBLE.contains('\n'));
        assert!(!INTERJECTION_PREAMBLE.contains('\r'));
    }
}
