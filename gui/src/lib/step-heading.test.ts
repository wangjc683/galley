import { describe, expect, it } from "vitest";

import {
  isEchoNarrationStep,
  stepMarkerLine,
  stepMarkerSummary,
  stepToolsLine,
  type StepHeadingFacts,
} from "./step-heading";
import { enCopy } from "@/i18n/locales/en";
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
  const words = zhCopy;

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
      "读取网页",
    );
    expect(stepMarkerSummary(NARRATION, NARRATION, ["foo_tool"], words)).toBe(
      "调用了 foo_tool",
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

describe("stepToolsLine (the fallback for a step that ran tools)", () => {
  it("reads a lone named tool as its name, Bash / PowerShell as code_run", () => {
    expect(stepToolsLine(["code_run"], zhCopy)).toBe("运行代码");
    expect(stepToolsLine(["Bash"], zhCopy)).toBe("运行代码");
    expect(stepToolsLine(["PowerShell"], zhCopy)).toBe("运行代码");
    expect(stepToolsLine(["code_run"], enCopy)).toBe("Run code");
    expect(stepToolsLine(["Bash"], enCopy)).toBe("Run code");
  });

  it("names every tool in copy.tools by its label", () => {
    for (const copy of [zhCopy, enCopy]) {
      for (const [name, label] of Object.entries(copy.tools)) {
        expect(stepToolsLine([name], copy)).toBe(label);
      }
    }
  });

  it("keeps 「调用了 X」 for a tool without a name, raw", () => {
    expect(stepToolsLine(["foo_tool"], zhCopy)).toBe("调用了 foo_tool");
    expect(stepToolsLine(["foo_tool"], enCopy)).toBe("Called foo_tool");
    // Case-exact, like the alias table: lowercase bash is not Bash.
    expect(stepToolsLine(["bash"], zhCopy)).toBe("调用了 bash");
    // Not an own key of copy.tools, though every object has it.
    expect(stepToolsLine(["constructor"], zhCopy)).toBe("调用了 constructor");
  });

  it("counts several tools, named or not", () => {
    expect(stepToolsLine(["code_run", "web_scan"], zhCopy)).toBe(
      "调用了 2 个工具",
    );
    expect(stepToolsLine(["code_run", "code_run"], zhCopy)).toBe(
      "调用了 2 个工具",
    );
    expect(stepToolsLine(["code_run", "web_scan"], enCopy)).toBe(
      "Called 2 tools",
    );
  });
});
