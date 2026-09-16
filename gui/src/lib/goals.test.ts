import { describe, expect, it } from "vitest";

import {
  DEFAULT_GOAL_BUDGET_PRESET,
  GOAL_BUDGET_PRESET_MINUTES,
  GOAL_CUSTOM_BUDGET_MIN_MINUTES,
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
      expect(resolveGoalBudgetSeconds(`${minutes}`, "")).toBe(minutes * 60);
    }
  });

  it("defaults to the recommended 60-minute ceiling", () => {
    expect(resolveGoalBudgetSeconds(DEFAULT_GOAL_BUDGET_PRESET, "")).toBe(3600);
  });

  it("reads `none` as the explicit no-ceiling choice, not as unusable", () => {
    expect(resolveGoalBudgetSeconds("none", "")).toBeNull();
    // Even with a stale custom entry sitting in the field.
    expect(resolveGoalBudgetSeconds("none", "90")).toBeNull();
  });

  it("resolves a custom entry at or above the floor", () => {
    expect(
      resolveGoalBudgetSeconds("custom", `${GOAL_CUSTOM_BUDGET_MIN_MINUTES}`),
    ).toBe(GOAL_CUSTOM_BUDGET_MIN_MINUTES * 60);
    expect(resolveGoalBudgetSeconds("custom", "90")).toBe(5400);
    expect(resolveGoalBudgetSeconds("custom", " 480 ")).toBe(28800);
  });

  it("has no upper bound — that is what `none` is NOT for", () => {
    expect(resolveGoalBudgetSeconds("custom", "100000")).toBe(6_000_000);
  });

  it("refuses an empty, non-numeric, or sub-floor custom entry", () => {
    expect(resolveGoalBudgetSeconds("custom", "")).toBeUndefined();
    expect(resolveGoalBudgetSeconds("custom", "   ")).toBeUndefined();
    expect(resolveGoalBudgetSeconds("custom", "abc")).toBeUndefined();
    expect(resolveGoalBudgetSeconds("custom", "-30")).toBeUndefined();
    expect(resolveGoalBudgetSeconds("custom", "0")).toBeUndefined();
    expect(
      resolveGoalBudgetSeconds(
        "custom",
        `${GOAL_CUSTOM_BUDGET_MIN_MINUTES - 1}`,
      ),
    ).toBeUndefined();
  });

  it("rejects rather than rounds a fractional entry (minutes only)", () => {
    expect(resolveGoalBudgetSeconds("custom", "12.5")).toBeUndefined();
    expect(resolveGoalBudgetSeconds("custom", "1e3")).toBeUndefined();
  });
});
