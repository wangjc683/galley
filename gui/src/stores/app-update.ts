import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import {
  applyProgressEvent,
  checkAppUpdate,
  downloadAppUpdate,
  installAppUpdate,
  relaunchApp,
  type AppUpdateCheckResult,
  type AppUpdateDownloadProgress,
  type AppUpdateProgressEvent,
} from "@/lib/app-update";
import { getPref, setPref } from "@/lib/db";
import { copyForLanguage } from "@/lib/i18n";
import { resolveLanguagePreference } from "@/lib/language";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

export type AppUpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "unconfigured"; currentVersion: string }
  | { kind: "upToDate"; currentVersion: string }
  | {
      kind: "available";
      currentVersion: string;
      version: string;
      body: string | null;
      date: string | null;
    }
  | {
      // In flight: the background download (`phase: "downloading"`), or
      // the install `restart()` runs before relaunching
      // (`phase: "installing"`).
      kind: "downloading";
      version?: string;
      phase?: "downloading" | "installing";
      // Fed by the Rust `app-update-progress` event. Absent until the
      // first chunk arrives, and for good when the server sent no
      // Content-Length (UI falls back to the spinner).
      progress?: AppUpdateDownloadProgress;
    }
  | { kind: "ready"; currentVersion: string; version: string }
  | {
      kind: "error";
      message: string;
      detail: string;
      manualDownloadUrl: string;
    };

interface CheckOptions {
  silent?: boolean;
  downloadIfAvailable?: boolean;
}

interface AppUpdateStore {
  status: AppUpdateStatus;
  lastCheckedAt: string | null;
  check: (options?: CheckOptions) => Promise<void>;
  /** Download + verify in the background; ends `ready`. */
  download: () => Promise<void>;
  /** Install the downloaded update and relaunch. */
  restart: () => Promise<void>;
  noteAppLaunched: (currentVersion: string) => Promise<void>;
  resetError: () => void;
}

// Emitted by core/src/app_update.rs during `download_app_update`
// (downloading) and `install_app_update` (installing).
const APP_UPDATE_PROGRESS_EVENT = "app-update-progress";

const PREF_LAST_SEEN_VERSION = "app_update_last_seen_version";
const PREF_PREPARED_VERSION = "app_update_prepared_version";
// `app_update_ready_toast_version` was the once-per-version guard for the
// ready toast, retired 2026-09-18 (see notePreparedVersion); stale rows
// under that key are harmless.
const PREF_COMPLETED_TOAST_VERSION = "app_update_completed_toast_version";
const APP_UPDATE_MANUAL_DOWNLOAD_URL =
  "https://github.com/wangjc683/galley/releases/latest";

export const useAppUpdateStore = create<AppUpdateStore>((set, get) => ({
  status: { kind: "idle" },
  lastCheckedAt: null,

  check: async (options) => {
    const current = get().status.kind;
    // `ready` holds a downloaded package waiting for the restart: a
    // check from the menu must not reset it and download it again.
    if (
      current === "checking" ||
      current === "downloading" ||
      current === "ready"
    ) {
      return;
    }

    set({ status: { kind: "checking" } });
    try {
      const result = await checkAppUpdate();
      if (options?.silent && result.kind === "unconfigured") {
        set({ status: { kind: "idle" } });
        return;
      }
      // Downloading touches no child process, so it never waits for
      // running tasks; only the install at restart does.
      const shouldDownload =
        result.kind === "available" &&
        (options?.downloadIfAvailable === true || options?.silent !== true);
      set({
        status: statusFromCheckResult(result),
        lastCheckedAt: new Date().toISOString(),
      });
      if (shouldDownload) {
        await get().download();
      }
    } catch (error) {
      if (options?.silent) {
        set({ status: { kind: "idle" } });
        return;
      }
      console.warn("[updates] check failed", error);
      set({
        status: { kind: "error", ...readableUpdateError(error, "check") },
      });
    }
  },

  download: async () => {
    const current = get().status;
    if (
      current.kind === "checking" ||
      current.kind === "downloading" ||
      current.kind === "ready"
    ) {
      return;
    }

    set({
      status: {
        kind: "downloading",
        phase: "downloading",
        version: current.kind === "available" ? current.version : undefined,
      },
    });
    let unlistenProgress: UnlistenFn | undefined;
    try {
      unlistenProgress = await listenProgress();
      const result = await downloadAppUpdate();
      set({
        status: {
          kind: "ready",
          currentVersion: result.currentVersion,
          version: result.version,
        },
      });
      await notePreparedVersion(result.version);
    } catch (error) {
      console.warn("[updates] download failed", error);
      set({
        status: {
          kind: "error",
          ...readableUpdateError(error, "download"),
        },
      });
    } finally {
      unlistenProgress?.();
    }
  },

  restart: async () => {
    // Installing stops the IM supervisor and runner children, so it
    // waits until no task runs (the buttons are disabled meanwhile).
    if (hasRunningSessions()) return;
    const current = get().status;
    if (current.kind !== "ready") return;

    set({
      status: {
        kind: "downloading",
        phase: "installing",
        version: current.version,
      },
    });
    let unlistenProgress: UnlistenFn | undefined;
    try {
      unlistenProgress = await listenProgress();
      // On Windows the installer quits Galley here and never returns.
      await installAppUpdate();
      await relaunchApp();
    } catch (error) {
      console.warn("[updates] install failed", error);
      set({
        status: {
          kind: "error",
          ...readableUpdateError(error, "install"),
        },
      });
    } finally {
      unlistenProgress?.();
    }
  },

  noteAppLaunched: async (currentVersion) => {
    if (!currentVersion) return;
    await maybeNotifyUpdateCompleted(currentVersion);
    try {
      await setPref(PREF_LAST_SEEN_VERSION, currentVersion);
    } catch (error) {
      console.warn("[updates] last-seen version persistence failed", error);
    }
  },

  resetError: () => {
    if (get().status.kind === "error") {
      set({ status: { kind: "idle" } });
    }
  },
}));

