use crate::args::RuntimeArg;
use crate::client::{call_print, call_value, client, next_watch_frame_strict};
use crate::common::{
    emit_json, emit_line, parse_status_arg, probe_live_states, runtime_arg_for_session_new,
    runtime_filter, with_live, StreamEndPayload, SCHEMA_VERSION,
};
use galley_core_lib::api::{
    GalleyApi, MessageBrief, MessageRole, SearchScope, SessionBrief, SessionFilter, SessionId,
    SessionStatus,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
use galley_core_lib::protocol::{
    SessionArchiveArgs, SessionBtwArgs, SessionMoveArgs, SessionNewArgs, SessionRestoreArgs,
    SessionSendArgs, SessionStopArgs, WatchFrame,
};
use serde::Serialize;
use serde_json::Value;
use std::time::{Duration, Instant};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionSnapshotPayload {
    schema_version: u32,
    stream: &'static str,
    phase: &'static str,
    session: SessionBrief,
    messages: Vec<MessageBrief>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEventPayload {
    schema_version: u32,
    stream: &'static str,
    session_id: String,
    data: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionWaitPayload {
    schema_version: u32,
    stream: &'static str,
    phase: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<&'static str>,
    /// The `SessionBrief` with the CLI-attached `live` object, exactly as
    /// `session brief` prints it (`live` absent when Core is unreachable).
    session: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    messages: Option<Vec<MessageBrief>>,
}

/// One poll of a waited-on session: the persisted rows plus Galley
/// Core's live run state (`None` when Core is unreachable).
struct WaitSnapshot {
    session: SessionBrief,
    messages: Vec<MessageBrief>,
    live: Option<Value>,
}

pub(crate) async fn sessions_list(
    runtime: RuntimeArg,
    project: Option<String>,
    status: Option<String>,
    archived: bool,
    all: bool,
) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let archived_flag = if all {
        None
    } else if archived {
        Some(true)
    } else {
        Some(false)
    };
    let filter = SessionFilter {
        project_id: project,
        status: status.as_deref().map(parse_status_arg).transpose()?,
        archived: archived_flag,
        runtime_kind: runtime_filter(&galley, runtime).await?,
    };
    let rows = galley.list_sessions(filter).await?;
    // One bulk probe for the whole page: `live` tells the Supervisor
    // which rows are actually mid-run, which the persisted `status`
    // column cannot (it never reads `running`).
    let ids: Vec<String> = rows.iter().map(|row| row.id.0.clone()).collect();
    let live = probe_live_states(Some(ids)).await;
    for row in rows {
        let live_row = live.as_ref().and_then(|map| map.get(&row.id.0));
        emit_json(&with_live(&row, live_row)?)?;
    }
    Ok(())
}

pub(crate) async fn sessions_search(
    runtime: RuntimeArg,
    query: String,
    all: bool,
) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let scope = if all {
        SearchScope::All
    } else {
        SearchScope::Active
    };
    let runtime_kind = runtime_filter(&galley, runtime).await?;
    let hits = galley.search_messages(query, scope, runtime_kind).await?;
    for hit in hits {
        emit_json(&hit)?;
    }
    Ok(())
}

pub(crate) async fn session_brief(id: String) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let brief = galley.session_brief(SessionId(id.clone())).await?;
    let live = probe_live_states(Some(vec![id.clone()])).await;
    let live_row = live.as_ref().and_then(|map| map.get(&id));
    emit_json(&with_live(&brief, live_row)?)?;
    Ok(())
}

pub(crate) async fn session_show(id: String, tail: Option<usize>) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let msgs = galley.session_messages(SessionId(id), tail).await?;
    for m in msgs {
        emit_json(&m)?;
    }
    Ok(())
}

async fn session_snapshot_payload(
    galley: &SqliteGalley,
    id: &str,
    phase: &'static str,
    tail: usize,
) -> Result<SessionSnapshotPayload, GalleyError> {
    let session_id = SessionId(id.to_string());
    let session = galley.session_brief(session_id.clone()).await?;
    let messages = galley.session_messages(session_id, Some(tail)).await?;
    Ok(SessionSnapshotPayload {
        schema_version: SCHEMA_VERSION,
        stream: "snapshot",
        phase,
        session,
        messages,
    })
}

