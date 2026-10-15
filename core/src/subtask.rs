//! Subtasks: work the main chat hands off (main chat ticket 06a,
//! `.scratch/main-chat/issues/06a-subtask-dispatch-and-cards.md`; PRD
//! rulings 9, 25, 52, 53).
//!
//! The main chat's entry layer tells the model to end a reply with
//! `<subtask>what to do</subtask>` for work that would keep the chat busy
//! for a long time ([`crate::managed_prompt`]). Nothing about the tag
//! reaches the engine: when the reply's run settles, Core reads it from
//! the persisted reply and starts each tag as a **subtask** — an ordinary
//! managed session whose parent is the main chat, whose origin is
//! `subtask` and whose first user message is the instructions, started
//! the way Core's send ([`crate::session_send`]) starts a message: the
//! run gate, a runner on the shared path, the dispatch. The desktop shows
//! it as a card under that reply, not in the sidebar; the card's record
//! is announced as soon as the session and its message exist.
//!
//! - **Which replies**: the main chat's only ([`pending_reply`]); a tag in
//!   any other session is text. The reply is the run's final answer (no
//!   real tool call), read when the run settles — the drain task calls
//!   [`after_run_complete`] before it hands the session its next queued
//!   message, so the row it reads is this run's. A reply is dispatched
//!   once: its records ([`SqliteGalley::record_subtask_dispatch`]) and an
//!   in-process claim keep a second settle from starting it again.
//! - **One tag, one subtask** (ruling 53), in reply order. An empty tag,
//!   an unclosed one, or a session that could not be created or started
//!   is recorded with why ([`SubtaskFailure`]), never retried.
//! - **Not in the text**: the turn derivation strips the tag from the
//!   final answer and the preamble, and an unclosed one with everything
//!   after it (`turn_persistence::derive`, mirrored by the GUI's
//!   `ga-output-cleaning.ts`). The raw reply keeps it for this module.
//! - **Replay** ([`mark_replay_rows`]): when the main chat's runner is
//!   given its history back (a segment and the turns it carries over),
//!   the instructions are left out and the reply ends with one line per
//!   tag, `[subtask <id>: <title>]` or `[subtask not started: <why>]`, so
//!   the model can look a subtask up by its id (`session show <id>`).
//! - **Promotion** ([`promote_after_user_send`]): a non-answer message the
//!   user sends in a subtask from the desktop or the phone makes it an
//!   ordinary conversation. CLI, supervisor and scheduled sends never
//!   reach Core's send path, and an answer to the subtask's own question
//!   is part of its work, so neither counts.
//! - **Reports** (ticket 29, [`crate::subtask_report`]): each run of a
//!   subtask that ends, and each tag that started nothing, wakes the main
//!   chat with a report; its replayed history shows a report as one line
//!   per subtask ([`mark_rows`]). A record carries how many times the
//!   assistant sent its subtask back (`send_backs`), announced again when
//!   the assistant writes into it ([`announce_send_back`]).
//!
//! Attach mode has no main chat (PRD ruling 3), so none of this runs
//! there.

use crate::api::{
    CreateSessionInput, GalleyApi, MessageBrief, Origin, OriginVia, RuntimeKind, SessionBrief,
    SessionId, SubtaskDispatch, SubtaskDispatchedPayload, SubtaskFailure, ASSISTANT_SUPERVISOR,
    SUBTASK_DISPATCHED_EVENT,
};
use crate::db::{PersistedMessageRow, SqliteGalley};
use crate::error::GalleyError;
use crate::ipc::{IpcCommand, UserMessageCommand};
use crate::notify::{notify, Notifier};
use crate::runner_manager::RunnerManager;
use crate::session_runner::{
    ensure_session_runner, EnsureOptions, ReplayTimeouts, RunnerHost, SpawnEnv,
};
use crate::session_send::{UserMessagePersistedPayload, USER_MESSAGE_PERSISTED_EVENT};
use crate::session_writes::{
    announce_session, SESSION_CREATED_EXTERNAL_EVENT, SESSION_UPDATED_EXTERNAL_EVENT,
};
use crate::subtask_report::SubtaskReports;
use regex::Regex;
use serde_json::Value;
use std::collections::BTreeSet;
use std::sync::{Arc, LazyLock, Mutex};
use tauri::AppHandle;

