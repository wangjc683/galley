//! A line the main chat's model tells the user mid-run (main chat ticket
//! 137, `.scratch/main-chat/issues/137-say-a-line-mid-run.md`, PRD ruling
//! 186 point 2).
//!
//! GA's loop gives a run one reply. The main chat's runner gives its model a
//! tool of Galley's own, `tell_user` (`runner/tell_user.py`), that sends the
//! user a message now while the run goes on: 「记上了，天气还在查」. The
//! runner reports each such message as the IPC event `tell_user`, during the
//! step that said it and before that step's `turn_end`; the runner watcher
//! hands it here, in event order, and it becomes a Galley message in the
//! conversation:
//!
//! - an `assistant` row on the step's `turn_index`, `sequence` 2 and up
//!   ([`SqliteGalley::persist_told_line`]): after the step's own row
//!   (`sequence` 1), before the words the user said that the step's end read
//!   (ticket 136's interjections share that space and come later), before
//!   the next step. A replayed history therefore holds it where the model
//!   said it, merged into the turn's assistant text, and every query about a
//!   step or a run's reply reads `sequence = 1` only;
//! - no broadcast of Core's own: the page draws it from the `runner-event`
//!   it already gets, as it draws `turn_end`, with the same row id; a phone
//!   gets the event in its `runner.event` batch and the row on a re-read.
//!
//! **A step's own words** (main chat ticket 142, PRD ruling 191): when a
//! step's reply calls tools and has words outside its tags, in a run the
//! user started, the runner sends them the same way before the tools run
//! (`runner/step_text.py`), marked `step_text`. Same row, same drawing; the
//! row carries the origin `system` / [`crate::db::MAIN_CHAT_STEP_TEXT_SUPERVISOR`],
//! which makes it shown only ([`crate::db::is_main_chat_step_text`]): the
//! step's own row has the words, so a replayed history (and what a new
//! segment carries, and a subtask's background) holds them once.
//!
//! **Only the managed main chat** ([`crate::interject::takes_interjections`],
//! the same test): the runner offers the tool nowhere else, and a message
//! from any other session is logged and dropped (CLAUDE.md Rule 1: attach
//! mode gets nothing of this).

use crate::api::{MessageVisibility, SessionId};
use crate::db::SqliteGalley;
use crate::ipc::TellUserEvent;

/// Write `event`'s message into the main chat `session_id` (see the module
/// docs). Failures are logged, never raised: the runner's event stream
/// must keep flowing, and the model was told the message went out.
pub async fn persist(galley: &SqliteGalley, session_id: &str, event: &TellUserEvent) {
    if !crate::interject::takes_interjections(galley, session_id).await {
        eprintln!("[tell_user {session_id}] not the managed main chat, dropped");
        return;
    }
    let visibility = match event.visibility.as_deref() {
        None | Some("visible") => MessageVisibility::Visible,
        Some("internal") => MessageVisibility::Internal,
        Some(other) => {
            eprintln!("[tell_user {session_id}] unknown visibility {other:?}, dropped");
            return;
        }
    };
    let turn_index = match event.absolute_turn_index {
        Some(index) => index,
        // Core supplies the base on every dispatch; this is the runner's
        // own formula on the run's opener, as for a `turn_end`.
        None => match galley.latest_user_turn_index(session_id).await {
            Ok(Some(base)) => base + (event.turn_index - 1).max(0),
            Ok(None) => event.turn_index,
            Err(e) => {
                eprintln!("[tell_user {session_id}] no turn index to write at: {e}");
                return;
            }
        },
    };
    let ids = format!(
        "session={session_id} turn={turn_index} index={}",
        event.index
    );
    let sid = SessionId(session_id.to_string());
    crate::turn_persistence::with_contention_retry("told line", &ids, || {
        galley.persist_told_line(
            &sid,
            turn_index,
            event.index,
            &event.message,
            visibility,
            event.step_text,
        )
    })
    .await;
}
