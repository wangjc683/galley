import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  animateTextareaHeight,
  COMPOSER_GROW_EASING_TOKEN,
  composerGrowDurationMs,
  cubicBezier,
  parseCubicBezier,
} from "@/lib/composer-grow";
import { keepBottomOnViewportResize } from "@/lib/viewport-resize";

/** `--ease-firm` as globals.css defines it: the tests read the token's
 * definition, as the page does, never a copy of its numbers. */
const FIRM_TOKEN = (() => {
  const css = readFileSync(
    path.resolve(__dirname, "../styles/globals.css"),
    "utf8",
  );
  const match = /--ease-firm:\s*([^;]+);/.exec(css);
  if (!match) throw new Error("--ease-firm is not defined in globals.css");
  return match[1];
})();
const firm = cubicBezier(...parseCubicBezier(FIRM_TOKEN)!);

/** The page's root style, with the token (or `value`) on it. */
function stubToken(value: string = FIRM_TOKEN) {
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (name: string) =>
      name === COMPOSER_GROW_EASING_TOKEN ? ` ${value}` : "",
  }));
}

describe("composerGrowDurationMs", () => {
  it("is nothing for a change under a pixel", () => {
    expect(composerGrowDurationMs(0.5)).toBe(0);
    expect(composerGrowDurationMs(-0.5)).toBe(0);
  });

  it("follows Telegram's 50 × ln|Δh|, growing or shrinking", () => {
    // One more line at the standard size (about 22px).
    expect(composerGrowDurationMs(22)).toBe(155);
    // One line to three (48 → 93).
    expect(composerGrowDurationMs(45)).toBe(190);
    // One line to eight (48 → 205), and back after a send.
    expect(composerGrowDurationMs(157)).toBe(253);
    expect(composerGrowDurationMs(-157)).toBe(253);
  });
});

