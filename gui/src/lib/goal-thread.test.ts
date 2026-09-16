import { describe, expect, it } from "vitest";

import { annotateGoalThread } from "@/lib/goal-thread";
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
    sessionId: "sess_a",
    objective: "audit the docs",
    status: "completed",
    budgetSeconds: 3600,
    startedAt: "2026-07-01T10:00:00Z",
    endedAt: "2026-07-01T10:28:00Z",
    continuationCount: 3,
    wrapUpDispatched: false,
    elapsedSeconds: 1680,
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

let toolSeq = 0;
function tool(name: string): ConversationToolEvent {
  return { id: `t-${toolSeq++}`, name, status: "success-historical", args: {} };
}

/** A worked step: tools ran, no conclusion yet. */
function step(): AgentTurn {
  return { role: "agent", tools: [tool("file_read")], finalAnswer: null };
}

/** A closing turn: no real tools, a real answer. */
function answer(text = "结论"): AgentTurn {
  return { role: "agent", tools: [tool("no_tool")], finalAnswer: text };
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
  it("closes a solo-shaped run after its steps, not before them", () => {
    // The v2 shape: commission → agent steps (continuations included)
    // → terminal marker at the very end. The v1 rule closed the run at
    // the first non-narration turn, which put the marker above the work.
    const turns: Turn[] = [
      userTurn({ goalId: "goal_a" }),
      step(),
      step(),
      answer(),
    ];
    const items = annotateGoalThread(turns, [goal({})]);
    expect(items.map((item) => item.kind)).toEqual([
      "commission",
      "turn",
      "turn",
      "turn",
      "terminal",
    ]);
  });

  it("keeps a mid-run steering message inside the bracket", () => {
    const turns: Turn[] = [
      userTurn({ goalId: "goal_a" }),
      step(),
      userTurn({ content: "顺便看看 en 版", createdAt: "2026-07-01T10:10:00Z" }),
      answer(),
    ];
    const items = annotateGoalThread(turns, [goal({})]);
    expect(items.map((item) => item.kind)).toEqual([
      "commission",
      "turn",
      "turn",
      "turn",
      "terminal",
    ]);
  });

  it("closes the run before normal chat that follows the goal", () => {
    const turns: Turn[] = [
      userTurn({ goalId: "goal_a" }),
      step(),
      answer(),
      userTurn({ content: "谢谢，另外帮我订个票", createdAt: "2026-07-01T11:00:00Z" }),
      answer("好的"),
    ];
    const items = annotateGoalThread(turns, [goal({})]);
    expect(items.map((item) => item.kind)).toEqual([
      "commission",
      "turn",
      "turn",
      "terminal",
      "turn",
      "turn",
    ]);
  });

  it("treats a user turn without createdAt as after the goal", () => {
    const turns: Turn[] = [
      userTurn({ goalId: "goal_a" }),
      answer(),
      { role: "user", content: "新话题" },
    ];
    const items = annotateGoalThread(turns, [goal({})]);
    expect(items.map((item) => item.kind)).toEqual([
      "commission",
      "turn",
      "terminal",
      "turn",
    ]);
  });

  it("emits no terminal marker for an open goal (active / paused / blocked)", () => {
    for (const status of ["active", "paused", "blocked"] as const) {
      const turns: Turn[] = [userTurn({ goalId: "goal_a" }), step()];
      const items = annotateGoalThread(turns, [
        goal({ status, endedAt: undefined }),
      ]);
      expect(items.map((item) => item.kind)).toEqual(["commission", "turn"]);
    }
  });

  it("closes budget_limited / stopped / failed runs like completed ones", () => {
    for (const status of ["budget_limited", "stopped", "failed"] as const) {
      const turns: Turn[] = [userTurn({ goalId: "goal_a" }), answer()];
      const items = annotateGoalThread(turns, [goal({ status })]);
      expect(items.map((item) => item.kind)).toEqual([
        "commission",
        "turn",
        "terminal",
      ]);
    }
  });

  it("a second commission closes the previous run's bracket", () => {
    const turns: Turn[] = [
      userTurn({ goalId: "goal_a" }),
      answer(),
      userTurn({
        content: "再来一次",
        goalId: "goal_b",
        createdAt: "2026-07-01T12:00:00Z",
      }),
      answer(),
    ];
    const items = annotateGoalThread(turns, [
      goal({}),
      goal({
        id: "goal_b",
        objective: "再来一次",
        startedAt: "2026-07-01T12:00:00Z",
        endedAt: "2026-07-01T12:20:00Z",
      }),
    ]);
    expect(items.map((item) => item.kind)).toEqual([
      "commission",
      "turn",
      "terminal",
      "commission",
      "turn",
      "terminal",
    ]);
  });
});
