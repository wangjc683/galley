// @vitest-environment jsdom
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

import {
  DEMO_LONG_TITLE,
  useTodoButtonVariants,
} from "@/components/todo/todo-button-variants/todo-button-variants";
import { EMPTY_TODO } from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import { TODO_PANEL_INTRODUCED_KEY } from "@/lib/todo-panel-memory";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { useUiStore } from "@/stores/ui";

import { TodoToggleButton } from "./TodoToggleButton";

/**
 * The 待办 button mounted for real (main chat ticket 104, PRD ruling 150):
 * 丁 reads whether the panel was met once, as Galley starts — meeting it
 * now leaves the word until the next launch — and a capsule whose title
 * is cut writes the row in full in its tooltip. The tooltip is stood in
 * by an attribute (Radix draws its content only while open); today is
 * fixed. TEMP variant switcher (main chat 104): 丁 and the demo are the
 * trial's.
 */

// This machine's storage, empty as the run starts (a Map: the test
// environment has none of its own); set before any module reads it.
vi.hoisted(() => {
  const data = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
});

vi.mock("@/hooks/useDayStamp", () => ({
  useDayStamp: () => new Date(2026, 9, 28).getTime(),
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipLabel: ({ text, children }: { text: string; children: ReactNode }) => (
    <span data-tip={text}>{children}</span>
  ),
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() =>
    useTodoButtonVariants.setState({ demo: "real", pretendNew: false }),
  );
});

function mount() {
  act(() =>
    root.render(
      <CopyProvider language="zh-CN">
        <TodoToggleButton open={false} onToggle={() => {}} />
      </CopyProvider>,
    ),
  );
}

const button = () =>
  host.querySelector<HTMLButtonElement>('[data-role="topbar-todo"]')!;
const word = () => button().textContent?.includes("待办") ?? false;

describe("丁: the word until the panel is met, read once at launch", () => {
  it("keeps the word when the panel is met now; the next launch reads it met", async () => {
    // This run started with the panel never met (an empty storage).
    expect(useTodoButtonVariants.getState().introducedAtLaunch).toBe(false);
    act(() => useTodoButtonVariants.setState({ look: "D" }));
    mount();
    expect(button().dataset.shape).toBe("word");
    expect(word()).toBe(true);

    // Met now: the button, ⌘K, a card's title, the once it opens itself.
    act(() => useUiStore.getState().markTodoPanelIntroduced());
    expect(useUiStore.getState().todoPanelIntroduced).toBe(true);
    expect(window.localStorage.getItem(TODO_PANEL_INTRODUCED_KEY)).toBe("1");
    // Anything that draws the button again leaves the word.
    act(() =>
      useAssistantTodoStore.setState({
        todo: { ...EMPTY_TODO, todayCount: 1 },
      }),
    );
    expect(button().dataset.shape).toBe("word");
    expect(word()).toBe(true);
    expect(useTodoButtonVariants.getState().introducedAtLaunch).toBe(false);

    // The next launch: 甲.
    vi.resetModules();
    const next =
      await import("@/components/todo/todo-button-variants/todo-button-variants");
    expect(next.useTodoButtonVariants.getState().introducedAtLaunch).toBe(true);
  });
});

describe("the capsule's tooltip", () => {
  it("writes the row in full while the title is cut, else what the button opens", () => {
    act(() => useTodoButtonVariants.setState({ look: "E", demo: "long" }));
    mount();
    expect(button().dataset.shape).toBe("capsule");
    const tip = () =>
      host.querySelector("[data-tip]")!.getAttribute("data-tip");
    const title = host.querySelector<HTMLElement>(
      "[data-capsule-body] .truncate",
    )!;
    const widths = (scroll: number, client: number) => {
      Object.defineProperty(title, "scrollWidth", {
        value: scroll,
        configurable: true,
      });
      Object.defineProperty(title, "clientWidth", {
        value: client,
        configurable: true,
      });
    };
    expect(tip()).toBe("待办与备忘 · 今天 1");
    // Its accessible name says the row whether cut or not.
    expect(button().getAttribute("aria-label")).toBe(
      `待办与备忘 · 今天 15:00 · ${DEMO_LONG_TITLE}`,
    );

    widths(360, 120);
    act(() => button().focus());
    expect(tip()).toBe(`待办与备忘 · 今天 15:00 · ${DEMO_LONG_TITLE}`);

    widths(100, 120);
    act(() => {
      button().blur();
      button().focus();
    });
    expect(tip()).toBe("待办与备忘 · 今天 1");
  });
});
