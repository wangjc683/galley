// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { animateScroll } from "@/lib/animate-scroll";
import { assistantFollowBottom } from "@/lib/assistant-conversation";
import { captureRemoval } from "@/lib/bubble-motion-play";
import {
  MAX_LAG_PX,
  MAX_NEIGHBOUR_STEP_PX,
  SETTLE_MS,
  bubbleSpringShift,
  clearBubbleSpringStyle,
} from "@/lib/bubble-spring";
import {
  attachBubbleSpring,
  bubbleSpringScrolling,
  kickBubbleRow,
} from "@/lib/bubble-spring-play";
import { userMsgParkOffset } from "@/lib/conversation-anchor";
import { captureScrollAnchor, scrollAnchorDrift } from "@/lib/scroll-anchor";
import { stubFrames } from "@/test/scroll-frames";

/*
 * A page for the scroll spring: the scroller (600px, at the window's
 * top) over a column of rows 40px high, 10px apart, from 100px down the
 * content, then the typing bubble. Boxes move with the scroll and with
 * the `translate` on a row, as the engine draws them; jsdom has neither.
 * The person scrolls by setting the engine's `scrollTop` (the prototype's
 * setter, not the app's accessor) and the scroll event that follows.
 */

const ROW_H = 40;
const GAP = 10;
const FIRST_TOP = 100;
const VIEW_H = 600;
const ROWS = 30;

let frames: ReturnType<typeof stubFrames>;
let container: HTMLDivElement;
let rows: HTMLElement[];
let detach: () => void;
const engineScrollTop = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollTop",
)!;

function translateOf(el: Element): number {
  const value = (el as HTMLElement).style?.getPropertyValue("translate");
  if (!value) return 0;
  return Number.parseFloat(value.split(" ")[1] ?? "0");
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

/** A row's place in the content: rows of the conversation, then the
 * column's own (the typing bubble), stacked. */
function contentTopOf(row: Element): number {
  const all = [
    ...Array.from(container.querySelectorAll('[data-role="conversation"] > *')),
    ...Array.from(container.firstElementChild!.children).filter(
      (c) => c.getAttribute("data-role") !== "conversation",
    ),
  ];
  return FIRST_TOP + all.indexOf(row) * (ROW_H + GAP);
}

function rowOf(el: Element): Element | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const parent = node.parentElement;
    if (
      parent?.getAttribute("data-role") === "conversation" ||
      parent === container.firstElementChild
    ) {
      return node;
    }
  }
  return null;
}

function build(extra?: (root: HTMLElement) => void): void {
  container = document.createElement("div");
  container.setAttribute("data-conversation-backdrop", "");
  const column = document.createElement("div");
  const root = document.createElement("div");
  root.setAttribute("data-role", "conversation");
  for (let i = 0; i < ROWS; i++) {
    const row = document.createElement("div");
    row.setAttribute("data-row", String(i));
    const bubble = document.createElement("div");
    bubble.setAttribute("data-role", i % 2 ? "assistant-bubble" : "user-msg");
    row.append(bubble);
    root.append(row);
  }
  extra?.(root);
  const typing = document.createElement("div");
  typing.setAttribute("data-role", "assistant-typing");
  column.append(root, typing);
  container.append(column);
  document.body.append(container);
  rows = Array.from(root.children) as HTMLElement[];
}

/** The rules that do not depend on how fast you scroll (anchor,
 * neighbours, band, settling, whose scroll) at a gain of 1: each frame's
 * whole move, so a few test frames show them. The real gain has its own
 * test ("follows your speed"). */
const WHOLE_MOVE = { lagGain: 1 };

function scrollTopNow(): number {
  return engineScrollTop.get!.call(container) as number;
}

/** The person moves the conversation by `by` px (the engine's own
 * position, then its scroll event). */
function userScroll(by: number): void {
  engineScrollTop.set!.call(container, scrollTopNow() + by);
  container.dispatchEvent(new Event("scroll"));
}

function wheel(clientY = 300): void {
  container.dispatchEvent(
    new WheelEvent("wheel", { bubbles: true, deltaY: 10, clientY }),
  );
}

/** The person scrolls with the wheel over the conversation at
 * `clientY`: `ticks` frames of `by` px. */
function wheelScroll(by: number, ticks = 5, clientY = 300): void {
  for (let i = 0; i < ticks; i++) {
    wheel(clientY);
    userScroll(by);
    frames.tick();
  }
}

function offsets(): number[] {
  return rows.map(translateOf);
}

beforeEach(() => {
  frames = stubFrames();
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this === container) return rect(0, VIEW_H);
      const row = rowOf(this);
      if (!row) return rect(0, 0);
      return rect(contentTopOf(row) - scrollTopNow() + translateOf(row), ROW_H);
    },
  );
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(
    function (this: Element) {
      return this === container ? VIEW_H : 0;
    },
  );
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(
    function (this: Element) {
      return this === container ? FIRST_TOP + 40 * (ROW_H + GAP) : 0;
    },
  );
});

