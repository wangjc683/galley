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

/// Pair a phone: returns the QR code to scan, with the connection
/// running for it. Paired: the stored key's code (paired phones stay
/// paired). Not paired: a new key held in memory until the first phone
/// completes its handshake (then it is stored), for at most
/// [`crate::remote::PAIRING_TIMEOUT`]; showing it again meanwhile gives
/// the same code.
#[tauri::command]
pub(crate) async fn pair_remote_phone(
    app: tauri::AppHandle,
) -> std::result::Result<RemotePairing, String> {
    let remote = module(&app).ok_or(REMOTE_UNAVAILABLE)?;
    let qr = remote.pair().await.map_err(|e| e.to_string())?;
    let qr_svg = qr.to_svg().map_err(|e| e.to_string())?;
    Ok(RemotePairing { qr_svg })
}

/// End a pairing still waiting for its first phone: disconnect and forget
/// its key. The page calls it whenever its code goes away (Hide pairing
/// code, leaving the Phone page, closing Settings); once paired it does
/// nothing, and without remote access there is nothing to end.
#[tauri::command]
pub(crate) async fn cancel_remote_pairing(
    app: tauri::AppHandle,
) -> std::result::Result<(), String> {
    if let Some(remote) = module(&app) {
        remote.cancel_pairing().await;
    }
    Ok(())
}

/// Unpair every phone: they are disconnected and the master key is
/// deleted, so each has to scan a new code.
#[tauri::command]
pub(crate) async fn unpair_remote_phones(app: tauri::AppHandle) -> std::result::Result<(), String> {
    let remote = module(&app).ok_or(REMOTE_UNAVAILABLE)?;
    remote.unpair().await.map_err(|e| e.to_string())
}
