import { create } from "zustand";

import {
  cancelScheduledTask,
  cancelTodo,
  cancelTodoReminder,
  completeTodo,
  EMPTY_TODO,
  listAssistantTodo,
  listNotedTodos,
  reopenTodo,
  todoFailureKind,
  todoToastTitle,
  type AssistantTodo,
  type TodoFailure,
  type TodoItem,
} from "@/lib/assistant-todo";
import { copyForLanguage } from "@/lib/i18n";
import { resolveLanguagePreference } from "@/lib/language";
import { TODO_SETTLE_MS, todoCancelled, type TodoFlip } from "@/lib/todo-panel";
import { UNDO_DELETE_MS } from "@/stores/message-delete";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

/**
 * The assistant's to-do list on the desktop (main chat ticket 42): one
 * copy of Core's read for the top bar's 「待办」 count (ticket 45) and the
 * panel (beside any conversation, ticket 46), and beside it every to-do
 * noted in the main chat
 * for the cards under its replies (`noted`, ticket 43: a card stays done
 * however long ago, or cancelled), read together so the three always
 * agree. `useAssistantTodoSync` (App, with a main chat) reads them and
 * reads them again on Core's events, at midnight, and when a to-do falls
 * due.
 *
 * The writes the user has here (PRD ruling 91 point 3) go through it
 * too:
 *
 * - **Tick / untick** (`toggle`): the box flips at once and the row
 *   holds its place for `TODO_SETTLE_MS`, struck through (or not); a
 *   second click in that time takes it back and Core never hears of
 *   it. Then Core writes it (`complete_todo` / `reopen_todo`), the list
 *   is read again and the row moves with it in one render. Writing at
 *   the end of the hold rather than at the click keeps a misclick free:
 *   a tick cancels the to-do's reminder and an untick brings none back
 *   (ticket 39). Lives here, not in a component: a tick holds through
 *   the panel closing or the main chat being left. Quitting Galley in
 *   the hold drops it (the safe direction, as an undone delete).
 * - **Cancel a reminder** (`cancelReminder`): straight to Core
 *   (`cancel_todo_reminder`), then read again.
 * - **Cancel one of Galley's own reminders** (`cancelTask`, main chat
 *   ticket 80, ruling 128 point 7): a one-off task under 「Galley 在办」,
 *   straight to Core as a reminder card's 「取消」 goes
 *   (`cancelScheduledTask`), then read again; the row leaves the list,
 *   and the card, on Core's `scheduled-tasks:changed`, says 已取消.
 * - **Delete a to-do of yours** (`deleteTodo`, main chat ticket 88, PRD
 *   ruling 132 point 4), stores/message-delete.ts's way: no confirm, the
 *   row off the panel at once and its card reading 已删除 (`deleting`),
 *   「已删除「…」 · 撤销」 at the foot; only when that toast goes — its
 *   five seconds (`UNDO_DELETE_MS`, paused while the pointer or focus is
 *   on it, ToastHost) run out, or its × — is Core asked (`cancel_todo`).
 *   Several within the five seconds are one toast, 「已删除 N 件待办」,
 *   its time from the latest; 撤销 puts them all back and Core hears
 *   nothing. A send into the main chat commits first and waits
 *   (`flushDeletes`, from `sendThroughCore`): Galley reads its list
 *   before it answers, and what was deleted must not be on it. Quitting
 *   Galley within the five seconds deletes nothing (the safe way round).
 *   Core's answers are read back in the same set that lets them go, so a
 *   deleted row never shows between; one Core refused comes back with
 *   its reason (`failures`). One ticked off meanwhile (Galley's tick, in
 *   the list's 已完成 when the toast goes) is not sent: it stays done.
 *
 * A write that fails puts the row back as it was and leaves a reason by
 * its id (`failures`), cleared by the next try. A to-do's id and a
 * task's never meet (`todo_…`, `sched_…`), so the two cancels share
 * `cancelling` and `failures`.
 */
interface AssistantTodoState {
  todo: AssistantTodo;
  /** Every to-do noted in the main chat, in the order noted: the cards. */
  noted: TodoItem[];
  /** Read once at least: the empty state is not drawn before. */
  loaded: boolean;
  /** Ticks and unticks on their way, by to-do id. */
  flips: Record<string, TodoFlip>;
  /** Why the last write on a to-do failed, by id. */
  failures: Record<string, TodoFailure>;
  /** Reminders being cancelled, by to-do id or, for Galley's own, task
   * id. */
  cancelling: Record<string, true>;
  /** To-dos deleted on the page and not yet by Core, by id (ticket 88):
   * off the panel, their cards reading 已删除. */
  deleting: Record<string, TodoDelete>;
  /** The undo toast up now, if any. */
  deleteToastId: string | null;
  /** Read the list and the noted to-dos from Core. */
  load: () => Promise<void>;
  /** The box was clicked (a cancelled to-do's box does nothing). */
  toggle: (item: TodoItem) => void;
  cancelReminder: (id: string) => void;
  /** Cancel one of Galley's own one-off reminders, by task id. */
  cancelTask: (id: string) => void;
  /** 删除: a to-do off the panel at once, 撤销 offered. */
  deleteTodo: (item: TodoItem) => void;
  /** 撤销: every deletion not yet sent put back; Core hears nothing. */
  undoDelete: () => void;
  /** Send every deletion not yet sent to Core, one by one; resolves once
   * Core has answered for them (and any sent before) and the list is
   * read again. Never rejects: one refused comes back with its reason. */
  commitDeletes: () => Promise<void>;
  /** Before a send into the main chat: commit, and the promise to wait
   * for; null when no deletion is waiting or on its way. */
  flushDeletes: () => Promise<void> | null;
}

