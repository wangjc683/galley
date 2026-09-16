import type { Dispatch, SetStateAction } from "react";

import type { AppCopy } from "@/lib/i18n";
import {
  GOAL_EXTEND_SECONDS,
  extendGoal,
  getGoal,
  goalSessionTitle,
  markGoalResultSeen,
  startSessionGoal,
  stopGoal,
} from "@/lib/goals";
import { makeAppError } from "@/types/app-error";
import {
  isTerminalGoalStatus,
  type GoalBrief,
  type GoalLaunchConfig,
} from "@/types/goal";
import type { Session } from "@/types/session";

/**
 * Goal command layer: start a Goal from the composer, open a Goal's
 * session, and stop a Goal from the topbar / thread. These are the
 * imperative counterparts to `useGoalEffects` (which owns the goal
 * lists, the `goal-updated` subscription, and the poll); this hook only
 * issues commands and folds their results back through `setActiveGoals`.
 *
 * A goal v2 run has no project container and no worker sessions: it
 * lives on one ordinary session, so "open the goal" is "activate its
 * session" and nothing else.
 */
export function useGoalActions({
  activeGoals,
  activeSession,
  activeProjectFilter,
  requiresManagedModelConfig,
  copy,
  createSessionPersisted,
  setScreen,
  setActiveProjectFilter,
  activateSession,
  setActiveGoals,
  pushToast,
  openModelsForMissingConfig,
}: {
  activeGoals: GoalBrief[];
  activeSession: Session | undefined;
  activeProjectFilter: string | undefined;
  requiresManagedModelConfig: boolean;
  copy: AppCopy;
  createSessionPersisted: (
    projectId?: string,
    title?: string,
  ) => Promise<string>;
  setScreen: (s: "empty" | "main" | "onboarding") => void;
  setActiveProjectFilter: (id: string | undefined) => void;
  activateSession: (id: string) => Promise<void>;
  setActiveGoals: Dispatch<SetStateAction<GoalBrief[]>>;
  pushToast: (error: ReturnType<typeof makeAppError>) => void;
  openModelsForMissingConfig: () => void;
}) {
  const startGoalFromComposer = async (
    objective: string,
    config: GoalLaunchConfig,
  ) => {
    if (requiresManagedModelConfig) {
      openModelsForMissingConfig();
      return;
    }
    try {
      let sessionId = activeSession?.id;
      const createdSession = sessionId === undefined;
      if (!sessionId) {
        // No setScreen here: flipping to "main" now would unmount the
        // empty-state Composer mid-submit — the confirm dialog (and its
        // "启动中…" spinner) vanishes while the start call is still
        // running, leaving the user staring at a blank new session that
        // looks hung. The screen flips at the end, once the goal exists;
        // on failure the user stays in the empty state with the dialog
        // and draft intact.
        sessionId = await createSessionPersisted(
          activeProjectFilter,
          goalSessionTitle(objective),
        );
      }
      const { goal } = await startSessionGoal({
        sessionId,
        objective,
        budgetSeconds: config.budgetSeconds,
      });
      // The objective row is NOT appended here: Core broadcasts it
      // through `user-message-persisted` (stamped with `goalId`), which
      // is the single mirror path for both the Composer and CLI starts.
      // Appending it here too would render the commission twice.
      setActiveGoals((goals) => {
        const withoutCurrent = goals.filter(
          (candidate) => candidate.id !== goal.id,
        );
        return [...withoutCurrent, goal].sort((a, b) =>
          a.startedAt.localeCompare(b.startedAt),
        );
      });
      if (createdSession) {
        setActiveProjectFilter(undefined);
        setScreen("main");
      }
      pushToast(
        makeAppError({
          category: "business",
          severity: "info",
          title: copy.toasts.goalStarted,
          message:
            goal.budgetSeconds != null
              ? copy.toasts.goalStartedMessage(
                  Math.round(goal.budgetSeconds / 60),
                )
              : copy.toasts.goalStartedMessageNoBudget,
          hint: null,
          retryable: false,
          context: "start_session_goal",
          traceback: null,
          autoDismissMs: 4200,
        }),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      pushToast(
        makeAppError({
          category: "business",
          severity: "error",
          title: copy.toasts.goalStartFailed,
          message,
          hint: null,
          retryable: true,
          context: "start_session_goal",
          traceback: null,
        }),
      );
      throw e;
    }
  };

  /** Jump to the goal's session. A terminal result is marked seen on
   * the way in, which is what retires it from the pill. */
  const openGoal = async (goalId: string) => {
    let goal = activeGoals.find((candidate) => candidate.id === goalId);
    if (!goal) {
      try {
        goal = await getGoal(goalId);
      } catch (e) {
        console.warn("[goals] open goal failed.", e);
        return;
      }
    }
    setActiveProjectFilter(undefined);
    void activateSession(goal.sessionId);
    setScreen("main");
    if (isTerminalGoalStatus(goal.status)) {
      void markGoalResultSeen(goal.id)
        .then((next) => {
          setActiveGoals((goals) =>
            goals.filter((candidate) => candidate.id !== next.id),
          );
        })
        .catch((e) => {
          console.debug("[goals] mark result seen failed.", e);
        });
    }
  };

  const stopGoalFromTopbar = async (goalId: string) => {
    try {
      const next = await stopGoal(goalId);
      setActiveGoals((goals) =>
        goals.map((goal) => (goal.id === goalId ? next : goal)),
      );
    } catch (e) {
      console.warn("[goals] stop failed.", e);
    }
  };

  /**
   * Give a goal more time. The only way back out of `budget_limited`:
   * Core raises the ceiling, flips the goal to `active`, and dispatches
   * the next continuation itself, so the GUI just folds the returned
   * brief in (upsert, not map — a budget-limited goal whose result was
   * already marked seen has left `activeGoals`, and extending it puts
   * it back in the pill).
   */
  const extendGoalFromTopbar = async (
    goalId: string,
    extraSeconds: number = GOAL_EXTEND_SECONDS,
  ) => {
    try {
      const next = await extendGoal(goalId, extraSeconds);
      setActiveGoals((goals) => {
        const without = goals.filter((goal) => goal.id !== next.id);
        return [...without, next].sort((a, b) =>
          a.startedAt.localeCompare(b.startedAt),
        );
      });
      pushToast(
        makeAppError({
          category: "business",
          severity: "info",
          title: copy.toasts.goalExtended,
          message: copy.toasts.goalExtendedMessage(
            Math.round(extraSeconds / 60),
          ),
          hint: null,
          retryable: false,
          context: "extend_goal",
          traceback: null,
          autoDismissMs: 4200,
        }),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      pushToast(
        makeAppError({
          category: "business",
          severity: "error",
          title: copy.toasts.goalExtendFailed,
          message,
          hint: null,
          retryable: true,
          context: "extend_goal",
          traceback: null,
        }),
      );
    }
  };

  return {
    startGoalFromComposer,
    openGoal,
    stopGoalFromTopbar,
    extendGoalFromTopbar,
  };
}
