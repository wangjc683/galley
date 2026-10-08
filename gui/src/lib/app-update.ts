import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";

export type AppUpdateCheckResult =
  | {
      kind: "unconfigured";
      currentVersion: string;
    }
  | {
      kind: "upToDate";
      currentVersion: string;
    }
  | {
      kind: "available";
      currentVersion: string;
      version: string;
      body: string | null;
      date: string | null;
    };

/** What `download_app_update` and `install_app_update` resolve with. */
export interface AppUpdateInstallResult {
  currentVersion: string;
  version: string;
}

/**
 * Payload of the Rust `app-update-progress` event (core/src/app_update.rs).
 * `download_app_update` sends only `downloading`; `install_app_update`
 * sends one `installing` before it stops the children and installs.
 */
export type AppUpdateProgressEvent =
  | { phase: "downloading"; downloaded: number; total: number | null }
  | { phase: "installing" };

export interface AppUpdateDownloadProgress {
  downloaded: number;
  total: number | null;
}

export interface AppUpdateDownloadingFields {
  phase: "downloading" | "installing";
  progress?: AppUpdateDownloadProgress;
}

/** Maps a progress event onto the `downloading` status fields. */
export function applyProgressEvent(
  event: AppUpdateProgressEvent,
): AppUpdateDownloadingFields {
  if (event.phase === "installing") {
    return { phase: "installing" };
  }
  return {
    phase: "downloading",
    progress: { downloaded: event.downloaded, total: event.total },
  };
}

/**
 * Integer percent for a determinate bar, or null when the server sent
 * no usable Content-Length. Clamped: a lying Content-Length must not
 * push the fill past 100%.
 */
export function downloadPercent(
  progress: AppUpdateDownloadProgress | undefined,
): number | null {
  if (!progress || progress.total === null || progress.total <= 0) return null;
  const pct = Math.floor((progress.downloaded / progress.total) * 100);
  return Math.min(100, Math.max(0, pct));
}

export async function checkAppUpdate(): Promise<AppUpdateCheckResult> {
  return invoke<AppUpdateCheckResult>("check_app_update");
}

/**
 * Download and verify the update in the background. Touches no child
 * process, so it may run while tasks run. Rejects `no_update_available`
 * when the channel has nothing newer.
 */
export async function downloadAppUpdate(): Promise<AppUpdateInstallResult> {
  return invoke<AppUpdateInstallResult>("download_app_update");
}

/**
 * Install the package `downloadAppUpdate` prepared: stops the children,
 * installs, resolves; the caller relaunches. On Windows the installer
 * quits the app and this never resolves. Rejects `no_prepared_update`
 * when nothing was downloaded.
 */
export async function installAppUpdate(): Promise<AppUpdateInstallResult> {
  return invoke<AppUpdateInstallResult>("install_app_update");
}

export async function relaunchApp(): Promise<void> {
  await relaunch();
}
