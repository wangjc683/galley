// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  EMPTY_TODO,
  type AssistantTodo,
  type TodoItem,
  type TodoSubitem,
} from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import { LOCATE_FLASH_CLASS } from "@/lib/locate-flash";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";

import { TodoPanel } from "./TodoPanel";

/**
 * The items under an open to-do dragged into order (main chat ticket
 * 112, PRD ruling 158 point 1), through the real stores to Core's
 * `move_todo_subitem`: the handle and when it is there, the keyboard's
 * Space and arrows, Esc giving up, the order drawn at once and sent, a
 * refusal put back with its reason, the row lit when Galley moves them
 * and not for the window's own move. The pure parts are in
 * lib/todo-panel.test.ts, the store's queue in
 * stores/assistant-todo.test.ts; the open row's layout and notes in
 * TodoPanel.notes.test.tsx.
 */

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
}));

const hadResizeObserver = "ResizeObserver" in globalThis;
const hadScrollIntoView = "scrollIntoView" in Element.prototype;
const realRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  if (!hadResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!hadScrollIntoView) Element.prototype.scrollIntoView = () => {};
  // jsdom lays nothing out: an item is 24px tall, one under another, so
  // the keyboard's arrows have somewhere to go.
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const box = (top: number, height: number) =>
      ({
        x: 40,
        y: top,
        top,
        left: 40,
        right: 280,
        bottom: top + height,
        width: 240,
        height,
        toJSON() {},
      }) as DOMRect;
    if (this.matches("[data-todo-subitem]") && this.parentElement) {
      const at = Array.from(this.parentElement.children).indexOf(this);
      return box(100 + at * 24, 24);
    }
    if (this.matches('[data-role="todo-items"] ul')) {
      return box(100, this.children.length * 24);
    }
    return realRect.call(this);
  };
});
afterAll(() => {
  if (!hadResizeObserver) {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  }
  if (!hadScrollIntoView) {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
  Element.prototype.getBoundingClientRect = realRect;
});

const NOW = new Date().toISOString();
const items = (...words: [string, boolean][]): TodoSubitem[] =>
  words.map(([text, done], at) => ({ id: `item_${at}`, text, done }));
const HILTON: TodoItem = {
  kind: "todo",
  id: "todo_hilton",
  text: "希尔顿酒店项目上下文资料收集",
  state: "open",
  createdBy: "assistant",
  createdIn: { sessionId: "s-main", turnIndex: 4 },
  createdAt: NOW,
  notes: "10月29日：业主说筹开预算下周给",
  items: items(
    ["具体品牌与管理模式", false],
    ["项目位置", true],
    ["筹开预算", false],
  ),
};
const SOIL: TodoItem = {
  kind: "todo",
  id: "todo_soil",
  text: "买营养土",
  state: "open",
  createdBy: "assistant",
  createdAt: NOW,
  items: items(["阳台用的", false]),
};
const list = (yours: TodoItem[]): AssistantTodo => ({
  ...EMPTY_TODO,
  yours: { today: [], later: [], anytime: yours },
});

/** What Core holds, as the moves change it and the reads return. */
let core: AssistantTodo = list([HILTON, SOIL]);
let refuse: string | null = null;

let root: Root | null = null;
beforeEach(() => {
  core = list([HILTON, SOIL]);
  refuse = null;
  useAssistantTodoStore.setState({
    todo: core,
    noted: [],
    loaded: true,
    flips: {},
    failures: {},
    cancelling: {},
    deleting: {},
    deleteToastId: null,
    editing: {},
    subitemTicks: {},
    subitemFailures: {},
    subitemWriting: {},
    subitemDeleting: {},
    subitemDeleteToastId: null,
    subitemAdds: {},
    subitemAddFailures: {},
    subitemOrders: {},
    subitemMoveFailures: {},
  });
  useUiStore.setState({
    toasts: [],
    todoRowRequest: null,
    todoPageRequest: null,
    quoteRequest: null,
    locateRequest: null,
    todoPanelOpen: { galley: true, elsewhere: false },
    todoNarrow: false,
    todoGlance: null,
  });
  usePrefsStore.setState({ languagePreference: "zh-CN" });
  getTauriMocks().invoke.mockImplementation(async (command, args) => {
    if (command === "list_assistant_todo") return core;
    if (command === "list_noted_todos") return [];
    if (command === "move_todo_subitem") {
      if (refuse) throw refuse;
      const { id, to } = args as { id: string; to: number };
      core = list(
        core.yours.anytime.map((todo) => {
          const all = todo.items ?? [];
          const moved = all.find((each) => each.id === id);
          if (!moved) return todo;
          const rest = all.filter((each) => each.id !== id);
          return {
            ...todo,
            items: [...rest.slice(0, to - 1), moved, ...rest.slice(to - 1)],
          };
        }),
      );
      return { id: "todo_hilton" };
    }
    return undefined;
  });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <CopyProvider language="zh-CN">
        <Tooltip.Provider>
          <TodoPanel
            mainChatId="s-main"
            spot={{ here: "galley", at: "main:s-main", narrow: false }}
            onOpenSession={() => {}}
            onTalk={() => {}}
            onClose={() => {}}
          />
        </Tooltip.Provider>
      </CopyProvider>,
    );
  });
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

