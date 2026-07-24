import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { SCHEDULER_SUPERVISOR } from "@/lib/scheduled-tasks";
import { useMessagesStore } from "@/stores/messages";
import type { Session } from "@/types/session";

/**
 * Count of scheduler-created sessions currently waiting for an
 * approval — drives the badge on the sidebar's 定时 quick-action row.
 *
 * Derivation mirrors `useSessionStatusView`'s waiting_approval branch
 * (pendingApprovals on the live conversation slice), narrowed to
 * sessions whose creation origin carries the scheduler's supervisor
 * label. Sessions without a loaded conversation slice count as not
 * blocked — a false negative the Core-side notification (issue 05)
 * backstops; the badge is a glance aid, not the source of truth.
 */
export function useSchedulerBlockedCount(sessions: Session[]): number {
  const schedulerIds = useMemo(
    () =>
      sessions
        .filter((s) => s.origin?.supervisor === SCHEDULER_SUPERVISOR)
        .map((s) => s.id),
    [sessions],
  );
  return useMessagesStore(
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
}
