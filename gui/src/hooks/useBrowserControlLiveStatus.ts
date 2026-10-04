import { useEffect } from "react";

import { useBrowserControlStore } from "@/stores/browser-control";
import type { RuntimeKind } from "@/types/session";

/**
 * Managed runtime only: keep Browser Control's status live from Core's
 * resident browser bridge (`browser-bridge-updated`) and sync the
 * extension folder once per launch. There is no per-launch probe any
 * more; the store runs the deterministic probe by itself the first time
 * the extension connects before setup is verified.
 */
export function useBrowserControlLiveStatus(
  activeRuntimeKind: RuntimeKind,
): void {
  const ensureLayout = useBrowserControlStore((s) => s.ensureLayout);
  const connectLiveStatus = useBrowserControlStore((s) => s.connectLiveStatus);
  const resetLiveStatus = useBrowserControlStore((s) => s.resetLiveStatus);

  useEffect(() => {
    if (activeRuntimeKind !== "managed") return;
    void ensureLayout();
    const disconnect = connectLiveStatus();
    return () => {
      disconnect();
      resetLiveStatus();
    };
  }, [activeRuntimeKind, connectLiveStatus, ensureLayout, resetLiveStatus]);
}
