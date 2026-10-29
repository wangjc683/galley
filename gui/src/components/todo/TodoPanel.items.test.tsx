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
 * The items under one of your to-dos (main chat ticket 111, PRD ruling
 * 157), through the real stores to Core's five commands: the count on
 * the folded row's time line; the open row's boxes between the time
 * line and the notes; a tick drawn and sent at once, with no hold, and
 * a refused one put back with its reason; 「添加一项」 adding on Enter and
 * opening the next, a pasted block one item a line; the words changed in
 * place; the × with its five-second undo; and the row lighting when
 * Galley moves its items, not when this window does. The pure parts
 * (count, lines, what lights) are pinned in lib/todo-panel.test.ts.
 */

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
}));

const hadResizeObserver = "ResizeObserver" in globalThis;
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
});
afterAll(() => {
  if (!hadResizeObserver) {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  }
});

const NOW = new Date().toISOString();
const items = (...words: [string, boolean][]): TodoSubitem[] =>
  words.map(([text, done], at) => ({ id: `item_${at}`, text, done }));
const TRIP: TodoItem = {
  kind: "todo",
  id: "todo_trip",
  text: "下周三去上海出差",
  state: "open",
  createdBy: "assistant",
  createdIn: { sessionId: "s-main", turnIndex: 4 },
  createdAt: NOW,
  due: { date: "2026-11-04", hasTime: false },
  notes: "虹桥站附近",
  items: items(["订酒店", true], ["订机票", false], ["换港币", false]),
};
const SOIL: TodoItem = {
  kind: "todo",
  id: "todo_soil",
  text: "买营养土",
  state: "open",
  createdBy: "assistant",
  createdAt: NOW,
};
const list = (yours: TodoItem[]): AssistantTodo => ({
  ...EMPTY_TODO,
  yours: { today: [], later: [], anytime: yours },
});

/** What Core holds, as the item commands change it and the reads return. */
let core: AssistantTodo = list([TRIP, SOIL]);
let refuse: string | null = null;
/** While set, Core holds every add until it is called. */
let holdAdds: Promise<void> | null = null;
let minted = 10;

function changeItems(
  todoId: string,
  change: (items: TodoSubitem[]) => TodoSubitem[],
) {
  core = list(
    core.yours.anytime.map((item) =>
      item.id === todoId ? { ...item, items: change(item.items ?? []) } : item,
    ),
  );
}
function ownerOf(itemId: string): string {
  return core.yours.anytime.find((todo) =>
    (todo.items ?? []).some((each) => each.id === itemId),
  )!.id;
}

let root: Root | null = null;
beforeEach(() => {
  core = list([TRIP, SOIL]);
  refuse = null;
  holdAdds = null;
  minted = 10;
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
    const a = args as { id: string; texts?: string[]; text?: string };
    if (command === "add_todo_subitems") {
      if (holdAdds) await holdAdds;
      if (refuse) throw refuse;
      changeItems(a.id, (now) => [
        ...now,
        ...a.texts!.map((text) => ({
          id: `item_${(minted += 1)}`,
          text,
          done: false,
        })),
      ]);
      return { id: a.id };
    }
    if (
      command === "complete_todo_subitem" ||
      command === "reopen_todo_subitem" ||
      command === "update_todo_subitem" ||
      command === "remove_todo_subitem"
    ) {
      if (refuse) throw refuse;
      const owner = ownerOf(a.id);
      changeItems(owner, (now) =>
        command === "remove_todo_subitem"
          ? now.filter((each) => each.id !== a.id)
          : now.map((each) =>
              each.id !== a.id
                ? each
                : command === "update_todo_subitem"
                  ? { ...each, text: a.text! }
                  : { ...each, done: command === "complete_todo_subitem" },
            ),
      );
      return { id: owner };
    }
    return undefined;
  });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
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
const countOf = (container: HTMLElement, id: string) =>
  row(container, id).querySelector('[data-role="todo-item-count"]')
    ?.textContent ?? null;
