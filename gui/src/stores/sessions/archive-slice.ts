import { invoke } from "@tauri-apps/api/core";

import { useRuntimeStore } from "@/stores/runtime";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";
import type { DurableSessionStatus } from "@/types/session";

import {
  GUI_ORIGIN,
  clearSessionMessages,
  currentCopy,
  patchSessionInList,
  pushDeleteFailedToast,
  type SessionsSliceCreator,
  type SessionsState,
} from "./shared";

export interface SessionArchiveSlice {
  archiveSession: (sessionId: string) => void;
  unarchiveSession: (sessionId: string) => void;
  deleteSessionPermanently: (sessionId: string) => Promise<void>;
  archiveSessionsBulk: (sessionIds: string[]) => void;
  unarchiveSessionsBulk: (sessionIds: string[]) => void;
  deleteSessionsPermanentlyBulk: (sessionIds: string[]) => Promise<void>;
  emptyArchive: () => Promise<number>;
}

export const createSessionArchiveSlice: SessionsSliceCreator<
  SessionArchiveSlice
> = (set, get) => ({
  archiveSession: (sessionId) => {
    const now = new Date().toISOString();
    let archivedTitle: string | null = null;
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        (s) => {
          archivedTitle = s.title;
          return { ...s, status: "archived", updatedAt: now };
        },
      );
      if (!changed) return {};
      const out: Partial<SessionsState> = { sessions };
      if (state.activeSessionId === sessionId) {
        out.activeSessionId = undefined;
      }
      return out;
    });
    if (archivedTitle === null) return;
    void invoke("archive_session", { id: sessionId, origin: GUI_ORIGIN }).catch(
      (e) => console.debug("[sessions] archive_session invoke failed.", e),
    );
    // UX feedback: archiving makes the row vanish from the sidebar —
    // a short info toast confirms the action.
    const copy = currentCopy();
    useUiStore.getState().pushToast(
      makeAppError({
        category: "business",
        severity: "info",
        title: copy.toasts.archived,
        message: archivedTitle,
        hint: null,
        retryable: false,
        context: "archiveSession",
        traceback: null,
      }),
    );
  },

  unarchiveSession: (sessionId) => {
    const now = new Date().toISOString();
    let changedAny = false;
    set((state) => {
      const { sessions, changed } = patchSessionInList(
        state.sessions,
        sessionId,
        (s) => {
          if (s.status !== "archived") return s;
          changedAny = true;
          return { ...s, status: "idle", updatedAt: now };
        },
      );
      return changed ? { sessions } : {};
    });
    if (!changedAny) return;
    void invoke("unarchive_session", {
      id: sessionId,
      origin: GUI_ORIGIN,
    }).catch((e) =>
      console.debug("[sessions] unarchive_session invoke failed.", e),
    );
  },

  deleteSessionPermanently: async (sessionId) => {
    // Defensive: shut down any live bridge before yanking the row.
    // Archived sessions shouldn't have one (LRU 5 typically reaps),
    // but covering the edge so we don't leak a process pointing at
    // a deleted id.
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
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== sessionId);
      const out: Partial<SessionsState> = { sessions };
      if (state.activeSessionId === sessionId) {
        out.activeSessionId = undefined;
      }
      return out;
    });
    clearSessionMessages(sessionId);
  },

  archiveSessionsBulk: (sessionIds) => {
    if (sessionIds.length === 0) return;
    const now = new Date().toISOString();
    const idSet = new Set(sessionIds);
    let archivedCount = 0;
    set((state) => {
      const sessions = state.sessions.map((s) => {
        if (!idSet.has(s.id) || s.status === "archived") return s;
        archivedCount++;
        return {
          ...s,
          status: "archived" as DurableSessionStatus,
          updatedAt: now,
        };
      });
      const out: Partial<SessionsState> = { sessions };
      if (state.activeSessionId && idSet.has(state.activeSessionId)) {
        out.activeSessionId = undefined;
      }
      return out;
    });
    if (archivedCount === 0) return;
    void invoke("bulk_archive_sessions", {
      ids: sessionIds,
      origin: GUI_ORIGIN,
    }).catch((e) =>
      console.debug("[sessions] bulk_archive_sessions invoke failed.", e),
    );
    const copy = currentCopy();
    useUiStore.getState().pushToast(
      makeAppError({
        category: "business",
        severity: "info",
        title: copy.toasts.archivedCount(archivedCount),
        message: "",
        hint: null,
        retryable: false,
        context: "archiveSessionsBulk",
        traceback: null,
      }),
    );
  },

  unarchiveSessionsBulk: (sessionIds) => {
    if (sessionIds.length === 0) return;
    const now = new Date().toISOString();
    const idSet = new Set(sessionIds);
    let unarchivedCount = 0;
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (!idSet.has(s.id) || s.status !== "archived") return s;
        unarchivedCount++;
        return { ...s, status: "idle" as DurableSessionStatus, updatedAt: now };
      }),
    }));
    if (unarchivedCount === 0) return;
    void invoke("bulk_unarchive_sessions", {
      ids: sessionIds,
      origin: GUI_ORIGIN,
    }).catch((e) =>
      console.debug("[sessions] bulk_unarchive_sessions invoke failed.", e),
    );
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
    const idSet = new Set(sessionIds);
    set((state) => {
      const sessions = state.sessions.filter((s) => !idSet.has(s.id));
      const out: Partial<SessionsState> = { sessions };
      if (state.activeSessionId && idSet.has(state.activeSessionId)) {
        out.activeSessionId = undefined;
      }
      return out;
    });
    sessionIds.forEach((id) => clearSessionMessages(id));
  },

  emptyArchive: async () => {
    const archived = get().sessions.filter((s) => s.status === "archived");
    if (archived.length === 0) return 0;
    await get().deleteSessionsPermanentlyBulk(archived.map((s) => s.id));
    return archived.length;
  },
});
