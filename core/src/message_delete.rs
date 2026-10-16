//! Deleting one message of the main chat (主对话 ticket 32, PRD ruling
//! 83): the user right-clicks a bubble, confirms, and it is gone from the
//! conversation, the database, search and the history lookup; the
//! assistant does not see it from its next turn on; the phone drops it.
//!
//! **What one message is** (WeChat's semantics: yours and its replies are
//! deleted each on their own). Core works it out from the one row the
//! desktop names, the anchor ([`message_unit`]), by reading the rows the
//! way the desktop groups them into runs (`buildRunGroups` in
//! `gui/src/lib/run-groups.ts`, with the main chat's split after an
//! answer), so the bubble the page removes and the rows Core deletes are
//! the same set; the page removes exactly the ids this returns.
//!
//! - A user row (what you said, or your answer to its question): that
//!   row, and its attachment files.
//! - The greeting: that row.
//! - Any row of its reply — the answer, a question it asked, a step of
//!   the process the process card lists: every assistant row of that run,
//!   tool results included (they may hold what the message was about);
//!   your rows in it stay. A run Core woke it for (a subtask report,
//!   tickets 29 / 31) goes with its hidden report row, so a replay never
//!   shows the model a report it never answered.
//! - A report row on its own, a system row, a row the page does not draw:
//!   refused.
//!
//! **Refused, nothing changed**: not the main chat; the main chat running
//! (its run gate open or a turn going) or waiting for the user's answer
//! (live, or its latest reply ending on a question, which survives a
//! restart); a reply with subtask cards under it (any dispatch record,
//! ticket 06a: deleting it would leave its subtasks where nothing leads
//! to them — the desktop greys the item and says why).
//!
//! **The steps**, the check, the files, the runner and the rows under the
//! session's single-flight slot ([`crate::session_runner::enter_single_flight`]),
//! so no ensure replays the rows halfway through:
//!
//! 1. Move each deleted user row's attachment directory aside, in place
//!    (a rename next to it). If one cannot be moved, nothing is deleted:
//!    the point of deleting is that it is gone, and a row deleted with
//!    its image left on disk would break that silently. A rename is
//!    all-or-nothing and needs no copy; on Windows an image open
//!    elsewhere refuses it, and the dialog says so.
//! 2. Retire the live runner, quietly (`RunnerPort::retire`, as a new
//!    segment does, `session_runner::segment`): its GA history still
//!    holds the rows. No new segment: the rest of this one stays.
//! 3. Delete the rows in one transaction
//!    ([`SqliteGalley::delete_main_chat_messages`]: search rows,
//!    attachment rows, the turn-index floor, the summary). If that fails
//!    the directories go back.
//! 4. Out of the slot: delete the moved directories (a failure is only
//!    logged; the directory is renamed out of every path Galley reads),
//!    broadcast [`MESSAGE_DELETED_EVENT`] and the session row, and start
//!    the runner again in the background if one was retired, so the page
//!    keeps a live runner as before (`runner-spawned-external`); its
//!    replay leaves the deleted rows out.
//!
//! Desktop only: the `delete_main_chat_message` Tauri command. No socket
//! command and no CLI (the Agent API does not change), no phone method yet
//! (the phone hears `message.deleted`). Attach mode has no main chat.

use std::fmt;
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::api::{GalleyApi, Origin, SessionId};
use crate::db::{is_main_chat_greeting, MessageUnitRow, SqliteGalley};
use crate::main_chat_reset::RunnerStarter;
use crate::notify::{notify, Notifier};
use crate::session_writes::{announce_session, SESSION_UPDATED_EXTERNAL_EVENT, VIA_GUI};
use crate::socket_listener::RunnerPort;
use crate::turn_persistence::js_trim;

/// Tauri event after a deletion: `{sessionId, messageIds, via}`. The page
/// drops those rows wherever it holds them; the remote module forwards it
/// to phones as `message.deleted`.
pub const MESSAGE_DELETED_EVENT: &str = "message-deleted";

/// `via` of the runner a deletion starts again
/// (`runner-spawned-external`).
pub const VIA_MESSAGE_DELETE: &str = "message-delete";