async fn session_wait_snapshot(
    galley: &SqliteGalley,
    id: &str,
    tail: usize,
) -> Result<WaitSnapshot, GalleyError> {
    // Probe Core before reading SQLite: rows read after an "ended"
    // verdict are at least as new as that verdict.
    let live = probe_live_states(Some(vec![id.to_string()]))
        .await
        .and_then(|mut map| map.remove(id));
    let session_id = SessionId(id.to_string());
    let session = galley.session_brief(session_id.clone()).await?;
    let messages = galley.session_messages(session_id, Some(tail)).await?;
    Ok(WaitSnapshot {
        session,
        messages,
        live,
    })
}

fn has_agent_output(messages: &[MessageBrief], after_turn: Option<u32>) -> bool {
    messages.iter().any(|message| {
        message.role == MessageRole::Agent
            && after_turn.is_none_or(|threshold| {
                message
                    .turn_index
                    .is_some_and(|turn_index| turn_index >= threshold)
            })
            && (!message.content.trim().is_empty()
                || message
                    .final_answer
                    .as_deref()
                    .is_some_and(|answer| !answer.trim().is_empty()))
    })
}

/// Whether a poll ends the wait as `completed` (docs/agent-api
/// session-commands.md §5.5d). Default: the output condition alone.
/// `--until-idle` (galley#30) also needs Core to report that no run is
/// open or in progress, so a mid-run step with content does not pass for
/// the result. A pending ask_user question reads as ended (its run
/// closed); a draining queue keeps `openRun` true across its runs. With
/// Core unreachable (`live` is `None`) that poll falls back to the output
/// condition alone.
fn wait_completed(
    messages: &[MessageBrief],
    after_turn: Option<u32>,
    until_idle: bool,
    live: Option<&Value>,
) -> bool {
    has_agent_output(messages, after_turn) && (!until_idle || live.is_none_or(live_run_ended))
}

/// `live.openRun` and `live.agentRunning` both false. `askPending` and
/// `queuedCount` are deliberately not consulted: a held queue behind a
/// question keeps `busy` true, yet nothing will run until it is answered.
fn live_run_ended(live: &Value) -> bool {
    let flag = |key: &str| live.get(key).and_then(Value::as_bool).unwrap_or(false);
    !flag("openRun") && !flag("agentRunning")
}

/// How long `--until-idle` waits before confirming a run it saw ended.
/// Assistant rows are persisted when the GUI handles `turn_end` (routed
/// through Core), slightly after Core has already closed the run on
/// `run_complete`; the grace lets that final row land. The re-check also
/// rides over the brief gap between runs when a Goal continuation or a
/// queued message is dispatched. Best effort, not a guarantee.
const UNTIL_IDLE_GRACE: Duration = Duration::from_secs(1);

/// What one wait poll decides.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WaitVerdict {
    /// Not done yet: run the dead-end check, then keep polling.
    Pending,
    /// Done: end the wait as `completed`.
    Completed,
    /// `--until-idle` saw output and an ended run with Core reachable:
    /// wait [`UNTIL_IDLE_GRACE`], read again, and complete only if that
    /// second read still passes ([`confirm_completed`]).
    Confirm,
}

fn wait_verdict(
    messages: &[MessageBrief],
    after_turn: Option<u32>,
    until_idle: bool,
    live: Option<&Value>,
) -> WaitVerdict {
    if !wait_completed(messages, after_turn, until_idle, live) {
        WaitVerdict::Pending
    } else if until_idle && live.is_some() {
        WaitVerdict::Confirm
    } else {
        // Default mode, or `--until-idle` with Core unreachable (the
        // output-only fallback): no grace.
        WaitVerdict::Completed
    }
}

/// The second read of a [`WaitVerdict::Confirm`]: still output past
/// `--after-turn` and the run still ended (a Goal continuation or the
/// next queued run may have reserved the gate in the meantime).
fn confirm_completed(
    messages: &[MessageBrief],
    after_turn: Option<u32>,
    live: Option<&Value>,
) -> bool {
    wait_completed(messages, after_turn, true, live)
}

