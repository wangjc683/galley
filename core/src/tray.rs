//! Window chrome, menu-bar / tray background mode, and quit lifecycle for
//! the desktop app. Extracted from `lib.rs`: these helpers plus the
//! close-hint state are orchestrated by the Tauri `setup` hook and the
//! run-event loop in `lib::run`, which glob-imports this module so those
//! call sites stay unqualified. The `set_close_hint_copy` command is
//! registered as `tray::set_close_hint_copy` in the command handler.

use crate::db::SqliteGalley;
use crate::{im_supervisor, runner_manager, MAIN_WINDOW_LABEL};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

pub(crate) const TRAY_SHOW_GALLEY_LABEL: &str = "Open Galley";
pub(crate) const TRAY_HIDE_GALLEY_LABEL: &str = "Hide Galley";

static QUIT_REQUEST_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
pub(crate) static ALLOW_APP_EXIT: AtomicBool = AtomicBool::new(false);

/// Pref key recording whether the one-time "Galley keeps running in the
/// background after you close the window" hint has been shown on this
/// device. Written by the close handler the first time the window is
/// hidden to background (see `CloseRequested`). Mirrors the
/// `yolo_intro_seen` disclosure-once pattern.
pub(crate) const CLOSE_HINT_SEEN_PREF: &str = "close_to_background_hint_seen";

/// Process-local guard so the background hint fires at most once per
/// launch even under rapid repeated close events. Seeded from the
/// persisted `CLOSE_HINT_SEEN_PREF` during `setup` (right after the SQL
/// plugin runs migrations), so a returning user who already dismissed
/// the hint is protected even if they close the window before the GUI
/// finishes hydrating. The close handler reads this guard, not the DB,
/// because it runs synchronously inside the window-event callback.
pub(crate) static CLOSE_HINT_SHOWN: AtomicBool = AtomicBool::new(false);

/// Pref key for the Settings -> General "keep running in the
/// background when the window closes" toggle.
pub(crate) const KEEP_IN_BACKGROUND_PREF: &str = "keep_in_background_on_close";

/// Process-local mirror of `KEEP_IN_BACKGROUND_PREF`, read by the
/// synchronous CloseRequested callback (which can't await SQLite).
/// Starts `true` — a missing or unreadable pref must resolve to the
/// historical Background Mode behavior. Seeded from the pref during
/// `setup` (before the window can be closed) and updated live by
/// `set_keep_in_background` when the user flips the toggle. The GUI
/// owns persistence; this atomic owns behavior.
pub(crate) static KEEP_IN_BACKGROUND_ON_CLOSE: AtomicBool = AtomicBool::new(true);

pub(crate) struct TrayMenuState {
    pub(crate) toggle_window_item: tauri::menu::MenuItem<tauri::Wry>,
}

/// Localized copy for the background-mode close hint dialog. The close
/// handler is a synchronous window-event callback and can't await a
/// pref read or reach into GUI i18n, so the localized strings are
/// pushed from the frontend (hydrate + on language change) via
/// `set_close_hint_copy` and parked here. Defaults to English so the
/// dialog is still coherent if the frontend hasn't pushed yet.
pub(crate) struct CloseHintCopy {
    title: Mutex<String>,
    body: Mutex<String>,
}

impl Default for CloseHintCopy {
    fn default() -> Self {
        Self {
            title: Mutex::new("Galley is still running".to_string()),
            body: Mutex::new(
                "Closing the window only hides Galley. Background tasks and connected channels keep running. To quit completely, choose Quit Galley from the menu bar / tray."
                    .to_string(),
            ),
        }
    }
}

fn set_tray_window_visible(app: &tauri::AppHandle<tauri::Wry>, visible: bool) {
    use tauri::Manager;
    let Some(tray_menu) = app.try_state::<TrayMenuState>() else {
        return;
    };
    let label = if visible {
        TRAY_HIDE_GALLEY_LABEL
    } else {
        TRAY_SHOW_GALLEY_LABEL
    };
    let _ = tray_menu.toggle_window_item.set_text(label);
}

pub(crate) fn show_main_window(app: &tauri::AppHandle<tauri::Wry>) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        set_tray_window_visible(app, true);
    }
}

pub(crate) fn toggle_main_window(app: &tauri::AppHandle<tauri::Wry>) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            let _ = window.hide();
            set_tray_window_visible(app, false);
        } else {
            show_main_window(app);
        }
    }
}