/// [`MESSAGE_DELETED_EVENT`]'s payload, and the command's answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDeletedPayload {
    pub session_id: String,
    /// Every row deleted, in conversation order.
    pub message_ids: Vec<String>,
    /// Who deleted: `gui`.
    pub via: String,
}

/// Why a deletion did not happen, or did not finish. On the Tauri wire it
/// is `{"error": "<tag>", "detail": "..."}`, like the reset's errors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "error", rename_all = "snake_case")]
pub enum DeleteMessageError {
    /// The session is not the main chat. Nothing changed.
    NotMainChat { detail: String },
    /// No such message in it, or one the conversation does not draw on
    /// its own (a subtask report row). Nothing changed.
    NotFound { detail: String },
    /// The main chat is running or waiting for the user's answer.
    /// Nothing changed.
    Busy { detail: String },
    /// The reply dispatched subtasks; their cards hang under it. Nothing
    /// changed.
    HasSubtasks { detail: String },
    /// Something failed; `detail` says what, and whether anything had
    /// changed by then.
    Failed { detail: String },
}

impl fmt::Display for DeleteMessageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotMainChat { detail } => write!(f, "not_main_chat: {detail}"),
            Self::NotFound { detail } => write!(f, "not_found: {detail}"),
            Self::Busy { detail } => write!(f, "busy: {detail}"),
            Self::HasSubtasks { detail } => write!(f, "has_subtasks: {detail}"),
            Self::Failed { detail } => write!(f, "failed: {detail}"),
        }
    }
}

impl std::error::Error for DeleteMessageError {}

fn failed(detail: String) -> DeleteMessageError {
    DeleteMessageError::Failed { detail }
}

// ---------------- which rows ----------------

/// The rows one message is ([`message_unit`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageUnit {
    /// Rows to delete, in conversation order.
    pub ids: Vec<String>,
    /// `turn_index` of each reply row among them (assistant rows other
    /// than the greeting): where a subtask dispatch would be recorded.
    pub reply_turns: Vec<i64>,
}

/// Why an anchor names no message ([`message_unit`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnitRefusal {
    /// No visible row with that id.
    NotFound,
    /// A row the conversation does not draw on its own: a subtask report
    /// row, a system row.
    NotDrawn,
}

/// The tools of a row as the desktop reads them (`toolEventsFromRaw`):
/// each call's `toolName`, `(unknown)` when it has none; malformed JSON
/// holds none (`safeParseJsonArray`).
fn tool_names(row: &MessageUnitRow) -> Vec<String> {
    let calls = row
        .tool_calls
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|value| match value {
            Value::Array(calls) => Some(calls),
            _ => None,
        })
        .unwrap_or_default();
    calls
        .iter()
        .map(|call| {
            call.get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("(unknown)")
                .to_string()
        })
        .collect()
}

/// `hasAskUserTool`: the next user row answers it.
fn asks_user(row: &MessageUnitRow) -> bool {
    tool_names(row).iter().any(|name| name == "ask_user")
}

/// `isClosingTurn`: an answer — no question, no tool but `no_tool`, and
/// an answer that is not blank.
fn closes(row: &MessageUnitRow) -> bool {
    let names = tool_names(row);
    !names.iter().any(|name| name == "ask_user")
        && names.iter().all(|name| name == "no_tool")
        && !js_trim(row.final_answer.as_deref().unwrap_or("")).is_empty()
}

fn is_greeting(row: &MessageUnitRow) -> bool {
    is_main_chat_greeting(
        &row.role,
        row.created_via.as_deref(),
        row.supervisor.as_deref(),
    )
}

fn is_report(row: &MessageUnitRow) -> bool {
    row.role == "user"
        && Origin::is_stored_subtask_report(row.created_via.as_deref(), row.supervisor.as_deref())
}

/// One run of the conversation: its opener (a user row; `None` for a
/// headless run) and its members, by index into the rows.
struct Run {
    opener: Option<usize>,
    members: Vec<usize>,
}

