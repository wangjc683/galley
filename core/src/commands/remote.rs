//! Settings → Phone (ticket 05d): thin Tauri wrappers over
//! [`crate::remote::RemoteModule`]. The logic stays in the module; these
//! only find it and shape the answer for the page.
//!
//! Tauri only, on purpose (not `GalleyApi`, so no socket or CLI twin):
//! pairing shows the pairing master key as a QR code, and the only place
//! that may happen is this desktop's own screen (Rule 2: phones pair on
//! the desktop).
//!
//! The module exists only when a relay URL is configured
//! ([`crate::remote::RemoteModule::for_app`]). Without one,
//! [`get_remote_status`] answers `null` and the page hides the Phone tab,
//! so a build without a relay URL looks exactly as before.

use crate::remote::{RemoteModule, RemoteStatus};
use serde::Serialize;
use tauri::Manager;

/// The error [`pair_remote_phone`] and [`unpair_remote_phones`] give when
/// remote access does not exist in this build.
const REMOTE_UNAVAILABLE: &str = "remote_unavailable";

/// What the page shows to pair a phone.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemotePairing {
    /// The pairing QR code as SVG markup. The QR string itself never
    /// leaves Core.
    qr_svg: String,
}

fn module(app: &tauri::AppHandle) -> Option<RemoteModule> {
    app.try_state::<RemoteModule>()
        .map(|state| state.inner().clone())
}

/// The module's status, or `null` when remote access does not exist in
/// this build (no relay URL). Changes arrive as `remote-status` events.
#[tauri::command]
pub(crate) async fn get_remote_status(
    app: tauri::AppHandle,
) -> std::result::Result<Option<RemoteStatus>, String> {
    Ok(module(&app).map(|remote| remote.status()))
}

/// Pair a phone: makes sure a pairing master key exists and the
/// connection runs, and returns the QR code to scan. Showing it again
/// gives the same code, so paired phones stay paired.
#[tauri::command]
pub(crate) async fn pair_remote_phone(
    app: tauri::AppHandle,
) -> std::result::Result<RemotePairing, String> {
    let remote = module(&app).ok_or(REMOTE_UNAVAILABLE)?;
    let qr = remote.pair().await.map_err(|e| e.to_string())?;
    let qr_svg = qr.to_svg().map_err(|e| e.to_string())?;
    Ok(RemotePairing { qr_svg })
}

/// Unpair every phone: they are disconnected and the master key is
/// deleted, so each has to scan a new code.
#[tauri::command]
pub(crate) async fn unpair_remote_phones(app: tauri::AppHandle) -> std::result::Result<(), String> {
    let remote = module(&app).ok_or(REMOTE_UNAVAILABLE)?;
    remote.unpair().await.map_err(|e| e.to_string())
}
