import type { GoalBrief } from "@/types/goal";
import type { Project, Session } from "@/types/session";

import { SidebarSessionRow } from "./SidebarSessionRow";

/** Everything a timeline row needs besides its session — shared by the
 * bucket lists, the borrowed `earlier` row and the project groups so
 * they can't drift. */
export type SidebarTimelineRowWiring = {
  activeId?: string;
  projects: Project[];
  petAttachedSessionId?: string | null;
  /** Map of session-id -> that session's open goal, so a row carrying
   * a goal shows its state instead of reading as a finished chat. */
  sessionGoalStatus?: Map<string, GoalBrief>;
  onSelectSession?: (id: string) => void;
  onArchiveSession?: (id: string) => void;
  onTogglePinSession?: (id: string) => void;
  onAssignSessionToProject?: (
    sessionId: string,
    projectId: string | null,
  ) => void;
  /** 加入项目 submenu → 新建项目…: create a project and move this
   * session into it. */
  onCreateProjectForSession?: (sessionId: string) => void;
  /** Session currently in inline-edit mode (one at a time across the
   * whole sidebar). Tracked by the parent `Sidebar`. */
  editingSessionId?: string | null;
  /** Right-click "重命名" → flip this session into edit mode.
   * Undefined when host doesn't wire renameSession. */
  onRequestRename?: (id: string) => void;
  /** Inline input commits (Enter / blur). */
  onConfirmRename: (id: string, newTitle: string) => void;
  /** Inline input cancels (Esc). */
  onCancelRename: () => void;
};

export function SidebarTimelineRow({
  session: s,
  activeId,
  projects,
  petAttachedSessionId,
  sessionGoalStatus,
  onSelectSession,
  onArchiveSession,
  onTogglePinSession,
  onAssignSessionToProject,
  onCreateProjectForSession,
  editingSessionId,
  onRequestRename,
  onConfirmRename,
  onCancelRename,
  singleLine,
}: {
  session: Session;
  /** Title only, no status line — a project group's rows. */
  singleLine?: boolean;
} & SidebarTimelineRowWiring) {
  return (
    <SidebarSessionRow
      session={s}
      active={s.id === activeId}
      petAttached={s.id === petAttachedSessionId}
      sessionGoal={sessionGoalStatus?.get(s.id)}
      projects={projects}
      onClick={() => onSelectSession?.(s.id)}
      onArchive={onArchiveSession ? () => onArchiveSession(s.id) : undefined}
      onTogglePin={
        onTogglePinSession ? () => onTogglePinSession(s.id) : undefined
      }
      onAssignToProject={
        onAssignSessionToProject
          ? (projectId) => onAssignSessionToProject(s.id, projectId)
          : undefined
      }
      onCreateProjectForSession={
        onCreateProjectForSession
          ? () => onCreateProjectForSession(s.id)
          : undefined
      }
      isEditing={editingSessionId === s.id}
      onRequestRename={
        onRequestRename ? () => onRequestRename(s.id) : undefined
      }
      onConfirmRename={(newTitle) => onConfirmRename(s.id, newTitle)}
      onCancelRename={onCancelRename}
      singleLine={singleLine}
    />
  );
}
