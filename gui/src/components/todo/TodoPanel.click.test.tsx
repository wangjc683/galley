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

import {
  EMPTY_TODO,
  type AssistantTodo,
  type TodoItem,
} from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { getTauriMocks } from "@/test/setup";

import { TodoPanel } from "./TodoPanel";

/**
 * A click on 「取消提醒」 on one of Galley's own reminders, through the
 * real store to Core (main chat ticket 80, PRD ruling 128 point 7): the
 * reminder card's call (`cancelScheduledTask`), the row gone with the
 * fresh list, a reason under the row when Core refuses. The rest of the
 * panel's markup is pinned in TodoPanel.test.tsx.
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

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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
  });
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
            here="galley"
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
