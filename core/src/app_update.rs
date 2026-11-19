//! In-app updater commands.
//!
//! An update is applied in two steps (2026-10-08):
//!
//! 1. `download_app_update` runs in the background: check the channel,
//!    download the package (`Update::download` verifies the signature),
//!    then park the verified package in [`PreparedAppUpdate`]. It stays in
//!    memory until restart (~100 MB on macOS, ~60 MB on Windows) and is
//!    never written to disk.
//! 2. `install_app_update` runs when the user clicks "Restart and Update":
//!    stop Galley's child processes, then `Update::install` the parked
//!    package. The GUI relaunches on macOS / Linux; on Windows `install`
//!    never returns (see below).
//!
//! Why child-process shutdown happens at install time, not after the
//! background download:
//!
//! - Windows needs it before `install`: the runners, IM channels and the
//!   browser bridge run Galley's bundled Python, whose `.pyd` / DLL files
//!   stay locked while loaded, so the installer fails to overwrite them
//!   (devlog 2026-06-03-windows-updater-file-lock).
//! - Windows `Update::install` launches the installer and then calls
//!   `std::process::exit(0)` (tauri-plugin-updater 2.10.1 `updater.rs`),
//!   so a background install closed the app out from under the user.
//! - macOS installs in place and keeps running, but the channels it stopped
//!   do not come back on their own (`im_supervisor::manager::wait_child`
//!   records them as Error) and the browser bridge stays down, so a
//!   background install left both dead until the user got around to
//!   restarting.
//!
//! Stopping children and installing only when the user asks for the
//! restart keeps the 06-03 file-lock fix and removes both side effects.
//!
//! Update proxy prefix (2026-11-19, issue #33; devlog
//! 2026-11-19-update-proxy): Settings → General may hold a prefix in pref
//! `update_proxy_prefix` for users who cannot reach GitHub. When it is set,
//! the manifest URL and the package URL both become
//! `<prefix><original URL>`, and two rules apply:
//!
//! - **Checking falls back.** The proxied manifest URL is checked first;
//!   if that fails, the original URL is checked once more, and if that
//!   fails too the proxied attempt's error is returned. Two separate
//!   checks, not one `endpoints` list: the plugin returns at once when an
//!   endpoint answers 200 with a body that is not JSON, without trying the
//!   next one.
//! - **Downloading does not.** Whichever URL the manifest came from, the
//!   package downloads through the prefix only; a failure is reported with
//!   that URL (`url=` in the error), not retried directly, so a user who
//!   cannot reach GitHub does not wait out a second timeout. The signature
//!   check is unchanged: the prefix can withhold an update but cannot
//!   swap the package.
//!
//! With no prefix, or one that is not valid (an `https` URL with a host,
//! no query and no fragment), nothing changes except that every check
//! now times out after [`CHECK_TIMEOUT`] (the download keeps no timeout).

use serde::Serialize;
use std::future::Future;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::api::GalleyApi;
use crate::db::SqliteGalley;

/// Broadcast event carrying updater download/install progress to the GUI.
/// Same emit-and-forget pattern as `im_supervisor::EVENT_NAME`.
const PROGRESS_EVENT: &str = "app-update-progress";

/// Pref holding the update proxy prefix (Settings → General), a JSON
/// string. Missing, empty, blank or invalid all mean off.
const UPDATE_PROXY_PREFIX_PREF: &str = "update_proxy_prefix";

/// Timeout of one update check. Without one, a proxied check that hangs
/// would never reach the direct fallback. It covers only the check: the
/// plugin builds the `Update` it returns with `timeout: None`
/// (tauri-plugin-updater 2.10.1 `Updater::check`), so the download stays
/// unbounded.
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

/// Error returned by `install_app_update` when nothing has been
/// downloaded yet (or the parked package was dropped). Stable string:
/// the GUI maps it to its own copy.
const NO_PREPARED_UPDATE: &str = "no_prepared_update";

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppUpdateCheckResult {
    Unconfigured {
        current_version: String,
    },
    UpToDate {
        current_version: String,
    },
    Available {
        current_version: String,
        version: String,
        body: Option<String>,
        date: Option<String>,
    },
}

/// Returned by both `download_app_update` and `install_app_update`:
/// `{ "currentVersion": string, "version": string }`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateVersions {
    current_version: String,
    version: String,
}

