import { describe, expect, it } from "vitest";

import { goalOfTurns, liveWindowHasSettledStep, planGoalRuns } from "@/lib/goal-run-groups";
import { buildRunGroups } from "@/lib/run-groups";
import type {
  AgentTurn,
  ConversationToolEvent,
  Turn,
  UserTurn,
} from "@/types/conversation";
import type { GoalBrief } from "@/types/goal";

function goal(overrides: Partial<GoalBrief>): GoalBrief {
  return {
    id: "goal_a",
    sessionId: "s1",
    objective: "ship it",
    status: "active",
    budgetSeconds: 3600,
    startedAt: "2026-09-16T10:00:00Z",
    continuationCount: 2,
    wrapUpDispatched: false,
    elapsedSeconds: 600,
    createdAt: "2026-09-16T10:00:00Z",
    updatedAt: "2026-09-16T10:10:00Z",
    ...overrides,
  };
}

function user(content: string, extra: Partial<UserTurn> = {}): UserTurn {
  return { role: "user", content, createdAt: "2026-09-16T10:05:00Z", ...extra };
}

let toolSeq = 0;
function tool(name: string): ConversationToolEvent {
  return { id: `t-${toolSeq++}`, name, status: "success-historical", args: {} };
}

function step(...tools: ConversationToolEvent[]): AgentTurn {
  return { role: "agent", tools, finalAnswer: null, turnIndex: 1 };
}

/** A continuation's progress note: closing-shaped (no real tools, an answer). */
function note(answer = "进展"): AgentTurn {
  return {
    role: "agent",
    tools: [tool("no_tool")],
    finalAnswer: answer,
    telemetry: { elapsedMs: 4200 },
    turnIndex: 1,
  };
}

const objective = () => user("ship it", { goalId: "goal_a", createdAt: "2026-09-16T10:00:00Z" });

describe("goalOfTurns", () => {
  it("brackets the objective, its steps, and mid-run steering under the goal", () => {
    const turns: Turn[] = [
      user("hello"),
      objective(),
      step(tool("file_read")),
      user("try the other branch"),
      step(tool("code_run")),
      note(),
    ];
    const of = goalOfTurns(turns, [goal({})]);
    expect(of.map((g) => g?.id ?? null)).toEqual([null, "goal_a", "goal_a", "goal_a", "goal_a", "goal_a"]);
  });

  it("ends a terminal goal's segment before the first user turn dated after it", () => {
    const turns: Turn[] = [
      objective(),
      step(tool("file_read")),
      note(),
      user("thanks, next topic", { createdAt: "2026-09-16T11:00:00Z" }),
      note(),
    ];
    const of = goalOfTurns(turns, [goal({ status: "completed", endedAt: "2026-09-16T10:30:00Z" })]);
    expect(of.map((g) => g?.id ?? null)).toEqual(["goal_a", "goal_a", "goal_a", null, null]);
  });
});

