import { describe, expect, it } from "vitest";

import { annotateGoalThread } from "@/lib/goal-thread";
import type { Turn, UserTurn } from "@/types/conversation";
import type { GoalBrief } from "@/types/goal";

function goal(overrides: Partial<GoalBrief>): GoalBrief {
  return {
    id: "goal_a",
    projectId: "proj_a",
    masterSessionId: "sess_master",
    objective: "audit the docs",
    status: "completed",
    budgetSeconds: 1800,
    workerLimit: 3,
    runtimeKind: "managed",
    writeMode: "autonomous",
    mode: "hive",
    startedAt: "2026-07-01T10:00:00Z",
    deadlineAt: "2026-07-01T10:30:00Z",
    endedAt: "2026-07-01T10:28:00Z",
    stopRequested: false,
    createdAt: "2026-07-01T10:00:00Z",
    updatedAt: "2026-07-01T10:28:00Z",
    ...overrides,
  };
}

function userTurn(overrides: Partial<UserTurn>): UserTurn {
  return {
    role: "user",
    content: "audit the docs",
    createdAt: "2026-07-01T10:00:00Z",
    ...overrides,
  };
}

describe("annotateGoalThread commission matching", () => {
  it("matches by goalId exactly, ignoring objective text", () => {
    // The stamped turn's text differs from the objective (e.g. the
    // objective was trimmed at launch) — the id match must still win.
    const turns: Turn[] = [
      userTurn({ content: "  audit the docs  ", goalId: "goal_a" }),
    ];
    const items = annotateGoalThread(turns, [goal({})]);
    expect(items[0]).toMatchObject({ kind: "commission" });
  });

  it("falls back to the text + timestamp heuristic for pre-031 turns", () => {
    const turns: Turn[] = [userTurn({})]; // no goalId
    const items = annotateGoalThread(turns, [goal({})]);
    expect(items[0]).toMatchObject({ kind: "commission" });
  });

  it("never lends a goalId-stamped turn to another goal via text equality", () => {
    // Two goals share identical objective text. Turn 0 is stamped for
    // goal_b; goal_a (unstamped era) must fall back to turn 1, not
    // steal turn 0 by text match.
    const turns: Turn[] = [
      userTurn({ goalId: "goal_b", createdAt: "2026-07-01T09:00:00Z" }),
      userTurn({ createdAt: "2026-07-01T10:00:01Z" }),
    ];
    const goalA = goal({ id: "goal_a" });
    const goalB = goal({
      id: "goal_b",
      startedAt: "2026-07-01T09:00:00Z",
      endedAt: "2026-07-01T09:20:00Z",
    });
    const items = annotateGoalThread(turns, [goalA, goalB]);
    const commissions = items.filter((item) => item.kind === "commission");
    expect(commissions).toHaveLength(2);
    expect(commissions[0]).toMatchObject({ goal: { id: "goal_b" } });
    expect(commissions[1]).toMatchObject({ goal: { id: "goal_a" } });
  });

  it("degrades to plain turns when a goalId-stamped turn has no matching goal", () => {
    const turns: Turn[] = [userTurn({ goalId: "goal_gone" })];
    const items = annotateGoalThread(turns, [
      goal({ id: "goal_other", objective: "something else" }),
    ]);
    expect(items[0]).toMatchObject({ kind: "turn" });
  });
});

describe("annotateGoalThread episode brackets", () => {
  it("emits a frozen task board directly above the terminal marker", () => {
    const turns: Turn[] = [userTurn({ goalId: "goal_a" })];
    const items = annotateGoalThread(turns, [goal({})]);
    expect(items.map((item) => item.kind)).toEqual([
      "commission",
      "task-board",
      "terminal",
    ]);
  });

  it("emits no board or terminal for a still-running goal (the live board is MainView's)", () => {
    const turns: Turn[] = [userTurn({ goalId: "goal_a" })];
    const items = annotateGoalThread(turns, [
      goal({ status: "running", endedAt: undefined }),
    ]);
    expect(items.map((item) => item.kind)).toEqual(["commission"]);
  });

  it("closes a stopped run with board + terminal like other terminals", () => {
    const turns: Turn[] = [userTurn({ goalId: "goal_a" })];
    const items = annotateGoalThread(turns, [goal({ status: "stopped" })]);
    expect(items.map((item) => item.kind)).toEqual([
      "commission",
      "task-board",
      "terminal",
    ]);
  });
});