afterEach(() => {
  detach?.();
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the person's scroll (ruling 201 第 2 条)", () => {
  it("lags the rows far from the pointer, not the one under it, and lets them back", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    // The pointer over row 4 (100 + 4 × 50 = 300 … 340); 15px of scroll
    // leaves it under the pointer.
    wheelScroll(3, 5, 320);
    const during = offsets();
    expect(during[4]).toBe(0);
    // Its neighbours a little, far down the viewport the most: lower,
    // by up to 6px.
    expect(during[5]).toBeGreaterThan(0);
    expect(during[5]).toBeLessThan(during[11]);
    expect(during[0]).toBeGreaterThan(0);
    expect(Math.max(...during)).toBeGreaterThan(3);
    for (const x of during) expect(Math.abs(x)).toBeLessThanOrEqual(MAX_LAG_PX);
    // Two rows next to each other at most 2px apart, through the band
    // the spring moves (the viewport and 160px beyond: rows 0 … 13 here;
    // past it, off screen, rows stay put).
    for (let i = 1; i <= 13; i++) {
      expect(Math.abs(during[i] - during[i - 1])).toBeLessThanOrEqual(
        MAX_NEIGHBOUR_STEP_PX,
      );
    }
    expect(during[14]).toBe(0);
    // Stopped: within 0.5px by 350ms…
    let t = 0;
    while (t < SETTLE_MS) {
      frames.tick(16);
      t += 16;
    }
    frames.tick(16);
    for (const x of offsets()) expect(Math.abs(x)).toBeLessThanOrEqual(0.5);
    // …and once back, nothing is left: no style, no layer, no frame.
    frames.runOut();
    expect(frames.pending()).toBe(0);
    for (const row of rows) {
      expect(row.getAttribute("style") ?? "").toBe("");
      expect(bubbleSpringShift(row)).toBe(0);
    }
  });

  it("lags the other way scrolling up", () => {
    build();
    engineScrollTop.set!.call(container, 400);
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    wheelScroll(-30, 3, 50);
    expect(Math.min(...offsets())).toBeLessThan(-3);
    expect(Math.max(...offsets())).toBeLessThanOrEqual(0);
  });

  it("keeps a reply and its process card together", () => {
    build((root) => {
      const card = document.createElement("div");
      card.setAttribute("data-role", "assistant-process-card");
      root.insertBefore(card, root.children[9]);
    });
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    wheelScroll(30, 3, 60);
    const card = container.querySelector(
      '[data-role="assistant-process-card"]',
    )!;
    const reply = card.previousElementSibling!;
    expect(translateOf(reply)).not.toBe(0);
    expect(translateOf(card)).toBe(translateOf(reply));
  });

  it("moves only the rows in and near the viewport", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    wheelScroll(20, 3, 60);
    // 60px scrolled: the viewport shows content 60 … 660, the band 160px
    // beyond. Row 25 starts at 1350.
    expect(translateOf(rows[25])).toBe(0);
    expect(translateOf(rows[29])).toBe(0);
    expect(rows[25].getAttribute("style")).toBeNull();
  });

  it("lifts rows into their own layer only while they are off their place", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    wheelScroll(30, 2, 60);
    const moved = rows.filter((row) => translateOf(row) !== 0);
    expect(moved.length).toBeGreaterThan(0);
    for (const row of moved) {
      expect(row.style.getPropertyValue("will-change")).toBe("transform");
    }
    frames.runOut();
    for (const row of rows) {
      expect(row.style.getPropertyValue("will-change")).toBe("");
    }
  });

  it("takes the viewport's middle for a scroll by keys", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    for (let i = 0; i < 3; i++) {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }),
      );
      userScroll(5);
      frames.tick();
    }
    // The middle (300) is on row 4 all along (300 … 340, 15px up): it
    // stays, wherever the pointer is; the first rows and the last ones
    // lag.
    const x = offsets();
    expect(x[4]).toBe(0);
    expect(x[0]).toBeGreaterThan(1);
    expect(x[12]).toBeGreaterThan(1);
  });

  it("takes the scrollbar held as the person's, from the middle", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    container.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    for (let i = 0; i < 3; i++) {
      userScroll(30);
      frames.tick();
    }
    expect(offsets()[0]).toBeGreaterThan(1);
    window.dispatchEvent(new PointerEvent("pointerup"));
  });

  it("hears a touch", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    for (let i = 0; i < 3; i++) {
      const touch = new Event("touchmove", { bubbles: true });
      Object.defineProperty(touch, "touches", { value: [{ clientY: 60 }] });
      container.dispatchEvent(touch);
      userScroll(30);
      frames.tick();
    }
    expect(Math.max(...offsets())).toBeGreaterThan(3);
  });

  it("follows your speed at the page's gain: a slow read barely moves the rows, a quick scroll takes them to 6px (ruling 201 第 8 条)", () => {
    const farthest = (perFrame: number) => {
      build();
      detach = attachBubbleSpring(container);
      wheelScroll(perFrame, 30, 60);
      const most = Math.max(...offsets());
      detach();
      frames.runOut();
      container.remove();
      return most;
    };
    // 5px a frame (about 300px/s, reading): about 1px. 25px a frame
    // (about 1,560px/s, past FULL_LAG_SPEED_PX_S): at the cap.
    const slow = farthest(5);
    expect(slow).toBeGreaterThan(0);
    expect(slow).toBeLessThanOrEqual(2);
    expect(farthest(25)).toBe(MAX_LAG_PX);
  });

  it("is a frame of any length: a dropped frame neither blows up nor jumps back", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    wheel(60);
    userScroll(200);
    frames.tick(250);
    for (const x of offsets())
      expect(Math.abs(x)).toBeLessThanOrEqual(MAX_LAG_PX);
    frames.tick(250);
    frames.tick(250);
    for (const x of offsets()) expect(Math.abs(x)).toBeLessThanOrEqual(0.5);
  });
});

