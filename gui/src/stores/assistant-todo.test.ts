import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_TODO,
  type AssistantTodo,
  type TodoItem,
} from "@/lib/assistant-todo";
import { zhCopy } from "@/i18n/locales/zh";
import {
  TODO_SETTLE_MS,
  todoChecked,
  todoWithoutDeleting,
} from "@/lib/todo-panel";
import { UNDO_DELETE_MS } from "@/stores/message-delete";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";

import { useAssistantTodoStore } from "./assistant-todo";

/**
 * The to-do list on the desktop (main chat ticket 42): a tick holds its
 * place, a second click in the hold takes it back without Core, Core
 * writes it after the hold and the row moves with the fresh list; a
 * failed write puts it back with a reason; cancelling a reminder, a
 * to-do's or Galley's own (ticket 80), goes straight to Core. Not
 * mounted in a component: the panel and the card
 * read the same state, so they agree. Every read takes the list and the
 * to-dos noted in the main chat together (ticket 43: the cards).
 */

const OPEN: TodoItem = {
  kind: "todo",
  id: "todo_1",
  text: "交季度报告",
  state: "open",
  createdBy: "assistant",
};
const DONE: TodoItem = { ...OPEN, state: "done", at: "2026-10-16T07:00:00Z" };

const before: AssistantTodo = {
  ...EMPTY_TODO,
  yours: { today: [OPEN], later: [], anytime: [] },
  todayCount: 1,
};
const after: AssistantTodo = { ...EMPTY_TODO, done: [DONE] };

function answer(lists: AssistantTodo[]) {
  const { invoke } = getTauriMocks();
  invoke.mockImplementation(async (command) => {
    if (command === "list_assistant_todo") return lists.shift() ?? after;
    if (command === "list_noted_todos") return [];
    return { id: "todo_1" };
  });
  return invoke;
}

/** A read: the list, then the noted to-dos, asked for together. */
const READ = ["list_assistant_todo", "list_noted_todos"];

const calls = (invoke: ReturnType<typeof getTauriMocks>["invoke"]) =>
  invoke.mock.calls.map(([command]) => command);

