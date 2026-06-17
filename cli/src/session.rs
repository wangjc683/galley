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
    GalleyApi, MessageBrief, SearchScope, SessionBrief, SessionFilter, SessionId,
};
use galley_core_lib::db::SqliteGalley;
use galley_core_lib::error::GalleyError;
use serde::Serialize;
use serde_json::Value;

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

pub(crate) async fn session_copy_to_native(
    id: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let req = serde_json::json!({
        "command": "session.copy_to_native",
        "args": {
            "sessionId": id,
            "supervisor": supervisor,
            "reason": reason,
        },
        "schemaVersion": SCHEMA_VERSION,
    });
    unary_command(req).await
}

pub(crate) async fn session_approval_response(
    id: String,
    approval_id: String,
    decision: String,
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<(), GalleyError> {
    let req = serde_json::json!({
        "command": "session.approval_response",
        "args": {
            "sessionId": id,
            "approvalId": approval_id,
            "decision": decision,
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
        println!("{}", parsed["result"]);
        Ok(())
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
    supervisor: Option<String>,
    reason: Option<String>,
) -> Result<serde_json::Value, GalleyError> {
    let req = serde_json::json!({
        "command": "session.checkpoint",
        "args": {
            "sessionId": id,
            "content": content,
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
