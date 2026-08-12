import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import {
  SESSION_QUEUE_CHANGED_EVENT,
  type SessionQueueChangedPayload,
} from "@/lib/session-queue";
import { useQueueStore } from "@/stores/queue";

/**
 * Global listener for Core's queue snapshots (galley#19/#20). Mounted
 * once at App level, same lifecycle idiom as useExternalCoreEvents /
 * useSchedulerSignals. Also fetches the active session's snapshot on
 * switch so a queue built while the session wasn't on screen (CLI
 * sends, other-session work) renders without waiting for the next
 * mutation event.
 */
export function useSessionQueueEvents(activeSessionId: string | null): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void listen<SessionQueueChangedPayload>(
      SESSION_QUEUE_CHANGED_EVENT,
      (e) => {
        useQueueStore
          .getState()
          .applySnapshot(e.payload.sessionId, e.payload.items);
      },
    ).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    void useQueueStore.getState().loadFor(activeSessionId);
  }, [activeSessionId]);
}
