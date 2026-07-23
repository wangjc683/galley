//! Goal-turn session commands: `session.goal_synthesize`,
//! `session.goal_master_plan`, and `session.goal_solo_turn`. All three
//! persist a message and then **ensure a runner is spawned** before
//! dispatching — a Goal session has no runner until the controller
//! drives it, so a bare `session.send` would only pile persisted
//! messages onto a dead session. They differ in what stays visible in
//! the user thread.

use super::common::{map_galley_err, origin_from_args, SocketResponseLite};
use super::session_cmds::{emit_user_message_persisted, RunnerSpawnedExternalPayload};
use super::spawn_config::spawn_args_for_session_new;
use super::*;

pub(super) async fn dispatch_session_goal_synthesize(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionGoalSynthesizeArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.goal_synthesize args: {e}"),
            );
        }
    };
    let visible_content = parsed.visible_content.trim().to_string();
    if visible_content.is_empty() {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "session.goal_synthesize: visibleContent is empty",
        );
    }
    let dispatch_content = parsed.dispatch_content.trim().to_string();
    if dispatch_content.is_empty() {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "session.goal_synthesize: dispatchContent is empty",
        );
    }

    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor.clone(), parsed.reason.clone());
    let session_id = SessionId(parsed.session_id.clone());
    let brief = match galley
        .send_message(session_id, visible_content.clone(), origin)
        .await
    {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };

    if let Err(e) =
        ensure_goal_synthesis_runner(&galley, ctx, &parsed.session_id, "session.goal_synthesize")
            .await
    {
        emit_user_message_persisted(ctx, &parsed.session_id, &brief, "persisted_only");
        return e.with_request_id(request_id);
    }

    match ctx
        .runner
        .send_command(
            &parsed.session_id,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: dispatch_content,
                images: vec![],
                visibility: None,
                absolute_turn_index: brief.turn_index.map(i64::from),
            }),
        )
        .await
    {
        Ok(()) => {
            emit_user_message_persisted(ctx, &parsed.session_id, &brief, "dispatched");
            SocketResponse::ok(
                request_id,
                serde_json::json!({
                    "message": brief,
                    "dispatch": "dispatched",
                }),
            )
        }
        Err(e) => {
            emit_user_message_persisted(ctx, &parsed.session_id, &brief, "persisted_only");
            SocketResponse::err(
                request_id,
                ErrorTag::RunnerError,
                format!("session.goal_synthesize runner dispatch: {e}"),
            )
        }
    }
}

pub(super) async fn dispatch_session_goal_master_plan(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionGoalMasterPlanArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.goal_master_plan args: {e}"),
            );
        }
    };
    let dispatch_content = parsed.dispatch_content.trim().to_string();
    if dispatch_content.is_empty() {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "session.goal_master_plan: dispatchContent is empty",
        );
    }

    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor.clone(), parsed.reason.clone());
    let session_id = SessionId(parsed.session_id.clone());
    let brief = match galley
        .send_message_with_visibility(
            session_id,
            dispatch_content.clone(),
            origin,
            MessageVisibility::Internal,
        )
        .await
    {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };

    if let Err(e) =
        ensure_goal_synthesis_runner(&galley, ctx, &parsed.session_id, "session.goal_master_plan")
            .await
    {
        return e.with_request_id(request_id);
    }

    let absolute_turn_index = brief.turn_index.map(i64::from).ok_or_else(|| {
        SocketResponseLite::runner_error("session.goal_master_plan missing turn_index")
    });
    let absolute_turn_index = match absolute_turn_index {
        Ok(v) => v,
        Err(e) => return e.with_request_id(request_id),
    };

    match ctx
        .runner
        .send_command(
            &parsed.session_id,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: dispatch_content,
                images: vec![],
                visibility: Some("internal".to_string()),
                absolute_turn_index: Some(absolute_turn_index),
            }),
        )
        .await
    {
        Ok(()) => SocketResponse::ok(
            request_id,
            serde_json::json!({
                "message": brief,
                "dispatch": "dispatched",
            }),
        ),
        Err(e) => SocketResponse::err(
            request_id,
            ErrorTag::RunnerError,
            format!("session.goal_master_plan runner dispatch: {e}"),
        ),
    }
}

