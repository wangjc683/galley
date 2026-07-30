//! Window chrome, menu-bar / tray background mode, and quit lifecycle for
//! the desktop app. Extracted from `lib.rs`: `setup_background_mode`
//! installs the tray, the window close handler, and the shared menu-event
//! router from the Tauri `setup` hook (`app_setup`); `handle_run_event`
//! is the app run-event loop body. The `set_keep_in_background` and
//! `resolve_first_close` commands are registered as `tray::…` in the
//! command handler.

use crate::db::SqliteGalley;
use crate::{im_supervisor, runner_manager, MAIN_WINDOW_LABEL};
use std::sync::atomic::{AtomicBool, Ordering};

pub(crate) const TRAY_SHOW_GALLEY_LABEL: &str = "Open Galley";
pub(crate) const TRAY_HIDE_GALLEY_LABEL: &str = "Hide Galley";

static QUIT_REQUEST_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
pub(crate) static ALLOW_APP_EXIT: AtomicBool = AtomicBool::new(false);

/// Pref key recording that the user has made the first-close choice
/// (keep in background vs quit) via the GUI's FirstCloseDialog, or —
/// legacy — saw the old one-time native background hint. The key keeps
/// its historical string so users who already dismissed the old hint
/// are not re-asked by the new dialog. Mirrors the `yolo_intro_seen`
/// disclosure-once pattern.
pub(crate) const FIRST_CLOSE_CHOICE_PREF: &str = "close_to_background_hint_seen";

/// Process-local mirror of `FIRST_CLOSE_CHOICE_PREF`. While `false`,
/// `CloseRequested` keeps the window visible and asks the GUI to show
/// the first-close choice dialog instead of hiding. Seeded from the
/// pref during `setup` (right after the SQL plugin runs migrations) so
/// a returning user is protected even if they close the window before
/// the GUI finishes hydrating; flipped by `resolve_first_close` (the
/// dialog's verdict) and by `set_keep_in_background` (an explicit
/// Settings toggle is the same intent expressed elsewhere). The close
/// handler reads this guard, not the DB, because it runs synchronously
/// inside the window-event callback.
pub(crate) static FIRST_CLOSE_CHOICE_MADE: AtomicBool = AtomicBool::new(false);

/// Event asking the GUI to open the first-close choice dialog. Emitted
/// by the `CloseRequested` handler while `FIRST_CLOSE_CHOICE_MADE` is
/// false; the GUI answers with the `resolve_first_close` command. If
/// the webview hasn't registered its listener yet (closing within the
/// first moments of the very first launch), the emit is lost and the
/// window simply stays open — the next close attempt asks again.
pub(crate) const FIRST_CLOSE_REQUESTED_EVENT: &str = "first-close-requested";

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