/// `via` of a subtask's `session-created-external` and of its runner's
/// `runner-spawned-external`.
pub const VIA_SUBTASK: &str = "subtask";

/// `via` of the `session-updated-external` that announces a promotion.
pub const VIA_SUBTASK_PROMOTED: &str = "subtask-promoted";

const OPEN: &str = "<subtask>";
const CLOSE: &str = "</subtask>";

// ---------------- the tags ----------------

/// One `<subtask>` tag of a reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubtaskTag {
    /// The instructions, trimmed.
    Instructions(String),
    /// Nothing but whitespace between the tags.
    Empty,
    /// Opened and never closed: what follows it, trimmed.
    Unclosed(String),
}

/// GA's and Galley's other tag blocks, which may quote `<subtask>` (a
/// model thinking about the tag it is about to write) without meaning
/// it. Complete blocks only, as the turn derivation strips them.
static OTHER_TAG_BLOCKS: LazyLock<[Regex; 5]> = LazyLock::new(|| {
    [
        r"(?s)<thinking>.*?</thinking>",
        r"(?s)<summary>.*?</summary>",
        r"(?s)<tool_use>.*?</tool_use>",
        r"(?s)<file_content[^>]*>.*?</file_content>",
        r"(?s)<next-suggestion>.*?</next-suggestion>",
    ]
    .map(|pattern| Regex::new(pattern).expect("tag pattern compiles"))
});

/// A complete `<subtask>` block, paired the way the turn derivation pairs
/// it (an opener with the next closer).
static SUBTASK_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)<subtask>.*?</subtask>").expect("subtask pattern compiles"));

/// The reply's `<subtask>` tags, in order. Each opener pairs with the
/// next closer (what the display strips is exactly what is read here); an
/// opener with no closer after it takes the rest of the reply and ends
/// the list.
pub fn parse_subtask_tags(content: &str) -> Vec<SubtaskTag> {
    let mut text = content.to_string();
    for re in OTHER_TAG_BLOCKS.iter() {
        text = re.replace_all(&text, "").into_owned();
    }
    let mut tags = Vec::new();
    let mut rest = text.as_str();
    while let Some(open) = rest.find(OPEN) {
        let body_start = open + OPEN.len();
        match rest[body_start..].find(CLOSE) {
            Some(close) => {
                let body = rest[body_start..body_start + close].trim();
                tags.push(if body.is_empty() {
                    SubtaskTag::Empty
                } else {
                    SubtaskTag::Instructions(body.to_string())
                });
                rest = &rest[body_start + close + CLOSE.len()..];
            }
            None => {
                tags.push(SubtaskTag::Unclosed(rest[body_start..].trim().to_string()));
                break;
            }
        }
    }
    tags
}

/// A subtask's title: the instructions' first line, without the markdown
/// a model may open it with (`## Goal`, `- `, `**`), one line of at most
/// [`crate::session_title::TITLE_DERIVE_MAX`] UTF-16 units like a derived
/// title. Empty only for empty instructions.
pub fn subtask_title(instructions: &str) -> String {
    let first = instructions
        .lines()
        .map(|line| {
            line.trim()
                .trim_start_matches(['#', '>', '-', '*', '+'])
                .replace("**", "")
                .trim()
                .to_string()
        })
        .find(|line| !line.is_empty());
    crate::session_title::derive_title_from_text(first.as_deref().unwrap_or(instructions))
}

// ---------------- history replay ----------------

/// The line a reply ends with in the main chat's replayed history for
/// one of its tags.
pub fn replay_marker(dispatch: &SubtaskDispatch) -> String {
    match &dispatch.session_id {
        Some(id) => format!("[subtask {id}: {}]", dispatch.title),
        None => format!(
            "[subtask not started: {}]",
            not_started_reason(dispatch.failure, dispatch.failure_detail.as_deref())
        ),
    }
}

fn not_started_reason(failure: Option<SubtaskFailure>, detail: Option<&str>) -> String {
    match (failure, detail) {
        (Some(SubtaskFailure::Empty), _) => "the tag was empty".into(),
        (Some(SubtaskFailure::Unclosed), _) => "the tag was not closed".into(),
        (Some(SubtaskFailure::StartFailed), Some(detail)) => {
            format!("it could not be started ({})", one_line(detail))
        }
        (Some(SubtaskFailure::StartFailed), None) | (None, _) => "it could not be started".into(),
    }
}

fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A reply's raw text without its `<subtask>` blocks and without an
/// unclosed `<subtask>` and what follows it.
pub fn strip_subtask_tags(content: &str) -> String {
    let mut text = SUBTASK_BLOCK.replace_all(content, "").into_owned();
    if let Some(open) = text.find(OPEN) {
        text.truncate(open);
    }
    text
}

/// The main chat's rows as its runner gets them back: no assistant row
/// keeps its `<subtask>` instructions, and a reply that carried tags ends
/// with one [`replay_marker`] line per tag. `dispatches` are the main
/// chat's ([`SqliteGalley::subtask_dispatches`]); a reply's are the ones
/// on its `turn_index`. A subtask report (ticket 29) is its replay lines,
/// one per subtask (stored as its `summary`,
/// [`crate::subtask_report::replay_lines`]); the reply to it, a
/// `<no-reply/>` included, stays as it is.
pub fn mark_rows(rows: &mut [PersistedMessageRow], dispatches: &[SubtaskDispatch]) {
    for row in rows.iter_mut().filter(|row| {
        row.role == "user"
            && Origin::is_stored_subtask_report(
                row.created_via.as_deref(),
                row.supervisor.as_deref(),
            )
    }) {
        row.content = match row.summary.as_deref().filter(|s| !s.trim().is_empty()) {
            Some(lines) => lines.to_string(),
            None => crate::subtask_report::replay_fallback(row.origin_note.as_deref()),
        };
    }
    for row in rows.iter_mut().filter(|row| row.role == "assistant") {
        let markers: Vec<String> = dispatches
            .iter()
            .filter(|d| d.turn_index == row.turn_index)
            .map(replay_marker)
            .collect();
        if markers.is_empty() && !row.content.contains(OPEN) {
            continue;
        }
        let mut content = strip_subtask_tags(&row.content).trim_end().to_string();
        if !markers.is_empty() {
            if !content.is_empty() {
                content.push_str("\n\n");
            }
            content.push_str(&markers.join("\n"));
        }
        row.content = content;
    }
}

/// [`mark_rows`] with the main chat's dispatches read from the database.
pub async fn mark_replay_rows(
    galley: &SqliteGalley,
    main_chat: &SessionId,
    rows: &mut [PersistedMessageRow],
) -> Result<(), GalleyError> {
    let dispatches = galley.subtask_dispatches(main_chat).await?;
    mark_rows(rows, &dispatches);
    Ok(())
}

// ---------------- dispatch ----------------

/// A main chat reply whose tags have not been dispatched yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingReply {
    pub turn_index: i64,
    /// The raw reply.
    pub content: String,
}

/// A final answer: no tool, or only GA's synthetic `no_tool` (the turn
/// derivation's rule). A reply that ends on `ask_user` is not one.
pub(crate) fn is_final_answer(tool_calls: Option<&str>) -> bool {
    let Some(raw) = tool_calls else {
        return true;
    };
    match serde_json::from_str::<Vec<Value>>(raw) {
        Ok(calls) => calls
            .iter()
            .all(|call| call.get("toolName").and_then(Value::as_str) == Some("no_tool")),
        Err(_) => false,
    }
}

/// The reply of `session_id`'s settled run, when it is the main chat's,
/// a final answer with a `<subtask>` in it, and nothing was recorded for
/// it yet.
pub async fn pending_reply(
    galley: &SqliteGalley,
    session_id: &str,
) -> Result<Option<PendingReply>, GalleyError> {
    match galley.main_chat_id().await? {
        Some(main) if main.as_str() == session_id => {}
        _ => return Ok(None),
    }
    let sid = SessionId(session_id.to_string());
    let Some(reply) = galley.latest_reply(&sid).await? else {
        return Ok(None);
    };
    if !reply.content.contains(OPEN) || !is_final_answer(reply.tool_calls.as_deref()) {
        return Ok(None);
    }
    if galley
        .has_subtask_dispatches(&sid, reply.turn_index)
        .await?
    {
        return Ok(None);
    }
    Ok(Some(PendingReply {
        turn_index: reply.turn_index,
        content: reply.content,
    }))
}

