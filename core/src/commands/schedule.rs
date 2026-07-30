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

/// Read-only preview for the create/edit form: what would saving a task
/// with these form values do? For an existing task (`task_id` set) the
/// preview runs against its real baseline (`created_at` /
/// `last_fired_at`), so "moving today's already-fired 09:00 to 14:00
/// fires again today" is predicted truthfully; a new task's baseline is
/// now, matching create semantics. `enabled` is forced on — the preview
/// answers "what does this rule do", the row communicates paused state.
#[tauri::command]
pub(crate) async fn preview_scheduled_fire(
    galley: State<'_, SqliteGalley>,
    repeat: crate::api::schedule::ScheduledTaskRepeat,
    time_of_day: String,
    task_id: Option<ScheduledTaskId>,
) -> std::result::Result<crate::api::schedule::FirePreview, String> {
    let repeat = repeat.normalized().map_err(stringify_error)?;
    let now = chrono::Local::now();
    let base = match task_id {
        Some(id) => galley
            .list_scheduled_tasks()
            .await
            .map_err(stringify_error)?
            .into_iter()
            .find(|t| t.id == id),
        None => None,
    };
    let now_iso = crate::api::schedule::instant_to_utc_iso(&now);
    let brief = ScheduledTaskBrief {
        id: ScheduledTaskId("sched_preview".into()),
        project_id: None,
        prompt: String::new(),
        repeat,
        time_of_day,
        llm_name: None,
        enabled: true,
        last_fired_at: base.as_ref().and_then(|t| t.last_fired_at.clone()),
        last_run_session_id: None,
        next_fire_at: None,
        created_at: base
            .as_ref()
            .map(|t| t.created_at.clone())
            .unwrap_or_else(|| now_iso.clone()),
        updated_at: now_iso,
    };
    crate::scheduler::preview_fire(&brief, &chrono::Local, &now).map_err(stringify_error)
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
