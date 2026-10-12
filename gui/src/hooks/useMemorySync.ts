import { useEffect } from "react";

import { useMemoryStore } from "@/stores/memory";
import type { RuntimeKind } from "@/types/session";

/**
 * Managed runtime only: keep the ledger switch and the exclusion marks
 * (stores/memory.ts) live from Core's `memory-changed`. The external
 * runtime has no ledger, so the store is emptied there and nothing asks
 * Core (its memory commands answer `managed_only`).
 */
export function useMemorySync(activeRuntimeKind: RuntimeKind): void {
  const connect = useMemoryStore((s) => s.connect);
  const reset = useMemoryStore((s) => s.reset);

  useEffect(() => {
    if (activeRuntimeKind !== "managed") return;
    const disconnect = connect();
    return () => {
      disconnect();
      reset();
    };
  }, [activeRuntimeKind, connect, reset]);
}