const shown = (container: HTMLElement, id: string) =>
  Array.from(
    row(container, id).querySelectorAll<HTMLElement>("[data-todo-subitem]"),
  ).map(
    (each) =>
      `${each.hasAttribute("data-done") ? "x" : " "} ${
        each.querySelector('[data-role="todo-item-text"]')?.textContent ?? ""
      }`,
  );
const itemRow = (container: HTMLElement, itemId: string) =>
  container.querySelector<HTMLElement>(`[data-todo-subitem="${itemId}"]`)!;
const boxOf = (container: HTMLElement, itemId: string) =>
  itemRow(container, itemId).querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )!;
const focused = () =>
  document.activeElement instanceof HTMLTextAreaElement
    ? document.activeElement
    : null;
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
function key(el: Element, name: string) {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
function type(field: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function open(container: HTMLElement, id: string) {
  click(row(container, id));
}

describe("folded: the count on the time line (ruling 157 point 6)", () => {
  it("ends the time line with 「1/3 项」, after the time, and a row without items is as it was", () => {
    const container = mount();
    expect(countOf(container, "todo_trip")).toBe("1/3 项");
    const line = row(container, "todo_trip").querySelector(
      '[data-role="todo-meta"]',
    )!;
    // After the time, 8px apart, no 「·」; in the line's own ink.
    expect(line.textContent).not.toContain("·");
    const count = line.querySelector('[data-role="todo-item-count"]')!;
    expect(count.className).toContain("ml-2");
    expect(count.className).not.toContain("warning");
    expect(line.className).toContain("tabular-nums");
    expect(line.className).toContain("text-ink-soft");
    // No items: no count, the row as before.
    expect(countOf(container, "todo_soil")).toBeNull();
    // Folded, the items themselves are not drawn.
    expect(shown(container, "todo_trip")).toEqual([]);
  });

  it("stands alone in the time line's place without a time, the notes under it; 「3/3 项」 when all are ticked, nothing else", () => {
    core = list([
      {
        ...TRIP,
        due: undefined,
        items: items(["订酒店", true], ["订机票", true], ["换港币", true]),
      },
    ]);
    useAssistantTodoStore.setState({ todo: core });
    const container = mount();
    const line = row(container, "todo_trip").querySelector(
      '[data-role="todo-meta"]',
    )!;
    expect(line.textContent).toBe("3/3 项");
    expect(
      line.querySelector('[data-role="todo-item-count"]')!.className,
    ).not.toContain("ml-2");
    expect(
      row(container, "todo_trip").querySelector('[data-role="todo-notes"]')
        ?.textContent,
    ).toBe("虹桥站附近");
    // Still open in your to-dos: the user ticks it.
    expect(row(container, "todo_trip").dataset.todoState).toBe("open");
  });
});

describe("open: a box and the words a line", () => {
  it("draws them between the time line and the notes, in their order, the ticked one struck and quiet, 「添加一项」 at the foot", () => {
    const container = mount();
    open(container, "todo_trip");
    expect(shown(container, "todo_trip")).toEqual([
      "x 订酒店",
      "  订机票",
      "  换港币",
    ]);
    const trip = row(container, "todo_trip");
    const order = Array.from(
      trip.querySelectorAll<HTMLElement>(
        '[data-role="todo-meta"], [data-role="todo-items"], [data-role="todo-notes"]',
      ),
    ).map((el) => el.dataset.role);
    expect(order).toEqual(["todo-meta", "todo-items", "todo-notes"]);
    // Open, the count stays (the line does not jump).
    expect(countOf(container, "todo_trip")).toBe("1/3 项");
    const hotel = itemRow(container, "item_0");
    expect(
      hotel.querySelector('[data-role="todo-item-text"]')!.className,
    ).toContain("line-through");
    expect(hotel.querySelector("[aria-hidden]")!.className).toContain(
      "bg-line-strong",
    );
    expect(trip.querySelector('[data-role="todo-add-item"]')!.textContent).toBe(
      "添加一项",
    );
    // A to-do without items: 「添加一项」 alone.
    open(container, "todo_soil");
    expect(shown(container, "todo_soil")).toEqual([]);
    expect(
      row(container, "todo_soil").querySelector('[data-role="todo-add-item"]'),
    ).not.toBeNull();
  });
});

describe("a tick (no hold)", () => {
  it("is drawn and sent at once; the count follows; a second click takes it back", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const container = mount();
    open(container, "todo_trip");
    click(boxOf(container, "item_1"));
    // Drawn at once.
    expect(boxOf(container, "item_1").checked).toBe(true);
    expect(countOf(container, "todo_trip")).toBe("2/3 项");
    // Sent with the clock stopped (no timer has run): no 1.5 s hold.
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls("complete_todo_subitem")).toEqual([{ id: "item_1" }]);
    vi.useRealTimers();
    await settle();
    expect(shown(container, "todo_trip")).toEqual([
      "x 订酒店",
      "x 订机票",
      "  换港币",
    ]);
    // Again: back, as Core has it.
    click(boxOf(container, "item_1"));
    expect(calls("reopen_todo_subitem")).toEqual([{ id: "item_1" }]);
    await settle();
    expect(countOf(container, "todo_trip")).toBe("1/3 项");
    expect(useAssistantTodoStore.getState().subitemTicks).toEqual({});
  });

  it("refused: the box back as it was, and why under the item", async () => {
    refuse = JSON.stringify({ error: "not_found", message: "gone" });
    const container = mount();
    open(container, "todo_trip");
    click(boxOf(container, "item_2"));
    await settle();
    expect(boxOf(container, "item_2").checked).toBe(false);
    expect(itemRow(container, "item_2").textContent).toContain(
      "这件事已经不在了。",
    );
  });

  it("ticking the last item leaves the to-do open", async () => {
    const container = mount();
    open(container, "todo_trip");
    click(boxOf(container, "item_1"));
    click(boxOf(container, "item_2"));
    await settle();
    expect(countOf(container, "todo_trip")).toBe("3/3 项");
    expect(calls("complete_todo")).toEqual([]);
    expect(row(container, "todo_trip").dataset.todoState).toBe("open");
  });
});