describe("the app's scrolls move nothing (ruling 201 第 3 条)", () => {
  it("a `scrollTop` the app writes, even right after a wheel tick", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    wheel(60);
    // The follow's pin, a page held in place, a delete's anchor…
    container.scrollTop = 300;
    container.dispatchEvent(new Event("scroll"));
    frames.tick();
    container.scrollTop += 40;
    container.dispatchEvent(new Event("scroll"));
    frames.tick();
    expect(offsets().every((x) => x === 0)).toBe(true);
    expect(frames.pending()).toBe(0);
  });

  it("a write in the middle of the person's scroll takes out only its own move", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    wheel(60);
    userScroll(10);
    container.scrollTop = scrollTopNow() + 500;
    userScroll(10);
    frames.tick();
    // 20px of the person's: far rows lag by their share of it, not of 520.
    const x = offsets();
    expect(Math.max(...x)).toBeGreaterThan(0);
    expect(Math.max(...x)).toBeLessThanOrEqual(MAX_LAG_PX);
    const lagged = Math.max(...x);
    // The same 20px without the write lag the same.
    detach();
    frames.runOut();
    engineScrollTop.set!.call(container, 510);
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    wheel(60);
    userScroll(20);
    frames.tick();
    expect(Math.max(...offsets())).toBe(lagged);
  });

  it("a smooth scroll of lib/animate-scroll.ts", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    animateScroll(container, 400);
    for (let i = 0; i < 40; i++) {
      container.dispatchEvent(new Event("scroll"));
      frames.tick();
    }
    expect(scrollTopNow()).toBe(400);
    expect(offsets().every((x) => x === 0)).toBe(true);
  });

  it("a scroll with no wheel, key, touch or scrollbar behind it", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    userScroll(40);
    frames.tick();
    expect(offsets().every((x) => x === 0)).toBe(true);
    // …nor one long after the last tick.
    wheel(60);
    frames.tick(400);
    userScroll(40);
    frames.tick();
    expect(offsets().every((x) => x === 0)).toBe(true);
  });

  it("not while a press in the content selects text", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    rows[3].dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
    wheelScroll(30, 3, 60);
    expect(offsets().every((x) => x === 0)).toBe(true);
    window.dispatchEvent(new PointerEvent("pointerup"));
    wheelScroll(30, 3, 60);
    expect(Math.max(...offsets())).toBeGreaterThan(0);
  });

  it("not a key typed into a field", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    const field = document.createElement("textarea");
    document.body.append(field);
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }),
    );
    userScroll(40);
    frames.tick();
    expect(offsets().every((x) => x === 0)).toBe(true);
    field.remove();
  });
});

describe("reduced motion (foundations §2.7 「只淡不移」)", () => {
  it("moves nothing", () => {
    build();
    frames.state.reducedMotion = true;
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    wheelScroll(30, 3, 60);
    expect(offsets().every((x) => x === 0)).toBe(true);
    expect(kickBubbleRow(container, rows[2], -1.5)).toBe(false);
  });

  it("read live: switched on mid-way, the rows are back the next frame", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    wheelScroll(30, 3, 60);
    expect(Math.max(...offsets())).toBeGreaterThan(0);
    frames.state.reducedMotion = true;
    frames.tick();
    expect(offsets().every((x) => x === 0)).toBe(true);
    expect(frames.pending()).toBe(0);
  });
});

