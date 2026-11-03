//! What a subtask is told of the main chat (main chat ticket 138,
//! `.scratch/main-chat/issues/138-subtask-carries-the-chat.md`; PRD
//! ruling 186).
//!
//! A subtask ([`crate::subtask`]) is an ordinary managed session whose
//! first message is the instructions; until ticket 138 it saw nothing
//! else, so the main chat had to copy into them everything the
//! conversation had settled, and a sentence left out sent the subtask the
//! wrong way. Now the main chat's last turns go with it, as read-only
//! background.
//!
//! - **What**: taken once per reply, before any of its tags starts
//!   ([`snapshot`]), and shared by every subtask the reply starts. The
//!   window is a new segment's opening ([`crate::session_runner::carry`])
//!   read up to the dispatching reply instead of up to a boundary: the
//!   last [`CARRY_TURNS`] turns, at most `CARRY_MAX_CHARS` characters, cut
//!   the carry's way. Only the reply's own segment (from the latest
//!   boundary not after it), and nothing after the reply. Rows read as
//!   the main chat's replay reads them ([`crate::subtask::mark_rows`]):
//!   replies without their instructions, a report as its lines. The
//!   dispatching reply keeps what it said before its tags and loses the
//!   tags, with no marker line: the instructions are the subtask's first
//!   message, and its id does not exist yet.
//! - **Kept**: as JSON with each record that made a session
//!   (`subtask_dispatches.background`, migration 056), written with the
//!   record, before the subtask's runner starts. A runner started later —
//!   a cold start after a restart, an eviction, a send-back, the user
//!   opening it on the desktop — is told the same turns, not the main
//!   chat as it has moved on since. A main chat reset deletes the records
//!   (CASCADE), and the copy of the conversation with them.
//! - **Where the model reads it**: a section of the subtask's runtime
//!   prompt after its state block ([`prompt_section`], composed by
//!   `managed_prompt::compose_subtask_runtime_prompt` in
//!   `runner_commands::prepare_managed_spawn_args`), not its
//!   conversation: the desktop's first user message is still the
//!   instructions, the replay is untouched, and the model reads it as
//!   background rather than as something it said. A first message would
//!   not do: GA moves a user message over 2,000 characters into a file
//!   (`agentmain.py`'s task loop), the instructions with it. A user
//!   message's images are named by count only.
//! - **Not in the Agent API**: `SubtaskDispatch` and the CLI's JSON leave
//!   it out.
//!
//! Main chat subtasks only: a workbench session, a session the user
//! opened, an IM channel has no dispatch record; attach mode has no main
//! chat.

use crate::api::SessionId;
use crate::db::SqliteGalley;
use crate::error::GalleyError;
use crate::session_runner::carry::{CarriedWindow, CARRY_TURNS};
use crate::session_runner::ReplayRow;
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::fmt::Write;

/// The main chat's last turns as one subtask is told of them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubtaskBackground {
    pub turns: Vec<BackgroundTurn>,
}

/// One turn of [`SubtaskBackground`]: a [`crate::session_runner::carry::CarriedTurn`]
/// as stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTurn {
    /// The user message's `turn_index`.
    pub turn_index: i64,
    /// When the reply was written: its last row's `created_at`, as stored.
    pub said_at: String,
    /// The user message, cut for length as the carry cuts it.
    pub user: String,
    /// The paths of its images. The section names only how many: it
    /// carries no image, and a local path is not sent to the provider
    /// (the state block's admission rule 4).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
    /// Every reply up to the next user message, as one.
    pub reply: String,
}

impl From<CarriedWindow> for SubtaskBackground {
    fn from(window: CarriedWindow) -> Self {
        Self {
            turns: window
                .turns
                .into_iter()
                .map(|turn| BackgroundTurn {
                    turn_index: turn.turn_index,
                    said_at: turn.said_at,
                    user: turn.user.content,
                    images: turn.user.images.unwrap_or_default(),
                    reply: turn.reply.content,
                })
                .collect(),
        }
    }
}

impl SubtaskBackground {
    pub fn is_empty(&self) -> bool {
        self.turns.is_empty()
    }

    /// Characters carried, the quantity `CARRY_MAX_CHARS` holds.
    pub fn chars(&self) -> usize {
        self.turns
            .iter()
            .map(|turn| turn.user.chars().count() + turn.reply.chars().count())
            .sum()
    }
}

