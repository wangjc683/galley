//! Goal v2 socket commands (schemaVersion 2): `goal.start` /
//! `goal.status` / `goal.active` / `goal.stop`. Thin wrappers over
//! [`crate::goal_engine::GoalEngine`] — the same engine the Tauri
//! commands in `commands/goal.rs` call, so the CLI and the GUI cannot
//! drift. Error tags follow the shared `GalleyError` mapping.

use super::common::{map_galley_err, origin_from_args};
use super::*;
use crate::api::GoalId;
use crate::goal_engine::GoalEngine;

pub(super) async fn dispatch_goal_start(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: GoalStartArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("goal.start args: {e}"),
            );
        }
    };
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    let origin = origin_from_args(parsed.supervisor.clone(), parsed.reason.clone());
    let engine = GoalEngine {
        galley: &galley,
        ctx,
    };
    match engine
        .start(
            SessionId(parsed.session_id),
            parsed.objective,
            parsed.budget_seconds,
            origin,
        )
        .await
    {
        Ok(result) => SocketResponse::ok(request_id, serde_json::json!(result)),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_goal_status(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: GoalStatusArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("goal.status args: {e}"),
            );
        }
    };
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    match galley.get_goal(GoalId(parsed.goal_id)).await {
        Ok(goal) => SocketResponse::ok(request_id, serde_json::json!({ "goal": goal })),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_goal_active(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    // Args are an empty object today; parse anyway so a future additive
    // filter lands on a typed struct.
    if let Err(e) = serde_json::from_value::<GoalActiveArgs>(args) {
        return SocketResponse::err(
            request_id,
            ErrorTag::InvalidArgs,
            format!("goal.active args: {e}"),
        );
    }
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    match galley.list_active_goals().await {
        Ok(goals) => SocketResponse::ok(request_id, serde_json::json!(goals)),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_goal_stop(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: GoalStopArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("goal.stop args: {e}"),
            );
        }
    };
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    let engine = GoalEngine {
        galley: &galley,
        ctx,
    };
    match engine.stop(GoalId(parsed.goal_id)).await {
        Ok(goal) => SocketResponse::ok(request_id, serde_json::json!({ "goal": goal })),
        Err(e) => map_galley_err(request_id, e),
    }
}

pub(super) async fn dispatch_goal_extend(
    request_id: Option<String>,
    args: Value,
    ctx: &HandlerCtx<'_>,
) -> SocketResponse {
    let parsed: GoalExtendArgs = match serde_json::from_value(args) {
        Ok(a) => a,
        Err(e) => {
            return SocketResponse::err(
                request_id,
                ErrorTag::InvalidArgs,
                format!("goal.extend args: {e}"),
            );
        }
    };
    let galley = match ctx.db.get().await {
        Ok(g) => g,
        Err(e) => {
            return SocketResponse::err(request_id, ErrorTag::DbUnavailable, format!("open: {e}"));
        }
    };
    let engine = GoalEngine {
        galley: &galley,
        ctx,
    };
    match engine
        .extend(GoalId(parsed.goal_id), parsed.extra_seconds)
        .await
    {
        Ok(goal) => SocketResponse::ok(request_id, serde_json::json!({ "goal": goal })),
        Err(e) => map_galley_err(request_id, e),
    }
}
