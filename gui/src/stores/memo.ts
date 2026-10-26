import { create } from "zustand";

import { todoFailureKind, type TodoFailure } from "@/lib/assistant-todo";
import { copyForLanguage } from "@/lib/i18n";
import { resolveLanguagePreference } from "@/lib/language";
import {
  deleteMemo,
  listMemoEvents,
  listMemos,
  memoToastText,
  type MemoEventItem,
  type MemoItem,
} from "@/lib/memo";
import { UNDO_DELETE_MS } from "@/stores/message-delete";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

/**
 * The memos on the desktop (main chat ticket 97): one copy of Core's two
 * reads — the memos that hold today, for the to-do panel's 备忘 page, and
 * every write of one in the main chat, for the cards under its replies
 * — read together so the page and the cards agree. `useMemoSync` (App,
 * with a main chat) reads them, and again on `memos:changed` and when
 * the day turns.
 *
 * The user's one write on a memo (PRD ruling 142 point 5) goes through
 * it: **delete**, the to-do's way (stores/assistant-todo.ts, ticket 88):
 * no confirm, the row off the page at once (`deleting`), 「已删除「…」 ·
 * 撤销」 at the foot; only when that toast goes — its five seconds
 * (`UNDO_DELETE_MS`, paused while the pointer or focus is on it,
 * ToastHost) run out, or its × — is Core asked (`delete_memo`). Several
 * within the five seconds are one toast, 「已删除 N 条备忘」, its time from
 * the latest; 撤销 puts them all back and Core hears nothing. A send into
 * the main chat commits first and waits (`flushDeletes`, from
 * `sendThroughCore`): what was deleted must not be there if Galley reads
 * its memos before it answers. Quitting Galley within the five seconds
 * deletes nothing. Core's answers are read back in the same set that
 * lets them go; one Core refused comes back with its reason (`failures`).
 */
interface MemoState {
  /** The memos that hold today, in the order noted. */
  memos: MemoItem[];
  /** Every write of a memo in the main chat, in the order made. */
  events: MemoEventItem[];
  /** Read once at least: the empty state is not drawn before. */
  loaded: boolean;
  /** Memos deleted on the page and not yet by Core, by id. */
  deleting: Record<string, MemoDelete>;
  /** Why the last delete of a memo failed, by id. */
  failures: Record<string, TodoFailure>;
  /** The undo toast up now, if any. */
  deleteToastId: string | null;
  load: () => Promise<void>;
  /** 删除: a memo off the page at once, 撤销 offered. */
  deleteMemo: (memo: MemoItem) => void;
  /** 撤销: every deletion not yet sent put back; Core hears nothing. */
  undoDelete: () => void;
  /** Send every deletion not yet sent to Core, one by one; resolves once
   * Core has answered for them (and any sent before) and the memos are
   * read again. Never rejects: one refused comes back with its reason. */
  commitDeletes: () => Promise<void>;
  /** Before a send into the main chat: commit, and the promise to wait
   * for; null when no deletion is waiting or on its way. */
  flushDeletes: () => Promise<void> | null;
}

/** A memo deleted on the page and not yet by Core. */
export interface MemoDelete {
  /** Staging order, unique: Core is asked in this order. */
  order: number;
  /** Sent to Core: past undoing, still off the page until it answers. */
  committing: boolean;
}

// Reads can come back out of order: only the latest issued one that has
// come back counts.
let issued = 0;
let applied = 0;
let staging = 0;
let inflightDeletes: Promise<void> | null = null;

function deleteCopy() {
  return copyForLanguage(
    resolveLanguagePreference(usePrefsStore.getState().languagePreference),
  ).memo.deleteMemo;
}

function without<T>(record: Record<string, T>, id: string): Record<string, T> {
  if (!(id in record)) return record;
  const rest = { ...record };
  delete rest[id];
  return rest;
}

/** Read the memos and their writes, together; null when a later read has
 * already landed or either failed. */