// Expose the store on `window.__appUpdateStore` in dev so update UI
// states (TopBar UpdateIndicator, Settings controls) can be exercised
// without a real update channel — dev builds are `unconfigured`, so
// available/downloading/ready are otherwise unreachable. Stripped in
// production by `import.meta.env.DEV`.
//
// Usage in console:
//   __appUpdateStore.setState({ status: { kind: "available", currentVersion: "0.3.1", version: "0.4.0", body: "notes", date: null } })
//   __appUpdateStore.setState({ status: { kind: "downloading", version: "0.4.0", phase: "downloading" } })
//   __appUpdateStore.setState({ status: { kind: "downloading", version: "0.4.0", phase: "downloading", progress: { downloaded: 42_000_000, total: 100_000_000 } } })
//   __appUpdateStore.setState({ status: { kind: "ready", currentVersion: "0.3.1", version: "0.4.0" } })
//   __appUpdateStore.setState({ status: { kind: "downloading", version: "0.4.0", phase: "installing" } })
//   __appUpdateStore.setState({ status: { kind: "error", message: "下载更新失败，请稍后重试。", detail: "download request failed: connection reset", manualDownloadUrl: "https://github.com/wangjc683/galley/releases/latest" } })
//
// The download / restart buttons call Core for real; in dev they end in
// an error (no channel, nothing downloaded).
if (import.meta.env.DEV) {
  (
    globalThis as { __appUpdateStore?: typeof useAppUpdateStore }
  ).__appUpdateStore = useAppUpdateStore;
}

function statusFromCheckResult(result: AppUpdateCheckResult): AppUpdateStatus {
  switch (result.kind) {
    case "unconfigured":
      return {
        kind: "unconfigured",
        currentVersion: result.currentVersion,
      };
    case "upToDate":
      return {
        kind: "upToDate",
        currentVersion: result.currentVersion,
      };
    case "available":
      return {
        kind: "available",
        currentVersion: result.currentVersion,
        version: result.version,
        body: result.body,
        date: result.date,
      };
  }
}

function hasRunningSessions(): boolean {
  return Object.values(useMessagesStore.getState().byId).some(
    (messages) => messages.agentRunning,
  );
}

/**
 * Feed `app-update-progress` into the in-flight `downloading` status.
 * Awaited before the command is invoked so no early event is missed
 * (same ordering rule as lib/bridge.ts).
 */
function listenProgress(): Promise<UnlistenFn> {
  return listen<AppUpdateProgressEvent>(APP_UPDATE_PROGRESS_EVENT, (event) => {
    const status = useAppUpdateStore.getState().status;
    // A late event must not resurrect a terminal ready/error state.
    if (status.kind !== "downloading") return;
    useAppUpdateStore.setState({
      status: { ...status, ...applyProgressEvent(event.payload) },
    });
  });
}

/**
 * Record which version was downloaded so the post-restart "Galley 已更新"
 * toast can tell an update apart from a plain relaunch.
 *
 * No toast at the ready moment (2026-09-18; the 2026-07-15 devlog left
 * this exact revisit open "if dogfood finds it noisy", and it did): the
 * TopBar badge turns success-tinted the same instant and carries the
 * restart action in its popover, so the toast only added a second
 * voice saying the same thing at the same moment. Restarting is never
 * urgent — it tears down the IM supervisor and runner children — so
 * immediacy, the one thing a toast has over a persistent badge, is
 * not wanted here.
 */
async function notePreparedVersion(version: string): Promise<void> {
  try {
    await setPref(PREF_PREPARED_VERSION, version);
  } catch (error) {
    console.warn("[updates] prepared version persistence failed", error);
  }
}

