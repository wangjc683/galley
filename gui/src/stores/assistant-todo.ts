import { create } from "zustand";

import {
  cancelTodoReminder,
  completeTodo,
  EMPTY_TODO,
  listAssistantTodo,
  reopenTodo,
  todoFailureKind,
  type AssistantTodo,
  type TodoFailure,
  type TodoItem,
} from "@/lib/assistant-todo";
import { TODO_SETTLE_MS, type TodoFlip } from "@/lib/todo-panel";

/**
 * The assistant's to-do list on the desktop (main chat ticket 42): one
 * copy of Core's read for the sidebar's 「待办 · 今天 N」, the panel
 * beside the main chat and the cards under its replies, so the three
 * always agree. `useAssistantTodoSync` (App, with a main chat) reads it
 * and reads it again on Core's events, at midnight, and when a to-do
 * falls due.
 *
 * The two writes the user has here (PRD ruling 91 point 3) go through
 * it too:
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
 *
 * A write that fails puts the row back as it was and leaves a reason by
 * its id (`failures`), cleared by the next try.
 */
interface AssistantTodoState {
  todo: AssistantTodo;
  /** Read once at least: the empty state is not drawn before. */
  loaded: boolean;
  /** Ticks and unticks on their way, by to-do id. */
  flips: Record<string, TodoFlip>;
  /** Why the last write on a to-do failed, by id. */
  failures: Record<string, TodoFailure>;
  /** Reminders being cancelled, by to-do id. */
  cancelling: Record<string, true>;
  /** Read the list from Core. */
  load: () => Promise<void>;
  /** The box was clicked. */
  toggle: (item: TodoItem) => void;
  cancelReminder: (id: string) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
// Reads can come back out of order (an event's read, the one after a
// write): only the latest issued one that has come back counts.
let issued = 0;
let applied = 0;

function without<T>(record: Record<string, T>, id: string): Record<string, T> {
  if (!(id in record)) return record;
  const rest = { ...record };
  delete rest[id];
  return rest;
}

/** Read the list; null when a later read has already landed or it
 * failed. */
async function read(): Promise<AssistantTodo | null> {
  const ticket = ++issued;
  try {
    const todo = await listAssistantTodo();
    if (ticket <= applied) return null;
    applied = ticket;
    return todo;
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
    const todo = await read();
    set((s) => ({
      ...(todo ? { todo, loaded: true } : {}),
      flips: without(s.flips, id),
    }));
  };

  return {
    todo: EMPTY_TODO,
    loaded: false,
    flips: {},
    failures: {},
    cancelling: {},

    load: async () => {
      const todo = await read();
      if (todo) set({ todo, loaded: true });
    },

    toggle: (item) => {
      if (item.kind !== "todo") return;
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

    cancelReminder: (id) => {
      if (get().cancelling[id]) return;
      set((s) => ({
        cancelling: { ...s.cancelling, [id]: true },
        failures: without(s.failures, id),
      }));
      cancelTodoReminder(id)
        .then(() => get().load())
        .catch((e: unknown) =>
          set((s) => ({
            failures: { ...s.failures, [id]: todoFailureKind(e) },
          })),
        )
        .finally(() => set((s) => ({ cancelling: without(s.cancelling, id) })));
    },
  };
});