/// Flip the first-close-choice guard and persist it. Best-effort
/// persistence — a write failure only means the dialog may ask once
/// more on a future launch, never an exit-path regression. `swap`
/// makes repeat calls (dialog verdict racing a Settings toggle) skip
/// the redundant SQLite write.
fn mark_first_close_choice(app: &tauri::AppHandle<tauri::Wry>) {
    use tauri::Manager;
    if FIRST_CLOSE_CHOICE_MADE.swap(true, Ordering::SeqCst) {
        return;
    }
    let galley = app.state::<SqliteGalley>().inner().clone();
    tauri::async_runtime::spawn(async move {
        let _ = galley
            .set_pref_json(FIRST_CLOSE_CHOICE_PREF, serde_json::json!(true))
            .await;
    });
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

/// Live-push for the "keep in background on close" preference. Updates
/// the process-local atomic — persistence of the pref itself belongs to
/// the GUI's pref write, and setup re-seeds the atomic from SQLite next
/// launch, so the two sides can fail independently without drift beyond
/// the current session. An explicit Settings toggle also counts as the
/// first-close choice: the user has seen and decided what closing
/// means, so the FirstCloseDialog never needs to ask.
#[tauri::command]
pub(crate) fn set_keep_in_background(app: tauri::AppHandle<tauri::Wry>, enabled: bool) {
    KEEP_IN_BACKGROUND_ON_CLOSE.store(enabled, Ordering::SeqCst);
    mark_first_close_choice(&app);
}

/// Background Mode. macOS shows the Galley status item in
/// the right-side menu bar; Windows shows the same menu in
/// the system tray. Closing the window hides it instead of
/// tearing down Galley Core, so CLI / Supervisor / IM
/// actions keep reaching the local socket. Also installs the
/// shared `on_menu_event` router (tray menu + macOS menu bar)
/// and shows the config-hidden main window for non-autostart
/// launches.
#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) fn setup_background_mode(app: &tauri::App, autostart_launch: bool) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{Emitter, Manager, WindowEvent};

    let tray_toggle = MenuItem::with_id(
        app,
        "tray_toggle_window",
        // Silent autostart launches begin hidden, so the
        // toggle must read "Open Galley" from the start.
        if autostart_launch {
            TRAY_SHOW_GALLEY_LABEL
        } else {
            TRAY_HIDE_GALLEY_LABEL
        },
        true,
        None::<&str>,
    )?;
    app.manage(TrayMenuState {
        toggle_window_item: tray_toggle.clone(),
    });
    let tray_new_chat = MenuItem::with_id(app, "tray_new_chat", "New Chat", true, None::<&str>)?;
    let tray_settings = MenuItem::with_id(app, "tray_settings", "Settings...", true, None::<&str>)?;
    let tray_check_updates = MenuItem::with_id(
        app,
        "tray_check_updates",
        "Check for Updates…",
        true,
        None::<&str>,
    )?;
    let tray_quit = MenuItem::with_id(app, "tray_quit", "Quit Galley", true, None::<&str>)?;
    let tray_primary_separator = PredefinedMenuItem::separator(app)?;
    let tray_quit_separator = PredefinedMenuItem::separator(app)?;
    let tray_menu = Menu::with_items(
        app,
        &[
            &tray_toggle,
            &tray_new_chat,
            &tray_primary_separator,
            &tray_settings,
            &tray_check_updates,
            &tray_quit_separator,
            &tray_quit,
        ],
    )?;

    let tray_icon = match tray_icon_image() {
        Ok(image) => image,
        Err(e) => {
            eprintln!("[tray] custom tray icon load failed: {e}; using app icon");
            app.default_window_icon()
                .expect("default window icon must exist")
                .clone()
        }
    };
    let mut tray_builder = TrayIconBuilder::new()
        .icon(tray_icon)
        .menu(&tray_menu)
        .tooltip("Galley")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                #[cfg(target_os = "macos")]
                if button == MouseButton::Right && button_state == MouseButtonState::Down {
                    show_main_window(tray.app_handle());
                }

                #[cfg(target_os = "windows")]
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    toggle_main_window(tray.app_handle());
                }
            }
        });
    #[cfg(target_os = "macos")]
    {
        tray_builder = tray_builder
            .show_menu_on_left_click(true)
            .icon_as_template(true);
    }
    #[cfg(target_os = "windows")]
    {
        tray_builder = tray_builder.show_menu_on_left_click(false);
    }
    let _tray = tray_builder.build(app)?;

    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .expect("main webview window must exist at setup time");
    let window_for_close = window.clone();
    let tray_toggle_for_close = tray_toggle.clone();
    window.on_window_event(move |event| {
        // No native focus assertion on Windows activation here:
        // the v0.3.7 unconditional webview set_focus caused a
        // Focused(false)/Focused(true) feedback loop (focus
        // bouncing between HWNDs hundreds of times per second).
        // The Alt+Tab caret restore on WebView2 is unsolved —
        // see devlog 2026-07-21-windows-composer-refocus and
        // the debug/win-focus branch.
        if let WindowEvent::CloseRequested { api, .. } = event {
            if ALLOW_APP_EXIT.load(Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            if !KEEP_IN_BACKGROUND_ON_CLOSE.load(Ordering::SeqCst) {
                // Settings -> General (or the first-close
                // dialog) turned Background Mode off: close
                // means quit. Still prevent_close above —
                // request_true_quit is async and may show a
                // confirm dialog when an agent is running; on
                // Cancel the window must survive (and stay
                // visible: the quit intent was withdrawn,
                // hiding would look like a crash).
                // cleanup_and_exit sets ALLOW_APP_EXIT before
                // app.exit(0), so the real teardown passes the
                // guard above.
                request_true_quit(window_for_close.app_handle().clone(), true);
                return;
            }
            if !FIRST_CLOSE_CHOICE_MADE.load(Ordering::SeqCst) {
                // First close, no decision recorded: keep the
                // window visible and let the GUI ask what
                // closing should mean (FirstCloseDialog). The
                // GUI answers via `resolve_first_close`, which
                // hides or quits. If the webview listener
                // isn't up yet the emit is lost and the window
                // simply stays open — the next close attempt
                // asks again. Dismissing the dialog (Esc /
                // overlay) resolves nothing: close cancelled,
                // ask again next time.
                let _ = window_for_close.emit(FIRST_CLOSE_REQUESTED_EVENT, ());
                return;
            }
            // Background Mode: hide instead of quit, so the
            // close gesture feels instant. The first-close
            // dialog already taught where the window goes.
            let _ = window_for_close.hide();
            let _ = tray_toggle_for_close.set_text(TRAY_SHOW_GALLEY_LABEL);
        }
    });

    // Normal launches show the (config-hidden) window here;
    // `--autostart` launches skip straight to background mode.
    if !autostart_launch {
        let _ = window.show();
        let _ = window.set_focus();
    }

    let tray_toggle_for_menu = tray_toggle.clone();
    app.on_menu_event(move |app, event| {
        use tauri_plugin_opener::OpenerExt;
        match event.id.0.as_str() {
            "settings" | "tray_settings" => {
                show_main_window(app);
                let _ = tray_toggle_for_menu.set_text(TRAY_HIDE_GALLEY_LABEL);
                let _ = app.emit("menu:settings", ());
            }
            "check_updates" | "tray_check_updates" => {
                show_main_window(app);
                let _ = tray_toggle_for_menu.set_text(TRAY_HIDE_GALLEY_LABEL);
                let _ = app.emit("menu:check_updates", ());
            }
            "new_chat" | "tray_new_chat" => {
                show_main_window(app);
                let _ = tray_toggle_for_menu.set_text(TRAY_HIDE_GALLEY_LABEL);
                let _ = app.emit("menu:new_chat", ());
            }
            // Width arms: flip the checkmarks in Rust right
            // away — AppKit auto-toggles only the clicked
            // check item, which would briefly show both (or
            // neither) checked until the GUI round-trip
            // re-syncs via `set_width_menu_state`.
            "width_compact" => {
                #[cfg(target_os = "macos")]
                if let Some(state) = app.try_state::<crate::app_menu::WidthMenuState>() {
                    state.set_width("compact");
                }
                let _ = app.emit("menu:width_compact", ());
            }
            "width_wide" => {
                #[cfg(target_os = "macos")]
                if let Some(state) = app.try_state::<crate::app_menu::WidthMenuState>() {
                    state.set_width("wide");
                }
                let _ = app.emit("menu:width_wide", ());
            }
            // Layout reset is GUI-driven (the sidebar split lives in
            // React), so this only forwards; useGlobalShortcuts calls
            // the `reset_window_layout` command plus the panel reset.
            // Show the window first — resetting an invisible window's
            // geometry would be a no-show surprise on next reveal.
            "reset_layout" => {
                show_main_window(app);
                let _ = tray_toggle_for_menu.set_text(TRAY_HIDE_GALLEY_LABEL);
                let _ = app.emit("menu:reset_layout", ());
            }
            "tray_toggle_window" => {
                toggle_main_window(app);
            }
            "quit_galley" | "tray_quit" => {
                request_true_quit(app.clone(), true);
            }
            "github" => {
                let _ = app
                    .opener()
                    .open_url("https://github.com/wangjc683/galley", None::<&str>);
            }
            "issues" => {
                let _ = app
                    .opener()
                    .open_url("https://github.com/wangjc683/galley/issues", None::<&str>);
            }
            _ => {}
        }
    });

    Ok(())
}