describe("「添加一项」", () => {
  it("opens a line to type in; Enter adds and opens the next empty one; Enter on nothing closes it", async () => {
    const container = mount();
    open(container, "todo_trip");
    click(
      row(container, "todo_trip").querySelector('[data-role="todo-add-item"]')!,
    );
    let box = focused()!;
    expect(box.getAttribute("aria-label")).toBe("新的一项");
    type(box, " 带证件 ");
    key(box, "Enter");
    await settle();
    expect(calls("add_todo_subitems")).toEqual([
      { id: "todo_trip", texts: ["带证件"] },
    ]);
    // The next one, empty, the caret in it.
    box = focused()!;
    expect(box?.value).toBe("");
    type(box, "买转换插头");
    key(box, "Enter");
    await settle();
    expect(shown(container, "todo_trip").slice(-2)).toEqual([
      "  带证件",
      "  买转换插头",
    ]);
    key(focused()!, "Enter");
    expect(
      row(container, "todo_trip").querySelector('[data-role="todo-item-add"]'),
    ).toBeNull();
    expect(calls("add_todo_subitems")).toHaveLength(2);
    // The row's own adds never light it.
    expect(row(container, "todo_trip").classList).not.toContain(
      LOCATE_FLASH_CLASS,
    );
  });

  it("Esc closes it with nothing written; leaving it with words adds them", async () => {
    const container = mount();
    open(container, "todo_trip");
    const add = () =>
      row(container, "todo_trip").querySelector('[data-role="todo-add-item"]')!;
    click(add());
    type(focused()!, "不要的");
    key(focused()!, "Escape");
    expect(calls("add_todo_subitems")).toEqual([]);
    expect(row(container, "todo_trip").dataset.todoOpen).toBe("");
    click(add());
    const box = focused()!;
    type(box, "订接机");
    act(() => box.blur());
    await settle();
    expect(calls("add_todo_subitems")).toEqual([
      { id: "todo_trip", texts: ["订接机"] },
    ]);
    expect(
      row(container, "todo_trip").querySelector('[data-role="todo-item-add"]'),
    ).toBeNull();
  });

  it("a block of lines pasted is one item a line, blank lines skipped", async () => {
    const container = mount();
    open(container, "todo_soil");
    click(
      row(container, "todo_soil").querySelector('[data-role="todo-add-item"]')!,
    );
    const box = focused()!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.assign(paste, {
      clipboardData: { getData: () => "营养土\n\n  花盆 \r\n铲子\n" },
    });
    act(() => {
      box.dispatchEvent(paste);
    });
    await settle();
    expect(calls("add_todo_subitems")).toEqual([
      { id: "todo_soil", texts: ["营养土", "花盆", "铲子"] },
    ]);
    expect(shown(container, "todo_soil")).toEqual([
      "  营养土",
      "  花盆",
      "  铲子",
    ]);
  });

  it("typing during a save is kept: the item drawn at once, the line clear and editable, the writes in order", async () => {
    let release: () => void = () => {};
    holdAdds = new Promise<void>((resolve) => {
      release = resolve;
    });
    const container = mount();
    open(container, "todo_trip");
    click(
      row(container, "todo_trip").querySelector('[data-role="todo-add-item"]')!,
    );
    const box = focused()!;
    type(box, "带证件");
    key(box, "Enter");
    // At once: drawn under the others, counted, the line empty.
    const pending = () =>
      Array.from(
        row(container, "todo_trip").querySelectorAll<HTMLElement>(
          "[data-todo-subitem-pending]",
        ),
      ).map((each) => each.textContent);
    expect(pending()).toEqual(["带证件"]);
    expect(countOf(container, "todo_trip")).toBe("1/4 项");
    expect(box.value).toBe("");
    expect(box.readOnly).toBe(false);
    // Core still holds the first: what is typed now stays, and goes next.
    type(box, "买转换插头");
    expect(box.value).toBe("买转换插头");
    key(box, "Enter");
    expect(pending()).toEqual(["带证件", "买转换插头"]);
    type(box, "订接");
    await settle();
    // The second waits for the first.
    expect(calls("add_todo_subitems")).toEqual([
      { id: "todo_trip", texts: ["带证件"] },
    ]);
    release();
    await settle();
    expect(calls("add_todo_subitems")).toEqual([
      { id: "todo_trip", texts: ["带证件"] },
      { id: "todo_trip", texts: ["买转换插头"] },
    ]);
    expect(pending()).toEqual([]);
    expect(shown(container, "todo_trip").slice(-2)).toEqual([
      "  带证件",
      "  买转换插头",
    ]);
    // Still typing: nothing lost, nothing written over.
    expect(box.value).toBe("订接");
    expect(useAssistantTodoStore.getState().subitemWriting).toEqual({});
  });

  it("refused after the box closed: the item leaves, the box opens again with the words and the reason", async () => {
    refuse = JSON.stringify({ error: "internal", message: "boom" });
    const container = mount();
    open(container, "todo_trip");
    click(
      row(container, "todo_trip").querySelector('[data-role="todo-add-item"]')!,
    );
    const box = focused()!;
    type(box, "订接机");
    act(() => box.blur());
    await settle();
    const add = row(container, "todo_trip").querySelector(
      '[data-role="todo-item-add"]',
    )!;
    expect(add.querySelector("textarea")!.value).toBe("订接机");
    expect(add.textContent).toContain("没能完成，再试一次。");
    expect(
      row(container, "todo_trip").querySelector("[data-todo-subitem-pending]"),
    ).toBeNull();
    expect(useAssistantTodoStore.getState().subitemAddFailures).toEqual({});
  });

  it("refused: the words stay in the box with the reason under it", async () => {
    refuse = "boom";
    const container = mount();
    open(container, "todo_trip");
    click(
      row(container, "todo_trip").querySelector('[data-role="todo-add-item"]')!,
    );
    type(focused()!, "带证件");
    key(focused()!, "Enter");
    await settle();
    const add = row(container, "todo_trip").querySelector(
      '[data-role="todo-item-add"]',
    )!;
    expect(add.querySelector("textarea")!.value).toBe("带证件");
    expect(add.textContent).toContain("没能完成，再试一次。");
  });
});

