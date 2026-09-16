use super::*;
use crate::goal_engine::{GoalEngine, GoalStartResult};
use crate::notify::TauriNotifier;
use crate::runner_manager::RunnerManager;
use crate::socket_listener::{DbSource, HandlerCtx};
use tauri::AppHandle;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartSessionGoalInput {
    session_id: SessionId,
    objective: String,
    /// `None` = no time ceiling. The GUI passes its preset explicitly.
    #[serde(default)]
    budget_seconds: Option<u32>,
}

/// Set a goal on a session and dispatch its opening turn (goal v2,
/// `crate::goal_engine`). The persisted objective row is also announced
/// through `user-message-persisted`, so the GUI mirrors it the same way
/// it mirrors a CLI send.
#[tauri::command]
pub(crate) async fn start_session_goal(
    galley: State<'_, SqliteGalley>,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
    app: AppHandle,
    input: StartSessionGoalInput,
) -> std::result::Result<GoalStartResult, String> {
    let db = DbSource::Pool(galley.inner().clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: manager.inner().as_ref(),
        notifier: TauriNotifier::new(app.clone()),
        app: Some(&app),
    };
    GoalEngine {
        galley: galley.inner(),
        ctx: &ctx,
    }
    .start(
        input.session_id,
        input.objective,
        input.budget_seconds,
        Origin::gui(),
    )
    .await
    .map_err(stringify_error)
}

/// Open goals (active / paused / blocked), oldest first.
#[tauri::command]
pub(crate) async fn list_active_goals(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<Vec<GoalBrief>, String> {
    galley.list_active_goals().await.map_err(stringify_error)
}

/// Open goals plus unseen terminal results — the pill / sidebar list.
#[tauri::command]
pub(crate) async fn list_visible_goals(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<Vec<GoalBrief>, String> {
    galley.list_visible_goals().await.map_err(stringify_error)
}

/// Every goal ever set on the session (any status) — powers the
/// in-thread commission / terminal markers.
#[tauri::command]
pub(crate) async fn list_goals_for_session(
    galley: State<'_, SqliteGalley>,
    session_id: SessionId,
) -> std::result::Result<Vec<GoalBrief>, String> {
    galley
        .list_goals_for_session(session_id)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn goal_status(
    galley: State<'_, SqliteGalley>,
    id: GoalId,
) -> std::result::Result<GoalBrief, String> {
    galley.get_goal(id).await.map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn mark_goal_result_seen(
    galley: State<'_, SqliteGalley>,
    id: GoalId,
) -> std::result::Result<GoalBrief, String> {
    galley
        .mark_goal_result_seen(id, Origin::gui())
        .await
        .map_err(stringify_error)
}

/// Give a goal more time (goal v2 budget policy, 2026-09-16): reopens a
/// `budget_limited` goal and dispatches its next continuation, or raises
/// an `active` goal's ceiling.
#[tauri::command]
pub(crate) async fn extend_goal(
    galley: State<'_, SqliteGalley>,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
    app: AppHandle,
    id: GoalId,
    extra_seconds: u32,
) -> std::result::Result<GoalBrief, String> {
    let db = DbSource::Pool(galley.inner().clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: manager.inner().as_ref(),
        notifier: TauriNotifier::new(app.clone()),
        app: Some(&app),
    };
    GoalEngine {
        galley: galley.inner(),
        ctx: &ctx,
    }
    .extend(id, extra_seconds)
    .await
    .map_err(stringify_error)
}

/// Stop a goal: terminal `stopped`, then abort the session's in-flight
/// run. No wrap-up turn.
#[tauri::command]
pub(crate) async fn request_goal_stop(
    galley: State<'_, SqliteGalley>,
    manager: State<'_, std::sync::Arc<RunnerManager>>,
    app: AppHandle,
    id: GoalId,
) -> std::result::Result<GoalBrief, String> {
    let db = DbSource::Pool(galley.inner().clone());
    let ctx = HandlerCtx {
        db: &db,
        runner: manager.inner().as_ref(),
        notifier: TauriNotifier::new(app.clone()),
        app: Some(&app),
    };
    GoalEngine {
        galley: galley.inner(),
        ctx: &ctx,
    }
    .stop(id)
    .await
    .map_err(stringify_error)
}
