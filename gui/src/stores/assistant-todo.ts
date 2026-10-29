import { create } from "zustand";

import {
  addTodoSubitems,
  cancelScheduledTask,
  cancelTodo,
  cancelTodoReminder,
  completeTodo,
  completeTodoSubitem,
  EMPTY_TODO,
  listAssistantTodo,
  listNotedTodos,
  moveTodoSubitem,
  removeTodoSubitem,
  reopenTodo,
  reopenTodoSubitem,
  todoFailureKind,
  updateTodo,
  updateTodoSubitem,
  todoToastTitle,
  withoutDailyReview,
  type AssistantTodo,
  type TodoFailure,
  type TodoItem,
  type TodoSubitem,
  type TodoWordsChange,
} from "@/lib/assistant-todo";
import { copyForLanguage } from "@/lib/i18n";
import { resolveLanguagePreference } from "@/lib/language";
import {
  TODO_SETTLE_MS,
  todoCancelled,
  todoSubitemMove,
  yourTodos,
  type TodoFlip,
} from "@/lib/todo-panel";
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
 * due. The list is kept without the daily review (`withoutDailyReview`,
 * PRD ruling 145), taken out as each read comes in: this is the one
 * copy every reader of the panel's list has — the panel, its lit rows
 * (useTodoPanelFlash), a card's title (`todoListed`) — so none of them
 * meets it.
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
 * - **Change a title or notes** (`editTodo`, main chat ticket 107, PRD
 *   ruling 153 point 4): straight to Core (`update_todo`), no hold, no
 *   confirm, then read again; on its way it is this window's own write
 *   (`editing`, counted: a title and the notes can be on their way
 *   together), so the row does not light. What failed comes back to the
 *   caller, not into `failures`: the panel keeps the words typed in their
 *   box and says why under it.
 *
 * - **The items under a to-do** (main chat ticket 111, PRD ruling 157):
 *   a tick or untick (`toggleSubitem`) is drawn at once and sent at once
 *   — no hold, as an item has no reminder a misclick would cancel; a
 *   second click takes it back the same way — each item's writes one
 *   after another (`subitemTicks` holds the box as it will stand until
 *   the fresh list is in); adding (`addSubitems`) draws the new items at
 *   once (`subitemAdds`) and queues the writes, each to-do's one after
 *   another, so the box clears and takes the next while Core writes; a
 *   refused one leaves the list and its words come back to the box with
 *   the reason (`subitemAddFailures`); changing words (`editSubitem`) goes
 *   straight to Core as a title does, its failure handed back to the box
 *   that keeps the words; both counted by to-do (`subitemWriting`);
 *   deleting (`deleteSubitem`) is a to-do's delete: off the
 *   row at once (`subitemDeleting`), 「已删除「…」 · 撤销」 for five
 *   seconds, its own toast (「已删除 N 项」 for several), then Core; a
 *   send into the main chat commits these too (`flushDeletes`). All of
 *   them are this window's own writes, so the row does not light. A tick
 *   that fails puts the box back and says why under the item
 *   (`subitemFailures`). Since ticket 112 (PRD ruling 158 point 1) a drag
 *   dropped (`moveSubitem`) is drawn at once in its new order
 *   (`subitemOrders`, every item's id as Core will have them) and sent
 *   after the moves before it under the same to-do, one after another;
 *   the last one back reads the list again and lets the order go in the
 *   same set, so nothing blinks and the row does not light. One that
 *   fails puts the items back as Core has them and says why under them
 *   (`subitemMoveFailures`).
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
  /** Title and notes changes on their way to Core, by to-do id: how
   * many (ticket 107). */
  editing: Record<string, number>;
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
  /** Change a to-do's title or notes (ticket 107); resolves once Core
   * has it and the list is read again, with why it failed, or null. */
  editTodo: (
    id: string,
    change: TodoWordsChange,
  ) => Promise<TodoFailure | null>;
  /** Items' ticks on their way (ticket 111), by item id. */
  subitemTicks: Record<string, SubitemTick>;
  /** Why an item's last tick failed, by item id. */
  subitemFailures: Record<string, TodoFailure>;
  /** Items added or changed on their way, by to-do id: how many. */
  subitemWriting: Record<string, number>;
  /** Items deleted on the panel and not yet by Core, by item id. */
  subitemDeleting: Record<string, SubitemDelete>;
  /** The items' undo toast up now, if any. */
  subitemDeleteToastId: string | null;
  /** An item's box was clicked: ticked or unticked at once. */
  toggleSubitem: (todoId: string, item: TodoSubitem) => void;
  /** Items added on the panel and not yet in Core's list, by to-do id,
   * in order: drawn at once, under the ones there. */
  subitemAdds: Record<string, PendingSubitem[]>;
  /** Adds Core refused, by to-do id: their words, to go back into the
   * box, and why. */
  subitemAddFailures: Record<string, SubitemAddFailure>;
  /** Add items under a to-do, in order: drawn at once, written after the
   * adds before them; resolves once Core has them and the list is read
   * again, with why it failed, or null. */
  addSubitems: (
    todoId: string,
    texts: readonly string[],
  ) => Promise<TodoFailure | null>;
  /** The box took a refused add's words back (`nonce`): off the record. */
  takeSubitemAddFailure: (todoId: string, nonce: number) => void;
  /** Items' order on its way (ticket 112), by to-do id: every item's id
   * as Core will have them once the moves sent land, and how many of
   * those moves are still with Core. */
  subitemOrders: Record<string, SubitemOrder>;
  /** Why the last move under a to-do failed, by to-do id. */
  subitemMoveFailures: Record<string, TodoFailure>;
  /** A drag dropped: `itemId` where the row now draws it (`shown`, the
   * ids of the row's items in their new order). Drawn at once, sent
   * after the moves before it; nothing when it is where it was. */
  moveSubitem: (
    todoId: string,
    itemId: string,
    shown: readonly string[],
  ) => void;
  /** Change an item's words; resolves once Core has them and the list is
   * read again, with why it failed, or null. */
  editSubitem: (
    todoId: string,
    itemId: string,
    text: string,
  ) => Promise<TodoFailure | null>;
  /** An item's ×: off the row at once, 撤销 offered. */
  deleteSubitem: (todoId: string, item: TodoSubitem) => void;
  /** 撤销 on the items' toast: every item deletion not yet sent put
   * back. */
  undoSubitemDelete: () => void;
  /** Send every item deletion not yet sent; as `commitDeletes`. */
  commitSubitemDeletes: () => Promise<void>;
}

