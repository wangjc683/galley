use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Broadcast event carrying updater download/install progress to the GUI.
/// Same emit-and-forget pattern as `im_supervisor::EVENT_NAME`.
const PROGRESS_EVENT: &str = "app-update-progress";

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInstallResult {
    current_version: String,
    version: String,
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
    let Some(update) = check_available_update(&app).await? else {
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

#[tauri::command]
pub async fn install_app_update<R: Runtime>(
    app: AppHandle<R>,
) -> Result<AppUpdateInstallResult, String> {
    let update = check_available_update(&app)
        .await?
        .ok_or_else(|| "no_update_available".to_string())?;
    let result = AppUpdateInstallResult {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
    };

    let mut downloaded: u64 = 0;
    let mut throttle = ProgressThrottle::new();
    let progress_app = app.clone();
    let finished_app = app.clone();
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
            move || {
                // Download done, but child-process shutdown + install still
                // run for seconds; tell the GUI so it doesn't freeze at 100%.
                let _ = finished_app.emit(PROGRESS_EVENT, AppUpdateProgressEvent::Installing);
            },
        )
        .await
        .map_err(|e| format_update_error_for_phase("download", e))?;

    stop_galley_child_processes(&app).await;

    update
        .install(bytes)
        .map_err(|e| format_update_error_for_phase("install", e))?;

    Ok(result)
}

async fn stop_galley_child_processes<R: Runtime>(app: &AppHandle<R>) {
    if let Some(im_manager) =
        app.try_state::<std::sync::Arc<crate::im_supervisor::ImSupervisorManager>>()
    {
        im_manager.stop_all().await;
    }

    let manager = app.state::<std::sync::Arc<crate::runner_manager::RunnerManager>>();
    manager.shutdown_all(Duration::from_secs(5)).await;
}

async fn check_available_update<R: Runtime>(app: &AppHandle<R>) -> Result<Option<Update>, String> {
    let Some((pubkey, endpoint_raw)) = updater_inputs() else {
        return Ok(None);
    };

    let endpoint = endpoint_raw
        .parse()
        .map_err(|e| format_invalid_update_endpoint(endpoint_raw, e))?;
    let updater = app
        .updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![endpoint])
        .map_err(|e| format_update_error_with_endpoint("check", endpoint_raw, e))?
        .build()
        .map_err(|e| format_update_error_with_endpoint("check", endpoint_raw, e))?;

    updater
        .check()
        .await
        .map_err(|e| format_update_error_with_endpoint("check", endpoint_raw, e))
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
}