const row = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-todo-row="${id}"]`)!;
const words = (container: HTMLElement, id: string) =>
  Array.from(
    row(container, id).querySelectorAll<HTMLElement>(
      '[data-todo-subitem] [data-role="todo-item-text"]',
    ),
    (each) => each.textContent,
  );
const handles = (container: HTMLElement, id: string) =>
  Array.from(
    row(container, id).querySelectorAll<HTMLElement>(
      '[data-role="todo-item-handle"]',
    ),
  );
const calls = (command: string) =>
  getTauriMocks()
    .invoke.mock.calls.filter(([name]) => name === command)
    .map(([, args]) => args);

function click(el: Element) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  });
}
function press(el: Element, code: string, key = code) {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        code,
        key,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
function open(container: HTMLElement, id: string) {
  click(row(container, id));
}

describe("the handle (ruling 158 point 1)", () => {
  it("is on each item of an open to-do with two or more, seen on hover or focus, named for its item", () => {
    const container = mount();
    // Folded: no items drawn, no handle.
    expect(handles(container, "todo_hilton")).toEqual([]);
    open(container, "todo_hilton");
    const all = handles(container, "todo_hilton");
    expect(all).toHaveLength(3);
    expect(all[2].getAttribute("aria-label")).toBe(
      "拖动调整「筹开预算」的位置",
    );
    // Hidden until the item is hovered or has the focus; a grab cursor;
    // ink-muted, ink under the pointer.
    for (const cls of [
      "opacity-0",
      "group-hover/subitem:opacity-100",
      "group-focus-within/subitem:opacity-100",
      "cursor-grab",
      "text-ink-muted",
      "hover:text-ink",
    ]) {
      expect(all[0].className).toContain(cls);
    }
    // 13px bold dots in a 20px button, in the column under the to-do's
    // box: 28px left of the item's box.
    expect(all[0].className).toContain("size-5");
    expect(all[0].parentElement!.className).toContain("-left-7");
    // One item: nothing to order.
    open(container, "todo_soil");
    expect(handles(container, "todo_soil")).toEqual([]);
  });

  it("is not on an item whose words are being changed, nor on one still on its way to Core", async () => {
    const container = mount();
    open(container, "todo_hilton");
    click(
      row(container, "todo_hilton").querySelectorAll(
        '[data-role="todo-item-text"]',
      )[1],
    );
    expect(
      row(container, "todo_hilton")
        .querySelectorAll("[data-todo-subitem]")[1]
        .querySelector('[data-role="todo-item-handle"]'),
    ).toBeNull();
    expect(handles(container, "todo_hilton")).toHaveLength(2);
    act(() =>
      useAssistantTodoStore.setState({
        subitemAdds: {
          todo_hilton: [{ key: "pending_1", text: "开业时间表" }],
        },
      }),
    );
    const pending = row(container, "todo_hilton").querySelector(
      "[data-todo-subitem-pending]",
    )!;
    expect(pending.querySelector('[data-role="todo-item-handle"]')).toBeNull();
  });

  it("is not there while the to-do's tick holds its place", () => {
    const container = mount();
    open(container, "todo_hilton");
    act(() =>
      useAssistantTodoStore.setState({
        flips: { todo_hilton: { done: true, phase: "settling" } },
      }),
    );
    expect(handles(container, "todo_hilton")).toEqual([]);
  });
});

describe("moving an item from the keyboard", () => {
  async function lift(container: HTMLElement, at: number) {
    const handle = handles(container, "todo_hilton")[at];
    act(() => handle.focus());
    press(handle, "Space", " ");
    // The sensor listens a tick after it picks the item up.
    await settle();
    return handle;
  }

  it("Space picks it up, the arrows move it, Space puts it down: drawn at once, then Core", async () => {
    const container = mount();
    open(container, "todo_hilton");
    const handle = await lift(container, 2);
    press(handle, "ArrowUp");
    press(handle, "ArrowUp");
    press(handle, "Space", " ");
    expect(words(container, "todo_hilton")).toEqual([
      "筹开预算",
      "具体品牌与管理模式",
      "项目位置",
    ]);
    await settle();
    expect(calls("move_todo_subitem")).toEqual([{ id: "item_2", to: 1 }]);
    expect(words(container, "todo_hilton")).toEqual([
      "筹开预算",
      "具体品牌与管理模式",
      "项目位置",
    ]);
    expect(useAssistantTodoStore.getState().subitemOrders).toEqual({});
    // The row stays open, and does not light for its own move.
    expect(row(container, "todo_hilton").hasAttribute("data-todo-open")).toBe(
      true,
    );
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(row(container, "todo_hilton").classList).not.toContain(
      LOCATE_FLASH_CLASS,
    );
  });

  it("Esc gives up the drag and leaves the row open; put down where it was, nothing is written", async () => {
    const container = mount();
    open(container, "todo_hilton");
    let handle = await lift(container, 2);
    press(handle, "ArrowUp");
    press(handle, "Escape");
    await settle();
    expect(row(container, "todo_hilton").hasAttribute("data-todo-open")).toBe(
      true,
    );
    expect(words(container, "todo_hilton")).toEqual([
      "具体品牌与管理模式",
      "项目位置",
      "筹开预算",
    ]);
    handle = await lift(container, 2);
    press(handle, "Space", " ");
    await settle();
    expect(calls("move_todo_subitem")).toEqual([]);
  });

  it("puts them back as Core has them when Core refuses, the reason under the list", async () => {
    refuse = JSON.stringify({ error: "invalid_args", message: "boom" });
    const container = mount();
    open(container, "todo_hilton");
    const handle = await lift(container, 0);
    press(handle, "ArrowDown");
    press(handle, "Space", " ");
    await settle();
    expect(calls("move_todo_subitem")).toEqual([{ id: "item_0", to: 2 }]);
    expect(words(container, "todo_hilton")).toEqual([
      "具体品牌与管理模式",
      "项目位置",
      "筹开预算",
    ]);
    const why = row(container, "todo_hilton").querySelector(
      '[data-role="todo-items"] > [role="alert"]',
    );
    expect(why?.textContent).toBe("没能完成，再试一次。");
  });
});

describe("Galley moves an item", () => {
  it("lights the row while the panel is on screen", async () => {
    const container = mount();
    core = list([
      { ...HILTON, items: [HILTON.items![2], ...HILTON.items!.slice(0, 2)] },
      SOIL,
    ]);
    await act(async () => {
      await useAssistantTodoStore.getState().load();
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(row(container, "todo_hilton").classList).toContain(
      LOCATE_FLASH_CLASS,
    );
    open(container, "todo_hilton");
    expect(words(container, "todo_hilton")).toEqual([
      "筹开预算",
      "具体品牌与管理模式",
      "项目位置",
    ]);
  });
});
