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
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";

import { TodoPanel } from "./TodoPanel";

/**
 * A click on 「取消提醒」 on one of Galley's own reminders, through the
 * real store to Core (main chat ticket 80, PRD ruling 128 point 7): the
 * reminder card's call (`cancelScheduledTask`), the row gone with the
 * fresh list, a reason under the row when Core refuses. And your
 * to-do's menu (ticket 88, ruling 132 points 3 and 4), opened for real
 * from its ⋯ and by a right-click: 删除 takes the row off at once under
 * an undo toast, 撤销 brings it back, Core refusing brings it back with
 * the reason under it. The rest of the panel's markup is pinned in
 * TodoPanel.test.tsx; the undo's timing in stores/assistant-todo.test.ts.
 */

const spies = vi.hoisted(() => ({ cancelled: [] as string[] }));
vi.mock("@/lib/assistant-todo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/assistant-todo")>();
  return {
    ...actual,
    cancelScheduledTask: async (id: string) => {
      spies.cancelled.push(id);
      await actual.cancelScheduledTask(id);
    },
  };
});
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

const OWN: TodoItem = {
  kind: "task",
  id: "sched_water",
  text: "提醒喝水",
  state: "scheduled",
  createdBy: "assistant",
  target: "assistant",
  repeat: { kind: "once" },
  at: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
  createdIn: { sessionId: "s-main", turnIndex: 6 },
};
const LISTED: AssistantTodo = { ...EMPTY_TODO, assistant: [OWN] };

let root: Root | null = null;
beforeEach(() => {
  useAssistantTodoStore.setState({
    todo: LISTED,
    noted: [],
    loaded: true,
    flips: {},
    failures: {},
    cancelling: {},
    deleting: {},
    deleteToastId: null,
  });
  useUiStore.setState({ toasts: [] });
  usePrefsStore.setState({ languagePreference: "zh-CN" });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  spies.cancelled = [];
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

const ownRow = (container: HTMLElement) =>
  container.querySelector('[data-todo-row="sched_water"]');

async function cancelOwn(container: HTMLElement) {
  const button = ownRow(container)?.querySelector(
    'button[aria-label="取消提醒"]',
  );
  if (!(button instanceof HTMLElement)) throw new Error("no 取消提醒");
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("「取消提醒」 on Galley's own reminder", () => {
  it("calls the reminder card's cancel, then the row leaves with the fresh list", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "list_assistant_todo") return EMPTY_TODO;
      if (command === "list_noted_todos") return [];
      return undefined;
    });
    const container = mount();
    expect(ownRow(container)).not.toBeNull();
    await cancelOwn(container);
    expect(spies.cancelled).toEqual(["sched_water"]);
    expect(invoke).toHaveBeenCalledWith("delete_scheduled_task", {
      id: "sched_water",
      origin: { via: "gui" },
    });
    expect(ownRow(container)).toBeNull();
  });

  it("says why under the row when Core refuses, and the row stays", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "delete_scheduled_task") {
        throw JSON.stringify({ error: "not_found", message: "gone" });
      }
      return undefined;
    });
    const container = mount();
    await cancelOwn(container);
    expect(spies.cancelled).toEqual(["sched_water"]);
    const alert = ownRow(container)?.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("这件事已经不在了。");
    // Ready for another try.
    expect(
      ownRow(container)
        ?.querySelector('button[aria-label="取消提醒"]')
        ?.hasAttribute("disabled"),
    ).toBe(false);
  });
});

