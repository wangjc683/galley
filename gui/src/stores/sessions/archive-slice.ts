import { invoke } from "@tauri-apps/api/core";

import { useRuntimeStore } from "@/stores/runtime";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type { DurableSessionStatus } from "@/types/session";

import {
  GUI_ORIGIN,
  currentCopy,
  forgetDeletedSessions,
  patchSessionInList,
  pushDeleteFailedToast,
  rollBackSessionWrites,
  rowUndo,
  type SessionsSliceCreator,
  type SessionsState,
} from "./shared";

/** The archive writes move the row first and confirm after: when Core
 * refuses, the row goes back and an error toast says so (2026-11-10
 * audit, A7); the 已归档 toast waits for Core. They resolve either way. */
export interface SessionArchiveSlice {
  archiveSession: (sessionId: string) => Promise<void>;
  unarchiveSession: (sessionId: string) => Promise<void>;
  deleteSessionPermanently: (sessionId: string) => Promise<void>;
  archiveSessionsBulk: (sessionIds: string[]) => Promise<void>;
  unarchiveSessionsBulk: (sessionIds: string[]) => Promise<void>;
  deleteSessionsPermanentlyBulk: (sessionIds: string[]) => Promise<void>;
  emptyArchive: () => Promise<number>;
}

export const createSessionArchiveSlice: SessionsSliceCreator<
  SessionArchiveSlice
> = (set, get) => ({
  archiveSession: async (sessionId) => {
    const prev = get().sessions.find((s) => s.id === sessionId);
    if (!prev) return;
    const undo = rowUndo(prev, {
      status: "archived",
      updatedAt: new Date().toISOString(),
    });
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        undo.after,
      );
      if (!changed) return {};
      const out: Partial<SessionsState> = { sessions };
      if (state.activeSessionId === sessionId) {
        out.activeSessionId = undefined;
      }
      return out;
    });
    try {
      await invoke("archive_session", { id: sessionId, origin: GUI_ORIGIN });
    } catch (e) {
      // The row comes back; the open session stays closed.
      rollBackSessionWrites(set, [undo], "archiveSession", e);
      return;
    }
    // UX feedback: archiving makes the row vanish from the sidebar —
    // a short info toast confirms the action.
    const copy = currentCopy();
    useUiStore.getState().pushToast(
      makeAppError({
        category: "business",
        severity: "info",
        title: copy.toasts.archived,
        message: prev.title,
        hint: null,
        retryable: false,
        context: "archiveSession",
        traceback: null,
      }),
    );
  },

  unarchiveSession: async (sessionId) => {
    const prev = get().sessions.find((s) => s.id === sessionId);
    if (prev?.status !== "archived") return;
    const undo = rowUndo(prev, {
      status: "idle",
      updatedAt: new Date().toISOString(),
    });
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        undo.after,
      );
      return changed ? { sessions } : {};
    });
    try {
      await invoke("unarchive_session", { id: sessionId, origin: GUI_ORIGIN });
    } catch (e) {
      rollBackSessionWrites(set, [undo], "unarchiveSession", e);
    }
  },

  deleteSessionPermanently: async (sessionId) => {
    // Shut down any live bridge before yanking the row, so we don't
    // leak a process pointing at a deleted id. Archiving does not stop
    // a runner; only Core's runner cap (20, LRU) evicts an idle one.
    try {
      await useRuntimeStore.getState().shutdownBridge(sessionId);
    } catch (e) {
      console.warn(
        "[sessions] deleteSessionPermanently shutdownBridge failed.",
        e,
      );
    }
    try {
      await invoke("delete_session", { id: sessionId, origin: GUI_ORIGIN });
    } catch (e) {
      console.warn("[sessions] delete_session invoke failed.", e);
      pushDeleteFailedToast("deleteSessionPermanently", e);
      throw e;
    }
    // Core's `session-deleted-external` for this delete may land first;
    // forgetting is idempotent.
    forgetDeletedSessions(set, [sessionId]);
  },

  archiveSessionsBulk: async (sessionIds) => {
    if (sessionIds.length === 0) return;
    const now = new Date().toISOString();
    const idSet = new Set(sessionIds);
    // Core archives the batch in one transaction: all or none.
    const undos = get()
      .sessions.filter((s) => idSet.has(s.id) && s.status !== "archived")
      .map((s) =>
        rowUndo(s, {
          status: "archived" as DurableSessionStatus,
          updatedAt: now,
        }),
      );
    if (undos.length === 0) return;
    const archivedIds = new Set(undos.map((undo) => undo.id));
    set((state) => {
      const sessions = state.sessions.map((s) =>
        archivedIds.has(s.id)
          ? { ...s, status: "archived" as DurableSessionStatus, updatedAt: now }
          : s,
      );
      const out: Partial<SessionsState> = { sessions };
      if (state.activeSessionId && idSet.has(state.activeSessionId)) {
        out.activeSessionId = undefined;
      }
      return out;
    });
    try {
      await invoke("bulk_archive_sessions", {
        ids: sessionIds,
        origin: GUI_ORIGIN,
      });
    } catch (e) {
      rollBackSessionWrites(set, undos, "archiveSessionsBulk", e);
      return;
    }
    const copy = currentCopy();
    useUiStore.getState().pushToast(
      makeAppError({
        category: "business",
        severity: "info",
        title: copy.toasts.archivedCount(undos.length),
        message: "",
        hint: null,
        retryable: false,
        context: "archiveSessionsBulk",
        traceback: null,
      }),
    );
  },

  unarchiveSessionsBulk: async (sessionIds) => {
    if (sessionIds.length === 0) return;
    const now = new Date().toISOString();
    const idSet = new Set(sessionIds);
    const undos = get()
      .sessions.filter((s) => idSet.has(s.id) && s.status === "archived")
      .map((s) =>
        rowUndo(s, { status: "idle" as DurableSessionStatus, updatedAt: now }),
      );
    if (undos.length === 0) return;
    const restoredIds = new Set(undos.map((undo) => undo.id));
    set((state) => ({
      sessions: state.sessions.map((s) =>
        restoredIds.has(s.id)
          ? { ...s, status: "idle" as DurableSessionStatus, updatedAt: now }
          : s,
      ),
    }));
    try {
      await invoke("bulk_unarchive_sessions", {
        ids: sessionIds,
        origin: GUI_ORIGIN,
      });
    } catch (e) {
      rollBackSessionWrites(set, undos, "unarchiveSessionsBulk", e);
    }
  },

  deleteSessionsPermanentlyBulk: async (sessionIds) => {
    if (sessionIds.length === 0) return;
    // Sequential bridge teardown — racing N parallel shutdowns
    // against the same process tree caused flakiness in M3b dogfood.
    for (const id of sessionIds) {
      try {
        await useRuntimeStore.getState().shutdownBridge(id);
      } catch (e) {
        console.warn(
          `[sessions] deleteSessionsPermanentlyBulk shutdownBridge failed for ${id}.`,
          e,
        );
      }
    }
    try {
      await invoke("bulk_delete_sessions", {
        ids: sessionIds,
        origin: GUI_ORIGIN,
      });
    } catch (e) {
      console.warn("[sessions] bulk_delete_sessions invoke failed.", e);
      pushDeleteFailedToast("deleteSessionsPermanentlyBulk", e);
      throw e;
    }
    forgetDeletedSessions(set, sessionIds);
  },

  emptyArchive: async () => {
    const archived = get().sessions.filter((s) => s.status === "archived");
    if (archived.length === 0) return 0;
    await get().deleteSessionsPermanentlyBulk(archived.map((s) => s.id));
    return archived.length;
  },
});