describe("the landing push (ticket 151's way in)", () => {
  it("carries the row up to 1.5px past its place and back, the neighbours still", () => {
    build();
    Object.defineProperty(window, "devicePixelRatio", {
      value: 2,
      configurable: true,
    });
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    const bubble = rows[6].firstElementChild!;
    expect(kickBubbleRow(container, bubble, -1.5)).toBe(true);
    const path: number[] = [];
    for (let i = 0; i < 60 && frames.pending() > 0; i++) {
      frames.tick();
      path.push(translateOf(rows[6]));
      expect(translateOf(rows[5])).toBe(0);
      expect(translateOf(rows[7])).toBe(0);
    }
    expect(Math.min(...path)).toBe(-1.5);
    expect(path[path.length - 1]).toBe(0);
    expect(frames.pending()).toBe(0);
    Reflect.deleteProperty(window, "devicePixelRatio");
  });

  it("is nothing without the spring (not the main chat)", () => {
    build();
    expect(kickBubbleRow(container, rows[2], -1.5)).toBe(false);
  });

  it("says when the person's scroll is moving the rows", () => {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    expect(bubbleSpringScrolling(container)).toBe(false);
    wheel(60);
    userScroll(20);
    expect(bubbleSpringScrolling(container)).toBe(true);
    frames.tick(400);
    expect(bubbleSpringScrolling(container)).toBe(false);
  });
});

describe("detaching", () => {
  it("puts every row back, takes the accessor and the listeners off", () => {
    build();
    expect(Object.getOwnPropertyDescriptor(container, "scrollTop")).toBe(
      undefined,
    );
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    expect(Object.getOwnPropertyDescriptor(container, "scrollTop")).not.toBe(
      undefined,
    );
    wheelScroll(30, 3, 60);
    detach();
    expect(Object.getOwnPropertyDescriptor(container, "scrollTop")).toBe(
      undefined,
    );
    expect(offsets().every((x) => x === 0)).toBe(true);
    expect(frames.pending()).toBe(0);
    wheelScroll(30, 3, 60);
    expect(offsets().every((x) => x === 0)).toBe(true);
    // The engine's scrollTop still works as before.
    container.scrollTop = 120;
    expect(container.scrollTop).toBe(120);
  });
});

describe("what measures the conversation (ruling 201 第 5 条)", () => {
  function lagged(): void {
    build();
    detach = attachBubbleSpring(container, WHOLE_MOVE);
    wheelScroll(30, 3, 60);
    expect(Math.max(...offsets())).toBeGreaterThan(1);
  }

  it("reads a row's place without the spring", () => {
    lagged();
    const row = rows.find((r) => translateOf(r) > 1)!;
    const bubble = row.firstElementChild!;
    expect(bubbleSpringShift(bubble)).toBe(translateOf(row));
    expect(bubbleSpringShift(container)).toBe(0);
  });

  it("holds a page's anchor still while the spring lets the rows back", () => {
    lagged();
    const anchor = captureScrollAnchor(container)!;
    for (let i = 0; i < 40; i++) {
      frames.tick();
      // Nothing moved the layout: no drift, however the spring moved.
      expect(scrollAnchorDrift(container, anchor)).toBeCloseTo(0, 9);
    }
  });

  it("parks a message on the line from its place, not where the spring has it", () => {
    lagged();
    const row = rows.find((r) => translateOf(r) > 1)!;
    const message = row.querySelector(
      '[data-role="user-msg"], [data-role="assistant-bubble"]',
    )!;
    const layout = contentTopOf(row) - scrollTopNow();
    expect(userMsgParkOffset(message, 0)).toBeCloseTo(layout - 32, 9);
  });

  it("follows the reply's start from its place", () => {
    lagged();
    // The last user message is row 28; the reply's start is row 29,
    // out of the band (no spring): the follow is unchanged.
    const before = scrollTopNow();
    assistantFollowBottom(container, 32);
    expect(scrollTopNow()).not.toBe(before);
    // …and it was the app's write: nothing lags.
    frames.runOut();
    expect(offsets().every((x) => x === 0)).toBe(true);
  });

  it("copies a row for a removal without the spring's offset", () => {
    lagged();
    const removal = captureRemoval(container)!;
    const copies = [...removal.copies.values()].map(({ copy }) => copy);
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      expect(copy.style.getPropertyValue("translate")).toBe("");
      expect(copy.style.getPropertyValue("will-change")).toBe("");
    }
  });

  it("clears a copy's own spring styles", () => {
    const el = document.createElement("div");
    el.style.setProperty("translate", "0 3px");
    el.style.setProperty("will-change", "transform");
    el.style.setProperty("color", "red");
    clearBubbleSpringStyle(el);
    expect(el.getAttribute("style")).toBe("color: red;");
  });
});
