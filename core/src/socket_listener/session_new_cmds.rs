//! `session.new` and `session.new_goal_worker`: atomically create a
//! session + persist its first user message, then spawn a runner and
//! dispatch that first message. The DB writes commit together; runner
//! failures after commit surface as `runner_error` so callers know the
//! delegated task did not actually start.

use super::common::{map_galley_err, origin_from_args};
use super::llm_cmds::resolve_llm_selection;
use super::session_cmds::{
    emit_user_message_persisted, mint_session_id, RunnerSpawnedExternalPayload,
    SessionExternalPayload,
};
use super::spawn_config::spawn_args_for_session_new;
use super::*;

/// Default title for `session.new` — matches the GUI's localized seed
/// so a CLI-created row + a GUI-created row look identical in the
/// sidebar. The bridge derives a better title after the first turn ends.
const DEFAULT_NEW_SESSION_TITLE: &str = "新对话";

#[derive(Debug)]
enum SessionNewTaskSource {
    Literal(String),
    GoalWorkerTemplate(String),
}

impl SessionNewTaskSource {
    fn render(self, session_id: &str) -> Result<String, String> {
        match self {
            SessionNewTaskSource::Literal(task) => Ok(task),
            SessionNewTaskSource::GoalWorkerTemplate(template) => {
                render_goal_worker_task_template(&template, session_id)
            }
        }
    }
}

pub(super) fn render_goal_worker_task_template(
    template: &str,
    session_id: &str,
) -> Result<String, String> {
    let placeholder_count = template.matches(GOAL_WORKER_SESSION_ID_PLACEHOLDER).count();
    if placeholder_count != 1 {
        return Err(format!(
            "session.new_goal_worker: taskTemplate must contain exactly one {GOAL_WORKER_SESSION_ID_PLACEHOLDER} placeholder"
        ));
    }
    Ok(template.replace(GOAL_WORKER_SESSION_ID_PLACEHOLDER, session_id))
}

struct SessionNewRequest {
    task_source: SessionNewTaskSource,
    project_id: Option<String>,
    llm_name: Option<String>,
    runtime_kind: Option<RuntimeKind>,
    supervisor: Option<String>,
    reason: Option<String>,
    command_name: &'static str,
}

pub(super) async fn dispatch_session_new(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionNewArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.new args: {e}"),
            );
        }
    };
    let task = parsed.task.trim().to_string();
    if task.is_empty() {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "session.new: task is empty",
        );
    }
    dispatch_session_new_inner(
        request_id,
        SessionNewRequest {
            task_source: SessionNewTaskSource::Literal(task),
            project_id: parsed.project_id,
            llm_name: parsed.llm_name,
            runtime_kind: parsed.runtime_kind,
            supervisor: parsed.supervisor,
            reason: parsed.reason,
            command_name: "session.new",
        },
        ctx,
    )
    .await
}

pub(super) async fn dispatch_session_new_goal_worker(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionNewGoalWorkerArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.new_goal_worker args: {e}"),
            );
        }
    };
    let template = parsed.task_template.trim().to_string();
    if template.is_empty() {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "session.new_goal_worker: taskTemplate is empty",
        );
    }
    if let Err(message) = render_goal_worker_task_template(&template, "s-validation") {
        return SocketResponse::err(request_id, ErrorTag::InvalidArgs, message);
    }
    dispatch_session_new_inner(
        request_id,
        SessionNewRequest {
            task_source: SessionNewTaskSource::GoalWorkerTemplate(template),
            project_id: parsed.project_id,
            llm_name: parsed.llm_name,
            runtime_kind: parsed.runtime_kind,
            supervisor: parsed.supervisor,
            reason: parsed.reason,
            command_name: "session.new_goal_worker",
        },
        ctx,
    )
    .await
}

