use super::*;

// Writes go through Core's write path (`crate::session_writes`, ticket
// 02d), which broadcasts `scheduled-tasks:changed` through the
// `Notifier` after each successful one — best effort: the GUI refetches
// on it and the DB stays authoritative, so a missed event only delays
// another page's view, never corrupts it. The scheduler loop emits the
// same event, through the same seam, when it stamps a fire.

/// The tasks that are not cancelled (the list the desktop shows). With
/// `all` (main chat ticket 33, optional), cancelled ones too — for the
/// cards that say "cancelled".
#[tauri::command]
pub(crate) async fn list_scheduled_tasks(
    galley: State<'_, SqliteGalley>,
    all: Option<bool>,
) -> std::result::Result<Vec<ScheduledTaskBrief>, String> {
    let scope = if all.unwrap_or(false) {
        crate::db::ScheduleListScope::All
    } else {
        crate::db::ScheduleListScope::Live
    };
    galley
        .list_scheduled_tasks_in(scope)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn create_scheduled_task(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    input: CreateScheduledTaskInput,
    origin: Origin,
) -> std::result::Result<ScheduledTaskBrief, String> {
    let notifier = TauriNotifier::new(app);
    Writes::new(&galley, notifier.as_ref(), VIA_GUI)
        .create_scheduled_task(input, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn update_scheduled_task(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    id: ScheduledTaskId,
    patch: ScheduledTaskPatch,
    origin: Origin,
) -> std::result::Result<ScheduledTaskBrief, String> {
    let notifier = TauriNotifier::new(app);
    Writes::new(&galley, notifier.as_ref(), VIA_GUI)
        .update_scheduled_task(id, patch, origin)
        .await
        .map_err(stringify_error)
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
        fire_at: None,
        target: Default::default(),
        last_due_at: None,
        last_wake: None,
        origin: None,
        created_in: None,
        cancelled_at: None,
        cancelled_by: None,
        todo_id: None,
        created_at: base
            .as_ref()
            .map(|t| t.created_at.clone())
            .unwrap_or_else(|| now_iso.clone()),
        updated_at: now_iso,
    };
    crate::scheduler::preview_fire(&brief, &chrono::Local, &now).map_err(stringify_error)
}

/// Manual "run now" (issue 13). Thin shell over
/// `scheduler::run_task_now`, which fires through the production
/// scheduled path — the row's live update comes from the
/// `scheduled-tasks:changed` emit inside `fire`, so there is nothing
/// to return here.
#[tauri::command]
pub(crate) async fn run_scheduled_task_now(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    id: ScheduledTaskId,
) -> std::result::Result<(), String> {
    crate::scheduler::run_task_now(&app, &galley, id.as_str())
        .await
        .map_err(stringify_error)
}

/// Cancels the task (a soft delete since main chat ticket 33): the row
/// stays with `cancelledAt`, the desktop's list no longer shows it.
#[tauri::command]
pub(crate) async fn delete_scheduled_task(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    id: ScheduledTaskId,
    origin: Origin,
) -> std::result::Result<(), String> {
    let notifier = TauriNotifier::new(app);
    Writes::new(&galley, notifier.as_ref(), VIA_GUI)
        .delete_scheduled_task(id, origin)
        .await
        .map_err(stringify_error)
}

/// The assistant's to-do list (main chat ticket 37, regrouped by ticket
/// 39): the user's to-dos (today, later, any time), what Galley is on,
/// the routines, what was done lately, and the 「今天 N」 count — the
/// desktop's 「待办」 on the managed runtime. Read-only; the page reads it
/// again on the events that change it (`todos:changed`,
/// `scheduled-tasks:changed`, `subtask-dispatched`, `session-run-state`,
/// session updates). The same read feeds the main chat's 「在办的事」
/// (ticket 36), so both show one list in one order.
#[tauri::command]
pub(crate) async fn list_assistant_todo(
    galley: State<'_, SqliteGalley>,
    manager: State<'_, std::sync::Arc<crate::runner_manager::RunnerManager>>,
) -> std::result::Result<crate::assistant_todo::AssistantTodo, String> {
    crate::assistant_todo::assistant_todo(&galley, &manager, chrono::Utc::now())
        .await
        .map_err(stringify_error)
}

/// The to-dos Galley noted in the main chat, every one (main chat ticket
/// 43): not done, done however long ago, cancelled — the cards under the
/// replies that noted them, which stay where 已完成 lets a to-do go. In the
/// order they were noted, each as `list_assistant_todo` words it, with
/// `cancelledAt` on a cancelled one. Read-only; empty on the external
/// runtime and before there is a main chat. The page reads it with
/// `list_assistant_todo`, on the same events.
#[tauri::command]
pub(crate) async fn list_noted_todos(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<Vec<crate::assistant_todo::TodoItem>, String> {
    crate::assistant_todo::noted_todos(&galley, chrono::Utc::now())
        .await
        .map_err(stringify_error)
}

// ---------------- to-dos (main chat ticket 39) ----------------
//
// The desktop's three direct actions on a to-do (PRD ruling 91 point 3):
// tick it off, untick it, cancel its reminder. Everything else the user
// says to Galley, which writes through the CLI. Each is the user at the
// desktop (`Origin::desktop()`: `done_via = 'gui'`), goes through Core's
// write path, broadcasts `todos:changed` (and `scheduled-tasks:changed`
// when a reminder moved), and returns the to-do as it now stands. Errors
// are Core's JSON (`not_found` for a to-do cancelled or gone, or without a
// reminder to cancel).

/// Tick a to-do off. Its reminder is cancelled while it has not reached
/// the assistant.
#[tauri::command]
pub(crate) async fn complete_todo(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    id: crate::api::TodoId,
) -> std::result::Result<crate::api::TodoBrief, String> {
    let notifier = TauriNotifier::new(app);
    Writes::new(&galley, notifier.as_ref(), VIA_GUI)
        .complete_todo(&id, Origin::desktop())
        .await
        .map_err(stringify_error)
}

/// Untick a to-do. A reminder the tick cancelled stays cancelled.
#[tauri::command]
pub(crate) async fn reopen_todo(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    id: crate::api::TodoId,
) -> std::result::Result<crate::api::TodoBrief, String> {
    let notifier = TauriNotifier::new(app);
    Writes::new(&galley, notifier.as_ref(), VIA_GUI)
        .reopen_todo(&id, Origin::desktop())
        .await
        .map_err(stringify_error)
}

/// Cancel a to-do's reminder; the to-do stays as it is.
#[tauri::command]
pub(crate) async fn cancel_todo_reminder(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    id: crate::api::TodoId,
) -> std::result::Result<crate::api::TodoBrief, String> {
    let notifier = TauriNotifier::new(app);
    Writes::new(&galley, notifier.as_ref(), VIA_GUI)
        .cancel_todo_reminder(&id, Origin::desktop())
        .await
        .map_err(stringify_error)
}
