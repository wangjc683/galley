//! What a new main chat segment carries over (ticket 11,
//! `.scratch/main-chat/issues/11-carry-last-turns-into-new-segment.md`,
//! main chat PRD ruling 50).
//!
//! A new segment ([`super::segment`]) gives the main chat's runner a
//! fresh context. Taken alone, that means a user who writes again after
//! the idle gap finds the assistant has forgotten the exchange still on
//! the screen. So the replay of a segment with a recorded boundary opens
//! with the last [`CARRY_TURNS`] complete turns before it, whichever
//! segment they are in, within [`CARRY_MAX_CHARS`]; the state block tells
//! the model they come from before the break and when the last was said
//! ([`super::segment::MainChatPromptState::carried`]).
//!
//! - **A turn** is one `turn_index`'s user message and its reply, read by
//!   the replay's own rules ([`super::rows_to_conversation_messages`]):
//!   `user` / `assistant` rows only, never the greeting (shown only). A
//!   turn counts only with both, so one whose reply never came is
//!   skipped, not carried as a dangling question.
//! - **The cap** counts the Unicode characters carried (each turn's user
//!   message plus its reply; images ride along uncounted). Over it, whole
//!   turns go, oldest first. When the latest turn alone is over it, its
//!   user message and its reply are each sure of half, and a side that
//!   needs less lends the rest to the other. A cut reply keeps its end,
//!   where the final answer is; a cut user message keeps its start and
//!   its end, since a long one is mostly a paste with the request at one
//!   end or the other (GA cuts old tool output the same way,
//!   `compress_history_tags` in `managed-ga/code/llmcore.py`).
//!   [`CUT_MARKER`] stands where text was cut.
//! - **Deterministic**: the window is a function of the persisted rows
//!   before the boundary and nothing else (no clock, no pref), so a
//!   runner restored after a Core restart is given the same opening, and
//!   the replay and the state block, both reading it through [`read`],
//!   agree on it.
//!
//! Main chat only: no other session has a boundary, and attach mode has
//! no main chat.

use super::replay::{merge_into, ConversationMessage, ReplayRow};
use crate::api::SessionId;
use crate::db::{PersistedMessageRow, SqliteGalley};
use crate::error::GalleyError;

/// How many complete turns before the boundary a new segment opens with.
pub const CARRY_TURNS: usize = 3;

/// Cap on what is carried, in Unicode characters. Set against 457 turns
/// of real desktop use (PRD ruling 50): a turn's user message plus its
/// reply has a median of 127 characters, p90 about 1,060, p95 about
/// 1,950, so three ordinary turns fit with room to spare and only a
/// rare long one is cut.
pub const CARRY_MAX_CHARS: usize = 6_000;

/// Stands where carried text was cut for length.
pub const CUT_MARKER: &str = "[… cut for length …]";

/// One turn carried into a new segment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CarriedTurn {
    pub turn_index: i64,
    /// The user message (with its images, as the replay sends them).
    pub user: ConversationMessage,
    pub reply: ConversationMessage,
    /// When the reply was written: its last row's `created_at`, as
    /// stored.
    pub said_at: String,
}

impl CarriedTurn {
    fn chars(&self) -> usize {
        self.user.content.chars().count() + self.reply.content.chars().count()
    }
}

/// The turns a new main chat segment opens with, oldest first; empty
/// when there is nothing to carry.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CarriedWindow {
    pub turns: Vec<CarriedTurn>,
}

