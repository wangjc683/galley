//! What a new main chat segment carries over (ticket 11,
//! `.scratch/main-chat/issues/11-carry-last-turns-into-new-segment.md`,
//! main chat PRD rulings 50 and 127).
//!
//! A new segment ([`super::segment`]) gives the main chat's runner a
//! fresh context. Taken alone, that means a user who writes again after
//! the idle gap finds the assistant has forgotten the exchange still on
//! the screen. So the replay of a segment with a recorded boundary opens
//! with the last [`CARRY_TURNS`] complete turns before it, whichever
//! segment they are in, within [`CARRY_MAX_CHARS`]; the state block tells
//! the model they come from before the break and when they were said
//! ([`super::segment::MainChatPromptState::carried`]).
//!
//! - **A turn** is one user message and every reply after it up to the
//!   next user message (ticket 77,
//!   `.scratch/main-chat/issues/77-carry-a-turn-by-the-users-message.md`,
//!   PRD ruling 125). Not one `turn_index`: a run takes an index per
//!   step and only its first step shares the user message's, so a
//!   multi-step run's final answer sits on an index of its own. Rows
//!   are read by the replay's own rules
//!   ([`super::rows_to_conversation_messages`]): `user` / `assistant`
//!   rows only, never the greeting (shown only), and a turn's replies
//!   merge as the replay merges them. Every user row is a user message:
//!   a wake (a subtask report, the daily review) opens a turn, and the
//!   answer to an `ask_user` does too, so it splits its run in two. A
//!   turn counts only with a reply, so a message whose reply never came
//!   is skipped, not carried as a dangling question; a reply read before
//!   the first user message (its own was deleted, ticket 32) is no turn
//!   either. [`SqliteGalley::main_chat_carry_from`] bounds the read by
//!   the same definition.
//! - **A wake answered in silence is no turn** (ticket 79,
//!   `.scratch/main-chat/issues/79-carry-ten-turns-skip-silent-wakes.md`,
//!   PRD ruling 127): a turn a wake opens whose last reply is said in
//!   silence (no answer left, the `<no-reply/>` tag in the raw text: the
//!   desktop search's criterion, [`crate::db::is_main_chat_silent_reply`])
//!   is not carried and takes no place. The user never saw it: since
//!   ticket 76 the desktop draws nothing for such a turn. A wake whose
//!   turn asked the user (the answer is the next user message) or said
//!   something is a turn like any.
//! - **The cap** counts the Unicode characters carried (each turn's user
//!   message plus its replies; images ride along uncounted). Over it,
//!   whole turns go, oldest first. When the latest turn alone is over
//!   it, its user message and its replies are each sure of half, and a
//!   side that needs less lends the rest to the other. A cut reply keeps
//!   its end, where the final answer is; a cut user message keeps its
//!   start and its end, since a long one is mostly a paste with the
//!   request at one end or the other (GA cuts old tool output the same
//!   way, `compress_history_tags` in `managed-ga/code/llmcore.py`).
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

/// How many turns before the boundary a new segment opens with (PRD
/// ruling 127, ticket 79): a user says a few things a day in the main
/// chat, so three (ruling 50) reached back half a day and ten reach
/// back over the week. A wake answered in silence takes no place.
pub const CARRY_TURNS: usize = 10;

/// Cap on what is carried, in Unicode characters (PRD ruling 127,
/// ticket 79). Measured over windows of ten consecutive turns of real
/// desktop use, every session, wakes answered in silence left out (44
/// windows; a turn is a user message and every reply up to the next,
/// ticket 77): a median of 10,808 characters, p90 13,796, p95 14,188.
/// 15,000 holds 98% of them, 12,000 only 64%. It was 8,000 for three
/// turns (ticket 77, ruling 125) and 6,000 when a turn was one
/// `turn_index` (ruling 50).
pub const CARRY_MAX_CHARS: usize = 15_000;

/// Stands where carried text was cut for length.
pub const CUT_MARKER: &str = "[… cut for length …]";

