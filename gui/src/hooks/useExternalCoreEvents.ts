import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { dispatchNativeRuntimeEvent } from "@/lib/ipc-handlers";
import { useMessagesStore } from "@/stores/messages";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import type { NativeRuntimeEvent } from "@/types/ipc";

export function useExternalCoreEvents(): void {
  const appendUserTurnExternal = useMessagesStore(
    (s) => s.appendUserTurnExternal,
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
      const fn = await listen<{
        sessionId: string;
        dispatch?: "dispatched" | "persisted_only" | "spawn_failed";
        message: {
          content: string;
          createdAt?: string;
          turnIndex?: number;
          role?: "user" | "agent" | "system";
          origin?: {
            via: "gui" | "cli" | "supervisor" | "system";
            supervisor?: string;
            reason?: string;
          };
        };
      }>("user-message-persisted", (e) => {
        const { sessionId, message, dispatch } = e.payload;
        if (message.role === "system") {
          appendSystemTurn(sessionId, {
            role: "system",
            content: message.content,
            variant: "goal",
          });
          return;
        }
        appendUserTurnExternal(
          sessionId,
          message.content,
          message.origin,
          message.createdAt,
          dispatch === undefined ? true : dispatch === "dispatched",
          message.turnIndex,
        );
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
  }, [appendUserTurnExternal, appendSystemTurn]);

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

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const fn = await listen<NativeRuntimeEvent>(
        "native-runtime-event",
        (e) => {
          dispatchNativeRuntimeEvent(e.payload);
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