/// Solo-Goal working turn. The "keep going" nudge is **internal** (persisted
/// hidden, no GUI mirror) — it is scaffolding, not conversation — but the
/// agent turn it drives is **visible**: solo progress renders in the user
/// thread with the same step markers / tool callouts / streaming as a normal
/// session. Kept as a distinct command from `session.goal_master_plan`
/// (which hides the whole turn) for naming clarity and isolation.
///
/// Unlike `session.send` (best-effort to an already-live runner), this
/// **ensures the runner is spawned** first: a solo session has no runner until
/// the controller drives it, so a bare `session.send` would only pile
/// persisted messages onto a dead session (the original tight-loop bug).
/// Persist internal → spawn runner → dispatch visible.
pub(super) async fn dispatch_session_goal_solo_turn(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: SessionGoalSoloTurnArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("session.goal_solo_turn args: {e}"),
            );
        }
    };
    let dispatch_content = parsed.dispatch_content.trim().to_string();
    if dispatch_content.is_empty() {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            "session.goal_solo_turn: dispatchContent is empty",
        );
    }

    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor.clone(), parsed.reason.clone());
    let session_id = SessionId(parsed.session_id.clone());
    // Internal — the nudge and the turn it drives stay out of the user thread.
    let brief = match galley
        .send_message_with_visibility(
            session_id,
            dispatch_content.clone(),
            origin,
            MessageVisibility::Internal,
        )
        .await
    {
        Ok(b) => b,
        Err(e) => return map_galley_err(request_id, e),
    };

    if let Err(e) =
        ensure_goal_synthesis_runner(&galley, ctx, &parsed.session_id, "session.goal_solo_turn")
            .await
    {
        return e.with_request_id(request_id);
    }

    let absolute_turn_index = match brief.turn_index.map(i64::from) {
        Some(v) => v,
        None => {
            return SocketResponseLite::runner_error("session.goal_solo_turn missing turn_index")
                .with_request_id(request_id);
        }
    };

    match ctx
        .runner
        .send_command(
            &parsed.session_id,
            &IpcCommand::UserMessage(UserMessageCommand {
                text: dispatch_content,
                images: vec![],
                // Visible: the working turn renders in the user thread; only
                // the nudge row above stays internal.
                visibility: None,
                absolute_turn_index: Some(absolute_turn_index),
            }),
        )
        .await
    {
        Ok(()) => SocketResponse::ok(
            request_id,
            serde_json::json!({
                "message": brief,
                "dispatch": "dispatched",
            }),
        ),
        Err(e) => SocketResponse::err(
            request_id,
            ErrorTag::RunnerError,
            format!("session.goal_solo_turn runner dispatch: {e}"),
        ),
    }
}

async fn ensure_goal_synthesis_runner(
    galley: &SqliteGalley,
    ctx: &HandlerCtx<'_>,
    session_id: &str,
    via: &'static str,
) -> Result<(), SocketResponseLite> {
    if ctx.runner.pid(session_id).await.is_some() {
        return Ok(());
    }

    let session = galley
        .session_brief(SessionId(session_id.to_string()))
        .await
        .map_err(SocketResponseLite::from_err)?;
    let spawn_args = spawn_args_for_session_new(
        galley,
        ctx.app,
        session_id,
        session.project_id.as_ref().map(|id| id.as_str()),
        session.selected_llm_index,
        session.selected_llm_key.clone(),
        session.ga_runtime_kind,
    )
    .await?;
    let pid = ctx
        .runner
        .spawn(spawn_args, Some(session_id))
        .await
        .map_err(SocketResponseLite::runner_spawn_error)?;
    let rx = ctx.runner.subscribe(session_id).await.ok_or_else(|| {
        SocketResponseLite::runner_error(
            "session.goal_synthesize runner subscribe failed after spawn",
        )
    })?;
    ctx.notify(
        "runner-spawned-external",
        &RunnerSpawnedExternalPayload {
            session_id: session_id.to_string(),
            pid,
            via,
        },
    );
    spawn_emit_task(ctx.notifier.clone(), session_id.to_string(), rx);
    Ok(())
}
