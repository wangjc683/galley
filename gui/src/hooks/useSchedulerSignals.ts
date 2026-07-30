import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useCopy } from "@/lib/i18n";
import { sendGatedSystemNotification } from "@/lib/notify";
import {
  countFailedTasks,
  listScheduledTasks,
  SCHEDULED_TASKS_CHANGED_EVENT,
  SCHEDULED_TASK_FIRE_FAILED_EVENT,
  SCHEDULER_SUPERVISOR,
  type ScheduledFireFailedPayload,
} from "@/lib/scheduled-tasks";
import { useMessagesStore } from "@/stores/messages";
import type { Session } from "@/types/session";

/**
 * "Needs your action" count for the sidebar's 定时 quick-action row:
 * scheduler-created sessions waiting for an approval, plus enabled
 * tasks whose last fire failed to create a session. One number on
 * purpose — the badge's job is "something needs handling"; the two
 * categories are told apart inside the dialog, not in 16px of chrome.
 *
 * The approval half mirrors `useSessionStatusView`'s waiting_approval
 * branch (pendingApprovals on the live conversation slice), narrowed to
 * sessions whose creation origin carries the scheduler's supervisor
 * label. Sessions without a loaded conversation slice count as not
 * blocked — a false negative the system notification backstops; the
 * badge is a glance aid, not the source of truth.
 *
 * The failure half refetches the task list on Core's change event
 * (emitted on every CRUD and every fire), so the badge clears itself
 * the moment a later fire succeeds — no polling, no manual dismiss.
 */
export function useSchedulerActionCount(sessions: Session[]): number {
  const schedulerIds = useMemo(
    () =>
      sessions
        .filter((s) => s.origin?.supervisor === SCHEDULER_SUPERVISOR)
        .map((s) => s.id),
    [sessions],
  );
  const blocked = useMessagesStore(
    useShallow((state) =>
      schedulerIds.reduce(
        (count, id) =>
          (state.byId[id]?.pendingApprovals.length ?? 0) > 0
            ? count + 1
            : count,
        0,
      ),
    ),
  );

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

  return blocked + failed;
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
