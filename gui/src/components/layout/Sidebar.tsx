import { useEffect, useMemo, useRef, useState } from "react";

import { useDayStamp } from "@/hooks/useDayStamp";
import { useCopy } from "@/lib/i18n";
import { sortProjectsForNavigation } from "@/lib/projects";
import { backfillRecentSessions, groupSessions } from "@/lib/sessions";
import type { GoalBrief } from "@/types/goal";
import type { Project, Session } from "@/types/session";

import { SidebarFooter } from "./sidebar/SidebarFooter";
import { SidebarHeader } from "./sidebar/SidebarHeader";
import { SidebarQuickActions } from "./sidebar/SidebarQuickActions";
import {
  SidebarProjectReview,
  SidebarProjectReviewPresence,
} from "./sidebar/SidebarProjectReview";
import {
  SidebarTimelineBuckets,
  SidebarTimelinePresence,
} from "./sidebar/SidebarTimeline";
import {
  GLOBAL_TIMELINE_EXIT_MS,
  PROJECT_REVIEW_EXIT_MS,
  projectReviewFallbackNowMs,
  type ProjectScopePhase,
  type SidebarRuntimeIndicator,
} from "./sidebar/types";

export type { SidebarRuntimeIndicator } from "./sidebar/types";

export interface SidebarProps {
  sessions: Session[];
  projects?: Project[];
  activeId?: string;
  /** Project context for the right-side empty composer. This no
   * longer drives Sidebar filtering; Project Review owns sidebar
   * grouping/expansion independently. */
  activeProjectFilter?: string;
  /** Sidebar-only mode: when true, the global timeline is hidden and
   * Project Review becomes the main monitoring surface. */
  projectViewOpen?: boolean;
  /** Project ids currently expanded inside Project Review. Multiple
   * ids are allowed so users can monitor work across projects. */
  expandedProjectIds?: string[];
  activeGoalProjectIds?: Set<string>;
  /** Timestamp captured when Project Review opens. Passed from an
   * event handler so "recent within 7 days" stays React-render pure. */
  projectReviewNowMs?: number;
  runtimeIndicator?: SidebarRuntimeIndicator;
  onSelectSession?: (id: string) => void;
  onNewChat?: () => void;
  onSearch?: () => void;
  onOpenScheduled?: () => void;
  /** Scheduler sessions blocked on approval — badge on the 定时 row. */
  scheduledBlockedCount?: number;
  /** Open the CreateProjectDialog. Wired to the quick-action "+"
   * and the empty Project Review hint. */
  onNewProject?: () => void;
  /** Click 项目 quick action → enter/exit Project Review. */
  onToggleProjectView?: () => void;
  /** Click a project row → expand/collapse that one project. */
  onToggleProjectExpanded?: (id: string) => void;
  /** Click a project's inline + → prepare a new conversation whose
   * first message will be assigned to that project. */
  onStartProjectConversation?: (id: string) => void;
  /** Right-click → Archive. Hides the session from the bucketed list
   * but keeps the row in SQLite. */
  onArchiveSession?: (id: string) => void;
  /**
   * Right-click → "重命名". Sidebar tracks edit state locally
   * (one row at a time). Submitting (Enter / blur) calls back with
   * the new title; the host store action handles trim / fallback /
   * persist. No prop wired = no menu item rendered, matching the
   * rest of the sidebar's "affordance only when host enables it"
   * pattern.
   */
  onRenameSession?: (id: string, newTitle: string) => void;
  /** Right-click → Pin / Unpin. Toggles `session.pinned`; pinned
   * rows surface in the Pinned bucket regardless of date. */
  onTogglePinSession?: (id: string) => void;
  /** Right-click → Move to project → submenu. `projectId` of `null`
   * means "Remove from project" (the session keeps existing, just
   * loses its drawer membership). */
  onAssignSessionToProject?: (
    sessionId: string,
    projectId: string | null,
  ) => void;
  /** Right-click project → Pin / Unpin. Toggles `project.pinned`. */
  onTogglePinProject?: (id: string) => void;
  /** Right-click project → Edit. Parent opens EditProjectDialog. */
  onEditProject?: (id: string) => void;
  /** Right-click project → Delete (destructive item below separator).
   * Parent opens ConfirmDeleteProjectDialog. */
  onDeleteProject?: (id: string) => void;
  /** Click the collapsed "Earlier (N)" row → open the EarlierDialog
   * (browse all sessions older than 7 days). Replaces the old
   * inline-expanded `earlier` bucket so the sidebar stays bounded as
   * sessions accumulate over months/years. */
  onOpenEarlier?: () => void;
  /** Click the Archived footer button → open the Archived dialog
   * (list of archived sessions, with Restore / Delete / Empty all). */
  onOpenArchived?: () => void;
  /** Count of archived sessions — shown as a small numeral after the
   * footer label. Omit / 0 → just the label. */
  archivedCount?: number;
  /** Click the external runtime status → opens Settings → Runtime. */
  onOpenRuntimeSettings?: () => void;
  /** Click "配置模型" → opens Settings → Models. */
  onOpenModelsSettings?: () => void;
  /** Click the quiet Agent-control entry → opens Settings → Agent. */
  onOpenAgentSettings?: () => void;
  /** Session that currently holds the Desktop Pet, or `null` when no
   * pet is running. Renders a small Cat badge on the matching session
   * row so users see "where the pet lives" at a glance — non-
   * interactive status, not a click target. */
  petAttachedSessionId?: string | null;
  /** Map of master-session-id -> running/wrapping goal, so a master
   * session row shows a goal-running state instead of reading as idle
   * while its workers run. */
  goalMasterStatus?: Map<string, GoalBrief>;
}