/// The background for the subtasks of the main chat reply on
/// `reply_turn`: the turns of its segment up to and including it (see
/// the module docs).
pub async fn take(
    galley: &SqliteGalley,
    main_chat: &SessionId,
    reply_turn: i64,
) -> Result<SubtaskBackground, GalleyError> {
    let segment_start = galley
        .main_chat_segment_starts(main_chat)
        .await?
        .into_iter()
        .filter(|start| *start <= reply_turn)
        .max()
        .unwrap_or(0);
    // Read from the oldest turn the window can take, as the carry does;
    // a turn counts when its reply comes before the bound, and the
    // dispatching reply sits on `reply_turn`.
    let from = galley
        .main_chat_carry_from(main_chat, reply_turn + 1, CARRY_TURNS as i64)
        .await?
        .unwrap_or(segment_start)
        .max(segment_start);
    let mut rows = galley.persisted_message_rows_from(main_chat, from).await?;
    rows.retain(|row| row.turn_index <= reply_turn);
    let mut dispatches = crate::subtask::named_dispatches(galley, main_chat).await?;
    // The dispatching reply loses its tags with no marker in their place
    // (none is recorded yet when the reply dispatches).
    dispatches.retain(|dispatch| dispatch.turn_index != reply_turn);
    crate::subtask::mark_rows(&mut rows, &dispatches);
    Ok(CarriedWindow::from_rows(rows.into_iter().map(ReplayRow::from)).into())
}

/// [`take`] as the record stores it: JSON, or `None` when there is
/// nothing to carry. A failed read is logged and the subtasks start
/// without one, as before ticket 138.
pub async fn snapshot(
    galley: &SqliteGalley,
    main_chat: &SessionId,
    reply_turn: i64,
) -> Option<String> {
    let background = match take(galley, main_chat, reply_turn).await {
        Ok(background) => background,
        Err(e) => {
            eprintln!(
                "[subtask {}] reading the main chat for turn {reply_turn}'s subtasks failed: {e}",
                main_chat.as_str()
            );
            return None;
        }
    };
    if background.is_empty() {
        return None;
    }
    match serde_json::to_string(&background) {
        Ok(json) => Some(json),
        Err(e) => {
            eprintln!(
                "[subtask {}] writing turn {reply_turn}'s background failed: {e}",
                main_chat.as_str()
            );
            None
        }
    }
}

/// The section's heading.
pub const SECTION_HEADING: &str = "## Main Chat Background";

/// What the section says the turns are, before them.
const SECTION_INTRO: &str = "This conversation is a subtask that the user's main chat handed \
you; below are the main chat's last turns with the user, as they stood at that moment. Read \
them as background, not as a conversation to continue: your first message, the instructions, \
is what to do and wins where they differ, and what you hand back goes to the main chat, as it \
says.";

/// The "Main Chat Background" section for `background`, its times in
/// `tz` to the minute; `None` when it is empty.
pub fn section_in<Tz: chrono::TimeZone>(background: &SubtaskBackground, tz: &Tz) -> Option<String>
where
    Tz::Offset: std::fmt::Display,
{
    if background.is_empty() {
        return None;
    }
    let mut section = format!("{SECTION_HEADING}\n\n{SECTION_INTRO}");
    for turn in &background.turns {
        let mut user = turn.user.trim().to_string();
        match turn.images.len() {
            0 => {}
            1 => user.push_str("\n[1 image attached]"),
            n => {
                let _ = write!(user, "\n[{n} images attached]");
            }
        }
        let _ = write!(
            section,
            "\n\n<turn at=\"{at}\">\n<user>\n{user}\n</user>\n<main-chat>\n{reply}\n</main-chat>\n</turn>",
            at = local_minute(&turn.said_at, tz),
            reply = turn.reply.trim(),
        );
    }
    Some(section)
}

