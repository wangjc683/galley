import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cubicBezier, parseCubicBezier } from "@/lib/composer-grow";
import {
  bubbleGrowInsets,
  columnLift,
  HANDOFF_EASING_TOKEN,
  HANDOFF_FADE_TOKEN,
  HANDOFF_GROW_TOKEN,
  handoffFadeIn,
  handoffMotion,
  insetClipPath,
  landingScrollTiming,
  lineTextWidth,
  liveLineHandoff,
  parseDurationMs,
  readHandoffTiming,
  type LiveLineFrame,
  type LiveLineNow,
} from "@/lib/live-line-handoff";

/** The tokens as globals.css defines them: the tests read the
 * definitions, as the page does, never a copy of their numbers. */
const TOKENS = (() => {
  const css = readFileSync(
    path.resolve(__dirname, "../styles/globals.css"),
    "utf8",
  );
  const tokens = new Map<string, string>();
  for (const name of [
    HANDOFF_GROW_TOKEN,
    HANDOFF_FADE_TOKEN,
    HANDOFF_EASING_TOKEN,
  ]) {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
    if (!match) throw new Error(`${name} is not defined in globals.css`);
    tokens.set(name, match[1]);
  }
  return tokens;
})();

/** The page's root style, with the tokens (or `values`) on it. */
function stubTokens(values: Map<string, string> = TOKENS) {
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (name: string) =>
      values.has(name) ? ` ${values.get(name)}` : "",
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const S = "main-chat";
/** The line was on screen in the render before. */
const watching: LiveLineFrame = { sessionId: S, live: true };
/** This render, the line still up. */
const running: LiveLineNow = {
  sessionId: S,
  lineShown: true,
  question: false,
  settled: false,
  silent: false,
};

describe("which hand-offs play", () => {
  it("plays the one you are watching: the answer lands, or it asks you", () => {
    expect(
      liveLineHandoff(watching, {
        ...running,
        lineShown: false,
        settled: true,
      }),
    ).toBe("reply");
    expect(
      liveLineHandoff(watching, {
        ...running,
        lineShown: false,
        question: true,
      }),
    ).toBe("question");
  });

  it("does not play on a session switch, a reload or a restore", () => {
    const landed = { ...running, lineShown: false, settled: true };
    // The line was another session's (MainView mounts per session; this
    // is the guard if it did not).
    expect(
      liveLineHandoff(
        { sessionId: "workbench-1", live: true },
        { ...landed, sessionId: S },
      ),
    ).toBeNull();
    // A reload mounts with what is there, and a cold-start restore draws
    // the line over turns still being read back (what lands then was
    // there before): MainView counts neither frame's line as live.
    expect(liveLineHandoff({ sessionId: S, live: false }, landed)).toBeNull();
  });

  it("does not play while the line stays: an earlier page, a message put back", () => {
    expect(liveLineHandoff(watching, running)).toBeNull();
  });

  it("does not play for a reply that says nothing, a stop or an error", () => {
    // `<no-reply/>`: the line just goes.
    expect(
      liveLineHandoff(watching, {
        ...running,
        lineShown: false,
        settled: true,
        silent: true,
      }),
    ).toBeNull();
    // Stopped or failed: no bubble takes its place.
    expect(
      liveLineHandoff(watching, { ...running, lineShown: false }),
    ).toBeNull();
  });

  it("never plays in the workbench: it has no line", () => {
    const workbench = { sessionId: "w-1", live: false };
    expect(
      liveLineHandoff(workbench, {
        sessionId: "w-1",
        lineShown: false,
        question: false,
        settled: true,
        silent: false,
      }),
    ).toBeNull();
  });

  it("only fades under reduced motion (只淡不移)", () => {
    expect(handoffMotion(false)).toBe("grow");
    expect(handoffMotion(true)).toBe("fade");
  });
});

describe("where the tint starts", () => {
  // A one-line answer under the user's message: the line sat where the
  // bubble's top-left corner now is (both 20px under the message).
  const bubble = { top: 100, left: 0, width: 300, height: 44 };

  it("from the line's text box: its left edge, top, width and height", () => {
    const line = { top: 100, left: 0, width: 180, height: 19.2 };
    const insets = bubbleGrowInsets(line, bubble);
    expect(insets.top).toBe(0);
    expect(insets.left).toBe(0);
    expect(insets.right).toBeCloseTo(120, 6);
    expect(insets.bottom).toBeCloseTo(24.8, 6);
    expect(insetClipPath(insets, "12px")).toBe(
      "inset(0px 120px 24.8px 0px round 12px)",
    );
    expect(insetClipPath(undefined, "12px")).toBe(
      "inset(0px 0px 0px 0px round 12px)",
    );
  });

  it("starts lower when the bubble sits closer to what is above (after its own question)", () => {
    const line = { top: 116, left: 0, width: 180, height: 19.2 };
    const insets = bubbleGrowInsets(line, bubble);
    expect(insets.top).toBe(16);
    expect(insets.bottom).toBeCloseTo(8.8, 6);
  });

  it("stays inside the bubble: a line wider than a short answer, or below it", () => {
    const wide = bubbleGrowInsets(
      { top: 100, left: 0, width: 500, height: 19.2 },
      { ...bubble, width: 60 },
    );
    expect(wide.right).toBe(0);
    expect(wide.left).toBe(0);
    // Below: it starts as the bubble's bottom edge and grows up.
    const below = bubbleGrowInsets(
      { top: 200, left: 0, width: 180, height: 19.2 },
      bubble,
    );
    expect(below.top).toBe(44);
    expect(below.bottom).toBe(0);
    // Above: its top edge.
    const above = bubbleGrowInsets(
      { top: 20, left: 0, width: 180, height: 19.2 },
      bubble,
    );
    expect(above.top).toBe(0);
    expect(above.bottom).toBe(44);
  });

  it("reads the line's words, not its full-width row", () => {
    // The sentence ends at 260, the clock at 312, in a 760px row at 40.
    expect(lineTextWidth(40, [260, 312], 760)).toBe(272);
    expect(lineTextWidth(40, [], 760)).toBe(760);
    expect(lineTextWidth(40, [2_000], 760)).toBe(760);
  });

  it("lifts the column by what it moved up at once, nothing under half a pixel", () => {
    // A short conversation stacked up from the composer: the tail grew
    // by 66px, so its top moved up 66px.
    expect(columnLift(420, 354)).toBe(66);
    expect(columnLift(24, 24)).toBe(0);
    expect(columnLift(24, 23.7)).toBe(0);
  });
});

describe("the timing comes from the motion tokens", () => {
  it("reads a CSS time in ms", () => {
    expect(parseDurationMs("240ms")).toBe(240);
    expect(parseDurationMs(" 0.12s ")).toBe(120);
    expect(parseDurationMs("fast")).toBeNull();
    expect(parseDurationMs("")).toBeNull();
  });

  it("grows over --motion-slow, fades over --motion-fast, eases with --ease-pop", () => {
    stubTokens();
    const timing = readHandoffTiming();
    expect(timing).not.toBeNull();
    expect(timing!.growMs).toBe(
      parseDurationMs(TOKENS.get(HANDOFF_GROW_TOKEN)!),
    );
    expect(timing!.fadeMs).toBe(
      parseDurationMs(TOKENS.get(HANDOFF_FADE_TOKEN)!),
    );
    expect(timing!.easing).toBe(TOKENS.get(HANDOFF_EASING_TOKEN));
    // The line out over one fade; the words in from half of it to the
    // end of the growth.
    expect(handoffFadeIn(timing!)).toEqual({
      delay: timing!.fadeMs / 2,
      duration: timing!.growMs - timing!.fadeMs / 2,
    });
  });

  it("runs the landing's follow on the same clock and curve", () => {
    stubTokens();
    const scroll = landingScrollTiming();
    expect(scroll).not.toBeNull();
    expect(scroll!.durationMs).toBe(readHandoffTiming()!.growMs);
    const pop = cubicBezier(
      ...parseCubicBezier(TOKENS.get(HANDOFF_EASING_TOKEN)!)!,
    );
    for (const t of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
      expect(scroll!.easing(t)).toBeCloseTo(pop(t), 9);
    }
  });

  it("animates nothing when the tokens cannot be read", () => {
    stubTokens(new Map([[HANDOFF_GROW_TOKEN, "240ms"]]));
    expect(readHandoffTiming()).toBeNull();
    expect(landingScrollTiming()).toBeNull();
    vi.unstubAllGlobals();
    vi.stubGlobal("document", undefined);
    expect(readHandoffTiming()).toBeNull();
  });
});