/**
 * Left navigation panel. Per DESIGN.md §4.2 Sidebar Spec.
 *
 * Two visual modes, derived from `sessions.length`:
 *
 *   full  — sessions[] non-empty: header + quick actions + bucketed
 *           sections (pinned/today/week/earlier) + archive footer
 *   empty — sessions[] empty: header + quick actions + muted hint
 *           ("你的对话会出现在这里。"); no sections, and the archive
 *           footer only if archived sessions exist (it's the sole
 *           path back to them)
 *
 * The active session row gets `bg-selected` (apricot tint) — this is a
 * brand moment, not just hover state.
 */
export function Sidebar({
  sessions,
  projects = [],
  activeId,
  activeProjectFilter,
  projectViewOpen = false,
  expandedProjectIds = [],
  activeGoalProjectIds = new Set<string>(),
  projectReviewNowMs = projectReviewFallbackNowMs(),
  runtimeIndicator = "hidden",
  onSelectSession,
  onNewChat,
  onSearch,
  onOpenScheduled,
  scheduledBlockedCount,
  onNewProject,
  onToggleProjectView,
  onToggleProjectExpanded,
  onStartProjectConversation,
  onArchiveSession,
  onRenameSession,
  onTogglePinSession,
  onAssignSessionToProject,
  onTogglePinProject,
  onEditProject,
  onDeleteProject,
  onOpenEarlier,
  onOpenArchived,
  archivedCount = 0,
  onOpenRuntimeSettings,
  onOpenModelsSettings,
  onOpenAgentSettings,
  petAttachedSessionId,
  goalMasterStatus,
}: SidebarProps) {
  const copy = useCopy();
  // Project context belongs to the right-side empty composer. Sidebar
  // Project Review is a separate monitoring mode, so users can inspect
  // multiple projects without hijacking the main conversation.
  const activeProject = activeProjectFilter
    ? projects.find((p) => p.id === activeProjectFilter)
    : undefined;
  // Memoised: `groupSessions` walks every session; without memo it
  // re-runs on every Sidebar render, and Sidebar re-renders whenever
  // App does (which can be triggered by lower-frequency state like
  // pendingAskUser / bridgeStatus). `dayStamp` is in the deps because
  // bucketing captures "today" at call time — without it, an app left
  // open past midnight kept yesterday's sessions under 今天 until an
  // unrelated session mutation happened to retrigger the memo.
  const dayStamp = useDayStamp();
  const globalBuckets = useMemo(
    () => backfillRecentSessions(groupSessions(sessions)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, dayStamp],
  );
  const globalEmpty = sessions.length === 0;
  const navigationProjects = useMemo(
    () => sortProjectsForNavigation(projects, sessions),
    [projects, sessions],
  );
  const projectSessionsById = useMemo(() => {
    const byId = new Map<string, Session[]>();
    for (const session of sessions) {
      if (!session.projectId) continue;
      const group = byId.get(session.projectId);
      if (group) group.push(session);
      else byId.set(session.projectId, [session]);
    }
    return byId;
  }, [sessions]);
  const expandedProjectIdSet = useMemo(
    () => new Set(expandedProjectIds),
    [expandedProjectIds],
  );

  // Sidebar-local edit state — only one session can be inline-edited
  // at a time. Lifting this to App.tsx / Zustand would be overkill:
  // edit state is ephemeral UI affecting only sidebar rendering, and
  // not visible / actionable from anywhere else.
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [globalTimelinePhase, setGlobalTimelinePhase] =
    useState<ProjectScopePhase | null>(() =>
      projectViewOpen ? null : "entered",
    );
  const [projectReviewPhase, setProjectReviewPhase] =
    useState<ProjectScopePhase | null>(() =>
      projectViewOpen ? "entered" : null,
    );
  const previousProjectViewOpenRef = useRef(projectViewOpen);

  useEffect(() => {
    const previousProjectViewOpen = previousProjectViewOpenRef.current;
    previousProjectViewOpenRef.current = projectViewOpen;
    if (projectViewOpen === previousProjectViewOpen) return;

    const frameIds: number[] = [];
    const timeoutIds: number[] = [];

    const scheduleFrame = (callback: FrameRequestCallback) => {
      const id = window.requestAnimationFrame(callback);
      frameIds.push(id);
    };

    const scheduleTimeout = (callback: () => void, delayMs: number) => {
      const id = window.setTimeout(callback, delayMs);
      timeoutIds.push(id);
    };

    scheduleFrame(() => {
      if (projectViewOpen) {
        setProjectReviewPhase("entering");
        setGlobalTimelinePhase((phase) => (phase ? "exiting" : null));
        scheduleFrame(() => {
          setProjectReviewPhase((phase) =>
            phase === "entering" ? "entered" : phase,
          );
        });
        scheduleTimeout(() => {
          setGlobalTimelinePhase((phase) =>
            phase === "exiting" ? null : phase,
          );
        }, GLOBAL_TIMELINE_EXIT_MS);
      } else {
        setProjectReviewPhase((phase) => (phase ? "exiting" : null));
        setGlobalTimelinePhase("entering");
        scheduleFrame(() => {
          setGlobalTimelinePhase((phase) =>
            phase === "entering" ? "entered" : phase,
          );
        });
        scheduleTimeout(() => {
          setProjectReviewPhase((phase) =>
            phase === "exiting" ? null : phase,
          );
        }, PROJECT_REVIEW_EXIT_MS);
      }
    });

    return () => {
      frameIds.forEach((id) => window.cancelAnimationFrame(id));
      timeoutIds.forEach((id) => window.clearTimeout(id));
    };
  }, [projectViewOpen]);

  return (
    <div className="flex h-full flex-col bg-chrome text-[13px] text-ink">
      <SidebarHeader
        runtimeIndicator={runtimeIndicator}
        onOpenRuntimeSettings={onOpenRuntimeSettings}
        onOpenModelsSettings={onOpenModelsSettings}
        onOpenAgentSettings={onOpenAgentSettings}
      />
      <SidebarQuickActions
        onNewChat={onNewChat}
        onSearch={onSearch}
        onOpenScheduled={onOpenScheduled}
        scheduledBlockedCount={scheduledBlockedCount}
        projectViewOpen={projectViewOpen}
        onToggleProjectView={onToggleProjectView}
        onNewProject={onNewProject}
        activeProjectName={activeProject?.name}
      />

      <div className="scrollbar-stable min-h-0 flex-1 overflow-y-auto pb-2">
        {projectReviewPhase && (
          <SidebarProjectReviewPresence phase={projectReviewPhase}>
            <SidebarProjectReview
              projects={navigationProjects}
              sessionsByProjectId={projectSessionsById}
              activeProjectFilter={activeProjectFilter}
              expandedProjectIds={expandedProjectIdSet}
              activeGoalProjectIds={activeGoalProjectIds}
              reviewNowMs={projectReviewNowMs}
              activeId={activeId}
              petAttachedSessionId={petAttachedSessionId}
              goalMasterStatus={goalMasterStatus}
              onToggleProjectExpanded={onToggleProjectExpanded}
              onStartProjectConversation={onStartProjectConversation}
              onSelectSession={onSelectSession}
              onArchiveSession={onArchiveSession}
              onTogglePinSession={onTogglePinSession}
              onAssignSessionToProject={onAssignSessionToProject}
              editingSessionId={editingSessionId}
              onRequestRename={
                onRenameSession ? (id) => setEditingSessionId(id) : undefined
              }
              onConfirmRename={(id, newTitle) => {
                onRenameSession?.(id, newTitle);
                setEditingSessionId(null);
              }}
              onCancelRename={() => setEditingSessionId(null)}
              onTogglePinProject={onTogglePinProject}
              onEditProject={onEditProject}
              onDeleteProject={onDeleteProject}
              onNewProject={onNewProject}
            />
          </SidebarProjectReviewPresence>
        )}

        {globalTimelinePhase && (
          <SidebarTimelinePresence phase={globalTimelinePhase}>
            {globalEmpty ? (
              <div className="px-5 py-6 text-[12.5px] italic text-ink-muted">
                {copy.sidebar.emptySessions}
              </div>
            ) : (
              <SidebarTimelineBuckets
                buckets={globalBuckets}
                activeId={activeId}
                projects={navigationProjects}
                petAttachedSessionId={petAttachedSessionId}
                goalMasterStatus={goalMasterStatus}
                onSelectSession={onSelectSession}
                onArchiveSession={onArchiveSession}
                onTogglePinSession={onTogglePinSession}
                onAssignSessionToProject={onAssignSessionToProject}
                editingSessionId={editingSessionId}
                onOpenEarlier={onOpenEarlier}
                onRequestRename={
                  onRenameSession ? (id) => setEditingSessionId(id) : undefined
                }
                onConfirmRename={(id, newTitle) => {
                  onRenameSession?.(id, newTitle);
                  setEditingSessionId(null);
                }}
                onCancelRename={() => setEditingSessionId(null)}
              />
            )}
          </SidebarTimelinePresence>
        )}
      </div>

      {/* Fresh installs (no sessions, nothing archived) keep the quiet
          empty state — a lone "已归档" button under the hint was chrome
          for nothing. But if archived sessions exist while the live
          list is empty, the footer MUST stay: it's the only path back
          to that data. */}
      {(!globalEmpty || archivedCount > 0) && (
        <SidebarFooter count={archivedCount} onOpenArchived={onOpenArchived} />
      )}
    </div>
  );
}
