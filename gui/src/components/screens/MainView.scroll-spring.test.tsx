// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { forwardRef, type ReactNode } from "react";
import { flushSync } from "react-dom";
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

import { LocalFilesContext } from "@/lib/local-files";
import { EMPTY_MESSAGES, useMessagesStore } from "@/stores/messages";
import { useSessionsStore } from "@/stores/sessions";
import { useSubtasksStore } from "@/stores/subtasks";
import { getTauriMocks } from "@/test/setup";
import type { AgentTurn, Turn } from "@/types/conversation";

import { MainView } from "./MainView";

/*
 * The scroll spring (main chat PRD ruling 201, ticket 150) is the main
 * chat's only: mounted for real (jsdom), a scroll of the person's — a
 * wheel tick, then the scroller moving — lags the main chat's rows and
 * leaves the workbench's (a subtask, the external runtime's sessions:
 * every conversation that is not the main chat) exactly as they were.
 */

vi.mock("@tauri-apps/api/core", async () => {
  const { getTauriMocks } = await import("@/test/setup");
  return { invoke: getTauriMocks().invoke, isTauri: () => false };
});

vi.mock("@/components/conversation/Composer", () => ({
  Composer: forwardRef<HTMLDivElement>(function Composer(_props, ref) {
    return <div ref={ref} data-role="composer-stand-in" />;
  }),
}));

vi.mock("@/components/conversation/MessageMenu", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/conversation/MessageMenu")
    >();
  return {
    ...actual,
    MessageContextMenu: ({ children }: { children: ReactNode }) => children,
  };
});

// ---- A layout for jsdom: the scroller 600px high over 3000px; each row
// of the conversation 40px high, 60px apart from 100px down the content.

const LAYOUT = { scrollHeight: 3000, clientHeight: 600 };
/** The engine's own scroll position, under any accessor on the element. */
const scrollTops = new WeakMap<Element, number>();
const isScroller = (el: Element) =>
  el.hasAttribute("data-conversation-backdrop");
const scroller = () =>
  document.querySelector<HTMLElement>("[data-conversation-backdrop]")!;
const saved: [object, string, PropertyDescriptor | undefined][] = [];

function stub(target: object, name: string, descriptor: PropertyDescriptor) {
  saved.push([target, name, Object.getOwnPropertyDescriptor(target, name)]);
  Object.defineProperty(target, name, { configurable: true, ...descriptor });
}

function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 700,
    height,
    width: 700,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function translateOf(el: Element): number {
  const value = (el as HTMLElement).style?.getPropertyValue("translate");
  return value ? Number.parseFloat(value.split(" ")[1] ?? "0") : 0;
}

/** The conversation's row `el` is in, and its index. */
function rowOf(el: Element): [Element, number] | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const parent = node.parentElement;
    if (parent?.getAttribute("data-role") === "conversation") {
      return [node, Array.from(parent.children).indexOf(node)];
    }
  }
  return null;
}

beforeAll(() => {
  stub(Element.prototype, "scrollTop", {
    get(this: Element) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      const max = isScroller(this)
        ? LAYOUT.scrollHeight - LAYOUT.clientHeight
        : 0;
      scrollTops.set(this, Math.max(0, Math.min(max, value)));
    },
  });
  stub(Element.prototype, "scrollHeight", {
    get(this: Element) {
      return isScroller(this) ? LAYOUT.scrollHeight : 0;
    },
  });
  stub(Element.prototype, "clientHeight", {
    get(this: Element) {
      return isScroller(this) ? LAYOUT.clientHeight : 0;
    },
  });
  stub(Element.prototype, "getBoundingClientRect", {
    value(this: Element) {
      if (isScroller(this)) return rect(0, LAYOUT.clientHeight);
      const row = rowOf(this);
      if (!row) return rect(0, 0);
      const [node, index] = row;
      return rect(100 + index * 60 + translateOf(node), 40);
    },
  });
  class ResizeObserverStandIn {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  stub(globalThis, "ResizeObserver", { value: ResizeObserverStandIn });
});

afterAll(() => {
  for (const [target, name, descriptor] of saved.reverse()) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else delete (target as Record<string, unknown>)[name];
  }
});

function answer(text: string, index: number): AgentTurn {
  return {
    role: "agent",
    turnIndex: index,
    finalAnswer: text,
    tools: [
      {
        id: `t-${index}`,
        name: "no_tool",
        status: "success-historical",
        args: {},
      },
    ],
    telemetry: { elapsedMs: 9_000 },
    messageId: `a-${index}`,
  };
}

function conversation(rounds: number): Turn[] {
  const turns: Turn[] = [];
  for (let i = 1; i <= rounds; i++) {
    turns.push({ role: "user", content: `问题 ${i}`, messageId: `u-${i}` });
    turns.push(answer(`回答 ${i}`, i));
  }
  return turns;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getTauriMocks().invoke.mockImplementation(async (command: string) =>
    command === "list_scheduled_tasks" || command === "list_subtask_dispatches"
      ? []
      : undefined,
  );
  useSubtasksStore.setState(useSubtasksStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  root.unmount();
  container.remove();
  useSessionsStore.setState({ activeSessionId: undefined });
  useMessagesStore.setState({ byId: {} });
});

function open(isMainChat: boolean, turns: Turn[]): void {
  const id = isMainChat ? "main" : "work";
  useSessionsStore.setState({ activeSessionId: id });
  useMessagesStore.setState({ byId: { [id]: { ...EMPTY_MESSAGES, turns } } });
  flushSync(() => {
    root.render(
      <Tooltip.Provider>
        <LocalFilesContext.Provider value={() => undefined}>
          <MainView
            key={id}
            turns={turns}
            llmDisplayName="model"
            activeSessionId={id}
            isMainChat={isMainChat}
          />
        </LocalFilesContext.Provider>
      </Tooltip.Provider>,
    );
  });
}

async function frames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

/** The person scrolls up a few times with the wheel over the top of the
 * conversation: a tick, the engine moving the scroller, its scroll
 * event, a frame. */
async function scrollByWheel(): Promise<void> {
  const el = scroller();
  for (let i = 0; i < 3; i++) {
    el.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: -20, clientY: 20 }),
    );
    scrollTops.set(el, (scrollTops.get(el) ?? 0) - 20);
    el.dispatchEvent(new Event("scroll"));
    await frames(1);
  }
}

function rows(): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-role="conversation"] > *'),
  );
}

describe("the scroll spring is the main chat's only (ruling 201 第 5 条)", () => {
  it("lags the main chat's rows behind the person's scroll", async () => {
    open(true, conversation(6));
    await frames(3);
    await scrollByWheel();
    const lagged = rows().map(translateOf);
    expect(Math.min(...lagged)).toBeLessThan(0);
    for (const x of lagged) expect(Math.abs(x)).toBeLessThanOrEqual(6);
  });

  it("leaves the workbench's rows where they are, not a style added", async () => {
    open(false, conversation(6));
    await frames(3);
    const before = rows().map((row) => row.getAttribute("style"));
    await scrollByWheel();
    expect(rows().map((row) => row.getAttribute("style"))).toEqual(before);
    expect(rows().every((row) => translateOf(row) === 0)).toBe(true);
    expect(container.querySelector('[style*="will-change"]')).toBeNull();
    // No accessor on its scroller either: its scrollTop is the engine's.
    expect(Object.getOwnPropertyDescriptor(scroller(), "scrollTop")).toBe(
      undefined,
    );
  });
});
