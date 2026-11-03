import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import {
  SESSION_QUEUE_CHANGED_EVENT,
  type SessionQueueChangedPayload,
} from "@/lib/session-queue";
import { useMessagesStore } from "@/stores/messages";
import { useQueueStore } from "@/stores/queue";

/**
 * Global listener for Core's queue snapshots (galley#19/#20). Mounted
 * once at App level, same lifecycle idiom as useExternalCoreEvents /
 * useSchedulerSignals. Also fetches the active session's snapshot on
 * switch so a queue built while the session wasn't on screen (CLI
 * sends, other-session work) renders without waiting for the next
 * mutation event.
 *
 * Every snapshot also reaches the messages store: the main chat's
 * interjections (items marked `interjected`, main chat ticket 136) are
 * drawn in the conversation as your sent messages, not in the queue bar
 * (`syncInterjections`).
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
        useMessagesStore
          .getState()
          .syncInterjections(e.payload.sessionId, e.payload.items);
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
    void useQueueStore
      .getState()
      .loadFor(activeSessionId)
      .then(() => {
        const items = useQueueStore.getState().bySession[activeSessionId];
        if (items) {
          useMessagesStore.getState().syncInterjections(activeSessionId, items);
        }
      });
  }, [activeSessionId]);
}
