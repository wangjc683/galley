import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import {
  mergeDispatches,
  type SubtaskDispatch,
  type SubtaskDispatchedPayload,
} from "@/lib/subtasks";

/**
 * Presenter mirror of Core's subtask dispatch records (main chat ticket
 * 06a): which reply of the main chat dispatched which subtask, or why
 * one was not started. Core is authoritative and writes them when a
 * reply lands; this store reads a parent's records once
 * (`list_subtask_dispatches`) and applies `subtask-dispatched` after.
 *
 * It also keeps, in memory only, the error the last run of a subtask
 * ended on — the card shows it as 失败. The page sees it as an IPC
 * `error` event; nothing persists it, so after a restart a run that
 * stopped short reads as 「没有跑完」 instead.
 */
interface SubtasksState {
  /** Dispatch records by parent session, in display order. */
  byParent: Record<string, SubtaskDispatch[]>;
  /** Parents whose records were read from Core (or are being read). */
  requested: Record<string, true>;
  /** The error the last run of a subtask ended on, by subtask id. */
  runErrors: Record<string, string>;
  /** Read a parent's records, once per page lifetime. */
  loadFor: (parentSessionId: string) => Promise<void>;
  /** Apply Core's `subtask-dispatched`. */
  applyDispatched: (payload: SubtaskDispatchedPayload) => void;
  setRunError: (sessionId: string, message: string | null) => void;
}

export const useSubtasksStore = create<SubtasksState>()((set, get) => ({
  byParent: {},
  requested: {},
  runErrors: {},
  loadFor: async (parentSessionId) => {
    if (get().requested[parentSessionId]) return;
    set((s) => ({ requested: { ...s.requested, [parentSessionId]: true } }));
    try {
      const records = await invoke<SubtaskDispatch[]>(
        "list_subtask_dispatches",
        { parentSessionId },
      );
      set((s) => ({
        byParent: {
          ...s.byParent,
          [parentSessionId]: mergeDispatches(
            s.byParent[parentSessionId] ?? [],
            records,
          ),
        },
      }));
    } catch (e) {
      // Non-Tauri runtime or a Core hiccup: allow a later retry; the
      // events keep new dispatches coming meanwhile.
      console.warn("[subtasks] list_subtask_dispatches failed", e);
      set((s) => {
        const requested = { ...s.requested };
        delete requested[parentSessionId];
        return { requested };
      });
    }
  },
  applyDispatched: ({ parentSessionId, dispatches }) => {
    const current = get().byParent[parentSessionId] ?? [];
    const next = mergeDispatches(current, dispatches);
    if (
      next.length === current.length &&
      next.every((d, i) => d === current[i])
    ) {
      return;
    }
    set((s) => ({ byParent: { ...s.byParent, [parentSessionId]: next } }));
  },
  setRunError: (sessionId, message) => {
    const current = get().runErrors[sessionId];
    if ((current ?? null) === message) return;
    set((s) => {
      const runErrors = { ...s.runErrors };
      if (message === null) delete runErrors[sessionId];
      else runErrors[sessionId] = message;
      return { runErrors };
    });
  },
}));

const EMPTY: SubtaskDispatch[] = [];

/** One parent's dispatch records (empty array when none). */
export function useSubtaskDispatches(
  parentSessionId: string | undefined,
): SubtaskDispatch[] {
  return useSubtasksStore((s) =>
    parentSessionId ? (s.byParent[parentSessionId] ?? EMPTY) : EMPTY,
  );
}