/** An item added on the panel, on its way to Core (ticket 111). */
export interface PendingSubitem {
  /** This window's own key, never an item id. */
  key: string;
  text: string;
}

/** Adds under a to-do Core refused (ticket 111). */
export interface SubitemAddFailure {
  /** Their words, in order, for the box. */
  texts: string[];
  kind: TodoFailure;
  /** Which refusal: the box takes each once. */
  nonce: number;
}

/** An item's tick on its way (ticket 111): the box as it will stand, and
 * how many of its writes are still with Core. */
export interface SubitemTick {
  todoId: string;
  done: boolean;
  sending: number;
}

/** A to-do's items moved on the panel (ticket 112): their order as Core
 * will have it, and how many moves are still with Core. */
export interface SubitemOrder {
  ids: string[];
  sending: number;
}

/** An item deleted on the panel and not yet by Core (ticket 111). */
export interface SubitemDelete {
  todoId: string;
  order: number;
  committing: boolean;
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
// Items (ticket 111): each one's writes one after another, so a tick and
// the untick after it reach Core in that order; their deletions as the
// to-dos'.
const subitemChains = new Map<string, Promise<void>>();
// Each to-do's adds one after another, so items land in the order typed.
const subitemAddChains = new Map<string, Promise<unknown>>();
// Each to-do's moves one after another (ticket 112): each one's place is
// counted on the order the ones before it leave.
const subitemMoveChains = new Map<string, Promise<void>>();
let subitemAddKeys = 0;
let subitemAddRefusals = 0;
let subitemStaging = 0;
let inflightSubitemDeletes: Promise<void> | null = null;

function deleteItemCopy() {
  return copyForLanguage(
    resolveLanguagePreference(usePrefsStore.getState().languagePreference),
  ).todo.deleteItems;
}

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

/** Read the list (without the daily review) and the noted to-dos,
 * together; null when a later read has already landed or either
 * failed. */
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
    return { todo: withoutDailyReview(todo), noted };
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

