pub mod api;
mod app_paths;
pub mod app_update;
pub mod browser_control;
pub mod codex_oauth;
mod commands;
pub mod conversation_image;
pub mod credential_store;
pub mod db;
mod desktop_goal;
pub mod discovery;
pub mod error;
pub mod im_supervisor;
pub mod ipc;
pub mod managed_model_config;
pub mod managed_model_probe;
mod managed_prompt;
pub mod managed_runtime;
pub mod migration_backup;
pub mod notify;
pub mod path_install;
mod process_command;
pub mod protocol;
pub mod runner_commands;
pub mod runner_manager;
pub mod socket_listener;
pub mod sop_install;
mod tray;

use api::GalleyApi;
use commands::*;
use db::SqliteGalley;
use std::sync::atomic::Ordering;
use tauri_plugin_sql::{Migration, MigrationKind};
use tray::*;

pub use desktop_goal::{ensure_goal_master_duty_sop, goal_master_duty_sop_path};

/// SQLite filename. Resolved by tauri-plugin-sql relative to the
/// platform's app-data directory:
///
///   macOS:  ~/Library/Application Support/app.galley/
///
/// Schema lives in core/migrations/001_init.sql; tauri-plugin-sql
/// runs Up migrations in version order on first connect.
const DB_URL: &str = "sqlite:workbench.db";
pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

/// Handles to the Conversation Width check items in the macOS menu
/// bar, held as Tauri state so both the GUI push command and the menu
/// click handler can flip the checkmarks. The GUI owns the pref; this
/// only mirrors it outward (same inward-mirror pattern as
/// `set_close_hint_copy`) and never touches SQLite.
#[cfg(target_os = "macos")]
struct WidthMenuState {
    compact: tauri::menu::CheckMenuItem<tauri::Wry>,
    wide: tauri::menu::CheckMenuItem<tauri::Wry>,
}

