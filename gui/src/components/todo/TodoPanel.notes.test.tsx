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
import { LocalFilesContext } from "@/lib/local-files";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";

import { TodoPanel } from "./TodoPanel";

/**
 * An open to-do's layout and notes (main chat ticket 112, PRD ruling 158
 * points 2 and 3): the items' ink, 「添加一项」's plus, the gaps between
 * the blocks; the notes drawn apart — a paragraph a line, the day a step
 * darker, a full path in backticks the file by its name, the reply's file
 * reference when open (clickable with the conversation's file context,
 * as LocalFileWorkspace gives it to the panel), words when folded. The
 * pure parts are in lib/todo-notes.test.ts and lib/todo-panel.test.ts;
 * the drag in TodoPanel.move.test.tsx.
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
const PATH = "/Users/jc/Downloads/希尔顿项目资料收集模板.md";
const HILTON: TodoItem = {
  kind: "todo",
  id: "todo_hilton",
  text: "希尔顿酒店项目上下文资料收集",
  state: "open",
  createdBy: "assistant",
  createdIn: { sessionId: "s-main", turnIndex: 4 },
  createdAt: NOW,
  notes: `10月29日：业主说筹开预算下周给\n\n\n10月28日：资料收集模板做好了：\`${PATH}\`，用 \`todo show\` 看\nOct 27: the owner sent the address`,
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

/** What Core holds; the paths the reading panel was asked to open. */
const core: AssistantTodo = list([HILTON, SOIL]);
const activated: string[] = [];

