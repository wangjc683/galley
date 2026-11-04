import { useEffect, useMemo } from "react";

import type { SubtaskDispatch } from "@/lib/subtasks";
import { useSubtaskDispatches, useSubtasksStore } from "@/stores/subtasks";

/**
 * A parent's subtask dispatch records, in display order, read from Core
 * once (`loadFor`, once per page lifetime); Core's `subtask-dispatched`
 * keeps them current. The cards under the main chat's replies read them
 * (below), and so does the sidebar card while the main chat runs: which
 * woken round is the second half of a round of yours (main chat PRD
 * ruling 197, lib/subtasks.ts `inSecondHalf`) — with the main chat not
 * opened since launch, nothing else would have read them.
 * `parentSessionId` undefined → none, and nothing is read.
 */
export function useLoadedSubtaskDispatches(
  parentSessionId: string | undefined,
): SubtaskDispatch[] {
  const dispatches = useSubtaskDispatches(parentSessionId);
  const loadFor = useSubtasksStore((s) => s.loadFor);
  useEffect(() => {
    if (parentSessionId) void loadFor(parentSessionId);
  }, [parentSessionId, loadFor]);
  return dispatches;
}

/**
 * The main chat's subtask dispatches, grouped by the reply that carried
 * them (`messageId`), each group in tag order — what the cards under
 * each reply render (main chat ticket 06a). Reads the parent's records
 * from Core once; Core's `subtask-dispatched` keeps them current.
 * `parentSessionId` undefined (not the main chat) → an empty map, and
 * nothing is read.
 */
export function useSubtaskDispatchesByMessage(
  parentSessionId: string | undefined,
): Map<string, SubtaskDispatch[]> {
  const dispatches = useLoadedSubtaskDispatches(parentSessionId);
  return useMemo(() => {
    const byMessage = new Map<string, SubtaskDispatch[]>();
    for (const d of dispatches) {
      const group = byMessage.get(d.messageId);
      if (group) group.push(d);
      else byMessage.set(d.messageId, [d]);
    }
    return byMessage;
  }, [dispatches]);
}
