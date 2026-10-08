import { useEffect, useMemo, useRef, useState } from "react";

import { useDayStamp } from "@/hooks/useDayStamp";
import { useCopy } from "@/lib/i18n";
import { sortProjectsForNavigation } from "@/lib/projects";
import {
  backfillRecentSessions,
  findSessionBucket,
  groupSessions,
} from "@/lib/sessions";
import type { GoalBrief } from "@/types/goal";
import type { Project, Session, SessionBucket } from "@/types/session";

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
} from "./sidebar/types";

export interface SidebarProps {
  sessions: Session[];
  projects?: Project[];
  activeId?: string;
  /** The main area shows the empty new-chat composer; the 新对话 row
   * is then the sidebar's selected row. */
  newChatActive?: boolean;
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
  /** Timestamp captured when Project Review opens. Passed from an
   * event handler so "recent within 7 days" stays React-render pure. */
  projectReviewNowMs?: number;
  onSelectSession?: (id: string) => void;
  onNewChat?: () => void;
  onSearch?: () => void;
  onOpenScheduled?: () => void;
  /** Scheduled items needing action (failed last fires) — badge on
   * the 定时 icon. */
  scheduledActionCount?: number;
  /** Open the CreateProjectDialog. Wired to the quick-action "+"
   * and the empty Project Review hint. */
  onNewProject?: () => void;
  /** Click the 项目 icon → enter/exit Project Review. */
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
  /** Count of archived sessions. Not rendered as a numeral — it only
   * decides whether the footer exists at all (0 → no footer row). */
  archivedCount?: number;
  /** Session that currently holds the Desktop Pet, or `null` when no
   * pet is running. Renders a small Cat badge on the matching session
   * row so users see "where the pet lives" at a glance — non-
   * interactive status, not a click target. */
  petAttachedSessionId?: string | null;
  /** Map of session-id -> that session's open goal, so a row carrying
   * a goal shows its state instead of reading as a finished chat. */
  sessionGoalStatus?: Map<string, GoalBrief>;
}

/**
 * Left navigation panel. Per DESIGN.md §4.2 Sidebar Spec.
 *
 * Two visual modes, derived from `sessions.length`:
 *
 *   full  — sessions[] non-empty: header + new-chat row + bucketed
 *           sections (pinned/today/week/earlier), plus the archive
 *           footer when anything is archived
 *   empty — sessions[] empty: header + new-chat row + muted hint
 *           ("你的对话会出现在这里。"); no sections
 *
 * Either way the archive footer follows one rule: it exists only when
 * archived sessions exist.
 *
 * The active session row gets `bg-selected` (apricot tint) — this is a
 * brand moment, not just hover state. Since 2026-08-21 it also carries a
 * lift (shadow) and full-strength title ink while every other row steps
 * back to ink-soft; one channel was not enough to catch at a glance. See
 * the channel inventory in SidebarSessionRow.
 */
