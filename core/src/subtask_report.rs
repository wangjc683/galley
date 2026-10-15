//! Subtask reports: Core wakes the main chat when one of its subtasks
//! finished, asks or failed (main chat ticket 29,
//! `.scratch/main-chat/issues/29-subtask-wake-core.md`; assistant PRD
//! rulings 2 and 8, main chat PRD rulings 80 and 82).
//!
//! Before this the assistant handed work off and forgot it: the result
//! showed on the subtask's card, and the assistant looked only when the
//! user asked. Now each run of a subtask that ends is **reported** to its
//! main chat, which gets one turn (a **wake**) to check the result, send
//! the subtask back, answer its question, or tell the user.
//!
//! - **Which runs** ([`record_run_end`]): the drain task calls it for
//!   every run signal, before the queue step, while the run gate still
//!   says whether a run was open. Only a subtask the user never wrote in
//!   (a parent, not promoted) of the current main chat reports. How the
//!   run ended decides what ([`RunEnd`]): finished (with its final
//!   answer), asking (the question and its candidates), paused at the
//!   step limit (its last words), failed (`DONE_WITHOUT_EXIT` with the
//!   engine's error, or its runner exiting mid-run). A stopped run
//!   (`ABORTED`) is not reported — a person or the assistant stopped it —
//!   and neither is a slash command's (`SLASH_COMMAND_COMPLETED`: no work
//!   was done). A reply whose tags started nothing reports too, once
//!   ([`not_started_report`]).
//! - **Once**: a report is keyed by its subtask and the user message that
//!   started the run ([`SubtaskReport::key`]); a key is reported once per
//!   process. Reports wait in memory ([`SubtaskReports`]): a subtask runs
//!   inside Galley, so Galley quitting stops it too; what is lost is only
//!   a report waiting while Galley quits (ruling 8). A subtask's newer
//!   report replaces its older one still waiting.
//! - **When** ([`take_due`]): at once when the main chat is idle — its run
//!   gate free, nothing the user queued, no question of its own waiting —
//!   else after its run completes (the drain task asks again after the
//!   queue step, so the user's queued messages go first). While the main
//!   chat waits for the user's answer, any `user_message` would be taken
//!   as that answer, so reports wait and the desktop is told they could
//!   not be delivered ([`SUBTASK_REPORT_UNDELIVERED_EVENT`]).
//! - **What is sent** ([`deliver`]): with the run gate taken (never the
//!   visible queue), the waiting reports are read again — a subtask
//!   running again, its question answered, promoted or deleted drops out
//!   — and the rest go as one message ([`report_text`]): a visible user
//!   row in the main chat, origin `system` +
//!   [`SUBTASK_REPORT_SUPERVISOR`](crate::api::SUBTASK_REPORT_SUPERVISOR)
//!   with the subtask ids as its note ([`Origin::subtask_report`]), its
//!   replay form ([`replay_lines`]) as its `summary`, announced as
//!   `user-message-persisted`, dispatched on the shared runner path
//!   (segments included) as Core's send does. The page hides the row.
//! - **Not delivered**: when the runner does not start or does not take
//!   the message, the reports stay and are tried again on the main
//!   chat's next run signal or the next report; the desktop is told once
//!   per report, and falls back to the subtask's own notification.
//! - **Silent replies**: when the assistant only sent the subtask back or
//!   answered for the user, its reply is `<no-reply/>`, which the turn
//!   derivation strips (`turn_persistence::derive`); the raw reply keeps
//!   it, so the model sees it in its history.
//! - **Replay**: the main chat's replayed history shows a report as its
//!   replay lines, one per subtask ([`crate::subtask::mark_rows`]).
//!
//! Managed runtime only, and only for the main chat's subtasks: attach
//! mode has no main chat, and no other session has a parent.

use crate::api::{
    AskUserBrief, GalleyApi, MessageBrief, Origin, SessionId, SubtaskDispatch, SubtaskFailure,
    SubtaskReportUndeliveredPayload, SUBTASK_REPORT_UNDELIVERED_EVENT,
};
use crate::db::{RunReply, SqliteGalley};
use crate::error::GalleyError;
use crate::ipc::{IpcCommand, UserMessageCommand};
use crate::notify::{notify, Notifier};
use crate::runner_manager::{RunSignal, RunState, RunnerManager};
use crate::session_runner::{
    ensure_session_runner, EnsureOptions, ReplayTimeouts, RunnerHost, SpawnEnv,
};
use crate::session_send::{UserMessagePersistedPayload, USER_MESSAGE_PERSISTED_EVENT};
use crate::socket_listener::RunnerPort;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, PoisonError};
use tauri::AppHandle;

/// `via` of the main chat's `runner-spawned-external` when a report
/// starts its runner.
pub const VIA_SUBTASK_REPORT: &str = "subtask-report";

/// A final answer (or last words) longer than this, in characters, is cut
/// in a report, which then says where to read all of it.
pub const REPORT_TEXT_MAX_CHARS: usize = 3_000;

/// From this many send-backs on, a report tells the assistant not to send
/// the subtask back again but to tell the user what it has (ticket 29).
/// Core refuses no send: the user may still ask for another try.
pub const SEND_BACK_LIMIT: u32 = 2;

// ---------------- wording ----------------
//
// For the model, in English. Ticket 30 evaluates this draft with a real
// model and may change the words; the structure stays.

const OPENING: &str = "[Galley — not a message from the user] A subtask you started has an update. Act on it, then reply to the user. Do not mention this note.";

const CLOSING_MANY: &str = "Reply once, covering all of them.";

const NO_REPLY_END: &str = "end your reply with exactly <no-reply/>";

// ---------------- reports ----------------

