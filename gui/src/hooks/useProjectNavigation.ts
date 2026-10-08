import { useMemo, useState, type Dispatch, type SetStateAction } from "react";

import type { AppCopy } from "@/lib/i18n";
import { makeAppError, type AppError } from "@/types/app-error";
import type { Project, Session } from "@/types/session";
import type { Screen } from "@/stores/ui";

export function useProjectNavigation({
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
  // Expanded groups in the sidebar's 项目 section — this run only;
  // every group starts collapsed (D9).
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);
  // Ask the sidebar to scroll a project's group into view; `seq` lets
  // the same project be asked twice.
  const [projectReveal, setProjectReveal] = useState<{
    id: string;
    seq: number;
  } | null>(null);
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
  const editingProject = useMemo(
    () => projects.find((p) => p.id === editingProjectId) ?? null,
    [projects, editingProjectId],
  );
  const deletingProject = useMemo(
    () => projects.find((p) => p.id === deletingProjectId) ?? null,
    [projects, deletingProjectId],
  );

  // Expanding or collapsing a group never touches project context (D8):
  // in the sidebar it is usually a glance. The row's +, the empty
  // project's CTA and the 项目 menu set it.
  const toggleProjectExpanded = (projectId: string) => {
    setExpandedProjectIds((ids) =>
      ids.includes(projectId)
        ? ids.filter((id) => id !== projectId)
        : [...ids, projectId],
    );
  };

  const openProjectInSidebar = (projectId: string) => {
    setExpandedProjectIds((ids) =>
      ids.includes(projectId) ? ids : [...ids, projectId],
    );
    setProjectReveal((previous) => ({
      id: projectId,
      seq: (previous?.seq ?? 0) + 1,
    }));
  };

  const startProjectConversation = (projectId: string) => {
    setActiveProjectFilter(projectId);
    if (activeSessionBusy) return;
    setActiveSession(undefined);
    setScreen("empty");
    setEmptyComposerFocusTick((tick) => tick + 1);
  };

  // 项目 menu → a project: a new chat in it, and its group opened.
  const openProject = (projectId: string) => {
    startProjectConversation(projectId);
    openProjectInSidebar(projectId);
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
    activeProject,
    assignSessionToProjectWithToast,
    createProjectOpen,
    deletingProject,
    editingProject,
    expandedProjectIds,
    openProject,
    openProjectInSidebar,
    projectReveal,
    setCreateProjectOpen,
    setDeletingProjectId,
    setEditingProjectId,
    startProjectConversation,
    toggleProjectExpanded,
  };
}