beforeEach(() => {
  vi.useFakeTimers();
  useAssistantTodoStore.setState({
    todo: before,
    noted: [],
    loaded: true,
    flips: {},
    failures: {},
    cancelling: {},
    deleting: {},
    deleteToastId: null,
    editing: {},
  });
  useUiStore.setState({ toasts: [] });
  usePrefsStore.setState({ languagePreference: "zh-CN" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a tick", () => {
  it("checks at once, holds its place, then Core writes it and the row moves", async () => {
    const invoke = answer([after]);
    useAssistantTodoStore.getState().toggle(OPEN);
    let state = useAssistantTodoStore.getState();
    expect(todoChecked(OPEN, state.flips.todo_1)).toBe(true);
    expect(state.flips.todo_1.phase).toBe("settling");
    // Still where it was, in 今天.
    expect(state.todo.yours.today).toEqual([OPEN]);
    await vi.advanceTimersByTimeAsync(TODO_SETTLE_MS - 1);
    expect(calls(invoke)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(invoke).toHaveBeenCalledWith("complete_todo", { id: "todo_1" });
    await vi.runAllTimersAsync();
    state = useAssistantTodoStore.getState();
    expect(calls(invoke)).toEqual(["complete_todo", ...READ]);
    // In one step: the fresh list and the flip gone.
    expect(state.flips).toEqual({});
    expect(state.todo.done).toEqual([DONE]);
    expect(state.todo.yours.today).toEqual([]);
  });

  it("is taken back by a second click in the hold, Core never told", async () => {
    const invoke = answer([]);
    const store = useAssistantTodoStore.getState();
    store.toggle(OPEN);
    await vi.advanceTimersByTimeAsync(TODO_SETTLE_MS / 2);
    useAssistantTodoStore.getState().toggle(OPEN);
    expect(useAssistantTodoStore.getState().flips).toEqual({});
    await vi.runAllTimersAsync();
    expect(calls(invoke)).toEqual([]);
  });

  it("unticks a done one the same way (reopen_todo)", async () => {
    useAssistantTodoStore.setState({ todo: after });
    const invoke = answer([before]);
    useAssistantTodoStore.getState().toggle(DONE);
    expect(
      todoChecked(DONE, useAssistantTodoStore.getState().flips.todo_1),
    ).toBe(false);
    await vi.runAllTimersAsync();
    expect(calls(invoke)).toEqual(["reopen_todo", ...READ]);
    expect(useAssistantTodoStore.getState().todo.yours.today).toEqual([OPEN]);
  });

  it("ignores clicks while Core writes it", async () => {
    let release!: () => void;
    const { invoke } = getTauriMocks();
    invoke.mockImplementation((command) =>
      command === "complete_todo"
        ? new Promise((resolve) => {
            release = () => resolve({ id: "todo_1" });
          })
        : Promise.resolve(command === "list_noted_todos" ? [] : after),
    );
    useAssistantTodoStore.getState().toggle(OPEN);
    await vi.advanceTimersByTimeAsync(TODO_SETTLE_MS);
    expect(useAssistantTodoStore.getState().flips.todo_1.phase).toBe("saving");
    useAssistantTodoStore.getState().toggle(OPEN);
    expect(useAssistantTodoStore.getState().flips.todo_1).toEqual({
      done: true,
      phase: "saving",
    });
    release();
    await vi.runAllTimersAsync();
    expect(calls(invoke)).toEqual(["complete_todo", ...READ]);
  });

  it("goes back as it was when Core refuses, with the reason", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "complete_todo") {
        throw JSON.stringify({ error: "not_found", message: "gone" });
      }
      return command === "list_noted_todos" ? [] : before;
    });
    useAssistantTodoStore.getState().toggle(OPEN);
    await vi.runAllTimersAsync();
    let state = useAssistantTodoStore.getState();
    expect(state.flips).toEqual({});
    expect(todoChecked(OPEN, state.flips.todo_1)).toBe(false);
    expect(state.failures).toEqual({ todo_1: "gone" });
    // The next try clears it.
    invoke.mockImplementation(async (command) =>
      command === "list_noted_todos" ? [] : before,
    );
    useAssistantTodoStore.getState().toggle(OPEN);
    state = useAssistantTodoStore.getState();
    expect(state.failures).toEqual({});
    await vi.runAllTimersAsync();
  });

  it("keeps the latest read when reads come back out of order", async () => {
    const { invoke } = getTauriMocks();
    const resolvers: Record<string, ((value: unknown) => void)[]> = {};
    invoke.mockImplementation(
      (command) =>
        new Promise((resolve) => (resolvers[command] ??= []).push(resolve)),
    );
    const first = useAssistantTodoStore.getState().load();
    const second = useAssistantTodoStore.getState().load();
    resolvers.list_assistant_todo[1](after);
    resolvers.list_noted_todos[1]([DONE]);
    await second;
    resolvers.list_assistant_todo[0](before);
    resolvers.list_noted_todos[0]([OPEN]);
    await first;
    expect(useAssistantTodoStore.getState().todo).toEqual(after);
    expect(useAssistantTodoStore.getState().noted).toEqual([DONE]);
  });
});

