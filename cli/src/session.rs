use crate::args::RuntimeArg;
use crate::common::{
    emit_json, parse_status_arg, runtime_arg_for_session_new, runtime_filter, StreamEndPayload,
    SCHEMA_VERSION,
};
use crate::transport::{
    map_error_tag, open_watch_lines, read_watch_frame, socket_send_recv, unary_command,
    unary_command_value, WatchFrame,
};
use galley_core_lib::api::{
    GalleyApi, MessageBrief, MessageRole, SearchScope, SessionBrief, SessionFilter, SessionId,
    SessionStatus,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
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
    let req = serde_json::json!({
        "command": "session.send",
        "args": {
            "sessionId": id,
            "content": content,
            "supervisor": supervisor,
            "reason": reason,
        },
        "schemaVersion": SCHEMA_VERSION,
    });
    let resp_line = socket_send_recv(req).await?;
    let parsed: serde_json::Value =
        serde_json::from_str(&resp_line).map_err(|e| GalleyError::Internal {
            message: format!("malformed socket response: {e}"),
        })?;
    if parsed["ok"] == serde_json::Value::Bool(true) {
        Ok(parsed["result"].clone())
    } else {
        let tag = parsed["error"].as_str().unwrap_or("internal");
        let msg = parsed["message"].as_str().unwrap_or("").to_string();
        Err(map_error_tag(tag, msg))
    }
}

pub(crate) async fn session_watch(id: String) -> Result<(), GalleyError> {
    let mut lines = open_watch_lines(&id).await?;
    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|e| GalleyError::DbUnavailable {
            message: format!("watch read: {e}"),
        })?
    {
        let parsed: serde_json::Value =
            serde_json::from_str(&line).unwrap_or(serde_json::Value::Null);
        if parsed["ok"] == serde_json::Value::Bool(false) {
            let tag = parsed["error"].as_str().unwrap_or("internal");
            let msg = parsed["message"].as_str().unwrap_or("").to_string();
            return Err(map_error_tag(tag, msg));
        }
        // Print stream frames as-is; agents stream-parse the NDJSON. Initial
        // error envelopes are mapped above so CLI errors keep one shape.
        println!("{line}");
        if parsed["stream"] == "end" {
            break;
        }
    }
    Ok(())
}

pub(crate) async fn session_follow(id: String, tail: usize) -> Result<(), GalleyError> {
    let galley = SqliteGalley::open().await?;
    emit_json(&session_snapshot_payload(&galley, &id, "initial", tail).await?)?;

    let mut lines = match open_watch_lines(&id).await {
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
        match read_watch_frame(&mut lines).await {
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
    let req = serde_json::json!({
        "command": "session.new",
        "args": {
            "task": task,
            "projectId": project,
            "llmName": llm,
            "runtimeKind": runtime_kind,
            "supervisor": supervisor,
            "reason": reason,
        },
        "schemaVersion": SCHEMA_VERSION,
    });
    unary_command(req).await
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
    let req = serde_json::json!({
        "command": "session.new_goal_worker",
        "args": {
            "taskTemplate": task_template,
            "projectId": project,
            "llmName": llm,
            "runtimeKind": runtime_kind,
            "supervisor": supervisor,
            "reason": reason,
        },
        "schemaVersion": SCHEMA_VERSION,
    });
    unary_command_value(req).await
}

pub(crate) async fn session_goal_synthesize_value(
    id: String,
    visible_content: String,
    dispatch_content: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<serde_json::Value, GalleyError> {
    let req = serde_json::json!({
        "command": "session.goal_synthesize",
        "args": {
            "sessionId": id,
            "visibleContent": visible_content,
            "dispatchContent": dispatch_content,
            "supervisor": supervisor,
            "reason": reason,
        },
        "schemaVersion": SCHEMA_VERSION,
    });
    unary_command_value(req).await
}

pub(crate) async fn session_goal_master_plan_value(
    id: String,
    dispatch_content: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<serde_json::Value, GalleyError> {
    let req = serde_json::json!({
        "command": "session.goal_master_plan",
        "args": {
            "sessionId": id,
            "dispatchContent": dispatch_content,
            "supervisor": supervisor,
            "reason": reason,
        },
        "schemaVersion": SCHEMA_VERSION,
    });
    unary_command_value(req).await
}

pub(crate) async fn session_checkpoint_value(
    id: String,
    content: String,
    goal_id: Option<String>,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<serde_json::Value, GalleyError> {
    let req = serde_json::json!({
        "command": "session.checkpoint",
        "args": {
            "sessionId": id,
            "content": content,
            "goalId": goal_id,
            "supervisor": supervisor,
            "reason": reason,
        },
        "schemaVersion": SCHEMA_VERSION,
    });
    unary_command_value(req).await
}

pub(crate) async fn session_btw(
    id: String,
    question: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let req = serde_json::json!({
        "command": "session.btw",
        "args": {
            "sessionId": id,
            "question": question,
            "supervisor": supervisor,
            "reason": reason,
        },
        "schemaVersion": SCHEMA_VERSION,
    });
    unary_command(req).await
}

pub(crate) async fn session_stop(
    id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let req = serde_json::json!({
        "command": "session.stop",
        "args": {
            "sessionId": id,
            "supervisor": supervisor,
            "reason": reason,
        },
        "schemaVersion": SCHEMA_VERSION,
    });
    unary_command(req).await
}

pub(crate) async fn session_shutdown_runner_value(
    id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<serde_json::Value, GalleyError> {
    let req = serde_json::json!({
        "command": "session.shutdown_runner",
        "args": {
            "sessionId": id,
            "supervisor": supervisor,
            "reason": reason,
        },
        "schemaVersion": SCHEMA_VERSION,
    });
    unary_command_value(req).await
}

pub(crate) async fn session_archive(
    id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let req = serde_json::json!({
        "command": "session.archive",
        "args": {
            "sessionId": id,
            "supervisor": supervisor,
            "reason": reason,
        },
        "schemaVersion": SCHEMA_VERSION,
    });
    unary_command(req).await
}

pub(crate) async fn session_restore(
    id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let req = serde_json::json!({
        "command": "session.restore",
        "args": {
            "sessionId": id,
            "supervisor": supervisor,
            "reason": reason,
        },
        "schemaVersion": SCHEMA_VERSION,
    });
    unary_command(req).await
}

pub(crate) async fn session_move(
    id: String,
    to: Option<String>,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let req = serde_json::json!({
        "command": "session.move",
        "args": {
            "sessionId": id,
            "to": to,
            "supervisor": supervisor,
            "reason": reason,
        },
        "schemaVersion": SCHEMA_VERSION,
    });
    unary_command(req).await
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
