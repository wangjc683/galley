use tauri::Emitter;

use crate::api::SCHEDULED_TASKS_CHANGED_EVENT;

use super::*;

/// Best-effort change broadcast after a successful write. The GUI
/// refetches on this event; the DB stays authoritative, so a missed
/// emit only delays another window's view, never corrupts it. The
/// scheduler loop (02) emits the same event when it stamps a fire.
fn emit_changed(app: &tauri::AppHandle) {
    let _ = app.emit(SCHEDULED_TASKS_CHANGED_EVENT, ());
}

#[tauri::command]
pub(crate) async fn list_scheduled_tasks(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<Vec<ScheduledTaskBrief>, String> {
    galley.list_scheduled_tasks().await.map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn create_scheduled_task(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    input: CreateScheduledTaskInput,
    origin: Origin,
) -> std::result::Result<ScheduledTaskBrief, String> {
    let brief = galley
        .create_scheduled_task(input, origin)
        .await
        .map_err(stringify_error)?;
    emit_changed(&app);
    Ok(brief)
}

#[tauri::command]
pub(crate) async fn update_scheduled_task(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    id: ScheduledTaskId,
    patch: ScheduledTaskPatch,
    origin: Origin,
) -> std::result::Result<ScheduledTaskBrief, String> {
    let brief = galley
        .update_scheduled_task(id, patch, origin)
        .await
        .map_err(stringify_error)?;
    emit_changed(&app);
    Ok(brief)
}

#[tauri::command]
pub(crate) async fn delete_scheduled_task(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    id: ScheduledTaskId,
    origin: Origin,
) -> std::result::Result<(), String> {
    galley
        .delete_scheduled_task(id, origin)
        .await
        .map_err(stringify_error)?;
    emit_changed(&app);
    Ok(())
}
