import { describe, expect, it } from "vitest";

import {
  DEFAULT_GOAL_BUDGET_PRESET,
  GOAL_BUDGET_PRESET_MINUTES,
  GOAL_BUDGET_PRESETS,
  goalBudgetPresetMinutes,
  goalSessionTitle,
  resolveGoalBudgetSeconds,
} from "@/lib/goals";

describe("goalSessionTitle", () => {
  it("prefixes a short objective with `Goal ·`", () => {
    expect(goalSessionTitle("Ship the release")).toBe(
      "Goal · Ship the release",
    );
  });

  it("collapses internal whitespace and trims the ends", () => {
    expect(goalSessionTitle("  fix\n\tthe   bug  ")).toBe(
      "Goal · fix the bug",
    );
  });

  it("falls back to a bare `Goal` for an empty / whitespace objective", () => {
    expect(goalSessionTitle("")).toBe("Goal");
    expect(goalSessionTitle("   \n  ")).toBe("Goal");
  });

  it("keeps an objective exactly at the 44-char limit intact", () => {
    const objective = "b".repeat(44);
    expect(goalSessionTitle(objective)).toBe(`Goal · ${objective}`);
  });

  it("truncates a longer objective with an ellipsis", () => {
    const title = goalSessionTitle("a".repeat(50));
    expect(title).toBe(`Goal · ${"a".repeat(44)}…`);
  });
});

describe("resolveGoalBudgetSeconds", () => {
  it("turns every minute preset into seconds", () => {
    for (const minutes of GOAL_BUDGET_PRESET_MINUTES) {
      expect(resolveGoalBudgetSeconds(`${minutes}`)).toBe(minutes * 60);
    }
  });

  it("defaults to the recommended 60-minute ceiling", () => {
    expect(resolveGoalBudgetSeconds(DEFAULT_GOAL_BUDGET_PRESET)).toBe(3600);
  });

  it("reads `none` as the explicit no-ceiling choice", () => {
    expect(resolveGoalBudgetSeconds("none")).toBeNull();
  });

  it("lists the presets in ascending order with `none` last", () => {
    expect(GOAL_BUDGET_PRESETS).toEqual([
      "15",
      "30",
      "60",
      "120",
      "240",
      "none",
    ]);
    expect(GOAL_BUDGET_PRESETS).toContain(DEFAULT_GOAL_BUDGET_PRESET);
  });

  it("exposes the minutes behind a preset for the pill label", () => {
    expect(goalBudgetPresetMinutes("120")).toBe(120);
    expect(goalBudgetPresetMinutes("none")).toBeNull();
  });
});