impl CarriedWindow {
    /// The window carried from `rows`: rows of turns before the
    /// segment's start, in conversation order (`turn_index`, then
    /// `sequence`), as many as the read brought — the last
    /// [`CARRY_TURNS`] complete ones are taken, then held to the cap.
    pub fn from_rows(rows: impl IntoIterator<Item = ReplayRow>) -> Self {
        let mut drafts: Vec<Draft> = Vec::new();
        for row in rows {
            if !row.is_conversation() {
                continue;
            }
            if drafts.last().map(|draft| draft.turn_index) != Some(row.turn_index) {
                drafts.push(Draft {
                    turn_index: row.turn_index,
                    user: None,
                    reply: None,
                    said_at: String::new(),
                });
            }
            let draft = drafts.last_mut().expect("a draft for this turn");
            if row.role == "assistant" {
                draft.said_at = row.created_at.clone();
            }
            let message = row.into_message();
            let slot = if message.role == "user" {
                &mut draft.user
            } else {
                &mut draft.reply
            };
            match slot {
                Some(prev) => merge_into(prev, message),
                None => *slot = Some(message),
            }
        }
        let complete: Vec<CarriedTurn> = drafts.into_iter().filter_map(Draft::complete).collect();
        let mut turns = complete[complete.len().saturating_sub(CARRY_TURNS)..].to_vec();
        while turns.len() > 1
            && turns.iter().map(CarriedTurn::chars).sum::<usize>() > CARRY_MAX_CHARS
        {
            turns.remove(0);
        }
        // Still over the cap only when the latest is the one left.
        if let Some(latest) = turns.last_mut() {
            fit(latest);
        }
        Self { turns }
    }

    pub fn is_empty(&self) -> bool {
        self.turns.is_empty()
    }

    /// Characters carried, the quantity the cap holds.
    pub fn chars(&self) -> usize {
        self.turns.iter().map(CarriedTurn::chars).sum()
    }

    /// When the last carried turn was said (`created_at` as stored).
    pub fn last_said_at(&self) -> Option<&str> {
        self.turns.last().map(|turn| turn.said_at.as_str())
    }

    /// The window as history messages: user, reply, turn by turn.
    pub fn into_messages(self) -> Vec<ConversationMessage> {
        self.turns
            .into_iter()
            .flat_map(|turn| [turn.user, turn.reply])
            .collect()
    }
}

/// A turn being read: complete once it has both a user message and a
/// reply.
struct Draft {
    turn_index: i64,
    user: Option<ConversationMessage>,
    reply: Option<ConversationMessage>,
    said_at: String,
}

impl Draft {
    fn complete(self) -> Option<CarriedTurn> {
        Some(CarriedTurn {
            turn_index: self.turn_index,
            user: self.user?,
            reply: self.reply?,
            said_at: self.said_at,
        })
    }
}

/// Hold one turn to the cap (a turn within it is left as it is). Each
/// side is sure of half; a side that needs less lends the rest.
fn fit(turn: &mut CarriedTurn) {
    let user = turn.user.content.chars().count();
    let reply = turn.reply.content.chars().count();
    if user + reply <= CARRY_MAX_CHARS {
        return;
    }
    let half = CARRY_MAX_CHARS / 2;
    let user_room = user.min(CARRY_MAX_CHARS - reply.min(half));
    if user > user_room {
        turn.user.content = keep_ends(&turn.user.content, user_room);
    }
    let reply_room = CARRY_MAX_CHARS - turn.user.content.chars().count();
    if reply > reply_room {
        turn.reply.content = keep_end(&turn.reply.content, reply_room);
    }
}

/// `text` in `room` characters, marker included: its start and its end.
fn keep_ends(text: &str, room: usize) -> String {
    let keep = room.saturating_sub(CUT_MARKER.chars().count() + 4);
    let tail = keep / 2;
    let total = text.chars().count();
    format!(
        "{}\n\n{CUT_MARKER}\n\n{}",
        &text[..byte_at(text, keep - tail)],
        &text[byte_at(text, total - tail)..]
    )
}

/// `text` in `room` characters, marker included: its end.
fn keep_end(text: &str, room: usize) -> String {
    let keep = room.saturating_sub(CUT_MARKER.chars().count() + 2);
    let total = text.chars().count();
    format!("{CUT_MARKER}\n\n{}", &text[byte_at(text, total - keep)..])
}

/// Byte offset of character `n` of `text` (its length past the end).
fn byte_at(text: &str, n: usize) -> usize {
    text.char_indices().nth(n).map_or(text.len(), |(at, _)| at)
}