describe("your to-do's menu (ticket 88)", () => {
  const REPORT: TodoItem = {
    kind: "todo",
    id: "todo_report",
    text: "交周报",
    state: "open",
    createdBy: "assistant",
    reminder: {
      taskId: "sched_r",
      at: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
      state: "scheduled",
    },
  };
  const SOIL: TodoItem = {
    kind: "todo",
    id: "todo_soil",
    text: "买营养土",
    state: "open",
    createdBy: "assistant",
  };
  const YOURS: AssistantTodo = {
    ...EMPTY_TODO,
    yours: { today: [], later: [REPORT], anytime: [SOIL] },
  };
  const MENU = '[data-role="todo-row-menu"]';

  const reportRow = (container: HTMLElement) =>
    container.querySelector('[data-todo-row="todo_report"]');
  const menuRows = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>(`${MENU} [role="menuitem"]`),
    ).map((item) => item.textContent);
  const toasts = () => useUiStore.getState().toasts;

  async function settle(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 4; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
  }

  /** Press the row's ⋯, as the pointer does. */
  async function openMore(container: HTMLElement): Promise<void> {
    const more = reportRow(container)?.querySelector(
      'button[aria-label="更多"]',
    );
    if (!(more instanceof HTMLElement)) throw new Error("no ⋯");
    await act(async () => {
      more.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
    await settle();
  }

  async function choose(label: string): Promise<void> {
    const item = Array.from(
      document.querySelectorAll<HTMLElement>(`${MENU} [role="menuitem"]`),
    ).find((row) => row.textContent === label);
    if (!item) throw new Error(`no ${label}`);
    await act(async () => item.click());
    await settle();
  }

  beforeEach(() => {
    useAssistantTodoStore.setState({ todo: YOURS });
  });

  it("⋯ opens it: 说说这件, 取消提醒, 删除; 删除 takes the row off at once under an undo toast, Core told nothing", async () => {
    const { invoke } = getTauriMocks();
    const container = mount();
    await openMore(container);
    expect(menuRows()).toEqual(["说说这件", "取消提醒", "删除"]);
    expect(
      document.querySelectorAll(`${MENU} [role="separator"]`),
    ).toHaveLength(1);
    await choose("删除");

    expect(reportRow(container)).toBeNull();
    expect(
      container.querySelector('[data-todo-row="todo_soil"]'),
    ).not.toBeNull();
    expect(document.querySelector(MENU)).toBeNull();
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0].title).toBe("已删除「交周报」");
    expect(invoke).not.toHaveBeenCalled();

    // 撤销: back where it was, Core still told nothing.
    const toast = toasts()[0];
    await act(async () => {
      if (toast.action?.kind === "undo") toast.action.run();
    });
    expect(reportRow(container)).not.toBeNull();
    expect(toasts()).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("comes back with the reason under it when Core refuses", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "cancel_todo") {
        throw JSON.stringify({ error: "invalid_args", message: "no" });
      }
      if (command === "list_assistant_todo") return YOURS;
      if (command === "list_noted_todos") return [];
      return undefined;
    });
    const container = mount();
    await openMore(container);
    await choose("删除");
    expect(reportRow(container)).toBeNull();
    // The toast goes: now Core is asked, and refuses.
    const toast = toasts()[0];
    await act(async () => {
      toast.onClose?.();
      useUiStore.getState().dismissToast(toast.id);
    });
    await settle();

    expect(invoke).toHaveBeenCalledWith("cancel_todo", { id: "todo_report" });
    const alert = reportRow(container)?.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("没能完成，再试一次。");
  });

  it("is away while a tick holds, the row not mounted afresh: its box keeps focus", async () => {
    const container = mount();
    const box = reportRow(container)?.querySelector(
      '[data-todo-check="todo_report"]',
    );
    if (!(box instanceof HTMLElement)) throw new Error("no box");
    box.focus();
    await act(async () => box.click());
    expect(
      reportRow(container)?.querySelector('button[aria-label="更多"]'),
    ).toBeNull();
    expect(
      reportRow(container)?.hasAttribute("data-galley-context-menu-trigger"),
    ).toBe(false);
    // The same box, still focused.
    expect(
      reportRow(container)?.querySelector('[data-todo-check="todo_report"]'),
    ).toBe(box);
    expect(document.activeElement).toBe(box);
    // A second click takes the tick back: the ⋯ is there again.
    await act(async () => box.click());
    expect(
      reportRow(container)?.querySelector('button[aria-label="更多"]'),
    ).not.toBeNull();
    expect(document.activeElement).toBe(box);
  });

  it("opens on a right-click on the row, the same rows", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockImplementation(async (command) => {
      if (command === "list_assistant_todo") return YOURS;
      if (command === "list_noted_todos") return [];
      return { id: "todo_report" };
    });
    const container = mount();
    const row = reportRow(container)!;
    await act(async () => {
      row.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    await settle();
    expect(menuRows()).toEqual(["说说这件", "取消提醒", "删除"]);
    await choose("取消提醒");
    expect(invoke).toHaveBeenCalledWith("cancel_todo_reminder", {
      id: "todo_report",
    });
    // Without a reminder still to go off: no 取消提醒.
    const soil = container.querySelector('[data-todo-row="todo_soil"]')!;
    await act(async () => {
      soil.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 40,
        }),
      );
    });
    await settle();
    expect(menuRows()).toEqual(["说说这件", "删除"]);
  });
});

describe("「跟 Galley 说」 at the foot of a list (ticket 89)", () => {
  it("takes the empty state's path: beside Galley, the caret to its composer", () => {
    const talk = vi.fn();
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
              onTalk={talk}
              onClose={() => {}}
            />
          </Tooltip.Provider>
        </CopyProvider>,
      );
    });
    const button = container.querySelector('[data-role="todo-talk"]');
    if (!(button instanceof HTMLElement)) throw new Error("no talk row");
    expect(button.textContent).toBe("跟 Galley 说");
    act(() => button.click());
    expect(talk).toHaveBeenCalledTimes(1);
  });
});
