// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { act, type ReactNode } from "react";
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
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { getTauriMocks } from "@/test/setup";

import { TodoPanel } from "../TodoPanel";
import {
  DONE_FADE_CLASS,
  demoDone,
  doneLook,
  useTodoVariants,
  type DoneLook,
} from "./todo-variants";
import { TodoVariantsPill } from "./TodoVariantsPill";

/**
 * The temporary switcher for how quiet a done item is (main chat ticket
 * 83, PRD ruling 129 point 2), mounted with the real stores: 现状 is
 * today's markup to the byte (a snapshot taken before the switcher was
 * written), A, B and C change only what they say, a tick on its way
 * stays brand, 「演示」 swaps 已完成's rows and asks nothing of Core, the
 * pill is a dev build's only, and the switcher touches only the places
 * its removal steps name. The marker is spelt in two halves here so
 * this file is not one of its own hits.
 */

const MARK = ["TEMP variant switcher", "(main chat 83)"].join(" ");

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function inDays(days: number, hour = 9): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const DONE_TODO: TodoItem = {
  kind: "todo",
  id: "todo_done",
  text: "订餐厅",
  state: "done",
  createdBy: "assistant",
  createdIn: { sessionId: "s-main", turnIndex: 4 },
  at: inDays(0, 7),
};
const DONE_SUBTASK: TodoItem = {
  kind: "subtask",
  id: "s-sub",
  text: "查周五去上海的机票",
  state: "done",
  createdBy: "assistant",
  at: inDays(0, 8),
};
const FIRED: TodoItem = {
  kind: "task",
  id: "sched_water",
  text: "提醒喝水",
  state: "fired",
  createdBy: "assistant",
  target: "assistant",
  repeat: { kind: "once" },
  at: inDays(0, 10),
};
const ROUTINE_FIRED: TodoItem = {
  ...FIRED,
  id: "sched_daily",
  text: "早报",
  repeat: { kind: "daily" },
  timeOfDay: "08:00",
  at: inDays(0, 8),
};
const OPEN_TODO: TodoItem = {
  kind: "todo",
  id: "todo_open",
  text: "交季度报告",
  state: "open",
  createdBy: "assistant",
  createdIn: { sessionId: "s-main", turnIndex: 2 },
  due: { date: "2099-01-01", hasTime: false },
};
const CANCELLED_TODO: TodoItem = {
  ...OPEN_TODO,
  id: "todo_gone",
  text: "买营养土",
  cancelledAt: inDays(-1, 9),
};
const LIST: AssistantTodo = {
  ...EMPTY_TODO,
  yours: { today: [], later: [OPEN_TODO], anytime: [] },
  done: [DONE_TODO, DONE_SUBTASK, FIRED, ROUTINE_FIRED],
};

let root: Root | null = null;
beforeEach(() => {
  useAssistantTodoStore.setState({
    todo: LIST,
    noted: [],
    loaded: true,
    flips: {},
    failures: {},
    cancelling: {},
  });
  useTodoVariants.setState({ look: "now", source: "real" });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllEnvs();
});