  // A write of items on its way (add, words), counted by to-do: none
  // left, the id is off the record — in the same set as the fresh list,
  // so the row never lights for its own change.
  const writeSubitems = async (
    todoId: string,
    write: () => Promise<unknown>,
  ): Promise<TodoFailure | null> => {
    set((s) => ({
      subitemWriting: {
        ...s.subitemWriting,
        [todoId]: (s.subitemWriting[todoId] ?? 0) + 1,
      },
    }));
    const done = (writing: Record<string, number>) => {
      const left = (writing[todoId] ?? 1) - 1;
      return left > 0
        ? { ...writing, [todoId]: left }
        : without(writing, todoId);
    };
    try {
      await write();
    } catch (e) {
      set((s) => ({ subitemWriting: done(s.subitemWriting) }));
      return todoFailureKind(e);
    }
    const lists = await read();
    set((s) => ({
      ...(lists ? { ...lists, loaded: true } : {}),
      subitemWriting: done(s.subitemWriting),
    }));
    return null;
  };

  // Ask Core to delete each of `ids` (items), in order, then read again:
  // as `sendDeletes`, one refused back on its row with its reason.
  const sendSubitemDeletes = async (ids: readonly string[]) => {
    const refused: Record<string, TodoFailure> = {};
    for (const id of ids) {
      try {
        await removeTodoSubitem(id);
      } catch (e) {
        refused[id] = todoFailureKind(e);
      }
    }
    const lists = await read();
    set((s) => {
      const subitemDeleting = { ...s.subitemDeleting };
      for (const id of ids) delete subitemDeleting[id];
      return {
        ...(lists ? { ...lists, loaded: true } : {}),
        subitemDeleting,
        subitemFailures: { ...s.subitemFailures, ...refused },
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
    editing: {},
    subitemTicks: {},
    subitemFailures: {},
    subitemWriting: {},
    subitemAdds: {},
    subitemAddFailures: {},
    subitemDeleting: {},
    subitemDeleteToastId: null,
    subitemOrders: {},
    subitemMoveFailures: {},

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

    // Since ticket 111 the items' deletions too: Galley reads the to-do
    // before it answers, and an item deleted must not be under it.
    flushDeletes: () => {
      const todos =
        Object.keys(get().deleting).length > 0 ? get().commitDeletes() : null;
      const items =
        Object.keys(get().subitemDeleting).length > 0
          ? get().commitSubitemDeletes()
          : null;
      if (todos && items) return Promise.all([todos, items]).then(() => {});
      return todos ?? items;
    },

    editTodo: async (id, change) => {
      set((s) => ({
        editing: { ...s.editing, [id]: (s.editing[id] ?? 0) + 1 },
      }));
      // One fewer on its way; none left, the id is off the record.
      const done = (editing: Record<string, number>) => {
        const left = (editing[id] ?? 1) - 1;
        return left > 0 ? { ...editing, [id]: left } : without(editing, id);
      };
      try {
        await updateTodo(id, change);
      } catch (e) {
        set((s) => ({ editing: done(s.editing) }));
        return todoFailureKind(e);
      }
      // The fresh words and this write off the record in one set: the
      // row never lights for its own change.
      const lists = await read();
      set((s) => ({
        ...(lists ? { ...lists, loaded: true } : {}),
        editing: done(s.editing),
      }));
      return null;
    },

    toggleSubitem: (todoId, item) => {
      const id = item.id;
      if (id in get().subitemDeleting) return;
      const tick = get().subitemTicks[id];
      const done = !(tick ? tick.done : item.done);
      set((s) => ({
        subitemTicks: {
          ...s.subitemTicks,
          [id]: { todoId, done, sending: (tick?.sending ?? 0) + 1 },
        },
        subitemFailures: without(s.subitemFailures, id),
      }));
      const send = async () => {
        let failed: TodoFailure | null = null;
        try {
          await (done ? completeTodoSubitem(id) : reopenTodoSubitem(id));
        } catch (e) {
          failed = todoFailureKind(e);
        }
        const now = get().subitemTicks[id];
        if (now && now.sending > 1) {
          // A later click is on its way: it decides the box.
          set((s) => ({
            subitemTicks: {
              ...s.subitemTicks,
              [id]: { ...now, sending: now.sending - 1 },
            },
          }));
          return;
        }
        // The last one back: the box as Core has it, with the fresh
        // list in the same set; a refusal says why under the item. A
        // click while the list was read is still on its way: it keeps
        // the box.
        const lists = await read();
        set((s) => {
          const current = s.subitemTicks[id];
          const later = current !== undefined && current.sending > 1;
          return {
            ...(lists ? { ...lists, loaded: true } : {}),
            subitemTicks: later
              ? {
                  ...s.subitemTicks,
                  [id]: { ...current, sending: current.sending - 1 },
                }
              : without(s.subitemTicks, id),
            subitemFailures:
              failed && !later
                ? { ...s.subitemFailures, [id]: failed }
                : s.subitemFailures,
          };
        });
      };
      // Idle, it goes now; else after the one before it.
      const before = subitemChains.get(id);
      const run = before ? before.then(send) : send();
      subitemChains.set(id, run);
      void run.finally(() => {
        if (subitemChains.get(id) === run) subitemChains.delete(id);
      });
    },

    addSubitems: (todoId, texts) => {
      const pending = texts.map((text) => ({
        key: `pending_item_${(subitemAddKeys += 1)}`,
        text,
      }));
      const keys = new Set(pending.map((each) => each.key));
      set((s) => ({
        subitemAdds: {
          ...s.subitemAdds,
          [todoId]: [...(s.subitemAdds[todoId] ?? []), ...pending],
        },
        subitemWriting: {
          ...s.subitemWriting,
          [todoId]: (s.subitemWriting[todoId] ?? 0) + 1,
        },
      }));
      // These off the drawn list, and one fewer write on its way.
      const settled = (s: AssistantTodoState) => {
        const left = (s.subitemAdds[todoId] ?? []).filter(
          (each) => !keys.has(each.key),
        );
        const writing = (s.subitemWriting[todoId] ?? 1) - 1;
        return {
          subitemAdds:
            left.length > 0
              ? { ...s.subitemAdds, [todoId]: left }
              : without(s.subitemAdds, todoId),
          subitemWriting:
            writing > 0
              ? { ...s.subitemWriting, [todoId]: writing }
              : without(s.subitemWriting, todoId),
        };
      };
      const send = async (): Promise<TodoFailure | null> => {
        try {
          await addTodoSubitems(todoId, texts);
        } catch (e) {
          const kind = todoFailureKind(e);
          subitemAddRefusals += 1;
          const nonce = subitemAddRefusals;
          set((s) => ({
            ...settled(s),
            subitemAddFailures: {
              ...s.subitemAddFailures,
              [todoId]: {
                texts: [
                  ...(s.subitemAddFailures[todoId]?.texts ?? []),
                  ...texts,
                ],
                kind,
                nonce,
              },
            },
          }));
          return kind;
        }
        // The fresh list and these off the drawn ones in one set: they
        // never blink.
        const lists = await read();
        set((s) => ({
          ...(lists ? { ...lists, loaded: true } : {}),
          ...settled(s),
        }));
        return null;
      };
      const before = subitemAddChains.get(todoId);
      const run = before ? before.then(send) : send();
      subitemAddChains.set(todoId, run);
      void run.finally(() => {
        if (subitemAddChains.get(todoId) === run) {
          subitemAddChains.delete(todoId);
        }
      });
      return run;
    },

    takeSubitemAddFailure: (todoId, nonce) => {
      if (get().subitemAddFailures[todoId]?.nonce !== nonce) return;
      set((s) => ({
        subitemAddFailures: without(s.subitemAddFailures, todoId),
      }));
    },

    editSubitem: (todoId, itemId, text) =>
      writeSubitems(todoId, () => updateTodoSubitem(itemId, text)),

    moveSubitem: (todoId, itemId, shown) => {
      // Every item Core has, in the order it will have them: the one a
      // move on its way leaves, a new one of Galley's after it.
      const core = (
        yourTodos(get().todo).find(
          (item) => item.kind === "todo" && item.id === todoId,
        )?.items ?? []
      ).map((each) => each.id);
      const before = get().subitemOrders[todoId];
      const has = new Set(core);
      const all = before
        ? [
            ...before.ids.filter((id) => has.has(id)),
            ...core.filter((id) => !before.ids.includes(id)),
          ]
        : core;
      const move = todoSubitemMove(all, shown, itemId);
      if (!move) return;
      set((s) => ({
        subitemOrders: {
          ...s.subitemOrders,
          [todoId]: {
            ids: move.order,
            sending: (s.subitemOrders[todoId]?.sending ?? 0) + 1,
          },
        },
        subitemMoveFailures: without(s.subitemMoveFailures, todoId),
      }));
      const send = async () => {
        let failed: TodoFailure | null = null;
        try {
          await moveTodoSubitem(itemId, move.to);
        } catch (e) {
          failed = todoFailureKind(e);
        }
        const now = get().subitemOrders[todoId];
        if (now && now.sending > 1) {
          // A later move is on its way: it reads the list once it lands.
          set((s) => ({
            subitemOrders: {
              ...s.subitemOrders,
              [todoId]: { ...now, sending: now.sending - 1 },
            },
            subitemMoveFailures: failed
              ? { ...s.subitemMoveFailures, [todoId]: failed }
              : s.subitemMoveFailures,
          }));
          return;
        }
        // The last one back: the order as Core has it, with the fresh
        // list in the same set (after a refusal, as it was before the
        // drag); a drag dropped while the list was read keeps its own.
        const lists = await read();
        set((s) => {
          const current = s.subitemOrders[todoId];
          const later = current !== undefined && current.sending > 1;
          return {
            ...(lists ? { ...lists, loaded: true } : {}),
            subitemOrders: later
              ? {
                  ...s.subitemOrders,
                  [todoId]: { ...current, sending: current.sending - 1 },
                }
              : without(s.subitemOrders, todoId),
            subitemMoveFailures: failed
              ? { ...s.subitemMoveFailures, [todoId]: failed }
              : s.subitemMoveFailures,
          };
        });
      };
      const queued = subitemMoveChains.get(todoId);
      const run = queued ? queued.then(send) : send();
      subitemMoveChains.set(todoId, run);
      void run.finally(() => {
        if (subitemMoveChains.get(todoId) === run) {
          subitemMoveChains.delete(todoId);
        }
      });
    },

    deleteSubitem: (todoId, item) => {
      const id = item.id;
      if (get().subitemDeleting[id]) return;
      subitemStaging += 1;
      const subitemDeleting = {
        ...get().subitemDeleting,
        [id]: { todoId, order: subitemStaging, committing: false },
      };
      const waiting = Object.values(subitemDeleting).filter(
        (entry) => !entry.committing,
      ).length;
      const previousToast = get().subitemDeleteToastId;
      const toastId = `todo-item-delete-undo-${subitemStaging}`;
      set((s) => ({
        subitemDeleting,
        subitemDeleteToastId: toastId,
        subitemFailures: without(s.subitemFailures, id),
      }));
      const copy = deleteItemCopy();
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
          context: "delete_todo_item",
          traceback: null,
          autoDismissMs: UNDO_DELETE_MS,
          action: {
            kind: "undo",
            label: copy.undo,
            run: () => get().undoSubitemDelete(),
          },
          onClose: () => {
            if (get().subitemDeleteToastId === toastId) {
              void get().commitSubitemDeletes();
            }
          },
        }),
      );
      if (previousToast) ui.dismissToast(previousToast);
    },

    undoSubitemDelete: () => {
      const { subitemDeleting, subitemDeleteToastId } = get();
      set({
        subitemDeleting: Object.fromEntries(
          Object.entries(subitemDeleting).filter(
            ([, entry]) => entry.committing,
          ),
        ),
        subitemDeleteToastId: null,
      });
      if (subitemDeleteToastId) {
        useUiStore.getState().dismissToast(subitemDeleteToastId);
      }
    },

    commitSubitemDeletes: () => {
      const { subitemDeleting, subitemDeleteToastId } = get();
      const batch = Object.entries(subitemDeleting)
        .filter(([, entry]) => !entry.committing)
        .sort(([, a], [, b]) => a.order - b.order)
        .map(([id]) => id);
      if (subitemDeleteToastId) {
        set({ subitemDeleteToastId: null });
        useUiStore.getState().dismissToast(subitemDeleteToastId);
      }
      if (batch.length === 0) {
        return inflightSubitemDeletes ?? Promise.resolve();
      }
      set((s) => {
        const next = { ...s.subitemDeleting };
        for (const id of batch) next[id] = { ...next[id], committing: true };
        return { subitemDeleting: next };
      });
      const run = (inflightSubitemDeletes ?? Promise.resolve()).then(() =>
        sendSubitemDeletes(batch),
      );
      inflightSubitemDeletes = run;
      void run.finally(() => {
        if (inflightSubitemDeletes === run) inflightSubitemDeletes = null;
      });
      return run;
    },
  };
});
