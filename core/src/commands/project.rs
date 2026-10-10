use super::*;

#[tauri::command]
pub(crate) async fn list_projects(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<Vec<ProjectBrief>, String> {
    galley.list_projects().await.map_err(stringify_error)
}

// Writes go through Core's write path (`crate::session_writes`, ticket
// 02d), which broadcasts each one (`project-*-external`, `via: "gui"`).

#[tauri::command]
pub(crate) async fn create_project(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    input: CreateProjectInput,
    origin: Origin,
) -> std::result::Result<ProjectBrief, String> {
    let notifier = TauriNotifier::new(app);
    Writes::new(&galley, notifier.as_ref(), VIA_GUI)
        .create_project(input, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn update_project(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    id: ProjectId,
    patch: ProjectPatch,
    origin: Origin,
) -> std::result::Result<ProjectBrief, String> {
    let notifier = TauriNotifier::new(app);
    Writes::new(&galley, notifier.as_ref(), VIA_GUI)
        .update_project(id, patch, origin)
        .await
        .map_err(stringify_error)
}

#[tauri::command]
pub(crate) async fn delete_project(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    id: ProjectId,
    origin: Origin,
) -> std::result::Result<(), String> {
    let notifier = TauriNotifier::new(app);
    Writes::new(&galley, notifier.as_ref(), VIA_GUI)
        .delete_project(id, origin)
        .await
        .map(|_| ())
        .map_err(stringify_error)
}