/// Replies this process started dispatching, so two settles of the main
/// chat in quick succession (a run that wrote no new reply) cannot both
/// start the same one before its records land.
static CLAIMED: Mutex<BTreeSet<(String, i64)>> = Mutex::new(BTreeSet::new());

/// [`pending_reply`], claimed for this process: `None` when another
/// caller has it.
pub async fn claim_pending_reply(
    galley: &SqliteGalley,
    session_id: &str,
) -> Result<Option<PendingReply>, GalleyError> {
    let Some(reply) = pending_reply(galley, session_id).await? else {
        return Ok(None);
    };
    let fresh = CLAIMED
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert((session_id.to_string(), reply.turn_index));
    Ok(fresh.then_some(reply))
}

/// The drain task's hook, called on every `RunComplete` before the
/// session's next queued message is dispatched: a main chat reply with
/// tags is claimed here and dispatched in the background, so starting
/// runners never holds up the queue. Tags that started nothing are
/// reported to the main chat (ticket 29, `reports`).
pub async fn after_run_complete(
    galley: &SqliteGalley,
    manager: &Arc<RunnerManager>,
    notifier: &Arc<dyn Notifier>,
    reports: &Arc<SubtaskReports>,
    app: Option<&AppHandle>,
    session_id: &str,
) {
    let reply = match claim_pending_reply(galley, session_id).await {
        Ok(Some(reply)) => reply,
        Ok(None) => return,
        Err(e) => {
            eprintln!("[subtask {session_id}] reading the settled reply failed: {e}");
            return;
        }
    };
    let galley = galley.clone();
    let manager = manager.clone();
    let notifier = notifier.clone();
    let reports = reports.clone();
    let app = app.cloned();
    let parent = session_id.to_string();
    // `tauri::async_runtime::spawn`, like the drain task itself: no
    // ambient tokio runtime is guaranteed where Core's tasks start.
    tauri::async_runtime::spawn(async move {
        let host = RunnerHost {
            galley: &galley,
            runner: manager.as_ref(),
            notifier,
            env: app.as_ref().map(|app| app as &dyn SpawnEnv),
        };
        let dispatches = dispatch_reply(&host, &parent, &reply).await;
        if let Some(main) = crate::subtask_report::record_not_started(&reports, &dispatches) {
            crate::subtask_report::wake_if_due(&reports, &host, &main).await;
        }
    });
}

/// Start every tag of `reply`, concurrently (each is its own session),
/// and record each. A record is announced ([`SUBTASK_DISPATCHED_EVENT`])
/// the moment it exists — a subtask's as soon as its session and first
/// message do, before its runner is up — so its card shows at once; a
/// runner that then fails to start updates its record and announces it
/// again. Returns the records in tag order, as they ended up.
pub async fn dispatch_reply(
    host: &RunnerHost<'_>,
    parent_id: &str,
    reply: &PendingReply,
) -> Vec<SubtaskDispatch> {
    let tags = parse_subtask_tags(&reply.content);
    if tags.is_empty() {
        return Vec::new();
    }
    let parent = match host
        .galley
        .session_brief(SessionId(parent_id.to_string()))
        .await
    {
        Ok(brief) => Some(brief),
        Err(e) => {
            eprintln!("[subtask {parent_id}] reading the main chat failed: {e}");
            None
        }
    };
    let dispatches =
        futures_util::future::join_all(tags.into_iter().enumerate().map(|(ordinal, tag)| {
            dispatch_tag(
                host,
                parent.as_ref(),
                parent_id,
                reply.turn_index,
                ordinal as i64,
                tag,
            )
        }))
        .await;
    eprintln!(
        "[subtask {parent_id}] reply turn {}: {} tag(s), {} started",
        reply.turn_index,
        dispatches.len(),
        dispatches.iter().filter(|d| d.failure.is_none()).count()
    );
    dispatches
}

