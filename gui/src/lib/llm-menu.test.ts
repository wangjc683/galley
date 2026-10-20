import { describe, expect, it } from "vitest";

import { isChatGptPlanOption, providerLabelAlwaysShown } from "./llm-menu";

const PLAN = new Set(["mm_plan", "mm_plan_2"]);

describe("isChatGptPlanOption", () => {
  it("is the plan's when its key is", () => {
    expect(isChatGptPlanOption(PLAN, { key: "mm_plan" })).toBe(true);
    expect(isChatGptPlanOption(PLAN, { key: "mm_cpa" })).toBe(false);
    expect(isChatGptPlanOption(PLAN, {})).toBe(false);
    expect(isChatGptPlanOption(undefined, { key: "mm_plan" })).toBe(false);
    expect(isChatGptPlanOption(PLAN, undefined)).toBe(false);
  });
});

describe("providerLabelAlwaysShown", () => {
  it("is hover-only for names nobody else has", () => {
    expect(
      providerLabelAlwaysShown(
        [
          { key: "a", displayName: "gpt-6.1-sol" },
          { key: "b", displayName: "claude" },
        ],
        undefined,
      ),
    ).toEqual([false, false]);
  });

  it("stays shown for same names, ignoring surrounding spaces", () => {
    expect(
      providerLabelAlwaysShown(
        [
          { key: "a", displayName: "gpt-6.1-sol" },
          { key: "b", displayName: " gpt-6.1-sol" },
        ],
        new Set(),
      ),
    ).toEqual([true, true]);
  });

  it("lets the ChatGPT mark tell a plan row from a same-name other row", () => {
    expect(
      providerLabelAlwaysShown(
        [
          { key: "mm_plan", displayName: "gpt-6.1-sol" },
          { key: "mm_cpa", displayName: "gpt-6.1-sol" },
        ],
        PLAN,
      ),
    ).toEqual([false, false]);
  });

  it("keeps it for the rows the mark can't separate", () => {
    // One plan row and two other rows of one name: the plan row has the
    // mark to itself; the other two still look alike.
    expect(
      providerLabelAlwaysShown(
        [
          { key: "mm_plan", displayName: "gpt-6.1-sol" },
          { key: "mm_cpa", displayName: "gpt-6.1-sol" },
          { key: "mm_or", displayName: "gpt-6.1-sol" },
        ],
        PLAN,
      ),
    ).toEqual([false, true, true]);
    // Two plan rows of one name both carry the mark.
    expect(
      providerLabelAlwaysShown(
        [
          { key: "mm_plan", displayName: "gpt-6.1-sol" },
          { key: "mm_plan_2", displayName: "gpt-6.1-sol" },
        ],
        PLAN,
      ),
    ).toEqual([true, true]);
  });
});
