pub mod api;
mod app_paths;
pub mod app_update;
pub mod browser_control;
pub mod codex_oauth;
mod commands;
pub mod conversation_image;
pub mod credential_store;
pub mod db;
pub mod discovery;
pub mod error;
pub mod im_supervisor;
pub mod ipc;
pub mod managed_model_config;
pub mod managed_model_probe;
mod managed_prompt;
pub mod managed_runtime;
pub mod migration_backup;
pub mod native_model;
pub mod native_runtime;
pub mod native_tools;
pub mod path_install;
mod process_command;
pub mod runner_commands;
pub mod runner_manager;
pub mod runtime;
pub mod socket_listener;
pub mod sop_install;

use api::{
    CreateGoalProposalInput, GalleyApi, GoalBrief, GoalLocale, GoalStatus, GoalWriteMode,
    MessageBrief, Origin, ProjectId, RuntimeKind, SessionId,
};
use commands::*;
use db::SqliteGalley;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri_plugin_sql::{Migration, MigrationKind};

/// SQLite filename. Resolved by tauri-plugin-sql relative to the
/// platform's app-data directory:
///
///   macOS:  ~/Library/Application Support/app.galley/
///
/// Schema lives in core/migrations/001_init.sql; tauri-plugin-sql
/// runs Up migrations in version order on first connect.
const DB_URL: &str = "sqlite:workbench.db";
const MAIN_WINDOW_LABEL: &str = "main";

/// Galley's own copy of the Hive master SOP, embedded at compile time.
/// Managed GA reads its (self-evolvable) seeded memory copy; attach GA
/// can't read that and Galley must not seed the user's GA checkout
/// (Rule 1), so its master reads this Galley-owned materialized copy.
const GOAL_HIVE_MASTER_DUTY_SOP: &str =
    include_str!("../../managed-ga/state-seed/memory/goal_hive_master_duty.md");

/// Absolute path to Galley's materialized Hive master SOP copy. Pure
/// path computation (no filesystem touch) so prompt builders can embed
/// the read path without side effects.
pub fn goal_master_duty_sop_path() -> Option<std::path::PathBuf> {
    app_paths::goal_runtime_dir().map(|dir| dir.join("master_duty.md"))
}

/// Materialize Galley's embedded Hive master SOP to its data-dir copy
/// (idempotent overwrite, keeping it in sync with the binary). Returns
/// the path on success. Called by the Goal controller before attach-mode
/// master planning so the attach master has a Galley-owned file to read.
pub fn ensure_goal_master_duty_sop() -> Option<std::path::PathBuf> {
    let path = goal_master_duty_sop_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }
    std::fs::write(&path, GOAL_HIVE_MASTER_DUTY_SOP).ok()?;
    Some(path)
}
const TRAY_SHOW_GALLEY_LABEL: &str = "Open Galley";
const TRAY_HIDE_GALLEY_LABEL: &str = "Hide Galley";

static QUIT_REQUEST_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
static ALLOW_APP_EXIT: AtomicBool = AtomicBool::new(false);

/// Pref key recording whether the one-time "Galley keeps running in the
/// background after you close the window" hint has been shown on this
/// device. Written by the close handler the first time the window is
/// hidden to background (see `CloseRequested`). Mirrors the
/// `yolo_intro_seen` disclosure-once pattern.
const CLOSE_HINT_SEEN_PREF: &str = "close_to_background_hint_seen";

/// Process-local guard so the background hint fires at most once per
/// launch even under rapid repeated close events. Seeded from the
/// persisted `CLOSE_HINT_SEEN_PREF` during `setup` (right after the SQL
/// plugin runs migrations), so a returning user who already dismissed
/// the hint is protected even if they close the window before the GUI
/// finishes hydrating. The close handler reads this guard, not the DB,
/// because it runs synchronously inside the window-event callback.
static CLOSE_HINT_SHOWN: AtomicBool = AtomicBool::new(false);

struct TrayMenuState {
    toggle_window_item: tauri::menu::MenuItem<tauri::Wry>,
}

