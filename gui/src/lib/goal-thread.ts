import { buildRunGroups, replyUserIndices } from "@/lib/run-groups";
import type { Origin, Turn } from "@/types/conversation";
import { isTerminalGoalStatus, type GoalBrief } from "@/types/goal";

/**
 * A session's conversation thread can carry several Goal runs over its
 * life (at most one open at a time), interleaved with normal chat. This
 * module turns the flat `Turn[]` + the session's goals into a render
 * list that brackets each run as an in-thread episode:
 *
 *   - `commission` — the objective the operator sent in Goal mode,
 *     rendered as the run's opening marker (it IS the first user turn,
 *     just crowned; see GoalCommissionMarker). Opens the episode.
 *   - the run's own agent steps and continuations sit between — in
 *     goal v2 they are ordinary turns, not narration.
 *   - `terminal` — the run's outcome (done / budget-limited / stopped /
 *     failed). Closes the episode.
 *
 * Where the episode ends (PRD §3.7): at the next commission, or just
 * before the first non-reply user turn the operator sent AFTER the goal
 * ended. Everything in between — agent steps, continuations, and the
 * mid-run messages the operator sent to steer the run — stays inside
 * the bracket. The v1 rule ("first non-narration turn closes it") put
 * the terminal marker above the work in a single-threaded run; that was
 * the bug this rewrite fixes.
 *
 * Association is exact-first: objective user turns written since
 * migration 031 carry `goalId`, so those match by id. Rows written
 * before 031 have no goalId and fall back to the original heuristic —
 * the user turn whose normalized content equals the objective and whose
 * `createdAt` is closest to the goal's `startedAt`. Either way an
 * unmatched goal degrades gracefully: it simply renders no markers.
 *
 * `narrationLeading` lets the renderer show the Galley register glyph
 * only on the first of a consecutive narration cluster (legacy goal v1
 * threads still hold those rows), so a run with many beats doesn't
 * repeat the marker on every line.
 */
export type GoalThreadItem =
  | { kind: "turn"; turn: Turn; narrationLeading: boolean }
  | {
      kind: "commission";
      goal: GoalBrief;
      /** The objective user turn itself — the run opener, so the
       * conversation can key its fold / live header on it. */
      turn: Turn;
      content: string;
      origin?: Origin;
      createdAt?: string;
    }
  | { kind: "terminal"; goal: GoalBrief };

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

/**
 * Does this user turn end the goal's in-thread segment? Only a turn the
 * operator sent AFTER the goal reached its end does — a message sent
 * mid-run is an intervention and belongs inside the bracket, and an
 * ask_user reply is not a new topic at all.
 *
 * A user turn with no `createdAt` (a legacy row, or one appended
 * optimistically before the row came back) counts as after the goal: an
 * undated turn at the tail is far likelier to be new chat than a
 * replayed mid-run message, and the alternative swallows the rest of
 * the thread into the episode.
 */
function endsGoalSegment(
  turn: Turn,
  index: number,
  goal: GoalBrief,
  replies: Set<number>,
): boolean {
  if (turn.role !== "user") return false;
  if (replies.has(index)) return false;
  if (!goal.endedAt) return false;
  if (!turn.createdAt) return true;
  const turnTs = Date.parse(turn.createdAt);
  const endedTs = Date.parse(goal.endedAt);
  if (Number.isNaN(turnTs) || Number.isNaN(endedTs)) return true;
  return turnTs > endedTs;
}

export function annotateGoalThread(
  turns: Turn[],
  goals: GoalBrief[],
): GoalThreadItem[] {
  const commissionByIndex = goals.length
    ? matchCommissions(turns, goals)
    : new Map<number, GoalBrief>();

  // An ask_user reply is an answer inside the run, not a new topic, so
  // it never closes the episode. Same definition the conversation uses
  // to switch MessageUser into its reply register (`run-groups.ts`).
  const replies = replyUserIndices(buildRunGroups(turns), turns);

  const items: GoalThreadItem[] = [];
  let currentRunGoal: GoalBrief | null = null;
  let prevWasNarration = false;

  const closeRun = () => {
    // `paused` / `blocked` are recoverable, not terminal — no closing
    // marker; the thread tail carries them instead (GoalPausedTail).
    if (currentRunGoal && isTerminalGoalStatus(currentRunGoal.status)) {
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
        turn: t,
        content: t.role === "user" ? t.content : "",
        origin: t.role === "user" ? t.origin : undefined,
        createdAt: t.role === "user" ? t.createdAt : undefined,
      });
      currentRunGoal = commissionGoal;
      prevWasNarration = false;
      return;
    }

    if (currentRunGoal && endsGoalSegment(t, idx, currentRunGoal, replies)) {
      closeRun();
    }
    const narration = isGoalNarrationTurn(t);
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
