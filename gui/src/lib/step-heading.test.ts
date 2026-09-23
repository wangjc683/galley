import { describe, expect, it } from "vitest";

import { isEchoNarrationStep, type StepHeadingFacts } from "./step-heading";

const NARRATION =
  "营业时间只出现在搜索摘要里，我去厦门网原文核对，地铁站也一起确认。";

function facts(overrides: Partial<StepHeadingFacts> = {}): StepHeadingFacts {
  return {
    hasMarker: true,
    closingShaped: false,
    narration: NARRATION,
    summary: NARRATION,
    ...overrides,
  };
}

describe("isEchoNarrationStep", () => {
  it("matches a tool step whose summary is GA's fallback echo of its narration", () => {
    expect(isEchoNarrationStep(facts())).toBe(true);
  });

  it("matches across GA's whitespace normalization", () => {
    // GA drops newlines before summarizing; the narration keeps them.
    expect(
      isEchoNarrationStep(
        facts({
          narration: "先看配置。\n\n然后再跑一遍测试。",
          summary: "先看配置。然后再跑一遍测试。",
        }),
      ),
    ).toBe(true);
  });

  it("matches a smart_format middle-elided echo", () => {
    const long = "甲".repeat(60) + "乙".repeat(60);
    expect(
      isEchoNarrationStep(
        facts({
          narration: long,
          summary: `${"甲".repeat(40)} ... ${"乙".repeat(40)}`,
        }),
      ),
    ).toBe(true);
  });

  it("leaves a step whose model wrote its own summary alone", () => {
    expect(
      isEchoNarrationStep(facts({ summary: "核对营业时间与地铁站" })),
    ).toBe(false);
  });

  it("leaves a step without narration alone", () => {
    expect(isEchoNarrationStep(facts({ narration: null }))).toBe(false);
    expect(isEchoNarrationStep(facts({ narration: "  \n " }))).toBe(false);
  });

  it("leaves a step with no summary at all alone (bare-marker case)", () => {
    expect(isEchoNarrationStep(facts({ summary: undefined }))).toBe(false);
    expect(isEchoNarrationStep(facts({ summary: "" }))).toBe(false);
  });

  it("leaves closing-shaped turns alone (final answer, goal progress note)", () => {
    expect(isEchoNarrationStep(facts({ closingShaped: true }))).toBe(false);
  });

  it("leaves steps without a marker row alone", () => {
    expect(isEchoNarrationStep(facts({ hasMarker: false }))).toBe(false);
  });
});