/// Localized copy for the background-mode close hint dialog. The close
/// handler is a synchronous window-event callback and can't await a
/// pref read or reach into GUI i18n, so the localized strings are
/// pushed from the frontend (hydrate + on language change) via
/// `set_close_hint_copy` and parked here. Defaults to English so the
/// dialog is still coherent if the frontend hasn't pushed yet.
struct CloseHintCopy {
    title: Mutex<String>,
    body: Mutex<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartDesktopGoalInput {
    objective: String,
    #[serde(default)]
    project_id: Option<ProjectId>,
    master_session_id: SessionId,
    #[serde(default)]
    runtime_kind: Option<RuntimeKind>,
    #[serde(default)]
    budget_seconds: Option<u32>,
    #[serde(default)]
    worker_limit: Option<u32>,
    /// Display name of the model the operator picked in the Composer at
    /// launch (case-insensitive). Best-effort applied to the master
    /// session's LLM so its bridge — and, via inheritance, the goal's
    /// worker sessions — run on the chosen model instead of the GA
    /// default. Resolution failure never blocks the launch.
    #[serde(default)]
    llm_name: Option<String>,
    /// Operator's resolved UI locale (`zh-CN` / `en-US`) at launch.
    /// Selects the language of the Galley-authored system narration the
    /// Core launch ack and the CLI controller persist into the master
    /// session, which Rust can't pull from GUI i18n. Omitted → Chinese
    /// (the surface's original behavior).
    #[serde(default)]
    locale: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartDesktopGoalResult {
    goal: GoalBrief,
    /// The user's objective, persisted as the master session's first
    /// user turn (the human's own words — no Galley framing).
    objective_message: MessageBrief,
    /// Galley's launch acknowledgement, persisted as a `system`
    /// narration turn right after the objective.
    master_message: MessageBrief,
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

fn show_main_window(app: &tauri::AppHandle<tauri::Wry>) {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        set_tray_window_visible(app, true);
    }
}

fn toggle_main_window(app: &tauri::AppHandle<tauri::Wry>) {
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
fn maybe_show_background_hint(app: &tauri::AppHandle<tauri::Wry>) {
    use tauri::Manager;

    if CLOSE_HINT_SHOWN.swap(true, Ordering::SeqCst) {
        return;
    }

    // Persist the seen flag so it survives the next launch. Best-effort:
    // a write failure only means the hint may show once more, never an
    // exit-path regression.
    tauri::async_runtime::spawn(async move {
        if let Ok(galley) = SqliteGalley::open().await {
            let _ = galley
                .set_pref_json(CLOSE_HINT_SEEN_PREF, serde_json::json!(true))
                .await;
        }
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

fn request_true_quit<R: tauri::Runtime>(app: tauri::AppHandle<R>, confirm_if_busy: bool) {
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

fn tray_icon_image() -> tauri::Result<tauri::image::Image<'static>> {
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
#[tauri::command]
fn set_close_hint_copy(title: String, body: String, copy: tauri::State<'_, CloseHintCopy>) {
    if let Ok(mut guard) = copy.title.lock() {
        *guard = title;
    }
    if let Ok(mut guard) = copy.body.lock() {
        *guard = body;
    }
}

#[tauri::command]
async fn start_desktop_goal(
    input: StartDesktopGoalInput,
) -> std::result::Result<StartDesktopGoalResult, String> {
    let galley = SqliteGalley::open().await.map_err(stringify_error)?;
    let master_session_id = input.master_session_id.clone();
    let launch_llm_name = input.llm_name.clone();
    let locale = GoalLocale::parse(input.locale.as_deref());
    let proposal = galley
        .create_goal_proposal(
            CreateGoalProposalInput {
                objective: input.objective.clone(),
                project_id: input.project_id,
                master_session_id: Some(master_session_id.clone()),
                budget_seconds: input.budget_seconds,
                worker_limit: input.worker_limit,
                runtime_kind: input.runtime_kind.or(Some(RuntimeKind::Managed)),
                write_mode: Some(GoalWriteMode::Autonomous),
                expires_in_seconds: None,
            },
            Origin::gui(),
        )
        .await
        .map_err(stringify_error)?;
    let goal = galley
        .start_goal_from_proposal(proposal.id, proposal.internal_confirm_token, Origin::gui())
        .await
        .map_err(stringify_error)?;
    // Best-effort: apply the operator's chosen model to the master
    // session so its bridge — and, via inheritance, the goal's worker
    // sessions — run on it rather than the GA default. A resolution miss
    // (empty LLM cache / unknown name) must never block the launch.
    if let Some(name) = launch_llm_name
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        match crate::socket_listener::resolve_llm_selection_for_runtime(
            &galley,
            Some(name.to_string()),
            goal.runtime_kind,
        )
        .await
        {
            Ok(sel) => {
                if let Err(e) = galley
                    .set_session_llm(
                        master_session_id.clone(),
                        sel.index,
                        sel.key,
                        sel.display_name,
                    )
                    .await
                {
                    eprintln!("[goal] set master session llm failed: {e:?}");
                }
            }
            Err(e) => eprintln!("[goal] resolve launch llm '{name}' failed: {e:?}"),
        }
    }
    // The objective is the user's own words → a normal user turn.
    let objective_message = galley
        .send_message(
            master_session_id.clone(),
            input.objective.trim().to_string(),
            Origin::gui(),
        )
        .await
        .map_err(stringify_error)?;
    // Galley's launch acknowledgement → system narration, so it reads
    // as Galley speaking, not the operator. Gives immediate feedback
    // before the first controller checkpoint lands and anchors the
    // "results return here" promise inside the session.
    let master_message = galley
        .send_system_message(
            master_session_id,
            api::goal_launch_ack(locale).to_string(),
            Origin::gui(),
        )
        .await
        .map_err(stringify_error)?;

    if let Err(message) = spawn_goal_controller(&goal, locale) {
        let _ = galley
            .update_goal_state(goal.id.clone(), GoalStatus::Failed, Some(message.clone()))
            .await;
        return Err(message);
    }

    Ok(StartDesktopGoalResult {
        goal,
        objective_message,
        master_message,
    })
}

fn spawn_goal_controller(goal: &GoalBrief, locale: GoalLocale) -> std::result::Result<(), String> {
    let cli = discovery::locate_cli_binary().ok_or_else(|| {
        "Galley CLI binary was not found next to the desktop app; cannot start Goal controller."
            .to_string()
    })?;
    let mut cmd = tokio::process::Command::new(cli);
    cmd.arg("goal")
        .arg("run")
        .arg(goal.id.as_str())
        .arg("--resume")
        .arg("--locale")
        .arg(locale.as_tag())
        .arg("--supervisor")
        .arg("galley-desktop")
        .arg("--reason")
        .arg("desktop Goal Send")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    process_command::configure_background(&mut cmd);
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not start Galley Goal controller: {e}"))
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
        .plugin(tauri_plugin_updater::Builder::new().build())
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
        // Localized copy for the background-mode close hint, pushed from
        // the GUI (hydrate + on language change). Managed on every
        // platform because `set_close_hint_copy` is registered for all
        // targets; the close handler that consumes it is macOS/Windows
        // only. Defaults to English until the GUI pushes.
        .manage(CloseHintCopy::default())
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
            native_session_run_turn,
            native_approval_response,
            get_pref_json,
            set_pref_json,
            set_close_hint_copy,
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
            goal_status,
            goal_workspace_has_files,
            mark_goal_result_seen,
            request_goal_stop,
            start_desktop_goal,
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

            // Seed the background-mode close-hint guard from the
            // persisted seen flag, now that the SQL plugin above has run
            // migrations and the `prefs` table exists. This must happen
            // before the window can receive `CloseRequested` (the close
            // handler is registered later in this same setup, but the
            // event can't fire until the event loop starts after setup
            // returns). Seeding here — not at GUI hydrate — closes the
            // race where a returning user who closes the window before
            // hydrate completes would otherwise see the "one-time" hint
            // again. macOS/Windows only: the hint and its handler don't
            // exist elsewhere. Best-effort: a read failure leaves the
            // guard `false`, whose worst case is one extra hint, never a
            // wrong-exit regression.
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            {
                let seen = tauri::async_runtime::block_on(async {
                    let galley = SqliteGalley::open().await.ok()?;
                    let value = galley.get_pref_json(CLOSE_HINT_SEEN_PREF).await.ok()?;
                    value.and_then(|v| v.as_bool())
                });
                if seen == Some(true) {
                    CLOSE_HINT_SHOWN.store(true, Ordering::SeqCst);
                }
            }

            // Start the local socket listener (Unix socket on macOS/Linux,
            // Windows named pipe on Windows). CLI clients connect here to
            // send write commands + watch event streams from B2 M4 onward.
            // Per AGENTS.md § Localhost Only: fs-perm
            // auth, no TCP / token. If bind fails or another instance
            // owns the socket, start() returns a dormant guard and Galley
            // Core keeps running — CLI clients will see exit 4 in that case.
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
                    TRAY_HIDE_GALLEY_LABEL,
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
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        if ALLOW_APP_EXIT.load(Ordering::SeqCst) {
                            return;
                        }
                        // Background Mode: hide instead of quit. Hide
                        // first so the close gesture feels instant, then
                        // surface the one-time hint explaining where the
                        // window went and how to truly quit.
                        api.prevent_close();
                        let _ = window_for_close.hide();
                        let _ = tray_toggle_for_close.set_text(TRAY_SHOW_GALLEY_LABEL);
                        maybe_show_background_hint(window_for_close.app_handle());
                    }
                });

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
                        "width_compact" => {
                            let _ = app.emit("menu:width_compact", ());
                        }
                        "width_wide" => {
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
                    AboutMetadataBuilder, MenuBuilder, MenuItemBuilder,
                    PredefinedMenuItem, SubmenuBuilder,
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
                    .separator()
                    // Find: V0.2 will wire to in-conversation search.
                    // Disabled in v0.1 so the shortcut shows but click
                    // is a no-op (same treatment as Toggle Sidebar).
                    .item(
                        &MenuItemBuilder::new("Find")
                            .id("find")
                            .accelerator("Cmd+F")
                            .enabled(false)
                            .build(_app)?,
                    )
                    .build()?;

                let width_submenu = SubmenuBuilder::new(_app, "Conversation Width")
                    .item(
                        &MenuItemBuilder::new("Compact (760px)")
                            .id("width_compact")
                            .build(_app)?,
                    )
                    .item(
                        &MenuItemBuilder::new("Wide (1200px)")
                            .id("width_wide")
                            .build(_app)?,
                    )
                    .build()?;

                let view_submenu = SubmenuBuilder::new(_app, "View")
                    // Toggle Sidebar: V0.1 placeholder — wiring lands
                    // in V0.2. Disabled so the shortcut shows but click
                    // is a no-op (consistent with Find).
                    .item(
                        &MenuItemBuilder::new("Toggle Sidebar")
                            .id("toggle_sidebar")
                            .accelerator("Cmd+\\")
                            .enabled(false)
                            .build(_app)?,
                    )
                    .item(&width_submenu)
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