async fn dispatch_session_new_inner(
    request_id: Option<String>,
    request: SessionNewRequest,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let SessionNewRequest {
        task_source,
        project_id,
        llm_name,
        runtime_kind,
        supervisor,
        reason,
        command_name,
    } = request;
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };

    let active_runtime_kind = match galley.active_runtime_kind().await {
        Ok(kind) => kind,
        Err(e) => return map_galley_err(request_id, e),
    };
    let target_runtime_kind = runtime_kind.unwrap_or(active_runtime_kind);
    let runtime_warning = runtime_kind
        .filter(|requested| *requested != active_runtime_kind)
        .map(|requested| {
            serde_json::json!({
                "id": "non_current_runtime",
                "message": "session created outside the current GUI runtime",
                "currentRuntimeKind": active_runtime_kind,
                "requestedRuntimeKind": requested,
            })
        });

    // Resolve --llm=<name> against the selected runtime's current model
    // source. Managed runtime resolves Galley model records; external
    // runtime resolves the cached raw GA LLM list.
    let llm_selection = match resolve_llm_selection(&galley, llm_name, target_runtime_kind).await {
        Ok(selection) => selection,
        Err(resp) => return resp.with_request_id(request_id),
    };

    let id = mint_session_id();
    let task = match task_source.render(&id) {
        Ok(task) => task.trim().to_string(),
        Err(message) => return SocketResponse::err(request_id, ErrorTag::InvalidArgs, message),
    };
    if task.is_empty() {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            format!("{command_name}: rendered task is empty"),
        );
    }
    let spawn_args = match spawn_args_for_session_new(
        &galley,
        ctx.app,
        &id,
        project_id.as_deref(),
        llm_selection.index,
        llm_selection.key.clone(),
        target_runtime_kind,
    )
    .await
    {
        Ok(args) => args,
        Err(resp) => return resp.with_request_id(request_id),
    };

    let input = CreateSessionInput {
        id: id.clone(),
        title: DEFAULT_NEW_SESSION_TITLE.to_string(),
        project_id,
        selected_llm_index: llm_selection.index,
        selected_llm_key: llm_selection.key,
        selected_llm_display_name: llm_selection.display_name,
        ga_runtime_kind: Some(target_runtime_kind),
        ga_runtime_id: None,
        prompt_profile: None,
    };
    let origin = origin_from_args(supervisor.clone(), reason.clone());

    // BEGIN — create + send_message in one transaction (sub-plan O1).
    let mut tx = match galley.begin_tx().await {
        Ok(t) => t,
        Err(e) => return map_galley_err(request_id, e),
    };
    let brief = match galley
        .create_session_in_tx(&mut tx, input, origin.clone())
        .await
    {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };
    let msg = match galley
        .send_message_in_tx(&mut tx, SessionId(brief.id.0.clone()), task.clone(), origin)
        .await
    {
        Ok(m) => m,
        Err(e) => return map_galley_err(request_id, e),
    };
    if let Err(e) = tx.commit().await {
        return SocketResponse::err(
            request_id,
            ErrorTag::Internal,
            format!("{command_name} commit: {e}"),
        );
    }

    // Notify GUI early so the sidebar can show the session while we
    // start the runner. The first message event is emitted below after
    // we know whether it actually reached the bridge.
    ctx.notify(
        "session-created-external",
        &SessionExternalPayload {
            session: brief.clone(),
            via: command_name,
        },
    );

    let pid = match ctx.runner.spawn(spawn_args, Some(&brief.id.0)).await {
        Ok(pid) => pid,
        Err(e) => {
            emit_user_message_persisted(ctx, &brief.id.0, &msg, "spawn_failed");
            return SocketResponse::err(
                request_id,
                ErrorTag::RunnerError,
                format!("{command_name} runner spawn: {e}"),
            );
        }
    };

    let Some(rx) = ctx.runner.subscribe(&brief.id.0).await else {
        emit_user_message_persisted(ctx, &brief.id.0, &msg, "spawn_failed");
        return SocketResponse::err(
            request_id,
            ErrorTag::RunnerError,
            format!("{command_name} runner subscribe failed after spawn"),
        );
    };
    ctx.notify(
        "runner-spawned-external",
        &RunnerSpawnedExternalPayload {
            session_id: brief.id.0.clone(),
            pid,
            via: command_name,
        },
    );
    spawn_emit_task(ctx.notifier.clone(), brief.id.0.clone(), rx);

    match ctx
        .runner
        .send_command(
            &brief.id.0,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: task,
                images: vec![],
                visibility: None,
                absolute_turn_index: msg.turn_index.map(i64::from),
            }),
        )
        .await
    {
        Ok(()) => {}
        Err(e) => {
            emit_user_message_persisted(ctx, &brief.id.0, &msg, "spawn_failed");
            return SocketResponse::err(
                request_id,
                ErrorTag::RunnerError,
                format!("{command_name} runner dispatch: {e}"),
            );
        }
    }

    emit_user_message_persisted(ctx, &brief.id.0, &msg, "dispatched");

    let mut result = serde_json::json!({
        "session": brief,
        "message": msg,
        "dispatch": "dispatched",
    });
    if let Some(warning) = runtime_warning {
        result["warning"] = warning;
    }
    SocketResponse::ok(request_id, result)
}
