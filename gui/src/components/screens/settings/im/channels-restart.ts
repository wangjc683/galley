import type { AppCopy } from "@/lib/i18n";
import {
  restartEnabledImSupervisors,
  type ImSupervisorStatus,
} from "@/lib/im-supervisor";
import { makeAppError, type AppError } from "@/types/app-error";

import { channelErrorBlockTitle } from "./channel-error";
import { channelPlatformLabel } from "./channel-view";

const CONTEXT = "restart_enabled_im_supervisors";

/**
 * The toast for a finished "restart all channels". Core restarts each
 * enabled channel on its own and returns one status per channel; one
 * that failed to come back reports `error` with its reason in
 * `lastError`. All back: an info toast. Some failed: a warning naming
 * each failed platform with its reason in words (`channel-error.ts`, the
 * same titles the card shows). All failed: the error toast.
 */
export function channelsRestartToast(
  statuses: ReadonlyArray<ImSupervisorStatus>,
  copy: AppCopy,
): AppError {
  const toasts = copy.toasts;
  const imCopy = copy.settings.im;
  if (statuses.length === 0) {
    return makeAppError({
      id: "channels-restarted",
      category: "business",
      severity: "info",
      title: toasts.channelsRestartNone,
      message: "",
      hint: null,
      retryable: false,
      context: CONTEXT,
      traceback: null,
      autoDismissMs: 4200,
    });
  }
  const failed = statuses.filter(
    (status) => status.state === "error" && Boolean(status.lastError),
  );
  if (failed.length === 0) {
    return makeAppError({
      id: "channels-restarted",
      category: "business",
      severity: "info",
      title: toasts.channelsRestarted,
      message: toasts.channelsRestartedMessage,
      hint: null,
      retryable: false,
      context: CONTEXT,
      traceback: null,
      autoDismissMs: 4200,
    });
  }
  const failures = failed
    .map((status) =>
      toasts.channelsRestartFailureItem(
        channelPlatformLabel(status.platform, imCopy),
        // The reasons are joined into one line, so drop each one's own
        // closing full stop (the catch-all hints end with one).
        channelErrorBlockTitle(
          status.platform,
          status.state,
          status.lastError ?? "",
          imCopy,
        ).replace(/[。.]$/, ""),
      ),
    )
    .join(toasts.channelsRestartFailureSeparator);
  const restarted = statuses.length - failed.length;
  return makeAppError({
    id: "channels-restart-failed",
    category: "business",
    severity: restarted > 0 ? "warning" : "error",
    title:
      restarted > 0
        ? toasts.channelsRestartPartial
        : toasts.channelsRestartFailed,
    message:
      restarted > 0
        ? toasts.channelsRestartPartialMessage(restarted, failures)
        : failures,
    hint: null,
    retryable: false,
    context: CONTEXT,
    traceback: null,
  });
}

/** The toast when the restart call itself rejected (the shared runtime
 * preparation failed, so no channel was restarted). */
export function channelsRestartRejectedToast(
  error: unknown,
  copy: AppCopy,
): AppError {
  return makeAppError({
    id: "channels-restart-failed",
    category: "business",
    severity: "error",
    title: copy.toasts.channelsRestartFailed,
    message: error instanceof Error ? error.message : String(error),
    hint: null,
    retryable: false,
    context: CONTEXT,
    traceback: null,
  });
}

/**
 * "Restart all channels", shared by Settings → Channels and the App-level
 * channels feed (topbar menu, Models toast CTA): restart, hand each
 * returned status to the caller's per-platform setter, toast the result.
 * Never throws.
 */
export async function restartEnabledChannels({
  copy,
  pushToast,
  setStatus,
}: {
  copy: AppCopy;
  pushToast: (error: AppError) => void;
  setStatus: (status: ImSupervisorStatus) => void;
}): Promise<void> {
  let statuses: ImSupervisorStatus[];
  try {
    statuses = await restartEnabledImSupervisors();
  } catch (e) {
    pushToast(channelsRestartRejectedToast(e, copy));
    return;
  }
  for (const status of statuses) setStatus(status);
  pushToast(channelsRestartToast(statuses, copy));
}
