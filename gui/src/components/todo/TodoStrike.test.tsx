// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

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
import { TODO_SETTLE_MS } from "@/lib/todo-panel";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { useUiStore } from "@/stores/ui";

import { TodoPanel } from "./TodoPanel";
import { todoTitleClass, useTodoStrikeDrawn } from "./todo-styles";

/**
 * The tick's beat on a to-do (main chat ticket 160, PRD ruling 208
 * point 2): the box plays it (`checkbox-tick`, ui/checkbox.tsx) and the
 * title's strike fades in (`todo-strike-in`) only when the tick comes
 * after mount — in the panel, on a card, whoever ticked it; a card turned
 * 「已删除」 too. What mounts struck (已完成 opening, a done card, a row
 * landing in 已完成) is still, and at rest the strike is the same
 * line-through as before.
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
const done = (item: TodoItem): TodoItem => ({ ...item, state: "done" });
const list = (yours: TodoItem[], finished: TodoItem[] = []): AssistantTodo => ({
  ...EMPTY_TODO,
  yours: { today: [], later: [], anytime: yours },
  done: finished,
});

let root: Root | null = null;
beforeEach(() => {
  useAssistantTodoStore.setState({
    todo: list([A, B]),
    noted: [],
    loaded: true,
    flips: {},
    failures: {},
    cancelling: {},
    deleting: {},
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

const wrapped = (node: React.ReactNode) => (
  <CopyProvider language="zh-CN">
    <Tooltip.Provider>{node}</Tooltip.Provider>
  </CopyProvider>
);

function mount(node: React.ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(wrapped(node));
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
    defaultDoneOpen
  />
);

/** The element carrying a to-do's title class, within `scope`. */
function titleIn(scope: Element, text: string): HTMLElement {
  const hit = Array.from(scope.querySelectorAll<HTMLElement>("*")).find(
    (el) =>
      el.textContent === text &&
      (el.classList.contains("text-ink") ||
        el.classList.contains("text-ink-muted")),
  );
  if (!hit) throw new Error(`no title ${text}`);
  return hit;
}
function boxIn(scope: Element): HTMLElement {
  const hit = scope.querySelector<HTMLElement>("label span[aria-hidden]");
  if (!hit) throw new Error("no box");
  return hit;
}
const row = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-todo-row="${id}"]`)!;
const card = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(
    `[data-role="todo-card"][data-todo-id="${id}"]`,
  )!;

describe("a to-do's title class", () => {
  it("strikes the same way at rest, and marks only a strike drawn after mount", () => {
    const struck = todoTitleClass(true);
    expect(struck).toBe(
      "transition-colors duration-(--motion-base) motion-reduce:transition-none text-ink-muted line-through",
    );
    expect(todoTitleClass(true, false, true)).toBe(`${struck} todo-strike-in`);
    expect(todoTitleClass(false, true, true)).toBe(`${struck} todo-strike-in`);
    // Nothing struck, nothing drawn: the line goes at once.
    expect(todoTitleClass(false, false, true)).toBe(todoTitleClass(false));
    expect(todoTitleClass(false)).not.toContain("line-through");
  });
});

describe("the strike drawn after mount", () => {
  function Probe({ struck }: { struck: boolean }) {
    const drawn = useTodoStrikeDrawn(struck);
    return (
      <span data-probe="" className={todoTitleClass(struck, false, drawn)}>
        x
      </span>
    );
  }
  const probe = (container: HTMLElement) =>
    container.querySelector<HTMLElement>("[data-probe]")!.classList;
  const rerender = (struck: boolean) =>
    act(() => root!.render(wrapped(<Probe struck={struck} />)));

  it("is not drawn for a title struck when it mounts", () => {
    const container = mount(<Probe struck />);
    expect(probe(container).contains("line-through")).toBe(true);
    expect(probe(container).contains("todo-strike-in")).toBe(false);
  });

  it("is drawn when the strike comes after mount, gone at once when it goes, and dropped once played", () => {
    vi.useFakeTimers();
    const container = mount(<Probe struck={false} />);
    rerender(true);
    expect(probe(container).contains("todo-strike-in")).toBe(true);
    rerender(false);
    expect(probe(container).contains("line-through")).toBe(false);
    expect(probe(container).contains("todo-strike-in")).toBe(false);
    rerender(true);
    act(() => vi.advanceTimersByTime(499));
    expect(probe(container).contains("todo-strike-in")).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(probe(container).contains("todo-strike-in")).toBe(false);
    expect(probe(container).contains("line-through")).toBe(true);
  });
});

describe("in the panel", () => {
  it("draws a tick Galley made after mount, box and strike; still once it is in 已完成", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const container = mount(panel());
    act(() =>
      useAssistantTodoStore.setState({
        todo: list([A], [{ ...done(B), doneBy: "assistant" }]),
      }),
    );
    const held = row(container, "todo_b");
    expect(boxIn(held).classList.contains("checkbox-tick")).toBe(true);
    expect(titleIn(held, "todo_b").classList).toContain("todo-strike-in");
    // The one not ticked: nothing.
    expect(boxIn(row(container, "todo_a")).className).not.toMatch(
      /checkbox-(un)?tick/,
    );
    expect(titleIn(row(container, "todo_a"), "todo_a").className).not.toMatch(
      /todo-strike-in|line-through/,
    );
    act(() => vi.advanceTimersByTime(TODO_SETTLE_MS));
    // In 已完成: a new row, grey and struck, still.
    const landed = row(container, "todo_b");
    expect(landed.closest('[data-todo-group="done"]')).not.toBeNull();
    expect(boxIn(landed).className).not.toMatch(/checkbox-(un)?tick/);
    const title = titleIn(landed, "todo_b");
    expect(title.classList).toContain("line-through");
    expect(title.classList).not.toContain("todo-strike-in");
  });

  it("draws your own tick in the hold, and plays no pop on the untick", () => {
    const container = mount(panel());
    act(() =>
      useAssistantTodoStore.setState({
        flips: { todo_a: { done: true, phase: "settling" } },
      }),
    );
    expect(boxIn(row(container, "todo_a")).classList).toContain(
      "checkbox-tick",
    );
    expect(titleIn(row(container, "todo_a"), "todo_a").classList).toContain(
      "todo-strike-in",
    );
    act(() => useAssistantTodoStore.setState({ flips: {} }));
    const box = boxIn(row(container, "todo_a")).classList;
    expect(box).toContain("checkbox-untick");
    expect(box).not.toContain("checkbox-tick");
    expect(titleIn(row(container, "todo_a"), "todo_a").className).not.toMatch(
      /todo-strike-in|line-through/,
    );
  });

  it("is still for what it mounts with under 已完成", () => {
    useAssistantTodoStore.setState({ todo: list([A], [done(B)]) });
    const container = mount(panel());
    const struck = row(container, "todo_b");
    expect(boxIn(struck).className).not.toMatch(/checkbox-(un)?tick/);
    expect(titleIn(struck, "todo_b").classList).not.toContain("todo-strike-in");
  });
});

describe("on a card", () => {
  it("is still for a card done when it mounts", () => {
    const container = mount(<TodoCards items={[done(B)]} />);
    const struck = card(container, "todo_b");
    expect(boxIn(struck).className).not.toMatch(/checkbox-(un)?tick/);
    const title = titleIn(struck, "todo_b");
    expect(title.classList).toContain("line-through");
    expect(title.classList).not.toContain("todo-strike-in");
  });

  it("draws a tick on the card after mount", () => {
    const container = mount(<TodoCards items={[A]} />);
    act(() =>
      useAssistantTodoStore.setState({
        flips: { todo_a: { done: true, phase: "settling" } },
      }),
    );
    expect(boxIn(card(container, "todo_a")).classList).toContain(
      "checkbox-tick",
    );
    expect(titleIn(card(container, "todo_a"), "todo_a").classList).toContain(
      "todo-strike-in",
    );
  });

  it("draws the strike when the card turns 「已删除」 after mount, its box left unticked", () => {
    const container = mount(<TodoCards items={[A]} />);
    act(() =>
      useAssistantTodoStore.setState({
        deleting: { todo_a: { order: 1, committing: false } },
      }),
    );
    const turned = card(container, "todo_a");
    expect(turned.textContent).toContain("已删除");
    expect(boxIn(turned).className).not.toMatch(/checkbox-(un)?tick/);
    expect(titleIn(turned, "todo_a").classList).toContain("todo-strike-in");
  });
});

describe("the beat's styles", () => {
  const css = readFileSync(
    path.resolve(__dirname, "../../styles/globals.css"),
    "utf8",
  );

  it("keep their own reduced-motion guard: no pop, no sweep, no fade", () => {
    // Its own block, not the shared list further down (ticket 161 adds
    // its own beside it).
    const rule = css
      .split("@media (prefers-reduced-motion: reduce)")
      .slice(1)
      .map((block) => block.slice(0, block.indexOf("}")))
      .find((first) => first.includes(".todo-strike-in"));
    expect(rule).toBeDefined();
    for (const selector of [
      ".checkbox-tick,",
      ".checkbox-tick > svg,",
      ".todo-strike-in",
    ])
      expect(rule!).toContain(selector);
    expect(rule!).toContain("animation: none");
  });

  it("time the beat by the tokens, not by literals", () => {
    const beat = css.slice(
      css.indexOf("@keyframes checkbox-tick-pop"),
      css.indexOf(".todo-strike-in {") + 200,
    );
    expect(beat).not.toMatch(/\d+m?s\b/);
    expect(beat).toContain("var(--motion-slow) var(--ease-spring)");
    expect(beat).toContain("var(--motion-base) var(--ease-firm)");
    expect(beat).toContain("var(--motion-fast)");
  });
});
