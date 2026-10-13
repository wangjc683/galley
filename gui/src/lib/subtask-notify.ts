import type { AppCopy } from "@/i18n/types";
import type { NotifyTone, SystemNotifyKind } from "@/lib/notify";
import { displaySessionSummary } from "@/lib/session-summary";
import {
  failureText,
  isUnpromotedSubtask,
  type SubtaskDispatch,
  type SubtaskFailure,
} from "@/lib/subtasks";
import type { Session } from "@/types/session";

/**
 * When a subtask notifies (main chat ticket 06a, the ticket's point 4):
 *
 *   - asking you: always;
 *   - done: only when the run took at least
 *     [`SUBTASK_DONE_NOTIFY_AFTER_MS`] — a quick one finishes while the
 *     user is still looking at the main chat;
 *   - failed (the run ended on an error, its runner crashed, or it could
 *     not be started): always.
 *
 * Same principle as the sidebar, which hangs a row out when it is
 * waiting for you or errored. These replace the reply notifications
 * for an unpromoted subtask: its runs are Core's, not ones the user
 * started from this page, so the "only runs you started" rule of
 * `replyDone` (and iOS PRD ruling 17) would leave them silent — the
 * main chat PRD's design constraints make them the exception. A
 * promoted subtask is an ordinary conversation and notifies like one.
 *
 * Pure: the caller checks the window, prefs and permission
 * (`sendGatedSystemNotification`).
 */

/** A done subtask notifies only after running this long (JC,
 * 2026-10-13: 完成只在跑了 2 分钟以上时通知). */
export const SUBTASK_DONE_NOTIFY_AFTER_MS = 2 * 60_000;

export interface SubtaskNotification {
  kind: SystemNotifyKind;
  tone: NotifyTone;
  title: string;
  body: string;
  throttleKey: string;
}

/** Whether `session` gets the subtask rules (it is an unpromoted
 * subtask); otherwise the ordinary ones apply. */
export function usesSubtaskNotifications(
  session: Session | undefined,
): session is Session {
  return isUnpromotedSubtask(session);
}

function body(title: string, detail: string | null | undefined): string {
  return detail ? `${title} · ${detail}` : title;
}

/** The subtask stopped on a question. Always. */
export function subtaskAskingNotification(
  session: Session,
  question: string,
  copy: AppCopy,
): SubtaskNotification {
  return {
    kind: "askUser",
    tone: "needsYou",
    title: copy.subtask.notifyAsking,
    body: body(session.title, question),
    // Shared with the reply channel, as askUser / replyDone do: one run
    // terminus, one notification.
    throttleKey: `reply:${session.id}`,
  };
}

/**
 * The subtask's run ended with an answer. Only when it ran at least
 * two minutes: from `runStartedAtMs` (the messages store's run start)
 * or, when the page never saw the start, from the session's creation.
 */
export function subtaskDoneNotification(
  session: Session,
  {
    runStartedAtMs,
    nowMs,
    summary,
  }: { runStartedAtMs: number | null; nowMs: number; summary?: string | null },
  copy: AppCopy,
): SubtaskNotification | null {
  const startedAt = runStartedAtMs ?? Date.parse(session.createdAt);
  if (!Number.isFinite(startedAt)) return null;
  if (nowMs - startedAt < SUBTASK_DONE_NOTIFY_AFTER_MS) return null;
  const recap = summary
    ? displaySessionSummary(summary, copy.sidebar.turnProtocolFailure)
    : null;
  return {
    kind: "replyDone",
    tone: "done",
    title: copy.subtask.notifyDone,
    body: body(session.title, recap),
    throttleKey: `reply:${session.id}`,
  };
}

/** The subtask failed: its run ended on an error, its runner crashed,
 * or its runner could not start. Always. */
export function subtaskFailedNotification(
  title: string,
  sessionKey: string,
  failure: SubtaskFailure,
  copy: AppCopy,
): SubtaskNotification {
  return {
    kind: "subtaskFailed",
    tone: "alert",
    title: copy.subtask.notifyFailed,
    body: body(title || copy.subtask.label, failureText(failure, copy)),
    throttleKey: `subtask-failed:${sessionKey}`,
  };
}

/** The failures among one reply's dispatches, one notification each:
 * a tag Core could not use, a session it could not create, a runner it
 * could not start. */
export function dispatchFailureNotifications(
  dispatches: readonly SubtaskDispatch[],
  copy: AppCopy,
): SubtaskNotification[] {
  return dispatches
    .filter((d) => d.failure !== null)
    .map((d) =>
      subtaskFailedNotification(
        d.title,
        d.sessionId ?? `${d.parentSessionId}:${d.turnIndex}:${d.ordinal}`,
        d.failure === "empty"
          ? { kind: "empty" }
          : d.failure === "unclosed"
            ? { kind: "unclosed" }
            : { kind: "startFailed", detail: d.failureDetail },
        copy,
      ),
    );
}
