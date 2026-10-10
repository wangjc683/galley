import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { listenCoreRowEvents } from "@/lib/core-row-events";
import {
  applyRunnerHistoryReplay,
  type RunnerHistoryReplayPayload,
} from "@/lib/ipc/history-replay";
import type { UserMessagePersistedPayload } from "@/lib/session-send";
import { useMessagesStore } from "@/stores/messages";
import { useRuntimeStore } from "@/stores/runtime";

export function useExternalCoreEvents(): void {
  const applyUserMessagePersisted = useMessagesStore(
    (s) => s.applyUserMessagePersisted,
  );
  const appendSystemTurn = useMessagesStore((s) => s.appendSystemTurn);
  const attachExternalBridge = useRuntimeStore((s) => s.attachExternalBridge);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const fn = await listen<UserMessagePersistedPayload>(
        "user-message-persisted",
        (e) => {
          const { sessionId, message } = e.payload;
          if (message.role === "system") {
            appendSystemTurn(sessionId, {
              role: "system",
              content: message.content,
              variant: "goal",
            });
            return;
          }
          // Claims this page's own optimistic echo, dedupes a row's
          // second broadcast, appends anyone else's (ticket 02c).
          applyUserMessagePersisted(e.payload);
        },
      );
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [applyUserMessagePersisted, appendSystemTurn]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const fn = await listen<{
        sessionId: string;
        pid: number;
        via: string;
      }>("runner-spawned-external", (e) => {
        void attachExternalBridge(e.payload.sessionId, e.payload.pid);
      });
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [attachExternalBridge]);

  // Core replays a session's history into its runner (ticket 02b) and
  // announces each attempt; a send waiting on it shows "restoring".
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const fn = await listen<RunnerHistoryReplayPayload>(
        "runner-history-replay",
        (e) => applyRunnerHistoryReplay(e.payload),
      );
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Session and project rows: Core broadcasts every write, this page's
  // own included (ticket 02d), and the store mirrors each one.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void listenCoreRowEvents().then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
