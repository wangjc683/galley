import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  animateTextareaHeight,
  composerGrowDurationMs,
  easeOut,
} from "@/lib/composer-grow";
import { keepBottomOnViewportResize } from "@/lib/viewport-resize";

describe("composerGrowDurationMs", () => {
  it("is nothing for the instant path or a change under a pixel", () => {
    expect(composerGrowDurationMs("instant", 45)).toBe(0);
    expect(composerGrowDurationMs("fixed", 0.5)).toBe(0);
    expect(composerGrowDurationMs("distance", -0.5)).toBe(0);
  });

  it("is 100ms for any change in the fixed option", () => {
    expect(composerGrowDurationMs("fixed", 22)).toBe(100);
    expect(composerGrowDurationMs("fixed", -157)).toBe(100);
  });

  it("follows Telegram's 50 × ln|Δh| by distance, growing or shrinking", () => {
    // One more line at the standard size (about 22px).
    expect(composerGrowDurationMs("distance", 22)).toBe(155);
    // One line to three (48 → 93).
    expect(composerGrowDurationMs("distance", 45)).toBe(190);
    // One line to eight (48 → 205), and back after a send.
    expect(composerGrowDurationMs("distance", 157)).toBe(253);
    expect(composerGrowDurationMs("distance", -157)).toBe(253);
  });
});

/** A stand-in textarea: no parent, so its own `scrollHeight` is the
 * measure (the hidden copy needs a DOM). Heights are the input's: 32px
 * for one line (the box is 48), 77 for three (93), capped at 189 for
 * eight (205), at the standard font size. */
function input(scrollHeight: number, height = "") {
  return {
    parentElement: null,
    scrollHeight,
    placeholder: "",
    value: "",
    style: { height, overflowY: "" },
  } as unknown as HTMLTextAreaElement;
}

const cap = (max: number) => () => max;

/** Frames by hand: a clock and the queued frame callbacks. */
function stubFrames() {
  let now = 1_000;
  let queue: (() => void)[] = [];
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    queue = [];
  });
  return {
    /** Advance the clock by `ms` and run the frame. */
    frame(ms = 16) {
      now += ms;
      const due = queue;
      queue = [];
      for (const cb of due) cb();
    },
    pending: () => queue.length,
  };
}

const px = (el: HTMLTextAreaElement) => Number.parseFloat(el.style.height);

describe("easeOut", () => {
  it("is CSS ease-out: quick off the mark, settling in", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeCloseTo(0.6847, 3);
    expect(easeOut(0.25)).toBeCloseTo(0.3781, 3);
  });
});

describe("animateTextareaHeight", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves the instant path to the caller and touches nothing", () => {
    const el = input(77, "32px");
    expect(animateTextareaHeight(el, "instant", cap(189))).toBe(false);
    expect(el.style.height).toBe("32px");
    expect(el.style.overflowY).toBe("");
  });

  it("moves to the text's height over the option's time, ease-out, frame by frame", () => {
    const frames = stubFrames();
    const el = input(77, "32px");
    expect(animateTextareaHeight(el, "fixed", cap(189))).toBe(true);
    // Nothing moves until the first frame.
    expect(el.style.height).toBe("32px");
    // Fits under the cap: no scrollbar while a line lands ahead of the
    // box.
    expect(el.style.overflowY).toBe("hidden");
    const heights: number[] = [];
    for (let i = 0; i < 7; i++) {
      frames.frame();
      heights.push(px(el));
    }
    // 100ms: 16, 32, … 96, then 112 lands it.
    expect(heights[0]).toBeCloseTo(32 + 45 * easeOut(0.16), 5);
    expect(heights[2]).toBeCloseTo(32 + 45 * easeOut(0.48), 5);
    expect(heights[6]).toBe(77);
    expect(frames.pending()).toBe(0);
    // Always on its way up.
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    }
  });

  it("takes 50 × ln|Δh| ms by distance, back down after a send too", () => {
    const frames = stubFrames();
    const back = input(32, "189px");
    animateTextareaHeight(back, "distance", cap(189));
    // 253ms for 157px: not there at 240, there at 256.
    for (let i = 0; i < 15; i++) frames.frame();
    expect(px(back)).toBeGreaterThan(32);
    frames.frame();
    expect(px(back)).toBe(32);
  });

  it("carries on from where it stands when the next line comes mid-way", () => {
    const frames = stubFrames();
    const el = input(54, "32px");
    animateTextareaHeight(el, "distance", cap(189));
    frames.frame();
    frames.frame();
    const mid = px(el);
    expect(mid).toBeGreaterThan(32);
    expect(mid).toBeLessThan(54);
    // A third line: off again from `mid`, no jump back or ahead.
    (el as unknown as { scrollHeight: number }).scrollHeight = 77;
    animateTextareaHeight(el, "distance", cap(189));
    frames.frame(1);
    expect(px(el)).toBeGreaterThanOrEqual(mid);
    expect(px(el)).toBeLessThan(mid + 2);
    for (let i = 0; i < 20; i++) frames.frame();
    expect(px(el)).toBe(77);
  });

  it("stops at the cap and scrolls past it", () => {
    const frames = stubFrames();
    const el = input(400, "77px");
    animateTextareaHeight(el, "distance", cap(189));
    expect(el.style.overflowY).toBe("");
    for (let i = 0; i < 20; i++) frames.frame();
    expect(el.style.height).toBe("189px");
  });

  it("sets the first height at once, and moves nothing for no change", () => {
    const frames = stubFrames();
    const mounted = input(32);
    animateTextareaHeight(mounted, "distance", cap(189));
    expect(mounted.style.height).toBe("32px");
    expect(frames.pending()).toBe(0);

    const same = input(77, "77px");
    animateTextareaHeight(same, "fixed", cap(189));
    expect(same.style.height).toBe("77px");
    expect(frames.pending()).toBe(0);
  });

  it("stops a motion and clears what it set when switched back to instant", () => {
    const frames = stubFrames();
    const el = input(77, "32px");
    animateTextareaHeight(el, "fixed", cap(189));
    frames.frame();
    expect(animateTextareaHeight(el, "instant", cap(189))).toBe(false);
    expect(frames.pending()).toBe(0);
    expect(el.style.overflowY).toBe("");
  });

  it("is instant under reduced motion", () => {
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
      }),
    });
    const el = input(77, "32px");
    expect(animateTextareaHeight(el, "distance", cap(189))).toBe(false);
    expect(el.style.height).toBe("32px");
  });
});

