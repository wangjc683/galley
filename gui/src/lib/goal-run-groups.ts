// Goal-aware view of the run grouping (goal-simplify issue 08, 2026-09-16).
//
// `run-groups.ts` decides run shape from turns alone and refuses to fold
// a run whose opener carries a `goalId` (the 08-06 verdict: a Goal has its
// own commission / terminal bracket). Goal v2 reverses that verdict: a
// goal can run for a hundred steps, and its bracket is not a substitute
// for the process fold — it wraps it. This module applies the goal rules
// on top of the shape grouping without touching it:
//
//   1. Liveness follows the goal, not `agentRunning`. Core dispatches
//      the next continuation the instant a run settles, so the bridge's
//      run gate flickers at every boundary; the goal's `active` status
//      does not.
//   2. Every goal group that is not the live one folds — paused,
//      blocked, terminal, and the segments before a mid-run steering
//      message. The paused tail and the terminal marker carry the scar
//      the "never fold an unanswered run" rule exists for.
//   3. Only a terminal goal has a final answer: the closing turn of the
//      goal's LAST group when the goal ended `completed` or
//      `budget_limited` renders flat as the deliverable. Every other
//      closing-shaped turn (a continuation's progress note) is a step.
//   4. Steps are numbered by position within their group — every
//      group, not only goal groups (2026-09-18): GA restarts its turn
//      counter at every `put_task`, which is each goal continuation AND
//      each ask_user reply, so an ordinary run's steps read 1 2 3 1 2
//      around a question. Position numbering hides both restarts and
//      the internal-row gaps restore would otherwise show.
//   5. A goal group's settled header shows no duration — the terminal
//      marker owns the goal's elapsed time.
//
// A "goal group" is any group whose opener sits inside a goal's thread
// segment as `annotateGoalThread` brackets it: the objective turn's own
// group and every group a mid-run user message opened after it.

import { annotateGoalThread } from "@/lib/goal-thread";
import type { RunGroup } from "@/lib/run-groups";
import type { Turn } from "@/types/conversation";
import { isOpenGoalStatus, type GoalBrief } from "@/types/goal";

export interface GoalRunPlan {
  /** The groups with the goal rules applied. Same order and member
   * indices as the input; only `complete` / `foldable` /
   * `foldEligible` / `finalTurnIndex` / `stats.elapsedMs` change, and
   * only on goal groups. */
  groups: RunGroup[];
  /** The run the conversation renders as the live window, or null. */
  liveGroup: RunGroup | null;
  /** Opener index → the goal whose segment the group sits in. */
  goalOfGroup: Map<number, GoalBrief>;
  /** Turn index → display step number for every agent turn in a
   * user-opened group (1-based, by position within the group, so an
   * ask_user reply does not restart the count). Headless leading
   * groups are absent and fall back to GA's own step. */
  stepNumberOf: Map<number, number>;
}

/** Which goal (if any) each turn belongs to, by walking the annotated
 * thread: a commission opens a segment, the terminal marker (or the
 * end of the thread for an open goal) closes it. */
export function goalOfTurns(turns: Turn[], goals: GoalBrief[]): (GoalBrief | null)[] {
  const result: (GoalBrief | null)[] = new Array(turns.length).fill(null);
  if (goals.length === 0) return result;
  let cursor = 0;
  let current: GoalBrief | null = null;
  for (const item of annotateGoalThread(turns, goals)) {
    if (item.kind === "commission") {
      current = item.goal;
      result[cursor] = current;
      cursor += 1;
    } else if (item.kind === "terminal") {
      current = null;
    } else {
      result[cursor] = current;
      cursor += 1;
    }
  }
  return result;
}

function isDeliverableStatus(goal: GoalBrief): boolean {
  return goal.status === "completed" || goal.status === "budget_limited";
}

/** A goal group is being worked on while its goal is `active`, and
 * also while the agent is running on a paused / blocked goal — that
 * run is the user resuming it, and Core flips the status to `active`
 * on its first turn_start; this covers the gap until that event lands
 * (and a Core that is mid-upgrade). */
function goalRunning(goal: GoalBrief, agentRunning: boolean): boolean {
  return goal.status === "active" || (isOpenGoalStatus(goal.status) && agentRunning);
}

export function planGoalRuns(
  turns: Turn[],
  goals: GoalBrief[],
  groups: RunGroup[],
  agentRunning: boolean,
  askUserPending: boolean,
): GoalRunPlan {
  const goalOf = goalOfTurns(turns, goals);
  const goalOfGroup = new Map<number, GoalBrief>();
  const lastGroupOfGoal = new Map<string, number>();
  for (const g of groups) {
    if (g.openerIndex < 0) continue;
    const goal = goalOf[g.openerIndex];
    if (!goal) continue;
    goalOfGroup.set(g.openerIndex, goal);
    lastGroupOfGoal.set(goal.id, g.openerIndex);
  }

  const lastOpener = groups.length ? groups[groups.length - 1].openerIndex : null;
  const stepNumberOf = new Map<number, number>();
  const planned = groups.map((g) => {
    if (g.openerIndex >= 0) {
      let step = 0;
      for (const i of g.memberIndices) {
        if (turns[i].role === "agent") stepNumberOf.set(i, ++step);
      }
    }
    const goal = goalOfGroup.get(g.openerIndex);
    if (!goal) return g;
    const isLast = g.openerIndex === lastOpener;
    const live = goalRunning(goal, agentRunning) && isLast;
    const finalTurnIndex =
      isDeliverableStatus(goal) &&
      lastGroupOfGoal.get(goal.id) === g.openerIndex
        ? g.finalTurnIndex
        : null;
    return {
      ...g,
      complete: !live,
      foldEligible: true,
      foldable: !live,
      finalTurnIndex,
      stats: { ...g.stats, elapsedMs: null },
    };
  });

  const last = planned[planned.length - 1];
  let liveGroup: RunGroup | null = null;
  if (last) {
    const goal = goalOfGroup.get(last.openerIndex);
    const running = goal ? goalRunning(goal, agentRunning) : agentRunning;
    if (!last.complete && last.foldEligible && (running || askUserPending)) {
      liveGroup = last;
    }
  }
  return { groups: planned, liveGroup, goalOfGroup, stepNumberOf };
}

/** True when the live window already holds a settled step above the
 * in-flight row — the signal MainView uses to run the in-flight rail
 * up through the gap to the window instead of starting fresh. For an
 * ordinary run this is "the current step is not the first"; for a goal
 * group GA's counter restarts at every continuation, so the plan is
 * the only honest source. */
export function liveWindowHasSettledStep(plan: GoalRunPlan, turns: Turn[]): boolean {
  const g = plan.liveGroup;
  if (!g) return false;
  return g.memberIndices.some(
    (i) => i !== g.openerIndex && i !== g.finalTurnIndex && turns[i].role === "agent",
  );
}
