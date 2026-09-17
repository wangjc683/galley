import { invoke } from "@tauri-apps/api/core";

import type { useCopy } from "@/lib/i18n";
import type {
  GoalBrief,
  GoalStatus,
  StartSessionGoalInput,
  StartSessionGoalResult,
} from "@/types/goal";

type TopbarCopy = ReturnType<typeof useCopy>["topbar"];

/**
 * Time-ceiling choice for a Goal launch: minutes, or `null` for the
 * explicit no-ceiling escape. Ticket 10 (2026-09-17) moved the scale
 * from five log presets to a 10-minute ladder: the ceiling often maps
 * to an external deadline (a quota window resetting in 135 minutes),
 * which the log ladder could not express.
 */
export type GoalBudgetMinutes = number | null;

export const GOAL_BUDGET_STEP_MINUTES = 10;
export const GOAL_BUDGET_MIN_MINUTES = 10;
export const GOAL_BUDGET_MAX_MINUTES = 240;

/** The 10-minute ladder, ascending, then no ceiling. */
export const GOAL_BUDGET_LADDER: readonly GoalBudgetMinutes[] = [
  ...Array.from(
    {
      length:
        (GOAL_BUDGET_MAX_MINUTES - GOAL_BUDGET_MIN_MINUTES) /
          GOAL_BUDGET_STEP_MINUTES +
        1,
    },
    (_, i) => GOAL_BUDGET_MIN_MINUTES + i * GOAL_BUDGET_STEP_MINUTES,
  ),
  null,
];

/** Recommended ceiling, matching Rust `DEFAULT_GOAL_BUDGET_SECONDS`.
 * No-ceiling is an explicit choice, never the default: a Goal spends
 * the user's own API money (PRD §6 裁决 2). */
export const DEFAULT_GOAL_BUDGET_MINUTES: GoalBudgetMinutes = 60;

/** One step along the ladder; clamps at both ends. (Kept for keyboard
 * / stepper use; the wheel itself snaps by scroll position.) */
export function stepGoalBudget(
  current: GoalBudgetMinutes,
  direction: 1 | -1,
): GoalBudgetMinutes {
  const index = GOAL_BUDGET_LADDER.indexOf(current);
  const from =
    index === -1
      ? GOAL_BUDGET_LADDER.indexOf(DEFAULT_GOAL_BUDGET_MINUTES)
      : index;
  const next = Math.min(
    GOAL_BUDGET_LADDER.length - 1,
    Math.max(0, from + direction),
  );
  return GOAL_BUDGET_LADDER[next];
}

/** How much time one "give it more" hands a goal: 30 minutes. */
export const GOAL_EXTEND_SECONDS = 1800;

/** Eyebrow choice → the `budgetSeconds` Core wants: seconds, or
 * `null` for the explicit "no ceiling" choice. */
export function resolveGoalBudgetSeconds(
  minutes: GoalBudgetMinutes,
): number | null {
  return minutes === null ? null : minutes * 60;
}

/**
 * Bare stage word for a Goal status — `运行中` / `Running` etc. Used by
 * the TopBar popover status line, the sidebar subline, and the in-thread
 * markers (no `Goal ·` prefix needed inside the Goal surface itself).
 *
 * `completed` reads as "Done" rather than "Ready": the result exists and
 * is waiting to be read, not "ready to start".
 */
export function goalStageLabel(status: GoalStatus, copy: TopbarCopy): string {
  switch (status) {
    case "paused":
      return copy.goalStagePaused;
    case "blocked":
      return copy.goalStageBlocked;
    case "completed":
      return copy.goalStageDone;
    case "budget_limited":
      return copy.goalStageBudgetLimited;
    case "stopped":
      return copy.goalStageStopped;
    case "failed":
      return copy.goalStageFailed;
    default:
      return copy.goalStageRunning;
  }
}

/**
 * Compact pill label for the TopBar indicator and the Composer context
 * badge — `Goal · 运行中`. Stage-only: the elapsed clock lives in the
 * popover, because the pill should read as a stable phase.
 */
export function goalPillLabel(status: GoalStatus, copy: TopbarCopy): string {
  return `Goal · ${goalStageLabel(status, copy)}`;
}

/**
 * Title for the session a Goal is started on from the empty state —
 * `Goal · <objective>`, whitespace-collapsed and truncated so the
 * session-list row stays single-line. An empty objective falls back to
 * a bare `Goal`.
 */
export function goalSessionTitle(objective: string): string {
  const normalized = objective.replace(/\s+/g, " ").trim();
  if (!normalized) return "Goal";
  const limit = 44;
  if (normalized.length <= limit) return `Goal · ${normalized}`;
  return `Goal · ${normalized.slice(0, limit)}…`;
}

/** Open goals (active / paused / blocked), oldest first. */
export function listActiveGoals() {
  return invoke<GoalBrief[]>("list_active_goals");
}

/** Open goals plus unseen terminal results — the pill / sidebar list. */
export function listVisibleGoals() {
  return invoke<GoalBrief[]>("list_visible_goals");
}

/**
 * Every goal ever set on the session (any status, including terminal +
 * already-seen), oldest run first. Powers the in-thread commission /
 * terminal markers, which must survive after a goal leaves the visible
 * list so reopening a finished run is not amnesiac.
 */
export function listGoalsForSession(sessionId: string) {
  return invoke<GoalBrief[]>("list_goals_for_session", { sessionId });
}

export function getGoal(id: string) {
  return invoke<GoalBrief>("goal_status", { id });
}

export function markGoalResultSeen(id: string) {
  return invoke<GoalBrief>("mark_goal_result_seen", { id });
}

/** Terminal `stopped` plus an abort of the in-flight run. No wrap-up. */
export function stopGoal(id: string) {
  return invoke<GoalBrief>("request_goal_stop", { id });
}

/**
 * Give a goal more time. Core raises `budgetSeconds` by `extraSeconds`,
 * flips a `budget_limited` goal back to `active`, clears `endedAt`, and
 * dispatches the next continuation itself — the GUI only has to render
 * the brief it gets back (which also arrives through `goal-updated`).
 *
 * Errors with `invalid_args` when the goal is neither `active` nor
 * `budget_limited`, or when it has no ceiling to raise.
 */
export function extendGoal(id: string, extraSeconds: number) {
  return invoke<GoalBrief>("extend_goal", { id, extraSeconds });
}

/**
 * Set a goal on a session and dispatch its opening turn. The objective
 * row in the returned result is informational only — the same row is
 * broadcast through `user-message-persisted`, and that is the path the
 * thread renders from (appending both would double-render it).
 */
export function startSessionGoal(input: StartSessionGoalInput) {
  return invoke<StartSessionGoalResult>("start_session_goal", { input });
}
