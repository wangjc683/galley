import { describe, expect, it } from "vitest";

import {
  buildRunGroups,
  liveRunElapsedBaseMs,
  pendingReplyStepBase,
  replyUserIndices,
} from "@/lib/run-groups";
import type {
  AgentTurn,
  ConversationToolEvent,
  MessageTelemetry,
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

/** An ask_user pause: the GA loop exits here, so like a closing turn
 * it carries that loop's cumulative telemetry. */
function askStep(telemetry?: MessageTelemetry): AgentTurn {
  return {
    role: "agent",
    tools: [tool("ask_user")],
    finalAnswer: null,
    telemetry,
  };
}

function closingWith(telemetry: MessageTelemetry, answer = "结论"): AgentTurn {
  return {
    role: "agent",
    tools: [tool("no_tool")],
    finalAnswer: answer,
    telemetry,
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

  it("marks a live run foldEligible so the conversation can window it", () => {
    // live-run-window (2026-09-16): an incomplete user-opened run is
    // not foldable (no answer to stand in for the process) but IS
    // eligible — that is what lets its completed steps fold behind
    // the live header while it runs. Goal runs and /btw runs stay
    // out, live or settled.
    const live = buildRunGroups([user("q"), step(tool("web_fetch")), step(tool("web_fetch"))])[0];
    expect(live.complete).toBe(false);
    expect(live.foldable).toBe(false);
    expect(live.foldEligible).toBe(true);
    expect(live.stats.stepCount).toBe(2);

    const goal = buildRunGroups([user("q", "g1"), step(tool("web_fetch"))])[0];
    expect(goal.foldEligible).toBe(false);
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

  describe("segments around ask_user (2026-09-18)", () => {
    // Each ask_user pause ends one GA loop; the runner's clock and
    // token baseline restart at the reply. Whole-run figures sum the
    // segment closers so "10 步" and the duration describe the same
    // span.
    it("sums elapsed time across the segments an ask_user split", () => {
      const turns: Turn[] = [
        user("q"),
        step(tool("web_scan")),
        askStep({ elapsedMs: 80_000 }),
        user("选 A"),
        askStep({ elapsedMs: 5_000 }),
        user("选 B"),
        step(tool("file_patch")),
        closing("done", 45_000),
      ];
      const g = buildRunGroups(turns)[0];
      expect(g.complete).toBe(true);
      expect(g.stats.stepCount).toBe(5);
      expect(g.stats.askUserCount).toBe(2);
      expect(g.stats.elapsedMs).toBe(130_000);
    });

    it("goes blank rather than partial when a segment lacks telemetry", () => {
      const turns: Turn[] = [
        user("q"),
        askStep(),
        user("选 A"),
        closing("done", 45_000),
      ];
      const g = buildRunGroups(turns)[0];
      expect(g.stats.elapsedMs).toBeNull();
      expect(g.stats.telemetry?.elapsedMs).toBeNull();
    });

    it("merges the answer footer telemetry: additive fields summed, context from the last segment", () => {
      const turns: Turn[] = [
        user("q"),
        askStep({
          elapsedMs: 80_000,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 300,
          requestCount: 2,
          contextUsedChars: 50_000,
          contextLimitChars: 300_000,
        }),
        user("选 A"),
        closingWith({
          elapsedMs: 45_000,
          inputTokens: 500,
          outputTokens: 100,
          cacheReadTokens: 400,
          requestCount: 1,
          contextUsedChars: 70_000,
          contextLimitChars: 300_000,
        }),
      ];
      const g = buildRunGroups(turns)[0];
      expect(g.stats.telemetry).toEqual({
        elapsedMs: 125_000,
        inputTokens: 1500,
        outputTokens: 300,
        cacheCreateTokens: null,
        cacheReadTokens: 700,
        requestCount: 3,
        contextUsedChars: 70_000,
        contextLimitChars: 300_000,
      });
    });

    it("a single-segment run's telemetry is the closing turn's, unchanged", () => {
      const closer = closingWith({
        elapsedMs: 9_000,
        inputTokens: 10,
        contextUsedChars: 5,
      });
      const g = buildRunGroups([user("q"), step(tool("a")), closer])[0];
      expect(g.stats.elapsedMs).toBe(9_000);
      expect(g.stats.telemetry).toMatchObject({
        elapsedMs: 9_000,
        inputTokens: 10,
        contextUsedChars: 5,
      });
    });

    it("keeps whole-run telemetry null while the run is open", () => {
      const g = buildRunGroups([user("q"), askStep({ elapsedMs: 80_000 })])[0];
      expect(g.stats.telemetry).toBeNull();
      expect(g.stats.elapsedMs).toBeNull();
    });

    it("pendingReplyStepBase: the run's step count when the next user turn answers ask_user", () => {
      const waiting: Turn[] = [user("q"), step(tool("a")), askStep()];
      expect(pendingReplyStepBase(waiting)).toBe(2);
      // System bystanders (/btw) between the question and the reply
      // do not hide it.
      expect(pendingReplyStepBase([...waiting, system()])).toBe(2);
      // Across an earlier answered question the count keeps growing.
      expect(
        pendingReplyStepBase([
          ...waiting,
          user("选 A"),
          step(tool("b")),
          askStep(),
        ]),
      ).toBe(4);
    });

    it("pendingReplyStepBase: 0 when the next user turn opens a new run", () => {
      expect(pendingReplyStepBase([])).toBe(0);
      expect(
        pendingReplyStepBase([user("q"), step(tool("a")), closing()]),
      ).toBe(0);
      expect(pendingReplyStepBase([user("q"), step(tool("a"))])).toBe(0);
      // The reply itself is already appended → the next turn is a new run.
      expect(pendingReplyStepBase([user("q"), askStep(), user("选 A")])).toBe(
        0,
      );
    });

    it("liveRunElapsedBaseMs: banks answered segments, skips the current one and unknowns", () => {
      const turns: Turn[] = [
        user("q"),
        askStep({ elapsedMs: 80_000 }),
        user("选 A"),
        askStep(),
        user("选 B"),
        step(tool("a")),
      ];
      expect(liveRunElapsedBaseMs(turns)).toBe(80_000);
      // A pending (unanswered) pause is not banked — the run is not live.
      expect(
        liveRunElapsedBaseMs([user("q"), askStep({ elapsedMs: 80_000 })]),
      ).toBe(0);
      // A settled run has nothing live to add to.
      expect(
        liveRunElapsedBaseMs([
          user("q"),
          askStep({ elapsedMs: 80_000 }),
          user("选 A"),
          closing("done", 1_000),
        ]),
      ).toBe(0);
      // A fresh run starts from zero.
      expect(liveRunElapsedBaseMs([user("q")])).toBe(0);
    });
  });
});
