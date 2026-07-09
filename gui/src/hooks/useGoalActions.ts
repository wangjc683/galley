import type { Dispatch, SetStateAction } from "react";

import type { AppCopy } from "@/lib/i18n";
import {
  getGoalStatus,
  goalMasterSessionTitle,
  markGoalResultSeen,
  startDesktopGoal,
  stopGoal,
} from "@/lib/goals";
import { useSessionsStore } from "@/stores/sessions";
import { makeAppError } from "@/types/app-error";
import type { Origin, SystemTurn } from "@/types/conversation";
import type { GoalBrief, GoalLaunchConfig } from "@/types/goal";
import type { RuntimeKind, Session } from "@/types/session";

/**
 * Goal command layer: launch a Goal from the composer, open a Goal's
 * master session (or its project), and stop a running Goal from the
 * topbar. These are the imperative counterparts to `useGoalEffects`
 * (which owns the polling / activeGoals state); this hook only issues
 * commands and folds their results back through `setActiveGoals`.
 *
 * Depends on outputs of `useGoalEffects` (`setActiveGoals`, `activeGoals`)
 * and `useProjectNavigation` (`openGoalProject`), so call it after both.
 * All other deps are App-level store actions / derived values passed in,
 * matching the `useProjectNavigation` convention.
 */
export function useGoalActions({
  activeGoals,
  activeSession,
  activeProjectFilter,
  activeRuntimeKind,
  llmDisplayName,
  resolvedLanguage,
  requiresManagedModelConfig,
  copy,
  createSessionPersisted,
  setScreen,
  setActiveProjectFilter,
  activateSession,
  appendUserTurnExternal,
  appendSystemTurn,
  assignSessionToProject,
  setActiveGoals,
  openGoalProject,
  pushToast,
  openModelsForMissingConfig,
}: {
  activeGoals: GoalBrief[];
  activeSession: Session | undefined;
  activeProjectFilter: string | undefined;
  activeRuntimeKind: RuntimeKind;
  llmDisplayName: string;
  resolvedLanguage: string;
  requiresManagedModelConfig: boolean;
  copy: AppCopy;
  createSessionPersisted: (
    projectId?: string,
    title?: string,
  ) => Promise<string>;
  setScreen: (s: "empty" | "main" | "onboarding") => void;
  setActiveProjectFilter: (id: string | undefined) => void;
  activateSession: (id: string) => Promise<void>;
  appendUserTurnExternal: (
    sid: string,
    text: string,
    origin?: Origin,
    createdAt?: string,
    dispatched?: boolean,
    turnIndex?: number | null,
    goalId?: string,
  ) => void;
  appendSystemTurn: (sid: string, turn: SystemTurn) => void;
  assignSessionToProject: (
    sessionId: string,
    projectId: string | null,
  ) => Promise<void>;
  setActiveGoals: Dispatch<SetStateAction<GoalBrief[]>>;
  openGoalProject: (projectId: string) => void;
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
      let masterSessionId = activeSession?.id;
      const createdMasterSession = masterSessionId === undefined;
      if (!masterSessionId) {
        masterSessionId = await createSessionPersisted(
          activeProjectFilter,
          goalMasterSessionTitle(objective),
        );
        setScreen("main");
      }
      const projectId = activeSession?.projectId ?? activeProjectFilter;
      const shouldMirrorMasterProject =
        masterSessionId && (!activeSession || !activeSession.projectId);
      const result = await startDesktopGoal({
        objective,
        projectId: projectId ?? undefined,
        masterSessionId,
        runtimeKind: activeRuntimeKind,
        workerLimit: config.workerLimit,
        budgetSeconds: config.budgetSeconds,
        mode: config.mode,
        llmName: llmDisplayName,
        locale: resolvedLanguage,
      });
      const { goal, objectiveMessage, masterMessage } = result;
      appendUserTurnExternal(
        masterSessionId,
        objectiveMessage.content,
        objectiveMessage.origin,
        objectiveMessage.createdAt,
        false,
        objectiveMessage.turnIndex,
        goal.id,
      );
      appendSystemTurn(masterSessionId, {
        role: "system",
        content: masterMessage.content,
        variant: "goal",
      });
      setActiveGoals((goals) => {
        const withoutCurrent = goals.filter(
          (candidate) => candidate.id !== goal.id,
        );
        return [...withoutCurrent, goal].sort(
          (a, b) => Date.parse(a.deadlineAt) - Date.parse(b.deadlineAt),
        );
      });
      if (shouldMirrorMasterProject && goal.projectId) {
        void assignSessionToProject(masterSessionId, goal.projectId);
      }
      void getGoalStatus(goal.id)
        .then((snapshot) => {
          if (snapshot.project) {
            useSessionsStore
              .getState()
              .applyExternalProjectCreated(snapshot.project);
          }
          const master = snapshot.sessions.find(
            (session) => session.id === masterSessionId,
          );
          if (master) {
            useSessionsStore.getState().applyExternalSessionUpdated(master);
          }
        })
        .catch((e) => {
          console.debug("[goals] hydrate started goal project failed.", e);
        });
      setActiveProjectFilter(undefined);
      if (createdMasterSession) {
        setScreen("main");
      }
      pushToast(
        makeAppError({
          category: "business",
          severity: "info",
          title: copy.toasts.goalStarted,
          // Solo runs one agent regardless of workerLimit — naming a count
          // would contradict the dialog's single-agent framing.
          message:
            goal.mode === "solo"
              ? copy.toasts.goalStartedMessageSolo(
                  Math.round(goal.budgetSeconds / 60),
                )
              : copy.toasts.goalStartedMessage(
                  goal.workerLimit,
                  Math.round(goal.budgetSeconds / 60),
                ),
          hint: null,
          retryable: false,
          context: "start_desktop_goal",
          traceback: null,
          // A project-less solo goal has nowhere to "view" — the run is
          // already the active session.
          action: goal.projectId
            ? {
                kind: "view_project",
                label: copy.toasts.viewProject,
                projectId: goal.projectId,
              }
            : undefined,
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
          context: "start_desktop_goal",
          traceback: null,
        }),
      );
      throw e;
    }
  };

  const openGoal = async (goalId: string) => {
    try {
      const snapshot = await getGoalStatus(goalId);
      const masterSessionId = snapshot.goal.masterSessionId;
      if (masterSessionId) {
        setActiveProjectFilter(undefined);
        void activateSession(masterSessionId);
        setScreen("main");
        if (
          snapshot.goal.status === "completed" ||
          snapshot.goal.status === "failed" ||
          snapshot.goal.status === "stopped"
        ) {
          void markGoalResultSeen(snapshot.goal.id)
            .then((next) => {
              setActiveGoals((goals) =>
                goals
                  .map((goal) => (goal.id === next.id ? next : goal))
                  .filter((goal) => goal.id !== next.id),
              );
            })
            .catch((e) => {
              console.debug("[goals] mark result seen failed.", e);
            });
        }
        return;
      }
      if (snapshot.goal.projectId) openGoalProject(snapshot.goal.projectId);
    } catch (e) {
      console.warn("[goals] open goal failed.", e);
      const goal = activeGoals.find((candidate) => candidate.id === goalId);
      if (goal?.projectId) openGoalProject(goal.projectId);
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

  return { startGoalFromComposer, openGoal, stopGoalFromTopbar };
}