/// One turn carried into a new segment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CarriedTurn {
    /// The user message's `turn_index`.
    pub turn_index: i64,
    /// The user message (with its images, as the replay sends them).
    pub user: ConversationMessage,
    /// Every reply up to the next user message, as one message.
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
    /// The window carried from `rows`: rows before the segment's start,
    /// in conversation order (`turn_index`, then `sequence`), as many as
    /// the read brought. Each user row opens a turn that takes every
    /// reply up to the next user row, whatever their `turn_index`
    /// (ticket 77; the module docs have the whole definition, and
    /// [`SqliteGalley::main_chat_carry_from`] reads from the oldest turn
    /// it can take by the same one). A turn without a reply is none, and
    /// neither is a wake's whose last reply is said in silence (ticket
    /// 79). The last [`CARRY_TURNS`] turns are taken, then held to the
    /// cap.
    pub fn from_rows(rows: impl IntoIterator<Item = ReplayRow>) -> Self {
        let mut drafts: Vec<Draft> = Vec::new();
        for row in rows {
            if !row.is_conversation() {
                continue;
            }
            if row.role == "user" {
                drafts.push(Draft {
                    turn_index: row.turn_index,
                    wake: row.is_wake(),
                    user: row.into_message(),
                    reply: None,
                    said_at: String::new(),
                    silent: false,
                });
                continue;
            }
            // A reply before the first user message read opens nothing.
            let Some(draft) = drafts.last_mut() else {
                continue;
            };
            draft.said_at = row.created_at.clone();
            draft.silent = row.is_silent_reply();
            let message = row.into_message();
            match &mut draft.reply {
                Some(prev) => merge_into(prev, message),
                None => draft.reply = Some(message),
            }
        }
        let counted: Vec<CarriedTurn> = drafts.into_iter().filter_map(Draft::into_turn).collect();
        let mut turns = counted[counted.len().saturating_sub(CARRY_TURNS)..].to_vec();
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

    /// When the first carried turn was said (`created_at` as stored):
    /// with [`Self::last_said_at`], the span the state block names when
    /// more than one is carried (ticket 79).
    pub fn first_said_at(&self) -> Option<&str> {
        self.turns.first().map(|turn| turn.said_at.as_str())
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

/// A turn being read, opened by its user message: complete once a reply
/// follows.
struct Draft {
    turn_index: i64,
    /// Opened by a wake ([`ReplayRow::is_wake`]).
    wake: bool,
    user: ConversationMessage,
    reply: Option<ConversationMessage>,
    said_at: String,
    /// Its last reply so far was said in silence
    /// ([`ReplayRow::is_silent_reply`]).
    silent: bool,
}

impl Draft {
    /// The turn, when it is one: it has a reply, and it is not a wake
    /// answered in silence.
    fn into_turn(self) -> Option<CarriedTurn> {
        if self.wake && self.silent {
            return None;
        }
        Some(CarriedTurn {
            turn_index: self.turn_index,
            user: self.user,
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

    /// A row written at minute `turn_index` of 09:00, so a later step is
    /// said later. A reply's answer is its text, as the turn derivation
    /// leaves plain text.
    fn row(turn_index: i64, role: &str, content: &str) -> ReplayRow {
        ReplayRow {
            role: role.into(),
            turn_index,
            content: content.into(),
            attachments: vec![],
            shown_only: false,
            created_at: format!("2026-10-13T09:{:02}:00Z", turn_index.rem_euclid(60)),
            created_via: (role == "user").then(|| "gui".into()),
            supervisor: None,
            final_answer: (role == "assistant").then(|| content.to_string()),
        }
    }

    /// A wake (a subtask report or the daily review): the user row
    /// Galley writes, with its origin.
    fn wake(turn_index: i64, content: &str) -> ReplayRow {
        let mut wake = row(turn_index, "user", content);
        wake.created_via = Some("system".into());
        wake.supervisor = Some(crate::api::SUBTASK_REPORT_SUPERVISOR.into());
        wake
    }

    /// A reply said in silence, as stored: the raw text keeps the tag,
    /// the answer is gone.
    fn silent(turn_index: i64, content: &str) -> ReplayRow {
        let mut reply = row(turn_index, "assistant", content);
        reply.final_answer = None;
        reply
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

    fn greeting(turn_index: i64) -> ReplayRow {
        let mut greeting = row(turn_index, "assistant", "你好。");
        greeting.shown_only = true;
        greeting
    }

    fn indexes(window: &CarriedWindow) -> Vec<i64> {
        window.turns.iter().map(|turn| turn.turn_index).collect()
    }

    fn replies(window: &CarriedWindow) -> Vec<&str> {
        window
            .turns
            .iter()
            .map(|turn| turn.reply.content.as_str())
            .collect()
    }

    #[test]
    fn the_last_turns_up_to_the_count_are_carried() {
        let n = CARRY_TURNS as i64;
        let rows: Vec<ReplayRow> = (0..n + 2).flat_map(exchange).collect();
        let window = CarriedWindow::from_rows(rows);
        assert_eq!(indexes(&window), (2..n + 2).collect::<Vec<_>>());
        let text: Vec<(String, String)> = window
            .clone()
            .into_messages()
            .into_iter()
            .map(|m| (m.role, m.content))
            .collect();
        let expected: Vec<(String, String)> = (2..n + 2)
            .flat_map(|i| {
                [
                    ("user".to_string(), format!("u{i}")),
                    ("assistant".to_string(), format!("r{i}")),
                ]
            })
            .collect();
        assert_eq!(text, expected);
        assert_eq!(window.first_said_at(), Some("2026-10-13T09:02:00Z"));
        assert_eq!(
            window.last_said_at(),
            Some(format!("2026-10-13T09:{:02}:00Z", n + 1).as_str())
        );
    }

    /// The main chat behind ticket 77, in shape: the first question is
    /// answered in one step; the next two each take a run, and only a
    /// run's first step shares its user message's `turn_index`, so the
    /// answers (20, 26) sit on indexes no user message has.
    #[test]
    fn a_multi_step_run_is_carried_whole_up_to_its_answer() {
        let mut rows = vec![
            row(12, "user", "聊聊哲学"),
            row(12, "assistant", "好，从哪说起？"),
            row(13, "user", "西部怎么预测"),
            row(13, "assistant", "我先查一下"),
        ];
        rows.extend((14..20).map(|i| row(i, "assistant", &format!("步骤{i}"))));
        rows.push(row(20, "assistant", "西部的答案"));
        rows.push(row(21, "user", "东部呢？"));
        rows.push(row(21, "assistant", "东部我先核对"));
        rows.extend((22..26).map(|i| row(i, "assistant", &format!("步骤{i}"))));
        rows.push(row(26, "assistant", "东部的答案"));
        let window = CarriedWindow::from_rows(rows);

        // Three turns, numbered by their user messages.
        assert_eq!(indexes(&window), vec![12, 13, 21]);
        let run = |first: &str, steps: std::ops::Range<i64>, answer: &str| {
            std::iter::once(first.to_string())
                .chain(steps.map(|i| format!("步骤{i}")))
                .chain(std::iter::once(answer.to_string()))
                .collect::<Vec<_>>()
                .join("\n\n")
        };
        let west = run("我先查一下", 14..20, "西部的答案");
        let east = run("东部我先核对", 22..26, "东部的答案");
        assert_eq!(
            replies(&window),
            vec!["好，从哪说起？", west.as_str(), east.as_str()]
        );
        // Said when the answer was: the run's last step.
        assert_eq!(window.turns[1].said_at, "2026-10-13T09:20:00Z");
        assert_eq!(window.last_said_at(), Some("2026-10-13T09:26:00Z"));
        // As history: user, reply, turn by turn.
        let roles: Vec<String> = window.into_messages().into_iter().map(|m| m.role).collect();
        assert_eq!(
            roles,
            [
                "user",
                "assistant",
                "user",
                "assistant",
                "user",
                "assistant"
            ]
        );
    }

    #[test]
    fn greetings_unanswered_messages_and_other_rows_are_not_turns() {
        let n = CARRY_TURNS as i64;
        let mut rows = vec![greeting(-1)];
        rows.extend((0..n - 1).flat_map(exchange));
        // Turn n - 1 never got its reply — the greeting is shown only,
        // not one; turn n is a Galley note alone.
        rows.push(row(n - 1, "user", "还在吗"));
        rows.push(greeting(n - 1));
        rows.push(row(n, "galley", "note"));
        rows.extend(exchange(n + 1));
        rows.push(row(n + 2, "user", "最后一句没人回"));
        let window = CarriedWindow::from_rows(rows);
        // The skips take no place: the window reaches back to turn 0.
        let mut expected: Vec<i64> = (0..n - 1).collect();
        expected.push(n + 1);
        assert_eq!(indexes(&window), expected);
        assert_eq!(replies(&window)[0], "r0");
        assert_eq!(
            replies(&window).last(),
            Some(&format!("r{}", n + 1).as_str())
        );
        assert!(window
            .into_messages()
            .iter()
            .all(|m| m.content != "你好。" && m.content != "还在吗" && m.content != "note"));
        assert!(CarriedWindow::from_rows(vec![row(0, "user", "只有问")]).is_empty());
        assert!(CarriedWindow::from_rows(vec![row(0, "user", "只有问"), greeting(0)]).is_empty());
    }

    #[test]
    fn a_reply_before_the_first_user_message_read_is_not_carried() {
        // Its user message was deleted (ticket 32): the replies have none.
        let mut rows = vec![
            row(3, "assistant", "没有问题的回复"),
            row(4, "assistant", "它的下一步"),
        ];
        rows.extend(exchange(5));
        let window = CarriedWindow::from_rows(rows);
        assert_eq!(indexes(&window), vec![5]);
        assert_eq!(replies(&window), vec!["r5"]);
        assert!(CarriedWindow::from_rows(vec![row(3, "assistant", "只有答")]).is_empty());
    }

    /// The user's answer to an `ask_user` is a user message like any
    /// other: it splits the run it answers into two turns, with no rule
    /// of its own.
    #[test]
    fn an_answer_to_ask_user_splits_its_run_in_two_turns() {
        let rows = vec![
            row(10, "user", "帮我订周五的会议室"),
            row(10, "assistant", "我先看看空档"),
            row(11, "assistant", "上午还是下午？"),
            row(12, "user", "下午"),
            row(12, "assistant", "正在预订"),
            row(13, "assistant", "订好了：周五下午三点。"),
        ];
        let window = CarriedWindow::from_rows(rows);
        assert_eq!(indexes(&window), vec![10, 12]);
        assert_eq!(window.turns[1].user.content, "下午");
        assert_eq!(
            replies(&window),
            vec![
                "我先看看空档\n\n上午还是下午？",
                "正在预订\n\n订好了：周五下午三点。"
            ]
        );
        assert_eq!(window.turns[0].said_at, "2026-10-13T09:11:00Z");
    }

    /// A wake (a subtask report, the daily review) is a user row Galley
    /// wrote, and opens a turn like the user's own when it said
    /// something — also when the tag follows what it said: it has an
    /// answer.
    #[test]
    fn a_turn_a_wake_opens_is_carried_when_it_said_something() {
        let mut rows = exchange(0);
        rows.push(wake(1, "[Galley: subtask s-1 \"查资料\" finished]"));
        rows.push(row(1, "assistant", "看看结果"));
        rows.push(row(2, "assistant", "资料查到了。"));
        rows.push(wake(3, "[Galley: subtask s-2 \"订座\" finished]"));
        let mut told = row(3, "assistant", "已转告：订好了。<no-reply/>");
        told.final_answer = Some("已转告：订好了。".into());
        rows.push(told);
        let window = CarriedWindow::from_rows(rows);
        assert!(window
            .turns
            .iter()
            .skip(1)
            .all(|turn| turn.user.content.starts_with("[Galley:")));
        assert_eq!(indexes(&window), vec![0, 1, 3]);
        assert_eq!(
            replies(&window),
            vec![
                "r0",
                "看看结果\n\n资料查到了。",
                "已转告：订好了。<no-reply/>"
            ]
        );
        assert_eq!(window.last_said_at(), Some("2026-10-13T09:03:00Z"));
    }

    /// Ticket 79: a wake whose turn ends in silence — only a subtask
    /// sent off, or an answer given for the user, then `<no-reply/>` —
    /// is not carried and takes no place, alone between two of the
    /// user's turns or several in a row; the window reaches back past
    /// them. A turn of the user's own is never skipped this way.
    #[test]
    fn a_wake_answered_in_silence_takes_no_place() {
        let n = CARRY_TURNS as i64;
        let mut rows: Vec<ReplayRow> = (0..n - 1).flat_map(exchange).collect();
        // Between two of the user's turns: the morning review, a step,
        // then only a subtask sent off.
        rows.push(wake(n - 1, "[Galley: morning review]"));
        rows.push(row(n - 1, "assistant", "看看在办的事"));
        rows.push(silent(n, "<no-reply/>\n\n[subtask s-1: 查 NBA]"));
        rows.extend(exchange(n + 1));
        // Several in a row, the last of them right before the boundary.
        rows.push(wake(n + 2, "[Galley: subtask s-1 \"查 NBA\" asking]"));
        rows.push(silent(n + 2, "<no-reply/>"));
        rows.push(wake(n + 3, "[Galley: subtask s-2 \"查天气\" finished]"));
        rows.push(silent(n + 3, "< No-Reply />"));
        rows.push(wake(n + 4, "[Galley: subtask s-1 \"查 NBA\" finished]"));
        rows.push(row(n + 4, "assistant", "核对一下"));
        rows.push(silent(n + 5, "<no-reply/>"));
        let window = CarriedWindow::from_rows(rows.clone());
        let mut expected: Vec<i64> = (0..n - 1).collect();
        expected.push(n + 1);
        assert_eq!(indexes(&window), expected);
        assert!(window
            .turns
            .iter()
            .all(|turn| !turn.user.content.starts_with("[Galley:")));
        assert_eq!(
            window.last_said_at(),
            Some(format!("2026-10-13T09:{:02}:00Z", n + 1).as_str())
        );

        // Only silent wakes: nothing to carry.
        let wakes = rows
            .iter()
            .filter(|row| row.turn_index >= n + 2 || row.turn_index == n - 1 || row.turn_index == n)
            .cloned();
        assert!(CarriedWindow::from_rows(wakes).is_empty());

        // The user's own turn answered with the tag is a turn.
        let window =
            CarriedWindow::from_rows(vec![row(0, "user", "不用回我"), silent(0, "<no-reply/>")]);
        assert_eq!(indexes(&window), vec![0]);
    }

    /// A wake whose turn asked the user is a turn: the answer is the next
    /// user message, and the question before it was said to the user.
    /// The answer's own turn ends in silence, and is the user's.
    #[test]
    fn a_wake_that_asked_the_user_is_a_turn() {
        let rows = vec![
            wake(5, "[Galley: subtask s-1 \"订座\" asking]"),
            row(5, "assistant", "子任务问：靠窗还是靠过道？"),
            row(6, "user", "靠窗"),
            row(6, "assistant", "已转告"),
            silent(7, "<no-reply/>"),
        ];
        let window = CarriedWindow::from_rows(rows);
        assert_eq!(indexes(&window), vec![5, 6]);
        assert_eq!(
            replies(&window),
            vec!["子任务问：靠窗还是靠过道？", "已转告\n\n<no-reply/>"]
        );
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
        let mut late = row(8, "assistant", "第二步");
        late.created_at = "2026-10-13T09:41:30Z".into();
        let window = CarriedWindow::from_rows(vec![
            user,
            row(7, "assistant", "第一步"),
            row(7, "galley", "note"),
            late,
        ]);
        let turn = &window.turns[0];
        assert_eq!(turn.user.images, Some(vec!["/a.png".to_string()]));
        assert_eq!(turn.reply.content, "第一步\n\n第二步");
        assert_eq!(turn.said_at, "2026-10-13T09:41:30Z");
    }

    #[test]
    fn over_the_cap_whole_turns_go_oldest_first() {
        // Three eighths of the cap each: three are over it, two are not.
        let each = CARRY_MAX_CHARS * 3 / 8;
        let rows: Vec<ReplayRow> = (0..3).flat_map(|i| sized(i, 500, each - 500)).collect();
        let window = CarriedWindow::from_rows(rows);
        assert_eq!(indexes(&window), vec![1, 2]);
        assert_eq!(window.chars(), 2 * each);
        // A newer turn too big to sit beside an older one goes alone,
        // uncut while it fits.
        let mut rows = sized(0, 10, 10);
        rows.extend(sized(1, 100, CARRY_MAX_CHARS - 100));
        let window = CarriedWindow::from_rows(rows);
        assert_eq!(indexes(&window), vec![1]);
        assert_eq!(window.chars(), CARRY_MAX_CHARS);
        assert!(!window.turns[0].reply.content.contains(CUT_MARKER));
    }

    #[test]
    fn the_latest_turn_alone_over_the_cap_keeps_the_question_and_the_reply_end() {
        let mut rows = sized(0, 50, 50);
        rows.push(row(1, "user", "总结一下"));
        let reply = format!("开头{}结论：可以。", "长".repeat(CARRY_MAX_CHARS + 3_000));
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

    /// A run over the cap is cut from its start: its first steps go, the
    /// answer at its end stays.
    #[test]
    fn a_cut_run_keeps_the_end_of_its_answer() {
        let step = CARRY_MAX_CHARS / 2;
        let mut rows = exchange(0);
        rows.push(row(1, "user", "查一下"));
        rows.extend(
            (1..5).map(|i| row(i, "assistant", &format!("步骤{i}：{}", "查".repeat(step)))),
        );
        rows.push(row(5, "assistant", "答案：可以，周五前办完。"));
        let window = CarriedWindow::from_rows(rows);
        assert_eq!(indexes(&window), vec![1]);
        let turn = &window.turns[0];
        assert_eq!(turn.user.content, "查一下");
        assert!(turn.reply.content.starts_with(CUT_MARKER));
        assert!(turn.reply.content.contains("步骤4："));
        assert!(!turn.reply.content.contains("步骤1："));
        assert!(turn
            .reply
            .content
            .ends_with("查\n\n答案：可以，周五前办完。"));
        assert_eq!(turn.said_at, "2026-10-13T09:05:00Z");
        assert_eq!(window.chars(), CARRY_MAX_CHARS);
    }

    #[test]
    fn a_user_message_over_half_the_cap_keeps_its_start_and_end() {
        let user = format!(
            "帮我看看这段：{}这段什么意思？",
            "贴".repeat(CARRY_MAX_CHARS + 2_000)
        );
        // A long reply: each side gets half.
        let window = CarriedWindow::from_rows(vec![
            row(0, "user", &user),
            row(
                0,
                "assistant",
                &format!("{}答完", "答".repeat(CARRY_MAX_CHARS)),
            ),
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
        let window = CarriedWindow::from_rows(sized(0, CARRY_MAX_CHARS - 2_000, 1_500));
        assert_eq!(window.chars(), CARRY_MAX_CHARS - 500);
        assert!(!window.turns[0].user.content.contains(CUT_MARKER));
    }

    /// Ten turns that make the cap exactly go whole; one character more
    /// and the oldest goes.
    #[test]
    fn the_turns_at_the_cap_go_whole_and_one_character_over_drops_the_oldest() {
        let n = CARRY_TURNS as i64;
        let each = CARRY_MAX_CHARS / CARRY_TURNS;
        // The latest reply `extra` characters longer.
        let at_cap = |extra: usize| -> Vec<ReplayRow> {
            let mut rows: Vec<ReplayRow> = (0..n).flat_map(|i| sized(i, 100, each - 100)).collect();
            let latest = rows.last_mut().expect("the latest reply");
            latest.content.push_str(&"多".repeat(extra));
            rows
        };
        let window = CarriedWindow::from_rows(at_cap(0));
        assert_eq!(indexes(&window), (0..n).collect::<Vec<_>>());
        assert_eq!(window.chars(), CARRY_MAX_CHARS);
        assert!(window
            .turns
            .iter()
            .all(|turn| !turn.reply.content.contains(CUT_MARKER)));

        let window = CarriedWindow::from_rows(at_cap(1));
        assert_eq!(indexes(&window), (1..n).collect::<Vec<_>>());
        assert_eq!(window.chars(), CARRY_MAX_CHARS + 1 - each);
    }

    #[test]
    fn the_same_rows_carry_the_same_window() {
        let rows = || -> Vec<ReplayRow> {
            let mut rows: Vec<ReplayRow> = (0..4).flat_map(|i| sized(i, 300, 2_200)).collect();
            rows.extend(sized(4, 7_000, 9_000));
            rows.extend((5..8).map(|i| row(i, "assistant", &"步".repeat(3_000))));
            rows
        };
        assert_eq!(
            CarriedWindow::from_rows(rows()),
            CarriedWindow::from_rows(rows())
        );
        assert!(CarriedWindow::from_rows(rows()).chars() <= CARRY_MAX_CHARS);
    }
}