// PRD ruling 145: the one place the daily review leaves the panel's
// list, so every reader of the store's copy goes without it.
describe("the daily review", () => {
  const ROUTINE: TodoItem = {
    kind: "task",
    id: "sched_daily",
    text: "早报",
    state: "scheduled",
    createdBy: "assistant",
    target: "assistant",
    repeat: { kind: "daily" },
    timeOfDay: "08:00",
    at: "2026-10-17T00:00:00Z",
  };
  const REVIEW: TodoItem = {
    ...ROUTINE,
    id: "sched_review",
    text: "Daily review: read wake.md and go over what is in hand.",
    createdBy: "agent",
    agent: "galley-review",
    timeOfDay: "09:00",
    at: "2026-10-17T01:00:00Z",
  };

  it("is left out of the list as each read comes in; the rest as Core gave it", async () => {
    const core: AssistantTodo = {
      ...before,
      routine: [ROUTINE, REVIEW],
    };
    answer([core]);
    await useAssistantTodoStore.getState().load();
    const { todo } = useAssistantTodoStore.getState();
    expect(todo.routine).toEqual([ROUTINE]);
    expect(todo.yours).toEqual(core.yours);
    expect(todo.todayCount).toBe(1);
    // Alone, running or paused: nothing is left in 例行.
    answer([
      {
        ...EMPTY_TODO,
        routine: [{ ...REVIEW, state: "paused", at: undefined }],
      },
    ]);
    await useAssistantTodoStore.getState().load();
    expect(useAssistantTodoStore.getState().todo).toEqual(EMPTY_TODO);
  });

  it("is left out of the read a write ends with too", async () => {
    answer([{ ...EMPTY_TODO, done: [DONE], routine: [REVIEW] }]);
    useAssistantTodoStore.getState().toggle(OPEN);
    await vi.runAllTimersAsync();
    const { todo } = useAssistantTodoStore.getState();
    expect(todo.routine).toEqual([]);
    expect(todo.done).toEqual([DONE]);
  });
});

describe("the to-dos noted in the main chat (ticket 43)", () => {
  const LONG_DONE: TodoItem = {
    ...DONE,
    id: "todo_old",
    at: "2026-09-16T07:00:00Z",
  };
  const CANCELLED: TodoItem = {
    ...OPEN,
    id: "todo_gone",
    cancelledAt: "2026-10-15T07:00:00Z",
  };

  it("are read with the list, and kept as they come", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) =>
      command === "list_noted_todos" ? [OPEN, LONG_DONE, CANCELLED] : before,
    );
    useAssistantTodoStore.setState({ loaded: false });
    await useAssistantTodoStore.getState().load();
    expect(calls(invoke)).toEqual(READ);
    const state = useAssistantTodoStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.todo).toEqual(before);
    expect(state.noted).toEqual([OPEN, LONG_DONE, CANCELLED]);
  });

  it("are not taken alone: a failed half leaves both as they were", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "list_noted_todos") throw new Error("boom");
      return after;
    });
    useAssistantTodoStore.setState({ noted: [OPEN] });
    await useAssistantTodoStore.getState().load();
    const state = useAssistantTodoStore.getState();
    expect(state.todo).toEqual(before);
    expect(state.noted).toEqual([OPEN]);
  });

  it("untick a done one from a card, however long ago, and move with the fresh read", async () => {
    useAssistantTodoStore.setState({ noted: [LONG_DONE] });
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "list_noted_todos")
        return [{ ...LONG_DONE, state: "open", at: undefined }];
      if (command === "list_assistant_todo") return before;
      return { id: "todo_old" };
    });
    useAssistantTodoStore.getState().toggle(LONG_DONE);
    await vi.runAllTimersAsync();
    expect(calls(invoke)).toEqual(["reopen_todo", ...READ]);
    expect(invoke).toHaveBeenCalledWith("reopen_todo", { id: "todo_old" });
    expect(useAssistantTodoStore.getState().noted[0].state).toBe("open");
  });

  it("leave a cancelled one's box alone: no hold, no write", async () => {
    const invoke = answer([]);
    useAssistantTodoStore.getState().toggle(CANCELLED);
    expect(useAssistantTodoStore.getState().flips).toEqual({});
    await vi.runAllTimersAsync();
    expect(calls(invoke)).toEqual([]);
  });
});

