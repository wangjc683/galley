import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_TODO,
  type AssistantTodo,
  type TodoItem,
} from "@/lib/assistant-todo";
import { TODO_SETTLE_MS, todoChecked } from "@/lib/todo-panel";
import { getTauriMocks } from "@/test/setup";

import { useAssistantTodoStore } from "./assistant-todo";

/**
 * The to-do list on the desktop (main chat ticket 42): a tick holds its
 * place, a second click in the hold takes it back without Core, Core
 * writes it after the hold and the row moves with the fresh list; a
 * failed write puts it back with a reason; cancelling a reminder goes
 * straight to Core. Not mounted in a component: the panel and the card
 * read the same state, so they agree.
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
    return { id: "todo_1" };
  });
  return invoke;
}

const calls = (invoke: ReturnType<typeof getTauriMocks>["invoke"]) =>
  invoke.mock.calls.map(([command]) => command);

beforeEach(() => {
  vi.useFakeTimers();
  useAssistantTodoStore.setState({
    todo: before,
    loaded: true,
    flips: {},
    failures: {},
    cancelling: {},
  });
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
    expect(calls(invoke)).toEqual(["complete_todo", "list_assistant_todo"]);
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
    expect(calls(invoke)).toEqual(["reopen_todo", "list_assistant_todo"]);
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
        : Promise.resolve(after),
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
    expect(calls(invoke)).toEqual(["complete_todo", "list_assistant_todo"]);
  });

  it("goes back as it was when Core refuses, with the reason", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "complete_todo") {
        throw JSON.stringify({ error: "not_found", message: "gone" });
      }
      return before;
    });
    useAssistantTodoStore.getState().toggle(OPEN);
    await vi.runAllTimersAsync();
    let state = useAssistantTodoStore.getState();
    expect(state.flips).toEqual({});
    expect(todoChecked(OPEN, state.flips.todo_1)).toBe(false);
    expect(state.failures).toEqual({ todo_1: "gone" });
    // The next try clears it.
    invoke.mockImplementation(async () => before);
    useAssistantTodoStore.getState().toggle(OPEN);
    state = useAssistantTodoStore.getState();
    expect(state.failures).toEqual({});
    await vi.runAllTimersAsync();
  });

  it("keeps the latest read when reads come back out of order", async () => {
    const { invoke } = getTauriMocks();
    const resolvers: ((todo: AssistantTodo) => void)[] = [];
    invoke.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve as never)),
    );
    const first = useAssistantTodoStore.getState().load();
    const second = useAssistantTodoStore.getState().load();
    resolvers[1](after);
    await second;
    resolvers[0](before);
    await first;
    expect(useAssistantTodoStore.getState().todo).toEqual(after);
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
    expect(calls(invoke)).toEqual([
      "cancel_todo_reminder",
      "list_assistant_todo",
    ]);
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