async fn dispatch_tag(
    host: &RunnerHost<'_>,
    parent: Option<&SessionBrief>,
    parent_id: &str,
    turn_index: i64,
    ordinal: i64,
    tag: SubtaskTag,
) -> SubtaskDispatch {
    let record = |title: String,
                  session_id: Option<String>,
                  failure: Option<SubtaskFailure>,
                  failure_detail: Option<String>| SubtaskDispatch {
        parent_session_id: parent_id.to_string(),
        turn_index,
        ordinal,
        message_id: SubtaskDispatch::reply_message_id(parent_id, turn_index),
        session_id,
        title,
        failure,
        failure_detail,
        created_at: crate::runner_manager::queue::now_iso(),
        send_backs: 0,
    };
    let (title, instructions) = match tag {
        SubtaskTag::Empty => {
            let dispatch = record(String::new(), None, Some(SubtaskFailure::Empty), None);
            settle(host, &dispatch).await;
            return dispatch;
        }
        SubtaskTag::Unclosed(partial) => {
            let dispatch = record(
                subtask_title(&partial),
                None,
                Some(SubtaskFailure::Unclosed),
                None,
            );
            settle(host, &dispatch).await;
            return dispatch;
        }
        SubtaskTag::Instructions(instructions) => (subtask_title(&instructions), instructions),
    };
    let (session_id, message) =
        match create_subtask(host, parent, parent_id, &title, &instructions).await {
            Ok(created) => created,
            Err(detail) => {
                let dispatch = record(title, None, Some(SubtaskFailure::StartFailed), Some(detail));
                settle(host, &dispatch).await;
                return dispatch;
            }
        };
    let started = record(title, Some(session_id.clone()), None, None);
    settle(host, &started).await;
    match run_instructions(host, &session_id, message).await {
        Ok(()) => started,
        Err(detail) => {
            if let Err(e) = host
                .galley
                .mark_subtask_dispatch_failed(&started, &detail)
                .await
            {
                eprintln!("[subtask {session_id}] recording that it did not start failed: {e}");
            }
            let failed = SubtaskDispatch {
                failure: Some(SubtaskFailure::StartFailed),
                failure_detail: Some(detail),
                ..started
            };
            announce(host, &failed);
            failed
        }
    }
}

/// Record a dispatch and announce it.
async fn settle(host: &RunnerHost<'_>, dispatch: &SubtaskDispatch) {
    if let Err(e) = host.galley.record_subtask_dispatch(dispatch).await {
        eprintln!(
            "[subtask {}] recording tag {} of turn {} failed: {e}",
            dispatch.parent_session_id, dispatch.ordinal, dispatch.turn_index
        );
    }
    announce(host, dispatch);
}

fn announce(host: &RunnerHost<'_>, dispatch: &SubtaskDispatch) {
    notify(
        host.notifier.as_ref(),
        SUBTASK_DISPATCHED_EVENT,
        &SubtaskDispatchedPayload {
            parent_session_id: dispatch.parent_session_id.clone(),
            dispatches: vec![dispatch.clone()],
        },
    );
}

/// The subtask's row and its first message, the instructions, written
/// together on the main chat's model (as `session.new` writes a session
/// and its task), then announced: the row created, the message pending.
/// Returns the session id and the message, or why it could not be made.
async fn create_subtask(
    host: &RunnerHost<'_>,
    parent: Option<&SessionBrief>,
    parent_id: &str,
    title: &str,
    instructions: &str,
) -> Result<(String, MessageBrief), String> {
    let id = crate::socket_listener::mint_session_id();
    let input = CreateSessionInput {
        id: id.clone(),
        title: title.to_string(),
        project_id: None,
        selected_llm_index: parent.and_then(|p| p.selected_llm_index),
        selected_llm_key: parent.and_then(|p| p.selected_llm_key.clone()),
        selected_llm_display_name: parent.and_then(|p| p.selected_llm_display_name.clone()),
        ga_runtime_kind: Some(RuntimeKind::Managed),
        ga_runtime_id: None,
        prompt_profile: None,
    };
    let (created, message) = host
        .galley
        .create_subtask_session(
            input,
            Origin::subtask(),
            &SessionId(parent_id.to_string()),
            Some(instructions.to_string()),
        )
        .await
        .map_err(|e| e.to_string())?;
    let message = message.ok_or("the first message was not written")?;
    announce_session(
        host.notifier.as_ref(),
        SESSION_CREATED_EXTERNAL_EVENT,
        created,
        VIA_SUBTASK,
    );
    announce_message(host, &id, &message, "pending");
    Ok((id, message))
}

