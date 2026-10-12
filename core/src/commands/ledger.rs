use super::*;
use crate::ledger::control::{self, LedgerControl, MemoryOverview, SwitchChange};
use crate::ledger::{
    emit_memory_changed, paths_for_app, read_switch, LedgerExclusion, LedgerSwitch, LedgerTarget,
    RunReport, Trigger,
};

// Affairs ledger (.scratch/main-chat/issues/01-affairs-ledger.md) and the
// Memory page (ticket 04). Not part of the Agent API. The page's
// commands answer the error identifiers of `crate::ledger::control`
// (`managed_only`, `ledger_busy`, `not_found`, `changed_on_disk`) as
// bare strings; the GUI words them. Every change the page shows is
// followed by `memory-changed`.

/// Mark (`excluded: true`) or unmark one session or project as "not used
/// to understand me". `target` is `{"kind": "session" | "project", "id"}`.
/// Stored whatever the runtime and the switch.
#[tauri::command]
pub(crate) async fn set_ledger_excluded(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    target: LedgerTarget,
    excluded: bool,
) -> std::result::Result<(), String> {
    galley
        .set_ledger_excluded(&target, excluded)
        .await
        .map_err(stringify_error)?;
    emit_memory_changed(&app);
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_ledger_exclusions(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<Vec<LedgerExclusion>, String> {
    galley
        .list_ledger_exclusions()
        .await
        .map_err(stringify_error)
}

/// Run the mining now, whatever the day's schedule says; resolves when
/// the run has settled. `ledger_off` while the switch is not on.
#[tauri::command]
pub(crate) async fn run_ledger_now(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<RunReport, String> {
    if !read_switch(&galley).await.is_on() {
        return Err(control::LEDGER_OFF.into());
    }
    Ok(crate::ledger::run_for_app(&app, &galley, Trigger::Manual).await)
}

fn ledger_paths(app: &tauri::AppHandle) -> std::result::Result<crate::ledger::LedgerPaths, String> {
    paths_for_app(app).map_err(|e| format!("managed state root: {e}"))
}

/// The switch alone (the main chat's one-time question).
#[tauri::command]
pub(crate) async fn get_ledger_switch(
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<LedgerSwitch, String> {
    control::get_switch(&galley).await
}

/// Everything the Memory page shows.
#[tauri::command]
pub(crate) async fn get_memory_overview(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<MemoryOverview, String> {
    control::require_managed(&galley).await?;
    let paths = ledger_paths(&app)?;
    LedgerControl::global()
        .overview(&galley, &paths, chrono::Utc::now(), &chrono::Local)
        .await
}

/// `{action: "enable", lookBack}` or `{action: "disable", clear}`.
/// Switching off while a run is going stops it first and resolves once
/// it has settled.
#[tauri::command]
pub(crate) async fn set_ledger_switch(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    action: String,
    look_back: Option<bool>,
    clear: Option<bool>,
) -> std::result::Result<LedgerSwitch, String> {
    control::require_managed(&galley).await?;
    let change = match action.as_str() {
        "enable" => SwitchChange::Enable {
            look_back: look_back.unwrap_or(false),
        },
        "disable" => SwitchChange::Disable {
            clear: clear.unwrap_or(false),
        },
        other => return Err(format!("unknown action {other:?}: enable | disable")),
    };
    let paths = ledger_paths(&app)?;
    let switch = LedgerControl::global()
        .set_switch(&galley, &paths, change, chrono::Utc::now())
        .await?;
    emit_memory_changed(&app);
    Ok(switch)
}

/// Delete one activity (`A…`) or emotional event (`E…`).
#[tauri::command]
pub(crate) async fn delete_ledger_entry(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    id: String,
) -> std::result::Result<(), String> {
    control::require_managed(&galley).await?;
    let paths = ledger_paths(&app)?;
    LedgerControl::global()
        .delete_entry(&galley, &paths, &id, chrono::Utc::now())
        .await?;
    emit_memory_changed(&app);
    Ok(())
}

/// Take an entry off the "do not record again" list.
#[tauri::command]
pub(crate) async fn unforget_ledger_entry(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    id: String,
) -> std::result::Result<(), String> {
    control::require_managed(&galley).await?;
    let paths = ledger_paths(&app)?;
    LedgerControl::global()
        .unforget(&galley, &paths, &id)
        .await?;
    emit_memory_changed(&app);
    Ok(())
}

/// Save one GA global-memory file; returns its new revision.
#[tauri::command]
pub(crate) async fn write_global_memory(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
    name: String,
    content: String,
    revision: String,
) -> std::result::Result<String, String> {
    control::require_managed(&galley).await?;
    let paths = ledger_paths(&app)?;
    let new_revision = LedgerControl::global()
        .write_global_memory(&galley, &paths, &name, &content, &revision)
        .await?;
    emit_memory_changed(&app);
    Ok(new_revision)
}