/// `said_at` in `tz` to the minute (`YYYY-MM-DD HH:MM`), as the main
/// chat's state block writes the turns a segment carries; an unreadable
/// time is kept as written.
fn local_minute<Tz: chrono::TimeZone>(said_at: &str, tz: &Tz) -> String
where
    Tz::Offset: std::fmt::Display,
{
    DateTime::parse_from_rfc3339(said_at)
        .map(|at| {
            at.with_timezone(tz)
                .naive_local()
                .format("%Y-%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_else(|_| {
            said_at
                .chars()
                .take(16)
                .collect::<String>()
                .replace('T', " ")
        })
}

/// The section a runner of `session_id` is given (this machine's time
/// zone): the background stored with the dispatch that created it, or
/// `None` for any session without one. A failed read is logged and the
/// runner starts with the ordinary prompt.
pub async fn prompt_section(galley: &SqliteGalley, session_id: &str) -> Option<String> {
    prompt_section_in(galley, session_id, &chrono::Local).await
}

/// [`prompt_section`] with an explicit time zone (tests).
pub async fn prompt_section_in<Tz: chrono::TimeZone>(
    galley: &SqliteGalley,
    session_id: &str,
    tz: &Tz,
) -> Option<String>
where
    Tz::Offset: std::fmt::Display,
{
    let stored = match galley
        .subtask_background(&SessionId(session_id.to_string()))
        .await
    {
        Ok(stored) => stored?,
        Err(e) => {
            eprintln!("[subtask {session_id}] reading its background failed: {e}");
            return None;
        }
    };
    match serde_json::from_str::<SubtaskBackground>(&stored) {
        Ok(background) => section_in(&background, tz),
        Err(e) => {
            eprintln!("[subtask {session_id}] its background does not parse: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(turn_index: i64, said_at: &str, user: &str, reply: &str) -> BackgroundTurn {
        BackgroundTurn {
            turn_index,
            said_at: said_at.into(),
            user: user.into(),
            images: vec![],
            reply: reply.into(),
        }
    }

    #[test]
    fn nothing_to_carry_is_no_section() {
        assert_eq!(
            section_in(&SubtaskBackground::default(), &chrono::Utc),
            None
        );
    }

    #[test]
    fn the_section_names_each_turn_in_local_time() {
        let mut first = turn(3, "2026-11-03T01:58:00Z", "  周五去上海  ", "好。\n");
        first.images = vec!["/a.png".into(), "/b.png".into()];
        let background = SubtaskBackground {
            turns: vec![
                first,
                turn(
                    5,
                    "2026-11-03T02:05:30Z",
                    "帮我订周五的高铁",
                    "好，去订了。",
                ),
            ],
        };
        let tz = chrono::FixedOffset::east_opt(8 * 3600).expect("UTC+8");
        let section = section_in(&background, &tz).expect("a section");
        assert!(section.starts_with(&format!("{SECTION_HEADING}\n\n{SECTION_INTRO}\n\n")));
        assert!(section.contains(
            "<turn at=\"2026-11-03 09:58\">\n<user>\n周五去上海\n[2 images attached]\n</user>\n\
             <main-chat>\n好。\n</main-chat>\n</turn>"
        ));
        assert!(!section.contains("/a.png"));
        assert!(section.ends_with(
            "<turn at=\"2026-11-03 10:05\">\n<user>\n帮我订周五的高铁\n</user>\n\
             <main-chat>\n好，去订了。\n</main-chat>\n</turn>"
        ));
        // An unreadable time is kept as written.
        let odd = SubtaskBackground {
            turns: vec![turn(1, "2026-11-03T02:05:30", "u", "r")],
        };
        assert!(section_in(&odd, &tz)
            .expect("a section")
            .contains("<turn at=\"2026-11-03 02:05\">"));
    }

    /// The intro is the ticket's two sentences: it is the main chat's,
    /// read-only, and the instructions win.
    #[test]
    fn the_intro_says_read_only_and_the_instructions_win() {
        assert_eq!(SECTION_INTRO.matches(". ").count() + 1, 2);
        for words in [
            "main chat",
            "background",
            "not as a conversation to continue",
            "wins where they differ",
            "goes to the main chat",
        ] {
            assert!(SECTION_INTRO.contains(words), "{words}");
        }
    }

    /// The subtask's prompt is the workbench's, byte for byte, then the
    /// section after its state block.
    #[test]
    fn the_subtask_prompt_is_the_workbench_prompt_then_the_section() {
        let background = SubtaskBackground {
            turns: vec![turn(2, "2026-11-03T01:00:00Z", "周五去上海", "好。")],
        };
        let section = section_in(&background, &chrono::Utc).expect("a section");
        let workbench = crate::managed_prompt::compose_runtime_prompt("1.2.3");
        let prompt = crate::managed_prompt::compose_subtask_runtime_prompt("1.2.3", &section);
        assert_eq!(prompt, format!("{workbench}\n\n{section}"));
        assert!(workbench.contains("## Galley State"));
        assert!(!workbench.contains(SECTION_HEADING));
    }

    #[test]
    fn the_stored_form_round_trips_and_leaves_no_images_out() {
        let background = SubtaskBackground {
            turns: vec![turn(2, "2026-11-03T01:00:00Z", "问", "答")],
        };
        let json = serde_json::to_string(&background).expect("json");
        assert_eq!(
            json,
            r#"{"turns":[{"turnIndex":2,"saidAt":"2026-11-03T01:00:00Z","user":"问","reply":"答"}]}"#
        );
        assert_eq!(
            serde_json::from_str::<SubtaskBackground>(&json).expect("parse"),
            background
        );
        assert_eq!(background.chars(), 2);
    }
}
