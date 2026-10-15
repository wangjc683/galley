import { describe, expect, it } from "vitest";

import {
  isEchoNarrationStep,
  stepMarkerLine,
  stepMarkerSummary,
  type StepHeadingFacts,
} from "./step-heading";
import { zhCopy } from "@/i18n/locales/zh";

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

  it("leaves closing-shaped turns alone (final answer)", () => {
    expect(isEchoNarrationStep(facts({ closingShaped: true }))).toBe(false);
  });

  it("leaves steps without a marker row alone", () => {
    expect(isEchoNarrationStep(facts({ hasMarker: false }))).toBe(false);
  });
});

describe("stepMarkerSummary / stepMarkerLine (the marker's words)", () => {
  const words = zhCopy.conversation;

  it("keeps a summary the model wrote", () => {
    expect(
      stepMarkerSummary("核对营业时间", NARRATION, ["web_scan"], words),
    ).toBe("核对营业时间");
    expect(stepMarkerLine("核对营业时间", NARRATION, false)).toBe(
      "核对营业时间",
    );
  });

  it("falls back to GA's two lines when the summary only echoes", () => {
    expect(stepMarkerSummary(NARRATION, NARRATION, ["web_scan"], words)).toBe(
      "调用了 web_scan",
    );
    expect(stepMarkerSummary(NARRATION, NARRATION, [], words)).toBe(
      "直接回答了用户问题",
    );
  });

  it("leaves a bare step bare", () => {
    expect(stepMarkerSummary(undefined, NARRATION, ["web_scan"], words)).toBe(
      undefined,
    );
  });

  it("writes an echo step's narration, cleaned, as the line", () => {
    expect(
      stepMarkerLine("调用了 web_scan", "**先看** 配置。\n\n再跑", true),
    ).toBe("先看 配置。 再跑");
    // Narration that cleans to nothing keeps the fallback.
    expect(stepMarkerLine("调用了 web_scan", "**", true)).toBe(
      "调用了 web_scan",
    );
  });
});