/// One-time disclosure that closing the window hides Galley to the
/// background rather than quitting. Fires the first time the window is
/// hidden via `CloseRequested` on macOS / Windows. Subsequent closes
/// (and returning users who already dismissed it) skip silently.
///
/// `swap(true)` makes the process-local guard self-arming: the first
/// caller observes `false` and shows the dialog; everyone after gets
/// `true` and returns. The guard is also seeded `true` during `setup`
/// from the persisted `CLOSE_HINT_SEEN_PREF` for users who saw the hint
/// on a prior launch, so the dialog is genuinely once-per-device, not
/// once-per-launch — and that seed happens before the window can be
/// closed, closing the hydrate-timing race.
///
/// The seen flag is persisted here — close handling is Rust's authority,
/// and the GUI only mirrors copy inward. The dialog is shown
/// non-blocking (single OK button); the window stays hidden underneath,
/// matching the user's close intent.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) fn maybe_show_background_hint(app: &tauri::AppHandle<tauri::Wry>) {
    use tauri::Manager;

    if CLOSE_HINT_SHOWN.swap(true, Ordering::SeqCst) {
        return;
    }

    // Persist the seen flag so it survives the next launch. Best-effort:
    // a write failure only means the hint may show once more, never an
    // exit-path regression.
    let galley = app.state::<SqliteGalley>().inner().clone();
    tauri::async_runtime::spawn(async move {
        let _ = galley
            .set_pref_json(CLOSE_HINT_SEEN_PREF, serde_json::json!(true))
            .await;
    });

    let (title, body) = match app.try_state::<CloseHintCopy>() {
        Some(copy) => {
            let title = copy
                .title
                .lock()
                .map(|g| g.clone())
                .unwrap_or_else(|_| "Galley is still running".to_string());
            let body = copy
                .body
                .lock()
                .map(|g| g.clone())
                .unwrap_or_else(|_| {
                    "Closing the window only hides Galley. To quit completely, choose Quit Galley from the menu bar / tray.".to_string()
                });
            (title, body)
        }
        None => (
            "Galley is still running".to_string(),
            "Closing the window only hides Galley. To quit completely, choose Quit Galley from the menu bar / tray.".to_string(),
        ),
    };

    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    app.dialog()
        .message(body)
        .title(title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}

fn cleanup_and_exit<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        use std::time::Duration;
        use tauri::Manager;
        if let Some(im_manager) =
            app.try_state::<std::sync::Arc<im_supervisor::ImSupervisorManager>>()
        {
            im_manager.stop_all().await;
        }
        let manager = app.state::<std::sync::Arc<runner_manager::RunnerManager>>();
        manager.shutdown_all(Duration::from_secs(5)).await;
        ALLOW_APP_EXIT.store(true, Ordering::SeqCst);
        app.exit(0);
    });
}

pub(crate) fn request_true_quit<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    confirm_if_busy: bool,
) {
    if QUIT_REQUEST_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    tauri::async_runtime::spawn(async move {
        use tauri::Manager;
        let manager = app.state::<std::sync::Arc<runner_manager::RunnerManager>>();
        let busy = confirm_if_busy && manager.any_agent_running().await;

        if busy {
            use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
            let dialog_app = app.clone();
            let exit_app = app.clone();
            dialog_app
                .dialog()
                .message(
                    "Galley has a task still running. Quit Galley will stop the app and interrupt any active Agent work.",
                )
                .title("Quit Galley?")
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Quit Galley".to_string(),
                    "Cancel".to_string(),
                ))
                .show(move |confirmed| {
                    if confirmed {
                        cleanup_and_exit(exit_app);
                    } else {
                        QUIT_REQUEST_IN_FLIGHT.store(false, Ordering::SeqCst);
                    }
                });
        } else {
            cleanup_and_exit(app);
        }
    });
}

pub(crate) fn tray_icon_image() -> tauri::Result<tauri::image::Image<'static>> {
    #[cfg(target_os = "macos")]
    const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-template.png");
    #[cfg(target_os = "windows")]
    const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-windows.png");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/32x32.png");

    tauri::image::Image::from_bytes(TRAY_ICON_BYTES).map(|image| image.to_owned())
}

/// Update the localized copy for the background-mode close hint. Called
/// by the GUI at hydrate and again whenever the UI language changes, so
/// the native dialog (which runs synchronously inside the close handler
/// and can't reach GUI i18n) always has the active-language strings
/// ready.
///
/// The seen flag is NOT handled here: it's seeded from the persisted
/// pref during `setup` (so a returning user is protected even if they
/// close the window before hydrate runs) and persisted by the close
/// handler on first show. This command only mirrors copy inward and
/// never touches SQLite.
/// Live-push for the "keep in background on close" preference. Only
/// updates the process-local atomic — persistence belongs to the GUI's
/// pref write, and setup re-seeds the atomic from SQLite next launch,
/// so the two sides can fail independently without drift beyond the
/// current session.
#[tauri::command]
pub(crate) fn set_keep_in_background(enabled: bool) {
    KEEP_IN_BACKGROUND_ON_CLOSE.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
pub(crate) fn set_close_hint_copy(
    title: String,
    body: String,
    copy: tauri::State<'_, CloseHintCopy>,
) {
    if let Ok(mut guard) = copy.title.lock() {
        *guard = title;
    }
    if let Ok(mut guard) = copy.body.lock() {
        *guard = body;
    }
}
