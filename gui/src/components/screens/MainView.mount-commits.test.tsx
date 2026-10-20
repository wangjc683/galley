// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import {
  forwardRef,
  Profiler,
  type ProfilerOnRenderCallback,
  type ReactNode,
} from "react";
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

import { zhCopy } from "@/i18n/locales/zh";
import { LocalFilesContext } from "@/lib/local-files";
import { EMPTY_MESSAGES, useMessagesStore } from "@/stores/messages";
import { useSessionsStore } from "@/stores/sessions";
import { useSubtasksStore } from "@/stores/subtasks";
import { getTauriMocks } from "@/test/setup";
import type { AgentTurn, Turn } from "@/types/conversation";

import { MainView } from "./MainView";

/*
 * Switching to the main chat (ticket 72): MainView mounts afresh (App keys
 * it by session), and every commit after that mount is the conversation
 * drawn again before the first frame — measured in the app at two or
 * three, 10–12ms each. This mounts it for real (jsdom, a sync render as
 * the press that opens it) under a Profiler and counts what commits after
 * the mount once the frames, timers and reads it starts have run.
 *
 * Left out on purpose, each one Radix root that is not per message and
 * re-renders only itself when it sets its state on mounting: the composer
 * (its model, effort and add menus; the workbench's too), the
 * conversation's one right-click menu, and the time lines' tooltips
 * (one per break, both conversations) — the fixture has no breaks.
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

// ---- A layout for jsdom (it has none) -----------------------------------
//
// The scroller is 600px high over 3000px of conversation, and every row
// in it sits 2000px down the content: the last reply starts 1000px above
// the bottom, taller than the viewport, which is where 贴底's follow limit
// parks short of the bottom.

const LAYOUT = { scrollHeight: 3000, clientHeight: 600, rowsTop: 2000 };
const scrollTops = new WeakMap<Element, number>();
const isScroller = (el: Element) =>
  el.hasAttribute("data-conversation-backdrop");
const scroller = () =>
  document.querySelector<HTMLElement>("[data-conversation-backdrop]");
const saved: [object, string, PropertyDescriptor | undefined][] = [];

function stub(target: object, name: string, descriptor: PropertyDescriptor) {
  saved.push([target, name, Object.getOwnPropertyDescriptor(target, name)]);
  Object.defineProperty(target, name, { configurable: true, ...descriptor });
}

function rect(top: number, height: number, width: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: width,
    height,
    width,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
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
      if (isScroller(this)) return rect(0, LAYOUT.clientHeight, 760);
      return rect(LAYOUT.rowsTop - (scroller()?.scrollTop ?? 0), 24, 700);
    },
  });
  // Observing begins with a report of the box as it is, a frame later.
  class ResizeObserverStandIn {
    private targets = new Set<Element>();
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.targets.add(target);
      requestAnimationFrame(() => {
        if (!this.targets.has(target)) return;
        const { width, height } = target.getBoundingClientRect();
        const entry = {
          target,
          borderBoxSize: [{ inlineSize: width, blockSize: height }],
        };
        this.callback(
          [entry as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      });
    }
    unobserve(target: Element) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
    }
  }
  stub(globalThis, "ResizeObserver", { value: ResizeObserverStandIn });
});

afterAll(() => {
  for (const [target, name, descriptor] of saved.reverse()) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else delete (target as Record<string, unknown>)[name];
  }
});

// ---- The main chat --------------------------------------------------------

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

/** The greeting and `rounds` rounds of a question and its answer. */
function conversation(rounds: number): Turn[] {
  const turns: Turn[] = [
    {
      role: "agent",
      turnIndex: -1,
      finalAnswer: "你好。以后有什么事，直接在这里跟我说就行。",
      tools: [],
      greeting: true,
      messageId: "a-greeting",
    },
  ];
  for (let i = 1; i <= rounds; i++) {
    turns.push({ role: "user", content: `问题 ${i}`, messageId: `u-${i}` });
    turns.push(answer(`回答 ${i}`, i));
  }
  return turns;
}

let container: HTMLDivElement;
let root: Root;
let commits: string[] = [];
const onRender: ProfilerOnRenderCallback = (_id, phase) => {
  commits.push(phase);
};

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
  commits = [];
});

afterEach(() => {
  root.unmount();
  container.remove();
  useSessionsStore.setState({ activeSessionId: undefined });
  useMessagesStore.setState({ byId: {} });
});

/** Opens the main chat the way a press does (a sync render). */
function openMainChat(turns: Turn[]): void {
  useSessionsStore.setState({ activeSessionId: "main" });
  useMessagesStore.setState({ byId: { main: { ...EMPTY_MESSAGES, turns } } });
  flushSync(() => {
    root.render(
      <Tooltip.Provider>
        <LocalFilesContext.Provider value={() => undefined}>
          <Profiler id="main-view" onRender={onRender}>
            <MainView
              key="main"
              turns={turns}
              llmDisplayName="model"
              activeSessionId="main"
              isMainChat
            />
          </Profiler>
        </LocalFilesContext.Provider>
      </Tooltip.Provider>,
    );
  });
}

/** Lets what the mount started run: frames, timers, reads. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/** Enters `element` with the pointer (React's mouseenter is mouseover). */
function hover(element: Element): void {
  element.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }),
  );
}

function press(element: Element): void {
  element.dispatchEvent(
    new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  );
}

const MORE = `button[aria-label="${zhCopy.common.more}"]`;
const MENU = '[data-role="message-menu"]';

describe("switching to the main chat (ticket 72)", () => {
  it("commits once: nothing the mount starts draws the conversation again", async () => {
    openMainChat(conversation(12));
    await settle();
    expect(commits).toEqual(["mount"]);
    // 贴底: it opened on its bottom and stays there, the button away.
    expect(scroller()!.scrollTop).toBe(
      LAYOUT.scrollHeight - LAYOUT.clientHeight,
    );
    expect(
      container.querySelector(
        `button[aria-label="${zhCopy.conversation.scrollLatest}"]`,
      ),
    ).toBeNull();
  });

  it("mounts the chips' tooltips and ⋯ menu on the row's first hover", async () => {
    openMainChat(conversation(3));
    await settle();
    // Before any hover no chip is a Radix trigger (they mark theirs).
    expect(
      container.querySelectorAll(
        '[data-role="conversation"] button[data-state]',
      ),
    ).toHaveLength(0);
    // Your message's row: copy · quote · ⋯ come with its hover.
    const userRow = container.querySelector(
      '[data-message-id="u-2"]',
    )!.parentElement!;
    hover(userRow);
    await settle();
    expect(userRow.querySelectorAll("button[data-state]")).toHaveLength(3);
    // The reply's bar: copy · quote · save · ⋯ with the answer's.
    const reply = container.querySelector('[data-message-id="a-2"]')!;
    expect(reply.querySelectorAll("button[data-state]")).toHaveLength(0);
    hover(reply);
    await settle();
    expect(reply.querySelectorAll("button[data-state]")).toHaveLength(4);
    // …and its ⋯ opens the menu, as before.
    press(reply.querySelector(MORE)!);
    await settle();
    expect(document.querySelector(MENU)?.textContent).toContain(
      zhCopy.conversation.deleteMessage.menuItem,
    );
  });

  it("opens the ⋯ menu pressed before its row's hover mounted it", async () => {
    openMainChat(conversation(3));
    await settle();
    const more = container.querySelector(`[data-message-id="a-3"] ${MORE}`)!;
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    press(more);
    await settle();
    expect(document.querySelector(MENU)?.textContent).toContain(
      zhCopy.conversation.deleteMessage.menuItem,
    );
  });
});