describe("the --ease-firm curve", () => {
  it("is read off the token's definition: cubic-bezier(0.2, 0, 0, 1)", () => {
    expect(parseCubicBezier(FIRM_TOKEN)).toEqual([0.2, 0, 0, 1]);
    expect(parseCubicBezier(" cubic-bezier(0.2,0,0,1) ")).toEqual([
      0.2, 0, 0, 1,
    ]);
    expect(parseCubicBezier("ease-out")).toBeNull();
    expect(parseCubicBezier("")).toBeNull();
    // x outside 0–1 is not a timing function CSS accepts.
    expect(parseCubicBezier("cubic-bezier(1.2, 0, 0, 1)")).toBeNull();
  });

  it("evaluates a cubic Bézier the way CSS does", () => {
    // CSS ease-out, cubic-bezier(0, 0, 0.58, 1), at known points.
    const easeOut = cubicBezier(0, 0, 0.58, 1);
    expect(easeOut(0.5)).toBeCloseTo(0.6847, 3);
    expect(easeOut(0.25)).toBeCloseTo(0.3781, 3);
    // --ease-firm against a brute-force reading of the same curve.
    const reference = (t: number) => {
      let best = 0;
      let bestGap = Infinity;
      for (let i = 0; i <= 200_000; i++) {
        const s = i / 200_000;
        const x = 3 * (1 - s) * (1 - s) * s * 0.2 + s * s * s;
        if (Math.abs(x - t) < bestGap) {
          bestGap = Math.abs(x - t);
          best = 3 * (1 - s) * s * s + s * s * s;
        }
      }
      return best;
    };
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(firm(t)).toBeCloseTo(reference(t), 4);
    }
    expect(firm(0)).toBe(0);
    expect(firm(1)).toBe(1);
    // Decisive arrival: well past half way at half the time.
    expect(firm(0.5)).toBeGreaterThan(0.85);
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

describe("animateTextareaHeight", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("moves to the text's height over 50 × ln|Δh| ms on --ease-firm, frame by frame", () => {
    stubToken();
    const frames = stubFrames();
    const el = input(77, "32px");
    expect(animateTextareaHeight(el, cap(189))).toBe(true);
    // Nothing moves until the first frame.
    expect(el.style.height).toBe("32px");
    // Fits under the cap: no scrollbar while a line lands ahead of the
    // box.
    expect(el.style.overflowY).toBe("hidden");
    const heights: number[] = [];
    for (let i = 0; i < 12; i++) {
      frames.frame();
      heights.push(px(el));
    }
    // 45px: 190ms. 16, 32, … 176, then 192 lands it.
    expect(heights[0]).toBeCloseTo(32 + 45 * firm(16 / 190), 5);
    expect(heights[4]).toBeCloseTo(32 + 45 * firm(80 / 190), 5);
    expect(heights[10]).toBeLessThan(77);
    expect(heights[11]).toBe(77);
    expect(frames.pending()).toBe(0);
    // Always on its way up.
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    }
  });

  it("takes 253ms for the whole way back down after a send", () => {
    stubToken();
    const frames = stubFrames();
    const back = input(32, "189px");
    animateTextareaHeight(back, cap(189));
    // Not there at 240, there at 256.
    for (let i = 0; i < 15; i++) frames.frame();
    expect(px(back)).toBeGreaterThan(32);
    frames.frame();
    expect(px(back)).toBe(32);
  });

  it("carries on from where it stands when the next line comes mid-way", () => {
    stubToken();
    const frames = stubFrames();
    const el = input(54, "32px");
    animateTextareaHeight(el, cap(189));
    frames.frame();
    frames.frame();
    const mid = px(el);
    expect(mid).toBeGreaterThan(32);
    expect(mid).toBeLessThan(54);
    // A third line: off again from `mid`, no jump back or ahead.
    (el as unknown as { scrollHeight: number }).scrollHeight = 77;
    animateTextareaHeight(el, cap(189));
    frames.frame(1);
    expect(px(el)).toBeGreaterThanOrEqual(mid);
    expect(px(el)).toBeLessThan(mid + 2);
    for (let i = 0; i < 20; i++) frames.frame();
    expect(px(el)).toBe(77);
  });

  it("stops at the cap and scrolls past it", () => {
    stubToken();
    const frames = stubFrames();
    const el = input(400, "77px");
    animateTextareaHeight(el, cap(189));
    expect(el.style.overflowY).toBe("");
    for (let i = 0; i < 20; i++) frames.frame();
    expect(el.style.height).toBe("189px");
  });

  it("sets the first height at once, and moves nothing for no change", () => {
    stubToken();
    const frames = stubFrames();
    const mounted = input(32);
    animateTextareaHeight(mounted, cap(189));
    expect(mounted.style.height).toBe("32px");
    expect(frames.pending()).toBe(0);

    const same = input(77, "77px");
    animateTextareaHeight(same, cap(189));
    expect(same.style.height).toBe("77px");
    expect(frames.pending()).toBe(0);
  });

  it("is instant under reduced motion, and stops a motion on its way", () => {
    stubToken();
    const frames = stubFrames();
    const el = input(77, "32px");
    animateTextareaHeight(el, cap(189));
    frames.frame();
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
      }),
    });
    expect(animateTextareaHeight(el, cap(189))).toBe(false);
    expect(frames.pending()).toBe(0);
    expect(el.style.overflowY).toBe("");
  });

  it("is instant when the token cannot be read, and touches nothing", () => {
    stubToken("");
    const el = input(77, "32px");
    expect(animateTextareaHeight(el, cap(189))).toBe(false);
    expect(el.style.height).toBe("32px");
    expect(el.style.overflowY).toBe("");
    vi.unstubAllGlobals();
    // No page at all (a static render).
    expect(animateTextareaHeight(el, cap(189))).toBe(false);
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
    from: number,
    to: number,
    // Where the input moves in the frame: in the frame callbacks (ours),
    // or before the scroll event reads (a CSS transition, advanced at the
    // frame's start).
    moves: "in-frame" | "before-read" = "in-frame",
  ) {
    stubToken();
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
    animateTextareaHeight(el, cap(189));
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
    for (const [from, to] of [
      // A pasted page, one line to eight.
      [32, 189],
      // One more line, and back to one line after a send.
      [32, 54],
      [189, 32],
    ] as const) {
      const seen = run(from, to);
      expect(seen.length).toBeGreaterThan(5);
      for (const frame of seen) {
        expect(Math.abs(frame.dist)).toBeLessThan(0.001);
        expect(frame.atBottom).toBe(true);
      }
    }
  });

  it("would leave a frame unpinned if the input moved before the scroll event read (why not a CSS transition)", () => {
    // The page pasted: --ease-firm's steepest frames step past 24px,
    // which reads as scrolled up, and the frame after it is not pinned
    // (in Chrome with a transition: one frame 17px low).
    const seen = run(32, 189, "before-read");
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
      "if (oneLine && animateTextareaHeight(el, oneLineMaxHeightPx)) return;",
    );
    expect(call).toBeGreaterThan(-1);
    expect(source.indexOf('el.style.height = "auto";')).toBeGreaterThan(call);
  });
});
