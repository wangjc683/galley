import { downloadPercent } from "@/lib/app-update";
import type { AppCopy } from "@/lib/i18n";
import type { AppUpdateStatus } from "@/stores/app-update";

/**
 * Pure view logic for the Settings → About version row (2026-10-08):
 * one control (a button, or an in-flight badge), one line of words after
 * it that carries the version, and for an error a block under the row.
 * The component only renders what this returns.
 */

/** What a button does. 重试 is a check too. */
export type UpdateControlCommand = "check" | "download" | "restart";

export type UpdateControlAction =
  | {
      kind: "button";
      command: UpdateControlCommand;
      label: string;
      disabled: boolean;
    }
  /** In flight (checking / downloading / installing): a neutral badge
   * with a spinner, the same grammar as a channel starting up. */
  | { kind: "progress"; label: string };

/**
 * - `info`: Info icon, muted (dev build without a channel).
 * - `plain`: no icon, muted (facts: the version found or downloading).
 * - `success`: filled check, success.
 * - `warning`: Warning icon, warning.
 */
export type UpdateControlNoteTone = "info" | "plain" | "success" | "warning";

export interface UpdateControlNote {
  tone: UpdateControlNoteTone;
  message: string;
}

/** The block under the row: the worded cause, 手动下载 after it, and the
 * raw text below for a bug report. */
export interface UpdateControlError {
  title: string;
  detail: string;
  manualDownloadUrl: string;
}

export interface UpdateControlView {
  action: UpdateControlAction;
  note: UpdateControlNote | null;
  error: UpdateControlError | null;
}

type UpdatesCopy = AppCopy["updates"];

function button(
  command: UpdateControlCommand,
  label: string,
  disabled = false,
): UpdateControlAction {
  return { kind: "button", command, label, disabled };
}

/**
 * Downloading never waits for running tasks (it touches no child
 * process); only 重启并更新 does, because installing stops the IM
 * supervisor and the runners. So `hasRunningSessions` only matters once
 * the update is ready.
 */
export function updateControlView(
  status: AppUpdateStatus,
  hasRunningSessions: boolean,
  copy: UpdatesCopy,
): UpdateControlView {
  switch (status.kind) {
    case "idle":
      return { action: button("check", copy.check), note: null, error: null };
    case "checking":
      return {
        action: { kind: "progress", label: copy.checking },
        note: null,
        error: null,
      };
    case "unconfigured":
      return {
        action: button("check", copy.check),
        note: { tone: "info", message: copy.devNoChannel },
        error: null,
      };
    case "upToDate":
      return {
        action: button("check", copy.check),
        note: { tone: "success", message: copy.upToDate },
        error: null,
      };
    case "available":
      return {
        action: button("download", copy.download),
        note: { tone: "plain", message: copy.foundVersion(status.version) },
        error: null,
      };
    case "downloading": {
      if (status.phase === "installing") {
        return {
          action: { kind: "progress", label: copy.installing },
          note: null,
          error: null,
        };
      }
      // The 24px badge has no room for a bar; a percent suffix carries
      // the same real progress the TopBar bar shows.
      const percent = downloadPercent(status.progress);
      return {
        action: {
          kind: "progress",
          label:
            percent === null
              ? copy.preparing
              : `${copy.preparing} · ${percent}%`,
        },
        note: status.version
          ? { tone: "plain", message: copy.downloadingVersion(status.version) }
          : null,
        error: null,
      };
    }
    case "ready":
      return {
        action: button("restart", copy.restart, hasRunningSessions),
        note: hasRunningSessions
          ? {
              tone: "warning",
              message: copy.readyVersionAfterTasks(status.version),
            }
          : { tone: "success", message: copy.readyVersion(status.version) },
        error: null,
      };
    case "error":
      return {
        action: button("check", copy.retry),
        note: null,
        error: {
          title: status.message,
          detail: status.detail,
          manualDownloadUrl: status.manualDownloadUrl,
        },
      };
  }
}
