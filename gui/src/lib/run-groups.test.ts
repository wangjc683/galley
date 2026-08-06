import { describe, expect, it } from "vitest";

import { buildRunGroups, replyUserIndices } from "@/lib/run-groups";
import type {
  AgentTurn,
  ConversationToolEvent,
  SystemTurn,
  Turn,
  UserTurn,
} from "@/types/conversation";

function user(content: string, goalId?: string): UserTurn {
  const t: UserTurn = { role: "user", content };
  if (goalId) t.goalId = goalId;
  return t;
}

let toolSeq = 0;
function tool(
  name: string,
  status: ConversationToolEvent["status"] = "success-historical",
): ConversationToolEvent {
  return { id: `t-${toolSeq++}`, name, status, args: {} };
}

/** Intermediate step: dispatched real tools, no conclusion. */
function step(...tools: ConversationToolEvent[]): AgentTurn {
  return { role: "agent", tools, finalAnswer: null };
}

/** Closing turn: no real tools, a real answer. */
function closing(answer = "结论", elapsedMs?: number): AgentTurn {
  return {
    role: "agent",
    tools: [tool("no_tool")],
    finalAnswer: answer,
    telemetry: elapsedMs === undefined ? undefined : { elapsedMs },
  };
}

function system(): SystemTurn {
  return { role: "system", content: "叙述", variant: "goal" };
}

describe("buildRunGroups", () => {
  it("groups each user turn with the agent turns that follow it", () => {
    const turns: Turn[] = [
      user("q1"),
      step(tool("web_scan")),
      closing(),
      user("q2"),
      closing(),
    ];
    const groups = buildRunGroups(turns);
    expect(groups).toHaveLength(2);
    expect(groups[0].openerIndex).toBe(0);
    expect(groups[0].memberIndices).toEqual([0, 1, 2]);
    expect(groups[0].complete).toBe(true);
    expect(groups[0].finalTurnIndex).toBe(2);
    expect(groups[1].memberIndices).toEqual([3, 4]);
  });

  it("keeps an ask_user reply inside the run", () => {
    const turns: Turn[] = [
      user("q"),
      step(tool("ask_user")),
      user("选 A"),
      step(tool("file_patch")),
      closing(),
    ];
    const groups = buildRunGroups(turns);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIndices).toEqual([0, 1, 2, 3, 4]);
    expect(groups[0].stats.askUserCount).toBe(1);
    expect(replyUserIndices(groups, turns)).toEqual(new Set([2]));
  });

  it("treats a user turn after a non-ask_user step as a new run", () => {
    const turns: Turn[] = [user("q1"), step(tool("web_scan")), user("q2")];
    const groups = buildRunGroups(turns);
    expect(groups).toHaveLength(2);
    expect(groups[0].complete).toBe(false);
    expect(groups[0].foldable).toBe(false);
  });

  it("documents the abort-during-ask_user misgrouping: the group never folds", () => {
    // User aborted while ask_user was pending, then sent a fresh
    // question — heuristically misread as a reply. The group is
    // incomplete (no closing turn after the last member), so the
    // only cost is a missing rail dot, never a wrong fold.
    const turns: Turn[] = [user("q"), step(tool("ask_user")), user("新问题")];
    const groups = buildRunGroups(turns);
    expect(groups).toHaveLength(1);
    expect(groups[0].complete).toBe(false);
    expect(groups[0].foldable).toBe(false);
  });

  it("excludes Goal runs from folding", () => {
    const turns: Turn[] = [
      user("目标", "goal-1"),
      step(tool("web_scan")),
      closing(),
    ];
    const groups = buildRunGroups(turns);
    expect(groups[0].complete).toBe(true);
    expect(groups[0].foldable).toBe(false);
  });

  it("excludes runs containing system turns from folding", () => {
    const turns: Turn[] = [
      user("q"),
      step(tool("web_scan")),
      system(),
      closing(),
    ];
    expect(buildRunGroups(turns)[0].foldable).toBe(false);
  });

  it("folds single-step runs (the header is the run's only settled duration surface)", () => {
    // Reversed 2026-08-06: launch shipped stepCount >= 2 ("nothing to
    // hide"), but the footer-⏱ removal made the fold header the sole
    // home of settled elapsed time, and the folded render (header +
    // answer, no StrongHr) is quieter than the unfolded single-step
    // stack — so the fold pays even when the hidden set is empty.
    const turns: Turn[] = [user("q"), closing()];
    const groups = buildRunGroups(turns);
    expect(groups[0].complete).toBe(true);
    expect(groups[0].foldable).toBe(true);
    expect(groups[0].stats.stepCount).toBe(1);
  });

  it("collects orphan leading agent turns into an unfoldable headless group", () => {
    const turns: Turn[] = [closing("孤儿"), user("q"), closing()];
    const groups = buildRunGroups(turns);
    expect(groups).toHaveLength(2);
    expect(groups[0].openerIndex).toBe(-1);
    expect(groups[0].foldable).toBe(false);
    expect(groups[1].openerIndex).toBe(1);
  });

  it("a run waiting on ask_user is incomplete even though tools settle", () => {
    const turns: Turn[] = [user("q"), step(tool("ask_user"))];
    const groups = buildRunGroups(turns);
    expect(groups[0].complete).toBe(false);
  });

  it("aggregates stats: steps, elapsed, tool mix, denied", () => {
    const turns: Turn[] = [
      user("q"),
      step(tool("web_scan"), tool("web_scan")),
      step(tool("file_patch", "denied")),
      closing("done", 134_000),
    ];
    const g = buildRunGroups(turns)[0];
    expect(g.foldable).toBe(true);
    expect(g.stats.stepCount).toBe(3);
    expect(g.stats.elapsedMs).toBe(134_000);
    expect(g.stats.toolCounts).toEqual([
      { name: "web_scan", count: 2 },
      { name: "file_patch", count: 1 },
    ]);
    expect(g.stats.deniedCount).toBe(1);
  });

  it("closing turn must carry a non-empty answer", () => {
    const turns: Turn[] = [
      user("q"),
      step(tool("web_scan")),
      { role: "agent", tools: [tool("no_tool")], finalAnswer: "  " },
    ];
    expect(buildRunGroups(turns)[0].complete).toBe(false);
  });
});
