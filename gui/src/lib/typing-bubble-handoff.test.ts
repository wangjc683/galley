import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAgentTurn, interimTurn } from "@/lib/agent-turn";
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
  rowPush,
  toldLineAtEnd,
  toldLineGrows,
  typingBubbleHandoff,
  parseDurationMs,
  readHandoffTiming,
  type ToldLineFrame,
  type TypingBubbleFrame,
  type TypingBubbleNow,
} from "@/lib/typing-bubble-handoff";
import type { Turn } from "@/types/conversation";

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
/** The round was live in the render before. */
const watching: TypingBubbleFrame = { sessionId: S, live: true };
/** This render, the round still live. */
const running: TypingBubbleNow = {
  sessionId: S,
  live: true,
  question: false,
  settled: false,
  silent: false,
};

describe("which hand-offs play", () => {
  it("plays the one you are watching: the answer lands, or it asks you", () => {
    expect(
      typingBubbleHandoff(watching, {
        ...running,
        live: false,
        settled: true,
      }),
    ).toBe("reply");
    expect(
      typingBubbleHandoff(watching, {
        ...running,
        live: false,
        question: true,
      }),
    ).toBe("question");
  });

  it("does not play on a session switch, a reload or a restore", () => {
    const landed = { ...running, live: false, settled: true };
    // The round was another session's (MainView mounts per session;
    // this is the guard if it did not).
    expect(
      typingBubbleHandoff(
        { sessionId: "workbench-1", live: true },
        { ...landed, sessionId: S },
      ),
    ).toBeNull();
    // A reload mounts with what is there, and a cold-start restore runs
    // over turns still being read back (what lands then was there
    // before): MainView counts neither frame as live.
    expect(
      typingBubbleHandoff({ sessionId: S, live: false }, landed),
    ).toBeNull();
  });

  it("does not play while the round stays live: an earlier page, a message put back", () => {
    expect(typingBubbleHandoff(watching, running)).toBeNull();
  });

  it("does not play for a reply that says nothing, a stop or an error", () => {
    // `<no-reply/>`: nothing takes its place.
    expect(
      typingBubbleHandoff(watching, {
        ...running,
        live: false,
        settled: true,
        silent: true,
      }),
    ).toBeNull();
    // Stopped or failed: no bubble takes its place.
    expect(
      typingBubbleHandoff(watching, { ...running, live: false }),
    ).toBeNull();
  });

  it("never plays in the workbench: it has no typing bubble", () => {
    const workbench = { sessionId: "w-1", live: false };
    expect(
      typingBubbleHandoff(workbench, {
        sessionId: "w-1",
        live: false,
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

describe("a line told mid-run (ruling 200, ticket 149)", () => {
  /** A line it told you, as the live `tell_user` event draws it. */
  function told(id: string, words: string | null = "记上了，天气还在查"): Turn {
    const turn = interimTurn(words ?? "", 3);
    if (words === null) turn.finalAnswer = null;
    turn.messageId = id;
    return turn;
  }
  const you: Turn = {
    role: "user",
    content: "帮我查明天的天气",
    messageId: "u-1",
  };
  const step: Turn = buildAgentTurn({
    tools: [],
    finalAnswer: null,
    turnIndex: 3,
  });
  /** Your words said while it works, not read yet (ticket 136). */
  const waiting: Turn = {
    role: "user",
    content: "顺便看看后天",
    queueId: "q-1",
  };

  it("reads the line the conversation ends in, nothing else", () => {
    expect(toldLineAtEnd([you, told("t-1")])).toBe("t-1");
    expect(toldLineAtEnd([you, told("t-1"), step])).toBeNull();
    // It lands above your words waiting to be read: not at the end.
    expect(toldLineAtEnd([you, told("t-1"), waiting])).toBeNull();
    // No words, no bubble.
    expect(toldLineAtEnd([you, told("t-1", null)])).toBeNull();
    expect(toldLineAtEnd([you])).toBeNull();
    expect(toldLineAtEnd([])).toBeNull();
  });

  /** The render before: live, the conversation ending in your words. */
  const before: ToldLineFrame = {
    sessionId: S,
    live: true,
    told: null,
    turns: 2,
  };

  it("grows the one you watch land: live before and still, a new line at the end", () => {
    expect(toldLineGrows(before, { ...before, told: "t-1", turns: 3 })).toBe(
      true,
    );
    // The next one, right after another.
    expect(
      toldLineGrows(
        { ...before, told: "t-1", turns: 3 },
        { ...before, told: "t-2", turns: 4 },
      ),
    ).toBe(true);
  });

  it("does not grow on a reload, a session switch, a return from the workbench or a cold restore", () => {
    const landed: ToldLineFrame = { ...before, told: "t-1", turns: 3 };
    // MainView mounts with what is there: the frame before is this one.
    expect(toldLineGrows(landed, landed)).toBe(false);
    // Another session's round (MainView mounts per session).
    expect(toldLineGrows({ ...before, sessionId: "workbench-1" }, landed)).toBe(
      false,
    );
    // A cold-start restore reads turns back while not live, and going
    // live it brings nothing new.
    expect(toldLineGrows({ ...before, live: false }, landed)).toBe(false);
    expect(toldLineGrows(before, { ...landed, live: false })).toBe(false);
  });

  it("does not grow for an earlier page, a message put back, or a delete that leaves an earlier line last", () => {
    const landed: ToldLineFrame = { ...before, told: "t-1", turns: 3 };
    // An earlier page: more turns, the same end.
    expect(toldLineGrows(landed, { ...landed, turns: 40 })).toBe(false);
    // Put back after a delete: MainView reads the turns whole, which
    // never lost it — nothing changed.
    expect(toldLineGrows(landed, landed)).toBe(false);
    // Core deleted the last line, an earlier one is last now: fewer turns.
    expect(
      toldLineGrows(
        { ...before, told: "t-2", turns: 4 },
        { ...before, told: "t-1", turns: 3 },
      ),
    ).toBe(false);
  });

  it("does not grow when it is not at the end: a step after it, your words waiting under it", () => {
    expect(toldLineGrows(before, { ...before, told: null, turns: 3 })).toBe(
      false,
    );
  });

  it("pushes the typing bubble by how far it moved down, nothing under half a pixel", () => {
    // One line, 43.25px, and the 4px between it and the dots.
    expect(rowPush(400, 447.25)).toBe(47.25);
    expect(rowPush(400, 400)).toBe(0);
    expect(rowPush(400, 400.4)).toBe(0);
  });
});

describe("where the tint starts", () => {
  // A one-line answer under the user's message: the typing bubble stood
  // where the reply's top-left corner now is (54 × 43.25px at the
  // standard size, one reply line high).
  const bubble = { top: 100, left: 0, width: 300, height: 43.25 };

  it("from the typing bubble's box: its left edge, top, width and height", () => {
    const typing = { top: 100, left: 0, width: 54, height: 43.25 };
    const insets = bubbleGrowInsets(typing, bubble);
    expect(insets.top).toBe(0);
    expect(insets.left).toBe(0);
    expect(insets.right).toBeCloseTo(246, 6);
    expect(insets.bottom).toBeCloseTo(0, 6);
    expect(insetClipPath(insets, "12px")).toBe(
      "inset(0px 246px 0px 0px round 12px)",
    );
    expect(insetClipPath(undefined, "12px")).toBe(
      "inset(0px 0px 0px 0px round 12px)",
    );
  });

  it("opens down as well when the reply is taller than one line", () => {
    const typing = { top: 100, left: 0, width: 54, height: 43.25 };
    const insets = bubbleGrowInsets(typing, { ...bubble, height: 120 });
    expect(insets.top).toBe(0);
    expect(insets.bottom).toBeCloseTo(76.75, 6);
  });

  it("stays inside the bubble: a start wider than a short answer, or below it", () => {
    const wide = bubbleGrowInsets(
      { top: 100, left: 0, width: 500, height: 43.25 },
      { ...bubble, width: 40 },
    );
    expect(wide.right).toBe(0);
    expect(wide.left).toBe(0);
    // Below: it starts as the bubble's bottom edge and grows up.
    const below = bubbleGrowInsets(
      { top: 200, left: 0, width: 54, height: 43.25 },
      bubble,
    );
    expect(below.top).toBe(43.25);
    expect(below.bottom).toBe(0);
    // Above: its top edge.
    const above = bubbleGrowInsets(
      { top: 20, left: 0, width: 54, height: 43.25 },
      bubble,
    );
    expect(above.top).toBe(0);
    expect(above.bottom).toBe(43.25);
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
    // The dots out over one fade; the words in from half of it to the
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
