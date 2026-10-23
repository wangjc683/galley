import { afterEach, describe, expect, it, vi } from "vitest";

import {
  progressRollIn,
  progressRollMotion,
  progressRollNext,
  progressRollOut,
  progressRollSettle,
  progressRollStart,
  readProgressRollTiming,
} from "@/lib/progress-line-motion";

/*
 * The line under the typing bubble rolling a new sentence in (main chat
 * PRD ruling 137, ticket 93). The page side is in
 * components/conversation/TypingBubble.test.tsx.
 */

describe("the doing part's roll", () => {
  it("starts with the sentence and nothing rolling: the first appearance does not roll", () => {
    expect(progressRollStart("思考中")).toEqual({
      current: { id: 0, text: "思考中" },
      leaving: [],
    });
  });

  it("rolls only when the words change: the same sentence again is the same roll", () => {
    const start = progressRollStart("思考中");
    expect(progressRollNext(start, "思考中", true)).toBe(start);
    const rolled = progressRollNext(start, "我查各队伤病与轮换", true);
    expect(rolled).toEqual({
      current: { id: 1, text: "我查各队伤病与轮换" },
      leaving: [{ id: 0, text: "思考中" }],
    });
    expect(progressRollNext(rolled, "我查各队伤病与轮换", true)).toBe(rolled);
  });

  it("goes straight to the newest: no queue, the one in between leaves from where it is", () => {
    const twice = progressRollNext(
      progressRollNext(progressRollStart("思考中"), "我查各队伤病与轮换", true),
      "正在写回复",
      true,
    );
    // The newest is on screen; the one that was coming in leaves after
    // the first, and nothing is left to come in later.
    expect(twice.current).toEqual({ id: 2, text: "正在写回复" });
    expect(twice.leaving).toEqual([
      { id: 0, text: "思考中" },
      { id: 1, text: "我查各队伤病与轮换" },
    ]);
    // Each is dropped once it has rolled out; an unknown id changes nothing.
    const settled = progressRollSettle(twice, 0);
    expect(settled.leaving).toEqual([{ id: 1, text: "我查各队伤病与轮换" }]);
    expect(settled.current).toBe(twice.current);
    expect(progressRollSettle(settled, 0)).toBe(settled);
    expect(progressRollSettle(settled, 1).leaving).toEqual([]);
  });

  it("keeps nothing to leave without motion: a swap", () => {
    const rolled = progressRollNext(
      progressRollNext(progressRollStart("思考中"), "我查各队伤病与轮换", true),
      "正在写回复",
      false,
    );
    expect(rolled).toEqual({
      current: { id: 2, text: "正在写回复" },
      leaving: [],
    });
  });

  it("rolls a whole line up, or fades in place under reduced motion", () => {
    expect(progressRollMotion(false)).toBe("roll");
    expect(progressRollMotion(true)).toBe("fade");
    expect(progressRollIn("roll")).toEqual({
      transform: ["translateY(100%)", "translateY(0)"],
    });
    expect(progressRollIn("fade")).toEqual({ opacity: [0, 1] });
    const resting = { transform: "none", opacity: "1" };
    expect(progressRollOut("roll", resting)).toEqual({
      transform: ["none", "translateY(-100%)"],
    });
    expect(progressRollOut("fade", resting)).toEqual({ opacity: ["1", "0"] });
    // Mid-way in: it turns round from where it stands.
    const midway = { transform: "matrix(1, 0, 0, 1, 0, 6)", opacity: "0.4" };
    expect(progressRollOut("roll", midway)).toEqual({
      transform: ["matrix(1, 0, 0, 1, 0, 6)", "translateY(-100%)"],
    });
    expect(progressRollOut("fade", midway)).toEqual({
      opacity: ["0.4", "0"],
    });
  });
});

describe("the roll's timing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubTokens(tokens: Record<string, string>) {
    vi.stubGlobal("document", { documentElement: {} });
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: (name: string) => tokens[name] ?? "",
    }));
  }

  it("reads --motion-slow and --ease-firm off the page", () => {
    stubTokens({
      "--motion-slow": "240ms",
      "--ease-firm": " cubic-bezier(0.2, 0, 0, 1)",
    });
    expect(readProgressRollTiming()).toEqual({
      durationMs: 240,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
  });

  it("is null when a token cannot be read: the change is a swap", () => {
    stubTokens({ "--motion-slow": "240ms" });
    expect(readProgressRollTiming()).toBeNull();
    stubTokens({ "--ease-firm": "cubic-bezier(0.2, 0, 0, 1)" });
    expect(readProgressRollTiming()).toBeNull();
  });
});
