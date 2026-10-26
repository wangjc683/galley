import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SCROLL_ANIMATED_MAX_PX,
  scrollDurationMs,
  scrollProgress,
} from "@/lib/animate-scroll";
import {
  BUBBLE_MOTION_TOKENS,
  DELETE_SHRINK_SCALE,
  bubbleMotionMode,
  claimTypingDeparture,
  columnSlide,
  holdBubbleMotion,
  readBubbleMotionTiming,
  releaseBubbleMotion,
  rowShift,
  rowsMotion,
  sendFades,
  settleBubbleMotion,
  settledTypingOpacity,
  shrinkOrigin,
  slideKeyframes,
  typingDepartureClaimed,
  typingLeaveFades,
  wokenTypingFade,
  type BubbleMotionTiming,
  type RunningBubbleMotion,
} from "@/lib/bubble-motion";

/** The tokens as globals.css defines them: read from the file, as the
 * page reads them, never a copy of their numbers. */
const CSS = readFileSync(
  path.resolve(__dirname, "../styles/globals.css"),
  "utf8",
);
function definition(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(CSS);
  if (!match) throw new Error(`${name} is not defined in globals.css`);
  return match[1];
}

function stubRoot(values: Record<string, string>) {
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (name: string) => values[name] ?? "",
  }));
}

const ALL = Object.fromEntries(
  Object.values(BUBBLE_MOTION_TOKENS).map((name) => [name, definition(name)]),
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the exit easing token", () => {
  it("accelerates away: an ease-in, beside the ease-out ones", () => {
    expect(definition("--ease-exit")).toBe("cubic-bezier(0.4, 0, 1, 1)");
    // Its comment says what it is for.
    expect(CSS).toContain(
      "/* 离场：加速离开（ease-in 一类），配 ease-out 的入场；foundations Motion tokens */",
    );
  });
});

describe("timing, from the tokens", () => {
  it("reads every part's duration and curve off the root", () => {
    stubRoot(ALL);
    const timing = readBubbleMotionTiming()!;
    expect(timing).toEqual({
      fastMs: Number.parseFloat(definition("--motion-fast")),
      baseMs: Number.parseFloat(definition("--motion-base")),
      slowMs: Number.parseFloat(definition("--motion-slow")),
      pop: definition("--ease-pop"),
      firm: definition("--ease-firm"),
      exit: definition("--ease-exit"),
    });
  });

  it("is null when one cannot be read: then nothing moves", () => {
    for (const name of Object.values(BUBBLE_MOTION_TOKENS)) {
      stubRoot({ ...ALL, [name]: "" });
      expect(readBubbleMotionTiming()).toBeNull();
    }
  });
});

const TIMING: BubbleMotionTiming = {
  fastMs: 120,
  baseMs: 160,
  slowMs: 240,
  pop: "pop",
  firm: "firm",
  exit: "exit",
};

describe("reduced motion only fades", () => {
  it("moves, or under reduced motion fades", () => {
    expect(bubbleMotionMode(false)).toBe("move");
    expect(bubbleMotionMode(true)).toBe("fade");
  });
});

describe("the send's slide: the programmatic scroll's numbers", () => {
  it("slides from how far the column moved, over the scroll's duration", () => {
    // A line of yours and the typing bubble: about 140px (ruling 138).
    expect(columnSlide(140)).toEqual({
      distance: 140,
      durationMs: scrollDurationMs(140),
    });
    expect(columnSlide(-60)).toEqual({
      distance: -60,
      durationMs: scrollDurationMs(-60),
    });
  });

  it("slides only the last 800px of a longer way, as a far scroll jumps first", () => {
    expect(columnSlide(2400)).toEqual({
      distance: SCROLL_ANIMATED_MAX_PX,
      durationMs: scrollDurationMs(SCROLL_ANIMATED_MAX_PX),
    });
    expect(columnSlide(-2400)?.distance).toBe(-SCROLL_ANIMATED_MAX_PX);
  });

  it("does not slide under half a pixel", () => {
    expect(columnSlide(0.4)).toBeNull();
    expect(columnSlide(-0.4)).toBeNull();
    expect(columnSlide(Number.NaN)).toBeNull();
  });

  it("lays the scroll's curve out as keyframes, about one a frame", () => {
    const slide = columnSlide(140)!;
    const frames = slideKeyframes(slide);
    expect(frames[0]).toEqual({ offset: 0, transform: "translateY(140px)" });
    expect(frames[frames.length - 1]).toEqual({
      offset: 1,
      transform: "translateY(0px)",
    });
    expect(frames.length - 1).toBe(Math.ceil(slide.durationMs / 16));
    const at = (frame: Keyframe) =>
      Number.parseFloat(
        /translateY\((-?[\d.]+)px\)/.exec(String(frame.transform))![1],
      );
    // Each frame on the curve, and only ever closer.
    for (const frame of frames) {
      const t = Number(frame.offset);
      expect(at(frame)).toBeCloseTo(140 * (1 - scrollProgress(140, t)), 1);
    }
    for (let i = 1; i < frames.length; i++) {
      expect(at(frames[i])).toBeLessThanOrEqual(at(frames[i - 1]));
    }
  });
});