async function read(): Promise<{
  memos: MemoItem[];
  events: MemoEventItem[];
} | null> {
  const ticket = ++issued;
  try {
    const [memos, events] = await Promise.all([listMemos(), listMemoEvents()]);
    if (ticket <= applied) return null;
    applied = ticket;
    return { memos, events };
  } catch (e) {
    console.warn("[memo] list failed.", e);
    return null;
  }
}

export const useMemoStore = create<MemoState>((set, get) => {
  // Ask Core for each of `ids`, in order, then read again: the fresh
  // memos and these off `deleting` in one set, so a deleted row is never
  // drawn between; one refused is back on the page with its reason.
  const sendDeletes = async (ids: readonly string[]) => {
    const refused: Record<string, TodoFailure> = {};
    for (const id of ids) {
      try {
        await deleteMemo(id);
      } catch (e) {
        refused[id] = todoFailureKind(e);
      }
    }
    const lists = await read();
    set((s) => {
      const deleting = { ...s.deleting };
      for (const id of ids) delete deleting[id];
      return {
        ...(lists ? { ...lists, loaded: true } : {}),
        deleting,
        failures: { ...s.failures, ...refused },
      };
    });
  };

  return {
    memos: [],
    events: [],
    loaded: false,
    deleting: {},
    failures: {},
    deleteToastId: null,

    load: async () => {
      const lists = await read();
      if (lists) set({ ...lists, loaded: true });
    },

    deleteMemo: (memo) => {
      const id = memo.id;
      if (get().deleting[id]) return;
      staging += 1;
      const deleting = {
        ...get().deleting,
        [id]: { order: staging, committing: false },
      };
      const waiting = Object.values(deleting).filter(
        (entry) => !entry.committing,
      ).length;
      const previousToast = get().deleteToastId;
      // A fresh toast each time: its five seconds start over.
      const toastId = `memo-delete-undo-${staging}`;
      set((s) => ({
        deleting,
        deleteToastId: toastId,
        failures: without(s.failures, id),
      }));
      const copy = deleteCopy();
      const ui = useUiStore.getState();
      ui.pushToast(
        makeAppError({
          id: toastId,
          category: "business",
          severity: "info",
          title:
            waiting === 1
              ? copy.deleted(memoToastText(memo.text))
              : copy.deletedCount(waiting),
          message: "",
          hint: null,
          retryable: false,
          context: "delete_memo",
          traceback: null,
          autoDismissMs: UNDO_DELETE_MS,
          action: {
            kind: "undo",
            label: copy.undo,
            run: () => get().undoDelete(),
          },
          // Ran out, or its ×: now Core deletes. Only while it is the
          // toast up — a later deletion replaced it otherwise.
          onClose: () => {
            if (get().deleteToastId === toastId) void get().commitDeletes();
          },
        }),
      );
      if (previousToast) ui.dismissToast(previousToast);
    },

    undoDelete: () => {
      const { deleting, deleteToastId } = get();
      set({
        deleting: Object.fromEntries(
          Object.entries(deleting).filter(([, entry]) => entry.committing),
        ),
        deleteToastId: null,
      });
      if (deleteToastId) useUiStore.getState().dismissToast(deleteToastId);
    },

    commitDeletes: () => {
      const { deleting, deleteToastId } = get();
      const batch = Object.entries(deleting)
        .filter(([, entry]) => !entry.committing)
        .sort(([, a], [, b]) => a.order - b.order)
        .map(([id]) => id);
      if (deleteToastId) {
        set({ deleteToastId: null });
        useUiStore.getState().dismissToast(deleteToastId);
      }
      if (batch.length === 0) return inflightDeletes ?? Promise.resolve();
      set((s) => {
        const next = { ...s.deleting };
        for (const id of batch) next[id] = { ...next[id], committing: true };
        return { deleting: next };
      });
      const run = (inflightDeletes ?? Promise.resolve()).then(() =>
        sendDeletes(batch),
      );
      inflightDeletes = run;
      void run.finally(() => {
        if (inflightDeletes === run) inflightDeletes = null;
      });
      return run;
    },

    flushDeletes: () =>
      Object.keys(get().deleting).length > 0 ? get().commitDeletes() : null,
  };
});