/// Carry out a [`WaitVerdict::Confirm`]: sleep the grace, re-probe and
/// re-read. Returns the final frame's status and snapshot (built from
/// this second read) when the wait should end — confirmed, or the
/// session died meanwhile — and `None` to keep polling.
async fn confirm_until_idle(
    galley: &SqliteGalley,
    id: &str,
    tail: usize,
    after_turn: Option<u32>,
) -> Result<Option<(&'static str, WaitSnapshot)>, GalleyError> {
    tokio::time::sleep(UNTIL_IDLE_GRACE).await;
    let snapshot = session_wait_snapshot(galley, id, tail).await?;
    Ok(
        if confirm_completed(&snapshot.messages, after_turn, snapshot.live.as_ref()) {
            Some(("completed", snapshot))
        } else {
            session_wait_dead_end(snapshot.session.status).map(|status| (status, snapshot))
        },
    )
}

/// Terminal session states that can no longer produce new output —
/// waiting the full deadline on them is pure burn. Returns the wait
/// status/end reason. Additive (docs/agent-api.md §5.5d).
fn session_wait_dead_end(status: SessionStatus) -> Option<&'static str> {
    match status {
        SessionStatus::Error => Some("session_error"),
        SessionStatus::Cancelled => Some("session_cancelled"),
        _ => None,
    }
}

/// Emit the final wait frame and the stream end frame.
fn finish_wait(
    status: &'static str,
    reason: &'static str,
    snapshot: WaitSnapshot,
    show_messages: bool,
) -> Result<(), GalleyError> {
    emit_json(&wait_payload(
        "final",
        Some(status),
        snapshot,
        show_messages,
    )?)?;
    emit_json(&StreamEndPayload {
        schema_version: SCHEMA_VERSION,
        stream: "end",
        reason,
    })
}

fn wait_payload(
    phase: &'static str,
    status: Option<&'static str>,
    snapshot: WaitSnapshot,
    show_messages: bool,
) -> Result<SessionWaitPayload, GalleyError> {
    Ok(SessionWaitPayload {
        schema_version: SCHEMA_VERSION,
        stream: "wait",
        phase,
        status,
        session: with_live(&snapshot.session, snapshot.live.as_ref())?,
        messages: show_messages.then_some(snapshot.messages),
    })
}

pub(crate) async fn session_send(
    id: String,
    content: String,
    supervisor: Option<String>,
    reason: Option<String>,
    jump: bool,
) -> Result<(), GalleyError> {
    let result = session_send_value(id, content, supervisor, reason, jump).await?;
    emit_line(&result.to_string());
    Ok(())
}

pub(crate) async fn session_send_value(
    id: String,
    content: String,
    supervisor: Option<String>,
    reason: Option<String>,
    jump: bool,
) -> Result<serde_json::Value, GalleyError> {
    call_value(SessionSendArgs {
        session_id: id,
        content,
        supervisor,
        reason,
        jump,
    })
    .await
}

pub(crate) async fn session_watch(id: String) -> Result<(), GalleyError> {
    let mut lines = client().open_watch(&id).await?;
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("watch read: {e}"),
        })?
    {
        // LENIENT policy: print stream frames as-is and keep going —
        // agents stream-parse the NDJSON themselves, so even an
        // Unparseable line is theirs to see (frozen behavior). Only an
        // error envelope terminates with a mapped CLI error.
        match WatchFrame::parse(&line) {
            WatchFrame::Error { tag, message } => {
                return Err(crate::client::galley_error_for_tag(tag, message));
            }
            WatchFrame::End(_) => {
                emit_line(&line);
                break;
            }
            WatchFrame::Event(_) | WatchFrame::Unparseable(_) => emit_line(&line),
        }
    }
    Ok(())
}