#[cfg(target_os = "macos")]
impl WidthMenuState {
    fn set_width(&self, width: &str) {
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
fn set_width_menu_state(width: String, app: tauri::AppHandle) {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add sessions.has_unread",
            sql: include_str!("../migrations/002_add_has_unread.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add messages.summary",
            sql: include_str!("../migrations/003_add_message_summary.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add messages_fts (full-text search)",
            sql: include_str!("../migrations/004_add_messages_fts.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add messages.preamble",
            sql: include_str!("../migrations/005_add_message_preamble.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add messages origin (created_via, supervisor, origin_note)",
            sql: include_str!("../migrations/006_messages_origin.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description:
                "add sessions origin (created_via, created_by_supervisor, created_origin_note)",
            sql: include_str!("../migrations/007_sessions_origin.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add managed/external runtime identity",
            sql: include_str!("../migrations/008_runtime_identity.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add managed model metadata",
            sql: include_str!("../migrations/009_managed_models.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "split managed model providers from models",
            sql: include_str!("../migrations/010_managed_model_providers.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "add managed model display order",
            sql: include_str!("../migrations/011_managed_model_sort_order.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "add managed model local encrypted secrets",
            sql: include_str!("../migrations/012_managed_model_local_secrets.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "add stable per-session LLM identity",
            sql: include_str!("../migrations/013_session_llm_key.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "add managed model provider auth kind",
            sql: include_str!("../migrations/014_managed_model_auth_kind.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "add Galley Goal V1 state",
            sql: include_str!("../migrations/015_goal_v1.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "add Goal master session delivery state",
            sql: include_str!("../migrations/016_goal_master_session.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "add message visibility",
            sql: include_str!("../migrations/017_message_visibility.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "add Goal deliverable anchor",
            sql: include_str!("../migrations/018_goal_deliverable.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 19,
            description: "add Goal file workspace path",
            sql: include_str!("../migrations/019_goal_workspace.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 20,
            description: "add message attachments",
            sql: include_str!("../migrations/020_message_attachments.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "allow Galley Native session runtime",
            sql: include_str!("../migrations/021_native_session_runtime.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 22,
            description: "add Galley Native memory substrate",
            sql: include_str!("../migrations/022_native_memory_substrate.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "allow Galley Native Goal runtime",
            sql: include_str!("../migrations/023_native_goal_runtime.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 24,
            description: "make Galley Native the default built-in runtime",
            sql: include_str!("../migrations/024_native_default_runtime.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 25,
            description: "restore managed runtime default after native experiment",
            sql: include_str!("../migrations/025_restore_managed_runtime_default.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "project workspace binding",
            sql: include_str!("../migrations/026_project_workspace.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "backfill managed model context_win default",
            sql: include_str!("../migrations/027_managed_model_context_win.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "add message telemetry",
            sql: include_str!("../migrations/028_message_telemetry.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 29,
            description: "backfill managed custom model context_win default",
            sql: include_str!("../migrations/029_managed_model_custom_context_win.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 30,
            description: "enforce single active goal",
            sql: include_str!("../migrations/030_single_active_goal.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 31,
            description: "stamp goal-scoped message rows with goal_id",
            sql: include_str!("../migrations/031_message_goal_id.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 32,
            description: "add goal solo/hive engine mode",
            sql: include_str!("../migrations/032_goal_mode.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 33,
            description: "make goals.project_id optional (solo without a project)",
            sql: include_str!("../migrations/033_goal_optional_project.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 34,
            description: "per-session approval mode override",
            sql: include_str!("../migrations/034_session_approval_mode.sql"),
            kind: MigrationKind::Up,
        },
    ];

    // Pre-migration backup hook (B4 M8). Derived — not hard-coded —
    // from the migrations vec above so adding a new migration only
    // requires editing one place. Captured into the setup closure
    // below and evaluated BEFORE `tauri-plugin-sql` opens the DB.
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
        // true quit — `app.exit(0)` in tray.rs). Two flags are excluded on
        // purpose:
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
            get_supervisor_sop,
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
            set_width_menu_state,
            bulk_archive_sessions,
            bulk_unarchive_sessions,
            bulk_delete_sessions,
            // B3 M4a project CRUD
            list_projects,
            create_project,
            update_project,
            delete_project,
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
        .setup(move |_app| {
            use tauri::Manager;
            // Pre-migration backup (B4 M8 · invariant B4-I6). Runs
            // BEFORE `tauri-plugin-sql` opens the DB. We register the
            // SQL plugin below only after this guard succeeds, and its
            // preload then runs pending migrations. If the on-disk
            // schema is older than the latest we know about, we copy the
            // entire data dir to a sibling
            // `app.galley.backup.<utc-timestamp>/` first. A failure here
            // aborts startup — we'd rather refuse to open than attempt a
            // migration with no safety net.
            match migration_backup::ensure_backup_before_migrate(latest_migration_version) {
                Ok(outcome) => {
                    eprintln!("[backup] {outcome:?}");
                }
                Err(e) => {
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                    let data_dir = migration_backup::resolve_data_dir()
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|| "<unable to resolve app data dir>".into());
                    let msg = format!(
                        "Galley 无法启动：备份失败。\n\n{e}\n\n你的原始数据安全在：\n{data_dir}\n\n请检查磁盘空间或目录权限后重试。"
                    );
                    eprintln!("[backup] FATAL: {e}");
                    let _ = _app
                        .dialog()
                        .message(&msg)
                        .kind(MessageDialogKind::Error)
                        .title("Galley")
                        .blocking_show();
                    std::process::exit(2);
                }
            }

            // v0.2.9 repair guard: tauri-plugin-sql/sqlx runs SQLite
            // migrations inside a DDL transaction, which makes the
            // `PRAGMA foreign_keys = OFF` in table-rebuild migrations
            // ineffective. If 021/023 have not yet run, apply pending
            // migrations through 023 on a non-transactional connection
            // before the plugin can cascade-delete child rows.
            match migration_backup::ensure_safe_rebuild_migrations_before_plugin(
                latest_migration_version,
            ) {
                Ok(outcome) => {
                    eprintln!("[migration-guard] {outcome:?}");
                }
                Err(e) => {
                    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                    let data_dir = migration_backup::resolve_data_dir()
                        .map(|p| p.display().to_string())
                        .unwrap_or_else(|| "<unable to resolve app data dir>".into());
                    let msg = format!(
                        "Galley 无法启动：数据库安全迁移失败。\n\n{e}\n\n你的原始数据已保留在迁移备份中，当前数据目录是：\n{data_dir}\n\n请先不要删除 app.galley.backup.* 目录。"
                    );
                    eprintln!("[migration-guard] FATAL: {e}");
                    let _ = _app
                        .dialog()
                        .message(&msg)
                        .kind(MessageDialogKind::Error)
                        .title("Galley")
                        .blocking_show();
                    std::process::exit(2);
                }
            }

            // Register the SQL plugin only after the backup gate. The
            // plugin is configured with `plugins.sql.preload` in
            // tauri.conf.json, so registration immediately opens
            // `workbench.db` and runs pending migrations. GUI code no
            // longer calls the SQL plugin directly; Galley Core owns all
            // DB reads/writes, while this Rust-side plugin registration
            // remains the migration runner.
            _app.handle().plugin(
                tauri_plugin_sql::Builder::default()
                    .add_migrations(DB_URL, migrations)
                    .build(),
            )?;

            // Best-effort data repair for users who already launched the
            // bad v0.2.9 transactional rebuild. The pre-migration backup
            // contains the deleted child rows; restore only rows whose
            // parent session/goal still exists in the active DB.
            match migration_backup::recover_cascaded_rows_from_backups() {
                Ok(outcome) => eprintln!("[backup-recovery] {outcome:?}"),
                Err(e) => eprintln!("[backup-recovery] skipped: {e}"),
            }

            // Open the shared SqliteGalley pool ONCE and manage it as
            // Tauri state. Previously every Tauri command called
            // `SqliteGalley::open()` on its own, building a fresh
            // `max_connections(4)` pool per invocation. The pool is
            // cheap to clone (Arc-shared) so commands now take a
            // `State<'_, SqliteGalley>` handle instead.
            //
            // This runs AFTER the SQL plugin above opened `workbench.db`
            // and ran migrations, so the file is guaranteed to exist
            // here (the only prior failure mode for `open()`). WAL is
            // set by `SqliteConnectOptions` and persists in the DB
            // header, so this single open also flips the file into WAL
            // mode for the plugin's subsequent connections.
            let shared_galley = tauri::async_runtime::block_on(async {
                SqliteGalley::open().await
            })
            .map_err(stringify_error)?;
            _app.manage(shared_galley);

            // Seed the first-close-choice guard from the persisted
            // flag, now that the SQL plugin above has run migrations
            // and the `prefs` table exists. This must happen before the
            // window can receive `CloseRequested` (the close handler is
            // registered later in this same setup, but the event can't
            // fire until the event loop starts after setup returns).
            // Seeding here — not at GUI hydrate — closes the race where
            // a returning user who closes the window before hydrate
            // completes would otherwise be asked the "one-time"
            // first-close question again. macOS/Windows only: the
            // dialog flow and its handler don't exist elsewhere.
            // Best-effort: a read failure leaves the guard `false`,
            // whose worst case is asking once more, never a wrong-exit
            // regression.
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            {
                let seen = tauri::async_runtime::block_on(async {
                    let galley = _app
                        .state::<SqliteGalley>()
                        .inner()
                        .clone();
                    let value = galley.get_pref_json(FIRST_CLOSE_CHOICE_PREF).await.ok()?;
                    value.and_then(|v| v.as_bool())
                });
                if seen == Some(true) {
                    FIRST_CLOSE_CHOICE_MADE.store(true, Ordering::SeqCst);
                }

                // Same seeding rationale for the "keep in background on
                // close" preference: the CloseRequested callback reads
                // the atomic synchronously, so it must hold the persisted
                // value before the window can be closed. Read failure
                // leaves the default `true` (historical Background Mode)
                // — never a surprise-quit regression.
                let keep_in_background = tauri::async_runtime::block_on(async {
                    let galley = _app
                        .state::<SqliteGalley>()
                        .inner()
                        .clone();
                    let value = galley.get_pref_json(KEEP_IN_BACKGROUND_PREF).await.ok()?;
                    value.and_then(|v| v.as_bool())
                });
                if keep_in_background == Some(false) {
                    KEEP_IN_BACKGROUND_ON_CLOSE.store(false, Ordering::SeqCst);
                }
            }

            // Start the local socket listener (Unix socket on macOS/Linux,
            // Windows named pipe on Windows). CLI clients connect here to
            // send write commands + watch event streams from B2 M4 onward.
            // Per AGENTS.md § Localhost Only: fs-perm
            // auth, no TCP / token. If another instance owns the socket,
            // start() asks that instance to show its window and this
            // duplicate startup exits before creating more background work.
            // Other bind failures remain non-fatal — CLI clients will see
            // exit 4 in that case.
            //
            // The guard is managed in app state so its Drop runs at app
            // teardown, unlinking the socket file on Unix.
            {
                use tauri::Manager;
                // Pull the shared RunnerManager out of state to hand to the
                // socket listener — the listener's dispatch tasks need to
                // call into the SAME manager that Tauri commands use.
                let manager: std::sync::Arc<runner_manager::RunnerManager> = _app
                    .state::<std::sync::Arc<runner_manager::RunnerManager>>()
                    .inner()
                    .clone();
                let app_for_socket = _app.handle().clone();
                match tauri::async_runtime::block_on(socket_listener::start(
                    app_for_socket,
                    manager,
                )) {
                    Ok(guard) => {
                        if guard.another_instance_is_active() {
                            _app.handle().exit(0);
                            return Ok(());
                        }
                        _app.manage(guard);
                    }
                    Err(e) => {
                        eprintln!("[socket] start failed (non-fatal): {e}");
                    }
                }
            }

            // Discovery file write (B4 M3 T3.1). Supervisor SOPs read
            // `~/.config/galley/cli-path` (macOS/Linux) or
            // `%APPDATA%\galley\cli-path` (Windows) to find the CLI
            // binary's absolute path. All branches non-fatal — Galley
            // works without it; only SOPs are affected.
            {
                use crate::discovery::{write_discovery_file, DiscoveryOutcome};
                match write_discovery_file() {
                    DiscoveryOutcome::Written { path, cli_path } => {
                        eprintln!(
                            "[discovery] wrote {} → {}",
                            path.display(),
                            cli_path.display()
                        );
                    }
                    DiscoveryOutcome::NoOp { path } => {
                        eprintln!("[discovery] {} already up-to-date", path.display());
                    }
                    DiscoveryOutcome::CliBinaryNotFound { searched } => {
                        eprintln!(
                            "[discovery] CLI binary not found at {} — supervisor SOPs will fail discovery; package or dev build is missing the galley CLI sibling",
                            searched.display()
                        );
                    }
                    DiscoveryOutcome::ConfigDirUnresolvable { reason } => {
                        eprintln!(
                            "[discovery] config dir unresolvable: {reason} — discovery file not written"
                        );
                    }
                    DiscoveryOutcome::MkdirFailed { path, reason } => {
                        eprintln!(
                            "[discovery] mkdir {} failed: {reason}",
                            path.display()
                        );
                    }
                    DiscoveryOutcome::WriteFailed { path, reason } => {
                        eprintln!(
                            "[discovery] write {} failed: {reason}",
                            path.display()
                        );
                    }
                }
            }

            {
                use tauri::Manager;
                let im_manager: std::sync::Arc<im_supervisor::ImSupervisorManager> = _app
                    .state::<std::sync::Arc<im_supervisor::ImSupervisorManager>>()
                    .inner()
                    .clone();
                let app_for_im = _app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    im_manager.autostart(app_for_im).await;
                });
            }

            // Re-spawn controllers for goals left active after a Core restart.
            // The controller is a detached process orphaned on restart; without
            // this an interrupted Goal stays `running` in the DB and, under the
            // single-active-Goal lock, blocks all new Goals.
            {
                use tauri::Manager;
                let galley_for_goals: SqliteGalley =
                    _app.state::<SqliteGalley>().inner().clone();
                tauri::async_runtime::spawn(async move {
                    desktop_goal::resume_active_goals(&galley_for_goals).await;
                });
            }

            // Windows-only custom chrome: drop native decorations and
            // restore the drop shadow via window-shadows-v2 so the borderless
            // window doesn't look like a flat rectangle. Mac keeps its
            // titleBarStyle: "Overlay" from tauri.conf.json — this block
            // is cfg-gated out at compile time on macOS, so the Mac binary
            // contains zero Windows-specific code.
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                use window_shadows_v2::set_shadows;
                let window = _app
                    .get_webview_window("main")
                    .expect("main webview window must exist at setup time");
                window
                    .set_decorations(false)
                    .expect("failed to disable native decorations on Windows");
                // window-shadows-v2 0.1.1: `set_shadows(&mut App, bool)`
                // — takes the App handle (not a window) and returns
                // unit `()`. Internally it iterates the app's windows
                // and applies DWM shadow to each.
                set_shadows(_app, true);
            }

            // Launch-at-login arrives with `--autostart` (baked into the
            // login item by the autostart plugin). Those launches stay
            // hidden in the tray / status item: the point of enabling
            // autostart is having Galley Core + channels waiting in the
            // background, not a window on every boot. The main window is
            // created hidden (tauri.conf.json `visible: false`) and shown
            // below for every normal launch, so autostart never flashes
            // a frame.
            let autostart_launch = std::env::args().any(|arg| arg == "--autostart");

            // Background Mode. macOS shows the Galley status item in
            // the right-side menu bar; Windows shows the same menu in
            // the system tray. Closing the window hides it instead of
            // tearing down Galley Core, so CLI / Supervisor / IM
            // actions keep reaching the local socket.
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                use tauri::{Emitter, Manager, WindowEvent};

                let tray_toggle = MenuItem::with_id(
                    _app,
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
                _app.manage(TrayMenuState {
                    toggle_window_item: tray_toggle.clone(),
                });
                let tray_new_chat =
                    MenuItem::with_id(_app, "tray_new_chat", "New Chat", true, None::<&str>)?;
                let tray_settings =
                    MenuItem::with_id(_app, "tray_settings", "Settings...", true, None::<&str>)?;
                let tray_check_updates = MenuItem::with_id(
                    _app,
                    "tray_check_updates",
                    "Check for Updates…",
                    true,
                    None::<&str>,
                )?;
                let tray_quit =
                    MenuItem::with_id(_app, "tray_quit", "Quit Galley", true, None::<&str>)?;
                let tray_primary_separator = PredefinedMenuItem::separator(_app)?;
                let tray_quit_separator = PredefinedMenuItem::separator(_app)?;
                let tray_menu = Menu::with_items(
                    _app,
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
                        _app.default_window_icon()
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
                            if button == MouseButton::Right
                                && button_state == MouseButtonState::Down
                            {
                                show_main_window(tray.app_handle());
                            }

                            #[cfg(target_os = "windows")]
                            if button == MouseButton::Left
                                && button_state == MouseButtonState::Up
                            {
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
                let _tray = tray_builder.build(_app)?;

                let window = _app
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
                            request_true_quit(
                                window_for_close.app_handle().clone(),
                                true,
                            );
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
                            let _ = window_for_close
                                .emit(FIRST_CLOSE_REQUESTED_EVENT, ());
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
                _app.on_menu_event(move |app, event| {
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
                            if let Some(state) = app.try_state::<WidthMenuState>() {
                                state.set_width("compact");
                            }
                            let _ = app.emit("menu:width_compact", ());
                        }
                        "width_wide" => {
                            #[cfg(target_os = "macos")]
                            if let Some(state) = app.try_state::<WidthMenuState>() {
                                state.set_width("wide");
                            }
                            let _ = app.emit("menu:width_wide", ());
                        }
                        "tray_toggle_window" => {
                            toggle_main_window(app);
                        }
                        "quit_galley" | "tray_quit" => {
                            request_true_quit(app.clone(), true);
                        }
                        "github" => {
                            let _ = app.opener().open_url(
                                "https://github.com/wangjc683/galley",
                                None::<&str>,
                            );
                        }
                        "issues" => {
                            let _ = app.opener().open_url(
                                "https://github.com/wangjc683/galley/issues",
                                None::<&str>,
                            );
                        }
                        _ => {}
                    }
                });
            }

            // Platforms without a tray (not a v0.2 target, but keep the
            // window reachable): always show — a hidden window with no
            // tray would be unrecoverable.
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                use tauri::Manager;
                let _ = autostart_launch;
                if let Some(window) = _app.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.show();
                }
            }

            // macOS-only top menu bar. On macOS apps that don't install
            // a menu look "half-native" — the menu bar shows generic
            // Tauri default entries. We install a Galley-specific menu
            // that mirrors the in-app actions (Settings / New Chat /
            // Check for Updates / Conversation Width) plus standard
            // system items (Hide / Quit / Cut / Copy / Paste /
            // Minimize / Zoom).
            //
            // Custom menu items emit `menu:<id>` events; App.tsx
            // listens and routes them to the matching frontend actions.
            // Predefined items (Hide / Copy / etc.) are handled by the
            // OS directly and need no JS wiring. Quit is custom so it can
            // clean up runners first.
            //
            // Win/Linux don't get a menu — Win uses our custom chrome
            // (decorations off, no native menu bar surface) and Linux
            // isn't a v0.2 target. Windows users reach the same lifecycle
            // actions through the tray menu and custom chrome.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{
                    AboutMetadataBuilder, CheckMenuItemBuilder, MenuBuilder,
                    MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
                };

                let about_metadata = AboutMetadataBuilder::new()
                    .name(Some("Galley"))
                    .version(Some(env!("CARGO_PKG_VERSION")))
                    .credits(Some("Made by JC Wang".to_string()))
                    .website(Some("https://github.com/wangjc683/galley".to_string()))
                    .website_label(Some("GitHub".to_string()))
                    .build();

                let app_submenu = SubmenuBuilder::new(_app, "Galley")
                    .item(&PredefinedMenuItem::about(
                        _app,
                        Some("About Galley"),
                        Some(about_metadata),
                    )?)
                    .item(
                        &MenuItemBuilder::new("Check for Updates…")
                            .id("check_updates")
                            .build(_app)?,
                    )
                    .separator()
                    .item(
                        &MenuItemBuilder::new("Settings…")
                            .id("settings")
                            .accelerator("Cmd+,")
                            .build(_app)?,
                    )
                    .separator()
                    .item(&PredefinedMenuItem::services(_app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::hide(_app, None)?)
                    .item(&PredefinedMenuItem::hide_others(_app, None)?)
                    .item(&PredefinedMenuItem::show_all(_app, None)?)
                    .separator()
                    .item(
                        &MenuItemBuilder::new("Quit Galley")
                            .id("quit_galley")
                            .accelerator("Cmd+Q")
                            .build(_app)?,
                    )
                    .build()?;

                let file_submenu = SubmenuBuilder::new(_app, "File")
                    .item(
                        &MenuItemBuilder::new("New Chat")
                            .id("new_chat")
                            .accelerator("Cmd+N")
                            .build(_app)?,
                    )
                    .separator()
                    .item(&PredefinedMenuItem::close_window(_app, None)?)
                    .build()?;

                let edit_submenu = SubmenuBuilder::new(_app, "Edit")
                    .item(&PredefinedMenuItem::undo(_app, None)?)
                    .item(&PredefinedMenuItem::redo(_app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::cut(_app, None)?)
                    .item(&PredefinedMenuItem::copy(_app, None)?)
                    .item(&PredefinedMenuItem::paste(_app, None)?)
                    .item(&PredefinedMenuItem::select_all(_app, None)?)
                    .build()?;

                // Check items (radio semantics: exactly one checked) so
                // the open menu reflects the active width. Initial state
                // matches the prefs-store default ("compact"); the GUI
                // re-syncs via `set_width_menu_state` at hydrate and on
                // every width change.
                let width_compact_item = CheckMenuItemBuilder::new("Compact (760px)")
                    .id("width_compact")
                    .checked(true)
                    .build(_app)?;
                let width_wide_item = CheckMenuItemBuilder::new("Wide (1200px)")
                    .id("width_wide")
                    .checked(false)
                    .build(_app)?;
                let width_submenu = SubmenuBuilder::new(_app, "Conversation Width")
                    .item(&width_compact_item)
                    .item(&width_wide_item)
                    .build()?;
                _app.manage(WidthMenuState {
                    compact: width_compact_item,
                    wide: width_wide_item,
                });

                // No Sidebar toggle here on purpose: the sidebar is not
                // collapsible by product decision (multi-session IS the
                // product shape — see docs/design/layout-and-chrome.md).
                let view_submenu = SubmenuBuilder::new(_app, "View")
                    .item(&width_submenu)
                    .separator()
                    .item(&PredefinedMenuItem::fullscreen(_app, None)?)
                    .build()?;

                let window_submenu = SubmenuBuilder::new(_app, "Window")
                    .item(&PredefinedMenuItem::minimize(_app, None)?)
                    .item(&PredefinedMenuItem::maximize(_app, Some("Zoom"))?)
                    .separator()
                    .item(&PredefinedMenuItem::bring_all_to_front(_app, None)?)
                    .build()?;

                let help_submenu = SubmenuBuilder::new(_app, "Help")
                    .item(
                        &MenuItemBuilder::new("Galley on GitHub")
                            .id("github")
                            .build(_app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("Report a Bug")
                            .id("issues")
                            .build(_app)?,
                    )
                    .build()?;

                let menu = MenuBuilder::new(_app)
                    .item(&app_submenu)
                    .item(&file_submenu)
                    .item(&edit_submenu)
                    .item(&view_submenu)
                    .item(&window_submenu)
                    .item(&help_submenu)
                    .build()?;

                _app.set_menu(menu)?;

                // Register with NSApp so AppKit augments the standard
                // menus: the Window menu gets the open-window list plus
                // system items (Sequoia window tiling lives there), and
                // the Help menu gets the native search field. Help would
                // otherwise only be picked up by AppKit's title
                // heuristic, which matches the *localized* word "Help"
                // and silently fails on non-English system languages.
                window_submenu.set_as_windows_menu_for_nsapp()?;
                help_submenu.set_as_help_menu_for_nsapp()?;
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                tauri::RunEvent::ExitRequested { api, code, .. } => {
                    if ALLOW_APP_EXIT.load(Ordering::SeqCst)
                        || code == Some(tauri::RESTART_EXIT_CODE)
                    {
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
        });
}
