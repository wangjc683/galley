import type { AppCopy } from "@/i18n/types";
import type { NotifyTone, SystemNotifyKind } from "@/lib/notify";
import { reminderFirstLine } from "@/lib/reminder-first-line";
import type { ScheduledReminderUndeliveredPayload } from "@/lib/scheduled-tasks";
import { makeAppError, type AppError } from "@/types/app-error";

/**
 * A reminder that could not reach the assistant (main chat tickets 33
 * and 37; assistant PRD ruling 9): it came due while the main chat was
 * waiting for the user's answer, its runner did not start, or the turn
 * it woke ended on an error. Core consumed the fire and sent
 * `scheduled-tasks:reminder-undelivered`; the reminder is not tried
 * again, so its words must reach the user here — a reminder lost is
 * worse than one late.
 *
 *   - Window in the background: a system notification titled 「提醒」
 *     with the words it noted (the `scheduleFailed` kind: no pref, it
 *     needs the user; the "needs you" tone). The view is left alone
 *     (main chat PRD ruling 88): you may have left the window on other
 *     work, and the assistant's card already wears its 「等你回复」
 *     badge — the main chat was asking you, that is why the reminder
 *     could not get in; its words stay in the notification centre and
 *     in 待办's 「最近做完」. (The desktop notification plugin reports
 *     no clicks, so a click cannot land anywhere either.)
 *   - Window in front: no system notification (the gate's rule, as for
 *     a subtask's fallback, ticket 31), and the words as an in-app toast
 *     that stays until closed — a subtask's state is on its card, a
 *     reminder's words are nowhere else on screen.
 *
 * In both, the words are their first line only (main chat ticket 105,
 * PRD ruling 151; lib/reminder-first-line.ts): that line is written for
 * the user, what follows the blank line is the assistant's notes to
 * itself.
 */

export interface ReminderFallbackDeps {
  windowFocused: () => Promise<boolean>;
  pushToast: (toast: AppError) => void;
  notify: (
    kind: SystemNotifyKind,
    options: {
      title: string;
      body: string;
      throttleKey?: string;
      tone?: NotifyTone;
    },
  ) => Promise<void>;
}

/** Tell the user about an undelivered reminder where they are; which
 * channel it took. */
export async function remindUndelivered(
  payload: ScheduledReminderUndeliveredPayload,
  copy: AppCopy,
  deps: ReminderFallbackDeps,
): Promise<"toast" | "notification"> {
  const title = copy.scheduled.reminderNotifyTitle;
  const words = reminderFirstLine(payload.prompt);
  if (await deps.windowFocused()) {
    deps.pushToast(
      makeAppError({
        id: `reminder-undelivered:${payload.taskId}`,
        category: "business",
        severity: "info",
        title,
        message: words,
        hint: null,
        retryable: false,
        context: "scheduled_reminder",
        traceback: null,
        // Stays until closed: the words are the reminder.
        autoDismissMs: 0,
      }),
    );
    return "toast";
  }
  await deps.notify("scheduleFailed", {
    title,
    body: words,
    throttleKey: `schedule-reminder:${payload.taskId}`,
    tone: "needsYou",
  });
  return "notification";
}