describe("changing an item's words in place", () => {
  it("Enter saves, an emptied box gives up, Esc gives up", async () => {
    const container = mount();
    open(container, "todo_trip");
    const words = () =>
      itemRow(container, "item_1").querySelector<HTMLButtonElement>(
        '[data-role="todo-item-text"]',
      )!;
    click(words());
    expect(focused()?.getAttribute("aria-label")).toBe("这一项");
    type(focused()!, "订周二晚的机票");
    key(focused()!, "Enter");
    await settle();
    expect(calls("update_todo_subitem")).toEqual([
      { id: "item_1", text: "订周二晚的机票" },
    ]);
    expect(words().textContent).toBe("订周二晚的机票");
    click(words());
    type(focused()!, "  ");
    key(focused()!, "Enter");
    click(words());
    type(focused()!, "别的");
    key(focused()!, "Escape");
    await settle();
    expect(calls("update_todo_subitem")).toHaveLength(1);
    expect(words().textContent).toBe("订周二晚的机票");
  });
});

describe("deleting an item (5 s undo, ruling 132's way)", () => {
  const toasts = () => useUiStore.getState().toasts;

  it("goes at once, 「已删除「订机票」」 with 撤销; Core hears only when the toast goes", async () => {
    const container = mount();
    open(container, "todo_trip");
    const remove = itemRow(container, "item_1").querySelector(
      'button[aria-label="删除这一项"]',
    )!;
    click(remove);
    expect(shown(container, "todo_trip")).toEqual(["x 订酒店", "  换港币"]);
    expect(countOf(container, "todo_trip")).toBe("1/2 项");
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].title).toBe("已删除「订机票」");
    expect(calls("remove_todo_subitem")).toEqual([]);
    // 撤销: back, Core told nothing.
    act(() => {
      const action = toasts()[0].action;
      if (action?.kind === "undo") action.run();
    });
    expect(shown(container, "todo_trip")).toHaveLength(3);
    // Again, and two: one toast for both; it runs out, then Core.
    click(
      itemRow(container, "item_1").querySelector(
        'button[aria-label="删除这一项"]',
      )!,
    );
    click(
      itemRow(container, "item_2").querySelector(
        'button[aria-label="删除这一项"]',
      )!,
    );
    const last = toasts()[toasts().length - 1];
    expect(last.title).toBe("已删除 2 项");
    act(() => last.onClose?.());
    await settle();
    expect(calls("remove_todo_subitem")).toEqual([
      { id: "item_1" },
      { id: "item_2" },
    ]);
    expect(shown(container, "todo_trip")).toEqual(["x 订酒店"]);
    expect(useAssistantTodoStore.getState().subitemDeleting).toEqual({});
  });

  it("a send into the main chat commits it first", async () => {
    const container = mount();
    open(container, "todo_trip");
    click(
      itemRow(container, "item_2").querySelector(
        'button[aria-label="删除这一项"]',
      )!,
    );
    const flushing = useAssistantTodoStore.getState().flushDeletes();
    expect(flushing).not.toBeNull();
    await act(async () => {
      await flushing;
    });
    expect(calls("remove_todo_subitem")).toEqual([{ id: "item_2" }]);
  });
});

describe("Galley moves the items", () => {
  it("lights the row while the panel is on screen; the user's own tick does not", async () => {
    const container = mount();
    // Galley ticks one and adds one (a fresh list from Core).
    core = list([
      {
        ...TRIP,
        items: [
          ...items(["订酒店", true], ["订机票", true], ["换港币", false]),
          { id: "item_9", text: "订接机", done: false },
        ],
      },
      SOIL,
    ]);
    await act(async () => {
      await useAssistantTodoStore.getState().load();
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(row(container, "todo_trip").classList).toContain(LOCATE_FLASH_CLASS);
    expect(countOf(container, "todo_trip")).toBe("2/4 项");
    row(container, "todo_trip").classList.remove(LOCATE_FLASH_CLASS);
    // The user's own tick: no light.
    open(container, "todo_trip");
    click(boxOf(container, "item_2"));
    await settle();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(countOf(container, "todo_trip")).toBe("3/4 项");
    expect(row(container, "todo_trip").classList).not.toContain(
      LOCATE_FLASH_CLASS,
    );
  });
});
