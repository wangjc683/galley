//! The Tauri `setup` hook body, extracted from `lib.rs::run`. Each
//! startup step is a named function in launch order; `setup_app` is the
//! only entry point. Ordering here is load-bearing — the migration
//! safety gates must run before the SQL plugin opens the DB, the shared
//! pool opens after migrations ran, and the close-pref seeding must
//! happen before the window can receive `CloseRequested`.

use tauri::Manager;
use tauri_plugin_sql::Migration;

use crate::commands::stringify_error;
use crate::db::SqliteGalley;
use crate::db_migrations::DB_URL;
use crate::{desktop_goal, im_supervisor, migration_backup, runner_manager, socket_listener, tray};

pub(crate) fn setup_app(
    app: &mut tauri::App,
    migrations: Vec<Migration>,
    latest_migration_version: i64,
) -> Result<(), Box<dyn std::error::Error>> {
    migration_safety_gates(app, latest_migration_version);
    register_sql_plugin_and_recover(app, migrations)?;
    open_shared_galley(app)?;
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    seed_close_prefs(app);
    if start_socket_listener(app) {
        // Another instance owns the socket and was asked to show its
        // window; this duplicate startup exits before creating more
        // background work.
        app.handle().exit(0);
        return Ok(());
    }
    write_cli_discovery_file();
    start_background_services(app);
    #[cfg(target_os = "windows")]
    apply_windows_custom_chrome(app);

    // Launch-at-login arrives with `--autostart` (baked into the
    // login item by the autostart plugin). Those launches stay
    // hidden in the tray / status item: the point of enabling
    // autostart is having Galley Core + channels waiting in the
    // background, not a window on every boot. The main window is
    // created hidden (tauri.conf.json `visible: false`) and shown
    // by `setup_background_mode` for every normal launch, so
    // autostart never flashes a frame.
    let autostart_launch = std::env::args().any(|arg| arg == "--autostart");

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    tray::setup_background_mode(app, autostart_launch)?;

    // Platforms without a tray (not a v0.2 target, but keep the
    // window reachable): always show — a hidden window with no
    // tray would be unrecoverable.
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = autostart_launch;
        if let Some(window) = app.get_webview_window(crate::MAIN_WINDOW_LABEL) {
            let _ = window.show();
        }
    }

    #[cfg(target_os = "macos")]
    crate::app_menu::install_macos_menu(app)?;

    Ok(())
}

/// Pre-migration backup (B4 M8 · invariant B4-I6) plus the v0.2.9
/// repair guard. Both run BEFORE `tauri-plugin-sql` opens the DB — the
/// SQL plugin is registered only after these gates succeed, and its
/// preload then runs pending migrations. A failure in either gate
/// aborts startup — we'd rather refuse to open than attempt a
/// migration with no safety net.
fn migration_safety_gates(app: &tauri::App, latest_migration_version: i64) {
    // If the on-disk schema is older than the latest we know about, we
    // copy the entire data dir to a sibling
    // `app.galley.backup.<utc-timestamp>/` first.
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
            let _ = app
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
    match migration_backup::ensure_safe_rebuild_migrations_before_plugin(latest_migration_version) {
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
            let _ = app
                .dialog()
                .message(&msg)
                .kind(MessageDialogKind::Error)
                .title("Galley")
                .blocking_show();
            std::process::exit(2);
        }
    }
}

