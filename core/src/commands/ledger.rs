use super::*;
use crate::ledger::{LedgerConfig, LedgerExclusion, LedgerTarget, RunReport, Trigger};

// Affairs ledger (.scratch/main-chat/issues/01-affairs-ledger.md). The
// "not used to understand me" marks are stored whether or not the ledger
// is switched on; the page that sets them is ticket 04, so nothing in the
// GUI calls these yet. Not part of the Agent API.

/// Mark (`excluded: true`) or unmark one session or project as "not used
/// to understand me". `target` is `{"kind": "session" | "project", "id"}`.
#[tauri::command]
pub(crate) async fn set_ledger_excluded(
    galley: State<'_, SqliteGalley>,
    target: LedgerTarget,
    excluded: bool,
) -> std::result::Result<(), String> {
    galley
        .set_ledger_excluded(&target, excluded)
        .await
        .map_err(stringify_error)
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
/// the run has settled. Only while `GALLEY_LEDGER_SINCE` is set.
#[tauri::command]
pub(crate) async fn run_ledger_now(
    app: tauri::AppHandle,
    galley: State<'_, SqliteGalley>,
) -> std::result::Result<RunReport, String> {
    let Some(config) = LedgerConfig::from_env() else {
        return Err(format!(
            "the affairs ledger is off: set {} to a YYYY-MM-DD date",
            crate::ledger::config::SINCE_ENV
        ));
    };
    Ok(crate::ledger::run_for_app(&app, &galley, &config, Trigger::Manual).await)
}