impl AppUpdateVersions {
    fn of(update: &Update) -> Self {
        Self {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
        }
    }
}

/// Tauri managed state: the downloaded, signature-verified update waiting
/// for the user's "Restart and Update" click. A newer download replaces
/// it; `install_app_update` takes it out.
#[derive(Default)]
pub struct PreparedAppUpdate(PreparedSlot<PreparedPackage>);

struct PreparedPackage {
    update: Update,
    bytes: Vec<u8>,
}

/// Single-value holder behind [`PreparedAppUpdate`]. Generic only so the
/// slot rules are unit-testable without a real `Update`. The lock is
/// never held across an `.await`.
struct PreparedSlot<T>(Mutex<Option<T>>);

impl<T> Default for PreparedSlot<T> {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

impl<T> PreparedSlot<T> {
    fn lock(&self) -> std::sync::MutexGuard<'_, Option<T>> {
        // A panic while holding the lock cannot leave `Option` half-written.
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Stores `value`, dropping whatever was parked before.
    fn put(&self, value: T) {
        *self.lock() = Some(value);
    }

    /// Removes and returns the parked value, or `no_prepared_update`.
    fn take(&self) -> Result<T, String> {
        self.lock()
            .take()
            .ok_or_else(|| NO_PREPARED_UPDATE.to_string())
    }

    /// Puts `value` back after a failed install, unless a download that
    /// finished meanwhile already parked a newer one.
    fn restore_if_empty(&self, value: T) {
        let mut slot = self.lock();
        if slot.is_none() {
            *slot = Some(value);
        }
    }

    fn clear(&self) {
        *self.lock() = None;
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum AppUpdateProgressEvent {
    Downloading { downloaded: u64, total: Option<u64> },
    Installing,
}

/// Caps progress-event frequency: emit on the first chunk, on any
/// integer-percent change, or after `MIN_INTERVAL` — whichever comes
/// first. Time is a parameter so the policy is unit-testable.
struct ProgressThrottle {
    last_emit_at: Option<Instant>,
    last_percent: Option<u64>,
}

impl ProgressThrottle {
    const MIN_INTERVAL: Duration = Duration::from_millis(150);

    fn new() -> Self {
        Self {
            last_emit_at: None,
            last_percent: None,
        }
    }

    fn should_emit(&mut self, downloaded: u64, total: Option<u64>, now: Instant) -> bool {
        let percent = total
            .filter(|t| *t > 0)
            .map(|t| downloaded.saturating_mul(100) / t);
        let interval_elapsed = match self.last_emit_at {
            None => true,
            Some(prev) => now.duration_since(prev) >= Self::MIN_INTERVAL,
        };
        let percent_changed = matches!(
            (percent, self.last_percent),
            (Some(p), Some(prev)) if p != prev
        ) || (percent.is_some() && self.last_percent.is_none());

        if !interval_elapsed && !percent_changed {
            return false;
        }
        self.last_emit_at = Some(now);
        if percent.is_some() {
            self.last_percent = percent;
        }
        true
    }
}

#[tauri::command]
pub async fn check_app_update<R: Runtime>(
    app: AppHandle<R>,
) -> Result<AppUpdateCheckResult, String> {
    let current_version = app_version(&app);
    let Some(AvailableUpdate { update, .. }) = check_available_update(&app).await? else {
        if updater_configured() {
            return Ok(AppUpdateCheckResult::UpToDate { current_version });
        }
        return Ok(AppUpdateCheckResult::Unconfigured { current_version });
    };

    Ok(AppUpdateCheckResult::Available {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        body: update.body.clone(),
        date: update.date.map(|d| d.to_string()),
    })
}

/// Background step: check, download and verify the update, then park it
/// in [`PreparedAppUpdate`]. Touches no child process and installs
/// nothing (see the module docs for why).
#[tauri::command]
pub async fn download_app_update<R: Runtime>(
    app: AppHandle<R>,
    prepared: State<'_, PreparedAppUpdate>,
) -> Result<AppUpdateVersions, String> {
    let Some(AvailableUpdate { update, proxied }) = check_available_update(&app).await? else {
        // The channel no longer offers an update (e.g. a pulled release):
        // a package parked earlier must not be installed anymore.
        prepared.0.clear();
        return Err("no_update_available".to_string());
    };
    let result = AppUpdateVersions::of(&update);
    // Through the prefix, the error names the URL that failed.
    let proxied_download_url = proxied.then(|| update.download_url.to_string());

    let mut downloaded: u64 = 0;
    let mut throttle = ProgressThrottle::new();
    let progress_app = app.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                if throttle.should_emit(downloaded, total, Instant::now()) {
                    let _ = progress_app.emit(
                        PROGRESS_EVENT,
                        AppUpdateProgressEvent::Downloading { downloaded, total },
                    );
                }
            },
            // No `Installing` here: installing waits for the user's click.
            || {},
        )
        .await
        .map_err(|e| format_download_error(proxied_download_url.as_deref(), e))?;