pub(crate) async fn session_follow(id: String, tail: usize) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    emit_json(&session_snapshot_payload(&galley, &id, "initial", tail).await?)?;

    let mut lines = match client().open_watch(&id).await {
        Ok(lines) => lines,
        Err(GalleyError::DbUnavailable { .. }) => {
            emit_json(&StreamEndPayload {
                schema_version: SCHEMA_VERSION,
                stream: "end",
                reason: "core_unavailable",
            })?;
            return Ok(());
        }
        Err(e) => return Err(e),
    };

    loop {
        match next_watch_frame_strict(&mut lines).await {
            Ok(Some(WatchFrame::Event(data))) => emit_json(&SessionEventPayload {
                schema_version: SCHEMA_VERSION,
                stream: "event",
                session_id: id.clone(),
                data,
            })?,
            Ok(Some(WatchFrame::End(reason))) => {
                let galley = SqliteGalley::open().await?;
                emit_json(&session_snapshot_payload(&galley, &id, "final", tail).await?)?;
                emit_json(&StreamEndPayload {
                    schema_version: SCHEMA_VERSION,
                    stream: "end",
                    reason: &reason,
                })?;
                return Ok(());
            }
            Ok(Some(WatchFrame::Error { .. } | WatchFrame::Unparseable(_))) => {
                unreachable!("next_watch_frame_strict surfaces these as Err")
            }
            Ok(None) => {
                let galley = SqliteGalley::open().await?;
                emit_json(&session_snapshot_payload(&galley, &id, "final", tail).await?)?;
                emit_json(&StreamEndPayload {
                    schema_version: SCHEMA_VERSION,
                    stream: "end",
                    reason: "socket_closed",
                })?;
                return Ok(());
            }
            Err(GalleyError::NotFound { .. }) => {
                emit_json(&StreamEndPayload {
                    schema_version: SCHEMA_VERSION,
                    stream: "end",
                    reason: "not_live",
                })?;
                return Ok(());
            }
            Err(e) => return Err(e),
        }
    }
}

pub(crate) async fn session_wait(
    id: String,
    timeout: u64,
    poll: u64,
    tail: usize,
    final_show: bool,
    after_turn: Option<u32>,
    until_idle: bool,
) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let snapshot = session_wait_snapshot(&galley, &id, tail).await?;
    let verdict = wait_verdict(
        &snapshot.messages,
        after_turn,
        until_idle,
        snapshot.live.as_ref(),
    );
    let dead_end = (verdict == WaitVerdict::Pending)
        .then(|| session_wait_dead_end(snapshot.session.status))
        .flatten();
    emit_json(&wait_payload("initial", None, snapshot, true)?)?;

    if verdict == WaitVerdict::Completed || dead_end.is_some() {
        let status = dead_end.unwrap_or("completed");
        let snapshot = session_wait_snapshot(&galley, &id, tail).await?;
        return finish_wait(status, status, snapshot, final_show);
    }

    let timeout = Duration::from_secs(timeout);
    let poll = Duration::from_secs(poll.max(1));
    // Started before any `--until-idle` grace, so the grace spends the
    // `--timeout` budget: the wait ends at most one grace past it.
    let started_at = Instant::now();

    if verdict == WaitVerdict::Confirm {
        if let Some((status, snapshot)) = confirm_until_idle(&galley, &id, tail, after_turn).await?
        {
            return finish_wait(status, status, snapshot, final_show);
        }
    }

    loop {
        let elapsed = started_at.elapsed();
        if elapsed >= timeout {
            let snapshot = session_wait_snapshot(&galley, &id, tail).await?;
            return finish_wait("timed_out", "timeout", snapshot, true);
        }

        tokio::time::sleep(poll.min(timeout.saturating_sub(elapsed))).await;
        let snapshot = session_wait_snapshot(&galley, &id, tail).await?;
        let ended = match wait_verdict(
            &snapshot.messages,
            after_turn,
            until_idle,
            snapshot.live.as_ref(),
        ) {
            WaitVerdict::Completed => Some(("completed", snapshot)),
            WaitVerdict::Confirm => confirm_until_idle(&galley, &id, tail, after_turn).await?,
            // A session that died (error / cancelled) will never produce
            // the awaited output — report the terminal state now instead
            // of burning the remaining deadline.
            WaitVerdict::Pending => {
                session_wait_dead_end(snapshot.session.status).map(|status| (status, snapshot))
            }
        };
        if let Some((status, snapshot)) = ended {
            return finish_wait(status, status, snapshot, final_show);
        }
    }
}

