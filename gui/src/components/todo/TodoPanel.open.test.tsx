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
} from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import { LOCATE_FLASH_CLASS } from "@/lib/locate-flash";
import { showTodoRow } from "@/lib/todo-open";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";

import { TodoPanel } from "./TodoPanel";

/**
 * One of your to-dos opened in place and its words changed there (main
 * chat ticket 107, PRD ruling 153 points 2–4), through the real stores
 * to Core's `update_todo`: a click opens a row and folds it, one at a
 * time; Esc gives up an edit, then folds the row, then closes the panel;
 * a title's and notes' keys (Enter, ⌘Enter, Esc, leaving the box,
 * emptied), nothing written when nothing changed, the words kept when
 * Core refuses; a card's title opening its row; the foot's day and its
 * jump; and the row folding when it is ticked off or deleted. What a
 * save writes is pinned in lib/todo-panel.test.ts (`todoEditWrite`).
 */

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
}));

// Radix's menus measure their trigger; jsdom has no ResizeObserver.
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
const HOTEL: TodoItem = {
  kind: "todo",
  id: "todo_hotel",
  text: "希尔顿酒店项目资料收集",
  state: "open",
  createdBy: "assistant",
  createdIn: { sessionId: "s-main", turnIndex: 236 },
  createdAt: NOW,
  notes: "收集要点：\n1. 具体位置\n2. 预算",
  due: { date: "2026-11-20", hasTime: false },
};
const SOIL: TodoItem = {
  kind: "todo",
  id: "todo_soil",
  text: "买营养土",
  state: "open",
  createdBy: "agent",
  createdAt: NOW,
};
const list = (yours: TodoItem[], done: TodoItem[] = []): AssistantTodo => ({
  ...EMPTY_TODO,
  yours: { today: [], later: [], anytime: yours },
  done,
});

/** What Core holds, as `update_todo` changes it and the reads return. */
let core: AssistantTodo = list([HOTEL, SOIL]);
let refuse: string | null = null;

let root: Root | null = null;
let closed = 0;
beforeEach(() => {
  core = list([HOTEL, SOIL]);
  refuse = null;
  closed = 0;
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
    if (command === "update_todo") {
      if (refuse) throw refuse;
      const { id, title, notes } = args as {
        id: string;
        title?: string;
        notes?: string;
      };
      const change = (item: TodoItem): TodoItem =>
        item.id !== id
          ? item
          : {
              ...item,
              ...(title !== undefined ? { text: title } : {}),
              ...(notes !== undefined ? { notes: notes || undefined } : {}),
            };
      core = list(core.yours.anytime.map(change));
      return { id };
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
            onClose={() => {
              closed += 1;
            }}
          />
        </Tooltip.Provider>
      </CopyProvider>,
    );
  });
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

