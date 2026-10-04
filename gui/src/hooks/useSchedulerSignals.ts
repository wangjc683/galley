import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import { useCopy } from "@/lib/i18n";
import { sendGatedSystemNotification } from "@/lib/notify";
import {
  countFailedTasks,
  listScheduledTasks,
  SCHEDULED_TASKS_CHANGED_EVENT,
  SCHEDULED_TASK_FIRE_FAILED_EVENT,
  type ScheduledFireFailedPayload,
} from "@/lib/scheduled-tasks";

/**
 * "Needs your action" count for the sidebar's 定时 quick-action row:
 * enabled tasks whose last fire failed to create a session. The
 * badge's job is "something needs handling"; details live inside the
 * dialog, not in 16px of chrome.
 *
 * Refetches the task list on Core's change event (emitted on every
 * CRUD and every fire), so the badge clears itself the moment a later
 * fire succeeds — no polling, no manual dismiss.
 */
export function useSchedulerActionCount(): number {
  const [failed, setFailed] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const refresh = () => {
      listScheduledTasks()
        .then((tasks) => {
          if (!cancelled) setFailed(countFailedTasks(tasks));
        })
        .catch((e) => console.warn("[scheduled] badge list failed.", e));
    };
    refresh();
    void listen(SCHEDULED_TASKS_CHANGED_EVENT, refresh).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return failed;
}

/**
 * System notification for failed scheduler fires (决策 7's "needs your
 * action" contract, extended 2026-07-30 to cover failures). Core emits
 * the event; the GUI owns the OS notification so the two sides never
 * double-send (issue 05). Gating — window focus, permission, per-task
 * throttle — lives in `sendGatedSystemNotification`.
 */
export function useScheduledFireFailedNotification(): void {
  const copy = useCopy();
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void listen<ScheduledFireFailedPayload>(
      SCHEDULED_TASK_FIRE_FAILED_EVENT,
      (e) => {
        void sendGatedSystemNotification("scheduleFailed", {
          title: copy.scheduled.fireFailedNotifyTitle,
          body: copy.scheduled.fireFailedNotifyBody(e.payload.prompt),
          throttleKey: `schedule-failed:${e.payload.taskId}`,
        });
      },
    ).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [copy]);
}
