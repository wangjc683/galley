import { listen } from "@tauri-apps/api/event";

import { useSessionsStore } from "@/stores/sessions";
import type {
  ProjectBriefWire,
  SessionBriefWire,
} from "@/stores/sessions/shared";

/**
 * Core broadcasts every session and project write once, whoever made it —
 * CLI / supervisor through the socket, this page or another frontend
 * through Tauri commands (`core/src/session_writes.rs`, ticket 02d). This
 * routes each event to the sessions-store action that mirrors it. The
 * actions write nothing back to Core, and applying the echo of this
 * page's own write changes nothing.
 *
 * Rows arrive in Core's event form: every optional field present, `null`
 * when cleared.
 */

interface SessionRowPayload {
  session: SessionBriefWire;
  via: string;
}

/**
 * `via` of the session row Core announces after persisting a turn
 * (`core/src/turn_persistence`, VIA_TURN_PERSIST). This page does not
 * apply it: it bumps the row itself on each `turn_end` it receives
 * (`bumpSessionAfterTurn`), and the two arrive from separate Core tasks
 * in either order. Applied first, the announcement would be counted
 * again by the page's own bump; the turn-progress guard only protects
 * against an announcement that is behind. The phone reads it; ticket
 * 02e moves the page onto it.
 */
export const VIA_TURN_PERSIST = "turn-persist";

interface SessionDeletedPayload {
  sessionId: string;
  via: string;
}

interface ProjectRowPayload {
  project: ProjectBriefWire;
  via: string;
}

interface ProjectDeletedPayload {
  projectId: string;
  detachedSessions: number;
  detachedSessionIds: string[];
}

function on<T>(event: string, apply: (payload: T) => void) {
  return listen<T>(event, (e) => apply(e.payload));
}

/**
 * Subscribe to every Core row event. Resolves once all listeners are
 * attached, to a function that detaches them.
 */
export async function listenCoreRowEvents(): Promise<() => void> {
  const store = () => useSessionsStore.getState();
  const unlisteners = await Promise.all([
    on<SessionRowPayload>("session-created-external", (p) =>
      store().applyExternalSessionCreated(p.session),
    ),
    on<SessionRowPayload>("session-updated-external", (p) => {
      if (p.via === VIA_TURN_PERSIST) return;
      store().applyExternalSessionUpdated(p.session);
    }),
    on<SessionRowPayload>("session-archived-external", (p) =>
      store().applyExternalSessionUpdated(p.session),
    ),
    on<SessionRowPayload>("session-unarchived-external", (p) =>
      store().applyExternalSessionUpdated(p.session),
    ),
    on<SessionRowPayload>("session-moved-external", (p) =>
      store().applyExternalSessionUpdated(p.session),
    ),
    on<SessionDeletedPayload>("session-deleted-external", (p) =>
      store().applyExternalSessionDeleted(p.sessionId),
    ),
    on<ProjectRowPayload>("project-created-external", (p) =>
      store().applyExternalProjectCreated(p.project),
    ),
    on<ProjectRowPayload>("project-updated-external", (p) =>
      store().applyExternalProjectUpdated(p.project),
    ),
    on<ProjectDeletedPayload>("project-deleted-external", (p) =>
      store().applyExternalProjectDeleted(p.projectId),
    ),
  ]);
  return () => unlisteners.forEach((fn) => fn());
}