function mount(node: ReactNode): HTMLElement {
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

const panel = (
  opts: { doneOpen?: boolean; onOpenSession?: (id: string) => void } = {},
) =>
  mount(
    <TodoPanel
      mainChatId="s-main"
      here="galley"
      onOpenSession={opts.onOpenSession ?? (() => {})}
      onTalk={() => {}}
      onClose={() => {}}
      defaultDoneOpen={opts.doneOpen ?? true}
    />,
  );

const cards = (items: TodoItem[]) => mount(<TodoCards items={items} />);

/** The drawn box beside a to-do's input (`ui/checkbox.tsx`). */
const box = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-todo-check="${id}"]`)?.nextElementSibling
    ?.className ?? "";

const BRAND = "border-brand bg-brand text-ink";
const QUIET = "border-line-strong bg-line-strong text-ink-soft";
const EMPTY_BOX = "border-line-strong bg-elevated text-transparent";

function pick(look: DoneLook) {
  act(() => useTodoVariants.setState({ look }));
}

/** 现状's done rows and cards, to compare a look against. */
function now(): { rows: string[]; cards: string } {
  const rows = doneRows(panel());
  act(() => root?.unmount());
  const html = cards([OPEN_TODO, DONE_TODO, CANCELLED_TODO]).innerHTML;
  act(() => root?.unmount());
  return { rows, cards: html };
}

/** Every row under 已完成, as markup. */
const doneRows = (container: HTMLElement) =>
  [
    ...container.querySelectorAll('[data-todo-group="done"] [data-todo-row]'),
  ].map((el) => el.outerHTML);

describe("现状 (the default)", () => {
  it("draws 已完成 and the cards exactly as before the switcher", () => {
    expect(doneRows(panel())).toMatchSnapshot("done rows");
    act(() => root?.unmount());
    const cards = mount(
      <TodoCards items={[OPEN_TODO, DONE_TODO, CANCELLED_TODO]} />,
    );
    expect(cards.innerHTML).toMatchSnapshot("cards");
  });
});

describe("the looks", () => {
  it("start on 现状 and 真实; each look adds to the one before", () => {
    expect(useTodoVariants.getInitialState()).toMatchObject({
      look: "now",
      source: "real",
    });
    expect(doneLook("now")).toEqual({
      mutedTitle: false,
      quietBox: false,
      fade: false,
    });
    expect(doneLook("A")).toEqual({
      mutedTitle: true,
      quietBox: false,
      fade: false,
    });
    expect(doneLook("B")).toEqual({
      mutedTitle: true,
      quietBox: true,
      fade: false,
    });
    expect(doneLook("C")).toEqual({
      mutedTitle: true,
      quietBox: true,
      fade: true,
    });
  });

  it("A: a done row that is not a to-do takes ink-muted, and nothing else changes", () => {
    const before = now();
    pick("A");
    const rows = doneRows(panel());
    // The to-do row as it was; the others with their title one step down.
    expect(rows[0]).toBe(before.rows[0]);
    for (const [index, row] of rows.entries()) {
      if (index === 0) continue;
      expect(before.rows[index]).toContain("text-ink-soft");
      expect(row).toBe(
        before.rows[index].replace("text-ink-soft", "text-ink-muted"),
      );
    }
    act(() => root?.unmount());
    expect(cards([OPEN_TODO, DONE_TODO, CANCELLED_TODO]).innerHTML).toBe(
      before.cards,
    );
  });

  it("B: a done to-do's box goes neutral, under 已完成 and on its card; the rest as A", () => {
    pick("A");
    const a = doneRows(panel());
    act(() => root?.unmount());
    pick("B");
    const container = panel();
    expect(box(container, "todo_done")).toContain(QUIET);
    expect(box(container, "todo_done")).not.toContain("bg-brand");
    // Still a box to untick.
    const input = container.querySelector('[data-todo-check="todo_done"]');
    expect(input?.hasAttribute("disabled")).toBe(false);
    // The rows that are not to-dos as A has them.
    expect(doneRows(container).slice(1)).toEqual(a.slice(1));
    // The open to-do above keeps its empty box.
    expect(box(container, "todo_open")).toContain(EMPTY_BOX);
    act(() => root?.unmount());
    const card = cards([OPEN_TODO, DONE_TODO, CANCELLED_TODO]);
    expect(box(card, "todo_done")).toContain(QUIET);
    expect(box(card, "todo_open")).toContain(EMPTY_BOX);
    expect(box(card, "todo_gone")).toContain(EMPTY_BOX);
    expect(card.innerHTML).not.toContain("opacity-70");
  });

  it("B: a tick on its way stays brand; the box goes grey once it is done", () => {
    pick("B");
    act(() =>
      useAssistantTodoStore.setState({
        flips: { todo_open: { done: true, phase: "settling" } },
      }),
    );
    const container = panel();
    // Held under 以后, ticked: brand.
    expect(
      container.querySelector(
        '[data-todo-part="later"] [data-todo-check="todo_open"]',
      )?.nextElementSibling?.className,
    ).toContain(BRAND);
    // Core wrote it and the list came back: under 已完成, neutral.
    act(() =>
      useAssistantTodoStore.setState({
        flips: {},
        todo: {
          ...LIST,
          yours: { today: [], later: [], anytime: [] },
          done: [
            { ...OPEN_TODO, state: "done", at: inDays(0, 11) },
            ...LIST.done,
          ],
        },
      }),
    );
    expect(
      container.querySelector(
        '[data-todo-group="done"] [data-todo-check="todo_open"]',
      )?.nextElementSibling?.className,
    ).toContain(QUIET);
    act(() => root?.unmount());
    // A card being ticked: brand too, until its to-do is done.
    act(() =>
      useAssistantTodoStore.setState({
        flips: { todo_open: { done: true, phase: "settling" } },
      }),
    );
    expect(box(cards([OPEN_TODO]), "todo_open")).toContain(BRAND);
  });

  it("C: every row under 已完成 and each done card at 70%, back to full on hover and focus", () => {
    expect(DONE_FADE_CLASS).toBe(
      "opacity-70 hover:opacity-100 focus-within:opacity-100",
    );
    pick("C");
    const container = panel();
    const rows = [
      ...container.querySelectorAll('[data-todo-group="done"] [data-todo-row]'),
    ];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.className).toContain(DONE_FADE_CLASS);
    }
    // B's box with it; nothing above 已完成 fades.
    expect(box(container, "todo_done")).toContain(QUIET);
    expect(
      container.querySelector('[data-todo-row="todo_open"]')?.className,
    ).not.toContain("opacity-70");
    act(() => root?.unmount());
    const card = cards([OPEN_TODO, DONE_TODO, CANCELLED_TODO]);
    const look = (id: string) =>
      card.querySelector(`[data-todo-id="${id}"]`)?.className ?? "";
    expect(look("todo_done")).toContain(DONE_FADE_CLASS);
    expect(look("todo_open")).not.toContain("opacity-70");
    expect(look("todo_gone")).not.toContain("opacity-70");
  });
});

describe("「演示」", () => {
  const DEMO_IDS = demoDone(0).map((item) => item.id);

  it("lists six done items: four ticked to-dos, a subtask back, a reminder gone off", () => {
    const demo = demoDone(new Date(2026, 9, 22).getTime());
    expect(demo.map((item) => item.kind).sort()).toEqual(
      ["task", "todo", "todo", "todo", "todo", "subtask"].sort(),
    );
    const todos = demo.filter((item) => item.kind === "todo");
    // Due at a time, due on a day, no time, ticked yesterday.
    expect(todos.filter((t) => t.due?.hasTime)).toHaveLength(1);
    expect(todos.filter((t) => t.due && !t.due.hasTime)).toHaveLength(2);
    expect(todos.filter((t) => !t.due)).toHaveLength(1);
    expect(todos.filter((t) => new Date(t.at!).getDate() === 21)).toHaveLength(
      1,
    );
    expect(demo.every((item) => item.state !== "open")).toBe(true);
    // No routine (ticket 82 takes them out of 已完成), nothing that leads
    // into a real conversation.
    expect(
      demo.some((item) => item.repeat && item.repeat.kind !== "once"),
    ).toBe(false);
    expect(demo.some((item) => item.createdIn || item.runSessionId)).toBe(
      false,
    );
    // Newest first, as Core's.
    const times = demo.map((item) => Date.parse(item.at!));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("swaps 已完成's rows and count, folded as ever; the cards stay real", () => {
    act(() =>
      useAssistantTodoStore.setState({
        todo: { ...LIST, doneOmitted: 3 },
      }),
    );
    act(() => useTodoVariants.setState({ source: "demo" }));
    const folded = panel({ doneOpen: false });
    const label = folded.querySelector(
      '[data-todo-group="done"] button[aria-expanded]',
    );
    expect(label?.getAttribute("aria-expanded")).toBe("false");
    expect(label?.textContent).toBe("已完成6");
    act(() => root?.unmount());
    const open = panel();
    const ids = [
      ...open.querySelectorAll('[data-todo-group="done"] [data-todo-row]'),
    ].map((row) => row.getAttribute("data-todo-row"));
    expect(ids).toEqual(DEMO_IDS);
    expect(open.textContent).not.toContain("没有列出");
    // Everything above 已完成 is the real list.
    expect(open.querySelector('[data-todo-row="todo_open"]')).not.toBeNull();
    act(() => root?.unmount());
    expect(
      cards([OPEN_TODO, DONE_TODO, CANCELLED_TODO]).querySelectorAll(
        '[data-role="todo-card"]',
      ),
    ).toHaveLength(3);
  });

  it("draws 已完成 from the demo even when the real one is empty, in the look picked", () => {
    act(() => useAssistantTodoStore.setState({ todo: { ...LIST, done: [] } }));
    act(() => useTodoVariants.setState({ source: "demo", look: "B" }));
    const container = panel();
    expect(box(container, "demo-todo-report")).toContain(QUIET);
  });

  it("asks nothing of Core and goes nowhere: a box, a subtask's title", async () => {
    const { invoke } = getTauriMocks();
    const opened: string[] = [];
    act(() => useTodoVariants.setState({ source: "demo" }));
    const container = panel({ onOpenSession: (id) => opened.push(id) });
    const check = container.querySelector(
      '[data-todo-check="demo-todo-report"]',
    );
    const title = container.querySelector(
      '[data-todo-row="demo-subtask"] button',
    );
    if (!(check instanceof HTMLElement) || !(title instanceof HTMLElement)) {
      throw new Error("no demo box or title");
    }
    await act(async () => {
      check.click();
      title.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
    expect(useAssistantTodoStore.getState().flips).toEqual({});
    expect((check as HTMLInputElement).checked).toBe(true);
  });
});

describe("the pill", () => {
  it("is in a dev build: 现状 A B C and 真实 / 演示, one click each", () => {
    mount(<TodoVariantsPill />);
    const pill = document.body.querySelector(
      '[data-role="todo-variants-pill"]',
    );
    expect(pill).not.toBeNull();
    expect((pill as HTMLElement).style.pointerEvents).toBe("auto");
    const options = [...pill!.querySelectorAll("button")];
    expect(options.map((b) => b.textContent)).toEqual([
      "现状",
      "A 档位拉齐",
      "B 方框退色",
      "C 再整行 70%",
      "真实",
      "演示",
    ]);
    expect(options[0].getAttribute("aria-pressed")).toBe("true");
    act(() => options[2].click());
    expect(useTodoVariants.getState().look).toBe("B");
    act(() => options[5].click());
    expect(useTodoVariants.getState().source).toBe("demo");
    expect(options[2].getAttribute("aria-pressed")).toBe("true");
  });

  it("is nothing outside a dev build", () => {
    vi.stubEnv("DEV", false);
    mount(<TodoVariantsPill />);
    expect(
      document.body.querySelector('[data-role="todo-variants-pill"]'),
    ).toBeNull();
  });

  it("touches only the places its removal steps name", () => {
    const root = path.resolve(__dirname, "../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) {
          if (readFileSync(full, "utf8").includes(MARK)) {
            hits.push(path.relative(root, full).split(path.sep).join("/"));
          }
        }
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(
      [
        "App.tsx",
        "components/conversation/TodoCards.tsx",
        "components/todo/TodoCheck.tsx",
        "components/todo/TodoPanel.tsx",
        "components/todo/todo-variants/TodoVariantsPill.tsx",
        "components/todo/todo-variants/todo-variants.ts",
        "components/ui/checkbox.tsx",
      ].sort(),
    );
  });
});