/// The rows grouped into runs exactly as the main chat's conversation
/// groups its turns (`buildRunGroups` with `splitAfterAnswer`): a user
/// row opens a run unless it answers the question the run's last reply
/// step asked; an assistant row after an answer (a closing step) starts a
/// run of its own, which only happens once the user row between them was
/// deleted; system rows join the run they are in. Other roles are no
/// turn and belong to no run.
fn runs(rows: &[MessageUnitRow]) -> Vec<Run> {
    let mut runs = Vec::new();
    let mut current: Option<Run> = None;
    // State of the current run: its last reply step asked a question
    // nobody has answered yet; its last reply step was an answer.
    let mut awaiting_reply = false;
    let mut last_closes = false;
    for (index, row) in rows.iter().enumerate() {
        match row.role.as_str() {
            "user" => {
                if awaiting_reply {
                    if let Some(run) = current.as_mut() {
                        run.members.push(index);
                        awaiting_reply = false;
                        continue;
                    }
                }
                runs.extend(current.take());
                current = Some(Run {
                    opener: Some(index),
                    members: vec![index],
                });
                awaiting_reply = false;
                last_closes = false;
            }
            "assistant" => {
                if current.is_some() && !awaiting_reply && last_closes {
                    runs.extend(current.take());
                }
                current
                    .get_or_insert_with(|| Run {
                        opener: None,
                        members: Vec::new(),
                    })
                    .members
                    .push(index);
                awaiting_reply = asks_user(row);
                last_closes = closes(row);
            }
            "system" => current
                .get_or_insert_with(|| Run {
                    opener: None,
                    members: Vec::new(),
                })
                .members
                .push(index),
            _ => {}
        }
    }
    runs.extend(current);
    runs
}

/// The rows of the message `anchor` names, read from `rows` (a session's
/// visible rows in conversation order): see the module docs.
pub fn message_unit(rows: &[MessageUnitRow], anchor: &str) -> Result<MessageUnit, UnitRefusal> {
    let at = rows
        .iter()
        .position(|row| row.id == anchor)
        .ok_or(UnitRefusal::NotFound)?;
    let row = &rows[at];
    match row.role.as_str() {
        "user" if is_report(row) => Err(UnitRefusal::NotDrawn),
        "user" => Ok(MessageUnit {
            ids: vec![row.id.clone()],
            reply_turns: Vec::new(),
        }),
        "assistant" if is_greeting(row) => Ok(MessageUnit {
            ids: vec![row.id.clone()],
            reply_turns: Vec::new(),
        }),
        "assistant" => {
            let run = runs(rows)
                .into_iter()
                .find(|run| run.members.contains(&at))
                .expect("every assistant row is in a run");
            let report = run.opener.filter(|&opener| is_report(&rows[opener]));
            let mut picked: Vec<usize> = run
                .members
                .iter()
                .copied()
                .filter(|&i| rows[i].role == "assistant" && !is_greeting(&rows[i]))
                .collect();
            picked.extend(report);
            picked.sort_unstable();
            Ok(MessageUnit {
                ids: picked.iter().map(|&i| rows[i].id.clone()).collect(),
                reply_turns: picked
                    .iter()
                    .filter(|&&i| rows[i].role == "assistant")
                    .map(|&i| rows[i].turn_index)
                    .collect(),
            })
        }
        _ => Err(UnitRefusal::NotDrawn),
    }
}

// ---------------- the deletion ----------------

