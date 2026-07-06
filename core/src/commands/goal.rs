use super::*;

#[tauri::command]
pub(crate) async fn list_active_goals(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<Vec<GoalBrief>, String> {
    galley.list_active_goals().await.map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn list_visible_goals(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<Vec<GoalBrief>, String> {
    galley.list_visible_goals().await.map_err(stringify_error)
}

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

/// Worker-session orientation: which Goal this session works for and
/// its latest owned task. `None` for sessions that never claimed a goal
/// task (normal sessions and masters). Drives the worker context bar.
#[tauri::command]
pub(crate) async fn goal_context_for_session(
    galley: State<'_, SqliteGalley>,
    session_id: SessionId,
) -> std::result::Result<Option<GoalWorkerContext>, String> {
    galley
        .goal_worker_context(&session_id)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn goal_status(
    galley: State<'_, SqliteGalley>,
    id: GoalId,
) -> std::result::Result<GoalStatusSnapshot, String> {
    galley.goal_status(id).await.map_err(stringify_error)
}

/// True when the goal's scratch workspace exists and holds at least one
/// file (P3). Drives the TopBar "open output folder" affordance so it is
/// hidden for purely textual goals whose workspace was never written to.
#[tauri::command]
pub(crate) async fn goal_workspace_has_files(
    galley: State<'_, SqliteGalley>,
    id: GoalId,
) -> std::result::Result<bool, String> {
    let goal = galley.goal_status(id).await.map_err(stringify_error)?.goal;
    let Some(path) = goal.workspace_path else {
        return Ok(false);
    };
    Ok(dir_has_any_file(std::path::Path::new(&path)))
}

/// Shallow-recursive check for at least one regular file under `root`.
/// Returns false on a missing dir or any read error (best-effort gate).
fn dir_has_any_file(root: &std::path::Path) -> bool {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                return true;
            }
        }
    }
    false
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

#[tauri::command]
pub(crate) async fn request_goal_stop(
    galley: State<'_, SqliteGalley>,
    id: GoalId,
) -> std::result::Result<GoalBrief, String> {
    galley
        .request_goal_stop(id, Origin::gui())
        .await
        .map_err(stringify_error)
}
