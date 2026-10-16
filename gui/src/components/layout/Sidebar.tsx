import { useEffect, useMemo, useRef, useState } from "react";

import { useDayStamp } from "@/hooks/useDayStamp";
import { useSidebarProjectsCollapsed } from "@/hooks/useSidebarProjectsCollapsed";
import { useCopy } from "@/lib/i18n";
import { findMainChat } from "@/lib/main-chat";
import { sortProjectsForNavigation } from "@/lib/projects";
import {
  buildSidebarSections,
  findSectionsSlot,
  isHumanStarted,
  SIDEBAR_TIME_BUCKETS,
} from "@/lib/sidebar-timeline";
import { isUnpromotedSubtask, unpromotedSubtasksOf } from "@/lib/subtasks";
import { cn } from "@/lib/utils";
import type { Project, Session } from "@/types/session";

import {
  SidebarAssistantCard,
  SidebarAssistantEmptyHint,
  SidebarNewChatRow,
} from "./sidebar/SidebarAssistant";
import { SidebarFooter } from "./sidebar/SidebarFooter";
import { SidebarHeader } from "./sidebar/SidebarHeader";
import { SidebarQuickActions } from "./sidebar/SidebarQuickActions";
import { SidebarOtherSources } from "./sidebar/SidebarSideChats";
import { SidebarSectionsList } from "./sidebar/SidebarTimeline";