describe("the composer's animated growth keeps the conversation pinned", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * One frame as the browser runs it, modelled: the scroll event of the
   * last pin reads 「at the bottom」 first (useStickyScroll's 24px; the
   * ref the observer reads catches up a render later), then the frame
   * callbacks move the input, then layout, then the scroll container's
   * ResizeObserver (lib/viewport-resize.ts).
   */
  function run(
    timing: "fixed" | "distance",
    from: number,
    to: number,
    // Where the input moves in the frame: in the frame callbacks (ours),
    // or before the scroll event reads (a CSS transition, advanced at the
    // frame's start).
    moves: "in-frame" | "before-read" = "in-frame",
  ) {
    const frames = stubFrames();
    let fire: () => void = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          fire = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const el = input(to, `${from}px`);
    // 1400px of conversation over a 920px window: the viewport is what
    // the composer (the input + 16) and its 24px under it leave.
    const view = { scrollTop: 0, scrollHeight: 1400, clientHeight: 0 };
    const layout = () => {
      view.clientHeight = 920 - 24 - (px(el) + 16);
    };
    let atBottom = true;
    let atBottomRef = true;
    keepBottomOnViewportResize(
      view as unknown as HTMLElement,
      () => atBottomRef,
    );
    layout();
    view.scrollTop = view.scrollHeight - view.clientHeight;
    fire();
    animateTextareaHeight(el, timing, cap(189));
    let scrolled = false;
    const seen: { dist: number; atBottom: boolean }[] = [];
    while (seen.length < 40) {
      atBottomRef = atBottom;
      if (moves === "before-read") {
        frames.frame();
        layout();
      }
      if (scrolled) {
        atBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 24;
        scrolled = false;
      }
      if (moves === "in-frame") {
        frames.frame();
        layout();
      }
      const before = view.scrollTop;
      fire();
      if (view.scrollTop !== before) scrolled = true;
      seen.push({
        dist: view.scrollHeight - view.scrollTop - view.clientHeight,
        atBottom,
      });
      if (frames.pending() === 0) break;
    }
    return seen;
  }

  it("lands every frame at the bottom, and never reads as scrolled up", () => {
    for (const [timing, from, to] of [
      // A pasted page in 100ms: up to ~45px a frame.
      ["fixed", 32, 189],
      ["distance", 32, 189],
      // One more line, and back to one line after a send.
      ["fixed", 32, 54],
      ["distance", 32, 54],
      ["fixed", 189, 32],
      ["distance", 189, 32],
    ] as const) {
      const seen = run(timing, from, to);
      expect(seen.length).toBeGreaterThan(5);
      for (const frame of seen) {
        expect(Math.abs(frame.dist)).toBeLessThan(0.001);
        expect(frame.atBottom).toBe(true);
      }
    }
  });

  it("would leave a frame unpinned if the input moved before the scroll event read (why not a CSS transition)", () => {
    // The page pasted in 100ms: a step past 24px reads as scrolled up,
    // and the frame after it is not pinned (in Chrome with a transition:
    // one frame 17px low).
    const seen = run("fixed", 32, 189, "before-read");
    expect(seen.some((frame) => !frame.atBottom)).toBe(true);
    expect(Math.max(...seen.map((frame) => frame.dist))).toBeGreaterThan(10);
  });

  it("is wired into the Composer before its instant path", () => {
    // A static render runs no effects; this checks the call in the
    // source (the behaviour is tested above).
    const source = readFileSync(
      path.resolve(__dirname, "../components/conversation/Composer.tsx"),
      "utf8",
    );
    const call = source.indexOf(
      "if (animateTextareaHeight(el, timing, oneLineMaxHeightPx)) return;",
    );
    expect(call).toBeGreaterThan(-1);
    expect(source.indexOf('el.style.height = "auto";')).toBeGreaterThan(call);
    expect(source).toContain(
      'const timing = oneLine ? composerGrowTiming() : "instant";',
    );
  });
});