/// Delete the message of the main chat `session_id` that row `message_id`
/// is part of (see the module docs). `attachments_root` is
/// `conversation-attachments/` next to `workbench.db` (passed in, so
/// tests never resolve the real one). Returns what was deleted, which is
/// also what was broadcast.
pub async fn delete_main_chat_message(
    galley: &SqliteGalley,
    runner: &dyn RunnerPort,
    starter: &dyn RunnerStarter,
    notifier: &dyn Notifier,
    attachments_root: &Path,
    session_id: &SessionId,
    message_id: &str,
) -> Result<MessageDeletedPayload, DeleteMessageError> {
    let sid = session_id.as_str();
    let is_main = galley
        .is_main_chat(session_id)
        .await
        .map_err(|e| failed(format!("reading the session failed, nothing changed: {e}")))?;
    if !is_main {
        return Err(DeleteMessageError::NotMainChat {
            detail: format!("session {sid} is not the main chat"),
        });
    }

    let slot = crate::session_runner::enter_single_flight(sid).await;
    let state = runner.run_state(sid).await;
    if state.open_run || state.agent_running {
        return Err(DeleteMessageError::Busy {
            detail: "the main chat is running".into(),
        });
    }
    let ends_on_question = galley
        .main_chat_segment_facts(session_id)
        .await
        .map_err(|e| {
            failed(format!(
                "reading the main chat failed, nothing changed: {e}"
            ))
        })?
        .ends_on_question;
    if state.ask_pending || ends_on_question {
        return Err(DeleteMessageError::Busy {
            detail: "the main chat is waiting for an answer".into(),
        });
    }

    let rows = galley
        .message_unit_rows(session_id)
        .await
        .map_err(|e| failed(format!("reading the messages failed, nothing changed: {e}")))?;
    let unit = message_unit(&rows, message_id).map_err(|refusal| match refusal {
        UnitRefusal::NotFound => DeleteMessageError::NotFound {
            detail: format!("message {message_id} is not in the main chat"),
        },
        UnitRefusal::NotDrawn => DeleteMessageError::NotFound {
            detail: format!("message {message_id} is not a message of its own"),
        },
    })?;
    let has_subtasks = galley
        .has_subtask_dispatch_in(session_id, &unit.reply_turns)
        .await
        .map_err(|e| failed(format!("reading the subtasks failed, nothing changed: {e}")))?;
    if has_subtasks {
        return Err(DeleteMessageError::HasSubtasks {
            detail: "the reply dispatched subtasks".into(),
        });
    }

    // 1. The files, moved aside.
    let staged = stage_attachments(attachments_root, sid, &unit.ids).map_err(|e| {
        failed(format!(
            "moving the attachment files aside failed, nothing was deleted: {e}"
        ))
    })?;

    // 2. The runner.
    let retired = match runner.live_pid(sid).await {
        Some(pid) => runner.retire(sid, pid).await,
        None => false,
    };

    // 3. The rows.
    let deletion = match galley
        .delete_main_chat_messages(session_id, &unit.ids)
        .await
    {
        Ok(deletion) => deletion,
        Err(e) => {
            let files = match staged.restore() {
                Ok(()) => "the attachment files are back".to_string(),
                Err(re) => format!("putting the attachment files back failed too: {re}"),
            };
            drop(slot);
            if retired {
                start_runner(starter, session_id);
            }
            return Err(failed(format!(
                "deleting the message failed, nothing was deleted ({files}): {e}"
            )));
        }
    };
    drop(slot);

    // 4. Clean-up, broadcasts, the runner again.
    staged.remove();
    let payload = MessageDeletedPayload {
        session_id: sid.to_string(),
        message_ids: deletion.ids,
        via: VIA_GUI.to_string(),
    };
    notify(notifier, MESSAGE_DELETED_EVENT, &payload);
    match galley.session_brief(session_id.clone()).await {
        Ok(brief) => announce_session(notifier, SESSION_UPDATED_EXTERNAL_EVENT, brief, VIA_GUI),
        Err(e) => eprintln!("[message-delete] reading the main chat {sid} back failed: {e}"),
    }
    if retired {
        start_runner(starter, session_id);
    }
    eprintln!(
        "[message-delete] main chat {sid}: deleted {} row(s) from {message_id}{}",
        payload.message_ids.len(),
        if retired {
            "; runner retired and starting again"
        } else {
            ""
        }
    );
    Ok(payload)
}

/// Start `session_id`'s runner again in the background; a failure is
/// logged (the next send starts one).
fn start_runner(starter: &dyn RunnerStarter, session_id: &SessionId) {
    let start = starter.start(session_id.clone());
    let id = session_id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = start.await {
            eprintln!("[message-delete] starting the runner of {id} again failed: {e}");
        }
    });
}

// ---------------- attachment files ----------------

/// Attachment directories moved aside, each `(where it was, where it is
/// now)`.
struct StagedAttachments {
    moved: Vec<(PathBuf, PathBuf)>,
}

