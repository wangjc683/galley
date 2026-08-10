//! macOS menu bar and the Conversation Width menu state, extracted from
//! `lib.rs`. `install_macos_menu` is called from the `setup` hook
//! (`app_setup`); menu item clicks are routed by the shared
//! `on_menu_event` handler installed in `tray::setup_background_mode`.

/// Handles to the Conversation Width check items in the macOS menu
/// bar, held as Tauri state so both the GUI push command and the menu
/// click handler can flip the checkmarks. The GUI owns the pref; this
/// only mirrors it outward (same inward-mirror pattern as
/// `set_close_hint_copy`) and never touches SQLite.
#[cfg(target_os = "macos")]
pub(crate) struct WidthMenuState {
    compact: tauri::menu::CheckMenuItem<tauri::Wry>,
    wide: tauri::menu::CheckMenuItem<tauri::Wry>,
}

#[cfg(target_os = "macos")]
impl WidthMenuState {
    pub(crate) fn set_width(&self, width: &str) {
        let compact = width == "compact";
        let _ = self.compact.set_checked(compact);
        let _ = self.wide.set_checked(!compact);
    }
}

/// Mirror the conversation width pref into the macOS menu-bar
/// checkmarks. Called by the GUI at hydrate and on every width change.
/// Registered on all platforms so the GUI can call it unconditionally;
/// no-op where there is no native menu bar.
#[tauri::command]
pub(crate) fn set_width_menu_state(width: String, app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        if let Some(state) = app.try_state::<WidthMenuState>() {
            state.set_width(&width);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (width, app);
}

/// macOS-only top menu bar. On macOS apps that don't install
/// a menu look "half-native" — the menu bar shows generic
/// Tauri default entries. We install a Galley-specific menu
/// that mirrors the in-app actions (Settings / New Chat /
/// Check for Updates / Conversation Width) plus standard
/// system items (Hide / Quit / Cut / Copy / Paste /
/// Minimize / Zoom).
///
/// Custom menu items emit `menu:<id>` events; App.tsx
/// listens and routes them to the matching frontend actions.
/// Predefined items (Hide / Copy / etc.) are handled by the
/// OS directly and need no JS wiring. Quit is custom so it can
/// clean up runners first.
///
/// Win/Linux don't get a menu — Win uses our custom chrome
/// (decorations off, no native menu bar surface) and Linux
/// isn't a v0.2 target. Windows users reach the same lifecycle
/// actions through the tray menu and custom chrome.
#[cfg(target_os = "macos")]
pub(crate) fn install_macos_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{
        AboutMetadataBuilder, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder,
        PredefinedMenuItem, SubmenuBuilder,
    };
    use tauri::Manager;

    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("Galley"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .credits(Some("Made by JC Wang".to_string()))
        .website(Some("https://github.com/wangjc683/galley".to_string()))
        .website_label(Some("GitHub".to_string()))
        .build();

    let app_submenu = SubmenuBuilder::new(app, "Galley")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Galley"),
            Some(about_metadata),
        )?)
        .item(
            &MenuItemBuilder::new("Check for Updates…")
                .id("check_updates")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::new("Settings…")
                .id("settings")
                .accelerator("Cmd+,")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::new("Quit Galley")
                .id("quit_galley")
                .accelerator("Cmd+Q")
                .build(app)?,
        )
        .build()?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::new("New Chat")
                .id("new_chat")
                .accelerator("Cmd+N")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    // Check items (radio semantics: exactly one checked) so
    // the open menu reflects the active width. Initial state
    // matches the prefs-store default ("compact"); the GUI
    // re-syncs via `set_width_menu_state` at hydrate and on
    // every width change.
    let width_compact_item = CheckMenuItemBuilder::new("Compact (760px)")
        .id("width_compact")
        .checked(true)
        .build(app)?;
    let width_wide_item = CheckMenuItemBuilder::new("Wide (1200px)")
        .id("width_wide")
        .checked(false)
        .build(app)?;
    let width_submenu = SubmenuBuilder::new(app, "Conversation Width")
        .item(&width_compact_item)
        .item(&width_wide_item)
        .build()?;
    app.manage(WidthMenuState {
        compact: width_compact_item,
        wide: width_wide_item,
    });

    // No Sidebar toggle here on purpose: the sidebar is not
    // collapsible by product decision (multi-session IS the
    // product shape — see docs/design/layout-and-chrome.md).
    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(&width_submenu)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    // "Reset to Default Layout" sits under Zoom — the Window menu is
    // macOS's home for geometry verbs. It snaps window size (golden,
    // monitor-clamped, centered) and the sidebar split; the GUI handles
    // both on `menu:reset_layout` (useGlobalShortcuts) so this entry,
    // the command palette, and the separator double-click stay in sync.
    let window_submenu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .item(
            &MenuItemBuilder::new("Reset to Default Layout")
                .id("reset_layout")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::bring_all_to_front(app, None)?)
        .build()?;

    let help_submenu = SubmenuBuilder::new(app, "Help")
        .item(
            &MenuItemBuilder::new("Galley on GitHub")
                .id("github")
                .build(app)?,
        )
        .item(
            // "Issue", not "Bug": the chooser it opens offers both the
            // bug and the feature-request form. Id stays `issues` —
            // it's a routing key, not copy.
            &MenuItemBuilder::new("Report an Issue…")
                .id("issues")
                .build(app)?,
        )
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .item(&help_submenu)
        .build()?;

    app.set_menu(menu)?;

    // Register with NSApp so AppKit augments the standard
    // menus: the Window menu gets the open-window list plus
    // system items (Sequoia window tiling lives there), and
    // the Help menu gets the native search field. Help would
    // otherwise only be picked up by AppKit's title
    // heuristic, which matches the *localized* word "Help"
    // and silently fails on non-English system languages.
    window_submenu.set_as_windows_menu_for_nsapp()?;
    help_submenu.set_as_help_menu_for_nsapp()?;

    Ok(())
}
