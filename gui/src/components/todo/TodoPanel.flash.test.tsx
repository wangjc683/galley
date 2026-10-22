// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { TodoCards } from "@/components/conversation/TodoCards";
import {
  EMPTY_TODO,
  type AssistantTodo,
  type TodoItem,
} from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import { LOCATE_FLASH_CLASS } from "@/lib/locate-flash";
import { TODO_SETTLE_MS } from "@/lib/todo-panel";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { useUiStore } from "@/stores/ui";

import { TodoPanel } from "./TodoPanel";

/**
 * Rows lighting up in the panel on screen, through the real stores (main
 * chat ticket 87, PRD ruling 131 points 3–5): what Galley changes in a
 * fresh list, not what this window does; a to-do Galley ticks off held
 * where it stood before 已完成; a card's title opening the panel at its
 * row, 已完成 unfolded for a done one. Which changes light is pinned
 * row by row in lib/todo-panel.test.ts; this is the wiring.
 */

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function todo(id: string, extra: Partial<TodoItem> = {}): TodoItem {
  return {
    kind: "todo",
    id,
    text: id,
    state: "open",
    createdBy: "assistant",
    createdIn: { sessionId: "s-main", turnIndex: 4 },
    ...extra,
  };
}
const A = todo("todo_a");
const B = todo("todo_b");
const C = todo("todo_c");
const list = (yours: TodoItem[], done: TodoItem[] = []): AssistantTodo => ({
  ...EMPTY_TODO,
  yours: { today: [], later: [], anytime: yours },
  done,
});

let root: Root | null = null;
beforeEach(() => {
  useAssistantTodoStore.setState({
    todo: list([A, B, C]),
    noted: [],
    loaded: true,
    flips: {},
    failures: {},
    cancelling: {},
  });
  useUiStore.setState({
    todoPanelOpen: { galley: false, elsewhere: false },
    todoNarrow: false,
    todoGlance: null,
    todoPanelIntroduced: false,
    todoRowRequest: null,
  });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function mount(node: React.ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <CopyProvider language="zh-CN">
        <Tooltip.Provider>{node}</Tooltip.Provider>
      </CopyProvider>,
    );
  });
  return container;
}

const panel = () => (
  <TodoPanel
    mainChatId="s-main"
    spot={{ here: "galley", at: "main:s-main", narrow: false }}
    onOpenSession={() => {}}
    onTalk={() => {}}
    onClose={() => {}}
  />
);

/** A frame for the panel to light what it drew. */
async function frame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

const row = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-todo-row="${id}"]`);
const lit = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-todo-row]"))
    .filter((el) => el.classList.contains(LOCATE_FLASH_CLASS))
    .map((el) => el.dataset.todoRow);
const order = (container: HTMLElement, group: string) =>
  Array.from(
    container.querySelectorAll<HTMLElement>(
      `[data-todo-group="${group}"] [data-todo-row]`,
    ),
  ).map((el) => el.dataset.todoRow);

describe("the panel on screen", () => {
  it("lights nothing it mounts with", async () => {
    const container = mount(panel());
    await frame();
    expect(lit(container)).toEqual([]);
  });

  it("lights what Galley changed in a fresh list", async () => {
    const container = mount(panel());
    const D = todo("todo_d");
    act(() =>
      useAssistantTodoStore.setState({
        todo: list([A, { ...B, notes: "王老师" }, C, D]),
      }),
    );
    await frame();
    expect(lit(container)).toEqual(["todo_b", "todo_d"]);
  });

  it("does not light this window's own write", async () => {
    const container = mount(panel());
    act(() =>
      useAssistantTodoStore.setState({
        todo: list([A, C], [{ ...B, state: "done" }]),
        flips: { todo_b: { done: true, phase: "saving" } },
      }),
    );
    act(() => useAssistantTodoStore.setState({ flips: {} }));
    await frame();
    expect(lit(container)).toEqual([]);
    expect(order(container, "yours")).toEqual(["todo_a", "todo_c"]);
  });

  it("holds a to-do Galley ticked off where it stood, ticked and lit, then 已完成", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const container = mount(panel());
    act(() =>
      useAssistantTodoStore.setState({
        todo: list([A, C], [{ ...B, state: "done", doneBy: "assistant" }]),
      }),
    );
    await frame();
    expect(order(container, "yours")).toEqual(["todo_a", "todo_b", "todo_c"]);
    const held = row(container, "todo_b")!;
    expect(held.querySelector("input")?.checked).toBe(true);
    expect(held.innerHTML).toContain("line-through");
    expect(lit(container)).toEqual(["todo_b"]);
    // Not in 已完成 yet.
    expect(container.querySelector('[data-todo-group="done"]')).toBeNull();
    act(() => vi.advanceTimersByTime(TODO_SETTLE_MS));
    expect(order(container, "yours")).toEqual(["todo_a", "todo_c"]);
    expect(
      container.querySelector('[data-todo-group="done"]')?.textContent,
    ).toContain("1");
  });

  it("does nothing while closed, and makes up for nothing on opening", async () => {
    act(() =>
      useAssistantTodoStore.setState({ todo: list([A, B, C, todo("todo_d")]) }),
    );
    const container = mount(panel());
    await frame();
    expect(lit(container)).toEqual([]);
  });
});

describe("a card's title (ruling 131 point 3)", () => {
  it("is a button while the panel lists its to-do, words when it does not", () => {
    const cancelled = todo("todo_x", { cancelledAt: "2026-10-20T09:00:00Z" });
    const container = mount(<TodoCards items={[A, cancelled]} />);
    const cards = container.querySelectorAll('[data-role="todo-card"]');
    expect(cards[0].querySelector("button")?.textContent).toBe("todo_a");
    expect(cards[1].querySelector("button")).toBeNull();
    expect(cards[1].textContent).toContain("todo_x");
  });

  it("opens the panel at its row, 已完成 unfolded for a done one, and lights it", async () => {
    const done = { ...B, state: "done" as const };
    useAssistantTodoStore.setState({ todo: list([A, C], [done]) });
    const cards = mount(<TodoCards items={[done]} />);
    act(() => cards.querySelector<HTMLButtonElement>("button")!.click());
    expect(useUiStore.getState().todoPanelOpen.galley).toBe(true);
    expect(useUiStore.getState().todoRowRequest?.ids).toEqual(["todo_b"]);
    act(() => root?.unmount());
    // The panel App now shows beside Galley.
    const container = mount(panel());
    expect(order(container, "done")).toEqual(["todo_b"]);
    await frame();
    expect(lit(container)).toEqual(["todo_b"]);
    expect(useUiStore.getState().todoRowRequest).toBeNull();
  });
});
