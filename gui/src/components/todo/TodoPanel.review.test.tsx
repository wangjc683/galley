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
import { LOCATE_FLASH_CLASS } from "@/lib/locate-flash";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";

import { TodoPanel } from "./TodoPanel";

/**
 * The daily review off the to-do panel (main chat PRD ruling 145), end
 * to end: Core's list as it comes, the review in it, read through the
 * real store into the panel. Alone it leaves the empty state with no 例行
 * under it; beside another routine 例行 draws only that one; it never
 * brings up the launch at login hint; its changes light nothing. The
 * seam (`withoutDailyReview`) is pinned in lib/assistant-todo.test.ts,
 * the store taking it in in stores/assistant-todo.test.ts.
 */

// Launch at login off: the hint shows whenever something is set to go
// off.
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => false,
  enable: async () => {},
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const tomorrow = (hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const ROUTINE: TodoItem = {
  kind: "task",
  id: "sched_daily",
  text: "早报",
  state: "scheduled",
  createdBy: "assistant",
  target: "assistant",
  repeat: { kind: "daily" },
  timeOfDay: "08:00",
  at: tomorrow(8),
};
// Core's seed (ticket 73): its maker's label in `agent`, its prompt
// English for the model.
const REVIEW: TodoItem = {
  ...ROUTINE,
  id: "sched_review",
  text: "Daily review: read wake.md and go over what is in hand.",
  createdBy: "agent",
  agent: "galley-review",
  timeOfDay: "08:51",
  at: tomorrow(8, 51),
};
const PAUSED_REVIEW: TodoItem = { ...REVIEW, state: "paused", at: undefined };
// One of Galley's own one-off reminders.
const OWN: TodoItem = {
  kind: "task",
  id: "sched_water",
  text: "提醒喝水",
  state: "scheduled",
  createdBy: "assistant",
  target: "assistant",
  repeat: { kind: "once" },
  at: tomorrow(15),
  createdIn: { sessionId: "s-main", turnIndex: 6 },
};

let root: Root | null = null;
beforeEach(() => {
  useAssistantTodoStore.setState({
    todo: EMPTY_TODO,
    noted: [],
    loaded: false,
    flips: {},
    failures: {},
    cancelling: {},
    deleting: {},
    deleteToastId: null,
  });
  useUiStore.setState({ todoRowRequest: null, todoPageRequest: null });
});
function unmount() {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
}
afterEach(unmount);

/** Core answers with `core`; the store reads it. */
async function read(core: AssistantTodo) {
  getTauriMocks().invoke.mockImplementation(async (command) => {
    if (command === "list_assistant_todo") return core;
    if (command === "list_noted_todos") return [];
    return undefined;
  });
  await act(async () => {
    await useAssistantTodoStore.getState().load();
  });
}

/** The panel beside Galley, once its launch at login check is back. */
async function mount(): Promise<HTMLElement> {
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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

/** A frame for the panel to light what it drew. */
async function frame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

const groups = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-todo-group]")).map(
    (el) => el.dataset.todoGroup,
  );
const rows = (container: HTMLElement, group: string) =>
  Array.from(
    container.querySelectorAll<HTMLElement>(
      `[data-todo-group="${group}"] [data-todo-row]`,
    ),
  ).map((el) => el.dataset.todoRow);
const lit = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-todo-row]"))
    .filter((el) => el.classList.contains(LOCATE_FLASH_CLASS))
    .map((el) => el.dataset.todoRow);
const hint = (container: HTMLElement) =>
  container.querySelector('[data-role="todo-autostart-hint"]');

describe("the daily review is not on the panel (ruling 145)", () => {
  it("alone, running or paused: the empty state, and no 例行 under it", async () => {
    for (const review of [REVIEW, PAUSED_REVIEW]) {
      await read({ ...EMPTY_TODO, routine: [review] });
      const container = await mount();
      expect(
        container.querySelector('[data-role="todo-empty"]'),
      ).not.toBeNull();
      expect(groups(container)).toEqual([]);
      expect(container.querySelector('[data-todo-row="sched_review"]')).toBe(
        null,
      );
      expect(container.textContent).not.toContain("例行");
      expect(container.textContent).not.toContain("Daily review");
      unmount();
    }
  });

  it("beside another routine: 例行 draws only that one", async () => {
    await read({ ...EMPTY_TODO, routine: [ROUTINE, REVIEW] });
    const container = await mount();
    expect(container.querySelector('[data-role="todo-empty"]')).toBeNull();
    expect(groups(container)).toEqual(["routine"]);
    expect(rows(container, "routine")).toEqual(["sched_daily"]);
    expect(container.textContent).not.toContain("Daily review");
  });

  it("alone, running or paused, it brings up no launch at login hint; something else set to go off still does", async () => {
    for (const review of [REVIEW, PAUSED_REVIEW]) {
      await read({ ...EMPTY_TODO, routine: [review] });
      const container = await mount();
      expect(hint(container)).toBeNull();
      unmount();
    }
    for (const core of [
      { ...EMPTY_TODO, routine: [ROUTINE, REVIEW] },
      { ...EMPTY_TODO, assistant: [OWN], routine: [REVIEW] },
    ]) {
      await read(core);
      const container = await mount();
      expect(hint(container)).not.toBeNull();
      unmount();
    }
  });

  it("lights nothing when it moves, pauses, resumes or arrives while the panel is on screen", async () => {
    await read({ ...EMPTY_TODO, routine: [ROUTINE, REVIEW] });
    const container = await mount();
    await frame();
    expect(lit(container)).toEqual([]);
    for (const routine of [
      [ROUTINE, { ...REVIEW, timeOfDay: "07:30", at: tomorrow(7, 30) }],
      [ROUTINE, PAUSED_REVIEW],
      [ROUTINE, REVIEW],
      [ROUTINE],
      [ROUTINE, REVIEW],
    ]) {
      await read({ ...EMPTY_TODO, routine });
      await frame();
      expect(lit(container)).toEqual([]);
      expect(rows(container, "routine")).toEqual(["sched_daily"]);
    }
    // The other routine moved: lit, as ever.
    await read({
      ...EMPTY_TODO,
      routine: [
        { ...ROUTINE, timeOfDay: "08:30", at: tomorrow(8, 30) },
        REVIEW,
      ],
    });
    await frame();
    expect(lit(container)).toEqual(["sched_daily"]);
  });
});
