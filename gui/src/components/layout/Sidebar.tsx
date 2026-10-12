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
import { cn } from "@/lib/utils";
import type { GoalBrief } from "@/types/goal";
import type { Project, Session } from "@/types/session";

import {
  isDemoSessionId,
  MainChatDemoLiveContext,
  useMainChatDemoOverlay,
} from "./sidebar/main-chat-demo";
import {
  useMainChatLayout,
  useMainChatTrialCopy,
} from "./sidebar/main-chat-layout";
import { SidebarFooter } from "./sidebar/SidebarFooter";
import { SidebarHeader } from "./sidebar/SidebarHeader";
import {
  SidebarNarrowNavRow,
  SidebarQuickActions,
} from "./sidebar/SidebarQuickActions";
import { SidebarSessionRow } from "./sidebar/SidebarSessionRow";
import {
  SidebarNewSideChatRow,
  SidebarOtherSources,
  SidebarSideChatEmptyHint,
  SidebarSideChatHeader,
} from "./sidebar/SidebarSideChats";
import { SidebarSectionsList } from "./sidebar/SidebarTimeline";

export interface SidebarProps {
  sessions: Session[];
  projects?: Project[];
  activeId?: string;
  /** The main area shows the empty new-chat composer; the 新对话 row
   * is then the sidebar's selected row. */
  newChatActive?: boolean;
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
 * The main chat (主对话, managed runtime only, ticket 02) is never in
 * 置顶 / 项目 / a time bucket: its row stands on its own above the list,
 * outside the scroll, and is the home (full ink even when another row
 * is selected). Its layouts are on trial behind a temporary switcher
 * (sidebar/main-chat-layout.ts, ticket 07):
 *
 *   A3 — the main-chat row above a quiet 新对话 row; nothing else moves.
 *   B / B′ — the main-chat row, then a 「旁聊」 section header with the
 *        new-chat + (sidebar/SidebarSideChats.tsx); the list below
 *        holds what a person started, agent-started sessions outside
 *        projects fold into 「其他来源 N」. B′ adds the collapse
 *        (AppShell).
 *
 * Without a main chat (the external runtime) every layout is today's
 * sidebar.
 *
 * The active session row gets `bg-selected` (apricot tint) — this is a
 * brand moment, not just hover state. Since 2026-08-21 it also carries a
 * lift (shadow) and full-strength title ink while every other row steps
 * back to ink-soft; one channel was not enough to catch at a glance. See
 * the channel inventory in SidebarSessionRow.
 */
export function Sidebar(props: SidebarProps) {
  // TEMPORARY: the trial's demo states (sidebar/main-chat-demo.ts) —
  // fake live states and fake sessions over the real list, render layer
  // only; actions aimed at a fake row go nowhere.
  const demo = useMainChatDemoOverlay(props.sessions);
  return (
    <MainChatDemoLiveContext.Provider value={demo?.live ?? null}>
      <SidebarBody
        {...(demo ? withDemoSessions(props, demo.sessions) : props)}
      />
    </MainChatDemoLiveContext.Provider>
  );
}

/** TEMPORARY (demo states): the demo's list, and every per-session
 * action filtered so a fake row reaches no store and no Core. */
function withDemoSessions(
  props: SidebarProps,
  sessions: Session[],
): SidebarProps {
  const realOnly =
    <A extends unknown[]>(fn?: (id: string, ...rest: A) => void) =>
    (id: string, ...rest: A) => {
      if (!isDemoSessionId(id)) fn?.(id, ...rest);
    };
  return {
    ...props,
    sessions,
    onSelectSession: realOnly(props.onSelectSession),
    onArchiveSession:
      props.onArchiveSession && realOnly(props.onArchiveSession),
    onRenameSession: props.onRenameSession && realOnly(props.onRenameSession),
    onTogglePinSession:
      props.onTogglePinSession && realOnly(props.onTogglePinSession),
    onAssignSessionToProject:
      props.onAssignSessionToProject &&
      realOnly(props.onAssignSessionToProject),
    onCreateProjectForSession:
      props.onCreateProjectForSession &&
      realOnly(props.onCreateProjectForSession),
    onArchiveSessions:
      props.onArchiveSessions &&
      ((ids) =>
        props.onArchiveSessions?.(ids.filter((id) => !isDemoSessionId(id)))),
  };
}

function SidebarBody({
  sessions,
  projects = [],
  activeId,
  newChatActive = false,
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
  sessionGoalStatus,
}: SidebarProps) {
  const copy = useCopy();
  // TEMPORARY: the A3 / B / B′ trial (see main-chat-layout.ts).
  const mainChatLayout = useMainChatLayout();
  const trialCopy = useMainChatTrialCopy();
  const mainChat = useMemo(() => findMainChat(sessions), [sessions]);
  const listSessions = useMemo(
    () => (mainChat ? sessions.filter((s) => s.id !== mainChat.id) : sessions),
    [sessions, mainChat],
  );
  // B and B′ draw the same sidebar (B′'s collapse lives in AppShell).
  const sectioned = mainChat !== undefined && mainChatLayout !== "A3";
  // Memoised: building the list walks every session; without memo it
  // re-runs on every Sidebar render, and Sidebar re-renders whenever
  // App does (which can be triggered by lower-frequency state like
  // pendingAskUser / bridgeStatus). `dayStamp` is in the deps because
  // bucketing captures "today" at call time — without it, an app left
  // open past midnight kept yesterday's sessions under 今天 until an
  // unrelated session mutation happened to retrigger the memo.
  const dayStamp = useDayStamp();
  // 置顶, the 项目 section and the time buckets (S1–S6); B also takes
  // the agent-started sessions out into 「其他来源」.
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
  // B's empty-state line stays until a person has started a
  // conversation (「其他来源」 can be there before that).
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
  // B's 「其他来源」 group: collapsed at launch, like a project's.
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

  // The main chat's row: a session row in every respect but its label,
  // its resting house glyph and its missing menu (no pin, rename,
  // project, archive). Same wiring as a list row otherwise. In B it
  // says 「什么都可以跟它说」 until its first message.
  const mainChatRow = mainChat ? (
    <SidebarSessionRow
      session={mainChat}
      active={activeId === mainChat.id}
      petAttached={petAttachedSessionId === mainChat.id}
      sessionGoal={sessionGoalStatus?.get(mainChat.id)}
      projects={navigationProjects}
      onClick={() => handleSelectSession(mainChat.id)}
      mainChatLabel={trialCopy.mainChat}
      mainChatHome
      idleSubline={
        sectioned && (mainChat.turnCount ?? 0) === 0
          ? trialCopy.idleSubline
          : undefined
      }
    />
  ) : null;

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
      {sectioned ? (
        <>
          <SidebarNarrowNavRow
            onSearch={onSearch}
            onOpenScheduled={onOpenScheduled}
            scheduledActionCount={scheduledActionCount}
            onNewProject={onNewProject}
          />
          {/* B: the main-chat row and the section header stay put above
              the list, and own the divider the 新对话 row had — clear at
              rest, drawn once the list scrolls under them
              (SidebarQuickActions). */}
          <div
            className={cn(
              "border-b pb-1",
              listScrolled ? "border-line/70" : "border-transparent",
            )}
          >
            <div className="pt-1">{mainChatRow}</div>
            <div className="pt-2">
              <SidebarSideChatHeader
                label={trialCopy.sectionLabel}
                newChatLabel={trialCopy.newChat}
                onNewChat={onNewChat}
              />
            </div>
          </div>
        </>
      ) : (
        <>
          {/* A3: the main-chat row above the 新对话 row, which keeps its
              place, its divider and its narrow fallback, but quiet
              (smaller, no brand plus). Without a main chat: today's
              sidebar. */}
          {mainChatRow && <div className="pt-1">{mainChatRow}</div>}
          <SidebarQuickActions
            quiet={mainChat !== undefined}
            newChatLabel={mainChat ? trialCopy.newChat : undefined}
            onNewChat={onNewChat}
            onSearch={onSearch}
            onOpenScheduled={onOpenScheduled}
            scheduledActionCount={scheduledActionCount}
            onNewProject={onNewProject}
            newChatActive={newChatActive}
            listScrolled={listScrolled}
          />
        </>
      )}

      <div
        ref={scrollContainerRef}
        onScroll={(e) => setListScrolled(e.currentTarget.scrollTop > 0)}
        className="scrollbar-stable min-h-0 flex-1 overflow-y-auto pb-2"
      >
        {sectioned && newChatActive && (
          <SidebarNewSideChatRow
            label={trialCopy.newChat}
            onClick={onNewChat}
          />
        )}
        {sectioned && !hasHumanChats && (
          <SidebarSideChatEmptyHint text={trialCopy.emptyHint} />
        )}
        {listEmpty ? (
          // B's section line above already says it.
          sectioned ? null : (
            <div className="px-5 py-6 text-[12.5px] italic text-ink-muted">
              {copy.sidebar.emptySessions}
            </div>
          )
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
            otherSourcesSlot={
              <SidebarOtherSources
                sessions={sections.otherSources}
                label={trialCopy.otherSources}
                expanded={otherSourcesOpen}
                onToggleExpanded={() => setOtherSourcesOpen((open) => !open)}
                {...rowWiring}
              />
            }
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
