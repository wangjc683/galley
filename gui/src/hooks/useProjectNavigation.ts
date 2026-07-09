import { useMemo, useState, type Dispatch, type SetStateAction } from "react";

import type { AppCopy } from "@/lib/i18n";
import { sortProjectsForNavigation } from "@/lib/projects";
import { makeAppError, type AppError } from "@/types/app-error";
import type { GoalBrief } from "@/types/goal";
import type { Project, Session } from "@/types/session";
import type { Screen } from "@/stores/ui";

export function useProjectNavigation({
  activeGoals,
  activeProjectFilter,
  activeSessionBusy,
  assignSessionToProject,
  copy,
  projects,
  pushToast,
  setActiveProjectFilter,
  setActiveSession,
  setEmptyComposerFocusTick,
  setScreen,
  visibleSessions,
}: {
  activeGoals: GoalBrief[];
  activeProjectFilter: string | undefined;
  activeSessionBusy: boolean;
  assignSessionToProject: (
    sessionId: string,
    projectId: string | null,
  ) => Promise<void>;
  copy: AppCopy;
  projects: Project[];
  pushToast: (error: AppError) => void;
  setActiveProjectFilter: (projectId: string | undefined) => void;
  setActiveSession: (id: string | undefined) => void;
  setEmptyComposerFocusTick: Dispatch<SetStateAction<number>>;
  setScreen: (screen: Screen) => void;
  visibleSessions: Session[];
}) {
  const [projectViewOpen, setProjectViewOpen] = useState(false);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  const [projectReviewNowMs, setProjectReviewNowMs] = useState(0);
  // CreateProjectDialog open state. Local for the same reason as the
  // other dialogs in App — modal visibility should not persist across
  // launches.
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  // EditProjectDialog stores the full project being edited so the dialog
  // can reset its inputs from the row that triggered it. null = closed.
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  // ConfirmDeleteProjectDialog opens from inside EditProject when the
  // user clicks delete. Same null-or-project pattern.
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(
    null,
  );

  const activeProject = activeProjectFilter
    ? projects.find((p) => p.id === activeProjectFilter)
    : undefined;
  const activeGoalProjectIds = useMemo(
    () =>
      new Set(
        activeGoals
          .map((goal) => goal.projectId)
          .filter((projectId): projectId is string => projectId != null),
      ),
    [activeGoals],
  );
  const editingProject = useMemo(
    () => projects.find((p) => p.id === editingProjectId) ?? null,
    [projects, editingProjectId],
  );
  const deletingProject = useMemo(
    () => projects.find((p) => p.id === deletingProjectId) ?? null,
    [projects, deletingProjectId],
  );

  const toggleProjectView = () => {
    if (projectViewOpen) {
      setActiveProjectFilter(undefined);
      setProjectViewOpen(false);
      return;
    }
    // 进入项目视图时自动 expand 第一个项目(已按 pinned 优先、再按
    // 最近 active 排序),并据此软设 filter——这样用户一进来,New Chat
    // 立刻有归属,不会经历"项目视图里 New Chat 是个死按钮"的尴尬态。
    // 没有项目时保持空(filter 仍 undefined),交给空状态 CTA 承接。
    const firstProject = sortProjectsForNavigation(
      projects,
      visibleSessions,
    )[0];
    setProjectReviewNowMs(Date.now());
    setProjectViewOpen(true);
    if (firstProject) {
      setExpandedProjectIds([firstProject.id]);
      setActiveProjectFilter(firstProject.id);
    } else {
      setExpandedProjectIds([]);
    }
  };

  const openProjectInSidebar = (projectId: string) => {
    setProjectReviewNowMs(Date.now());
    setProjectViewOpen(true);
    setExpandedProjectIds((ids) =>
      ids.includes(projectId) ? ids : [...ids, projectId],
    );
  };

  const toggleProjectExpanded = (projectId: string) => {
    if (!projectViewOpen) {
      setProjectReviewNowMs(Date.now());
      setExpandedProjectIds([projectId]);
      setProjectViewOpen(true);
      // expand 即软设 filter: New Chat 文案 / 右侧 composer 项目徽标
      // 都跟着"最近一次展开的项目"走。只有展开动作(false→true)
      // 更新;收起不动,所以新建对话永远落在最后展开的那个项目。
      setActiveProjectFilter(projectId);
      return;
    }
    setExpandedProjectIds((ids) => {
      if (ids.includes(projectId)) {
        // 收起: 不动 filter,保留最后展开的项目作为 New Chat 目标。
        return ids.filter((id) => id !== projectId);
      }
      // 展开: 更新 filter 为这个项目,成为新的 New Chat 目标。
      setActiveProjectFilter(projectId);
      return [...ids, projectId];
    });
  };

  const startProjectConversation = (projectId: string) => {
    setActiveProjectFilter(projectId);
    if (activeSessionBusy) return;
    setActiveSession(undefined);
    setScreen("empty");
    setEmptyComposerFocusTick((tick) => tick + 1);
  };

  const assignSessionToProjectWithToast = (
    sessionId: string,
    projectId: string | null,
  ) => {
    const session = visibleSessions.find((s) => s.id === sessionId);
    const previousProject = session?.projectId
      ? projects.find((p) => p.id === session.projectId)
      : undefined;
    const nextProject = projectId
      ? projects.find((p) => p.id === projectId)
      : undefined;
    const sessionTitle = session?.title ?? copy.toasts.conversationUpdated;

    void assignSessionToProject(sessionId, projectId).then(() => {
      if (projectId) {
        const projectName = nextProject?.name ?? copy.projects.fallbackProject;
        const title =
          session?.projectId && session.projectId !== projectId
            ? copy.toasts.movedTo(projectName)
            : copy.toasts.addedTo(projectName);
        pushToast(
          makeAppError({
            category: "business",
            severity: "info",
            title,
            message: sessionTitle,
            hint: null,
            retryable: false,
            context: null,
            traceback: null,
            action: {
              kind: "view_project",
              label: copy.toasts.viewProject,
              projectId,
            },
            autoDismissMs: 4000,
          }),
        );
        return;
      }

      pushToast(
        makeAppError({
          category: "business",
          severity: "info",
          title: previousProject
            ? copy.toasts.removedFromProject(previousProject.name)
            : copy.toasts.removedFromAnyProject,
          message: sessionTitle,
          hint: null,
          retryable: false,
          context: null,
          traceback: null,
          autoDismissMs: 3000,
        }),
      );
    });
  };

  return {
    activeGoalProjectIds,
    activeProject,
    assignSessionToProjectWithToast,
    createProjectOpen,
    deletingProject,
    editingProject,
    expandedProjectIds,
    openProjectInSidebar,
    projectReviewNowMs,
    projectViewOpen,
    setCreateProjectOpen,
    setDeletingProjectId,
    setEditingProjectId,
    startProjectConversation,
    toggleProjectExpanded,
    toggleProjectView,
  };
}