/** A to-do deleted on the page and not yet by Core (ticket 88). */
export interface TodoDelete {
  /** Staging order, unique: Core is asked in this order. */
  order: number;
  /** Sent to Core: past undoing, still off the panel until it answers. */
  committing: boolean;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
// Reads can come back out of order (an event's read, the one after a
// write): only the latest issued one that has come back counts.
let issued = 0;
let applied = 0;
// Deletions (ticket 88): the staging count, and the commits on their
// way, one after another, each batch after the one before.
let staging = 0;
let inflightDeletes: Promise<void> | null = null;

function deleteCopy() {
  return copyForLanguage(
    resolveLanguagePreference(usePrefsStore.getState().languagePreference),
  ).todo.deleteTodo;
}

function without<T>(record: Record<string, T>, id: string): Record<string, T> {
  if (!(id in record)) return record;
  const rest = { ...record };
  delete rest[id];
  return rest;
}

/** Read the list and the noted to-dos, together; null when a later
 * read has already landed or either failed. */
async function read(): Promise<{
  todo: AssistantTodo;
  noted: TodoItem[];
} | null> {
  const ticket = ++issued;
  try {
    const [todo, noted] = await Promise.all([
      listAssistantTodo(),
      listNotedTodos(),
    ]);
    if (ticket <= applied) return null;
    applied = ticket;
    return { todo, noted };
  } catch (e) {
    console.warn("[todo] list failed.", e);
    return null;
  }
}

export const useAssistantTodoStore = create<AssistantTodoState>((set, get) => {
  const commit = async (id: string, done: boolean) => {
    timers.delete(id);
    set((s) => ({ flips: { ...s.flips, [id]: { done, phase: "saving" } } }));
    try {
      await (done ? completeTodo(id) : reopenTodo(id));
    } catch (e) {
      set((s) => ({
        flips: without(s.flips, id),
        failures: { ...s.failures, [id]: todoFailureKind(e) },
      }));
      void get().load();
      return;
    }
    // The row moves with the fresh list, not a beat before it.
    const lists = await read();
    set((s) => ({
      ...(lists ? { ...lists, loaded: true } : {}),
      flips: without(s.flips, id),
    }));
  };

  // Straight to Core, no hold, no confirm; read again once it is done.
  const cancel = (id: string, write: (id: string) => Promise<unknown>) => {
    if (get().cancelling[id]) return;
    set((s) => ({
      cancelling: { ...s.cancelling, [id]: true },
      failures: without(s.failures, id),
    }));
    write(id)
      .then(() => get().load())
      .catch((e: unknown) =>
        set((s) => ({
          failures: { ...s.failures, [id]: todoFailureKind(e) },
        })),
      )
      .finally(() => set((s) => ({ cancelling: without(s.cancelling, id) })));
  };

  // Ask Core for each of `ids`, in order, then read again: the fresh
  // list and these off `deleting` in one set, so a deleted row is never
  // drawn between; one refused is back on the panel with its reason.
  // One ticked off while its undo toast ran (Galley's `todo done`, read
  // in on `todos:changed`) is not asked for: a done to-do is never
  // rewritten to 已删除 (PRD ruling 132 point 2), so it drops out of
  // `deleting` with the rest, to 已完成, its card 已完成, and no reason.
  const sendDeletes = async (ids: readonly string[]) => {
    const refused: Record<string, TodoFailure> = {};
    for (const id of ids) {
      if (
        get().todo.done.some((item) => item.kind === "todo" && item.id === id)
      ) {
        continue;
      }
      try {
        await cancelTodo(id);
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
    todo: EMPTY_TODO,
    noted: [],
    loaded: false,
    flips: {},
    failures: {},
    cancelling: {},
    deleting: {},
    deleteToastId: null,

    load: async () => {
      const lists = await read();
      if (lists) set({ ...lists, loaded: true });
    },

    toggle: (item) => {
      if (item.kind !== "todo" || todoCancelled(item)) return;
      const id = item.id;
      const flip = get().flips[id];
      if (flip?.phase === "saving") return;
      if (flip) {
        // A second click in the hold: as if nothing happened.
        clearTimeout(timers.get(id));
        timers.delete(id);
        set((s) => ({ flips: without(s.flips, id) }));
        return;
      }
      const done = item.state !== "done";
      set((s) => ({
        flips: { ...s.flips, [id]: { done, phase: "settling" } },
        failures: without(s.failures, id),
      }));
      timers.set(
        id,
        setTimeout(() => void commit(id, done), TODO_SETTLE_MS),
      );
    },

    cancelReminder: (id) => cancel(id, cancelTodoReminder),

    cancelTask: (id) => cancel(id, cancelScheduledTask),

    deleteTodo: (item) => {
      const id = item.id;
      if (item.kind !== "todo" || todoCancelled(item) || get().deleting[id]) {
        return;
      }
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
      const toastId = `todo-delete-undo-${staging}`;
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
              ? copy.deleted(todoToastTitle(item.text))
              : copy.deletedCount(waiting),
          message: "",
          hint: null,
          retryable: false,
          context: "delete_todo",
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
