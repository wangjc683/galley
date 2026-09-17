import { describe, expect, it } from "vitest";

import {
  DEFAULT_GOAL_BUDGET_MINUTES,
  GOAL_BUDGET_LADDER,
  goalSessionTitle,
  resolveGoalBudgetSeconds,
  stepGoalBudget,
} from "@/lib/goals";

describe("goalSessionTitle", () => {
  it("prefixes a short objective with `Goal ·`", () => {
    expect(goalSessionTitle("Ship the release")).toBe(
      "Goal · Ship the release",
    );
  });

  it("collapses internal whitespace and trims the ends", () => {
    expect(goalSessionTitle("  fix\n\tthe   bug  ")).toBe("Goal · fix the bug");
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
  it("turns minutes into seconds and keeps no-ceiling as null", () => {
    expect(resolveGoalBudgetSeconds(130)).toBe(7800);
    expect(resolveGoalBudgetSeconds(DEFAULT_GOAL_BUDGET_MINUTES)).toBe(3600);
    expect(resolveGoalBudgetSeconds(null)).toBeNull();
  });
});

describe("GOAL_BUDGET_LADDER", () => {
  it("runs 10..240 in 10-minute steps, then no ceiling", () => {
    expect(GOAL_BUDGET_LADDER[0]).toBe(10);
    expect(GOAL_BUDGET_LADDER[GOAL_BUDGET_LADDER.length - 2]).toBe(240);
    expect(GOAL_BUDGET_LADDER[GOAL_BUDGET_LADDER.length - 1]).toBeNull();
    expect(GOAL_BUDGET_LADDER).toHaveLength(25);
    expect(GOAL_BUDGET_LADDER).toContain(130);
    expect(GOAL_BUDGET_LADDER).toContain(DEFAULT_GOAL_BUDGET_MINUTES);
  });
});

describe("stepGoalBudget", () => {
  it("walks the ladder one notch at a time and clamps at both ends", () => {
    expect(stepGoalBudget(60, 1)).toBe(70);
    expect(stepGoalBudget(60, -1)).toBe(50);
    expect(stepGoalBudget(240, 1)).toBeNull();
    expect(stepGoalBudget(null, 1)).toBeNull();
    expect(stepGoalBudget(null, -1)).toBe(240);
    expect(stepGoalBudget(10, -1)).toBe(10);
  });

  it("starts from the default when the current value is off the ladder", () => {
    expect(stepGoalBudget(15, 1)).toBe(70);
  });
});
