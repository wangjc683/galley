use crate::args::RuntimeArg;
use crate::client::{call_print, call_value, client, next_watch_frame_strict};
use crate::common::{
    emit_json, parse_status_arg, runtime_arg_for_session_new, runtime_filter, StreamEndPayload,
    SCHEMA_VERSION,
};
use galley_core_lib::api::{
    GalleyApi, MessageBrief, MessageRole, SearchScope, SessionBrief, SessionFilter, SessionId,
    SessionStatus,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
use galley_core_lib::protocol::{
    SessionArchiveArgs, SessionBtwArgs, SessionCheckpointArgs, SessionGoalMasterPlanArgs,
    SessionGoalSoloTurnArgs, SessionGoalSynthesizeArgs, SessionMoveArgs, SessionNewArgs,
    SessionNewGoalWorkerArgs, SessionRestoreArgs, SessionSendArgs, SessionShutdownRunnerArgs,
    SessionStopArgs, WatchFrame,
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
    session: SessionBrief,
    #[serde(skip_serializing_if = "Option::is_none")]
    messages: Option<Vec<MessageBrief>>,
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
    for row in rows {
        emit_json(&row)?;
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
    let brief = galley.session_brief(SessionId(id)).await?;
    emit_json(&brief)?;
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
) -> Result<(SessionBrief, Vec<MessageBrief>), GalleyError> {
    let session_id = SessionId(id.to_string());
    let session = galley.session_brief(session_id.clone()).await?;
    let messages = galley.session_messages(session_id, Some(tail)).await?;
    Ok((session, messages))
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

fn wait_payload(
    phase: &'static str,
    status: Option<&'static str>,
    session: SessionBrief,
    messages: Option<Vec<MessageBrief>>,
) -> SessionWaitPayload {
    SessionWaitPayload {
        schema_version: SCHEMA_VERSION,
        stream: "wait",
        phase,
        status,
        session,
        messages,
    }
}

pub(crate) async fn session_send(
    id: String,
    content: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let result = session_send_value(id, content, supervisor, reason).await?;
    println!("{result}");
    Ok(())
}

pub(crate) async fn session_send_value(
    id: String,
    content: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<serde_json::Value, GalleyError> {
    call_value(SessionSendArgs {
        session_id: id,
        content,
        supervisor,
        reason,
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
                println!("{line}");
                break;
            }
            WatchFrame::Event(_) | WatchFrame::Unparseable(_) => println!("{line}"),
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
) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    let (session, messages) = session_wait_snapshot(&galley, &id, tail).await?;
    let completed = has_agent_output(&messages, after_turn);
    let dead_end = (!completed)
        .then(|| session_wait_dead_end(session.status))
        .flatten();
    emit_json(&wait_payload("initial", None, session, Some(messages)))?;

    if completed || dead_end.is_some() {
        let status = dead_end.unwrap_or("completed");
        let (session, messages) = session_wait_snapshot(&galley, &id, tail).await?;
        emit_json(&wait_payload(
            "final",
            Some(status),
            session,
            final_show.then_some(messages),
        ))?;
        emit_json(&StreamEndPayload {
            schema_version: SCHEMA_VERSION,
            stream: "end",
            reason: status,
        })?;
        return Ok(());
    }

    let timeout = Duration::from_secs(timeout);
    let poll = Duration::from_secs(poll.max(1));
    let started_at = Instant::now();

    loop {
        let elapsed = started_at.elapsed();
        if elapsed >= timeout {
            let (session, messages) = session_wait_snapshot(&galley, &id, tail).await?;
            emit_json(&wait_payload(
                "final",
                Some("timed_out"),
                session,
                Some(messages),
            ))?;
            emit_json(&StreamEndPayload {
                schema_version: SCHEMA_VERSION,
                stream: "end",
                reason: "timeout",
            })?;
            return Ok(());
        }

        tokio::time::sleep(poll.min(timeout.saturating_sub(elapsed))).await;
        let (session, messages) = session_wait_snapshot(&galley, &id, tail).await?;
        if has_agent_output(&messages, after_turn) {
            emit_json(&wait_payload(
                "final",
                Some("completed"),
                session,
                final_show.then_some(messages),
            ))?;
            emit_json(&StreamEndPayload {
                schema_version: SCHEMA_VERSION,
                stream: "end",
                reason: "completed",
            })?;
            return Ok(());
        }
        // A session that died (error / cancelled) will never produce the
        // awaited output — report the terminal state now instead of
        // burning the remaining deadline.
        if let Some(status) = session_wait_dead_end(session.status) {
            emit_json(&wait_payload(
                "final",
                Some(status),
                session,
                final_show.then_some(messages),
            ))?;
            emit_json(&StreamEndPayload {
                schema_version: SCHEMA_VERSION,
                stream: "end",
                reason: status,
            })?;
            return Ok(());
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

pub(crate) async fn session_new_goal_worker_value(
    task_template: String,
    project: Option<String>,
    llm: Option<String>,
    runtime: RuntimeArg,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<serde_json::Value, GalleyError> {
    let runtime_kind = runtime_arg_for_session_new(runtime)?;
    call_value(SessionNewGoalWorkerArgs {
        task_template,
        project_id: project,
        llm_name: llm,
        runtime_kind,
        supervisor,
        reason,
    })
    .await
}

pub(crate) async fn session_goal_synthesize_value(
    id: String,
    visible_content: String,
    dispatch_content: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<serde_json::Value, GalleyError> {
    call_value(SessionGoalSynthesizeArgs {
        session_id: id,
        visible_content,
        dispatch_content,
        supervisor,
        reason,
    })
    .await
}

pub(crate) async fn session_goal_master_plan_value(
    id: String,
    dispatch_content: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<serde_json::Value, GalleyError> {
    call_value(SessionGoalMasterPlanArgs {
        session_id: id,
        dispatch_content,
        supervisor,
        reason,
    })
    .await
}

/// Dispatch a visible solo-Goal working turn, spawning the session's runner
/// if it isn't alive. See `dispatch_session_goal_solo_turn` in Core.
pub(crate) async fn session_goal_solo_turn_value(
    id: String,
    dispatch_content: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<serde_json::Value, GalleyError> {
    call_value(SessionGoalSoloTurnArgs {
        session_id: id,
        dispatch_content,
        supervisor,
        reason,
    })
    .await
}

pub(crate) async fn session_checkpoint_value(
    id: String,
    content: String,
    goal_id: Option<String>,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<serde_json::Value, GalleyError> {
    call_value(SessionCheckpointArgs {
        session_id: id,
        content,
        goal_id,
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

pub(crate) async fn session_shutdown_runner_value(
    id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<serde_json::Value, GalleyError> {
    call_value(SessionShutdownRunnerArgs {
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
            attachments: Vec::new(),
            origin: None,
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