    prepared.0.put(PreparedPackage { update, bytes });
    Ok(result)
}

/// User-initiated step ("Restart and Update"): stop Galley's child
/// processes, then install the package `download_app_update` parked.
/// Returns `no_prepared_update` when nothing is parked. On macOS / Linux
/// the GUI relaunches after this returns; on Windows `Update::install`
/// exits the process and this never returns.
#[tauri::command]
pub async fn install_app_update<R: Runtime>(
    app: AppHandle<R>,
    prepared: State<'_, PreparedAppUpdate>,
) -> Result<AppUpdateVersions, String> {
    let package = prepared.0.take()?;
    let result = AppUpdateVersions::of(&package.update);

    // Child-process shutdown + install run for seconds; tell the GUI.
    let _ = app.emit(PROGRESS_EVENT, AppUpdateProgressEvent::Installing);

    stop_galley_child_processes(&app).await;

    if let Err(e) = package.update.install(&package.bytes) {
        // The package is still verified; keep it so a retry does not
        // need another download.
        prepared.0.restore_if_empty(package);
        return Err(format_update_error_for_phase("install", e));
    }

    Ok(result)
}

async fn stop_galley_child_processes<R: Runtime>(app: &AppHandle<R>) {
    if let Some(im_manager) =
        app.try_state::<std::sync::Arc<crate::im_supervisor::ImSupervisorManager>>()
    {
        im_manager.stop_all().await;
    }
    if let Some(bridge) =
        app.try_state::<std::sync::Arc<crate::browser_bridge::BrowserBridgeManager>>()
    {
        bridge.stop_all().await;
    }

    let manager = app.state::<std::sync::Arc<crate::runner_manager::RunnerManager>>();
    manager.shutdown_all(Duration::from_secs(5)).await;
}

/// An update the channel offers. `proxied`: the update proxy prefix is on,
/// and `update.download_url` already goes through it.
struct AvailableUpdate {
    update: Update,
    proxied: bool,
}

/// Checks the channel, through the update proxy prefix when one is set
/// (see the module docs for the fallback rule).
async fn check_available_update<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<AvailableUpdate>, String> {
    let Some((pubkey, endpoint_raw)) = updater_inputs() else {
        return Ok(None);
    };

    let Some(prefix) = read_update_proxy_prefix(app).await else {
        let update = check_endpoint(app, pubkey, endpoint_raw).await?;
        return Ok(update.map(|update| AvailableUpdate {
            update,
            proxied: false,
        }));
    };

    let proxied_endpoint = proxied_url(&prefix, endpoint_raw);
    let update = check_proxied_then_direct(
        proxied_endpoint.clone(),
        endpoint_raw.to_string(),
        |endpoint| async move { check_endpoint(app, pubkey, &endpoint).await },
    )
    .await?;
    let Some(mut update) = update else {
        return Ok(None);
    };
    update.download_url = proxied_url(&prefix, update.download_url.as_str())
        .parse::<Url>()
        .map_err(|e| format_update_error_with_endpoint("check", &proxied_endpoint, e))?;
    Ok(Some(AvailableUpdate {
        update,
        proxied: true,
    }))
}

/// One check against one manifest URL.
async fn check_endpoint<R: Runtime>(
    app: &AppHandle<R>,
    pubkey: &str,
    endpoint_raw: &str,
) -> Result<Option<Update>, String> {
    let endpoint = endpoint_raw
        .parse()
        .map_err(|e| format_invalid_update_endpoint(endpoint_raw, e))?;
    let updater = app
        .updater_builder()
        .pubkey(pubkey)
        .timeout(CHECK_TIMEOUT)
        .endpoints(vec![endpoint])
        .map_err(|e| format_update_error_with_endpoint("check", endpoint_raw, e))?
        .build()
        .map_err(|e| format_update_error_with_endpoint("check", endpoint_raw, e))?;

    updater
        .check()
        .await
        .map_err(|e| format_update_error_with_endpoint("check", endpoint_raw, e))
}

/// The check rule with the prefix on: `check(proxied)` first; on failure
/// `check(direct)` once more; when both fail, the first error. A success
/// either way (an update, or none) is the result.
async fn check_proxied_then_direct<T, F, Fut>(
    proxied: String,
    direct: String,
    mut check: F,
) -> Result<T, String>
where
    F: FnMut(String) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    match check(proxied).await {
        Ok(found) => Ok(found),
        Err(proxied_error) => {
            eprintln!(
                "[app-update] check through the update proxy prefix failed, checking directly: {proxied_error}"
            );
            check(direct).await.map_err(|_| proxied_error)
        }
    }
}