/// The main chat's segment from `segment_start` as its runner is given
/// it back: the window it opens with, and the segment's own rows. One
/// read, from the oldest turn the window can take
/// ([`SqliteGalley::main_chat_carry_from`]) on, split at the start. The
/// replay and the state block both come through here.
pub(super) async fn read(
    galley: &SqliteGalley,
    session_id: &SessionId,
    segment_start: i64,
) -> Result<(CarriedWindow, Vec<PersistedMessageRow>), GalleyError> {
    let from = galley
        .main_chat_carry_from(session_id, segment_start, CARRY_TURNS as i64)
        .await?
        .unwrap_or(segment_start);
    let mut rows = galley.persisted_message_rows_from(session_id, from).await?;
    // Replies name their subtasks instead of carrying the instructions,
    // in the carried turns as in the segment (ticket 06a).
    crate::subtask::mark_replay_rows(galley, session_id, &mut rows).await?;
    // Rows come in turn order: the ones before the start come first.
    let segment = rows.split_off(rows.partition_point(|row| row.turn_index < segment_start));
    let window = CarriedWindow::from_rows(rows.into_iter().map(ReplayRow::from));
    Ok((window, segment))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_runner::ReplayAttachment;

    fn row(turn_index: i64, role: &str, content: &str) -> ReplayRow {
        ReplayRow {
            role: role.into(),
            turn_index,
            content: content.into(),
            attachments: vec![],
            shown_only: false,
            created_at: format!("2026-10-13T0{}:00:00Z", turn_index.rem_euclid(10)),
        }
    }

    /// One complete turn: `u{i}` and `r{i}`.
    fn exchange(i: i64) -> Vec<ReplayRow> {
        vec![
            row(i, "user", &format!("u{i}")),
            row(i, "assistant", &format!("r{i}")),
        ]
    }

    fn sized(i: i64, user: usize, reply: usize) -> Vec<ReplayRow> {
        vec![
            row(i, "user", &"问".repeat(user)),
            row(i, "assistant", &"答".repeat(reply)),
        ]
    }

    fn indexes(window: &CarriedWindow) -> Vec<i64> {
        window.turns.iter().map(|turn| turn.turn_index).collect()
    }

    #[test]
    fn the_last_three_complete_turns_are_carried() {
        let rows: Vec<ReplayRow> = (0..5).flat_map(exchange).collect();
        let window = CarriedWindow::from_rows(rows);
        assert_eq!(indexes(&window), vec![2, 3, 4]);
        let messages = window.clone().into_messages();
        let text: Vec<(&str, &str)> = messages
            .iter()
            .map(|m| (m.role.as_str(), m.content.as_str()))
            .collect();
        assert_eq!(
            text,
            vec![
                ("user", "u2"),
                ("assistant", "r2"),
                ("user", "u3"),
                ("assistant", "r3"),
                ("user", "u4"),
                ("assistant", "r4"),
            ]
        );
        assert_eq!(window.last_said_at(), Some("2026-10-13T04:00:00Z"));
    }

    #[test]
    fn greetings_unanswered_messages_and_other_rows_are_not_turns() {
        let mut greeting = row(-1, "assistant", "你好。");
        greeting.shown_only = true;
        let mut rows = vec![greeting];
        rows.extend(exchange(0));
        rows.extend(exchange(1));
        // Turn 2 never got its reply; turn 3 is a Galley note alone.
        rows.push(row(2, "user", "还在吗"));
        rows.push(row(3, "galley", "note"));
        rows.extend(exchange(4));
        rows.push(row(5, "user", "最后一句没人回"));
        let window = CarriedWindow::from_rows(rows);
        // Short of three after the skips, the window reaches further back.
        assert_eq!(indexes(&window), vec![0, 1, 4]);
        assert!(window
            .into_messages()
            .iter()
            .all(|m| m.content != "你好。" && m.content != "还在吗" && m.content != "note"));
        assert!(CarriedWindow::from_rows(vec![row(0, "user", "只有问")]).is_empty());
    }

    #[test]
    fn a_turn_reads_like_the_replay_reads_it() {
        let mut user = row(7, "user", "看图");
        user.attachments = vec![
            ReplayAttachment {
                kind: "image".into(),
                path: "/a.png".into(),
            },
            ReplayAttachment {
                kind: "file".into(),
                path: "/b.pdf".into(),
            },
        ];
        let mut late = row(7, "assistant", "第二步");
        late.created_at = "2026-10-13T09:41:30Z".into();
        let window = CarriedWindow::from_rows(vec![user, row(7, "assistant", "第一步"), late]);
        let turn = &window.turns[0];
        assert_eq!(turn.user.images, Some(vec!["/a.png".to_string()]));
        assert_eq!(turn.reply.content, "第一步\n\n第二步");
        assert_eq!(turn.said_at, "2026-10-13T09:41:30Z");
    }

    #[test]
    fn over_the_cap_whole_turns_go_oldest_first() {
        // 2,500 characters each: three are over the cap, two are not.
        let rows: Vec<ReplayRow> = (0..3).flat_map(|i| sized(i, 500, 2_000)).collect();
        let window = CarriedWindow::from_rows(rows);
        assert_eq!(indexes(&window), vec![1, 2]);
        assert_eq!(window.chars(), 5_000);
        // A newer turn too big to sit beside an older one goes alone,
        // uncut while it fits.
        let mut rows = sized(0, 10, 10);
        rows.extend(sized(1, 100, 5_900));
        let window = CarriedWindow::from_rows(rows);
        assert_eq!(indexes(&window), vec![1]);
        assert_eq!(window.chars(), 6_000);
        assert!(!window.turns[0].reply.content.contains(CUT_MARKER));
    }

    #[test]
    fn the_latest_turn_alone_over_the_cap_keeps_the_question_and_the_reply_end() {
        let mut rows = sized(0, 50, 50);
        rows.push(row(1, "user", "总结一下"));
        let reply = format!("开头{}结论：可以。", "长".repeat(9_000));
        rows.push(row(1, "assistant", &reply));
        let window = CarriedWindow::from_rows(rows);
        assert_eq!(indexes(&window), vec![1]);
        let turn = &window.turns[0];
        assert_eq!(turn.user.content, "总结一下");
        assert!(turn
            .reply
            .content
            .starts_with(&format!("{CUT_MARKER}\n\n长")));
        assert!(turn.reply.content.ends_with("结论：可以。"));
        assert!(!turn.reply.content.contains("开头"));
        assert_eq!(window.chars(), CARRY_MAX_CHARS);
    }

    #[test]
    fn a_user_message_over_half_the_cap_keeps_its_start_and_end() {
        let user = format!("帮我看看这段：{}这段什么意思？", "贴".repeat(8_000));
        // A long reply: each side gets half.
        let window = CarriedWindow::from_rows(vec![
            row(0, "user", &user),
            row(0, "assistant", &format!("{}答完", "答".repeat(7_000))),
        ]);
        let turn = &window.turns[0];
        assert_eq!(turn.user.content.chars().count(), CARRY_MAX_CHARS / 2);
        assert!(turn.user.content.starts_with("帮我看看这段："));
        assert!(turn.user.content.ends_with("这段什么意思？"));
        assert!(turn.user.content.contains(&format!("\n\n{CUT_MARKER}\n\n")));
        assert_eq!(turn.reply.content.chars().count(), CARRY_MAX_CHARS / 2);
        assert!(turn.reply.content.ends_with("答完"));
        assert_eq!(window.chars(), CARRY_MAX_CHARS);

        // A short reply lends the user message what it does not need.
        let window = CarriedWindow::from_rows(vec![
            row(0, "user", &user),
            row(0, "assistant", "这是一段合同条款。"),
        ]);
        let turn = &window.turns[0];
        assert_eq!(turn.reply.content, "这是一段合同条款。");
        assert_eq!(
            turn.user.content.chars().count(),
            CARRY_MAX_CHARS - "这是一段合同条款。".chars().count()
        );
        assert!(turn.user.content.ends_with("这段什么意思？"));

        // Long but within the cap together: nothing is cut.
        let window = CarriedWindow::from_rows(sized(0, 4_000, 1_500));
        assert_eq!(window.chars(), 5_500);
        assert!(!window.turns[0].user.content.contains(CUT_MARKER));
    }

    #[test]
    fn the_same_rows_carry_the_same_window() {
        let rows = || -> Vec<ReplayRow> {
            let mut rows: Vec<ReplayRow> = (0..4).flat_map(|i| sized(i, 300, 2_200)).collect();
            rows.extend(sized(4, 7_000, 9_000));
            rows
        };
        assert_eq!(
            CarriedWindow::from_rows(rows()),
            CarriedWindow::from_rows(rows())
        );
        assert!(CarriedWindow::from_rows(rows()).chars() <= CARRY_MAX_CHARS);
    }
}
