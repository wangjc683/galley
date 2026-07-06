import type { Origin, Turn } from "@/types/conversation";
import type { GoalBrief } from "@/types/goal";

/**
 * A master session's conversation thread can contain multiple Goal runs
 * over time (a session reuses its id as the master for each goal it
 * commissions), interleaved with normal chat. This module turns the
 * flat `Turn[]` + the session's goals into a render list that brackets
 * each run as an in-thread episode:
 *
 *   - `commission` — the objective the operator sent in Goal mode,
 *     rendered as the run's opening marker (it IS the first user turn,
 *     just crowned; see GoalCommissionMarker). Opens the episode.
 *   - the run's Galley narration callouts sit between.
 *   - `terminal` — the run's outcome (done / failed / stopped), placed
 *     right after the run's narration block. Closes the episode.
 *
 * Association is exact-first: objective user turns written since
 * migration 031 carry `goalId`, so those match by id. Rows written
 * before 031 have no goalId and fall back to the original heuristic —
 * the user turn whose normalized content equals the objective and whose
 * `createdAt` is closest to the goal's `startedAt`. Either way an
 * unmatched goal degrades gracefully: it simply renders no markers and
 * its narration stays as plain (still lightened) callouts.
 *
 * `narrationLeading` lets the renderer show the Galley register glyph
 * only on the first of a consecutive narration cluster, so a run with
 * many beats doesn't repeat the marker on every line.
 */
export type GoalThreadItem =
  | { kind: "turn"; turn: Turn; narrationLeading: boolean }
  | {
      kind: "commission";
      goal: GoalBrief;
      content: string;
      origin?: Origin;
      createdAt?: string;
    }
  | { kind: "task-board"; goal: GoalBrief }
  | { kind: "terminal"; goal: GoalBrief };

const TERMINAL_STATUSES = new Set(["completed", "failed", "stopped"]);

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function isGoalNarrationTurn(t: Turn): boolean {
  return t.role === "system" && t.variant === "goal";
}

/**
 * Match each goal to the array index of the user turn that commissioned
 * it. Pass 1 is exact: turns carrying `goalId` (rows written since
 * migration 031) match their goal by id. Pass 2 runs the legacy
 * heuristic ONLY over goalId-less turns × still-unmatched goals — a
 * turn stamped with some other goal's id must never be claimed by text
 * equality. Each turn matches at most one goal and vice-versa; when
 * several goals share identical objective text, the closest `startedAt`
 * ↔ `createdAt` pairing wins so distinct runs map to distinct turns.
 */
function matchCommissions(
  turns: Turn[],
  goals: GoalBrief[],
): Map<number, GoalBrief> {
  const byTurnIndex = new Map<number, GoalBrief>();
  const usedTurns = new Set<number>();
  const matchedGoals = new Set<string>();

  turns.forEach((t, idx) => {
    if (t.role !== "user" || !t.goalId) return;
    const goal = goals.find((g) => g.id === t.goalId);
    if (!goal || matchedGoals.has(goal.id)) return;
    byTurnIndex.set(idx, goal);
    usedTurns.add(idx);
    matchedGoals.add(goal.id);
  });

  const ordered = [...goals]
    .filter((goal) => !matchedGoals.has(goal.id))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const goal of ordered) {
    const objective = norm(goal.objective);
    const startedTs = Date.parse(goal.startedAt);
    let bestIdx = -1;
    let bestDelta = Number.POSITIVE_INFINITY;
    turns.forEach((t, idx) => {
      if (t.role !== "user" || usedTurns.has(idx)) return;
      // A goalId-stamped turn belongs to its own goal (matched above or
      // not at all) — never lend it to another goal via text equality.
      if (t.goalId) return;
      if (norm(t.content) !== objective) return;
      const ts = t.createdAt ? Date.parse(t.createdAt) : Number.NaN;
      const delta =
        !Number.isNaN(ts) && !Number.isNaN(startedTs)
          ? Math.abs(ts - startedTs)
          : Number.POSITIVE_INFINITY;
      if (bestIdx === -1 || delta < bestDelta) {
        bestIdx = idx;
        bestDelta = delta;
      }
    });
    if (bestIdx !== -1) {
      byTurnIndex.set(bestIdx, goal);
      usedTurns.add(bestIdx);
    }
  }
  return byTurnIndex;
}

export function annotateGoalThread(
  turns: Turn[],
  goals: GoalBrief[],
): GoalThreadItem[] {
  const commissionByIndex = goals.length
    ? matchCommissions(turns, goals)
    : new Map<number, GoalBrief>();

  const items: GoalThreadItem[] = [];
  let currentRunGoal: GoalBrief | null = null;
  let prevWasNarration = false;

  const closeRun = () => {
    if (currentRunGoal && TERMINAL_STATUSES.has(currentRunGoal.status)) {
      // Frozen task board above the terminal marker: what ran, what
      // completed, result summaries. For failed goals this is the
      // legacy accounting. (The LIVE board for a still-running goal is
      // pinned at the thread tail by MainView, not emitted here.)
      items.push({ kind: "task-board", goal: currentRunGoal });
      items.push({ kind: "terminal", goal: currentRunGoal });
    }
    currentRunGoal = null;
  };

  turns.forEach((t, idx) => {
    const commissionGoal = commissionByIndex.get(idx);
    if (commissionGoal) {
      // A new commission closes the previous run's bracket first.
      closeRun();
      items.push({
        kind: "commission",
        goal: commissionGoal,
        content: t.role === "user" ? t.content : "",
        origin: t.role === "user" ? t.origin : undefined,
        createdAt: t.role === "user" ? t.createdAt : undefined,
      });
      currentRunGoal = commissionGoal;
      prevWasNarration = false;
      return;
    }

    const narration = isGoalNarrationTurn(t);
    // The run's in-thread segment is its commission + the consecutive
    // narration block. The first non-narration turn after it ends the
    // run, so the terminal marker lands right after the narration,
    // before any subsequent normal chat.
    if (currentRunGoal && !narration) {
      closeRun();
    }
    items.push({
      kind: "turn",
      turn: t,
      narrationLeading: narration ? !prevWasNarration : false,
    });
    prevWasNarration = narration;
  });

  closeRun();
  return items;
}
