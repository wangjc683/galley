import { useEffect, useRef, useState } from "react";

import type { AppCopy } from "@/lib/i18n";
import {
  getGoalStatus,
  listGoalsForSession,
  listVisibleGoals,
  markGoalResultSeen,
} from "@/lib/goals";
import { sendGatedSystemNotification } from "@/lib/notify";
import { useSessionsStore } from "@/stores/sessions";
import { makeAppError, type AppError } from "@/types/app-error";
import type { GoalBrief, GoalStatus } from "@/types/goal";
import type { Screen } from "@/stores/ui";

export function useGoalEffects({
  activeSessionId,
  copy,
  pushToast,
  screen,
}: {
  activeSessionId: string | undefined;
  copy: AppCopy;
  pushToast: (e: AppError) => void;
  screen: Screen;
}): {
  activeGoals: GoalBrief[];
  sessionGoals: GoalBrief[];
  setActiveGoals: React.Dispatch<React.SetStateAction<GoalBrief[]>>;
} {
  const [activeGoals, setActiveGoals] = useState<GoalBrief[]>([]);
  const [sessionGoals, setSessionGoals] = useState<GoalBrief[]>([]);

  useEffect(() => {
    let cancelled = false;
    const hydrateGoalProjects = async (goals: GoalBrief[]) => {
      const knownProjectIds = new Set(
        useSessionsStore.getState().projects.map((project) => project.id),
      );
      await Promise.all(
        goals
          // Project-less solo goals have nothing to hydrate.
          .filter(
            (goal) =>
              goal.projectId != null && !knownProjectIds.has(goal.projectId),
          )
          .map(async (goal) => {
            try {
              const snapshot = await getGoalStatus(goal.id);
              if (snapshot.project) {
                useSessionsStore
                  .getState()
                  .applyExternalProjectCreated(snapshot.project);
              }
            } catch (e) {
              console.debug("[goals] hydrate project failed.", e);
            }
          }),
      );
    };
    const refreshGoals = async () => {
      try {
        const goals = await listVisibleGoals();
        if (cancelled) return;
        // Keep the previous array identity when nothing changed: the
        // poll fires every 5s for everyone (usually returning the same
        // or an empty list), and a fresh reference re-rendered the
        // header/sidebar tree and re-fired the session-goals effect
        // each tick for nothing.
        setActiveGoals((prev) =>
          prev.length === goals.length &&
          JSON.stringify(prev) === JSON.stringify(goals)
            ? prev
            : goals,
        );
        void hydrateGoalProjects(goals);
      } catch (e) {
        console.debug("[goals] list_visible_goals failed.", e);
      }
    };
    void refreshGoals();
    const timer = window.setInterval(() => {
      void refreshGoals();
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // In-flight guard: the effect re-runs on every activeGoals change,
  // and without it the same goal could be mark-seen'd repeatedly while
  // the first request was still pending.
  const markSeenInFlight = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeSessionId) return;
    const visibleResultGoal = activeGoals.find(
      (goal) =>
        goal.masterSessionId === activeSessionId &&
        (goal.status === "completed" ||
          goal.status === "failed" ||
          goal.status === "stopped") &&
        !goal.resultSeenAt,
    );
    if (!visibleResultGoal) return;
    if (markSeenInFlight.current.has(visibleResultGoal.id)) return;
    markSeenInFlight.current.add(visibleResultGoal.id);
    void markGoalResultSeen(visibleResultGoal.id)
      .then((next) => {
        setActiveGoals((goals) =>
          goals
            .map((goal) => (goal.id === next.id ? next : goal))
            .filter(
              (goal) =>
                !(
                  goal.id === next.id &&
                  (goal.status === "completed" ||
                    goal.status === "failed" ||
                    goal.status === "stopped")
                ),
            ),
        );
      })
      .catch((e) => {
        console.debug("[goals] mark result seen failed.", e);
      })
      .finally(() => {
        markSeenInFlight.current.delete(visibleResultGoal.id);
      });
  }, [activeGoals, activeSessionId]);

  useEffect(() => {
    let cancelled = false;
    const sid = screen === "main" ? activeSessionId : undefined;
    const load = sid
      ? listGoalsForSession(sid)
      : Promise.resolve<GoalBrief[]>([]);
    void load
      .then((goals) => {
        if (!cancelled) setSessionGoals(goals);
      })
      .catch((e) => {
        console.debug("[goals] list goals for session failed.", e);
        if (!cancelled) setSessionGoals([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, screen, activeGoals]);

  const goalStatusRef = useRef<Map<string, GoalStatus>>(new Map());
  const notifyGoalTerminalRef = useRef<(goal: GoalBrief) => void>(() => {});
  useEffect(() => {
    notifyGoalTerminalRef.current = (goal: GoalBrief) => {
      // stopped is user-initiated — an info notification pointing at the
      // wrap-up summary, never an error tone.
      const failed = goal.status === "failed";
      const title =
        goal.status === "completed"
          ? copy.toasts.goalCompleted
          : goal.status === "stopped"
            ? copy.toasts.goalStopped
            : copy.toasts.goalFailed;
      const message =
        failed && goal.latestSummary ? goal.latestSummary : goal.objective;
      // Same content as the toast, for the user who isn't looking at
      // the window — notify.ts skips it when the window is focused.
      void sendGatedSystemNotification("goalEnd", { title, body: message });
      pushToast(
        makeAppError({
          category: "business",
          severity: failed ? "error" : "info",
          title,
          // On failure the controller records the cause in latestSummary;
          // the objective alone explains nothing ("反馈引导行动").
          message,
          hint: null,
          retryable: false,
          context: "goal_terminal",
          traceback: null,
          action: {
            kind: "view_goal",
            label: failed
              ? copy.toasts.viewGoalDetails
              : copy.toasts.viewGoalResult,
            goalId: goal.id,
          },
          autoDismissMs: 6000,
        }),
      );
    };
  });
  useEffect(() => {
    const prev = goalStatusRef.current;
    const next = new Map<string, GoalStatus>();
    for (const goal of activeGoals) {
      next.set(goal.id, goal.status);
      const before = prev.get(goal.id);
      const terminal =
        goal.status === "completed" ||
        goal.status === "failed" ||
        goal.status === "stopped";
      const wasActive = before === "running" || before === "wrapping";
      if (terminal && wasActive) notifyGoalTerminalRef.current(goal);
    }
    goalStatusRef.current = next;
  }, [activeGoals]);

  return { activeGoals, sessionGoals, setActiveGoals };
}
