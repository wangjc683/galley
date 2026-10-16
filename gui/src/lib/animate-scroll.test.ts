import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  animateScroll,
  scrollDestination,
  scrollDurationMs,
  scrollJumpFrom,
  scrollProgress,
  type ScrollEnd,
} from "@/lib/animate-scroll";
import { FakeScrollBox as Box, stubFrames } from "@/test/scroll-frames";

let raf: ReturnType<typeof stubFrames>;
const tick = (ms?: number) => raf.tick(ms);
const runOut = () => raf.runOut();

beforeEach(() => {
  raf = stubFrames();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the rules", () => {
  it("takes 300ms plus 300ms per 800px, 600ms at most", () => {
    expect(scrollDurationMs(0)).toBe(300);
    expect(scrollDurationMs(200)).toBe(375);
    expect(scrollDurationMs(-400)).toBe(450);
    expect(scrollDurationMs(800)).toBe(600);
    expect(scrollDurationMs(5_000)).toBe(600);
  });

  it("eases out with exponent 3.5 up to 300px and 6 beyond", () => {
    expect(scrollProgress(300, 0)).toBe(0);
    expect(scrollProgress(300, 1)).toBe(1);
    expect(scrollProgress(300, 0.5)).toBeCloseTo(1 - 0.5 ** 3.5, 10);
    expect(scrollProgress(-300, 0.5)).toBeCloseTo(1 - 0.5 ** 3.5, 10);
    expect(scrollProgress(301, 0.5)).toBeCloseTo(1 - 0.5 ** 6, 10);
    expect(scrollProgress(800, 0.25)).toBeCloseTo(1 - 0.75 ** 6, 10);
    // Out of range t is held to the ends.
    expect(scrollProgress(800, 1.4)).toBe(1);
    expect(scrollProgress(800, -0.1)).toBe(0);
  });

  it("animates only the last 800px of a far jump", () => {
    expect(scrollJumpFrom(0, 800)).toBe(0);
    expect(scrollJumpFrom(1_000, 200)).toBe(1_000);
    expect(scrollJumpFrom(0, 5_000)).toBe(4_200);
    expect(scrollJumpFrom(5_000, 0)).toBe(800);
  });
});