describe("planGoalRuns", () => {
  it("makes an active goal's last group live regardless of agentRunning", () => {
    const turns: Turn[] = [objective(), step(tool("file_read")), note(), step(tool("code_run"))];
    const plan = planGoalRuns(turns, [goal({})], buildRunGroups(turns), false, false);
    expect(plan.liveGroup?.openerIndex).toBe(0);
    expect(plan.groups[0].complete).toBe(false);
    expect(plan.groups[0].foldEligible).toBe(true);
    expect(plan.groups[0].finalTurnIndex).toBeNull();
    expect(liveWindowHasSettledStep(plan, turns)).toBe(true);
  });

  it("keeps a continuation's progress note inside the window as a step", () => {
    // Shape-wise the run is "complete" (closing turn last); the goal
    // rules say it is mid-flight until the goal itself ends.
    const turns: Turn[] = [objective(), step(tool("file_read")), note()];
    const shape = buildRunGroups(turns);
    expect(shape[0].complete).toBe(true);
    const plan = planGoalRuns(turns, [goal({})], shape, true, false);
    expect(plan.liveGroup?.openerIndex).toBe(0);
    expect(plan.groups[0].finalTurnIndex).toBeNull();
  });

  it("treats the user's resuming run on a parked goal as live", () => {
    const turns: Turn[] = [objective(), step(tool("file_read")), user("继续"), step(tool("code_run"))];
    for (const status of ["paused", "blocked"] as const) {
      const idle = planGoalRuns(turns, [goal({ status })], buildRunGroups(turns), false, false);
      expect(idle.liveGroup).toBeNull();
      const running = planGoalRuns(turns, [goal({ status })], buildRunGroups(turns), true, false);
      expect(running.liveGroup?.openerIndex).toBe(2);
      expect(running.groups[0].foldable).toBe(true);
    }
  });

  it("folds paused and blocked goals without an answer", () => {
    const turns: Turn[] = [objective(), step(tool("file_read")), note()];
    for (const status of ["paused", "blocked"] as const) {
      const plan = planGoalRuns(turns, [goal({ status })], buildRunGroups(turns), false, false);
      expect(plan.liveGroup).toBeNull();
      expect(plan.groups[0].foldable).toBe(true);
      expect(plan.groups[0].finalTurnIndex).toBeNull();
      expect(plan.groups[0].stats.elapsedMs).toBeNull();
    }
  });

  it("surfaces the deliverable only for completed / budget_limited goals", () => {
    const turns: Turn[] = [objective(), step(tool("file_read")), note("最终结果")];
    for (const status of ["completed", "budget_limited"] as const) {
      const plan = planGoalRuns(
        turns,
        [goal({ status, endedAt: "2026-09-16T10:30:00Z" })],
        buildRunGroups(turns),
        false,
        false,
      );
      expect(plan.groups[0].foldable).toBe(true);
      expect(plan.groups[0].finalTurnIndex).toBe(2);
    }
    for (const status of ["stopped", "failed"] as const) {
      const plan = planGoalRuns(
        turns,
        [goal({ status, endedAt: "2026-09-16T10:30:00Z" })],
        buildRunGroups(turns),
        false,
        false,
      );
      expect(plan.groups[0].foldable).toBe(true);
      expect(plan.groups[0].finalTurnIndex).toBeNull();
    }
  });

  it("folds the segment before a steering message while the later one is live", () => {
    const turns: Turn[] = [
      objective(),
      step(tool("file_read")),
      note(),
      user("try the other branch"),
      step(tool("code_run")),
    ];
    const plan = planGoalRuns(turns, [goal({})], buildRunGroups(turns), true, false);
    expect(plan.groups).toHaveLength(2);
    expect(plan.goalOfGroup.get(0)?.id).toBe("goal_a");
    expect(plan.goalOfGroup.get(3)?.id).toBe("goal_a");
    expect(plan.groups[0].foldable).toBe(true);
    expect(plan.groups[0].finalTurnIndex).toBeNull();
    expect(plan.liveGroup?.openerIndex).toBe(3);
  });

  it("gives the deliverable to the goal's last group only", () => {
    const turns: Turn[] = [
      objective(),
      step(tool("file_read")),
      note("早期进展"),
      user("try the other branch"),
      step(tool("code_run")),
      note("最终结果"),
    ];
    const plan = planGoalRuns(
      turns,
      [goal({ status: "completed", endedAt: "2026-09-16T10:30:00Z" })],
      buildRunGroups(turns),
      false,
      false,
    );
    expect(plan.groups[0].finalTurnIndex).toBeNull();
    expect(plan.groups[1].finalTurnIndex).toBe(5);
  });

  it("numbers goal steps by position per group", () => {
    const turns: Turn[] = [
      objective(),
      step(tool("a")),
      note(),
      step(tool("b")),
      user("steer"),
      step(tool("c")),
    ];
    const plan = planGoalRuns(turns, [goal({})], buildRunGroups(turns), true, false);
    expect([...plan.stepNumberOf.entries()]).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [5, 1],
    ]);
  });

  it("numbers an ordinary run's steps by position across an ask_user reply", () => {
    // GA restarts its counter at the reply's put_task (turnIndex 1
    // again on turns[4]); the display continues the run's count.
    const turns: Turn[] = [
      user("q"),
      step(tool("a")),
      step(tool("ask_user")),
      user("选 A"),
      step(tool("b")),
      note("答"),
    ];
    const plan = planGoalRuns(turns, [], buildRunGroups(turns), false, false);
    expect([...plan.stepNumberOf.entries()]).toEqual([
      [1, 1],
      [2, 2],
      [4, 3],
      [5, 4],
    ]);
  });

  it("leaves a headless leading group on GA's own step", () => {
    const turns: Turn[] = [step(tool("a")), user("q"), step(tool("b"))];
    const plan = planGoalRuns(turns, [], buildRunGroups(turns), true, false);
    expect([...plan.stepNumberOf.entries()]).toEqual([[2, 1]]);
  });

  it("leaves ordinary runs on the shape rules", () => {
    const turns: Turn[] = [user("q"), step(tool("a")), note("答")];
    const shape = buildRunGroups(turns);
    const plan = planGoalRuns(turns, [], shape, true, false);
    expect(plan.groups[0]).toBe(shape[0]);
    expect(plan.liveGroup).toBeNull();
    expect([...plan.stepNumberOf.entries()]).toEqual([
      [1, 1],
      [2, 2],
    ]);
    const live = planGoalRuns([user("q"), step(tool("a"))], [], buildRunGroups([user("q"), step(tool("a"))]), true, false);
    expect(live.liveGroup?.openerIndex).toBe(0);
    expect(liveWindowHasSettledStep(live, [user("q"), step(tool("a"))])).toBe(true);
  });
});