/// The app run-event loop body (`Builder::run` callback): routes
/// exit-requested through the true-quit cleanup path and re-shows the
/// window on macOS Dock reopen.
pub(crate) fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    match event {
        tauri::RunEvent::ExitRequested { api, code, .. } => {
            if ALLOW_APP_EXIT.load(Ordering::SeqCst) || code == Some(tauri::RESTART_EXIT_CODE) {
                return;
            }
            api.prevent_exit();
            request_true_quit(app.clone(), true);
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } => {
            if !has_visible_windows {
                show_main_window(app);
            }
        }
        _ => {}
    }
}

/// Verdict of the GUI's first-close choice dialog. Records the choice
/// (guard + pref), mirrors it into the keep-in-background atomic, and
/// executes what the user picked: hide to background, or the true-quit
/// path (which still confirms when an agent is running — Cancel there
/// leaves the window visible, matching the withdrawn quit intent).
/// The keep-in-background *pref* is persisted by the GUI store setter
/// alongside this call, same split as `set_keep_in_background`.
#[tauri::command]
pub(crate) fn resolve_first_close(app: tauri::AppHandle<tauri::Wry>, keep_in_background: bool) {
    use tauri::Manager;
    mark_first_close_choice(&app);
    KEEP_IN_BACKGROUND_ON_CLOSE.store(keep_in_background, Ordering::SeqCst);
    if keep_in_background {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = window.hide();
        }
        set_tray_window_visible(&app, false);
    } else {
        request_true_quit(app, true);
    }
}
