import type { AppCopy } from "@/i18n/types";
import type { NotifyTone, SystemNotifyKind } from "@/lib/notify";
import { buildRunGroups } from "@/lib/run-groups";
import { displaySessionSummary } from "@/lib/session-summary";
import {
  deriveSubtaskCard,
  failureText,
  isUnpromotedSubtask,
  type SubtaskDispatch,
  type SubtaskFailure,
  type SubtaskLiveView,
} from "@/lib/subtasks";
import type { Turn } from "@/types/conversation";
import type { Session } from "@/types/session";

/**
 * A subtask's own notifications (main chat ticket 06a, the ticket's
 * point 4):
 *
 *   - asking you: always;
 *   - done: only when the run took at least
 *     [`SUBTASK_DONE_NOTIFY_AFTER_MS`] — a quick one finishes while the
 *     user is still looking at the main chat;
 *   - failed (the run ended on an error, its runner crashed, or it could
 *     not be started): always.
 *
 * Since ticket 31 they are a fallback, not the rule: one voice. When a
 * subtask's run ends Core wakes the main chat with a report, and the
 * assistant's reply is what notifies (as a reply to the user's own
 * message would). A subtask notifies on its own only when that report
 * could not be delivered (Core's `subtask-report-undelivered`), from
 * how it stands then (`subtaskFallbackNotification`). A promoted
 * subtask is an ordinary conversation and notifies like one.
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

/** A dispatch's key when it has no session: reply and tag position. */
function dispatchKey(d: SubtaskDispatch): string {
  return d.sessionId ?? `${d.parentSessionId}:${d.turnIndex}:${d.ordinal}`;
}

/** The latest run's length from its telemetry (run-groups' whole-run
 * elapsed, ask_user pauses excluded), or null when the page has none. */
function lastRunElapsedMs(turns: readonly Turn[]): number | null {
  const groups = buildRunGroups(turns as Turn[]);
  return groups[groups.length - 1]?.stats.elapsedMs ?? null;
}

/**
 * The notification a subtask would have sent itself, from how it stands
 * now (`deriveSubtaskCard`, the card's own state): the fallback when its
 * report could not wake the main chat (ticket 31). Asking → asking;
 * failed — an error, a crash, a runner that never started, a tag Core
 * could not use — → failed; done → done, only after two minutes of
 * running (measured by the run's telemetry, else from the session's
 * creation, as before); anything else — running again, cut short, gone,
 * promoted, unknown — → none. Rules, words and throttle keys are the
 * ones these notifications always had.
 */
export function subtaskFallbackNotification(
  dispatch: SubtaskDispatch | undefined,
  session: Session | undefined,
  live: SubtaskLiveView,
  nowMs: number,
  copy: AppCopy,
): SubtaskNotification | null {
  // A promoted subtask is an ordinary conversation.
  if (session && !usesSubtaskNotifications(session)) return null;
  const record: SubtaskDispatch | undefined =
    dispatch ??
    (session && {
      // The page has no record (the main chat's were never read): the
      // session alone says enough.
      parentSessionId: session.parentSessionId ?? "",
      turnIndex: 0,
      ordinal: 0,
      messageId: "",
      sessionId: session.id,
      title: session.title,
      failure: null,
      failureDetail: null,
      createdAt: session.createdAt,
    });
  if (!record) return null;
  const state = deriveSubtaskCard(record, session, live);
  switch (state.kind) {
    case "asking":
      return session
        ? subtaskAskingNotification(session, state.pending.question, copy)
        : null;
    case "notStarted":
      return subtaskFailedNotification(
        record.title,
        dispatchKey(record),
        state.failure,
        copy,
      );
    case "failed":
      // 「没有跑完」 (cut short, the step cap) never notified.
      if (state.failure.kind === "didNotFinish") return null;
      return subtaskFailedNotification(
        session?.title || record.title,
        dispatchKey(record),
        state.failure,
        copy,
      );
    case "done": {
      if (!session) return null;
      const elapsedMs = lastRunElapsedMs(live.turns);
      return subtaskDoneNotification(
        session,
        {
          runStartedAtMs: elapsedMs != null ? nowMs - elapsedMs : null,
          nowMs,
          summary: session.summary,
        },
        copy,
      );
    }
    default:
      return null;
  }
}
