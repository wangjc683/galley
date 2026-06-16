use super::*;

/// Plain `Path::exists` check that bypasses `tauri-plugin-fs`'s
/// `fs:scope` glob allow-list.
///
/// **Why a custom command exists.** v0.1.0-alpha.1 Windows users
/// reported the Onboarding health check failing on the very first row
/// ("GA 路径存在") for any GA install outside the user-profile tree —
/// e.g. `D:\projects_2026\GenericAgent`, external SSDs, `/opt/...`.
/// `tauri-plugin-fs`'s scope was set to `$HOME/**`, `$DOCUMENT/**`,
/// `$DESKTOP/**`, `$DOWNLOAD/**` (defaults inherited from Tauri's
/// sandboxed-web-content threat model); paths outside those globs
/// throw a permission error that our `fsExists` catches and reports
/// as "path does not exist", which is technically wrong and
/// operationally a dead-end (no app-visible way to widen the scope).
///
/// Galley is a trusted desktop tool: the dist is statically bundled,
/// loads no remote content, and the only paths it ever inspects come
/// from a user-driven OS picker or input box. The web-sandbox threat
/// model doesn't apply. Rather than widening `fs:scope` to `**` (and
/// inheriting glob-on-Windows quirks plus a wide write surface for
/// any future plugin-fs usage), this command exposes one narrow read
/// — boolean existence — directly from Rust, where `std::path::Path`
/// handles cross-platform separators correctly and no scope check
/// runs. JS callers route through `invoke("path_exists", ...)`
/// instead of `@tauri-apps/plugin-fs`'s `exists()`.
#[tauri::command]
pub(crate) fn path_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// Return the bundled Galley Supervisor SOP for copy / preview surfaces.
/// The GUI deliberately copies this text to the clipboard instead of
/// writing into GenericAgent `memory/`; the user decides which agent
/// receives the SOP.
#[tauri::command]
pub(crate) fn get_supervisor_sop() -> String {
    sop_install::sop_body().to_string()
}

/// B4 M3 T3.3 — query whether `/usr/local/bin/galley` exists and
/// matches the CLI binary we'd install. No elevation required.
/// Wrapper over [`path_install::check_status`].
#[tauri::command]
pub(crate) fn check_path_install_status() -> path_install::PathInstallStatus {
    path_install::check_status()
}

/// B4 M3 T3.3 — create `/usr/local/bin/galley → <CLI absolute path>`
/// via an `osascript` admin-privileges shell-script call. The macOS
/// auth dialog appears synchronously; if the user cancels, the
/// outcome is `UserCancelled` (not an error). Wrapper over
/// [`path_install::install_to_path`].
#[tauri::command]
pub(crate) fn install_galley_to_path() -> path_install::PathInstallOutcome {
    path_install::install_to_path()
}

/// B4 M3 T3.3 — remove `/usr/local/bin/galley` via the same elevated
/// `osascript` path. Wrapper over [`path_install::uninstall_from_path`].
#[tauri::command]
pub(crate) fn uninstall_galley_from_path() -> path_install::PathUninstallOutcome {
    path_install::uninstall_from_path()
}

#[tauri::command]
pub(crate) fn ensure_managed_runtime_layout(
    app: tauri::AppHandle,
) -> std::result::Result<managed_runtime::ManagedRuntimeDiagnostics, String> {
    managed_runtime::ensure_for_app(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn ensure_browser_control_layout(
    app: tauri::AppHandle,
) -> std::result::Result<browser_control::BrowserControlLayout, String> {
    browser_control::ensure_for_app(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn probe_browser_control(
    app: tauri::AppHandle,
    context: Option<browser_control::BrowserControlProbeContext>,
) -> std::result::Result<browser_control::BrowserControlProbe, String> {
    browser_control::probe_for_app(app, context.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn open_browser_control_extensions_page(
    browser: browser_control::BrowserControlBrowser,
) -> std::result::Result<(), String> {
    browser_control::open_extensions_page(browser)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn open_browser_control_test_page(
    browser: browser_control::BrowserControlBrowser,
) -> std::result::Result<(), String> {
    browser_control::open_test_page(browser)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn get_im_supervisor_status(
    app: tauri::AppHandle,
    manager: tauri::State<'_, std::sync::Arc<im_supervisor::ImSupervisorManager>>,
    platform: String,
) -> std::result::Result<im_supervisor::ImSupervisorStatus, String> {
    manager.status(&app, platform).await
}

#[tauri::command]
pub(crate) async fn get_feishu_im_config(
) -> std::result::Result<im_supervisor::FeishuImConfig, String> {
    im_supervisor::get_feishu_im_config().await
}

#[tauri::command]
pub(crate) async fn save_feishu_im_config(
    input: im_supervisor::SaveFeishuImConfigInput,
) -> std::result::Result<im_supervisor::FeishuImConfig, String> {
    im_supervisor::save_feishu_im_config(input).await
}

#[tauri::command]
pub(crate) async fn delete_feishu_im_config(
    app: tauri::AppHandle,
    manager: tauri::State<'_, std::sync::Arc<im_supervisor::ImSupervisorManager>>,
) -> std::result::Result<im_supervisor::FeishuImConfig, String> {
    let _ = manager.logout(app, "feishu".into()).await;
    im_supervisor::get_feishu_im_config().await
}

#[tauri::command]
pub(crate) async fn start_im_supervisor(
    app: tauri::AppHandle,
    manager: tauri::State<'_, std::sync::Arc<im_supervisor::ImSupervisorManager>>,
    platform: String,
    relogin: bool,
) -> std::result::Result<im_supervisor::ImSupervisorStatus, String> {
    manager.inner().start(app, platform, relogin).await
}

#[tauri::command]
pub(crate) async fn stop_im_supervisor(
    app: tauri::AppHandle,
    manager: tauri::State<'_, std::sync::Arc<im_supervisor::ImSupervisorManager>>,
    platform: String,
) -> std::result::Result<im_supervisor::ImSupervisorStatus, String> {
    manager.stop(app, platform).await
}

#[tauri::command]
pub(crate) async fn logout_im_supervisor(
    app: tauri::AppHandle,
    manager: tauri::State<'_, std::sync::Arc<im_supervisor::ImSupervisorManager>>,
    platform: String,
) -> std::result::Result<im_supervisor::ImSupervisorStatus, String> {
    manager.logout(app, platform).await
}

#[tauri::command]
pub(crate) async fn restart_enabled_im_supervisors(
    app: tauri::AppHandle,
    manager: tauri::State<'_, std::sync::Arc<im_supervisor::ImSupervisorManager>>,
) -> std::result::Result<Vec<im_supervisor::ImSupervisorStatus>, String> {
    manager.inner().restart_enabled(app).await
}