// Main chat ticket 107 (PRD ruling 153 point 4): a title or notes
// changed in place in the panel.
describe("changing a title or notes", () => {
  it("goes straight to Core with only what changed, reads again, and is this window's own on its way", async () => {
    const renamed: AssistantTodo = {
      ...before,
      yours: {
        today: [{ ...OPEN, text: "交季度报告初稿" }],
        later: [],
        anytime: [],
      },
    };
    const invoke = answer([renamed]);
    const saved = useAssistantTodoStore
      .getState()
      .editTodo("todo_1", { title: "交季度报告初稿" });
    expect(useAssistantTodoStore.getState().editing).toEqual({ todo_1: 1 });
    await expect(saved).resolves.toBeNull();
    expect(calls(invoke)).toEqual(["update_todo", ...READ]);
    expect(invoke).toHaveBeenCalledWith("update_todo", {
      id: "todo_1",
      title: "交季度报告初稿",
    });
    // The fresh words and the record gone, together.
    expect(useAssistantTodoStore.getState().todo).toEqual(renamed);
    expect(useAssistantTodoStore.getState().editing).toEqual({});
  });

  it("counts two on their way: the record goes with the last", async () => {
    let finish: (() => void)[] = [];
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "update_todo") {
        await new Promise<void>((resolve) => finish.push(resolve));
        return { id: "todo_1" };
      }
      if (command === "list_assistant_todo") return before;
      return [];
    });
    const { editTodo } = useAssistantTodoStore.getState();
    const title = editTodo("todo_1", { title: "交初稿" });
    const notes = editTodo("todo_1", { notes: "带 U 盘" });
    expect(useAssistantTodoStore.getState().editing).toEqual({ todo_1: 2 });
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    finish[0]();
    await title;
    expect(useAssistantTodoStore.getState().editing).toEqual({ todo_1: 1 });
    finish[1]();
    await notes;
    expect(useAssistantTodoStore.getState().editing).toEqual({});
    finish = [];
  });

  it("gives back why it failed, not into `failures`, the list as it was", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockRejectedValue(
      JSON.stringify({ error: "not_found", message: "gone" }),
    );
    await expect(
      useAssistantTodoStore.getState().editTodo("todo_1", { notes: "" }),
    ).resolves.toBe("gone");
    expect(calls(invoke)).toEqual(["update_todo"]);
    expect(useAssistantTodoStore.getState().failures).toEqual({});
    expect(useAssistantTodoStore.getState().editing).toEqual({});
    expect(useAssistantTodoStore.getState().todo).toBe(before);
  });
});

describe("cancelling a reminder", () => {
  it("goes straight to Core and reads again", async () => {
    const invoke = answer([before]);
    useAssistantTodoStore.getState().cancelReminder("todo_1");
    expect(useAssistantTodoStore.getState().cancelling).toEqual({
      todo_1: true,
    });
    await vi.runAllTimersAsync();
    expect(calls(invoke)).toEqual(["cancel_todo_reminder", ...READ]);
    expect(invoke).toHaveBeenCalledWith("cancel_todo_reminder", {
      id: "todo_1",
    });
    expect(useAssistantTodoStore.getState().cancelling).toEqual({});
  });

  it("says why it failed", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockRejectedValue(new Error("boom"));
    useAssistantTodoStore.getState().cancelReminder("todo_1");
    await vi.runAllTimersAsync();
    expect(useAssistantTodoStore.getState().failures).toEqual({
      todo_1: "failed",
    });
    expect(useAssistantTodoStore.getState().cancelling).toEqual({});
  });
});

