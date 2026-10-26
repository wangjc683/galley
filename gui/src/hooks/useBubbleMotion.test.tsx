// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  TypingBubble,
  type TypingProgress,
} from "@/components/conversation/TypingBubble";
import { useBubbleMotion } from "@/hooks/useBubbleMotion";
import { useTypingBubbleHandoff } from "@/hooks/useTypingBubbleHandoff";
import { scrollDurationMs } from "@/lib/animate-scroll";
import type { TypingBubbleHandoff } from "@/lib/typing-bubble-handoff";
import { EMPTY_MESSAGES, useMessagesStore } from "@/stores/messages";
import {
  installPage,
  opacities,
  transforms,
  uninstallPage,
  type Page,
  type Played,
} from "@/test/bubble-motion-page";

/*
 * The main chat's send and its typing bubble coming and going (ruling
 * 138, ticket 94): what plays, from what it measured, and when it does
 * not. The page is the fake in test/bubble-motion-page.ts; the motion
 * tokens are globals.css's.
 */

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const FAST = 120;
const BASE = 160;
const SLOW = 240;
const POP = "cubic-bezier(0.16, 1, 0.3, 1)";
const FIRM = "cubic-bezier(0.2, 0, 0, 1)";
const EXIT = "cubic-bezier(0.4, 0, 1, 1)";

interface Row {
  id: string;
  side: "user" | "assistant";
  h: number;
}

const A1: Row = { id: "a-1", side: "assistant", h: 60 };
const U1: Row = { id: "u-1", side: "user", h: 43 };
const A2: Row = { id: "a-2", side: "assistant", h: 60 };
const U2: Row = { id: "u-2", side: "user", h: 43 };

interface State {
  rows: Row[];
  typing: boolean;
  live: boolean;
  enabled?: boolean;
  handoff?: TypingBubbleHandoff | null;
  progress?: TypingProgress | null;
  /** Something MainView draws after the conversation (the step-limit
   * tail). */
  tail?: boolean;
}

function Harness({
  rows,
  typing,
  live,
  enabled = true,
  handoff = null,
  progress = null,
  tail = false,
}: State) {
  const scroller = useRef<HTMLDivElement>(null);
  // MainView's order: the hand-off first.
  const typingRef = useTypingBubbleHandoff({
    enabled,
    live,
    scrollContainerRef: scroller,
    handoff,
  });
  useBubbleMotion({
    enabled,
    sessionId: "main",
    live,
    scrollContainerRef: scroller,
  });
  return (
    <div ref={scroller} data-conversation-backdrop="">
      <div data-role="column">
        <div data-role="conversation">
          {rows.map((row) =>
            row.side === "user" ? (
              <div key={row.id} data-row={row.id} data-h={row.h}>
                <div data-role="user-msg" data-message-id={row.id}>
                  {row.id}
                </div>
                <div data-hover-row="">chips</div>
              </div>
            ) : (
              <div key={row.id} data-row={row.id} data-h={row.h}>
                <div data-message-id={row.id}>
                  <div data-role="assistant-bubble">
                    <p>{row.id}</p>
                  </div>
                  <div data-hover-row="">bar</div>
                </div>
              </div>
            ),
          )}
        </div>
        {typing && <TypingBubble ref={typingRef} progress={progress} />}
        {tail && <div data-role="step-limit-tail" data-h="30" />}
      </div>
    </div>
  );
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let page: Page;

function mount(state: State) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Harness {...state} />));
}

function render(state: State, write?: () => void) {
  act(() => {
    write?.();
    root!.render(<Harness {...state} />);
  });
}

/** The store write a send makes: your message in, the run started. */
function send(running = true) {
  const state = useMessagesStore.getState();
  useMessagesStore.setState({
    userSubmitTick: state.userSubmitTick + 1,
    byId: {
      ...state.byId,
      main: { ...EMPTY_MESSAGES, agentRunning: running },
    },
  });
}

/** The store write a stop makes. */
function stop() {
  const state = useMessagesStore.getState();
  useMessagesStore.setState({
    byId: { ...state.byId, main: { ...EMPTY_MESSAGES, agentRunning: false } },
  });
}

const scroller = () =>
  document.querySelector<HTMLElement>("[data-conversation-backdrop]")!;
