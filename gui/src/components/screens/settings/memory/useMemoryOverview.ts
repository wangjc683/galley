import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import {
  getMemoryOverview,
  MEMORY_CHANGED_EVENT,
  memoryErrorText,
  type MemoryOverview,
} from "@/lib/memory";

/**
 * Settings → Memory's overview from Core (`get_memory_overview`), read
 * when the page opens and again on every `memory-changed` (no polling)
 * or `reload()`. A newer read cancels an older one still in flight, so
 * an old snapshot never lands over a new one. `enabled` false reads
 * nothing.
 */
export function useMemoryOverview(enabled: boolean): {
  overview: MemoryOverview | null;
  error: string | null;
  reload: () => void;
} {
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readTick, setReadTick] = useState(0);
  const reload = useCallback(() => setReadTick((tick) => tick + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    listen(MEMORY_CHANGED_EVENT, () => {
      if (!cancelled) reload();
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((e: unknown) => {
        console.warn("[memory] subscribing to memory-changed failed", e);
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, reload]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getMemoryOverview()
      .then((next) => {
        if (cancelled) return;
        setOverview(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.warn("[memory] reading the overview failed", e);
        setError(memoryErrorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, readTick]);

  return { overview, error, reload };
}