/// How a subtask's run ended, with what its report says about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReportOutcome {
    /// It finished; its final answer.
    Done { answer: String },
    /// It stopped on an `ask_user` question.
    Asking {
        question: String,
        candidates: Vec<String>,
    },
    /// It paused at the engine's step limit; the last thing it said.
    StepLimit { last_words: String },
    /// It stopped on an error; what went wrong.
    Error { detail: String },
    /// The tag started nothing, or its session's runner did not start.
    NotStarted { why: String },
}

impl ReportOutcome {
    /// The outcome in a replay line.
    fn replay_phrase(&self) -> &'static str {
        match self {
            Self::Done { .. } => "finished",
            Self::Asking { .. } => "is asking",
            Self::StepLimit { .. } => "stopped at the step limit",
            Self::Error { .. } => "failed",
            Self::NotStarted { .. } => "could not be started",
        }
    }
}

/// One subtask's report to its main chat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubtaskReport {
    pub main_chat_id: String,
    /// `None` for a tag that started no session.
    pub subtask_id: Option<String>,
    /// The dispatch record's title (the instructions' first line).
    pub title: String,
    /// How many times the assistant sent it back
    /// ([`SqliteGalley::subtask_send_backs`]); the round is one more.
    pub send_backs: u32,
    pub outcome: ReportOutcome,
    /// Which end this reports, so it is reported once: the subtask and
    /// the turn of the user message that started the run
    /// (`<subtask>#<turn>`), or the tag (`<main>#<turn>#<ordinal>`).
    pub key: String,
}

impl SubtaskReport {
    fn round(&self) -> u32 {
        self.send_backs + 1
    }
}

/// The message a wake sends: the opening, each report in turn, and — for
/// more than one — the closing.
pub fn report_text(reports: &[SubtaskReport]) -> String {
    let mut parts = vec![OPENING.to_string()];
    parts.extend(reports.iter().map(report_paragraph));
    if reports.len() > 1 {
        parts.push(CLOSING_MANY.to_string());
    }
    parts.join("\n\n")
}

fn report_paragraph(report: &SubtaskReport) -> String {
    let title = &report.title;
    let round = report.round();
    let enough = report.send_backs >= SEND_BACK_LIMIT;
    let send_backs = report.send_backs;
    let Some(id) = report.subtask_id.as_deref() else {
        let ReportOutcome::NotStarted { why } = &report.outcome else {
            // Every other outcome comes from a session.
            return format!("A subtask \"{title}\" has an update.");
        };
        return not_started_paragraph(title, why);
    };
    let enough_said = format!(
        "It has been sent back {send_backs} times already: do not send it back again. \
         Tell the user what it found and what is still missing."
    );
    match &report.outcome {
        ReportOutcome::Done { answer } => {
            let next = if enough {
                enough_said
            } else {
                format!(
                    "If something is missing or wrong, send it back with \
                     `session send {id} \"<what is missing>\" --supervisor=galley-assistant \
                     --reason=\"send back\" --ensure-runner` and {NO_REPLY_END} and nothing \
                     else."
                )
            };
            format!(
                "Subtask `{id}` \"{title}\" (round {round}) finished. Its final answer:\n\
                 <<<\n{}\n>>>\n\
                 Check it against what you asked for in its instructions \
                 (`session show {id} --tail=40` shows them and its steps). If it holds, \
                 tell the user the result in a sentence or two and name the evidence \
                 (a confirmation number, a file path, a link). {next}",
                cut(answer, id)
            )
        }
        ReportOutcome::Asking {
            question,
            candidates,
        } => {
            let options = if candidates.is_empty() {
                String::new()
            } else {
                let quoted: Vec<String> = candidates.iter().map(|c| format!("\"{c}\"")).collect();
                format!(" Options: {}", quoted.join(", "))
            };
            format!(
                "Subtask `{id}` \"{title}\" is asking: \"{question}\"{options}.\n\
                 If the user already told you the answer, or it plainly follows from what \
                 they asked for, answer with `session send {id} \"<answer>\" \
                 --supervisor=galley-assistant --reason=\"answer\" --ensure-runner` and \
                 {NO_REPLY_END}. \
                 If it involves money, sending something to someone, anything that cannot \
                 be undone, or something only the user has (a code sent to their phone, a \
                 password), ask the user in a sentence, and pass their answer on the same \
                 way when they reply."
            )
        }
        ReportOutcome::StepLimit { last_words } => {
            let said = if last_words.trim().is_empty() {
                String::new()
            } else {
                format!(
                    " The last thing it said:\n<<<\n{}\n>>>\n",
                    cut(last_words, id)
                )
            };
            let next = if enough {
                enough_said
            } else {
                format!(
                    "If it is getting somewhere, send it \"continue\" the same way and \
                     {NO_REPLY_END}; this counts as a round. Otherwise tell the user how far \
                     it got."
                )
            };
            let sep = if said.is_empty() { " " } else { "" };
            format!(
                "Subtask `{id}` \"{title}\" (round {round}) paused at the engine's step limit, \
                 mid-work.{said}{sep}{next}"
            )
        }
        ReportOutcome::Error { detail } => format!(
            "Subtask `{id}` \"{title}\" stopped on an error: {}. Tell the user in a sentence \
             what failed and what you suggest. Do not start it again unless they ask.",
            one_line(detail).trim_end_matches('.')
        ),
        ReportOutcome::NotStarted { why } => not_started_paragraph(title, why),
    }
}

fn not_started_paragraph(title: &str, why: &str) -> String {
    let subject = if title.is_empty() {
        "A subtask".to_string()
    } else {
        format!("The subtask \"{title}\"")
    };
    format!(
        "{subject} could not be started: {}. Tell the user in a sentence, and offer to try \
         again.",
        one_line(why).trim_end_matches('.')
    )
}

