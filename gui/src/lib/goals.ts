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
 * Time-ceiling choices in the launch dialog (JC, 2026-09-16): five
 * log-spaced minute presets, the explicit no-ceiling escape, and a
 * custom minutes field. Log spacing, not linear — the interesting jump
 * is "an errand" vs "an afternoon", and a linear 30/60/90/120 ladder
 * spends four slots inside one order of magnitude.
 */
export const GOAL_BUDGET_PRESET_MINUTES = [15, 30, 60, 120, 240] as const;

export type GoalBudgetPreset =
  | `${(typeof GOAL_BUDGET_PRESET_MINUTES)[number]}`
  | "none"
  | "custom";

/** Recommended ceiling, matching Rust `DEFAULT_GOAL_BUDGET_SECONDS`.
 * No-ceiling is an explicit choice, never the default: a Goal spends
 * the user's own API money (PRD §6 裁决 2). */
export const DEFAULT_GOAL_BUDGET_PRESET: GoalBudgetPreset = "60";

/** Floor for the custom field. Under five minutes a Goal cannot finish
 * even its first continuation, so the ceiling would only ever produce a
 * `budget_limited` run with nothing in it. No upper bound — that is
 * what "no ceiling" is for, and a big number is the user's call. */
export const GOAL_CUSTOM_BUDGET_MIN_MINUTES = 5;

/** How much time one "give it more" hands a goal: 30 minutes. */
export const GOAL_EXTEND_SECONDS = 1800;

/**
 * Launch-dialog choice → the `budgetSeconds` Core wants.
 *
 *   - `number`    — a ceiling, in seconds.
 *   - `null`      — the explicit "no ceiling" choice.
 *   - `undefined` — not a usable choice yet (custom field empty, not a
 *     plain integer, or under the floor). The dialog disables Send on
 *     this, so `undefined` never reaches the command.
 *
 * Sub-minute precision is deliberately unavailable: the field is in
 * minutes and a fractional entry is rejected rather than rounded, so
 * what the user typed is always what the goal got.
 */
export function resolveGoalBudgetSeconds(
  preset: GoalBudgetPreset,
  customMinutes: string,
): number | null | undefined {
  if (preset === "none") return null;
  if (preset !== "custom") return Number.parseInt(preset, 10) * 60;
  const raw = customMinutes.trim();
  if (!/^\d+$/.test(raw)) return undefined;
  const minutes = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(minutes)) return undefined;
  if (minutes < GOAL_CUSTOM_BUDGET_MIN_MINUTES) return undefined;
  return minutes * 60;
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
