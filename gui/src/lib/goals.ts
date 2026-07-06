import { invoke } from "@tauri-apps/api/core";

import type { useCopy } from "@/lib/i18n";
import type {
  GoalBrief,
  GoalStatus,
  GoalStatusSnapshot,
  GoalWorkerContext,
  StartDesktopGoalInput,
  StartDesktopGoalResult,
} from "@/types/goal";

type TopbarCopy = ReturnType<typeof useCopy>["topbar"];

/**
 * Bare stage word for a Goal status — `运行中` / `Running` etc.
 * Used by the TopBar popover status line (no `Goal ·` prefix needed
 * inside the Goal surface itself).
 *
 * `completed` reads as "Done" rather than "Ready": the result exists
 * and is waiting to be read, not "ready to start" — the latter is the
 * exact misread we want to avoid on a finished Goal.
 */
export function goalStageLabel(
  status: GoalStatus,
  copy: TopbarCopy,
): string {
  switch (status) {
    case "wrapping":
      return copy.goalStageWrapping;
    case "completed":
      return copy.goalStageDone;
    case "failed":
      return copy.goalStageFailed;
    case "stopped":
      return copy.goalStageStopped;
    default:
      return copy.goalStageRunning;
  }
}

/**
 * Compact pill label for the TopBar indicator and the Composer context
 * badge — `Goal · 运行中`. Stage-only: the live countdown lives in the
 * popover, because the pill should read as a stable phase, not a
 * number that ticks to zero (deadline is "stop dispatching new work",
 * not "result delivered").
 */
export function goalPillLabel(status: GoalStatus, copy: TopbarCopy): string {
  return `Goal · ${goalStageLabel(status, copy)}`;
}

/**
 * Title for a Goal's master session — `Goal · <objective>`, with the
 * objective whitespace-collapsed and truncated so the session-list row
 * stays single-line. An empty objective falls back to a bare `Goal`.
 */
export function goalMasterSessionTitle(objective: string): string {
  const normalized = objective.replace(/\s+/g, " ").trim();
  if (!normalized) return "Goal";
  const limit = 44;
  if (normalized.length <= limit) return `Goal · ${normalized}`;
  return `Goal · ${normalized.slice(0, limit)}…`;
}

export function listActiveGoals() {
  return invoke<GoalBrief[]>("list_active_goals");
}

export function listVisibleGoals() {
  return invoke<GoalBrief[]>("list_visible_goals");
}

/**
 * All goals whose master session is `sessionId` (any status, including
 * terminal + already-seen), oldest run first. Powers the in-thread Goal
 * commission / terminal markers, which must survive after a goal leaves
 * the active / visible lists so reopening a finished run is not
 * amnesiac.
 */
export function listGoalsForSession(sessionId: string) {
  return invoke<GoalBrief[]>("list_goals_for_session", { sessionId });
}

export function getGoalStatus(id: string) {
  return invoke<GoalStatusSnapshot>("goal_status", { id });
}

/**
 * Worker-session orientation — resolves "which Goal does this session
 * work for, on what task" via the backend's `goal_tasks.owner_session_id`
 * reverse lookup. Null for non-worker sessions (including masters).
 */
export function getGoalContextForSession(sessionId: string) {
  return invoke<GoalWorkerContext | null>("goal_context_for_session", {
    sessionId,
  });
}

export function markGoalResultSeen(id: string) {
  return invoke<GoalBrief>("mark_goal_result_seen", { id });
}

export function stopGoal(id: string) {
  return invoke<GoalBrief>("request_goal_stop", { id });
}

export function goalWorkspaceHasFiles(id: string) {
  return invoke<boolean>("goal_workspace_has_files", { id });
}

export function startDesktopGoal(input: StartDesktopGoalInput) {
  return invoke<StartDesktopGoalResult>("start_desktop_goal", { input });
}