/// `text` within [`REPORT_TEXT_MAX_CHARS`]: its start, and where to read
/// all of it.
fn cut(text: &str, id: &str) -> String {
    let text = text.trim();
    if text.is_empty() {
        return "(nothing)".into();
    }
    if text.chars().count() <= REPORT_TEXT_MAX_CHARS {
        return text.to_string();
    }
    let kept: String = text.chars().take(REPORT_TEXT_MAX_CHARS).collect();
    format!("{kept}\n[… cut for length; all of it: `session show {id} --tail=1`]")
}

fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// What the main chat's replayed history shows instead of a report
/// message: one line per subtask (stored as the row's `summary`).
pub fn replay_lines(reports: &[SubtaskReport]) -> String {
    reports
        .iter()
        .map(|report| {
            let phrase = report.outcome.replay_phrase();
            let title = &report.title;
            match (&report.subtask_id, title.is_empty()) {
                (Some(id), _) => format!(
                    "[Galley: subtask {id} \"{title}\" {phrase} — details: session show {id}]"
                ),
                (None, false) => format!("[Galley: subtask \"{title}\" {phrase}]"),
                (None, true) => format!("[Galley: a subtask {phrase}]"),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The replay form of a report row without its stored lines: one line
/// per subtask id in its note.
pub fn replay_fallback(origin_note: Option<&str>) -> String {
    let lines: Vec<String> = origin_note
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(|id| format!("[Galley: subtask {id} has an update — details: session show {id}]"))
        .collect();
    if lines.is_empty() {
        "[Galley: a subtask has an update]".into()
    } else {
        lines.join("\n")
    }
}

// ---------------- how a run ended ----------------

/// How a subtask's run ended, as far as the run gate tells.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunEnd {
    Done,
    Asking,
    StepLimit,
    /// `DONE_WITHOUT_EXIT`: the engine's task ended without an exit,
    /// after a runtime error.
    NoExit,
    /// The runner exited while a run was open.
    RunnerExited,
}

/// The end a run signal reports, read before the queue step: `state` is
/// the session's run state with the gate still as the run left it. `None`
/// for nothing to report — a stopped run, a slash command, a runner that
/// closed with no run open.
pub fn run_end(signal: &RunSignal, state: &RunState) -> Option<RunEnd> {
    if matches!(signal, RunSignal::Closed { .. }) {
        return state.open_run.then_some(RunEnd::RunnerExited);
    }
    match state.last_exit.as_deref() {
        Some("ABORTED") | Some("SLASH_COMMAND_COMPLETED") => None,
        _ if state.ask_pending => Some(RunEnd::Asking),
        Some("MAX_TURNS_EXCEEDED") => Some(RunEnd::StepLimit),
        Some("DONE_WITHOUT_EXIT") => Some(RunEnd::NoExit),
        _ => Some(RunEnd::Done),
    }
}

/// What a reply said last: the final answer of a final step, else the
/// text before a step's tool call — the latest that is not empty.
fn last_words(rows: &[RunReply]) -> String {
    rows.iter()
        .rev()
        .find_map(|row| {
            let text = if crate::subtask::is_final_answer(row.tool_calls.as_deref()) {
                row.final_answer.as_deref()
            } else {
                row.preamble.as_deref().or(row.final_answer.as_deref())
            };
            text.map(str::trim).filter(|t| !t.is_empty())
        })
        .unwrap_or_default()
        .to_string()
}

/// The question the run stopped on: the latest `ask_user` call, else its
/// last words.
fn asked(rows: &[RunReply]) -> (String, Vec<String>) {
    rows.iter()
        .rev()
        .find_map(|row| {
            row.tool_calls
                .as_deref()
                .and_then(AskUserBrief::from_tool_calls_json)
        })
        .map(|ask| (ask.question, ask.candidates))
        .unwrap_or_else(|| (last_words(rows), Vec::new()))
}

/// The report of `session_id`'s run that ended as `end`, when the session
/// is a subtask of the current main chat the user never wrote in.
pub async fn report_for_run_end(
    galley: &SqliteGalley,
    runner: &dyn RunnerPort,
    session_id: &str,
    end: RunEnd,
) -> Result<Option<SubtaskReport>, GalleyError> {
    let sid = SessionId(session_id.to_string());
    let session = match galley.session_brief(sid.clone()).await {
        Ok(session) => session,
        Err(GalleyError::NotFound { .. }) => return Ok(None),
        Err(e) => return Err(e),
    };
    let Some(parent) = session.parent_session_id.clone() else {
        return Ok(None);
    };
    if session.promoted == Some(true) {
        return Ok(None);
    }
    match galley.main_chat_id().await? {
        Some(main) if main.as_str() == parent => {}
        _ => return Ok(None),
    }
    let (title, send_backs) = match galley.subtask_dispatch_for_session(&sid).await? {
        Some(dispatch) => (dispatch.title, dispatch.send_backs),
        None => (
            session.title.clone(),
            galley.subtask_send_backs(&sid).await?,
        ),
    };
    let turn = galley
        .latest_user_turn_index(session_id)
        .await?
        .unwrap_or(-1);
    let rows = galley.latest_run_replies(&sid).await?;
    let outcome = match end {
        RunEnd::Done => ReportOutcome::Done {
            answer: last_words(&rows),
        },
        RunEnd::Asking => {
            let (question, candidates) = asked(&rows);
            ReportOutcome::Asking {
                question,
                candidates,
            }
        }
        RunEnd::StepLimit => ReportOutcome::StepLimit {
            last_words: last_words(&rows),
        },
        RunEnd::NoExit => ReportOutcome::Error {
            detail: runner
                .last_run_error(session_id)
                .await
                .unwrap_or_else(|| "the engine ended the run without finishing it".into()),
        },
        RunEnd::RunnerExited => ReportOutcome::Error {
            detail: "its engine process exited before the run finished".into(),
        },
    };
    Ok(Some(SubtaskReport {
        main_chat_id: parent,
        subtask_id: Some(session_id.to_string()),
        title,
        send_backs,
        outcome,
        key: format!("{session_id}#{turn}"),
    }))
}

/// The report of a tag that started nothing, or whose session's runner
/// did not start; `None` for a dispatch that started.
pub fn not_started_report(dispatch: &SubtaskDispatch) -> Option<SubtaskReport> {
    let failure = dispatch.failure?;
    let why = match (failure, dispatch.failure_detail.as_deref()) {
        (SubtaskFailure::Empty, _) => "the tag was empty".to_string(),
        (SubtaskFailure::Unclosed, _) => "the tag was not closed".to_string(),
        (SubtaskFailure::StartFailed, Some(detail)) if !detail.trim().is_empty() => {
            one_line(detail)
        }
        (SubtaskFailure::StartFailed, _) => "it failed to start".to_string(),
    };
    Some(SubtaskReport {
        main_chat_id: dispatch.parent_session_id.clone(),
        subtask_id: dispatch.session_id.clone(),
        title: dispatch.title.clone(),
        send_backs: 0,
        outcome: ReportOutcome::NotStarted { why },
        key: format!(
            "{}#{}#{}",
            dispatch.parent_session_id, dispatch.turn_index, dispatch.ordinal
        ),
    })
}

// ---------------- waiting reports ----------------

#[derive(Debug, Clone)]
struct Waiting {
    report: SubtaskReport,
    /// The desktop was told this report could not be delivered.
    announced: bool,
}

#[derive(Default)]
struct State {
    /// Per main chat, oldest first.
    waiting: HashMap<String, Vec<Waiting>>,
    /// Keys reported in this process.
    seen: HashSet<String>,
}

/// The reports waiting for their main chat, in memory. One per process,
/// owned by the drain task (`crate::message_queue`).
#[derive(Default)]
pub struct SubtaskReports {
    state: Mutex<State>,
}

impl SubtaskReports {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Keep `report` for its main chat, replacing the same subtask's
    /// earlier one. `false` when its end was reported before.
    pub fn add(&self, report: SubtaskReport) -> bool {
        let mut state = self.lock();
        if !state.seen.insert(report.key.clone()) {
            return false;
        }
        let waiting = state
            .waiting
            .entry(report.main_chat_id.clone())
            .or_default();
        if let Some(id) = &report.subtask_id {
            waiting.retain(|w| w.report.subtask_id.as_ref() != Some(id));
        }
        waiting.push(Waiting {
            report,
            announced: false,
        });
        true
    }

    /// The reports waiting for `main_chat_id`, oldest first.
    pub fn waiting(&self, main_chat_id: &str) -> Vec<SubtaskReport> {
        self.lock()
            .waiting
            .get(main_chat_id)
            .map(|list| list.iter().map(|w| w.report.clone()).collect())
            .unwrap_or_default()
    }

    fn has_waiting(&self, main_chat_id: &str) -> bool {
        self.lock()
            .waiting
            .get(main_chat_id)
            .is_some_and(|list| !list.is_empty())
    }

    fn take(&self, main_chat_id: &str) -> Vec<Waiting> {
        self.lock().waiting.remove(main_chat_id).unwrap_or_default()
    }

    /// Put reports back after a failed delivery, ahead of any that came
    /// in meanwhile — except a subtask's that a newer one replaced.
    fn restore(&self, main_chat_id: &str, back: Vec<Waiting>) {
        let mut state = self.lock();
        let waiting = state.waiting.entry(main_chat_id.to_string()).or_default();
        let newer: HashSet<String> = waiting
            .iter()
            .filter_map(|w| w.report.subtask_id.clone())
            .collect();
        let mut merged: Vec<Waiting> = back
            .into_iter()
            .filter(|w| {
                w.report
                    .subtask_id
                    .as_ref()
                    .is_none_or(|id| !newer.contains(id))
            })
            .collect();
        merged.append(waiting);
        *waiting = merged;
    }

    /// Mark the waiting reports of `main_chat_id` as announced
    /// undelivered; the subtask ids not announced before.
    fn announce_waiting(&self, main_chat_id: &str) -> Vec<String> {
        let mut state = self.lock();
        match state.waiting.get_mut(main_chat_id) {
            Some(list) => mark_announced(list),
            None => Vec::new(),
        }
    }
}

fn mark_announced(list: &mut [Waiting]) -> Vec<String> {
    list.iter_mut()
        .filter(|w| !w.announced)
        .filter_map(|w| {
            w.announced = true;
            w.report.subtask_id.clone()
        })
        .collect()
}

fn announce_undelivered(notifier: &dyn Notifier, main_chat_id: &str, subtask_ids: Vec<String>) {
    if subtask_ids.is_empty() {
        return;
    }
    eprintln!(
        "[subtask-report {main_chat_id}] not delivered: {}",
        subtask_ids.join(", ")
    );
    notify(
        notifier,
        SUBTASK_REPORT_UNDELIVERED_EVENT,
        &SubtaskReportUndeliveredPayload {
            main_chat_id: main_chat_id.to_string(),
            subtask_ids,
        },
    );
}

// ---------------- recording ----------------

/// The drain task's hook for a run signal, called before the queue step:
/// a subtask's run that ended is reported to its main chat. Returns that
/// main chat when a report was added, for the caller to wake once the
/// queue step is done ([`take_due`]).
pub async fn record_run_end(
    reports: &SubtaskReports,
    galley: &SqliteGalley,
    runner: &dyn RunnerPort,
    signal: &RunSignal,
) -> Option<String> {
    let session_id = match signal {
        RunSignal::RunComplete { session_id } | RunSignal::Closed { session_id } => session_id,
    };
    let state = runner.run_state(session_id).await;
    let end = run_end(signal, &state)?;
    match report_for_run_end(galley, runner, session_id, end).await {
        Ok(Some(report)) => {
            let main = report.main_chat_id.clone();
            reports.add(report).then_some(main)
        }
        Ok(None) => None,
        Err(e) => {
            eprintln!("[subtask-report {session_id}] reading the run that ended failed: {e}");
            None
        }
    }
}

/// Report the dispatches of a reply that started nothing. Returns the
/// main chat to wake when any was added.
pub fn record_not_started(
    reports: &SubtaskReports,
    dispatches: &[SubtaskDispatch],
) -> Option<String> {
    let mut main = None;
    for report in dispatches.iter().filter_map(not_started_report) {
        let parent = report.main_chat_id.clone();
        if reports.add(report) {
            main = Some(parent);
        }
    }
    main
}

// ---------------- waking ----------------

/// A wake whose run gate is taken: the reports it carries.
#[derive(Debug)]
pub struct WakeJob {
    main_chat_id: String,
    reports: Vec<Waiting>,
}

impl WakeJob {
    pub fn main_chat_id(&self) -> &str {
        &self.main_chat_id
    }
}

/// What [`deliver`] did.
#[derive(Debug)]
pub enum WakeOutcome {
    /// The report message was written and dispatched.
    Delivered {
        message: MessageBrief,
        /// The subtasks it covers (also its `origin.reason`).
        subtask_ids: Vec<String>,
        /// The reports it carries, in order.
        reports: Vec<SubtaskReport>,
    },
    /// Read again, none was still worth reporting; nothing was sent.
    NothingLeft,
    /// Not delivered: the reports wait for the next try.
    Failed(String),
}

/// Take `main_chat_id`'s run gate for its waiting reports, when it has
/// any and is idle. While it waits for the user's answer the reports
/// stay, and the desktop is told they could not be delivered. `None`
/// when there is nothing to send now.
pub async fn take_due(
    reports: &SubtaskReports,
    host: &RunnerHost<'_>,
    main_chat_id: &str,
) -> Option<WakeJob> {
    if !reports.has_waiting(main_chat_id) {
        return None;
    }
    // A question of the main chat's own is waiting: a message now would
    // be its answer. A run cannot start while the gate is free, so the
    // flag holds until the reservation below.
    if host.runner.run_state(main_chat_id).await.ask_pending {
        announce_undelivered(
            host.notifier.as_ref(),
            main_chat_id,
            reports.announce_waiting(main_chat_id),
        );
        return None;
    }
    // Busy, or the user's queued messages go first: the next run signal
    // asks again.
    if !host.runner.queue_try_reserve(main_chat_id).await {
        return None;
    }
    let taken = reports.take(main_chat_id);
    if taken.is_empty() {
        host.runner.queue_release_run(main_chat_id).await;
        return None;
    }
    Some(WakeJob {
        main_chat_id: main_chat_id.to_string(),
        reports: taken,
    })
}

/// Send the wake `job` carries, with its run gate held: read the reports
/// again, then ensure the main chat's runner, write the message and
/// dispatch it. Every way out but delivery releases the gate; a failure
/// keeps the reports for the next try and tells the desktop.
pub async fn deliver(reports: &SubtaskReports, host: &RunnerHost<'_>, job: WakeJob) -> WakeOutcome {
    let WakeJob {
        main_chat_id: main,
        reports: taken,
    } = job;
    let due = still_due(host, &main, taken).await;
    if due.is_empty() {
        host.runner.queue_release_run(&main).await;
        return WakeOutcome::NothingLeft;
    }
    let carried: Vec<SubtaskReport> = due.iter().map(|w| w.report.clone()).collect();
    let subtask_ids: Vec<String> = carried
        .iter()
        .filter_map(|r| r.subtask_id.clone())
        .collect();
    let text = report_text(&carried);

    // The shared runner path, as Core's send: the segment rule, a runner
    // with the main chat's history. Before the message is written, so the
    // idle gap is measured to the last message before it and a runner that
    // cannot start leaves no row behind.
    if let Err(e) = ensure_session_runner(
        host,
        &main,
        EnsureOptions {
            via: VIA_SUBTASK_REPORT,
            active_session_id: Some(&main),
            llm_override: None,
            ga_config: None,
            holds_run_gate: true,
            timeouts: ReplayTimeouts::default(),
        },
    )
    .await
    {
        return keep_for_later(reports, host, &main, due, format!("{e:?}")).await;
    }
    let message = match host
        .galley
        .persist_subtask_report(
            &SessionId(main.clone()),
            text.clone(),
            Origin::subtask_report(&subtask_ids),
            &replay_lines(&carried),
        )
        .await
    {
        Ok(message) => message,
        Err(e) => return keep_for_later(reports, host, &main, due, e.to_string()).await,
    };
    announce_message(host, &main, &message, "pending");
    let dispatched = host
        .runner
        .send_command(
            &main,
            &IpcCommand::UserMessage(UserMessageCommand {
                text,
                images: Vec::new(),
                visibility: None,
                absolute_turn_index: message.turn_index.map(i64::from),
            }),
        )
        .await;
    if let Err(e) = dispatched {
        announce_message(host, &main, &message, "persisted_only");
        return keep_for_later(reports, host, &main, due, e.to_string()).await;
    }
    announce_message(host, &main, &message, "dispatched");
    eprintln!(
        "[subtask-report {main}] woke the main chat for {} report(s)",
        carried.len()
    );
    WakeOutcome::Delivered {
        message,
        subtask_ids,
        reports: carried,
    }
}

/// [`take_due`] then [`deliver`], in the caller's task.
pub async fn wake_if_due(
    reports: &SubtaskReports,
    host: &RunnerHost<'_>,
    main_chat_id: &str,
) -> Option<WakeOutcome> {
    let job = take_due(reports, host, main_chat_id).await?;
    Some(deliver(reports, host, job).await)
}

/// The drain task's wake: the run gate is taken here, in signal order
/// (after the queue step), and the delivery — which may start a runner —
/// runs in the background, so it never holds up other sessions' queues.
pub async fn spawn_wake_if_due(
    reports: &Arc<SubtaskReports>,
    galley: &SqliteGalley,
    manager: &Arc<RunnerManager>,
    notifier: &Arc<dyn Notifier>,
    app: Option<&AppHandle>,
    main_chat_id: &str,
) {
    let job = {
        let host = RunnerHost {
            galley,
            runner: manager.as_ref(),
            notifier: notifier.clone(),
            env: app.map(|app| app as &dyn SpawnEnv),
        };
        take_due(reports, &host, main_chat_id).await
    };
    let Some(job) = job else {
        return;
    };
    let reports = reports.clone();
    let galley = galley.clone();
    let manager = manager.clone();
    let notifier = notifier.clone();
    let app = app.cloned();
    // `tauri::async_runtime::spawn`, like the drain task itself: no
    // ambient tokio runtime is guaranteed where Core's tasks start.
    tauri::async_runtime::spawn(async move {
        let host = RunnerHost {
            galley: &galley,
            runner: manager.as_ref(),
            notifier,
            env: app.as_ref().map(|app| app as &dyn SpawnEnv),
        };
        let main = job.main_chat_id().to_string();
        if let WakeOutcome::Failed(why) = deliver(&reports, &host, job).await {
            eprintln!("[subtask-report {main}] wake failed, kept for the next try: {why}");
        }
    });
}

/// The reports still worth sending, read again with the gate held: the
/// main chat must still be the main chat; a subtask that is running
/// again, whose question was answered, that the user promoted or that
/// was deleted drops out.
async fn still_due(host: &RunnerHost<'_>, main: &str, taken: Vec<Waiting>) -> Vec<Waiting> {
    match host.galley.main_chat_id().await {
        Ok(Some(id)) if id.as_str() == main => {}
        Ok(_) => return Vec::new(),
        Err(e) => eprintln!("[subtask-report {main}] reading the main chat failed: {e}"),
    }
    let mut due = Vec::with_capacity(taken.len());
    for waiting in taken {
        if is_still_due(host, &waiting.report).await {
            due.push(waiting);
        }
    }
    due
}

async fn is_still_due(host: &RunnerHost<'_>, report: &SubtaskReport) -> bool {
    let Some(id) = report.subtask_id.as_deref() else {
        return true;
    };
    match host.galley.session_brief(SessionId(id.to_string())).await {
        Ok(session) if session.promoted == Some(true) => return false,
        Ok(_) => {}
        Err(GalleyError::NotFound { .. }) => return false,
        Err(e) => eprintln!("[subtask-report {id}] reading the subtask failed: {e}"),
    }
    let state = host.runner.run_state(id).await;
    if state.open_run {
        return false;
    }
    !matches!(report.outcome, ReportOutcome::Asking { .. }) || state.ask_pending
}

/// A delivery that failed: release the gate, keep the reports for the
/// next try, tell the desktop about the ones it has not heard of.
async fn keep_for_later(
    reports: &SubtaskReports,
    host: &RunnerHost<'_>,
    main: &str,
    mut due: Vec<Waiting>,
    why: String,
) -> WakeOutcome {
    host.runner.queue_release_run(main).await;
    eprintln!("[subtask-report {main}] could not wake the main chat: {why}");
    let ids = mark_announced(&mut due);
    reports.restore(main, due);
    announce_undelivered(host.notifier.as_ref(), main, ids);
    WakeOutcome::Failed(why)
}

fn announce_message(
    host: &RunnerHost<'_>,
    main: &str,
    message: &MessageBrief,
    dispatch: &'static str,
) {
    notify(
        host.notifier.as_ref(),
        USER_MESSAGE_PERSISTED_EVENT,
        &UserMessagePersistedPayload {
            session_id: main.to_string(),
            message: message.clone(),
            dispatch,
            client_request_id: None,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(id: Option<&str>, send_backs: u32, outcome: ReportOutcome) -> SubtaskReport {
        SubtaskReport {
            main_chat_id: "s-main".into(),
            subtask_id: id.map(str::to_string),
            title: "把 PDF 分类".into(),
            send_backs,
            outcome,
            key: format!("{}#1", id.unwrap_or("tag")),
        }
    }

    fn done(answer: &str) -> ReportOutcome {
        ReportOutcome::Done {
            answer: answer.into(),
        }
    }

    fn state(last_exit: Option<&str>, ask_pending: bool, open_run: bool) -> RunState {
        RunState {
            open_run,
            ask_pending,
            last_exit: last_exit.map(str::to_string),
            ..RunState::default()
        }
    }

    fn complete() -> RunSignal {
        RunSignal::RunComplete {
            session_id: "s".into(),
        }
    }

    #[test]
    fn how_a_run_ended() {
        let closed = RunSignal::Closed {
            session_id: "s".into(),
        };
        let cases = [
            (
                complete(),
                state(Some("CURRENT_TASK_DONE"), false, true),
                Some(RunEnd::Done),
            ),
            (
                complete(),
                state(Some("EXITED"), false, true),
                Some(RunEnd::Done),
            ),
            (complete(), state(None, false, true), Some(RunEnd::Done)),
            (
                complete(),
                state(Some("EXITED"), true, true),
                Some(RunEnd::Asking),
            ),
            (
                complete(),
                state(Some("MAX_TURNS_EXCEEDED"), false, true),
                Some(RunEnd::StepLimit),
            ),
            (
                complete(),
                state(Some("DONE_WITHOUT_EXIT"), false, true),
                Some(RunEnd::NoExit),
            ),
            (complete(), state(Some("ABORTED"), false, true), None),
            (
                complete(),
                state(Some("SLASH_COMMAND_COMPLETED"), false, true),
                None,
            ),
            (
                closed.clone(),
                state(Some("CURRENT_TASK_DONE"), false, true),
                Some(RunEnd::RunnerExited),
            ),
            // Closed while idle (evicted, shut down): no run ended.
            (closed, state(Some("CURRENT_TASK_DONE"), false, false), None),
        ];
        for (signal, state, want) in cases {
            assert_eq!(run_end(&signal, &state), want, "{signal:?} {state:?}");
        }
    }

    #[test]
    fn one_report_has_the_opening_and_no_closing() {
        let text = report_text(&[report(Some("s-1"), 0, done("分好了：发票 3 份。"))]);
        assert!(text.starts_with(OPENING));
        assert!(!text.contains(CLOSING_MANY));
        assert!(
            text.contains("Subtask `s-1` \"把 PDF 分类\" (round 1) finished. Its final answer:")
        );
        assert!(text.contains("<<<\n分好了：发票 3 份。\n>>>"));
        assert!(text.contains("`session show s-1 --tail=40`"));
        assert!(text.contains(
            "send it back with `session send s-1 \"<what is missing>\" \
             --supervisor=galley-assistant --reason=\"send back\" --ensure-runner` and end \
             your reply with exactly <no-reply/> and nothing else."
        ));
    }

    #[test]
    fn every_send_starts_the_subtasks_runner_if_it_is_gone() {
        let text = report_text(&[
            report(Some("s-1"), 0, done("x")),
            report(
                Some("s-2"),
                0,
                ReportOutcome::Asking {
                    question: "q".into(),
                    candidates: vec![],
                },
            ),
        ]);
        let sends: Vec<&str> = text
            .split("`session send ")
            .skip(1)
            .map(|rest| rest.split('`').next().unwrap())
            .collect();
        assert_eq!(sends.len(), 2);
        for send in sends {
            assert!(
                send.ends_with(
                    "--supervisor=galley-assistant --reason=\"send back\" --ensure-runner"
                ) || send
                    .ends_with("--supervisor=galley-assistant --reason=\"answer\" --ensure-runner"),
                "{send}"
            );
        }
    }

    #[test]
    fn several_reports_go_in_one_message() {
        let text = report_text(&[
            report(Some("s-1"), 0, done("好了")),
            report(
                Some("s-2"),
                0,
                ReportOutcome::Asking {
                    question: "要哪家？".into(),
                    candidates: vec!["A 店".into(), "B 店".into()],
                },
            ),
        ]);
        assert_eq!(text.matches(OPENING).count(), 1);
        assert!(text.ends_with(CLOSING_MANY));
        let first = text.find("`s-1`").unwrap();
        let second = text.find("`s-2`").unwrap();
        assert!(first < second);
        assert!(text.contains(
            "Subtask `s-2` \"把 PDF 分类\" is asking: \"要哪家？\" Options: \"A 店\", \"B 店\"."
        ));
        assert!(text.contains(
            "--reason=\"answer\" --ensure-runner` and end your reply with exactly <no-reply/>."
        ));
    }

    #[test]
    fn a_question_without_options_ends_after_it() {
        let text = report_text(&[report(
            Some("s-2"),
            0,
            ReportOutcome::Asking {
                question: "验证码是多少？".into(),
                candidates: vec![],
            },
        )]);
        assert!(text.contains("is asking: \"验证码是多少？\".\n"));
    }

    #[test]
    fn the_round_counts_send_backs_and_two_is_enough() {
        let once = report_text(&[report(Some("s-1"), 1, done("x"))]);
        assert!(once.contains("(round 2) finished"));
        assert!(once.contains("send it back with"));
        let twice = report_text(&[report(Some("s-1"), 2, done("x"))]);
        assert!(twice.contains("(round 3) finished"));
        assert!(!twice.contains("send it back with"));
        assert!(twice.contains(
            "It has been sent back 2 times already: do not send it back again. \
             Tell the user what it found and what is still missing."
        ));
        let step = report_text(&[report(
            Some("s-1"),
            2,
            ReportOutcome::StepLimit {
                last_words: "".into(),
            },
        )]);
        assert!(step.contains("do not send it back again"));
        assert!(!step.contains("continue"));
    }

    #[test]
    fn a_long_answer_is_cut_with_where_to_read_it() {
        let answer = format!("{}尾巴", "长".repeat(REPORT_TEXT_MAX_CHARS));
        let text = report_text(&[report(Some("s-1"), 0, done(&answer))]);
        assert!(text.contains(&"长".repeat(REPORT_TEXT_MAX_CHARS)));
        assert!(!text.contains("尾巴"));
        assert!(text.contains("[… cut for length; all of it: `session show s-1 --tail=1`]"));
        let exact = "短".repeat(REPORT_TEXT_MAX_CHARS);
        assert!(!report_text(&[report(Some("s-1"), 0, done(&exact))]).contains("cut for length"));
    }

    #[test]
    fn step_limit_error_and_not_started() {
        let step = report_text(&[report(
            Some("s-1"),
            0,
            ReportOutcome::StepLimit {
                last_words: "已经分完一半。".into(),
            },
        )]);
        assert!(step.contains(
            "Subtask `s-1` \"把 PDF 分类\" (round 1) paused at the engine's step limit, mid-work. \
             The last thing it said:\n<<<\n已经分完一半。\n>>>\nIf it is getting somewhere, \
             send it \"continue\" the same way"
        ));
        let quiet = report_text(&[report(
            Some("s-1"),
            0,
            ReportOutcome::StepLimit {
                last_words: " ".into(),
            },
        )]);
        assert!(quiet.contains("mid-work. If it is getting somewhere"));
        let error = report_text(&[report(
            Some("s-1"),
            0,
            ReportOutcome::Error {
                detail: "429 Too Many\nRequests.".into(),
            },
        )]);
        assert!(error.contains(
            "Subtask `s-1` \"把 PDF 分类\" stopped on an error: 429 Too Many Requests. \
             Tell the user in a sentence what failed and what you suggest. \
             Do not start it again unless they ask."
        ));
        let not_started = report_text(&[report(
            None,
            0,
            ReportOutcome::NotStarted {
                why: "the tag was not closed".into(),
            },
        )]);
        assert!(not_started.contains(
            "The subtask \"把 PDF 分类\" could not be started: the tag was not closed. \
             Tell the user in a sentence, and offer to try again."
        ));
        let mut empty = report(
            None,
            0,
            ReportOutcome::NotStarted {
                why: "the tag was empty".into(),
            },
        );
        empty.title = String::new();
        assert!(
            report_text(&[empty]).contains("A subtask could not be started: the tag was empty.")
        );
    }

    #[test]
    fn replay_lines_name_each_subtask_and_how_it_ended() {
        let mut nameless = report(
            None,
            0,
            ReportOutcome::NotStarted {
                why: "the tag was empty".into(),
            },
        );
        nameless.title = String::new();
        let lines = replay_lines(&[
            report(Some("s-1"), 0, done("x")),
            report(
                Some("s-2"),
                0,
                ReportOutcome::Asking {
                    question: "q".into(),
                    candidates: vec![],
                },
            ),
            report(
                Some("s-3"),
                0,
                ReportOutcome::StepLimit {
                    last_words: "w".into(),
                },
            ),
            report(Some("s-4"), 0, ReportOutcome::Error { detail: "d".into() }),
            report(
                None,
                0,
                ReportOutcome::NotStarted {
                    why: "the tag was not closed".into(),
                },
            ),
            nameless,
        ]);
        assert_eq!(
            lines.split('\n').collect::<Vec<_>>(),
            vec![
                "[Galley: subtask s-1 \"把 PDF 分类\" finished — details: session show s-1]",
                "[Galley: subtask s-2 \"把 PDF 分类\" is asking — details: session show s-2]",
                "[Galley: subtask s-3 \"把 PDF 分类\" stopped at the step limit — details: session show s-3]",
                "[Galley: subtask s-4 \"把 PDF 分类\" failed — details: session show s-4]",
                "[Galley: subtask \"把 PDF 分类\" could not be started]",
                "[Galley: a subtask could not be started]",
            ]
        );
        assert_eq!(
            replay_fallback(Some("s-1, s-2")),
            "[Galley: subtask s-1 has an update — details: session show s-1]\n\
             [Galley: subtask s-2 has an update — details: session show s-2]"
        );
        assert_eq!(replay_fallback(None), "[Galley: a subtask has an update]");
    }

    fn reply(
        final_answer: Option<&str>,
        preamble: Option<&str>,
        tool_calls: Option<&str>,
    ) -> RunReply {
        RunReply {
            turn_index: 1,
            final_answer: final_answer.map(str::to_string),
            preamble: preamble.map(str::to_string),
            tool_calls: tool_calls.map(str::to_string),
        }
    }

    #[test]
    fn last_words_and_the_question() {
        let rows = vec![
            reply(
                Some("先看看"),
                Some("先看看"),
                Some(r#"[{"toolName":"code_run"}]"#),
            ),
            reply(Some("分好了"), None, Some("[]")),
        ];
        assert_eq!(last_words(&rows), "分好了");
        let rows = vec![
            reply(Some("答完了"), None, None),
            reply(None, Some("还差一步"), Some(r#"[{"toolName":"code_run"}]"#)),
        ];
        assert_eq!(last_words(&rows), "还差一步");
        assert_eq!(last_words(&[reply(None, None, None)]), "");
        let rows = vec![reply(
            None,
            None,
            Some(
                r#"[{"toolName":"ask_user","args":{"question":"要哪家？","candidates":["A","B"]}}]"#,
            ),
        )];
        assert_eq!(
            asked(&rows),
            ("要哪家？".into(), vec!["A".into(), "B".into()])
        );
        assert_eq!(
            asked(&[reply(Some("你说呢"), None, None)]),
            ("你说呢".into(), vec![])
        );
    }

    #[test]
    fn a_report_is_kept_once_and_replaces_its_subtasks_older_one() {
        let reports = SubtaskReports::new();
        assert!(reports.add(report(Some("s-1"), 0, done("a"))));
        // The same end again.
        assert!(!reports.add(report(Some("s-1"), 0, done("a"))));
        assert!(reports.add(report(
            None,
            0,
            ReportOutcome::NotStarted { why: "x".into() }
        )));
        let mut newer = report(Some("s-1"), 1, done("b"));
        newer.key = "s-1#5".into();
        assert!(reports.add(newer.clone()));
        let waiting = reports.waiting("s-main");
        assert_eq!(waiting.len(), 2);
        assert_eq!(waiting[1], newer);

        // Announced once each.
        assert_eq!(reports.announce_waiting("s-main"), vec!["s-1".to_string()]);
        assert!(reports.announce_waiting("s-main").is_empty());

        // Restored ahead of later ones, unless a newer one replaced it.
        let taken = reports.take("s-main");
        assert!(reports.waiting("s-main").is_empty());
        let mut newest = report(Some("s-1"), 2, done("c"));
        newest.key = "s-1#9".into();
        reports.add(newest.clone());
        reports.restore("s-main", taken);
        let waiting = reports.waiting("s-main");
        assert_eq!(waiting.len(), 2);
        assert_eq!(waiting[0].subtask_id, None);
        assert_eq!(waiting[1], newest);
    }
}
