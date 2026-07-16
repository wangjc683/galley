import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import {
  applyProgressEvent,
  checkAppUpdate,
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
      kind: "downloading";
      version?: string;
      // Fed by the Rust `app-update-progress` event. Absent until the
      // first event arrives; `progress` stays absent when the server
      // sent no Content-Length (UI falls back to the spinner).
      phase?: "downloading" | "installing";
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
  downloadAndInstall: () => Promise<void>;
  restart: () => Promise<void>;
  noteAppLaunched: (currentVersion: string) => Promise<void>;
  resetError: () => void;
}

// Emitted by core/src/app_update.rs during `install_app_update`.
const APP_UPDATE_PROGRESS_EVENT = "app-update-progress";

const PREF_LAST_SEEN_VERSION = "app_update_last_seen_version";
const PREF_PREPARED_VERSION = "app_update_prepared_version";
const PREF_READY_TOAST_VERSION = "app_update_ready_toast_version";
const PREF_COMPLETED_TOAST_VERSION = "app_update_completed_toast_version";
const APP_UPDATE_MANUAL_DOWNLOAD_URL =
  "https://github.com/wangjc683/galley/releases/latest";

export const useAppUpdateStore = create<AppUpdateStore>((set, get) => ({
  status: { kind: "idle" },
  lastCheckedAt: null,

  check: async (options) => {
    const current = get().status.kind;
    if (current === "checking" || current === "downloading") return;

    set({ status: { kind: "checking" } });
    try {
      const result = await checkAppUpdate();
      if (options?.silent && result.kind === "unconfigured") {
        set({ status: { kind: "idle" } });
        return;
      }
      const shouldPrepare =
        result.kind === "available" &&
        (options?.downloadIfAvailable === true || options?.silent !== true);
      set({
        status: statusFromCheckResult(result),
        lastCheckedAt: new Date().toISOString(),
      });
      if (shouldPrepare && hasRunningSessions()) {
        ensureAutoPrepareOnIdleWatcher();
      } else if (shouldPrepare) {
        await get().downloadAndInstall();
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

  downloadAndInstall: async () => {
    const current = get().status;
    if (current.kind === "checking" || current.kind === "downloading") return;
    if (hasRunningSessions()) {
      if (current.kind === "available") {
        ensureAutoPrepareOnIdleWatcher();
      }
      return;
    }

    set({
      status: {
        kind: "downloading",
        version: current.kind === "available" ? current.version : undefined,
      },
    });
    let unlistenProgress: UnlistenFn | undefined;
    try {
      // Register before invoking so no early chunk event is missed
      // (same ordering rule as lib/bridge.ts).
      unlistenProgress = await listen<AppUpdateProgressEvent>(
        APP_UPDATE_PROGRESS_EVENT,
        (event) => {
          const status = get().status;
          // A late event must not resurrect a terminal ready/error state.
          if (status.kind !== "downloading") return;
          set({ status: { ...status, ...applyProgressEvent(event.payload) } });
        },
      );
      const result = await installAppUpdate();
      set({
        status: {
          kind: "ready",
          currentVersion: result.currentVersion,
          version: result.version,
        },
      });
      await notifyUpdateReady(result.version);
    } catch (error) {
      console.warn("[updates] download/install failed", error);
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

  restart: async () => {
    if (hasRunningSessions()) return;
    await relaunchApp();
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
//   __appUpdateStore.setState({ status: { kind: "downloading", version: "0.4.0" } })
//   __appUpdateStore.setState({ status: { kind: "downloading", version: "0.4.0", phase: "downloading", progress: { downloaded: 42_000_000, total: 100_000_000 } } })
//   __appUpdateStore.setState({ status: { kind: "downloading", version: "0.4.0", phase: "installing" } })
//   __appUpdateStore.setState({ status: { kind: "ready", currentVersion: "0.3.1", version: "0.4.0" } })
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
  return hasRunningSessionsInState(useMessagesStore.getState());
}

function hasRunningSessionsInState(
  state: ReturnType<typeof useMessagesStore.getState>,
): boolean {
  return Object.values(state.byId).some((messages) => messages.agentRunning);
}

let autoPrepareOnIdleWatcherStarted = false;

function ensureAutoPrepareOnIdleWatcher(): void {
  if (!autoPrepareOnIdleWatcherStarted) {
    autoPrepareOnIdleWatcherStarted = true;
    useMessagesStore.subscribe((state, previousState) => {
      if (hasRunningSessionsInState(state)) return;
      if (!hasRunningSessionsInState(previousState)) return;

      const status = useAppUpdateStore.getState().status;
      if (status.kind !== "available") return;
      void useAppUpdateStore.getState().downloadAndInstall();
    });
  }

  const status = useAppUpdateStore.getState().status;
  if (status.kind === "available" && !hasRunningSessions()) {
    void useAppUpdateStore.getState().downloadAndInstall();
  }
}

async function notifyUpdateReady(version: string): Promise<void> {
  try {
    await setPref(PREF_PREPARED_VERSION, version);
  } catch (error) {
    console.warn("[updates] prepared version persistence failed", error);
  }

  const alreadyShown = await safeGetPref<string>(PREF_READY_TOAST_VERSION);
  if (alreadyShown === version) return;

  const copy = updateCopy();
  useUiStore.getState().pushToast(
    makeAppError({
      id: `app-update-ready-${version}`,
      category: "business",
      severity: "info",
      title: copy.toasts.updateReady,
      message: copy.toasts.updateReadyMessage,
      hint: null,
      retryable: false,
      context: "app_update_ready",
      traceback: null,
      action: {
        kind: "restart_app_update",
        label: copy.updates.restart,
      },
    }),
  );

  try {
    await setPref(PREF_READY_TOAST_VERSION, version);
  } catch (error) {
    console.warn("[updates] ready toast persistence failed", error);
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

type UpdateErrorPhase = "check" | "install";

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
      phase === "install"
        ? copy.updates.downloadFailed
        : copy.updates.networkUnavailable,
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