/// Register the SQL plugin only after the backup gate. The plugin is
/// configured with `plugins.sql.preload` in tauri.conf.json, so
/// registration immediately opens `workbench.db` and runs pending
/// migrations. GUI code no longer calls the SQL plugin directly; Galley
/// Core owns all DB reads/writes, while this Rust-side plugin
/// registration remains the migration runner.
fn register_sql_plugin_and_recover(
    app: &tauri::App,
    migrations: Vec<Migration>,
) -> tauri::Result<()> {
    app.handle().plugin(
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

    Ok(())
}

/// Open the shared SqliteGalley pool ONCE and manage it as Tauri state.
/// Previously every Tauri command called `SqliteGalley::open()` on its
/// own, building a fresh `max_connections(4)` pool per invocation. The
/// pool is cheap to clone (Arc-shared) so commands now take a
/// `State<'_, SqliteGalley>` handle instead.
///
/// This runs AFTER the SQL plugin opened `workbench.db` and ran
/// migrations, so the file is guaranteed to exist here (the only prior
/// failure mode for `open()`). WAL is set by `SqliteConnectOptions` and
/// persists in the DB header, so this single open also flips the file
/// into WAL mode for the plugin's subsequent connections.
fn open_shared_galley(app: &tauri::App) -> Result<(), String> {
    let shared_galley = tauri::async_runtime::block_on(async { SqliteGalley::open().await })
        .map_err(stringify_error)?;
    app.manage(shared_galley);
    Ok(())
}

/// Seed the first-close-choice guard from the persisted flag, now that
/// the SQL plugin has run migrations and the `prefs` table exists. This
/// must happen before the window can receive `CloseRequested` (the
/// close handler is registered later in the same setup, but the event
/// can't fire until the event loop starts after setup returns). Seeding
/// here — not at GUI hydrate — closes the race where a returning user
/// who closes the window before hydrate completes would otherwise be
/// asked the "one-time" first-close question again. macOS/Windows only:
/// the dialog flow and its handler don't exist elsewhere. Best-effort:
/// a read failure leaves the guard `false`, whose worst case is asking
/// once more, never a wrong-exit regression.
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn seed_close_prefs(app: &tauri::App) {
    use std::sync::atomic::Ordering;

    use crate::api::GalleyApi;
    use crate::tray::{
        FIRST_CLOSE_CHOICE_MADE, FIRST_CLOSE_CHOICE_PREF, KEEP_IN_BACKGROUND_ON_CLOSE,
        KEEP_IN_BACKGROUND_PREF,
    };

    let seen = tauri::async_runtime::block_on(async {
        let galley = app.state::<SqliteGalley>().inner().clone();
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
        let galley = app.state::<SqliteGalley>().inner().clone();
        let value = galley.get_pref_json(KEEP_IN_BACKGROUND_PREF).await.ok()?;
        value.and_then(|v| v.as_bool())
    });
    if keep_in_background == Some(false) {
        KEEP_IN_BACKGROUND_ON_CLOSE.store(false, Ordering::SeqCst);
    }
}

/// Start the local socket listener (Unix socket on macOS/Linux, Windows
/// named pipe on Windows). CLI clients connect here to send write
/// commands + watch event streams from B2 M4 onward. Per AGENTS.md §
/// Localhost Only: fs-perm auth, no TCP / token. Returns `true` when
/// another instance owns the socket — start() asks that instance to
/// show its window and the caller must exit this duplicate startup.
/// Other bind failures remain non-fatal — CLI clients will see exit 4
/// in that case.
///
/// The guard is managed in app state so its Drop runs at app teardown,
/// unlinking the socket file on Unix.
fn start_socket_listener(app: &tauri::App) -> bool {
    // Pull the shared RunnerManager out of state to hand to the
    // socket listener — the listener's dispatch tasks need to
    // call into the SAME manager that Tauri commands use.
    let manager: std::sync::Arc<runner_manager::RunnerManager> = app
        .state::<std::sync::Arc<runner_manager::RunnerManager>>()
        .inner()
        .clone();
    let app_for_socket = app.handle().clone();
    match tauri::async_runtime::block_on(socket_listener::start(app_for_socket, manager)) {
        Ok(guard) => {
            if guard.another_instance_is_active() {
                return true;
            }
            app.manage(guard);
        }
        Err(e) => {
            eprintln!("[socket] start failed (non-fatal): {e}");
        }
    }
    false
}

/// Discovery file write (B4 M3 T3.1). Supervisor SOPs read
/// `~/.config/galley/cli-path` (macOS/Linux) or
/// `%APPDATA%\galley\cli-path` (Windows) to find the CLI binary's
/// absolute path. All branches non-fatal — Galley works without it;
/// only SOPs are affected.
fn write_cli_discovery_file() {
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
            eprintln!("[discovery] config dir unresolvable: {reason} — discovery file not written");
        }
        DiscoveryOutcome::MkdirFailed { path, reason } => {
            eprintln!("[discovery] mkdir {} failed: {reason}", path.display());
        }
        DiscoveryOutcome::WriteFailed { path, reason } => {
            eprintln!("[discovery] write {} failed: {reason}", path.display());
        }
    }
}

/// Fire-and-forget background services: IM supervisor autostart, and
/// re-spawning controllers for goals left active after a Core restart.
/// The goal controller is a detached process orphaned on restart;
/// without the resume an interrupted Goal stays `running` in the DB
/// and, under the single-active-Goal lock, blocks all new Goals.
fn start_background_services(app: &tauri::App) {
    let im_manager: std::sync::Arc<im_supervisor::ImSupervisorManager> = app
        .state::<std::sync::Arc<im_supervisor::ImSupervisorManager>>()
        .inner()
        .clone();
    let app_for_im = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        im_manager.autostart(app_for_im).await;
    });

    let galley_for_goals: SqliteGalley = app.state::<SqliteGalley>().inner().clone();
    tauri::async_runtime::spawn(async move {
        desktop_goal::resume_active_goals(&galley_for_goals).await;
    });

    crate::scheduler::start(app);
}

/// Windows-only custom chrome: drop native decorations and restore the
/// drop shadow via window-shadows-v2 so the borderless window doesn't
/// look like a flat rectangle. Mac keeps its titleBarStyle: "Overlay"
/// from tauri.conf.json — this function is cfg-gated out at compile
/// time on macOS, so the Mac binary contains zero Windows-specific
/// code.
#[cfg(target_os = "windows")]
fn apply_windows_custom_chrome(app: &mut tauri::App) {
    use window_shadows_v2::set_shadows;
    let window = app
        .get_webview_window("main")
        .expect("main webview window must exist at setup time");
    window
        .set_decorations(false)
        .expect("failed to disable native decorations on Windows");
    // window-shadows-v2 0.1.1: `set_shadows(&mut App, bool)`
    // — takes the App handle (not a window) and returns
    // unit `()`. Internally it iterates the app's windows
    // and applies DWM shadow to each.
    set_shadows(app, true);
}
