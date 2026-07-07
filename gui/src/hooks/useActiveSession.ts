import { type PerSessionMessages, useMessagesStore } from "@/stores/messages";
import { type PerSessionRuntime, useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";

/**
 * Project a single field off the active session's conversation slice.
 * Hides the `activeSessionId ? byId[id]?.field ?? fallback : fallback`
 * boilerplate that was hand-written at every render site — components
 * never name `byId` or thread `activeSessionId`, and the slice-missing
 * fallback lives in one call instead of being re-decided per site.
 *
 * Keep `select` a single-field projection (primitive or a stable ref like
 * an EMPTY_* singleton). Default strict-equality then subscribes as
 * narrowly as the old inline selector did — no wider re-render surface.
 */
export function useActiveMessages<T>(
  select: (m: PerSessionMessages) => T,
  fallback: T,
): T {
  const activeId = useSessionsStore((s) => s.activeSessionId);
  return useMessagesStore((s) => {
    const slice = activeId ? s.byId[activeId] : undefined;
    return slice ? select(slice) : fallback;
  });
}

/** As {@link useActiveMessages}, for the active session's runtime slot. */
export function useActiveRuntime<T>(
  select: (r: PerSessionRuntime) => T,
  fallback: T,
): T {
  const activeId = useSessionsStore((s) => s.activeSessionId);
  return useRuntimeStore((s) => {
    const slice = activeId ? s.byId[activeId] : undefined;
    return slice ? select(slice) : fallback;
  });
}
