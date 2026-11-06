// @vitest-environment jsdom
import { act, useRef } from "react";
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

import { TypingBubble } from "@/components/conversation/TypingBubble";
import { useBubbleMotion } from "@/hooks/useBubbleMotion";
import { useTypingBubbleHandoff } from "@/hooks/useTypingBubbleHandoff";
import { bubbleMotionRunning } from "@/lib/bubble-motion";
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
 * A line told mid-run growing in above the typing bubble (main chat PRD
 * ruling 200, ticket 149): from a typing bubble's box at its own top-left
 * corner, as a woken round's reply whose dots were not up; the typing
 * bubble stays and is pushed down on the growth's curve; under reduced
 * motion it only fades in; anything after it puts it to its end first.
 * The page is the fake in test/bubble-motion-page.ts (each row as high
 * as its `data-h`, the typing bubble's row 67); the tokens are
 * globals.css's.
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

/** The typing bubble's tinted box at the standard size (54 × 43.25px),
 * and a reply bubble's width: the fake page gives every box the row's
 * height and 700px. */
const TYPING_W = 54;
const TYPING_H = 43.25;
const BUBBLE_W = 300;
/** The bubble's corner as jsdom computes it (no stylesheet). */
const R = "0";

interface Row {
  id: string;
  side: "user" | "assistant";
  h: number;
}

const A1: Row = { id: "a-1", side: "assistant", h: 60 };
const U1: Row = { id: "u-1", side: "user", h: 43 };
/** Two lines it told you mid-run. */
const T1: Row = { id: "t-1", side: "assistant", h: 67.5 };
const T2: Row = { id: "t-2", side: "assistant", h: 43.25 };
const A3: Row = { id: "a-3", side: "assistant", h: 60 };
const U2: Row = { id: "u-2", side: "user", h: 43 };

interface State {
  rows: Row[];
  typing: boolean;
  live: boolean;
  enabled?: boolean;
  handoff?: TypingBubbleHandoff | null;
}

function Harness({
  rows,
  typing,
  live,
  enabled = true,
  handoff = null,
}: State) {
  const scroller = useRef<HTMLDivElement>(null);
  // MainView's order: the hand-off first, then the bubble motions.
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
              </div>
            ) : (
              <div key={row.id} data-row={row.id} data-h={row.h}>
                <div data-message-id={row.id}>
                  <div data-role="assistant-bubble">
                    <p>{row.id}</p>
                    {/* Its action row beside it, hidden until hovered
                        (ruling 199: the bubble's own child). */}
                    <div data-role="actions" style={{ opacity: 0 }}>
                      <button type="button">copy</button>
                    </div>
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
        {typing && <TypingBubble ref={typingRef} />}
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

/** The store write a send makes: your words in while it works. */
function send() {
  const state = useMessagesStore.getState();
  useMessagesStore.setState({
    userSubmitTick: state.userSubmitTick + 1,
    byId: {
      ...state.byId,
      main: { ...EMPTY_MESSAGES, agentRunning: true },
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
const conversation = () =>
  document.querySelector('[data-role="conversation"]') as Element;
const typingRow = () =>
  document.querySelector('[data-role="assistant-typing"]');
const bubbleOf = (id: string) =>
  document.querySelector(
    `[data-message-id="${id}"] [data-role="assistant-bubble"]`,
  ) as Element;
const on = (el: Element | null) => (p: Played) => p.el === el;
const clipOf = (p: Played) =>
  p.keyframes && !Array.isArray(p.keyframes)
    ? (p.keyframes as PropertyIndexedKeyframes).clipPath
    : undefined;
const told = (id: string, tick = 1): TypingBubbleHandoff => ({
  tick,
  kind: "told",
  messageId: id,
});

beforeEach(() => {
  page = installPage();
  // The typing bubble's tinted box and a bubble's width, on the fake
  // page's rows.
  const spy = vi.mocked(Element.prototype.getBoundingClientRect);
  const fake = spy.getMockImplementation()!;
  spy.mockImplementation(function (this: Element) {
    const box = fake.call(this);
    const role = this.getAttribute("data-role");
    const size =
      role === "assistant-typing-bubble"
        ? { width: TYPING_W, height: TYPING_H }
        : role === "assistant-bubble"
          ? { width: BUBBLE_W, height: box.height }
          : null;
    if (!size) return box;
    return {
      ...box,
      ...size,
      right: box.left + size.width,
      bottom: box.top + size.height,
    };
  });
  useMessagesStore.setState({
    userSubmitTick: 0,
    byId: { main: { ...EMPTY_MESSAGES, agentRunning: true } },
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

/** Your words, the typing bubble under them, and the commit where the
 * first line it told you lands above it. */
function landFirstLine() {
  mount({ rows: [A1, U1], typing: true, live: true });
  page.frame();
  render({
    rows: [A1, U1, T1],
    typing: true,
    live: true,
    handoff: told("t-1"),
  });
}

describe("a line told mid-run grows in (ticket 149)", () => {
  it("from a typing bubble's box at its own top-left corner, on --motion-slow and --ease-pop", () => {
    landFirstLine();
    const clip = page.played.find(on(bubbleOf("t-1")))!;
    // Two lines: it opens right and down from the dots' box.
    expect(clipOf(clip)).toEqual([
      `inset(0px ${BUBBLE_W - TYPING_W}px ${T1.h - TYPING_H}px 0px round ${R})`,
      `inset(0px 0px 0px 0px round ${R})`,
    ]);
    expect(clip.options).toEqual({ duration: SLOW, easing: POP });
  });

  it("brings its words and the action row beside them in on the hand-off's segment", () => {
    landFirstLine();
    const bubble = bubbleOf("t-1");
    const words = bubble.querySelector("p");
    const chip = bubble.querySelector("button");
    const comeIn = {
      duration: SLOW - FAST / 2,
      delay: FAST / 2,
      easing: POP,
      fill: "backwards",
    };
    for (const el of [words, chip]) {
      const fade = page.played.find(on(el))!;
      expect(opacities(fade)).toEqual([0, 1]);
      expect(fade.options).toEqual(comeIn);
    }
    // The row's own opacity is its hover reveal: left alone.
    expect(
      page.played.find(on(bubble.querySelector('[data-role="actions"]'))),
    ).toBeUndefined();
  });

  it("leaves the typing bubble where it was: no copy, no fade, its row let down on the same curve", () => {
    landFirstLine();
    expect(
      document.querySelector('[data-role="assistant-typing-dots-leaving"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-role="assistant-typing-leaving"]'),
    ).toBeNull();
    const row = typingRow()!;
    const own = page.played.filter((p) => p.el === row || row.contains(p.el));
    expect(own.map(opacities).filter((o) => o !== null)).toEqual([]);
    // Pushed down by the line: held where it was, let down with the
    // growth (the follow scrolls the rest up on the same clock).
    expect(own.map(transforms)).toEqual([[`translateY(-${T1.h}px)`, "none"]]);
    expect(own[0].options).toEqual({ duration: SLOW, easing: POP });
    // Scrolling, the conversation is not held and the column not clipped.
    expect(page.played.find(on(conversation()))).toBeUndefined();
    expect(column().style.overflow).not.toBe("clip");
  });

  it("贴底 (shorter than the viewport): lifts the conversation with the column, and the dots do not move", () => {
    mount({ rows: [A1, U1], typing: true, live: true });
    page.frame();
    // The column moved up at once by the line.
    page.layout.columnTop -= T1.h;
    render({
      rows: [A1, U1, T1],
      typing: true,
      live: true,
      handoff: told("t-1"),
    });
    const lift = page.played.find(on(conversation()))!;
    expect(transforms(lift)).toEqual([`translateY(${T1.h}px)`, "none"]);
    expect(lift.options).toEqual({ duration: SLOW, easing: POP });
    expect(page.played.find(on(typingRow()))).toBeUndefined();
    expect(column().style.overflow).toBe("clip");
    expect(column().style.flexShrink).toBe("0");
    // Ends by itself: the column's style back, nothing running.
    for (const p of page.played) p.animation.end();
    return Promise.resolve().then(async () => {
      await Promise.resolve();
      expect(column().style.overflow).toBe("");
      expect(column().style.flexShrink).toBe("");
      expect(bubbleMotionRunning(scroller())).toBe(false);
    });
  });

  it("grows the same with no typing bubble up (a woken round's dots down), pushing nothing", () => {
    mount({ rows: [A1, U1], typing: false, live: true });
    page.frame();
    render({
      rows: [A1, U1, T1],
      typing: false,
      live: true,
      handoff: told("t-1"),
    });
    expect(clipOf(page.played.find(on(bubbleOf("t-1")))!)).toBeDefined();
    expect(page.played.filter((p) => transforms(p).length > 0)).toEqual([]);
  });

  it("only fades in under reduced motion: whole, --motion-base, nothing grows or moves", () => {
    page.reduceMotion();
    landFirstLine();
    const bubble = bubbleOf("t-1");
    const fade = page.played.find(on(bubble))!;
    expect(opacities(fade)).toEqual([0, 1]);
    expect(fade.options).toEqual({
      duration: BASE,
      delay: 0,
      easing: POP,
      fill: "backwards",
    });
    expect(page.played.some((p) => clipOf(p) !== undefined)).toBe(false);
    expect(page.played.filter((p) => transforms(p).length > 0)).toEqual([]);
    expect(page.played.find(on(bubble.querySelector("p")))).toBeUndefined();
  });

  it("plays only in the main chat", () => {
    mount({ rows: [A1, U1], typing: true, live: true, enabled: false });
    render({
      rows: [A1, U1, T1],
      typing: true,
      live: true,
      enabled: false,
      handoff: told("t-1"),
    });
    expect(page.played).toEqual([]);
  });
});

describe("a line told mid-run, beside what comes after it", () => {
  it("is one of ruling 138's motions while it plays", () => {
    landFirstLine();
    expect(bubbleMotionRunning(scroller())).toBe(true);
  });

  it("puts the line before to its end when the next comes, then grows that one", () => {
    landFirstLine();
    const first = [...page.played];
    page.frame();
    render({
      rows: [A1, U1, T1, T2],
      typing: true,
      live: true,
      handoff: told("t-2", 2),
    });
    for (const p of first) expect(p.animation.cancel).toHaveBeenCalled();
    const clip = page.played.find(on(bubbleOf("t-2")))!;
    expect(clipOf(clip)).toEqual([
      `inset(0px ${BUBBLE_W - TYPING_W}px 0px 0px round ${R})`,
      `inset(0px 0px 0px 0px round ${R})`,
    ]);
    // The dots pushed by this one only.
    const pushes = page.played
      .filter((p) => p.el === typingRow() && !first.includes(p))
      .map(transforms);
    expect(pushes).toEqual([[`translateY(-${T2.h}px)`, "none"]]);
  });

  it("puts it to its end when you send while it grows", () => {
    landFirstLine();
    const grown = [...page.played];
    render({ rows: [A1, U1, T1, U2], typing: true, live: true }, send);
    for (const p of grown) expect(p.animation.cancel).toHaveBeenCalled();
  });

  it("puts it to its end on a stop", () => {
    landFirstLine();
    const grown = [...page.played];
    act(() => stop());
    for (const p of grown) expect(p.animation.cancel).toHaveBeenCalled();
    expect(bubbleMotionRunning(scroller())).toBe(false);
  });

  it("puts it to its end before the reply grows out of the dots", () => {
    landFirstLine();
    const grown = [...page.played];
    page.frame();
    render({
      rows: [A1, U1, T1, A3],
      typing: false,
      live: false,
      handoff: { tick: 2, kind: "reply", messageId: "a-3" },
    });
    for (const p of grown) expect(p.animation.cancel).toHaveBeenCalled();
    // The hand-off as ever: the dots leave as a copy where they stood.
    expect(
      document.querySelector('[data-role="assistant-typing-dots-leaving"]'),
    ).not.toBeNull();
    expect(clipOf(page.played.find(on(bubbleOf("a-3")))!)).toBeDefined();
  });
});