let root: Root | null = null;
beforeEach(() => {
  activated.length = 0;
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
  getTauriMocks().invoke.mockImplementation(async (command) => {
    if (command === "list_assistant_todo") return core;
    if (command === "list_noted_todos") return [];
    return undefined;
  });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

/** The panel, with the conversation's file context (`withFiles`) as
 * LocalFileWorkspace gives it, or without. */
function mount(withFiles = true): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const panel = (
    <TodoPanel
      mainChatId="s-main"
      spot={{ here: "galley", at: "main:s-main", narrow: false }}
      onOpenSession={() => {}}
      onTalk={() => {}}
      onClose={() => {}}
    />
  );
  act(() => {
    root!.render(
      <CopyProvider language="zh-CN">
        <Tooltip.Provider>
          {withFiles ? (
            <LocalFilesContext.Provider
              value={(path) => {
                activated.push(path);
              }}
            >
              {panel}
            </LocalFilesContext.Provider>
          ) : (
            panel
          )}
        </Tooltip.Provider>
      </CopyProvider>,
    );
  });
  return container;
}

const row = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-todo-row="${id}"]`)!;

function click(el: Element) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  });
}
function open(container: HTMLElement, id: string) {
  click(row(container, id));
}

describe("the open row's layout (ruling 158 point 2)", () => {
  it("draws the items not ticked in ink-soft, a ticked one struck in ink-muted", () => {
    const container = mount();
    open(container, "todo_hilton");
    const [brand, place] = Array.from(
      row(container, "todo_hilton").querySelectorAll<HTMLElement>(
        '[data-role="todo-item-text"]',
      ),
    );
    expect(brand.className).toContain("text-ink-soft");
    expect(brand.className).not.toMatch(/(^| )text-ink( |$)/);
    expect(place.className).toContain("text-ink-muted");
    expect(place.className).toContain("line-through");
  });

  it("gives 「添加一项」 a plus in the box column, the words where the items' start", () => {
    const container = mount();
    open(container, "todo_hilton");
    const add = row(container, "todo_hilton").querySelector(
      '[data-role="todo-add-item"]',
    )!;
    expect(add.textContent).toBe("添加一项");
    const [plus, label] = Array.from(add.children);
    expect(plus.querySelector("svg")).not.toBeNull();
    expect(plus.getAttribute("aria-hidden")).toBe("true");
    expect(plus.className).toContain("w-3.5");
    expect(label.textContent).toBe("添加一项");
    expect(add.className).toContain("gap-2");
    expect(add.className).toContain("text-ink-muted");
    expect(add.className).toContain("hover:text-ink-soft");
  });

  it("sets the notes 10px under 「添加一项」 and the noted line 10px under them", () => {
    const container = mount();
    open(container, "todo_hilton");
    const notes = row(container, "todo_hilton").querySelector(
      '[data-role="todo-notes"]',
    )!;
    // 「添加一项」's own 2px foot and the notes' 8px.
    expect(notes.parentElement!.className).toContain("mt-2");
    const items = row(container, "todo_hilton").querySelector(
      '[data-role="todo-items"]',
    )!;
    expect(items.className).not.toContain("pb-");
    expect(
      row(container, "todo_hilton").querySelector('[data-role="todo-noted"]')!
        .className,
    ).toContain("mt-2.5");
    // No notes: 「添加备注」 where they would be.
    open(container, "todo_soil");
    const add = row(container, "todo_soil").querySelector(
      '[data-role="todo-add-notes"]',
    )!;
    expect(add.parentElement!.className).toContain("mt-2");
  });
});

describe("the notes, open (ruling 158 point 3)", () => {
  const paragraphs = (container: HTMLElement) =>
    Array.from(
      row(container, "todo_hilton").querySelectorAll<HTMLElement>(
        '[data-role="todo-notes"] p',
      ),
    );

  it("are a paragraph a line, 6px apart, a run of blank lines one gap", () => {
    const container = mount();
    open(container, "todo_hilton");
    expect(paragraphs(container)).toHaveLength(3);
    const notes = row(container, "todo_hilton").querySelector(
      '[data-role="todo-notes"]',
    )!;
    expect(notes.className).toContain("gap-1.5");
    for (const p of paragraphs(container)) {
      expect(p.className).toContain("text-ink-muted");
      expect(p.className).toContain("whitespace-pre-wrap");
    }
  });

  it("set a leading day apart a step darker, in Chinese and English, and nothing else", () => {
    const container = mount();
    open(container, "todo_hilton");
    const days = Array.from(
      row(container, "todo_hilton").querySelectorAll<HTMLElement>(
        '[data-role="todo-notes-day"]',
      ),
    );
    expect(days.map((day) => day.textContent)).toEqual([
      "10月29日：",
      "10月28日：",
      "Oct 27:",
    ]);
    for (const day of days) {
      expect(day.className).toContain("text-ink-soft");
      expect(day.className).toContain("tabular-nums");
    }
  });

  it("draw a full path in backticks as the reply's file reference, by its name; other backticks as written", () => {
    const container = mount();
    open(container, "todo_hilton");
    const second = paragraphs(container)[1];
    expect(second.textContent).toBe(
      "10月28日：资料收集模板做好了：希尔顿项目资料收集模板.md，用 `todo show` 看",
    );
    const file = second.querySelector<HTMLButtonElement>(".file-path-button")!;
    expect(file.textContent).toBe("希尔顿项目资料收集模板.md");
    // A click on it is the file's: the reading panel asked, the notes
    // not opened for changing, the row still open.
    click(file);
    expect(activated).toEqual([PATH]);
    expect(document.querySelector("textarea")).toBeNull();
    expect(row(container, "todo_hilton").hasAttribute("data-todo-open")).toBe(
      true,
    );
    // A click on the words opens the box with the notes as written.
    click(second.querySelector("[data-caret-from]")!);
    expect(document.querySelector("textarea")!.value).toBe(HILTON.notes);
  });

  it("are words, the file by its name, without the conversation's file context", () => {
    const container = mount(false);
    open(container, "todo_hilton");
    const second = paragraphs(container)[1];
    expect(second.querySelector(".file-path-button")).toBeNull();
    expect(second.textContent).toContain("希尔顿项目资料收集模板.md");
    expect(second.textContent).not.toContain(PATH);
  });
});

describe("the notes, folded", () => {
  it("say a backticked path by its file's name, the backticks gone, and are no button", () => {
    const container = mount();
    const line = row(container, "todo_hilton").querySelector(
      '[data-role="todo-notes"]',
    )!;
    expect(line.textContent).toBe(
      "10月29日：业主说筹开预算下周给 10月28日：资料收集模板做好了：希尔顿项目资料收集模板.md，用 `todo show` 看 Oct 27: the owner sent the address",
    );
    expect(line.querySelector("button")).toBeNull();
    expect(line.querySelector('[data-role="todo-notes-day"]')).toBeNull();
    // A click on it opens the row, as before.
    click(line);
    expect(row(container, "todo_hilton").hasAttribute("data-todo-open")).toBe(
      true,
    );
  });
});
