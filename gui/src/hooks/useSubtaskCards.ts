import { useEffect, useMemo } from "react";

import type { SubtaskDispatch } from "@/lib/subtasks";
import { useSubtaskDispatches, useSubtasksStore } from "@/stores/subtasks";

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
  const dispatches = useSubtaskDispatches(parentSessionId);
  const loadFor = useSubtasksStore((s) => s.loadFor);
  useEffect(() => {
    if (parentSessionId) void loadFor(parentSessionId);
  }, [parentSessionId, loadFor]);
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