impl StagedAttachments {
    /// Put every directory back.
    fn restore(&self) -> io::Result<()> {
        let mut first_error = None;
        for (original, aside) in self.moved.iter().rev() {
            if let Err(e) = std::fs::rename(aside, original) {
                first_error.get_or_insert(e);
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    /// Delete the moved directories; a failure is logged.
    fn remove(&self) {
        for (_, aside) in &self.moved {
            if let Err(e) = std::fs::remove_dir_all(aside) {
                eprintln!(
                    "[message-delete] deleting the attachment files at {} failed: {e}",
                    aside.display()
                );
            }
        }
    }
}

/// One plain path component (a session or message id), so no id can
/// point a rename anywhere else.
fn is_plain_component(name: &str) -> bool {
    let mut components = Path::new(name).components();
    matches!(
        (components.next(), components.next()),
        (Some(Component::Normal(_)), None)
    )
}

/// Move the attachment directory of each of `ids` that has one
/// (`<root>/<session>/<message>`, where Core writes a message's images)
/// to `.deleted-<message>` beside it. All or nothing: on a failure the
/// ones already moved go back and the error is returned.
fn stage_attachments(
    root: &Path,
    session_id: &str,
    ids: &[String],
) -> io::Result<StagedAttachments> {
    let mut staged = StagedAttachments { moved: Vec::new() };
    if !is_plain_component(session_id) {
        return Ok(staged);
    }
    let dir = root.join(session_id);
    for id in ids {
        if !is_plain_component(id) {
            continue;
        }
        let original = dir.join(id);
        if !original.is_dir() {
            continue;
        }
        let aside = dir.join(format!(".deleted-{id}"));
        let moved = (|| {
            if aside.exists() {
                // Left by an earlier deletion whose clean-up failed.
                std::fs::remove_dir_all(&aside)?;
            }
            std::fs::rename(&original, &aside)
        })();
        if let Err(e) = moved {
            if let Err(re) = staged.restore() {
                eprintln!("[message-delete] putting attachment files back failed: {re}");
            }
            return Err(io::Error::new(
                e.kind(),
                format!("{}: {e}", original.display()),
            ));
        }
        staged.moved.push((original, aside));
    }
    Ok(staged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(id: &str, role: &str, turn: i64) -> MessageUnitRow {
        MessageUnitRow {
            id: id.into(),
            role: role.into(),
            turn_index: turn,
            tool_calls: None,
            final_answer: None,
            created_via: None,
            supervisor: None,
        }
    }

    fn user(id: &str, turn: i64) -> MessageUnitRow {
        row(id, "user", turn)
    }

    /// A process step: a tool call, no answer.
    fn step(id: &str, turn: i64) -> MessageUnitRow {
        MessageUnitRow {
            tool_calls: Some(json!([{"toolName": "web_scan"}]).to_string()),
            ..row(id, "assistant", turn)
        }
    }

    /// An answer: `no_tool` and a body.
    fn answer(id: &str, turn: i64) -> MessageUnitRow {
        MessageUnitRow {
            tool_calls: Some(json!([{"toolName": "no_tool"}]).to_string()),
            final_answer: Some(format!("{id} body")),
            ..row(id, "assistant", turn)
        }
    }

    fn question(id: &str, turn: i64) -> MessageUnitRow {
        MessageUnitRow {
            tool_calls: Some(json!([{"toolName": "ask_user"}]).to_string()),
            ..row(id, "assistant", turn)
        }
    }

    fn greeting() -> MessageUnitRow {
        MessageUnitRow {
            final_answer: Some("hi".into()),
            created_via: Some("system".into()),
            supervisor: Some("galley-greeting".into()),
            ..row("g", "assistant", -1)
        }
    }

    fn report(id: &str, turn: i64) -> MessageUnitRow {
        MessageUnitRow {
            created_via: Some("system".into()),
            supervisor: Some("galley-report".into()),
            ..row(id, "user", turn)
        }
    }

    fn ids(unit: &MessageUnit) -> Vec<&str> {
        unit.ids.iter().map(String::as_str).collect()
    }

    #[test]
    fn your_message_is_its_row_alone() {
        let rows = vec![greeting(), user("u0", 0), answer("a0", 0), user("u1", 1)];
        let unit = message_unit(&rows, "u0").unwrap();
        assert_eq!(ids(&unit), ["u0"]);
        assert!(unit.reply_turns.is_empty());
    }

    #[test]
    fn the_greeting_is_its_row_alone() {
        let rows = vec![greeting(), step("s0", 0), answer("a0", 1)];
        assert_eq!(ids(&message_unit(&rows, "g").unwrap()), ["g"]);
    }

    #[test]
    fn a_reply_is_every_assistant_row_of_its_run() {
        let rows = vec![
            greeting(),
            user("u0", 0),
            step("s0", 0),
            step("s1", 1),
            answer("a2", 2),
            user("u3", 3),
            answer("a3", 3),
        ];
        for anchor in ["s0", "s1", "a2"] {
            let unit = message_unit(&rows, anchor).unwrap();
            assert_eq!(ids(&unit), ["s0", "s1", "a2"], "{anchor}");
            assert_eq!(unit.reply_turns, [0, 1, 2]);
        }
        assert_eq!(ids(&message_unit(&rows, "a3").unwrap()), ["a3"]);
    }

    #[test]
    fn a_reply_with_a_question_keeps_your_answer() {
        let rows = vec![
            user("u0", 0),
            step("s0", 0),
            question("q1", 1),
            user("ans", 2),
            step("s2", 2),
            answer("a3", 3),
        ];
        for anchor in ["q1", "a3"] {
            assert_eq!(
                ids(&message_unit(&rows, anchor).unwrap()),
                ["s0", "q1", "s2", "a3"]
            );
        }
        assert_eq!(ids(&message_unit(&rows, "ans").unwrap()), ["ans"]);
    }

    #[test]
    fn a_reports_reply_takes_its_report_row() {
        let rows = vec![
            user("u0", 0),
            answer("a0", 0),
            report("r1", 1),
            answer("a1", 1),
        ];
        let unit = message_unit(&rows, "a1").unwrap();
        assert_eq!(ids(&unit), ["r1", "a1"]);
        assert_eq!(unit.reply_turns, [1]);
        assert_eq!(message_unit(&rows, "r1"), Err(UnitRefusal::NotDrawn));
    }

    #[test]
    fn replies_left_side_by_side_stay_apart() {
        // Your message between them was deleted: each is still its own.
        let rows = vec![
            user("u0", 0),
            answer("a0", 0),
            step("s1", 1),
            answer("a2", 2),
        ];
        assert_eq!(ids(&message_unit(&rows, "a0").unwrap()), ["a0"]);
        assert_eq!(ids(&message_unit(&rows, "a2").unwrap()), ["s1", "a2"]);
        // A reply right after the greeting is not the greeting's.
        let rows = vec![greeting(), step("s0", 0), answer("a1", 1)];
        assert_eq!(ids(&message_unit(&rows, "s0").unwrap()), ["s0", "a1"]);
    }

    #[test]
    fn unknown_and_undrawn_rows_are_refused() {
        let rows = vec![user("u0", 0), row("n", "system", 1)];
        assert_eq!(message_unit(&rows, "x"), Err(UnitRefusal::NotFound));
        assert_eq!(message_unit(&rows, "n"), Err(UnitRefusal::NotDrawn));
    }

    #[test]
    fn tools_are_read_as_the_desktop_reads_them() {
        let mut blank = answer("a", 0);
        blank.final_answer = Some(" \u{FEFF}\n".into());
        assert!(!closes(&blank), "a blank answer closes nothing");
        let mut bare = answer("a", 0);
        bare.tool_calls = None;
        assert!(closes(&bare), "no tools is an answer");
        let mut broken = answer("a", 0);
        broken.tool_calls = Some("not json".into());
        assert!(closes(&broken), "malformed calls are no calls");
        let mut nameless = answer("a", 0);
        nameless.tool_calls = Some(json!([{}]).to_string());
        assert!(!closes(&nameless), "a call without a name is (unknown)");
        assert!(asks_user(&question("q", 0)));
    }
}