const column = () => scroller().firstElementChild as HTMLElement;
const rowOf = (id: string) =>
  document.querySelector(`[data-row="${id}"]`) as Element;
const typingRow = () =>
  document.querySelector('[data-role="assistant-typing"]');
const on = (el: Element | null) => (p: Played) => p.el === el;
const slides = () => page.played.filter((p) => transforms(p).length > 0);

beforeEach(() => {
  page = installPage();
  useMessagesStore.setState({
    userSubmitTick: 0,
    byId: { main: { ...EMPTY_MESSAGES } },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  uninstallPage();
  useMessagesStore.setState({ userSubmitTick: 0, byId: {} });
});

describe("a send (S2)", () => {
  it("slides the conversation up from where it stood, on the scroll's numbers", () => {
    page.layout.columnTop = 300;
    mount({ rows: [A1, U1, A2], typing: false, live: false });
    render({ rows: [A1, U1, A2, U2], typing: true, live: true }, send);
    // Nothing yet: it starts in the frame's resize step, after the
    // follow's own last word on where the column ends up.
    expect(page.played).toEqual([]);
    // Your bubble and the typing bubble took 110px: the column is up by
    // that much once the commit and the pin are in.
    page.layout.columnTop = 190;
    page.frame();

    const moved = slides();
    // Everything in the column: the conversation and the typing bubble.
    expect(moved.map((p) => p.el)).toEqual([column().children[0], typingRow()]);
    for (const p of moved) {
      const frames = transforms(p);
      // The first frame is where it was, the last its place.
      expect(frames[0]).toBe("translateY(110px)");
      expect(frames[frames.length - 1]).toBe("translateY(0px)");
      expect(p.options).toEqual({
        duration: scrollDurationMs(110),
        easing: "linear",
      });
    }
    // Clipped while it is moved down: no scroll range from it — and not
    // shrunk by the clip (WebKit drops a clipped flex item's minimum
    // height to 0: the conversation drawn from its first rows, ticket 94).
    expect(column().style.overflow).toBe("clip");
    expect(column().style.flexShrink).toBe("0");
  });

  it("does not slide a send that moved it farther than a scroll animates", () => {
    mount({ rows: [A1, U1, A2], typing: false, live: false });
    render({ rows: [A1, U1, A2, U2], typing: true, live: true }, send);
    // Parked at a long reply's start, 1200px above the bottom: the send
    // lands at the bottom at once, as before ruling 138.
    page.layout.columnTop -= 1200;
    page.frame();
    expect(slides()).toEqual([]);
    expect(column().style.overflow).toBe("");
    // Your bubble still fades in.
    expect(page.played.filter(on(rowOf("u-2")))).toHaveLength(1);
  });

  it("fades your bubble in with it, and the typing bubble once it is in place", () => {
    mount({ rows: [A1, U1, A2], typing: false, live: false });
    render({ rows: [A1, U1, A2, U2], typing: true, live: true }, send);
    page.layout.columnTop -= 110;
    page.frame();

    const yours = page.played.filter(on(rowOf("u-2")));
    expect(yours).toHaveLength(1);
    expect(opacities(yours[0])).toEqual([0, 1]);
    expect(yours[0].options).toEqual({
      duration: BASE,
      delay: 0,
      easing: POP,
      fill: "backwards",
    });
    const typing = page.played.filter(
      (p) => p.el === typingRow() && opacities(p) !== null,
    );
    expect(typing).toHaveLength(1);
    expect(opacities(typing[0])).toEqual([0, 1]);
    expect(typing[0].options).toEqual({
      duration: BASE,
      delay: scrollDurationMs(110),
      easing: POP,
      fill: "backwards",
    });
    // The rows that were there do not fade.
    for (const id of ["a-1", "u-1", "a-2"]) {
      expect(page.played.filter(on(rowOf(id)))).toEqual([]);
    }
  });

  it("ends by itself: animations off, the column's overflow back", async () => {
    mount({ rows: [A1, U1, A2], typing: false, live: false });
    render({ rows: [A1, U1, A2, U2], typing: true, live: true }, send);
    page.layout.columnTop -= 110;
    page.frame();
    for (const p of page.played) p.animation.end();
    await act(async () => {});
    expect(column().style.overflow).toBe("");
    expect(column().style.flexShrink).toBe("");
    for (const p of page.played) expect(p.animation.cancel).toHaveBeenCalled();
  });

  it("only fades under reduced motion: no slide, the typing bubble a beat later", () => {
    page.reduceMotion();
    mount({ rows: [A1, U1, A2], typing: false, live: false });
    render({ rows: [A1, U1, A2, U2], typing: true, live: true }, send);
    page.layout.columnTop -= 110;
    page.frame();
    expect(slides()).toEqual([]);
    expect(column().style.overflow).toBe("");
    const typing = page.played.find(on(typingRow()))!;
    expect(typing.options.delay).toBe(BASE);
    expect(page.played.filter(on(rowOf("u-2")))).toHaveLength(1);
  });

  it("slides only the last 800px of a long way (the far jump)", () => {
    mount({ rows: [A1, U1, A2], typing: false, live: false });
    render({ rows: [A1, U1, A2, U2], typing: true, live: true }, send);
    page.layout.columnTop -= 2000;
    page.frame();
    for (const p of slides()) {
      expect(transforms(p)[0]).toBe("translateY(800px)");
      expect(p.options.duration).toBe(scrollDurationMs(800));
    }
  });

  it("plays only in the main chat, and reads nothing elsewhere", () => {
    mount({ rows: [A1, U1, A2], typing: false, live: false, enabled: false });
    const before = page.reads();
    render(
      { rows: [A1, U1, A2, U2], typing: true, live: true, enabled: false },
      send,
    );
    page.layout.columnTop -= 110;
    page.frame();
    expect(page.played).toEqual([]);
    expect(page.reads()).toBe(before);
  });

  it("does not play for a send into another session", () => {
    mount({ rows: [A1, U1, A2], typing: false, live: false });
    render({ rows: [A1, U1, A2], typing: false, live: false }, () => {
      const state = useMessagesStore.getState();
      useMessagesStore.setState({
        userSubmitTick: state.userSubmitTick + 1,
        byId: { ...state.byId, other: { ...EMPTY_MESSAGES } },
      });
    });
    page.frame();
    expect(page.played).toEqual([]);
  });

  it("does not play on a mount: a switch back, a reload, a cold restore over", () => {
    // Mounted mid-round, the typing bubble up.
    mount({ rows: [A1, U1, A2, U2], typing: true, live: true });
    page.frame();
    render({ rows: [A1, U1, A2, U2], typing: true, live: true });
    page.frame();
    expect(page.played).toEqual([]);
  });

  it("does not play over a cold restore: the round becomes live with its dots already there", () => {
    // Restoring: MainView passes `live: false` while the turns are read
    // back (TypingBubbleFrame), whatever is drawn.
    mount({ rows: [A1, U1], typing: true, live: false });
    page.frame();
    render({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    render({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    expect(page.played).toEqual([]);
  });

  it("puts the one before to its end when another send comes", () => {
    mount({ rows: [A1, U1], typing: false, live: false });
    render({ rows: [A1, U1, U2], typing: true, live: true }, send);
    page.layout.columnTop -= 110;
    page.frame();
    const first = [...page.played];
    expect(first.length).toBeGreaterThan(0);
    render(
      { rows: [A1, U1, U2, { ...U2, id: "u-3" }], typing: true, live: true },
      send,
    );
    for (const p of first) expect(p.animation.cancel).toHaveBeenCalled();
  });
});

describe("the typing bubble going with nothing growing out of it", () => {
  const PROGRESS: TypingProgress = {
    doing: "我对比各队近三季的胜场",
    startedAtMs: null,
    baseMs: 0,
  };

  function stubLoops() {
    const timeline = { currentTime: 1000 };
    Object.defineProperty(document, "timeline", {
      configurable: true,
      value: timeline,
    });
    Element.prototype.getAnimations = function (this: Element) {
      if (this.getAttribute("data-role") === "assistant-typing-dots") {
        return [{ startTime: 400 }] as unknown as Animation[];
      }
      if (this.getAttribute("data-role") === "assistant-progress-doing") {
        return [
          { animationName: "progress-shimmer", startTime: 700 },
        ] as unknown as Animation[];
      }
      return [];
    };
    return timeline;
  }

  it("fades a copy of its row where it stood, its loops in step (a stop)", () => {
    const timeline = stubLoops();
    mount({ rows: [A1, U1], typing: true, live: true, progress: PROGRESS });
    page.frame();
    timeline.currentTime = 1600;
    // Stopped: the run drawn in full takes its place (a new row).
    const run: Row = { id: "s-1", side: "assistant", h: 100 };
    render({ rows: [A1, U1, run], typing: false, live: false }, stop);
    page.frame();

    const layer = document.querySelector("[data-bubble-motion-layer]")!;
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.parentElement).toBe(column());
    const copy = layer.querySelector<HTMLElement>(
      '[data-role="assistant-typing-leaving"]',
    )!;
    expect(copy).not.toBeNull();
    expect(copy.getAttribute("role")).toBeNull();
    expect(copy.textContent).toContain("我对比各队近三季的胜场");
    expect(copy.style.position).toBe("absolute");
    // Where it stood: under the two rows.
    expect(copy.style.top).toBe(`${300 + 60 + 43}px`);
    const fade = page.played.find(on(copy))!;
    expect(opacities(fade)).toEqual([1, 0]);
    expect(fade.options).toEqual({
      duration: FAST,
      delay: 0,
      easing: EXIT,
      fill: "forwards",
    });
    // The loop and the sweep go on where they were: 1200ms and 900ms in.
    const dots = copy.querySelectorAll<HTMLElement>(".live-dot");
    expect(dots[0].style.animationDelay).toBe("-1200ms");
    const sentence = copy.querySelector<HTMLElement>(
      '[data-role="assistant-progress-doing"]',
    )!;
    expect(sentence.style.animationDelay).toBe("-900ms");
    // What took its place comes in from half the dots' fade.
    const successor = page.played.find(on(rowOf("s-1")))!;
    expect(opacities(successor)).toEqual([0, 1]);
    expect(successor.options).toEqual({
      duration: BASE,
      delay: FAST / 2,
      easing: POP,
      fill: "backwards",
    });
  });

  it("slides what moved as rows do, the copy with it", () => {
    mount({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    const run: Row = { id: "s-1", side: "assistant", h: 100 };
    render({ rows: [A1, U1, run], typing: false, live: false }, stop);
    // 贴底: the taller run moved everything up by 33px.
    page.layout.columnTop -= 33;
    page.frame();
    const copy = document.querySelector(
      '[data-role="assistant-typing-leaving"]',
    );
    const moved = slides();
    expect(moved.map((p) => p.el)).toEqual([column().children[0], copy]);
    for (const p of moved) {
      expect(transforms(p)).toEqual(["translateY(33px)", "translateY(0px)"]);
      expect(p.options).toEqual({ duration: SLOW, easing: FIRM });
    }
    expect(column().style.overflow).toBe("clip");
  });

  it("starts the copy from what the send's fade-in had reached", () => {
    mount({ rows: [A1, U1], typing: false, live: false });
    render({ rows: [A1, U1, U2], typing: true, live: true }, send);
    page.layout.columnTop -= 110;
    page.frame();
    const fadeIn = page.played.find(
      (p) => p.el === typingRow() && opacities(p) !== null,
    )!;
    fadeIn.animation.progress = 0.35;
    // Stopped right away.
    render({ rows: [A1, U1, U2], typing: false, live: false }, stop);
    // The send's motion went to its end before React rendered the stop.
    expect(fadeIn.animation.cancel).toHaveBeenCalled();
    page.frame();
    const copy = document.querySelector(
      '[data-role="assistant-typing-leaving"]',
    );
    expect(opacities(page.played.find(on(copy))!)).toEqual([0.35, 0]);
  });

  it("leaves it to the hand-off when a reply grows out of it", () => {
    mount({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    const reply: Row = { id: "a-3", side: "assistant", h: 60 };
    render({
      rows: [A1, U1, reply],
      typing: false,
      live: false,
      handoff: { tick: 1, kind: "reply", messageId: "a-3" },
    });
    page.frame();
    expect(
      document.querySelector('[data-role="assistant-typing-dots-leaving"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-role="assistant-typing-leaving"]'),
    ).toBeNull();
  });

  it("puts a send's motion to its end before the hand-off, whose dots leave from where its fade-in was", () => {
    mount({ rows: [A1, U1], typing: false, live: false });
    render({ rows: [A1, U1, U2], typing: true, live: true }, send);
    page.layout.columnTop -= 110;
    page.frame();
    const sent = [...page.played];
    const fadeIn = sent.find(
      (p) => p.el === typingRow() && opacities(p) !== null,
    )!;
    fadeIn.animation.progress = 0.5;
    // The reply came while the slide was under way.
    const reply: Row = { id: "a-3", side: "assistant", h: 60 };
    render({
      rows: [A1, U1, U2, reply],
      typing: false,
      live: false,
      handoff: { tick: 1, kind: "reply", messageId: "a-3" },
    });
    for (const p of sent) expect(p.animation.cancel).toHaveBeenCalled();
    expect(column().style.overflow).not.toBe("clip");
    const dots = page.played.find(
      (p) => p.role === "assistant-typing-dots-leaving",
    )!;
    expect(opacities(dots)).toEqual([0.5, 0]);
  });

  it("fades only the dots when what took its place cannot be told", () => {
    mount({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    // The last row redrawn (a new element).
    render(
      {
        rows: [
          A1,
          { ...U1, id: "u-1b" },
          { id: "s-1", side: "assistant", h: 80 },
        ],
        typing: false,
        live: false,
      },
      stop,
    );
    page.frame();
    expect(
      document.querySelector('[data-role="assistant-typing-leaving"]'),
    ).not.toBeNull();
    expect(page.played.filter(on(rowOf("s-1")))).toEqual([]);
  });

  it("brings in a new tail with it (the step limit)", () => {
    mount({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    render({ rows: [A1, U1], typing: false, live: false, tail: true }, stop);
    page.frame();
    const tail = document.querySelector('[data-role="step-limit-tail"]');
    expect(opacities(page.played.find(on(tail))!)).toEqual([0, 1]);
  });
});

describe("a round Core woke it for", () => {
  it("fades the typing bubble in as it starts to write, and slides the column up", () => {
    // Live, not writing yet: no dots.
    mount({ rows: [A1, U1, A2], typing: false, live: true });
    page.frame();
    render({ rows: [A1, U1, A2], typing: true, live: true });
    page.layout.columnTop -= 67;
    page.frame();
    const fade = page.played.find(
      (p) => p.el === typingRow() && opacities(p) !== null,
    )!;
    expect(opacities(fade)).toEqual([0, 1]);
    expect(fade.options).toEqual({
      duration: FAST,
      delay: 0,
      easing: POP,
      fill: "backwards",
    });
    for (const p of slides()) {
      expect(transforms(p)[0]).toBe("translateY(67px)");
      expect(p.options.duration).toBe(scrollDurationMs(67));
    }
  });

  it("fades it out where it stood when it stops writing", () => {
    mount({ rows: [A1, U1, A2], typing: true, live: true });
    page.frame();
    render({ rows: [A1, U1, A2], typing: false, live: true });
    page.layout.columnTop += 67;
    page.frame();
    const copy = document.querySelector(
      '[data-role="assistant-typing-leaving"]',
    );
    expect(copy).not.toBeNull();
    // Moved down (the bottom held): slid back, nothing clipped.
    const slid = page.played.find(
      (p) => p.el === copy && transforms(p).length > 0,
    )!;
    expect(transforms(slid)).toEqual(["translateY(-67px)", "translateY(0px)"]);
    expect(column().style.overflow).toBe("");
  });

  it("takes the copies away on unmount", () => {
    mount({ rows: [A1, U1, A2], typing: true, live: true });
    page.frame();
    render({ rows: [A1, U1, A2], typing: false, live: true });
    page.frame();
    const layer = document.querySelector("[data-bubble-motion-layer]")!;
    expect(layer.parentElement).toBe(column());
    act(() => root!.unmount());
    root = null;
    // Taken out of the column, not just gone with it.
    expect(layer.parentElement).toBeNull();
    for (const p of page.played) expect(p.animation.cancel).toHaveBeenCalled();
  });
});