describe("animateScroll", () => {
  it("scrolls a short way on the gentler curve in 375ms", () => {
    const box = new Box(3_000, 700);
    const ends: ScrollEnd[] = [];
    animateScroll(box, 200, (end) => ends.push(end));
    expect(box.scrollTop).toBe(0);
    tick(150);
    // t = 150 / 375 = 0.4
    expect(box.scrollTop).toBeCloseTo(200 * (1 - 0.6 ** 3.5), 6);
    expect(ends).toEqual([]);
    tick(225);
    expect(box.scrollTop).toBe(200);
    expect(ends).toEqual(["arrived"]);
    expect(raf.pending()).toBe(0);
  });

  it("scrolls a middle distance on the steeper curve in 525ms", () => {
    const box = new Box(3_000, 700);
    box.scrollTop = 1_000;
    const animation = animateScroll(box, 400);
    tick(105);
    // t = 105 / 525 = 0.2, 600px up
    expect(box.scrollTop).toBeCloseTo(1_000 - 600 * (1 - 0.8 ** 6), 6);
    tick(419);
    expect(animation.ended).toBeNull();
    tick(1);
    expect(animation.ended).toBe("arrived");
    expect(box.scrollTop).toBe(400);
  });

  it("jumps a far target to 800px short at once, then animates 600ms", () => {
    const box = new Box(10_000, 700);
    const ends: ScrollEnd[] = [];
    animateScroll(box, 6_000, (end) => ends.push(end));
    // Before any frame: already 800px short.
    expect(box.scrollTop).toBe(5_200);
    tick(300);
    expect(box.scrollTop).toBeCloseTo(5_200 + 800 * (1 - 0.5 ** 6), 6);
    tick(300);
    expect(box.scrollTop).toBe(6_000);
    expect(ends).toEqual(["arrived"]);
    // Nothing in between 0 and 5200 was ever shown.
    expect(box.writes.filter((top) => top > 0 && top < 5_200)).toEqual([]);
  });

  it("jumps up the same way", () => {
    const box = new Box(10_000, 700);
    box.scrollTop = 9_000;
    animateScroll(box, 100);
    expect(box.scrollTop).toBe(900);
    runOut();
    expect(box.scrollTop).toBe(100);
  });

  it("clamps the target to the scrollable range", () => {
    const box = new Box(3_000, 700);
    const animation = animateScroll(box, box.scrollHeight);
    expect(animation.target).toBe(2_300);
    // 2300px away: jumps to 1500 and animates the last 800 in 600ms.
    expect(box.scrollTop).toBe(1_500);
    tick(600);
    expect(box.scrollTop).toBe(2_300);
    expect(animation.ended).toBe("arrived");
  });

  it("writes the target at once under reduced motion, read on every call", () => {
    const box = new Box(10_000, 700);
    raf.state.reducedMotion = true;
    const ends: ScrollEnd[] = [];
    animateScroll(box, 6_000, (end) => ends.push(end));
    expect(box.scrollTop).toBe(6_000);
    expect(box.writes).toEqual([6_000]);
    expect(ends).toEqual(["arrived"]);
    expect(raf.pending()).toBe(0);
    // The system setting turned off: the next call animates again.
    raf.state.reducedMotion = false;
    animateScroll(box, 5_800);
    expect(box.scrollTop).toBe(6_000);
    expect(raf.pending()).toBe(1);
  });

  it("lets go at a wheel tick, a touch or a scrolling key", () => {
    for (const make of [
      (box: Box) => box.dispatchEvent(new Event("wheel")),
      (box: Box) => box.dispatchEvent(new Event("touchstart")),
      (box: Box) =>
        box.ownerDocument.dispatchEvent(
          Object.assign(new Event("keydown"), { key: "PageUp" }),
        ),
    ]) {
      const box = new Box(3_000, 700);
      const ends: ScrollEnd[] = [];
      animateScroll(box, 600, (end) => ends.push(end));
      tick(100);
      const reached = box.scrollTop;
      expect(reached).toBeGreaterThan(0);
      make(box);
      expect(ends).toEqual(["interrupted"]);
      runOut();
      expect(box.scrollTop).toBe(reached);
    }
  });

  it("lets go at a press on its own scrollbar, not on the content", () => {
    const box = new Box(3_000, 700);
    const animation = animateScroll(box, 600);
    tick();
    const content = new EventTarget();
    content.dispatchEvent(new Event("pointerdown"));
    expect(animation.ended).toBeNull();
    box.dispatchEvent(new Event("pointerdown"));
    expect(animation.ended).toBe("interrupted");
  });

  it("does not count a key someone already handled, or one that does not scroll", () => {
    const box = new Box(3_000, 700);
    // ⌥↑ / ⌥↓ is handled (and prevented) before the animation hears it.
    box.ownerDocument.addEventListener("keydown", (event) =>
      event.preventDefault(),
    );
    const animation = animateScroll(box, 600);
    tick();
    box.ownerDocument.dispatchEvent(
      Object.assign(new Event("keydown", { cancelable: true }), {
        key: "ArrowUp",
      }),
    );
    box.ownerDocument.dispatchEvent(
      Object.assign(new Event("keydown"), { key: "a" }),
    );
    expect(animation.ended).toBeNull();
    runOut();
    expect(animation.ended).toBe("arrived");
  });

  it("lets go when something else moved scrollTop between frames", () => {
    const box = new Box(3_000, 700);
    const animation = animateScroll(box, 600);
    tick(100);
    // The follow-the-bottom snap writes the bottom.
    box.scrollTop = box.scrollHeight;
    tick();
    expect(animation.ended).toBe("interrupted");
    expect(box.scrollTop).toBe(2_300);
  });

  it("re-aims mid-flight from where it is", () => {
    const box = new Box(3_000, 700);
    const ends: ScrollEnd[] = [];
    const animation = animateScroll(box, 400, (end) => ends.push(end));
    tick(150);
    const midway = box.scrollTop;
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(400);
    animation.retarget(1_000);
    expect(animation.target).toBe(1_000);
    // The rest restarts from here: 1000 − midway px on its own curve.
    const rest = 1_000 - midway;
    tick(100);
    expect(box.scrollTop).toBeCloseTo(
      midway + rest * scrollProgress(rest, 100 / scrollDurationMs(rest)),
      6,
    );
    runOut();
    expect(box.scrollTop).toBe(1_000);
    expect(ends).toEqual(["arrived"]);
    // Ended: a later retarget does nothing.
    animation.retarget(0);
    expect(raf.pending()).toBe(0);
    expect(box.scrollTop).toBe(1_000);
  });

  it("hands over to a newer request on the same container", () => {
    const box = new Box(3_000, 700);
    const ends: ScrollEnd[] = [];
    animateScroll(box, 600, (end) => ends.push(end));
    tick(100);
    const second = animateScroll(box, 100);
    expect(ends).toEqual(["superseded"]);
    expect(scrollDestination(box)).toBe(100);
    runOut();
    expect(box.scrollTop).toBe(100);
    expect(second.ended).toBe("arrived");
    expect(scrollDestination(box)).toBeNull();
  });

  it("stops where it is on cancel", () => {
    const box = new Box(3_000, 700);
    const animation = animateScroll(box, 600);
    tick(100);
    const reached = box.scrollTop;
    animation.cancel();
    runOut();
    expect(box.scrollTop).toBe(reached);
    expect(animation.ended).toBe("cancelled");
  });
});

describe("the conversation's smooth scrolls", () => {
  it("all go through animateScroll, none through the engine's smooth scroll", () => {
    // Static renders run no effects or handlers, so this checks the
    // wiring in the source (the rules themselves are tested above).
    for (const [file, calls] of [
      // submit park, ⌥↑ / ⌥↓ (the 「回到底部」 chase is lib/chase-bottom.ts)
      ["../hooks/useStickyScroll.ts", 2],
      // the question rail's click
      ["../components/conversation/UserQuestionRail.tsx", 1],
    ] as const) {
      const source = readFileSync(path.resolve(__dirname, file), "utf8");
      expect(source, file).not.toMatch(/behavior:\s*"smooth"/);
      expect(
        source.match(/animateScroll\(container,/g) ?? [],
        file,
      ).toHaveLength(calls);
    }
    const hook = readFileSync(
      path.resolve(__dirname, "../hooks/useStickyScroll.ts"),
      "utf8",
    );
    expect(hook).toContain("chaseBottom(el,");
  });
});
