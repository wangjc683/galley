import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import {
  mergeDispatches,
  type SubtaskDispatch,
  type SubtaskDispatchedPayload,
} from "@/lib/subtasks";
import type { PendingAskUser } from "@/types/conversation";

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
 *
 * And, in memory only, which subtasks' reports Core could not deliver
 * to the main chat (`subtask-report-undelivered`): their question is
 * answered in the card (ruling 101, lib/subtasks.ts `answeredInCard`).
 * Core says it once per report, so a page reloaded meanwhile does not
 * hear it again: the card then only says the subtask is waiting, and
 * the question is answered in the subtask itself (「打开」).
 */
interface SubtasksState {
  /** Dispatch records by parent session, in display order. */
  byParent: Record<string, SubtaskDispatch[]>;
  /** Parents whose records were read from Core (or are being read). */
  requested: Record<string, true>;
  /** The error the last run of a subtask ended on, by subtask id. */
  runErrors: Record<string, string>;
  /** Subtasks whose question is answered in their card, by subtask id:
   * the question each was asking when Core said its report could not
   * wake the main chat, null when the page had not seen it yet. */
  askInCard: Record<string, PendingAskUser | null>;
  /** Read a parent's records, once per page lifetime. */
  loadFor: (parentSessionId: string) => Promise<void>;
  /** Apply Core's `subtask-dispatched`. */
  applyDispatched: (payload: SubtaskDispatchedPayload) => void;
  setRunError: (sessionId: string, message: string | null) => void;
  /** Core could not deliver these subtasks' reports: each one's question,
   * as the page has it now (null for none yet), goes to its card. */
  markAskInCard: (questions: Record<string, PendingAskUser | null>) => void;
  /** Their question is no longer the card's to answer: the subtask
   * runs again, or a wake carrying it reached the assistant. */
  clearAskInCard: (sessionIds: readonly string[]) => void;
  /** Drop what is kept for deleted sessions: their dispatch records as
   * a parent, their last run error and a question left to their card
   * (resetting the main chat, ticket 15). */
  forgetSessions: (sessionIds: readonly string[]) => void;
}

export const useSubtasksStore = create<SubtasksState>()((set, get) => ({
  byParent: {},
  requested: {},
  runErrors: {},
  askInCard: {},
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
  markAskInCard: (questions) => {
    if (Object.keys(questions).length === 0) return;
    set((s) => ({ askInCard: { ...s.askInCard, ...questions } }));
  },
  clearAskInCard: (sessionIds) => {
    const current = get().askInCard;
    const known = sessionIds.filter((id) => id in current);
    if (known.length === 0) return;
    set((s) => {
      const askInCard = { ...s.askInCard };
      for (const id of known) delete askInCard[id];
      return { askInCard };
    });
  },
  forgetSessions: (sessionIds) => {
    const state = get();
    const known = sessionIds.filter(
      (id) =>
        id in state.byParent ||
        id in state.requested ||
        id in state.runErrors ||
        id in state.askInCard,
    );
    if (known.length === 0) return;
    set((s) => {
      const byParent = { ...s.byParent };
      const requested = { ...s.requested };
      const runErrors = { ...s.runErrors };
      const askInCard = { ...s.askInCard };
      for (const id of known) {
        delete byParent[id];
        delete requested[id];
        delete runErrors[id];
        delete askInCard[id];
      }
      return { byParent, requested, runErrors, askInCard };
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