/// The normalized prefix in pref `update_proxy_prefix`, or `None` (off)
/// when it is missing, unreadable or invalid.
async fn read_update_proxy_prefix<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let galley = app.try_state::<SqliteGalley>()?.inner().clone();
    let value = galley
        .get_pref_json(UPDATE_PROXY_PREFIX_PREF)
        .await
        .ok()
        .flatten()?;
    normalize_proxy_prefix(value.as_str()?)
}

/// `raw` (the pref as stored) as a usable prefix: trimmed, it must parse
/// as a URL whose scheme is `https`, that has a host, and that has no
/// query and no fragment; then every trailing `/` goes and exactly one
/// comes back. Anything else is `None` (off). The GUI applies the same
/// rule before saving (`gui/src/lib/update-proxy-prefix.ts`).
fn normalize_proxy_prefix(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    // The raw text, not only `query()` / `fragment()`: a bare trailing
    // `?` or `#` counts too (the original URL would land in it).
    if trimmed.contains(['?', '#']) {
        return None;
    }
    let url = Url::parse(trimmed).ok()?;
    if url.scheme() != "https" || url.host_str().is_none_or(str::is_empty) {
        return None;
    }
    Some(format!("{}/", trimmed.trim_end_matches('/')))
}

/// `<prefix><original>`, the original URL in full and unescaped.
fn proxied_url(prefix: &str, original: &str) -> String {
    format!("{prefix}{original}")
}

fn updater_configured() -> bool {
    updater_inputs().is_some()
}

fn updater_inputs() -> Option<(&'static str, &'static str)> {
    let pubkey = option_env!("GALLEY_UPDATER_PUBKEY")
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    let endpoint = option_env!("GALLEY_UPDATER_ENDPOINT")
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    Some((pubkey, endpoint))
}

fn app_version<R: Runtime>(app: &AppHandle<R>) -> String {
    app.package_info().version.to_string()
}

fn format_update_error_for_phase(phase: &str, error: impl std::fmt::Display) -> String {
    format!("update_error: phase={phase}; detail={error}")
}

/// A failed download. Through the update proxy prefix (`prefixed_url`
/// given) the error also names the URL: one extra `url=` field after
/// `phase`. Without it the string is exactly what it always was.
fn format_download_error(prefixed_url: Option<&str>, error: impl std::fmt::Display) -> String {
    match prefixed_url {
        Some(url) => format!("update_error: phase=download; url={url}; detail={error}"),
        None => format_update_error_for_phase("download", error),
    }
}

fn format_update_error_with_endpoint(
    phase: &str,
    endpoint: &str,
    error: impl std::fmt::Display,
) -> String {
    format!("update_error: phase={phase}; endpoint={endpoint}; detail={error}")
}