/// Start the subtask's run as Core's send ([`crate::session_send`]) does
/// for a message already persisted: the run gate, a runner on the shared
/// path ([`crate::session_runner`]), the instructions dispatched. The
/// message is announced again as `dispatched`, or as `persisted_only`
/// with why when the run did not start.
async fn run_instructions(
    host: &RunnerHost<'_>,
    session_id: &str,
    message: MessageBrief,
) -> Result<(), String> {
    if !host.runner.queue_try_reserve(session_id).await {
        // A session created a moment ago has no run to wait for.
        announce_message(host, session_id, &message, "persisted_only");
        return Err("its run gate was taken".into());
    }
    let started = async {
        ensure_session_runner(
            host,
            session_id,
            EnsureOptions {
                via: VIA_SUBTASK,
                active_session_id: Some(session_id),
                llm_override: None,
                ga_config: None,
                holds_run_gate: true,
                timeouts: ReplayTimeouts::default(),
            },
        )
        .await
        .map_err(|e| format!("{e:?}"))?;
        host.runner
            .send_command(
                session_id,
                &IpcCommand::UserMessage(UserMessageCommand {
                    text: message.content.clone(),
                    images: Vec::new(),
                    visibility: None,
                    absolute_turn_index: message.turn_index.map(i64::from),
                }),
            )
            .await
            .map_err(|e| e.to_string())
    }
    .await;
    match &started {
        Ok(()) => announce_message(host, session_id, &message, "dispatched"),
        Err(_) => {
            host.runner.queue_release_run(session_id).await;
            announce_message(host, session_id, &message, "persisted_only");
        }
    }
    started
}

fn announce_message(
    host: &RunnerHost<'_>,
    session_id: &str,
    message: &MessageBrief,
    dispatch: &'static str,
) {
    notify(
        host.notifier.as_ref(),
        USER_MESSAGE_PERSISTED_EVENT,
        &UserMessagePersistedPayload {
            session_id: session_id.to_string(),
            message: message.clone(),
            dispatch,
            client_request_id: None,
        },
    );
}

// ---------------- send-backs ----------------

/// After a user message from the assistant ([`ASSISTANT_SUPERVISOR`]) was
/// written into `session_id` — socket `session send`, or the queue
/// dispatching one: a subtask's dispatch record is announced again with
/// its send-back count ([`SUBTASK_DISPATCHED_EVENT`], ticket 29), so its
/// card shows the round. An answer to the subtask's question leaves the
/// count as it was and announces the same record.
pub async fn announce_send_back(
    galley: &SqliteGalley,
    notifier: &dyn Notifier,
    session_id: &str,
    origin: &Origin,
) {
    if origin.supervisor.as_deref() != Some(ASSISTANT_SUPERVISOR) {
        return;
    }
    match galley
        .subtask_dispatch_for_session(&SessionId(session_id.to_string()))
        .await
    {
        Ok(Some(dispatch)) => notify(
            notifier,
            SUBTASK_DISPATCHED_EVENT,
            &SubtaskDispatchedPayload {
                parent_session_id: dispatch.parent_session_id.clone(),
                dispatches: vec![dispatch],
            },
        ),
        Ok(None) => {}
        Err(e) => eprintln!("[subtask {session_id}] reading its send-backs failed: {e}"),
    }
}

// ---------------- promotion ----------------

