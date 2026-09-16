import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import type { AppCopy } from "@/lib/i18n";
import {
  listGoalsForSession,
  listVisibleGoals,
  markGoalResultSeen,
} from "@/lib/goals";
import { sendGatedSystemNotification } from "@/lib/notify";
import { makeAppError, type AppError } from "@/types/app-error";
import {
  isTerminalGoalStatus,
  type GoalBrief,
  type GoalStatus,
} from "@/types/goal";
import type { Screen } from "@/stores/ui";

/** Tauri event Core fires on every goal state change
 * (`crate::goal_engine::GOAL_UPDATED_EVENT`). */
const GOAL_UPDATED_EVENT = "goal-updated";

/**
 * Has the user already looked at THIS result? `resultSeenAt` alone is
 * not enough since `extend_goal` (2026-09-16): a `budget_limited` goal
 * can be given more time, run on, and hit the ceiling a second time,
 * and the stamp from the first result would otherwise swallow the
 * second one. A seen-stamp older than the run's end is a stamp for a
 * previous ending.
 */
function resultAlreadySeen(goal: GoalBrief): boolean {
  if (!goal.resultSeenAt) return false;
  if (!goal.endedAt) return true;
  return goal.resultSeenAt >= goal.endedAt;
}

/** Terminal statuses whose result the pill keeps offering until the
 * user actually looks at the session. */
function isUnseenResult(goal: GoalBrief): boolean {
  return isTerminalGoalStatus(goal.status) && !resultAlreadySeen(goal);
}

/** Fold one goal into a list, keeping open goals + unseen results and
 * dropping anything that is now both terminal and seen. */
function applyGoalUpdate(goals: GoalBrief[], next: GoalBrief): GoalBrief[] {
  const without = goals.filter((goal) => goal.id !== next.id);
  if (isTerminalGoalStatus(next.status) && resultAlreadySeen(next)) {
    return without;
  }
  return [...without, next].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );
}

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

  // Event-driven freshness: Core fires `goal-updated` on every state
  // change, so the pill / sidebar flip the moment the engine decides.
  // The 5s poll above stays as the fallback (missed event, cold start,
  // and it is what refreshes `elapsedSeconds` while a goal runs).
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void (async () => {
      const fn = await listen<{ goal: GoalBrief }>(GOAL_UPDATED_EVENT, (e) => {
        const next = e.payload.goal;
        setActiveGoals((goals) => applyGoalUpdate(goals, next));
        setSessionGoals((goals) =>
          goals.some((goal) => goal.id === next.id)
            ? goals.map((goal) => (goal.id === next.id ? next : goal))
            : goals,
        );
      });
      if (cancelled) fn();
      else unlisten = fn;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // In-flight guard: the effect re-runs on every activeGoals change,
  // and without it the same goal could be mark-seen'd repeatedly while
  // the first request was still pending.
  const markSeenInFlight = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeSessionId) return;
    const visibleResultGoal = activeGoals.find(
      (goal) => goal.sessionId === activeSessionId && isUnseenResult(goal),
    );
    if (!visibleResultGoal) return;
    if (markSeenInFlight.current.has(visibleResultGoal.id)) return;
    markSeenInFlight.current.add(visibleResultGoal.id);
    void markGoalResultSeen(visibleResultGoal.id)
      .then((next) => {
        setActiveGoals((goals) => applyGoalUpdate(goals, next));
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
      // Terminal tones (PRD §3.7): completed / budget_limited are a
      // finished result (done tone); blocked / failed need the user
      // (alert tone); paused and stopped never notify — both are the
      // user's or the system's own doing.
      const needsUser = goal.status === "blocked" || goal.status === "failed";
      const title =
        goal.status === "completed"
          ? copy.toasts.goalCompleted
          : goal.status === "budget_limited"
            ? copy.toasts.goalBudgetLimited
            : goal.status === "blocked"
              ? copy.toasts.goalBlocked
              : copy.toasts.goalFailed;
      const message =
        needsUser && goal.latestSummary ? goal.latestSummary : goal.objective;
      // Same content as the toast, for the user who isn't looking at
      // the window — notify.ts skips it when the window is focused.
      void sendGatedSystemNotification("goalEnd", {
        title,
        body: message,
        tone: needsUser ? "alert" : "done",
      });
      pushToast(
        makeAppError({
          category: "business",
          severity: goal.status === "failed" ? "error" : "info",
          title,
          // A blocker or a failure without a reason is a dead-end
          // ("反馈引导行动") — the engine records the cause in
          // latestSummary, so it, not the objective, is the message.
          message,
          hint: null,
          retryable: false,
          context: "goal_terminal",
          traceback: null,
          action: {
            kind: "view_goal",
            label: needsUser
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
      // `blocked` is not terminal but it is the state that needs the
      // user, so it notifies like one. `paused` / `stopped` stay quiet.
      const notifiable =
        goal.status === "completed" ||
        goal.status === "budget_limited" ||
        goal.status === "blocked" ||
        goal.status === "failed";
      if (notifiable && before !== undefined && before !== goal.status) {
        notifyGoalTerminalRef.current(goal);
      }
    }
    goalStatusRef.current = next;
  }, [activeGoals]);

  return { activeGoals, sessionGoals, setActiveGoals };
}