describe("the send's fades", () => {
  it("brings your bubble in with the slide, the typing bubble once it is over", () => {
    const slide = columnSlide(140)!;
    expect(sendFades(TIMING, slide)).toEqual({
      bubble: { durationMs: 160, delayMs: 0, easing: "pop" },
      typing: { durationMs: 160, delayMs: slide.durationMs, easing: "pop" },
    });
  });

  it("without a slide (reduced motion, nothing moved), the typing bubble a beat later", () => {
    expect(sendFades(TIMING, null).typing).toEqual({
      durationMs: 160,
      delayMs: 160,
      easing: "pop",
    });
  });
});

describe("the typing bubble with nothing growing out of it", () => {
  it("fades its copy fast and away; what took its place comes in from half of that", () => {
    expect(typingLeaveFades(TIMING)).toEqual({
      copy: { durationMs: 120, delayMs: 0, easing: "exit" },
      successors: { durationMs: 160, delayMs: 60, easing: "pop" },
    });
  });

  it("in a round Core woke it for, comes in fast and at once", () => {
    expect(wokenTypingFade(TIMING)).toEqual({
      durationMs: 120,
      delayMs: 0,
      easing: "pop",
    });
  });
});

describe("a delete's rows", () => {
  it("slides a row from where it was, either way", () => {
    expect(rowShift(300, 200)).toBe(100);
    expect(rowShift(200, 300)).toBe(-100);
  });

  it("leaves a row that did not move (the anchored one), or moved farther than a scroll animates", () => {
    expect(rowShift(200, 200.3)).toBeNull();
    expect(rowShift(1000, 1000 - SCROLL_ANIMATED_MAX_PX)).toBe(
      SCROLL_ANIMATED_MAX_PX,
    );
    expect(rowShift(1000, 1000 - SCROLL_ANIMATED_MAX_PX - 1)).toBeNull();
  });

  it("shrinks toward its own bottom corner: yours the right, the assistant's the left", () => {
    const at = { height: 80, viewportHeight: 600, mode: "move" as const };
    expect(shrinkOrigin({ ...at, side: "user" })).toBe("100% 100%");
    expect(shrinkOrigin({ ...at, side: "assistant" })).toBe("0% 100%");
  });

  it("only fades the time line, a row taller than the viewport, and under reduced motion", () => {
    const at = { height: 80, viewportHeight: 600, mode: "move" as const };
    expect(shrinkOrigin({ ...at, side: "time" })).toBeNull();
    expect(shrinkOrigin({ ...at, side: "assistant", height: 601 })).toBeNull();
    expect(shrinkOrigin({ ...at, side: "user", mode: "fade" })).toBeNull();
  });

  it("shrinks to 0.9 (ruling 138: the middle, not compared)", () => {
    expect(DELETE_SHRINK_SCALE).toBe(0.9);
  });

  it("leaves on the exit curve, slides firm and slow, comes back once the room is mostly made", () => {
    expect(rowsMotion(TIMING, "move")).toEqual({
      leave: { durationMs: 160, delayMs: 0, easing: "exit" },
      shift: { durationMs: 240, easing: "firm" },
      enter: { durationMs: 160, delayMs: 120, easing: "pop" },
    });
    // Nothing slides under reduced motion, so nothing waits.
    expect(rowsMotion(TIMING, "fade").enter.delayMs).toBe(0);
  });
});

describe("one at a time", () => {
  function motion(opacity: number | null = null) {
    const finish = vi.fn();
    const running: RunningBubbleMotion = {
      finish,
      typingOpacity: () => opacity,
    };
    return { running, finish };
  }

  it("puts the one running to its end before anything else measures", () => {
    const container = {};
    const { running, finish } = motion();
    holdBubbleMotion(container, running);
    settleBubbleMotion(container);
    expect(finish).toHaveBeenCalledTimes(1);
    // Once.
    settleBubbleMotion(container);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("ends the one before when a new one starts", () => {
    const container = {};
    const first = motion();
    const second = motion();
    holdBubbleMotion(container, first.running);
    holdBubbleMotion(container, second.running);
    expect(first.finish).toHaveBeenCalledTimes(1);
    expect(second.finish).not.toHaveBeenCalled();
  });

  it("lets go of one that ended by itself", () => {
    const container = {};
    const { running, finish } = motion();
    holdBubbleMotion(container, running);
    releaseBubbleMotion(container, running);
    settleBubbleMotion(container);
    expect(finish).not.toHaveBeenCalled();
  });

  it("keeps what the typing bubble's fade-in had reached until the end of the task", async () => {
    const container = {};
    holdBubbleMotion(container, motion(0.4).running);
    settleBubbleMotion(container);
    expect(settledTypingOpacity(container)).toBe(0.4);
    await Promise.resolve();
    expect(settledTypingOpacity(container)).toBeNull();
    // Without a fade-in under way: nothing kept.
    holdBubbleMotion(container, motion(null).running);
    settleBubbleMotion(container);
    expect(settledTypingOpacity(container)).toBeNull();
  });

  it("knows, for the commit, that the hand-off took the typing bubble's going", async () => {
    const container = {};
    expect(typingDepartureClaimed(container)).toBe(false);
    claimTypingDeparture(container);
    expect(typingDepartureClaimed(container)).toBe(true);
    await Promise.resolve();
    expect(typingDepartureClaimed(container)).toBe(false);
  });
});