async function maybeNotifyUpdateCompleted(currentVersion: string): Promise<void> {
  const [lastSeenVersion, preparedVersion, completedToastVersion] =
    await Promise.all([
      safeGetPref<string>(PREF_LAST_SEEN_VERSION),
      safeGetPref<string>(PREF_PREPARED_VERSION),
      safeGetPref<string>(PREF_COMPLETED_TOAST_VERSION),
    ]);

  const versionChanged =
    typeof lastSeenVersion === "string" &&
    lastSeenVersion.length > 0 &&
    lastSeenVersion !== currentVersion;
  const preparedThisVersion = preparedVersion === currentVersion;

  if (
    completedToastVersion === currentVersion ||
    (!versionChanged && !preparedThisVersion)
  ) {
    return;
  }

  const copy = updateCopy();
  useUiStore.getState().pushToast(
    makeAppError({
      id: `app-update-completed-${currentVersion}`,
      category: "business",
      severity: "info",
      title: copy.toasts.appUpdated,
      message: copy.toasts.appUpdatedMessage,
      hint: null,
      retryable: false,
      context: "app_update_completed",
      traceback: null,
    }),
  );

  try {
    await setPref(PREF_COMPLETED_TOAST_VERSION, currentVersion);
  } catch (error) {
    console.warn("[updates] completed toast persistence failed", error);
  }
}

async function safeGetPref<T>(key: string): Promise<T | undefined> {
  try {
    return await getPref<T>(key);
  } catch (error) {
    console.warn(`[updates] pref load failed: ${key}`, error);
    return undefined;
  }
}

function updateCopy() {
  return copyForLanguage(
    resolveLanguagePreference(usePrefsStore.getState().languagePreference),
  );
}

type UpdateErrorPhase = "check" | "download" | "install";

function readableUpdateError(
  error: unknown,
  phase: UpdateErrorPhase,
): { message: string; detail: string; manualDownloadUrl: string } {
  const copy = updateCopy();
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : (JSON.stringify(error) ?? String(error ?? ""));

  const normalized = raw.toLowerCase();
  const makeError = (message: string) => ({
    message,
    detail: formatUpdateDiagnostic(raw),
    manualDownloadUrl: APP_UPDATE_MANUAL_DOWNLOAD_URL,
  });

  if (normalized.includes("no_prepared_update"))
    return makeError(copy.updates.preparedUpdateMissing);
  if (normalized.includes("no_update_available"))
    return makeError(copy.updates.noUpdateAvailable);
  if (
    normalized.includes("invalid_updater_endpoint") ||
    normalized.includes("insecure transport protocol") ||
    normalized.includes("relative url without a base") ||
    normalized.includes("builder error")
  ) {
    return makeError(copy.updates.invalidEndpoint);
  }
  if (
    raw.includes("EmptyEndpoints") ||
    normalized.includes("does not have any endpoints")
  ) {
    return makeError(copy.updates.devNoChannel);
  }
  if (normalized.includes("could not fetch a valid release json")) {
    return makeError(copy.updates.channelUnavailable);
  }
  if (
    normalized.includes("platform") &&
    normalized.includes("not found in the response")
  ) {
    return makeError(copy.updates.platformUnavailable);
  }
  if (
    normalized.includes("invalid updater binary format") ||
    normalized.includes("binary for the current target not found") ||
    normalized.includes("the `signature` field was not set") ||
    normalized.includes("expected value at line") ||
    normalized.includes("invalid type") ||
    normalized.includes("missing field")
  ) {
    return makeError(copy.updates.invalidManifest);
  }
  if (
    normalized.includes("signature") ||
    normalized.includes("minisign") ||
    normalized.includes("base64") ||
    normalized.includes("signatureutf8") ||
    normalized.includes("signature mismatch")
  ) {
    return makeError(copy.updates.signatureInvalid);
  }
  if (
    normalized.includes("download request failed") ||
    normalized.includes("network") ||
    normalized.includes("reqwest") ||
    normalized.includes("request failed") ||
    normalized.includes("connection") ||
    normalized.includes("dns") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout")
  ) {
    return makeError(
      phase === "check"
        ? copy.updates.networkUnavailable
        : copy.updates.downloadFailed,
    );
  }
  if (
    normalized.includes("failed to install") ||
    normalized.includes("packageinstallfailed") ||
    normalized.includes("authentication failed") ||
    normalized.includes("failed to create temporary directory") ||
    normalized.includes("failed to determine updater package extract path")
  ) {
    return makeError(copy.updates.installFailed);
  }
  if (phase === "download") {
    return makeError(copy.updates.downloadFailed);
  }
  if (phase === "install") {
    return makeError(copy.updates.installFailed);
  }
  return makeError(copy.updates.checkFailed);
}

function formatUpdateDiagnostic(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return "update_error: no detail";
  const maxLength = 520;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}