/// After the user sent a message in `session_id` through Core's send:
/// a subtask not promoted yet becomes an ordinary conversation, announced
/// as `session-updated-external` ([`VIA_SUBTASK_PROMOTED`]). Only a
/// person's message counts (`via: gui`, desktop or phone), and only one
/// that is not the answer to a pending question — the caller decides that.
pub async fn promote_after_user_send(
    galley: &SqliteGalley,
    notifier: &dyn Notifier,
    session_id: &str,
    origin: &Origin,
) {
    if origin.via != OriginVia::Gui {
        return;
    }
    match galley
        .promote_subtask(&SessionId(session_id.to_string()))
        .await
    {
        Ok(Some(brief)) => announce_session(
            notifier,
            SESSION_UPDATED_EXTERNAL_EVENT,
            brief,
            VIA_SUBTASK_PROMOTED,
        ),
        Ok(None) => {}
        Err(e) => eprintln!("[subtask {session_id}] promotion failed: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tag_is_read_in_order() {
        let reply = "好，交给子任务。\n<subtask>把下载文件夹里的 PDF 分类\n发票一类</subtask>\n\
                     <subtask>  \n </subtask>\n<subtask>查三家报价</subtask>";
        assert_eq!(
            parse_subtask_tags(reply),
            vec![
                SubtaskTag::Instructions("把下载文件夹里的 PDF 分类\n发票一类".into()),
                SubtaskTag::Empty,
                SubtaskTag::Instructions("查三家报价".into()),
            ]
        );
        assert!(parse_subtask_tags("no tags here").is_empty());
    }

    #[test]
    fn an_unclosed_tag_takes_the_rest_and_ends_the_list() {
        assert_eq!(
            parse_subtask_tags("<subtask>a</subtask> then <subtask>half written\n<subtask>b"),
            vec![
                SubtaskTag::Instructions("a".into()),
                SubtaskTag::Unclosed("half written\n<subtask>b".into()),
            ]
        );
        // An opener pairs with the next closer, as the display strips it.
        assert_eq!(
            parse_subtask_tags("<subtask>a <subtask>b</subtask>"),
            vec![SubtaskTag::Instructions("a <subtask>b".into())]
        );
    }

    #[test]
    fn a_tag_quoted_inside_other_blocks_is_not_one() {
        let reply = "<thinking>I will end with <subtask>x</subtask></thinking>\
                     <summary>派了 <subtask>y</subtask></summary>答复。";
        assert!(parse_subtask_tags(reply).is_empty());
    }

    #[test]
    fn the_title_is_the_first_line_without_markdown() {
        assert_eq!(
            subtask_title("把下载文件夹里的 PDF 按内容分类\n用户说……"),
            "把下载文件夹里的 PDF 按内容分类"
        );
        assert_eq!(
            subtask_title("\n\n## **Goal**: sort the PDFs\nmore"),
            "Goal: sort the PDFs"
        );
        assert_eq!(subtask_title("- 查报价"), "查报价");
        let long = "长".repeat(100);
        let title = subtask_title(&long);
        assert!(title.ends_with('…'));
        assert_eq!(title.chars().count(), 81);
        // A first line of markdown only falls through to the next line.
        assert_eq!(subtask_title("##\n真正的标题"), "真正的标题");
    }

    fn dispatch(
        turn_index: i64,
        ordinal: i64,
        session_id: Option<&str>,
        failure: Option<SubtaskFailure>,
        detail: Option<&str>,
    ) -> SubtaskDispatch {
        SubtaskDispatch {
            parent_session_id: "s-main".into(),
            turn_index,
            ordinal,
            message_id: SubtaskDispatch::reply_message_id("s-main", turn_index),
            session_id: session_id.map(str::to_string),
            title: "把 PDF 分类".into(),
            failure,
            failure_detail: detail.map(str::to_string),
            created_at: "t".into(),
            send_backs: 0,
        }
    }

    #[test]
    fn markers_name_the_subtask_or_why_it_did_not_start() {
        assert_eq!(
            replay_marker(&dispatch(3, 0, Some("s-sub-1"), None, None)),
            "[subtask s-sub-1: 把 PDF 分类]"
        );
        assert_eq!(
            replay_marker(&dispatch(3, 1, None, Some(SubtaskFailure::Empty), None)),
            "[subtask not started: the tag was empty]"
        );
        assert_eq!(
            replay_marker(&dispatch(3, 2, None, Some(SubtaskFailure::Unclosed), None)),
            "[subtask not started: the tag was not closed]"
        );
        assert_eq!(
            replay_marker(&dispatch(
                3,
                3,
                None,
                Some(SubtaskFailure::StartFailed),
                Some("database is\nlocked")
            )),
            "[subtask not started: it could not be started (database is locked)]"
        );
        // A row that exists is named, even if its runner did not start:
        // the model can look it up.
        assert_eq!(
            replay_marker(&dispatch(
                3,
                4,
                Some("s-sub-2"),
                Some(SubtaskFailure::StartFailed),
                Some("spawn")
            )),
            "[subtask s-sub-2: 把 PDF 分类]"
        );
    }

    fn row(turn_index: i64, role: &str, content: &str) -> PersistedMessageRow {
        PersistedMessageRow {
            id: format!("msg_s-main_{turn_index}_{role}"),
            session_id: "s-main".into(),
            turn_index,
            sequence: 0,
            role: role.into(),
            content: content.into(),
            tool_calls: None,
            tool_results: None,
            thinking: None,
            final_answer: None,
            summary: None,
            preamble: None,
            created_via: None,
            supervisor: None,
            origin_note: None,
            visibility: "visible".into(),
            telemetry: None,
            created_at: "t".into(),
            attachments: Vec::new(),
        }
    }

    #[test]
    fn the_replay_leaves_instructions_out_and_ends_replies_with_markers() {
        let mut rows = vec![
            row(3, "user", "帮我把下载文件夹的 PDF 分类，再查三家报价 <subtask>x</subtask>"),
            row(
                3,
                "assistant",
                "<summary>派活</summary>好，两件都交出去了。\n<subtask>分类 PDF\n细节</subtask>\n<subtask></subtask>\n",
            ),
            row(4, "user", "谢谢"),
            row(4, "assistant", "不客气。"),
            row(5, "assistant", "提到 <subtask>但没派</subtask>，只剩这句。"),
        ];
        let dispatches = vec![
            dispatch(3, 0, Some("s-sub-1"), None, None),
            dispatch(3, 1, None, Some(SubtaskFailure::Empty), None),
        ];
        mark_rows(&mut rows, &dispatches);
        // A user row is the user's words, left alone.
        assert_eq!(
            rows[0].content,
            "帮我把下载文件夹的 PDF 分类，再查三家报价 <subtask>x</subtask>"
        );
        assert_eq!(
            rows[1].content,
            "<summary>派活</summary>好，两件都交出去了。\n\n\
             [subtask s-sub-1: 把 PDF 分类]\n[subtask not started: the tag was empty]"
        );
        assert!(!rows[1].content.contains("细节"));
        assert_eq!(rows[3].content, "不客气。");
        // Tags with nothing recorded are still left out.
        assert_eq!(rows[4].content, "提到 ，只剩这句。");
    }

    #[test]
    fn a_report_replays_as_its_lines_and_its_reply_stays() {
        let lines =
            "[Galley: subtask s-sub-1 \"把 PDF 分类\" finished — details: session show s-sub-1]";
        let report = |turn: i64, note: &str, summary: Option<&str>| {
            let mut r = row(
                turn,
                "user",
                "[Galley — not a message from the user] 长长的说明",
            );
            r.created_via = Some("system".into());
            r.supervisor = Some(crate::api::SUBTASK_REPORT_SUPERVISOR.into());
            r.origin_note = Some(note.into());
            r.summary = summary.map(str::to_string);
            r
        };
        let mut someone = row(10, "user", "别人发的");
        someone.created_via = Some("cli".into());
        someone.supervisor = Some(crate::api::SUBTASK_REPORT_SUPERVISOR.into());
        let mut rows = vec![
            report(6, "s-sub-1", Some(lines)),
            row(6, "assistant", "<no-reply/>"),
            report(8, "s-sub-2,s-sub-3", None),
            row(8, "assistant", "两件都好了。"),
            row(9, "user", "谢谢"),
            someone,
        ];
        mark_rows(&mut rows, &[]);
        assert_eq!(rows[0].content, lines);
        // The silent reply stays, so user and assistant still pair up.
        assert_eq!(rows[1].content, "<no-reply/>");
        // A row without its lines names the subtasks in its note.
        assert_eq!(
            rows[2].content,
            "[Galley: subtask s-sub-2 has an update — details: session show s-sub-2]\n\
             [Galley: subtask s-sub-3 has an update — details: session show s-sub-3]"
        );
        assert_eq!(rows[3].content, "两件都好了。");
        assert_eq!(rows[4].content, "谢谢");
        // Only Galley's own rows are reports.
        assert_eq!(rows[5].content, "别人发的");
    }

    #[test]
    fn only_an_answer_is_a_final_reply() {
        assert!(is_final_answer(None));
        assert!(is_final_answer(Some("[]")));
        assert!(is_final_answer(Some(
            r#"[{"toolName":"no_tool","args":{}}]"#
        )));
        assert!(!is_final_answer(Some(
            r#"[{"toolName":"ask_user","args":{"question":"q"}}]"#
        )));
        assert!(!is_final_answer(Some(r#"[{"toolName":"code_run"}]"#)));
        assert!(!is_final_answer(Some("not json")));
    }
}
