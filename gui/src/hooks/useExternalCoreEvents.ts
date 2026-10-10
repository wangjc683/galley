import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import {
  applyRunnerHistoryReplay,
  type RunnerHistoryReplayPayload,
} from "@/lib/ipc/history-replay";
import type { UserMessagePersistedPayload } from "@/lib/session-send";
import { useMessagesStore } from "@/stores/messages";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";

export function useExternalCoreEvents(): void {
  const applyUserMessagePersisted = useMessagesStore(
    (s) => s.applyUserMessagePersisted,
  );
  const appendSystemTurn = useMessagesStore((s) => s.appendSystemTurn);
  const attachExternalBridge = useRuntimeStore((s) => s.attachExternalBridge);
  const applyExternalSessionCreated = useSessionsStore(
    (s) => s.applyExternalSessionCreated,
  );
  const applyExternalSessionUpdated = useSessionsStore(
    (s) => s.applyExternalSessionUpdated,
  );
  const applyExternalProjectCreated = useSessionsStore(
    (s) => s.applyExternalProjectCreated,
  );
  const applyExternalProjectDeleted = useSessionsStore(
    (s) => s.applyExternalProjectDeleted,
  );

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

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    type ExternalPayload = {
      session: Parameters<typeof applyExternalSessionCreated>[0];
      via: string;
    };
    void (async () => {
      const subscribe = async (
        event: string,
        handler: (p: ExternalPayload) => void,
      ) => {
        const fn = await listen<ExternalPayload>(event, (e) =>
          handler(e.payload),
        );
        if (cancelled) {
          fn();
        } else {
          unlisteners.push(fn);
        }
      };
      await subscribe("session-created-external", (p) =>
        applyExternalSessionCreated(p.session),
      );
      await subscribe("session-archived-external", (p) =>
        applyExternalSessionUpdated(p.session),
      );
      await subscribe("session-unarchived-external", (p) =>
        applyExternalSessionUpdated(p.session),
      );
      await subscribe("session-moved-external", (p) =>
        applyExternalSessionUpdated(p.session),
      );
      await subscribe("session-updated-external", (p) =>
        applyExternalSessionUpdated(p.session),
      );
    })();
    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [applyExternalSessionCreated, applyExternalSessionUpdated]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      const createdFn = await listen<{
        project: Parameters<typeof applyExternalProjectCreated>[0];
        via: string;
      }>("project-created-external", (e) => {
        applyExternalProjectCreated(e.payload.project);
      });
      if (cancelled) createdFn();
      else unlisteners.push(createdFn);

      const deletedFn = await listen<{
        projectId: string;
        detachedSessions: number;
        detachedSessionIds: string[];
      }>("project-deleted-external", (e) => {
        applyExternalProjectDeleted(e.payload.projectId);
      });
      if (cancelled) deletedFn();
      else unlisteners.push(deletedFn);
    })();
    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [applyExternalProjectCreated, applyExternalProjectDeleted]);
}
