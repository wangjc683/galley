import type { Origin } from "@/types/conversation";

/**
 * Goal v2 state machine (.scratch/goal-simplify/PRD.md §3.2), mirroring
 * Rust `api::GoalStatus`.
 *
 *   - `active`   — Core re-dispatches a continuation on every idle.
 *   - `paused`   — user aborted the run, or Core restarted. Recoverable:
 *                  the session's next user message resumes it.
 *   - `blocked`  — the model declared a blocker, or the run errored.
 *                  Recoverable the same way; the difference is who judged.
 *   - `completed` / `budget_limited` / `stopped` / `failed` — terminal.
 */
export type GoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "completed"
  | "budget_limited"
  | "stopped"
  | "failed";

/** Open = still owns the session's idle time, or can get it back with
 * one user message. The set the per-session uniqueness index guards. */
export const OPEN_GOAL_STATUSES: readonly GoalStatus[] = [
  "active",
  "paused",
  "blocked",
];

export function isOpenGoalStatus(status: GoalStatus): boolean {
  return OPEN_GOAL_STATUSES.includes(status);
}

export function isTerminalGoalStatus(status: GoalStatus): boolean {
  return !isOpenGoalStatus(status);
}

/** Wire twin of Rust `api::GoalBrief` (camelCase JSON). */
export interface GoalBrief {
  id: string;
  /** The session this goal drives — exactly one, for its whole life. */
  sessionId: string;
  objective: string;
  status: GoalStatus;
  /** Time ceiling in seconds. Absent = no ceiling. */
  budgetSeconds?: number;
  startedAt: string;
  endedAt?: string;
  pausedAt?: string;
  latestSummary?: string;
  resultSeenAt?: string;
  /** Continuations Core has dispatched so far (the wrap-up one included). */
  continuationCount: number;
  /** True once the budget-limit wrap-up continuation went out. */
  wrapUpDispatched: boolean;
  /** Wall-clock seconds from `startedAt` to `endedAt` (terminal) or to
   * the read (open). Computed by Core, never stored — the GUI reads it
   * straight instead of running its own clock. */
  elapsedSeconds: number;
  createdAt: string;
  updatedAt: string;
  /** Who set the goal. Absent for GUI-set goals. */
  origin?: Origin;
}

/** Input for the `start_session_goal` command. `budgetSeconds: null` is
 * the explicit "no ceiling" choice; the GUI always sends the field. */
export interface StartSessionGoalInput {
  sessionId: string;
  objective: string;
  budgetSeconds?: number | null;
}

/** Persisted message row echoed back by `start_session_goal`. The GUI
 * does NOT render it from here — the same row arrives through
 * `user-message-persisted`, which is the single mirror path. */
export interface GoalObjectiveMessage {
  id: string;
  sessionId: string;
  role: "user" | "agent" | "system";
  content: string;
  createdAt: string;
  summary?: string;
  turnIndex?: number;
  goalId?: string;
  origin?: Origin;
}

export interface StartSessionGoalResult {
  goal: GoalBrief;
  message: GoalObjectiveMessage;
  /** Always `"dispatched"` — a dispatch failure is an error, never a
   * half-started goal. */
  dispatch: string;
}

/** What the confirm dialog resolves to. `budgetSeconds: null` = no
 * ceiling (an explicit user choice, never a default). */
export interface GoalLaunchConfig {
  budgetSeconds: number | null;
}