describe("cancelling one of Galley's own reminders (ticket 80)", () => {
  const OWN: TodoItem = {
    kind: "task",
    id: "sched_water",
    text: "提醒喝水",
    state: "scheduled",
    createdBy: "assistant",
    target: "assistant",
    repeat: { kind: "once" },
    at: "2026-10-23T07:00:00Z",
  };
  const listed: AssistantTodo = { ...EMPTY_TODO, assistant: [OWN] };

  it("goes straight to Core as the reminder card's 取消 does, from the desktop, and reads again: the row leaves", async () => {
    useAssistantTodoStore.setState({ todo: listed });
    const invoke = answer([EMPTY_TODO]);
    useAssistantTodoStore.getState().cancelTask("sched_water");
    expect(useAssistantTodoStore.getState().cancelling).toEqual({
      sched_water: true,
    });
    await vi.runAllTimersAsync();
    expect(calls(invoke)).toEqual(["delete_scheduled_task", ...READ]);
    // The desktop's origin: Core stores `cancelled_via = 'gui'`.
    expect(invoke).toHaveBeenCalledWith("delete_scheduled_task", {
      id: "sched_water",
      origin: { via: "gui" },
    });
    const state = useAssistantTodoStore.getState();
    expect(state.cancelling).toEqual({});
    expect(state.todo.assistant).toEqual([]);
  });

  it("takes one click at a time", async () => {
    const invoke = answer([EMPTY_TODO]);
    useAssistantTodoStore.getState().cancelTask("sched_water");
    useAssistantTodoStore.getState().cancelTask("sched_water");
    await vi.runAllTimersAsync();
    expect(calls(invoke)).toEqual(["delete_scheduled_task", ...READ]);
  });

  it("says why it failed, and the next try clears it", async () => {
    useAssistantTodoStore.setState({ todo: listed });
    const { invoke } = getTauriMocks();
    invoke.mockRejectedValue(
      JSON.stringify({ error: "not_found", message: "gone" }),
    );
    useAssistantTodoStore.getState().cancelTask("sched_water");
    await vi.runAllTimersAsync();
    let state = useAssistantTodoStore.getState();
    expect(state.failures).toEqual({ sched_water: "gone" });
    expect(state.cancelling).toEqual({});
    expect(state.todo).toEqual(listed);
    answer([EMPTY_TODO]);
    useAssistantTodoStore.getState().cancelTask("sched_water");
    state = useAssistantTodoStore.getState();
    expect(state.failures).toEqual({});
    await vi.runAllTimersAsync();
  });
});

/**
 * Deleting a to-do of yours from the panel (main chat ticket 88, PRD
 * ruling 132 point 4), stores/message-delete.ts's way: off the panel at
 * once, Core asked only when the undo toast goes, several in a row one
 * toast, 撤销 Core never hears of, a send into the main chat committing
 * first, a refusal back on the panel with its reason.
 */