export interface SidebarProps {
  sessions: Session[];
  projects?: Project[];
  activeId?: string;
  /** The main area shows the empty new-chat composer (a project's too):
   * the 新对话 row is then the sidebar's selected row. */
  newChatActive?: boolean;
  /** While the empty composer is up, the session the store has active
   * — the one its first send just created (createSessionPersisted lists
   * it before the screen flips). With a main chat its row takes the
   * selection at once. */
  newChatSessionId?: string;
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
  /** 加入项目 submenu → 新建项目…: open CreateProjectDialog; the new
   * project takes this session in. */
  onCreateProjectForSession?: (sessionId: string) => void;
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
 *           ("你的对话会出现在这里。"); no sections.
 *
 * Either way the archive footer follows one rule: it exists only when
 * archived sessions exist.
 *
 * With a main chat (主对话, managed runtime only; main chat PRD rulings
 * 30–37, 60–65, tickets 08 / 09 / 18) the main chat is the assistant,
 * Galley, and the sidebar has two blocks. On the chrome, under a
 * masthead without the wordmark (the traffic lights' zone and the three
 * icons), the assistant's card — one row of an IM chat list — then the
 * sidebar's strongest line (line-strong). Under it, on the app ground,
 * the list opens on 「＋ 新对话 ⌘N」 as its sticky first row
 * (sidebar/SidebarAssistant.tsx); the buckets hold what a person
 * started, and agent-started sessions outside projects fold into
 * 「其他来源 N」. The main chat and its unpromoted subtasks are never
 * listed. The whole sidebar can collapse (AppShell,
 * header/SidebarCollapseToggle.tsx).
 *
 * Without a main chat (the external runtime) it is the sidebar as it
 * was before: the wordmark, the 新对话 row heading the list, nothing
 * split off, and nothing collapses.
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
  newChatSessionId,
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
  onCreateProjectForSession,
  onTogglePinProject,
  onEditProject,
  onDeleteProject,
  onArchiveSessions,
  onOpenEarlier,
  onOpenArchived,
  archivedCount = 0,
  petAttachedSessionId,
}: SidebarProps) {
  const copy = useCopy();
  const mainChat = useMemo(() => findMainChat(sessions), [sessions]);
  // The list never holds the main chat (its card stands above it) nor a
  // subtask the user has not written in yet (ticket 06a): that one is a
  // card under the main chat reply that sent it, and its states reach
  // the assistant's card instead.
  const listSessions = useMemo(
    () =>
      sessions.filter((s) => s.id !== mainChat?.id && !isUnpromotedSubtask(s)),
    [sessions, mainChat],
  );
  const mainChatSubtasks = useMemo(
    () => unpromotedSubtasksOf(sessions, mainChat?.id),
    [sessions, mainChat],
  );
  // An open subtask keeps the assistant's card selected: the selected
  // place must be in the sidebar (layout-and-chrome.md), and the
  // subtask is not.
  const mainChatSelected =
    !!mainChat &&
    (activeId === mainChat.id ||
      mainChatSubtasks.some((s) => s.id === activeId));
  // The sectioned sidebar is the main chat's (its collapse lives in
  // AppShell); the external runtime keeps the sidebar as it was.
  const sectioned = mainChat !== undefined;
  // With a main chat, the 「＋ 新对话」 row is lit while the empty
  // composer is up — a project's too (ruling 64; it replaced ticket 13's
  // pressed +). The first send's session is listed (and the store's
  // active one) a beat before the screen flips; it takes over at once,
  // selected, so the lit row never stands beside its unselected row.
  const newChatUp = sectioned && newChatActive;
  const handoffId = newChatUp
    ? listSessions.find((s) => s.id === newChatSessionId)?.id
    : undefined;
  const rowActiveId = activeId ?? handoffId;
  const newChatLit = newChatUp && !handoffId;
  // Memoised: building the list walks every session; without memo it
  // re-runs on every Sidebar render, and Sidebar re-renders whenever
  // App does (which can be triggered by lower-frequency state like
  // pendingAskUser / bridgeStatus). `dayStamp` is in the deps because
  // bucketing captures "today" at call time — without it, an app left
  // open past midnight kept yesterday's sessions under 今天 until an
  // unrelated session mutation happened to retrigger the memo.
  const dayStamp = useDayStamp();
  // 置顶, the 项目 section and the time buckets (S1–S6); sectioned, the
  // agent-started sessions also come out into 「其他来源」.
  const sections = useMemo(
    () =>
      buildSidebarSections(listSessions, projects, {
        splitOtherSources: sectioned,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listSessions, projects, dayStamp, sectioned],
  );
  const listEmpty =
    sections.earlier.length === 0 &&
    sections.pinned.length === 0 &&
    sections.projects.length === 0 &&
    sections.otherProjects.length === 0 &&
    sections.otherSources.length === 0 &&
    SIDEBAR_TIME_BUCKETS.every(
      (bucket) => sections.buckets[bucket].length === 0,
    );
  // With a main chat the list's empty line stays until a person has
  // started a conversation (「其他来源」 can be there before that).
  const hasHumanChats = useMemo(
    () => listSessions.some(isHumanStarted),
    [listSessions],
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
  // The 更多项目 row's fold: this run only, like a group's.
  const [othersOpen, setOthersOpen] = useState(false);
  // The 「其他来源」 group: collapsed at launch, like a project's.
  const [otherSourcesOpen, setOtherSourcesOpen] = useState(false);
  // A project asked into view (new project / 查看项目) opens a
  // collapsed 项目 section first — and the 更多项目 row when the
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
    () => sortProjectsForNavigation(projects, listSessions),
    [projects, listSessions],
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
    // Sectioned, the sticky new-chat row covers the list's top: a row
    // under it is not in view (the container's scroll-pt clears it for
    // scrollIntoView).
    const stickyRow = container.querySelector<HTMLElement>(
      "[data-sidebar-section-header]",
    );
    const visibleTop = stickyRow
      ? stickyRow.getBoundingClientRect().bottom
      : containerRect.top;
    if (rowRect.top >= visibleTop && rowRect.bottom <= containerRect.bottom) {
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
    activeId: rowActiveId,
    projects: navigationProjects,
    petAttachedSessionId,
    onSelectSession: handleSelectSession,
    onArchiveSession,
    onTogglePinSession,
    onAssignSessionToProject,
    onCreateProjectForSession,
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

  const sectionsList = (
    <SidebarSectionsList
      sections={sections}
      projectsCollapsed={projectsCollapsed}
      onToggleProjectsCollapsed={() => setProjectsCollapsed(!projectsCollapsed)}
      othersOpen={othersOpen}
      onToggleOthers={() => setOthersOpen((open) => !open)}
      onOpenEarlier={onOpenEarlier}
      otherSourcesSlot={
        <SidebarOtherSources
          sessions={sections.otherSources}
          expanded={otherSourcesOpen}
          onToggleExpanded={() => setOtherSourcesOpen((open) => !open)}
          {...rowWiring}
        />
      }
      groupWiring={groupWiring}
      {...rowWiring}
    />
  );

  return (
    // @container/sidebar: the width SidebarHeader and the new-chat row
    // both query to decide where 搜索 / 定时 / 项目 go
    // (sidebar/sidebar-width.ts).
    <div className="@container/sidebar flex h-full flex-col bg-chrome text-[13px] text-ink">
      <SidebarHeader
        wordmark={!sectioned}
        todo={sectioned}
        onSearch={onSearch}
        onOpenScheduled={onOpenScheduled}
        scheduledActionCount={scheduledActionCount}
        onNewProject={onNewProject}
      />
      {mainChat ? (
        // The assistant stays put on the chrome above the sidebar's
        // strongest structural line (line-strong, ticket 09: JC's C3 +
        // 常显 + 加重): what stays put sits above it, the scrolling list
        // below. The 10-08 "no line at rest" rule kept the 新对话 row
        // joined to the list it heads; the card heads nothing.
        <div className="border-b border-line-strong py-1.5">
          <SidebarAssistantCard
            mainChat={mainChat}
            subtasks={mainChatSubtasks}
            selected={mainChatSelected}
            open={activeId === mainChat.id}
            onOpen={() => handleSelectSession(mainChat.id)}
          />
        </div>
      ) : (
        <SidebarQuickActions
          onNewChat={onNewChat}
          onSearch={onSearch}
          onOpenScheduled={onOpenScheduled}
          scheduledActionCount={scheduledActionCount}
          onNewProject={onNewProject}
          newChatActive={newChatActive}
          listScrolled={listScrolled}
        />
      )}

      <div
        ref={scrollContainerRef}
        onScroll={(e) => setListScrolled(e.currentTarget.scrollTop > 0)}
        className={cn(
          "scrollbar-stable min-h-0 flex-1 overflow-y-auto pb-2",
          // scrollIntoView clears the sticky new-chat row (42px: pt-1.5
          // + the button's h-8 + pb-1).
          sectioned && "scroll-pt-[42px]",
        )}
      >
        {sectioned ? (
          // The list, on the app ground (ticket 09, C3) while the card
          // stays on chrome. `app` is the one ground on the far side of
          // chrome from the sidebar's hover / selected fills in both
          // themes, so both separate more on it, not less. pb-2: the
          // block's last row doesn't sit on its bottom edge.
          <div data-sidebar-section="" className="bg-app pb-2">
            {/* The new-chat row sticks to the list's top, opaque and
                above the rows (their ⋯ / + overlays are z-10), so it
                never scrolls away; inset 6px from the ground's top as
                the rows are from its sides. Under it the list keeps the
                external runtime's spacing: the first label is 18px off
                the button (pb-1 + its pt-3.5). */}
            <div
              data-sidebar-section-header=""
              className="sticky top-0 z-20 bg-app pb-1 pt-1.5"
            >
              <SidebarNewChatRow
                lit={newChatLit}
                onNewChat={onNewChat}
                onSearch={onSearch}
                onOpenScheduled={onOpenScheduled}
                scheduledActionCount={scheduledActionCount}
                onNewProject={onNewProject}
              />
              {/* Rows sliding under the stuck row fade into its ground
                  instead of being cut by an invisible edge (rejected
                  10-08) — not a line, which would fence the row off
                  from the list it heads right under the strong line.
                  Same recipe as Settings' scrolled-pane fade; only once
                  the list scrolls, since at rest nothing is clipped. */}
              <div
                aria-hidden
                data-sidebar-section-fade=""
                style={{
                  background:
                    "linear-gradient(to bottom, var(--color-app), transparent)",
                }}
                className={cn(
                  "pointer-events-none absolute inset-x-0 top-full h-3",
                  listScrolled ? "opacity-100" : "opacity-0",
                )}
              />
            </div>
            {!hasHumanChats && <SidebarAssistantEmptyHint />}
            {/* Empty, the line above already says it. */}
            {!listEmpty && sectionsList}
          </div>
        ) : listEmpty ? (
          <div className="px-5 py-6 text-[12.5px] italic text-ink-muted">
            {copy.sidebar.emptySessions}
          </div>
        ) : (
          sectionsList
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
