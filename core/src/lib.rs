pub mod api;
mod app_menu;
mod auto_title;
mod app_paths;
mod app_setup;
pub mod app_update;
pub mod browser_control;
pub mod codex_oauth;
mod commands;
pub mod conversation_image;
pub mod credential_store;
pub mod db;
mod db_migrations;
mod desktop_goal;
pub mod discovery;
pub mod error;
pub mod im_supervisor;
pub mod ipc;
pub mod managed_model_config;
pub mod managed_model_probe;
mod managed_prompt;
pub mod managed_runtime;
pub mod message_queue;
pub mod migration_backup;
pub mod notify;
pub mod path_install;
mod process_command;
pub mod protocol;
pub mod runner_commands;
pub mod runner_manager;
pub mod scheduler;
pub mod socket_listener;
pub mod sop_install;
mod tray;

use commands::*;

pub use desktop_goal::{ensure_goal_master_duty_sop, goal_master_duty_sop_path};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = db_migrations::all();

    // Pre-migration backup hook (B4 M8). Derived — not hard-coded —
    // from the migrations vec above so adding a new migration only
    // requires editing one place. Handed to the setup hook and
    // evaluated BEFORE `tauri-plugin-sql` opens the DB.
    let latest_migration_version: i64 = migrations.iter().map(|m| m.version).max().unwrap_or(0);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        // System notifications (Settings -> General). Fired from the
        // GUI only when the window is unfocused — goal terminal states
        // and pending approvals (gui/src/lib/notify.ts owns the gating).
        .plugin(tauri_plugin_notification::init())
        // Launch at login (Settings -> General). Default off; the OS is
        // the single source of truth — the GUI reads `isEnabled()` live
        // and nothing is mirrored into prefs, so removing the login item
        // from system settings shows up in Galley as "off" without drift.
        // macOS uses a LaunchAgent plist (no permission prompt; visible
        // and revocable under System Settings -> Login Items), Windows a
        // HKCU Run key (no admin). Login launches carry `--autostart`,
        // which the setup hook reads to start hidden in the tray.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Remember window size / position / maximized / fullscreen across
        // launches (saved to `.window-state.json` in the app config dir on
        // true quit — `app.exit(0)` in tray.rs). Briefly removed on
        // 2026-07-30 in favor of launch-time amnesia, reversed the same
        // day: the curated default is instead reachable on demand via the
        // "Reset to Default Layout" affordances (Window menu / command
        // palette / separator double-click — see `reset_window_layout` in
        // commands/system.rs and devlog 2026-07-30). Two flags are
        // excluded on purpose:
        // - VISIBLE: Background Mode hides the window instead of closing;
        //   quitting from the tray while hidden must not restore an
        //   invisible window on next launch.
        // - DECORATIONS: Windows runs with native decorations off as custom
        //   chrome (see the setup hook); the plugin must not restore a
        //   stale decorations value over that.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        // RunnerManager is the single Rust authority for Python runner
        // subprocesses (B2 M1). Held as Tauri app state inside an `Arc`
        // so the `spawn_runner` / `send_to_runner` / etc. commands AND
        // the socket_listener task all reach the same instance. Background
        // Mode keeps window close from tearing down the process; true app
        // quit runs `shutdown_all` from Rust before allowing exit.
        .manage(std::sync::Arc::new(runner_manager::RunnerManager::new()))
        .manage(std::sync::Arc::new(
            im_supervisor::ImSupervisorManager::new(),
        ))
        .invoke_handler(tauri::generate_handler![
            path_exists,
            reset_window_layout,
            get_supervisor_sop,
            health_report,
            app_update::check_app_update,
            app_update::install_app_update,
            conversation_image::save_conversation_image,
            conversation_image::open_conversation_image,
            check_path_install_status,
            install_galley_to_path,
            uninstall_galley_from_path,
            ensure_managed_runtime_layout,
            ensure_browser_control_layout,
            probe_browser_control,
            open_browser_control_extensions_page,
            open_browser_control_test_page,
            get_im_supervisor_status,
            get_feishu_im_config,
            save_feishu_im_config,
            delete_feishu_im_config,
            unbind_feishu_im_owner,
            get_telegram_im_config,
            save_telegram_im_config,
            delete_telegram_im_config,
            unbind_telegram_im_owner,
            start_im_supervisor,
            stop_im_supervisor,
            logout_im_supervisor,
            restart_enabled_im_supervisors,
            list_managed_model_providers,
            save_managed_model_provider,
            delete_managed_model_provider,
            list_managed_models,
            save_managed_model,
            delete_managed_model,
            reorder_managed_models,
            list_managed_model_options,
            test_managed_model_connection,
            start_chatgpt_codex_login,
            complete_chatgpt_codex_login,
            import_chatgpt_codex_cli_login,
            logout_chatgpt_codex_provider,
            list_sessions,
            // B3 M4a session writes
            create_session,
            archive_session,
            unarchive_session,
            rename_session,
            set_session_pinned,
            set_session_approval_mode,
            delete_session,
            assign_session_to_project,
            set_session_llm,
            bump_session_after_turn,
            clear_session_unread,
            session_message_rows,
            persist_user_message,
            queue_or_dispatch_user_message,
            queue_jump_message,
            queue_remove_message,
            session_queue_snapshot,
            persist_assistant_message,
            delete_empty_new_sessions,
            delete_demo_sessions,
            backfill_fts_if_empty,
            search_messages,
            persist_tool_event_pending,
            persist_tool_event_approval_decision,
            load_tool_events_by_session,
            get_pref_json,
            set_pref_json,
            tray::set_keep_in_background,
            tray::resolve_first_close,
            app_menu::set_width_menu_state,
            bulk_archive_sessions,
            bulk_unarchive_sessions,
            bulk_delete_sessions,
            // B3 M4a project CRUD
            list_projects,
            create_project,
            update_project,
            delete_project,
            // Scheduled tasks (.scratch/scheduled-tasks)
            list_scheduled_tasks,
            create_scheduled_task,
            update_scheduled_task,
            preview_scheduled_fire,
            run_scheduled_task_now,
            delete_scheduled_task,
            list_active_goals,
            list_visible_goals,
            list_goals_for_session,
            goal_context_for_session,
            goal_status,
            goal_workspace_has_files,
            mark_goal_result_seen,
            request_goal_stop,
            desktop_goal::start_desktop_goal,
            // B2 runner commands
            runner_commands::spawn_runner,
            runner_commands::send_to_runner,
            runner_commands::shutdown_runner,
            runner_commands::kill_runner,
            runner_commands::runner_stderr_tail,
            runner_commands::probe_ga_runtime,
            runner_commands::shutdown_all_runners,
        ])
        .setup(move |app| app_setup::setup_app(app, migrations, latest_migration_version))
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(tray::handle_run_event);
}