pub(crate) async fn session_new(
    task: String,
    project: Option<String>,
    llm: Option<String>,
    runtime: RuntimeArg,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let runtime_kind = runtime_arg_for_session_new(runtime)?;
    call_print(SessionNewArgs {
        task,
        project_id: project,
        llm_name: llm,
        runtime_kind,
        supervisor,
        reason,
    })
    .await
}

pub(crate) async fn session_btw(
    id: String,
    question: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    call_print(SessionBtwArgs {
        session_id: id,
        question,
        supervisor,
        reason,
    })
    .await
}

pub(crate) async fn session_stop(
    id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    call_print(SessionStopArgs {
        session_id: id,
        supervisor,
        reason,
    })
    .await
}

pub(crate) async fn session_archive(
    id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    call_print(SessionArchiveArgs {
        session_id: id,
        supervisor,
        reason,
    })
    .await
}

pub(crate) async fn session_restore(
    id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    call_print(SessionRestoreArgs {
        session_id: id,
        supervisor,
        reason,
    })
    .await
}

pub(crate) async fn session_move(
    id: String,
    to: Option<String>,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    call_print(SessionMoveArgs {
        session_id: id,
        to,
        supervisor,
        reason,
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent_message(turn_index: Option<u32>, content: &str) -> MessageBrief {
        MessageBrief {
            id: galley_core_lib::api::MessageId("m1".into()),
            session_id: SessionId("s1".into()),
            turn_index,
            role: MessageRole::Agent,
            content: content.into(),
            summary: None,
            final_answer: None,
            created_at: "2026-07-03T00:00:00Z".into(),
            visibility: None,
            goal_id: None,
            attachments: Vec::new(),
            origin: None,
            ask_user: None,
        }
    }

    #[test]
    fn wait_completion_respects_after_turn_baseline() {
        // A previous turn's answer must not satisfy a send→wait pair
        // that asked for output at or after a later turn.
        let stale = vec![agent_message(Some(3), "previous answer")];
        assert!(has_agent_output(&stale, None));
        assert!(!has_agent_output(&stale, Some(4)));
        let fresh = vec![
            agent_message(Some(3), "previous answer"),
            agent_message(Some(4), "new answer"),
        ];
        assert!(has_agent_output(&fresh, Some(4)));
        // Messages without a turn index can't prove freshness.
        assert!(!has_agent_output(&[agent_message(None, "x")], Some(1)));
    }

    fn live(open_run: bool, agent_running: bool, ask_pending: bool, queued: u32) -> Value {
        serde_json::json!({
            "runnerAlive": true,
            "agentRunning": agent_running,
            "openRun": open_run,
            "queuedCount": queued,
            "busy": open_run || agent_running || queued > 0,
            "askPending": ask_pending,
            "lastExit": null,
        })
    }

    #[test]
    fn default_wait_ignores_live_state() {
        // Without --until-idle the output condition alone decides, even
        // while Core says the run is still going (unchanged behaviour).
        let step = vec![agent_message(Some(4), "<summary>step 1</summary>")];
        let running = live(true, true, false, 0);
        assert!(wait_completed(&step, Some(4), false, Some(&running)));
        assert!(wait_completed(&step, Some(4), false, None));
        assert!(!wait_completed(&[], Some(4), false, None));
    }

    #[test]
    fn until_idle_needs_output_and_an_ended_run() {
        let step = vec![agent_message(Some(4), "<summary>step 1</summary>")];
        // (openRun, agentRunning) → completes?
        for (open_run, agent_running, expected) in [
            (true, true, false),
            (true, false, false), // between two steps of one run
            (false, true, false),
            (false, false, true),
        ] {
            let state = live(open_run, agent_running, false, 0);
            assert_eq!(
                wait_completed(&step, Some(4), true, Some(&state)),
                expected,
                "openRun={open_run} agentRunning={agent_running}"
            );
        }
        // An ended run without fresh output is still not a result.
        let idle = live(false, false, false, 0);
        assert!(!wait_completed(&[], Some(4), true, Some(&idle)));
        let stale = vec![agent_message(Some(3), "previous answer")];
        assert!(!wait_completed(&stale, Some(4), true, Some(&idle)));
    }

    #[test]
    fn until_idle_treats_a_pending_question_as_ended() {
        // The run ended on ask_user and two messages are held behind the
        // question: busy is true, but nothing runs until it is answered.
        let asked = vec![agent_message(Some(4), "Which option?")];
        let asking = live(false, false, true, 2);
        assert_eq!(asking["busy"], true);
        assert!(wait_completed(&asked, Some(4), true, Some(&asking)));
        // A draining queue keeps openRun true across its runs.
        let draining = live(true, false, false, 1);
        assert!(!wait_completed(&asked, Some(4), true, Some(&draining)));
    }

    #[test]
    fn until_idle_falls_back_to_output_when_core_is_unreachable() {
        let step = vec![agent_message(Some(4), "<summary>step 1</summary>")];
        assert!(wait_completed(&step, Some(4), true, None));
        assert!(!wait_completed(&[], Some(4), true, None));
    }

    #[test]
    fn until_idle_with_core_reachable_confirms_before_completing() {
        let step = vec![agent_message(Some(4), "<summary>step 1</summary>")];
        let ended = live(false, false, false, 0);
        let running = live(true, true, false, 0);
        // First read ended with Core reachable → re-check after the grace.
        assert_eq!(
            wait_verdict(&step, Some(4), true, Some(&ended)),
            WaitVerdict::Confirm
        );
        // A pending question is an ended run too.
        let asking = live(false, false, true, 2);
        assert_eq!(
            wait_verdict(&step, Some(4), true, Some(&asking)),
            WaitVerdict::Confirm
        );
        assert_eq!(
            wait_verdict(&step, Some(4), true, Some(&running)),
            WaitVerdict::Pending
        );
        assert_eq!(
            wait_verdict(&[], Some(4), true, Some(&ended)),
            WaitVerdict::Pending
        );
        // No grace in default mode or in the Core-unreachable fallback.
        assert_eq!(
            wait_verdict(&step, Some(4), false, Some(&running)),
            WaitVerdict::Completed
        );
        assert_eq!(
            wait_verdict(&step, Some(4), false, None),
            WaitVerdict::Completed
        );
        assert_eq!(
            wait_verdict(&step, Some(4), true, None),
            WaitVerdict::Completed
        );
    }

    #[test]
    fn until_idle_second_read_decides() {
        let step = vec![agent_message(Some(4), "<summary>step 1</summary>")];
        let done = vec![
            agent_message(Some(4), "<summary>step 1</summary>"),
            agent_message(Some(5), "final answer"),
        ];
        // Still ended (and the late final row landed): complete.
        let ended = live(false, false, false, 0);
        assert!(confirm_completed(&done, Some(4), Some(&ended)));
        // A Goal continuation / the next queued run reserved the gate
        // during the grace: keep polling.
        let reopened = live(true, false, false, 0);
        assert!(!confirm_completed(&done, Some(4), Some(&reopened)));
        assert!(!confirm_completed(
            &step,
            Some(4),
            Some(&live(false, true, false, 0))
        ));
        // Core went away between the reads: output-only fallback.
        assert!(confirm_completed(&step, Some(4), None));
        assert!(!confirm_completed(&[], Some(4), None));
    }

    #[test]
    fn wait_dead_end_maps_terminal_states_only() {
        assert_eq!(
            session_wait_dead_end(SessionStatus::Error),
            Some("session_error")
        );
        assert_eq!(
            session_wait_dead_end(SessionStatus::Cancelled),
            Some("session_cancelled")
        );
        assert_eq!(session_wait_dead_end(SessionStatus::Running), None);
        assert_eq!(session_wait_dead_end(SessionStatus::Idle), None);
        assert_eq!(session_wait_dead_end(SessionStatus::Completed), None);
    }
}