fn format_invalid_update_endpoint(endpoint: &str, error: impl std::fmt::Display) -> String {
    format!("invalid_updater_endpoint: phase=check; endpoint={endpoint}; detail={error}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn throttle_emits_first_chunk() {
        let mut throttle = ProgressThrottle::new();
        assert!(throttle.should_emit(1, Some(100), Instant::now()));
    }

    #[test]
    fn throttle_suppresses_same_percent_within_interval() {
        let mut throttle = ProgressThrottle::new();
        let start = Instant::now();
        assert!(throttle.should_emit(10, Some(1000), start));
        // Still 1%, only 10ms later: suppressed.
        assert!(!throttle.should_emit(11, Some(1000), start + Duration::from_millis(10)));
    }

    #[test]
    fn throttle_emits_on_percent_change() {
        let mut throttle = ProgressThrottle::new();
        let start = Instant::now();
        assert!(throttle.should_emit(10, Some(1000), start));
        // 1% -> 2% just 1ms later: percent change wins over the interval.
        assert!(throttle.should_emit(20, Some(1000), start + Duration::from_millis(1)));
    }

    #[test]
    fn throttle_emits_after_interval_without_total() {
        let mut throttle = ProgressThrottle::new();
        let start = Instant::now();
        assert!(throttle.should_emit(10, None, start));
        assert!(!throttle.should_emit(20, None, start + Duration::from_millis(100)));
        assert!(throttle.should_emit(30, None, start + Duration::from_millis(200)));
    }

    #[test]
    fn throttle_ignores_zero_total() {
        let mut throttle = ProgressThrottle::new();
        let start = Instant::now();
        assert!(throttle.should_emit(10, Some(0), start));
        // Zero total never derives a percent, so only the interval applies.
        assert!(!throttle.should_emit(20, Some(0), start + Duration::from_millis(100)));
    }

    #[test]
    fn prepared_slot_take_when_empty_is_no_prepared_update() {
        let slot = PreparedSlot::<u32>::default();
        assert_eq!(slot.take(), Err("no_prepared_update".to_string()));
    }

    #[test]
    fn prepared_slot_take_empties_the_slot() {
        let slot = PreparedSlot::default();
        slot.put(1);
        assert_eq!(slot.take(), Ok(1));
        assert_eq!(slot.take(), Err(NO_PREPARED_UPDATE.to_string()));
    }

    #[test]
    fn prepared_slot_newer_download_replaces_older() {
        let slot = PreparedSlot::default();
        slot.put(1);
        slot.put(2);
        assert_eq!(slot.take(), Ok(2));
    }

    #[test]
    fn prepared_slot_restore_refills_only_an_empty_slot() {
        let slot = PreparedSlot::default();
        slot.restore_if_empty(1);
        assert_eq!(slot.take(), Ok(1));

        // A download that finished during the failed install wins.
        slot.put(2);
        slot.restore_if_empty(1);
        assert_eq!(slot.take(), Ok(2));
    }

    #[test]
    fn prepared_slot_clear_drops_the_parked_value() {
        let slot = PreparedSlot::default();
        slot.put(1);
        slot.clear();
        assert_eq!(slot.take(), Err(NO_PREPARED_UPDATE.to_string()));
    }

    #[test]
    fn versions_serialize_as_camel_case_contract() {
        let versions = AppUpdateVersions {
            current_version: "0.5.6".to_string(),
            version: "0.5.7".to_string(),
        };
        assert_eq!(
            serde_json::to_value(versions).unwrap(),
            serde_json::json!({ "currentVersion": "0.5.6", "version": "0.5.7" })
        );
    }

    #[test]
    fn proxy_prefix_is_off_unless_an_https_url_with_a_host_and_no_query_or_fragment() {
        for raw in [
            "",
            "   ",
            "http://",
            "http://example.com",
            "http://example.com/",
            "example.com",
            "example.com/gh/",
            "https://",
            "ftp://example.com/",
            "https://example.com/?x=",
            "https://example.com/?x=1",
            "https://example.com/#a",
            "https://example.com/gh?",
        ] {
            assert_eq!(normalize_proxy_prefix(raw), None, "{raw:?}");
        }
    }

    #[test]
    fn proxy_prefix_ends_in_exactly_one_slash() {
        for (raw, normalized) in [
            ("https://example.com", "https://example.com/"),
            ("https://example.com/", "https://example.com/"),
            ("https://example.com///", "https://example.com/"),
            ("  https://example.com  ", "https://example.com/"),
            ("https://example.com/gh/", "https://example.com/gh/"),
            ("https://example.com/gh", "https://example.com/gh/"),
        ] {
            assert_eq!(
                normalize_proxy_prefix(raw).as_deref(),
                Some(normalized),
                "{raw:?}"
            );
        }
    }

    #[test]
    fn proxied_url_puts_the_original_after_the_prefix_unescaped() {
        let prefix = normalize_proxy_prefix("https://example.com").unwrap();
        assert_eq!(
            proxied_url(&prefix, "https://github.com/o/r/releases/download/v1/a.exe"),
            "https://example.com/https://github.com/o/r/releases/download/v1/a.exe"
        );
        let prefix = normalize_proxy_prefix("https://example.com/gh/").unwrap();
        assert_eq!(
            proxied_url(&prefix, "https://github.com/o/r/a b?x=1"),
            "https://example.com/gh/https://github.com/o/r/a b?x=1"
        );
        // The updater gets it as a `Url`: the original survives intact in
        // the path.
        let url: Url = proxied_url(
            "https://example.com/",
            "https://github.com/o/r/releases/download/v1/a.exe",
        )
        .parse()
        .unwrap();
        assert_eq!(url.host_str(), Some("example.com"));
        assert_eq!(
            url.path(),
            "/https://github.com/o/r/releases/download/v1/a.exe"
        );
    }

    /// Runs `check_proxied_then_direct` against canned answers, returning
    /// its result and the URLs it checked, in order.
    async fn fallback_with(
        proxied: Result<&'static str, &'static str>,
        direct: Result<&'static str, &'static str>,
    ) -> (Result<&'static str, String>, Vec<String>) {
        let calls = std::cell::RefCell::new(Vec::new());
        let result = check_proxied_then_direct(
            "https://example.com/https://u/latest.json".to_string(),
            "https://u/latest.json".to_string(),
            |endpoint: String| {
                calls.borrow_mut().push(endpoint.clone());
                let answer = if endpoint.starts_with("https://example.com/") {
                    proxied
                } else {
                    direct
                };
                async move { answer.map_err(str::to_string) }
            },
        )
        .await;
        (result, calls.into_inner())
    }

    #[tokio::test]
    async fn a_proxied_check_that_succeeds_is_the_result() {
        let (result, calls) = fallback_with(Ok("proxied"), Ok("direct")).await;
        assert_eq!(result, Ok("proxied"));
        assert_eq!(calls, ["https://example.com/https://u/latest.json"]);
    }

    #[tokio::test]
    async fn a_failed_proxied_check_falls_back_to_the_original_url_once() {
        let (result, calls) = fallback_with(Err("proxied failed"), Ok("direct")).await;
        assert_eq!(result, Ok("direct"));
        assert_eq!(
            calls,
            [
                "https://example.com/https://u/latest.json",
                "https://u/latest.json"
            ]
        );
    }

    #[tokio::test]
    async fn when_both_checks_fail_the_proxied_error_is_returned() {
        let (result, calls) = fallback_with(Err("proxied failed"), Err("direct failed")).await;
        assert_eq!(result, Err("proxied failed".to_string()));
        assert_eq!(calls.len(), 2);
    }

    #[test]
    fn error_strings_without_the_prefix_are_what_they_were() {
        // The exact strings shipped before the update proxy prefix; the
        // GUI classifies them by substring.
        assert_eq!(
            format_download_error(None, "connection reset"),
            "update_error: phase=download; detail=connection reset"
        );
        assert_eq!(
            format_update_error_with_endpoint("check", "https://u/latest.json", "timed out"),
            "update_error: phase=check; endpoint=https://u/latest.json; detail=timed out"
        );
        assert_eq!(
            format_invalid_update_endpoint("nope", "relative URL without a base"),
            "invalid_updater_endpoint: phase=check; endpoint=nope; detail=relative URL without a base"
        );
    }

    #[test]
    fn a_download_through_the_prefix_names_its_url() {
        assert_eq!(
            format_download_error(
                Some("https://example.com/https://github.com/o/r/a.exe"),
                "connection reset"
            ),
            "update_error: phase=download; url=https://example.com/https://github.com/o/r/a.exe; detail=connection reset"
        );
    }

    #[test]
    fn progress_events_serialize_with_phase_tag() {
        assert_eq!(
            serde_json::to_value(AppUpdateProgressEvent::Installing).unwrap(),
            serde_json::json!({ "phase": "installing" })
        );
        assert_eq!(
            serde_json::to_value(AppUpdateProgressEvent::Downloading {
                downloaded: 5,
                total: Some(10),
            })
            .unwrap(),
            serde_json::json!({ "phase": "downloading", "downloaded": 5, "total": 10 })
        );
    }
}