describe("deleting a to-do", () => {
  const words = zhCopy.todo.deleteTodo;
  const SOIL: TodoItem = { ...OPEN, id: "todo_2", text: "买营养土" };
  const both: AssistantTodo = {
    ...EMPTY_TODO,
    yours: { today: [OPEN], later: [], anytime: [SOIL] },
    todayCount: 1,
  };
  const gone: AssistantTodo = { ...EMPTY_TODO };

  const todos = () => useAssistantTodoStore.getState();
  const toasts = () => useUiStore.getState().toasts;
  const deletes = (invoke: ReturnType<typeof getTauriMocks>["invoke"]) =>
    invoke.mock.calls
      .filter(([command]) => command === "cancel_todo")
      .map(([, args]) => args);
  /** What the panel draws now. */
  const drawn = () =>
    [
      ...todoWithoutDeleting(todos().todo, todos().deleting).yours.today,
      ...todoWithoutDeleting(todos().todo, todos().deleting).yours.anytime,
    ].map((item) => item.id);

  /** The undo toast runs out (ToastHost: its `onClose`, then away). */
  function runOut(): void {
    const toast = toasts()[0];
    toast.onClose?.();
    useUiStore.getState().dismissToast(toast.id);
  }

  beforeEach(() => {
    useAssistantTodoStore.setState({ todo: both });
  });

  it("takes the row off at once and offers 撤销 for five seconds; Core hears nothing yet", async () => {
    const invoke = answer([]);
    useAssistantTodoStore.setState({ failures: { todo_1: "failed" } });
    todos().deleteTodo(OPEN);

    expect(todos().deleting).toEqual({
      todo_1: { order: expect.any(Number), committing: false },
    });
    expect(drawn()).toEqual(["todo_2"]);
    // A reason left by an earlier try goes.
    expect(todos().failures).toEqual({});
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toMatchObject({
      severity: "info",
      title: words.deleted("交季度报告"),
      autoDismissMs: UNDO_DELETE_MS,
      action: { kind: "undo", label: words.undo },
    });
    // The list itself is Core's until Core has deleted it.
    expect(todos().todo).toBe(both);
    await vi.advanceTimersByTimeAsync(UNDO_DELETE_MS * 2);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("quotes a long title cut short", () => {
    answer([]);
    const long = {
      ...OPEN,
      text: "把这个季度所有门店的销售数据整理成一份报告发给区域经理",
    };
    todos().deleteTodo(long);
    expect(toasts()[0].title).toBe(
      words.deleted("把这个季度所有门店的销售数据整理成一份报告发给区…"),
    );
  });

  it("撤销 puts it back and Core never hears of it", async () => {
    const invoke = answer([]);
    todos().deleteTodo(OPEN);
    const toast = toasts()[0];
    if (toast.action?.kind === "undo") toast.action.run();

    expect(todos().deleting).toEqual({});
    expect(drawn()).toEqual(["todo_1", "todo_2"]);
    expect(toasts()).toEqual([]);
    // A late close of that toast deletes nothing.
    toast.onClose?.();
    await vi.runAllTimersAsync();
    expect(invoke).not.toHaveBeenCalled();
    expect(todos().flushDeletes()).toBeNull();
  });

  it("asks Core once the toast goes, and lets it go with the fresh list in one set", async () => {
    const invoke = answer([{ ...both, yours: { ...both.yours, today: [] } }]);
    todos().deleteTodo(OPEN);
    // Never drawn between: no state lists it with nothing holding it off.
    const states: ReturnType<typeof useAssistantTodoStore.getState>[] = [];
    const unsubscribe = useAssistantTodoStore.subscribe((state) =>
      states.push(state),
    );
    runOut();
    await todos().commitDeletes();
    unsubscribe();

    expect(deletes(invoke)).toEqual([{ id: "todo_1" }]);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "cancel_todo",
      ...READ,
    ]);
    for (const state of states) {
      const shown = todoWithoutDeleting(state.todo, state.deleting);
      expect(shown.yours.today.map((item) => item.id)).not.toContain("todo_1");
    }
    expect(todos().deleting).toEqual({});
    expect(todos().todo.yours.today).toEqual([]);
    expect(drawn()).toEqual(["todo_2"]);
    expect(toasts()).toEqual([]);
  });

  it("several in a row are one toast, its time from the latest, 撤销 taking them all back", async () => {
    const invoke = answer([]);
    todos().deleteTodo(OPEN);
    const first = toasts()[0];
    todos().deleteTodo(SOIL);

    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].id).not.toBe(first.id);
    expect(toasts()[0].title).toBe(words.deletedCount(2));
    expect(drawn()).toEqual([]);
    // The replaced toast's close deletes nothing.
    first.onClose?.();
    await vi.runAllTimersAsync();
    expect(invoke).not.toHaveBeenCalled();

    const latest = toasts()[0];
    if (latest.action?.kind === "undo") latest.action.run();
    expect(todos().deleting).toEqual({});
    expect(drawn()).toEqual(["todo_1", "todo_2"]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("go to Core one by one, in the order deleted, when the toast goes", async () => {
    const invoke = answer([gone]);
    todos().deleteTodo(SOIL);
    todos().deleteTodo(OPEN);
    runOut();
    await todos().commitDeletes();

    expect(deletes(invoke)).toEqual([{ id: "todo_2" }, { id: "todo_1" }]);
    expect(todos().deleting).toEqual({});
    expect(todos().todo).toEqual(gone);
  });

  it("a send into the main chat commits first: the promise to wait for, the toast gone with it", async () => {
    const invoke = answer([gone]);
    expect(todos().flushDeletes()).toBeNull();
    todos().deleteTodo(OPEN);
    const flushing = todos().flushDeletes();
    expect(flushing).not.toBeNull();
    expect(toasts()).toEqual([]);
    // Past undoing, still off the panel while Core answers.
    expect(todos().deleting.todo_1.committing).toBe(true);
    expect(drawn()).toEqual(["todo_2"]);
    await flushing;
    expect(deletes(invoke)).toEqual([{ id: "todo_1" }]);
    expect(todos().deleting).toEqual({});
  });

  it("comes back with the reason when Core refuses", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command, args) => {
      if (command === "cancel_todo") {
        throw (args as { id: string }).id === "todo_1"
          ? JSON.stringify({ error: "not_found", message: "gone" })
          : JSON.stringify({ error: "invalid_args", message: "no assistant" });
      }
      return command === "list_noted_todos" ? [] : both;
    });
    todos().deleteTodo(OPEN);
    todos().deleteTodo(SOIL);
    runOut();
    await todos().commitDeletes();

    expect(todos().deleting).toEqual({});
    expect(todos().failures).toEqual({ todo_1: "gone", todo_2: "failed" });
    expect(drawn()).toEqual(["todo_1", "todo_2"]);
    // No toast: the reason is under the row.
    expect(toasts()).toEqual([]);
  });

  // Ruling 132 point 2: a done to-do is never rewritten to 已删除.
  it("leaves one Galley ticked off within the five seconds done: Core is not asked, the row ends in 已完成", async () => {
    const ticked: TodoItem = {
      ...OPEN,
      state: "done",
      at: "2026-10-22T08:00:00Z",
    };
    const afterTick: AssistantTodo = {
      ...EMPTY_TODO,
      yours: { today: [], later: [], anytime: [SOIL] },
      done: [ticked],
    };
    const invoke = answer([afterTick, afterTick]);
    todos().deleteTodo(OPEN);
    // Galley's `todo done`, read in on `todos:changed` under the toast.
    await todos().load();
    expect(todos().todo.done).toEqual([ticked]);
    runOut();
    await todos().commitDeletes();

    expect(deletes(invoke)).toEqual([]);
    expect(todos().deleting).toEqual({});
    expect(todos().failures).toEqual({});
    const shown = todoWithoutDeleting(todos().todo, todos().deleting);
    expect(shown.done.map((item) => item.id)).toEqual(["todo_1"]);
    expect(drawn()).toEqual(["todo_2"]);
  });

  it("asks Core for the rest of a batch past one ticked off meanwhile", async () => {
    const ticked: TodoItem = {
      ...OPEN,
      state: "done",
      at: "2026-10-22T08:00:00Z",
    };
    const afterTick: AssistantTodo = {
      ...EMPTY_TODO,
      yours: { today: [], later: [], anytime: [SOIL] },
      done: [ticked],
    };
    const invoke = answer([
      afterTick,
      { ...afterTick, yours: EMPTY_TODO.yours },
    ]);
    todos().deleteTodo(OPEN);
    todos().deleteTodo(SOIL);
    await todos().load();
    runOut();
    await todos().commitDeletes();

    expect(deletes(invoke)).toEqual([{ id: "todo_2" }]);
    expect(todos().deleting).toEqual({});
    expect(todos().todo.done).toEqual([ticked]);
  });

  it("takes only a to-do, once", async () => {
    const invoke = answer([]);
    const task: TodoItem = {
      kind: "task",
      id: "sched_water",
      text: "提醒喝水",
      state: "scheduled",
      createdBy: "assistant",
    };
    todos().deleteTodo(task);
    todos().deleteTodo({ ...OPEN, cancelledAt: "2026-10-15T07:00:00Z" });
    expect(todos().deleting).toEqual({});
    expect(toasts()).toEqual([]);
    todos().deleteTodo(OPEN);
    todos().deleteTodo(OPEN);
    expect(Object.keys(todos().deleting)).toEqual(["todo_1"]);
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].title).toBe(words.deleted("交季度报告"));
    await vi.runAllTimersAsync();
    expect(invoke).not.toHaveBeenCalled();
  });
});