export function Sidebar({
  sessions,
  projects = [],
  activeId,
  newChatActive = false,
  activeProjectFilter,
  projectViewOpen = false,
  expandedProjectIds = [],
  projectReviewNowMs = projectReviewFallbackNowMs(),
  onSelectSession,
  onNewChat,
  onSearch,
  onOpenScheduled,
  scheduledActionCount,
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
  petAttachedSessionId,
  sessionGoalStatus,
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
  // Which timeline bucket the active session sits in — the reveal effect
  // below watches it so a row that jumps sections (an old session gets a
  // new message: borrowed slot under 更早 → top of 今天) is followed.
  const activeBucket = useMemo(
    () => (activeId ? findSessionBucket(globalBuckets, activeId) : undefined),
    [globalBuckets, activeId],
  );
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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Drives the new-chat row's scroll-linked divider. Set from onScroll
  // only (React bails out when the boolean does not change).
  const [listScrolled, setListScrolled] = useState(false);
  // Last session the user picked by pressing a row in this sidebar
  // (timeline or Project Review). The reveal effect skips that one
  // selection: rows activate on pointerdown, so scrolling a half-visible
  // row into view would slide it out from under the cursor mid-click.
  const sidebarSelectedIdRef = useRef<string | null>(null);
  const previousRevealRef = useRef<{
    id?: string;
    bucket?: SessionBucket;
  } | null>(null);
  const handleSelectSession = (id: string) => {
    sidebarSelectedIdRef.current = id;
    onSelectSession?.(id);
  };

  // Keep "you are here" on screen. When the active session changes from
  // outside the list (search / ⌘K / EarlierDialog / a new chat's first
  // send / mount) or its row changes section while it stays active,
  // bring the row into view if it isn't fully visible. Instant, not
  // smooth: the user's attention is in the main pane, and motion in the
  // periphery should stay quiet. `nearest` + the row's scroll-my-2 move
  // the list just enough to show the row with 8px of air. Declared
  // before the mode-flip effect below, so if both ever fire in one
  // commit, the flip's snap-to-top still has the last word.
  useEffect(() => {
    const previous = previousRevealRef.current;
    previousRevealRef.current = { id: activeId, bucket: activeBucket };
    const idChanged = previous === null || previous.id !== activeId;
    if (!idChanged && previous.bucket === activeBucket) return;
    // The click mark only answers "did THIS selection come from a row".
    // Consume it on every selection change, matched or not: a mark left
    // by pressing the already-active row (activeId never moved) must not
    // silence a later outside selection of that same session. A bucket
    // change reveals regardless of origin.
    const fromSidebarClick =
      idChanged && sidebarSelectedIdRef.current === activeId;
    if (idChanged) sidebarSelectedIdRef.current = null;
    if (!activeId || fromSidebarClick) return;

    const container = scrollContainerRef.current;
    const row = container?.querySelector<HTMLElement>(
      `[data-session-id="${CSS.escape(activeId)}"]`,
    );
    // Not listed (archived, no project in Project Review), or sitting in
    // a collapsed project drawer — those stay mounted at zero height
    // inside overflow-hidden boxes, and scrollIntoView would scroll the
    // drawer's own clip box. Nothing to reveal either way.
    if (!container || !row || row.closest("[data-collapsed-drawer]")) return;
    const rowRect = row.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (
      rowRect.top >= containerRect.top &&
      rowRect.bottom <= containerRect.bottom
    ) {
      return;
    }
    row.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [activeId, activeBucket]);

  useEffect(() => {
    const previousProjectViewOpen = previousProjectViewOpenRef.current;
    previousProjectViewOpenRef.current = projectViewOpen;
    if (projectViewOpen === previousProjectViewOpen) return;

    // Mode flip = a new document: snap the shared scroll container to
    // the top, instantly. Without this, switching modes from a deeply
    // scrolled list plays the whole entrance choreography above the
    // fold and lands with a clamp jump once the old view unmounts.
    // Instant, not smooth — the entrance animation itself supplies
    // the motion continuity.
    scrollContainerRef.current?.scrollTo({ top: 0 });

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
    // @container/sidebar: the width SidebarHeader and the new-chat row
    // both query to decide where 搜索 / 定时 / 项目 go
    // (sidebar/sidebar-width.ts).
    <div className="@container/sidebar flex h-full flex-col bg-chrome text-[13px] text-ink">
      <SidebarHeader
        onSearch={onSearch}
        onOpenScheduled={onOpenScheduled}
        scheduledActionCount={scheduledActionCount}
        projectViewOpen={projectViewOpen}
        onToggleProjectView={onToggleProjectView}
      />
      <SidebarQuickActions
        onNewChat={onNewChat}
        onSearch={onSearch}
        onOpenScheduled={onOpenScheduled}
        scheduledActionCount={scheduledActionCount}
        projectViewOpen={projectViewOpen}
        onToggleProjectView={onToggleProjectView}
        activeProjectName={activeProject?.name}
        newChatActive={newChatActive}
        listScrolled={listScrolled}
      />

      <div
        ref={scrollContainerRef}
        onScroll={(e) => setListScrolled(e.currentTarget.scrollTop > 0)}
        className="scrollbar-stable min-h-0 flex-1 overflow-y-auto pb-2"
      >
        {projectReviewPhase && (
          <SidebarProjectReviewPresence phase={projectReviewPhase}>
            <SidebarProjectReview
              projects={navigationProjects}
              sessionsByProjectId={projectSessionsById}
              activeProjectFilter={activeProjectFilter}
              expandedProjectIds={expandedProjectIdSet}
              reviewNowMs={projectReviewNowMs}
              activeId={activeId}
              petAttachedSessionId={petAttachedSessionId}
              sessionGoalStatus={sessionGoalStatus}
              onToggleProjectExpanded={onToggleProjectExpanded}
              onStartProjectConversation={onStartProjectConversation}
              onSelectSession={handleSelectSession}
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
                sessionGoalStatus={sessionGoalStatus}
                onSelectSession={handleSelectSession}
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

      {/* The drawer appears the moment it has content, and not before —
          an empty "已归档" row is chrome for nothing (it opens an empty
          dialog), which is why fresh installs never showed one. Same
          rule now covers a used install that has archived nothing yet.
          Presence carries the whole signal, so the footer needs no
          numeral: archiving only ever accumulates, and a forever-
          climbing counter on the quietest row reads as debt for work
          the user already decided was done. The exact count lives in
          the ArchivedDialog header, where it is actually consulted. */}
      {archivedCount > 0 && <SidebarFooter onOpenArchived={onOpenArchived} />}
    </div>
  );
}
