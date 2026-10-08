import { useEffect, useMemo, useRef, useState } from "react";

import { useDayStamp } from "@/hooks/useDayStamp";
import { useSidebarProjectsCollapsed } from "@/hooks/useSidebarProjectsCollapsed";
import { useCopy } from "@/lib/i18n";
import { sortProjectsForNavigation } from "@/lib/projects";
import {
  buildSidebarSections,
  findSectionsSlot,
  SIDEBAR_TIME_BUCKETS,
} from "@/lib/sidebar-timeline";
import type { GoalBrief } from "@/types/goal";
import type { Project, Session } from "@/types/session";

import { SidebarFooter } from "./sidebar/SidebarFooter";
import { SidebarHeader } from "./sidebar/SidebarHeader";
import { SidebarQuickActions } from "./sidebar/SidebarQuickActions";
import { SidebarSectionsList } from "./sidebar/SidebarTimeline";

export interface SidebarProps {
  sessions: Session[];
  projects?: Project[];
  activeId?: string;
  /** The main area shows the empty new-chat composer; the 新对话 row
   * is then the sidebar's selected row. */
  newChatActive?: boolean;
  /** Project context for the right-side empty composer — the new-chat
   * row reads it ("新对话 · 项目名"). It does not filter the list. */
  activeProjectFilter?: string;
  /** Project ids whose 项目 section groups are expanded (this run only).
   * Several can be open, to watch work across projects. */
  expandedProjectIds?: string[];
  /** Bring this project's group into view — set by creating a project
   * or a toast's 查看项目. `seq` re-fires a repeat ask. */
  projectReveal?: { id: string; seq: number } | null;
  onSelectSession?: (id: string) => void;
  onNewChat?: () => void;
  onSearch?: () => void;
  onOpenScheduled?: () => void;
  /** Scheduled items needing action (failed last fires) — badge on
   * the 定时 icon. */
  scheduledActionCount?: number;
  /** Open the CreateProjectDialog: the masthead's 新建项目 icon. */
  onNewProject?: () => void;
  /** Click a project group row → expand/collapse that one project. */
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
  /** Project group → 归档全部对话, after its confirm. */
  onArchiveSessions?: (ids: string[]) => void;
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
 * Two visual modes, derived from whether the list shows anything:
 *
 *   full  — something listed: header + new-chat row + bucketed
 *           sections (pinned/today/week/month/earlier), each project's
 *           sessions folded into one collapsible group row
 *           (lib/sidebar-timeline.ts), plus the archive footer when
 *           anything is archived
 *   empty — nothing listed (no sessions, no fresh empty project):
 *           header + new-chat row + muted hint
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
  expandedProjectIds = [],
  projectReveal,
  onSelectSession,
  onNewChat,
  onSearch,
  onOpenScheduled,
  scheduledActionCount,
  onNewProject,
  onToggleProjectExpanded,
  onStartProjectConversation,
  onArchiveSession,
  onRenameSession,
  onTogglePinSession,
  onAssignSessionToProject,
  onTogglePinProject,
  onEditProject,
  onDeleteProject,
  onArchiveSessions,
  onOpenEarlier,
  onOpenArchived,
  archivedCount = 0,
  petAttachedSessionId,
  sessionGoalStatus,
}: SidebarProps) {
  const copy = useCopy();
  const activeProject = activeProjectFilter
    ? projects.find((p) => p.id === activeProjectFilter)
    : undefined;
  // Memoised: building the list walks every session; without memo it
  // re-runs on every Sidebar render, and Sidebar re-renders whenever
  // App does (which can be triggered by lower-frequency state like
  // pendingAskUser / bridgeStatus). `dayStamp` is in the deps because
  // bucketing captures "today" at call time — without it, an app left
  // open past midnight kept yesterday's sessions under 今天 until an
  // unrelated session mutation happened to retrigger the memo.
  const dayStamp = useDayStamp();
  // 置顶, the 项目 section and the time buckets (S1–S6).
  const sections = useMemo(
    () => buildSidebarSections(sessions, projects),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, projects, dayStamp],
  );
  const listEmpty =
    sections.earlier.length === 0 &&
    sections.pinned.length === 0 &&
    sections.projects.length === 0 &&
    sections.otherProjects.length === 0 &&
    SIDEBAR_TIME_BUCKETS.every(
      (bucket) => sections.buckets[bucket].length === 0,
    );
  // Which section the active session sits in (its own bucket, or the
  // 项目 section when a group lists it) — the reveal effect below
  // watches it so a row that jumps sections (an old session gets a new
  // message: borrowed slot under 更早 → top of 今天) is followed.
  const activeSlot = useMemo(
    () => (activeId ? findSectionsSlot(sections, activeId) : undefined),
    [sections, activeId],
  );
  const [projectsCollapsed, setProjectsCollapsed] =
    useSidebarProjectsCollapsed();
  // The 其他项目 row's drawer: this run only, like a group's.
  const [othersOpen, setOthersOpen] = useState(false);
  // A project asked into view (new project / 查看项目) opens a
  // collapsed 项目 section first — and the 其他项目 row when the
  // project sits behind it — or there is no group to show. Render-time
  // adjustment keyed on the request, not an effect: the reveal effect
  // below must find the group in the same commit.
  const [seenRevealSeq, setSeenRevealSeq] = useState(projectReveal?.seq);
  if (projectReveal?.seq !== seenRevealSeq) {
    setSeenRevealSeq(projectReveal?.seq);
    if (projectReveal && projectsCollapsed) setProjectsCollapsed(false);
    if (
      projectReveal &&
      sections.otherProjects.some(
        (item) => item.project.id === projectReveal.id,
      )
    ) {
      setOthersOpen(true);
    }
  }
  const navigationProjects = useMemo(
    () => sortProjectsForNavigation(projects, sessions),
    [projects, sessions],
  );
  const expandedProjectIdSet = useMemo(
    () => new Set(expandedProjectIds),
    [expandedProjectIds],
  );

  // Sidebar-local edit state — only one session can be inline-edited
  // at a time. Lifting this to App.tsx / Zustand would be overkill:
  // edit state is ephemeral UI affecting only sidebar rendering, and
  // not visible / actionable from anywhere else.
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Drives the new-chat row's scroll-linked divider. Set from onScroll
  // only (React bails out when the boolean does not change).
  const [listScrolled, setListScrolled] = useState(false);
  // Last session the user picked by pressing a row in this sidebar. The
  // reveal effect skips that one selection: rows activate on
  // pointerdown, so scrolling a half-visible row into view would slide
  // it out from under the cursor mid-click.
  const sidebarSelectedIdRef = useRef<string | null>(null);
  const previousRevealRef = useRef<{
    id?: string;
    bucket?: string;
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
  // the list just enough to show the row with 8px of air.
  useEffect(() => {
    const previous = previousRevealRef.current;
    previousRevealRef.current = { id: activeId, bucket: activeSlot };
    const idChanged = previous === null || previous.id !== activeId;
    if (!idChanged && previous.bucket === activeSlot) return;
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
    // Not listed (archived), or sitting in a collapsed project drawer —
    // those stay mounted at zero height inside overflow-hidden boxes,
    // and scrollIntoView would scroll the drawer's own clip box. (The
    // selected session of a collapsed group hangs under its row
    // instead, so this only skips rows the user can't see anyway.)
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
  }, [activeId, activeSlot]);

  // Bring a project's group into view when asked from outside the list
  // (a new project, a toast's 查看项目). A drawer that
  // just opened nudges its own sessions into view after its animation.
  useEffect(() => {
    if (!projectReveal) return;
    const group = scrollContainerRef.current?.querySelector<HTMLElement>(
      `[data-project-id="${CSS.escape(projectReveal.id)}"]`,
    );
    group?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [projectReveal]);

  const rowWiring = {
    activeId,
    projects: navigationProjects,
    petAttachedSessionId,
    sessionGoalStatus,
    onSelectSession: handleSelectSession,
    onArchiveSession,
    onTogglePinSession,
    onAssignSessionToProject,
    editingSessionId,
    onRequestRename: onRenameSession
      ? (id: string) => setEditingSessionId(id)
      : undefined,
    onConfirmRename: (id: string, newTitle: string) => {
      onRenameSession?.(id, newTitle);
      setEditingSessionId(null);
    },
    onCancelRename: () => setEditingSessionId(null),
  };
  const groupWiring = {
    expandedProjectIds: expandedProjectIdSet,
    onToggleProjectExpanded,
    onStartProjectConversation,
    onTogglePinProject,
    onEditProject,
    onDeleteProject,
    onArchiveSessions,
  };

  return (
    // @container/sidebar: the width SidebarHeader and the new-chat row
    // both query to decide where 搜索 / 定时 / 项目 go
    // (sidebar/sidebar-width.ts).
    <div className="@container/sidebar flex h-full flex-col bg-chrome text-[13px] text-ink">
      <SidebarHeader
        onSearch={onSearch}
        onOpenScheduled={onOpenScheduled}
        scheduledActionCount={scheduledActionCount}
        onNewProject={onNewProject}
      />
      <SidebarQuickActions
        onNewChat={onNewChat}
        onSearch={onSearch}
        onOpenScheduled={onOpenScheduled}
        scheduledActionCount={scheduledActionCount}
        onNewProject={onNewProject}
        activeProjectName={activeProject?.name}
        newChatActive={newChatActive}
        listScrolled={listScrolled}
      />

      <div
        ref={scrollContainerRef}
        onScroll={(e) => setListScrolled(e.currentTarget.scrollTop > 0)}
        className="scrollbar-stable min-h-0 flex-1 overflow-y-auto pb-2"
      >
        {listEmpty ? (
          <div className="px-5 py-6 text-[12.5px] italic text-ink-muted">
            {copy.sidebar.emptySessions}
          </div>
        ) : (
          <SidebarSectionsList
            sections={sections}
            projectsCollapsed={projectsCollapsed}
            onToggleProjectsCollapsed={() =>
              setProjectsCollapsed(!projectsCollapsed)
            }
            othersOpen={othersOpen}
            onToggleOthers={() => setOthersOpen((open) => !open)}
            onOpenEarlier={onOpenEarlier}
            groupWiring={groupWiring}
            {...rowWiring}
          />
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