const row = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-todo-row="${id}"]`);
const isOpen = (container: HTMLElement, id: string) =>
  row(container, id)?.hasAttribute("data-todo-open") ?? false;
const openRows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-todo-open]")).map(
    (each) => each.dataset.todoRow,
  );
/** The title: the row's button named by its words. */
const titleOf = (container: HTMLElement, id: string) =>
  row(container, id)!.querySelector<HTMLButtonElement>(
    "button[aria-expanded]",
  )!;
const box = () =>
  document.activeElement instanceof HTMLTextAreaElement
    ? document.activeElement
    : null;

function click(el: Element) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  });
}
function key(
  el: Element,
  name: string,
  extra: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}
/** Type into the box as the user does: React's own value setter, then
 * the input event. */
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
const updates = () =>
  getTauriMocks().invoke.mock.calls.filter(
    ([command]) => command === "update_todo",
  );

describe("opening a row (ruling 153 points 2 and 3)", () => {
  it("opens on a click on the row or its title, and folds on its own blank", () => {
    const container = mount();
    expect(openRows(container)).toEqual([]);
    click(row(container, "todo_hotel")!);
    expect(openRows(container)).toEqual(["todo_hotel"]);
    expect(titleOf(container, "todo_hotel").getAttribute("aria-expanded")).toBe(
      "true",
    );
    // The selected ground, the actions in sight.
    expect(row(container, "todo_hotel")!.className).toContain("bg-selected");
    // Open: the notes whole, their lines kept; the foot.
    const notes = row(container, "todo_hotel")!.querySelector(
      '[data-role="todo-notes"]',
    )!;
    expect(notes.textContent).toBe(HOTEL.notes);
    expect(notes.className).toContain("whitespace-pre-wrap");
    expect(
      row(container, "todo_hotel")!.querySelector('[data-role="todo-noted"]')
        ?.textContent,
    ).toBe("今天记下 · 在对话里查看");
    // Its own blank folds it.
    click(row(container, "todo_hotel")!);
    expect(openRows(container)).toEqual([]);
    // The title opens it too, and from the keyboard it is the button.
    click(titleOf(container, "todo_soil"));
    expect(openRows(container)).toEqual(["todo_soil"]);
  });

  it("opens one at a time: another row opens, the first folds", () => {
    const container = mount();
    click(row(container, "todo_hotel")!);
    click(row(container, "todo_soil")!);
    expect(openRows(container)).toEqual(["todo_soil"]);
    click(titleOf(container, "todo_hotel"));
    expect(openRows(container)).toEqual(["todo_hotel"]);
  });

  it("is not opened by its box or its buttons, and folds on a click elsewhere in the panel", () => {
    const container = mount();
    const talk = row(container, "todo_hotel")!.querySelector(
      'button[aria-label="说说这件"]',
    )!;
    click(talk);
    expect(openRows(container)).toEqual([]);
    click(row(container, "todo_hotel")!);
    // The list's own blank, outside the row.
    click(container.querySelector('[data-todo-page="todo"]')!);
    expect(openRows(container)).toEqual([]);
  });

  it("remembers none: closed and opened again, or turned to 备忘 and back", () => {
    let container = mount();
    click(row(container, "todo_hotel")!);
    const [todoPage, memoPage] = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-role="todo-panel-pages"] [role="radio"]',
      ),
    );
    act(() => memoPage.click());
    act(() => todoPage.click());
    expect(openRows(container)).toEqual([]);
    click(row(container, "todo_hotel")!);
    act(() => root?.unmount());
    document.body.innerHTML = "";
    container = mount();
    expect(openRows(container)).toEqual([]);
  });

  it("its time line says 「说说这件」: the title quoted into Galley's composer", () => {
    const container = mount();
    click(row(container, "todo_hotel")!);
    const time = row(container, "todo_hotel")!.querySelector(
      '[data-role="todo-meta-talk"]',
    )!;
    click(time);
    expect(useUiStore.getState().quoteRequest).toMatchObject({
      sessionId: "s-main",
      text: HOTEL.text,
    });
    expect(isOpen(container, "todo_hotel")).toBe(true);
  });

  it("「在对话里查看」 makes the jump its title used to; with nowhere to go, only the day", () => {
    const container = mount();
    click(row(container, "todo_hotel")!);
    const view = Array.from(
      row(container, "todo_hotel")!.querySelectorAll("button"),
    ).find((button) => button.textContent === "在对话里查看")!;
    click(view);
    expect(useUiStore.getState().locateRequest).toMatchObject({
      sessionId: "s-main",
    });
    // Another agent's, noted in no reply: the day alone, no button.
    click(row(container, "todo_soil")!);
    const foot = row(container, "todo_soil")!.querySelector(
      '[data-role="todo-noted"]',
    )!;
    expect(foot.textContent).toBe("今天记下");
    expect(foot.querySelector("button")).toBeNull();
    // No notes: 「添加备注」 in their place.
    expect(
      row(container, "todo_soil")!.querySelector('[data-role="todo-add-notes"]')
        ?.textContent,
    ).toBe("添加备注");
  });

  it("puts 「在对话里查看」 in the menu, open or folded, when it has somewhere to go", async () => {
    const container = mount();
    const menuRows = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-role="todo-row-menu"] [role="menuitem"]',
        ),
      ).map((item) => item.textContent);
    for (const [id, rows] of [
      ["todo_hotel", ["说说这件", "在对话里查看", "删除"]],
      ["todo_soil", ["说说这件", "删除"]],
    ] as const) {
      await act(async () => {
        row(container, id)!.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: 10,
            clientY: 10,
          }),
        );
      });
      await settle();
      expect(menuRows()).toEqual(rows);
      await act(async () => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      await settle();
    }
  });
});

describe("Esc, three steps (ruling 153: 改)", () => {
  it("gives up the edit, then folds the row, then closes the panel", () => {
    const container = mount();
    click(row(container, "todo_hotel")!);
    click(titleOf(container, "todo_hotel"));
    const field = box()!;
    type(field, "改了一半");
    // In the box: the edit is given up, the row stays open, and the key
    // is the box's alone.
    const first = key(field, "Escape");
    expect(first.defaultPrevented).toBe(true);
    expect(box()).toBeNull();
    expect(isOpen(container, "todo_hotel")).toBe(true);
    expect(titleOf(container, "todo_hotel").textContent).toBe(HOTEL.text);
    expect(closed).toBe(0);
    // The focus back on the words: the next Esc folds the row.
    expect(document.activeElement).toBe(titleOf(container, "todo_hotel"));
    key(document.activeElement!, "Escape");
    expect(openRows(container)).toEqual([]);
    expect(closed).toBe(0);
    key(document.activeElement ?? document.body, "Escape");
    expect(closed).toBe(1);
    expect(updates()).toEqual([]);
  });
});

describe("changing the title (ruling 153 point 4)", () => {
  it("is a box in its place, the caret at the end from the keyboard; Enter saves to Core, unlit", async () => {
    const container = mount();
    click(row(container, "todo_hotel")!);
    act(() => titleOf(container, "todo_hotel").click());
    const field = box()!;
    expect(field.value).toBe(HOTEL.text);
    expect(field.selectionStart).toBe(HOTEL.text.length);
    type(field, "希尔顿酒店项目资料收集与整理");
    key(field, "Enter");
    await settle();
    expect(updates()).toEqual([
      [
        "update_todo",
        { id: "todo_hotel", title: "希尔顿酒店项目资料收集与整理" },
      ],
    ]);
    expect(box()).toBeNull();
    expect(titleOf(container, "todo_hotel").textContent).toBe(
      "希尔顿酒店项目资料收集与整理",
    );
    expect(isOpen(container, "todo_hotel")).toBe(true);
    // Its own change does not light it.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(row(container, "todo_hotel")!.classList).not.toContain(
      LOCATE_FLASH_CLASS,
    );
    expect(useAssistantTodoStore.getState().editing).toEqual({});
  });

  it("saves on leaving the box, never breaks a line", async () => {
    const container = mount();
    click(row(container, "todo_soil")!);
    click(titleOf(container, "todo_soil"));
    const field = box()!;
    type(field, "买两袋\n营养土");
    expect(field.value).toBe("买两袋 营养土");
    act(() => field.blur());
    await settle();
    expect(updates()).toEqual([
      ["update_todo", { id: "todo_soil", title: "买两袋 营养土" }],
    ]);
  });

  it("writes nothing when the words are as they were, or emptied", async () => {
    const container = mount();
    click(row(container, "todo_hotel")!);
    click(titleOf(container, "todo_hotel"));
    key(box()!, "Enter");
    expect(box()).toBeNull();
    click(titleOf(container, "todo_hotel"));
    type(box()!, "   ");
    key(box()!, "Enter");
    await settle();
    expect(updates()).toEqual([]);
    expect(titleOf(container, "todo_hotel").textContent).toBe(HOTEL.text);
  });

  it("keeps the words in the box when Core refuses, says why, and Esc goes back to Core's", async () => {
    refuse = JSON.stringify({ error: "not_found", message: "gone" });
    const container = mount();
    click(row(container, "todo_hotel")!);
    click(titleOf(container, "todo_hotel"));
    type(box()!, "改过的标题");
    key(box()!, "Enter");
    await settle();
    expect(updates()).toHaveLength(1);
    const field = box()!;
    expect(field.value).toBe("改过的标题");
    expect(
      row(container, "todo_hotel")!.querySelector('[role="alert"]')
        ?.textContent,
    ).toBe("这件事已经不在了。");
    // Again: written again.
    refuse = JSON.stringify({ error: "internal", message: "busy" });
    key(field, "Enter");
    await settle();
    expect(updates()).toHaveLength(2);
    expect(
      row(container, "todo_hotel")!.querySelector('[role="alert"]')
        ?.textContent,
    ).toBe("没能完成，再试一次。");
    key(box()!, "Escape");
    expect(box()).toBeNull();
    expect(titleOf(container, "todo_hotel").textContent).toBe(HOTEL.text);
    expect(
      row(container, "todo_hotel")!.querySelector('[role="alert"]'),
    ).toBeNull();
  });
});

describe("changing the notes (ruling 153 point 4)", () => {
  const notesOf = (container: HTMLElement, id: string) =>
    row(container, id)!.querySelector<HTMLElement>(
      '[data-role="todo-notes"], [data-role="todo-add-notes"]',
    )!;

  it("breaks a line on Enter and saves on ⌘Enter", async () => {
    const container = mount();
    click(row(container, "todo_hotel")!);
    click(notesOf(container, "todo_hotel"));
    const field = box()!;
    expect(field.value).toBe(HOTEL.notes);
    const enter = key(field, "Enter");
    expect(enter.defaultPrevented).toBe(false);
    expect(updates()).toEqual([]);
    type(field, `${HOTEL.notes}\n3. 联系人`);
    key(field, "Enter", { metaKey: true });
    await settle();
    expect(updates()).toEqual([
      ["update_todo", { id: "todo_hotel", notes: `${HOTEL.notes}\n3. 联系人` }],
    ]);
    expect(box()).toBeNull();
    expect(notesOf(container, "todo_hotel").textContent).toBe(
      `${HOTEL.notes}\n3. 联系人`,
    );
  });

  it("adds them from 「添加备注」, and saves on leaving the box", async () => {
    const container = mount();
    click(row(container, "todo_soil")!);
    click(notesOf(container, "todo_soil"));
    type(box()!, "阳台用");
    act(() => box()!.blur());
    await settle();
    expect(updates()).toEqual([
      ["update_todo", { id: "todo_soil", notes: "阳台用" }],
    ]);
  });

  it("takes them away when emptied; writes nothing unchanged; Esc gives up", async () => {
    const container = mount();
    click(row(container, "todo_hotel")!);
    click(notesOf(container, "todo_hotel"));
    key(box()!, "Enter", { metaKey: true });
    click(notesOf(container, "todo_hotel"));
    type(box()!, "不要了");
    key(box()!, "Escape");
    expect(updates()).toEqual([]);
    expect(notesOf(container, "todo_hotel").textContent).toBe(HOTEL.notes);
    click(notesOf(container, "todo_hotel"));
    type(box()!, "");
    key(box()!, "Enter", { metaKey: true });
    await settle();
    expect(updates()).toEqual([
      ["update_todo", { id: "todo_hotel", notes: "" }],
    ]);
    expect(notesOf(container, "todo_hotel").textContent).toBe("添加备注");
  });
});

describe("a card's title (ruling 153: from the card, open)", () => {
  it("opens its row, the panel already up or opening for it", () => {
    let container = mount();
    act(() => showTodoRow("todo_soil", "s-main"));
    expect(openRows(container)).toEqual(["todo_soil"]);
    act(() => root?.unmount());
    document.body.innerHTML = "";
    useUiStore.setState({ todoRowRequest: null });
    act(() => showTodoRow("todo_hotel", "s-main"));
    container = mount();
    expect(openRows(container)).toEqual(["todo_hotel"]);
  });

  it("does not open a row the panel opening by itself lights", () => {
    const container = mount();
    act(() => useUiStore.getState().requestTodoRows(["todo_hotel"]));
    expect(openRows(container)).toEqual([]);
  });
});

describe("folding when it leaves your to-dos", () => {
  const done = (item: TodoItem): TodoItem => ({
    ...item,
    state: "done",
    at: NOW,
  });

  it("your tick: open through its hold, folded once it is in 已完成, not open again unticked", async () => {
    const container = mount();
    click(row(container, "todo_hotel")!);
    act(() =>
      useAssistantTodoStore.setState({
        flips: { todo_hotel: { done: true, phase: "settling" } },
      }),
    );
    expect(isOpen(container, "todo_hotel")).toBe(true);
    // Ticked: nothing to change in place.
    click(titleOf(container, "todo_hotel"));
    expect(box()).toBeNull();
    act(() =>
      useAssistantTodoStore.setState({
        flips: {},
        todo: list([SOIL], [done(HOTEL)]),
      }),
    );
    expect(openRows(container)).toEqual([]);
    act(() => useAssistantTodoStore.setState({ todo: list([HOTEL, SOIL]) }));
    expect(openRows(container)).toEqual([]);
  });

  it("Galley's tick folds it at once, the row held where it stood", () => {
    const container = mount();
    click(row(container, "todo_hotel")!);
    act(() =>
      useAssistantTodoStore.setState({
        todo: list([SOIL], [{ ...done(HOTEL), doneBy: "assistant" }]),
      }),
    );
    expect(row(container, "todo_hotel")).not.toBeNull();
    expect(openRows(container)).toEqual([]);
  });

  it("deleted from its menu: gone at once, and back folded on 撤销", async () => {
    const container = mount();
    click(row(container, "todo_hotel")!);
    await act(async () => {
      row(container, "todo_hotel")!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    await settle();
    const remove = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-role="todo-row-menu"] [role="menuitem"]',
      ),
    ).find((item) => item.textContent === "删除")!;
    await act(async () => remove.click());
    await settle();
    expect(row(container, "todo_hotel")).toBeNull();
    const toast = useUiStore.getState().toasts[0];
    await act(async () => {
      if (toast.action?.kind === "undo") toast.action.run();
    });
    expect(row(container, "todo_hotel")).not.toBeNull();
    expect(openRows(container)).toEqual([]);
  });
});
