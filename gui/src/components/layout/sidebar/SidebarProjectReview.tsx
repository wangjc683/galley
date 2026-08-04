import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  CaretRight,
  DotsThree,
  Folder,
  FolderOpen,
  Pencil,
  Plus,
  PushPin,
  PushPinSlash,
  Target,
  Trash,
} from "@phosphor-icons/react";

import { IconButton } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/tooltip";
import { useDayStamp } from "@/hooks/useDayStamp";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { effectiveProjectActivityAt } from "@/lib/projects";
import { groupSessions } from "@/lib/sessions";
import { cn } from "@/lib/utils";
import type { GoalBrief } from "@/types/goal";
import type { Project, Session } from "@/types/session";

import {
  SidebarRowMenuContent,
  SidebarRowMenuItem,
  type SidebarRowMenuKind,
  SidebarRowMenuPortal,
  SidebarRowMenuSeparator,
} from "./SidebarRowMenu";
import { SidebarSectionLabel, SidebarTimelineBuckets } from "./SidebarTimeline";
import { PROJECT_ACTIVE_WINDOW_MS, type ProjectScopePhase } from "./types";

export function SidebarProjectReviewPresence({
  phase,
  children,
}: {
  phase: ProjectScopePhase;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid overflow-hidden motion-reduce:transition-none",
        "transition-[grid-template-rows,opacity,transform]",
        phase === "entered" &&
          "grid-rows-[1fr] translate-y-0 opacity-100 duration-(--motion-slow) ease-spring",
        phase === "entering" &&
          "grid-rows-[0fr] -translate-y-2 opacity-0 duration-(--motion-slow) ease-pop",
        phase === "exiting" &&
          "grid-rows-[0fr] -translate-y-2 opacity-0 duration-(--motion-base) ease-in",
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * Project Review is a sidebar mode, not a filter banner. It hides the
 * ordinary timeline and turns projects into collapsible peers of the
 * timeline buckets, so users can keep several project drawers open
 * while monitoring running work.
 */
export function SidebarProjectReview({
  projects,
  sessionsByProjectId,
  activeProjectFilter,
  expandedProjectIds,
  activeGoalProjectIds,
  reviewNowMs,
  activeId,
  petAttachedSessionId,
  goalMasterStatus,
  onToggleProjectExpanded,
  onStartProjectConversation,
  onSelectSession,
  onArchiveSession,
  onTogglePinSession,
  onAssignSessionToProject,
  editingSessionId,
  onRequestRename,
  onConfirmRename,
  onCancelRename,
  onTogglePinProject,
  onEditProject,
  onDeleteProject,
  onNewProject,
}: {
  projects: Project[];
  sessionsByProjectId: Map<string, Session[]>;
  activeProjectFilter?: string;
  expandedProjectIds: Set<string>;
  activeGoalProjectIds?: Set<string>;
  reviewNowMs: number;
  activeId?: string;
  petAttachedSessionId?: string | null;
  goalMasterStatus?: Map<string, GoalBrief>;
  onToggleProjectExpanded?: (id: string) => void;
  onStartProjectConversation?: (id: string) => void;
  onSelectSession?: (id: string) => void;
  onArchiveSession?: (id: string) => void;
  onTogglePinSession?: (id: string) => void;
  onAssignSessionToProject?: (
    sessionId: string,
    projectId: string | null,
  ) => void;
  editingSessionId?: string | null;
  onRequestRename?: (id: string) => void;
  onConfirmRename: (id: string, newTitle: string) => void;
  onCancelRename: () => void;
  onTogglePinProject?: (id: string) => void;
  onEditProject?: (id: string) => void;
  onDeleteProject?: (id: string) => void;
  /** 空状态 CTA:点开 CreateProjectDialog。新用户第一次进项目视图
   * 时,projects 为空——原来的斜体灰字 noProjects 是死路,这里
   * 换成可点按钮,把死路变入口。 */
  onNewProject?: () => void;
}) {
  const copy = useCopy();
  const [olderProjectsOpen, setOlderProjectsOpen] = useState(false);
  const activeProjects: Project[] = [];
  const olderProjects: Project[] = [];
  const cutoffMs = reviewNowMs - PROJECT_ACTIVE_WINDOW_MS;

  for (const project of projects) {
    const activityAt = effectiveProjectActivityAt(
      project,
      sessionsByProjectId.get(project.id) ?? [],
    );
    const activityMs = Date.parse(activityAt);
    const recentlyActive =
      Number.isFinite(activityMs) && activityMs >= cutoffMs;
    if (
      project.pinned ||
      recentlyActive ||
      activeGoalProjectIds?.has(project.id)
    )
      activeProjects.push(project);
    else olderProjects.push(project);
  }

  const renderProject = (project: Project) => {
    const expanded = expandedProjectIds.has(project.id);
    return (
      <Fragment key={project.id}>
        <SidebarProjectRow
          project={project}
          active={project.id === activeProjectFilter || expanded}
          expanded={expanded}
          activeGoal={activeGoalProjectIds?.has(project.id) ?? false}
          onClick={() => onToggleProjectExpanded?.(project.id)}
          onStartConversation={
            onStartProjectConversation
              ? () => onStartProjectConversation(project.id)
              : undefined
          }
          onTogglePin={
            onTogglePinProject
              ? () => onTogglePinProject(project.id)
              : undefined
          }
          onEdit={onEditProject ? () => onEditProject(project.id) : undefined}
          onDelete={
            onDeleteProject ? () => onDeleteProject(project.id) : undefined
          }
        />
        <SidebarProjectDrawer
          expanded={expanded}
          project={project}
          sessions={sessionsByProjectId.get(project.id) ?? []}
          activeId={activeId}
          projects={projects}
          petAttachedSessionId={petAttachedSessionId}
          goalMasterStatus={goalMasterStatus}
          onSelectSession={onSelectSession}
          onArchiveSession={onArchiveSession}
          onTogglePinSession={onTogglePinSession}
          onAssignSessionToProject={onAssignSessionToProject}
          editingSessionId={editingSessionId}
          onStartProjectConversation={
            onStartProjectConversation
              ? () => onStartProjectConversation(project.id)
              : undefined
          }
          onRequestRename={onRequestRename}
          onConfirmRename={onConfirmRename}
          onCancelRename={onCancelRename}
        />
      </Fragment>
    );
  };

  return (
    <section className="pb-2 pt-1">
      {projects.length === 0 ? (
        <SidebarProjectReviewEmpty onNewProject={onNewProject} />
      ) : (
        <>
          {activeProjects.length > 0 && (
            <>
              <SidebarSectionLabel>
                {copy.sidebar.activeProjects}
              </SidebarSectionLabel>
              {activeProjects.map(renderProject)}
            </>
          )}
          {olderProjects.length > 0 && (
            <>
              <SidebarProjectGroupToggle
                label={copy.sidebar.olderProjects}
                count={olderProjects.length}
                open={olderProjectsOpen}
                onToggle={() => setOlderProjectsOpen((open) => !open)}
              />
              {olderProjectsOpen && olderProjects.map(renderProject)}
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Empty state for Project Review. Replaces the old passive italic hint
 * (`noProjects`) with an actionable CTA: this is the moment new users
 * hit "I want projects but have none" — turn the dead end into an entry
 * point. Falls back to the muted hint text only when the host doesn't
 * wire `onNewProject` (defensive — matches the sidebar's "affordance
 * only when host enables it" pattern).
 */
function SidebarProjectReviewEmpty({
  onNewProject,
}: {
  onNewProject?: () => void;
}) {
  const copy = useCopy();
  if (!onNewProject) {
    return (
      <div className="px-5 py-5 text-[12px] italic text-ink-muted">
        {copy.sidebar.noProjects}
      </div>
    );
  }
  return (
    <div className="px-3 py-5">
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={preventMouseFocus}
        onClick={onNewProject}
        className={cn(
          "flex w-full items-center gap-2 rounded-sm border border-brand/30 bg-selected/50 px-3 py-2.5 text-left",
          "text-[12.5px] font-medium text-ink-soft transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
          "hover:border-brand/50 hover:bg-selected hover:text-ink active:translate-y-px",
          "outline-none",
        )}
      >
        {/* regular (not thin): this is the empty state's PRIMARY CTA —
            its plus must not read weaker than the routine new-chat
            entry above. */}
        <Plus size={14} weight="regular" className="shrink-0 text-brand-strong" />
        <span className="min-w-0 flex-1 truncate">
          {copy.sidebar.createFirstProject}
        </span>
      </button>
      <p className="mt-2 px-1 text-[11px] italic leading-relaxed text-ink-muted">
        {copy.sidebar.noProjects}
      </p>
    </div>
  );
}

function SidebarProjectGroupToggle({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={preventMouseFocus}
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "mx-1.5 mt-3 flex w-[calc(100%-12px)] items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted",
        "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm hover:bg-hover hover:text-ink-soft",
        "active:translate-y-px",
        "outline-none",
      )}
    >
      <CaretRight
        size={10}
        weight="thin"
        className={cn(
          "transition-transform duration-(--motion-fast)",
          open && "rotate-90",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {/* tabular-nums: same count family as the timeline bucket
          headers (今天 5 / 本周 8). */}
      <span className="text-[10px] font-medium tabular-nums tracking-normal">
        {count}
      </span>
    </button>
  );
}

function SidebarProjectRow({
  project,
  active,
  expanded,
  activeGoal,
  onClick,
  onStartConversation,
  onTogglePin,
  onEdit,
  onDelete,
}: {
  project: Project;
  active: boolean;
  expanded?: boolean;
  activeGoal?: boolean;
  onClick?: () => void;
  onStartConversation?: () => void;
  onTogglePin?: () => void;
  onEdit?: () => void;
  /** Right-click → Delete project. Sits below a separator + uses
   * destructive (red) styling to make accidental clicks harder. The
   * actual confirm dialog still runs in the parent — this just
   * opens it. */
  onDelete?: () => void;
}) {
  const copy = useCopy();
  const hasRowActions = !!(onTogglePin || onEdit || onDelete);
  const [actionsOpen, setActionsOpen] = useState(false);
  const ProjectIcon = expanded ? FolderOpen : Folder;
  const newConversationTitle = copy.sidebar.newConversationInProjectTitle(
    project.name,
  );
  const row = (
    <div
      data-galley-context-menu-trigger={hasRowActions ? "" : undefined}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        "group relative mx-1.5 flex w-[calc(100%-12px)] items-center gap-2.5 overflow-hidden rounded-sm px-3 py-1.5 text-left text-[13px] outline-none",
        "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
        "active:translate-y-px",
        (onStartConversation || hasRowActions) && "group-hover:pr-16",
        actionsOpen && "pr-16",
        active
          ? "bg-selected text-ink"
          : actionsOpen
            ? "bg-hover text-ink"
            : "text-ink hover:bg-hover",
      )}
    >
      <ProjectIcon
        size={14}
        weight="thin"
        className={cn(
          "shrink-0",
          expanded ? "text-brand-strong" : "text-ink-muted",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {project.pinned && (
        <PushPin
          size={10}
          weight="fill"
          className="shrink-0 text-ink-muted"
          aria-label="pinned"
        />
      )}
      {activeGoal && (
        <IconTooltip text={copy.sidebar.goalRunningInProject}>
          <span
            aria-label={copy.sidebar.goalRunningInProject}
            className="inline-flex shrink-0 text-brand-strong"
          >
            <Target size={11} weight="thin" />
          </span>
        </IconTooltip>
      )}
      {(onStartConversation || hasRowActions) && (
        <div
          className={cn(
            "pointer-events-none absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 opacity-0",
            "group-hover:pointer-events-auto group-hover:opacity-100",
            actionsOpen && "pointer-events-auto opacity-100",
          )}
        >
          {onStartConversation && (
            <IconTooltip text={newConversationTitle}>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={preventMouseFocus}
                onClick={(e) => {
                  e.stopPropagation();
                  onStartConversation();
                }}
                aria-label={newConversationTitle}
                className={cn(
                  // 32px hit area + 14/regular plus per the shared
                  // light-button rules with the quick-action 新建项目
                  // (layout-and-chrome.md §4.2 Project 行).
                  "inline-flex size-[32px] shrink-0 items-center justify-center rounded-sm",
                  "text-ink-muted transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
                  "group-hover:text-ink-soft",
                  "hover:bg-hover hover:text-ink active:translate-y-px active:bg-selected/60",
                  "outline-none",
                )}
              >
                <Plus size={14} weight="regular" />
              </button>
            </IconTooltip>
          )}
          {hasRowActions && (
            <DropdownMenu.Root
              open={actionsOpen}
              onOpenChange={setActionsOpen}
            >
              <IconTooltip text={copy.common.more} side="right">
                <DropdownMenu.Trigger asChild>
                  <IconButton
                    ariaLabel={copy.common.more}
                    tooltip={false}
                    size="xs"
                    active={actionsOpen}
                    tabIndex={-1}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <DotsThree size={15} weight="bold" />
                  </IconButton>
                </DropdownMenu.Trigger>
              </IconTooltip>
              <SidebarRowMenuPortal kind="dropdown">
                <SidebarRowMenuContent
                  kind="dropdown"
                  align="end"
                  sideOffset={6}
                  className="galley-pop-in z-50 min-w-[160px] rounded-md border border-line bg-elevated p-1 shadow-elevated"
                >
                  <SidebarProjectMenuItems
                    kind="dropdown"
                    project={project}
                    onTogglePin={onTogglePin}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                </SidebarRowMenuContent>
              </SidebarRowMenuPortal>
            </DropdownMenu.Root>
          )}
        </div>
      )}
    </div>
  );

  if (!hasRowActions) return row;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{row}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="galley-pop-in z-50 min-w-[160px] rounded-md border border-line bg-elevated p-1 shadow-elevated">
          <SidebarProjectMenuItems
            kind="context"
            project={project}
            onTogglePin={onTogglePin}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function SidebarProjectMenuItems({
  kind,
  project,
  onTogglePin,
  onEdit,
  onDelete,
}: {
  kind: SidebarRowMenuKind;
  project: Project;
  onTogglePin?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const copy = useCopy();
  // rounded-callout (8px) = the menu surface's rounded-md (12px) minus
  // its p-1 (4px) — concentric nested corners (polish-checklist P1).
  const itemClass = cn(
    "flex items-center gap-2 rounded-callout px-2.5 py-1.5 text-[12.5px] text-ink-soft outline-none",
    "data-[highlighted]:bg-hover data-[highlighted]:text-ink",
  );
  const destructiveItemClass = cn(
    "flex items-center gap-2 rounded-callout px-2.5 py-1.5 text-[12.5px] text-error outline-none",
    "data-[highlighted]:bg-error/[var(--opacity-soft)] data-[highlighted]:text-error",
  );

  return (
    <>
      {onTogglePin && (
        <SidebarRowMenuItem
          kind={kind}
          onSelect={onTogglePin}
          className={itemClass}
        >
          {project.pinned ? (
            <>
              <PushPinSlash size={13} weight="thin" />
              {copy.sidebar.unpin}
            </>
          ) : (
            <>
              <PushPin size={13} weight="thin" />
              {copy.sidebar.pin}
            </>
          )}
        </SidebarRowMenuItem>
      )}
      {onEdit && (
        <SidebarRowMenuItem
          kind={kind}
          onSelect={onEdit}
          className={itemClass}
        >
          {/* Pencil, not FolderOpen: on project rows FolderOpen already
              means "expanded" — the menu glyph must say "edit" (same
              icon as session rename). */}
          <Pencil size={13} weight="thin" />
          {copy.sidebar.editProject}
        </SidebarRowMenuItem>
      )}
      {onDelete && (
        <>
          <SidebarRowMenuSeparator
            kind={kind}
            className="my-1 h-px bg-line"
          />
          <SidebarRowMenuItem
            kind={kind}
            onSelect={onDelete}
            className={destructiveItemClass}
          >
            <Trash size={13} weight="thin" />
            {copy.sidebar.deleteProject}
          </SidebarRowMenuItem>
        </>
      )}
    </>
  );
}

function SidebarProjectDrawer({
  expanded,
  project,
  sessions,
  activeId,
  projects,
  petAttachedSessionId,
  goalMasterStatus,
  onSelectSession,
  onArchiveSession,
  onTogglePinSession,
  onAssignSessionToProject,
  editingSessionId,
  onStartProjectConversation,
  onRequestRename,
  onConfirmRename,
  onCancelRename,
}: {
  expanded: boolean;
  project: Project;
  sessions: Session[];
  activeId?: string;
  projects: Project[];
  petAttachedSessionId?: string | null;
  goalMasterStatus?: Map<string, GoalBrief>;
  onSelectSession?: (id: string) => void;
  onArchiveSession?: (id: string) => void;
  onTogglePinSession?: (id: string) => void;
  onAssignSessionToProject?: (
    sessionId: string,
    projectId: string | null,
  ) => void;
  editingSessionId?: string | null;
  onStartProjectConversation?: () => void;
  onRequestRename?: (id: string) => void;
  onConfirmRename: (id: string, newTitle: string) => void;
  onCancelRename: () => void;
}) {
  // Memoized like the global list's call (Sidebar.tsx) — this ran in
  // the render body of every project drawer, collapsed ones included.
  // dayStamp keeps the 今天/本周 buckets honest past midnight (see
  // useDayStamp).
  const dayStamp = useDayStamp();
  const projectBuckets = useMemo(
    () => groupSessions(sessions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, dayStamp],
  );
  const projectEmpty = sessions.length === 0;

  // Expanding a project near the bottom of the scroll container used
  // to animate the drawer open below the fold — the click appeared to
  // do nothing. After the 240ms height animation settles, nudge the
  // revealed sessions into view (nearest: no jump when already
  // visible).
  const drawerRef = useRef<HTMLDivElement>(null);
  const prevExpandedRef = useRef(expanded);
  useEffect(() => {
    const wasExpanded = prevExpandedRef.current;
    prevExpandedRef.current = expanded;
    if (!expanded || wasExpanded) return;
    const id = window.setTimeout(() => {
      drawerRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }, 260);
    return () => window.clearTimeout(id);
  }, [expanded]);

  return (
    <div
      ref={drawerRef}
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows] duration-(--motion-slow) ease-spring motion-reduce:transition-none",
        expanded
          ? "grid-rows-[1fr]"
          : "grid-rows-[0fr] duration-(--motion-fast) ease-in",
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={cn(
            "ml-6 mr-1.5 border-l border-brand/35 pb-2 pl-1",
            "transition-[opacity,transform] duration-(--motion-base) ease-pop motion-reduce:transition-none",
            expanded
              ? "translate-y-0 opacity-100 delay-[40ms]"
              : "-translate-y-2 opacity-0",
            !expanded && "pointer-events-none delay-0 duration-(--motion-fast) ease-in",
          )}
        >
          {projectEmpty ? (
            <SidebarProjectEmptyHint
              project={project}
              onStartProjectConversation={onStartProjectConversation}
            />
          ) : (
            <SidebarTimelineBuckets
              buckets={projectBuckets}
              activeId={activeId}
              projects={projects}
              petAttachedSessionId={petAttachedSessionId}
              goalMasterStatus={goalMasterStatus}
              onSelectSession={onSelectSession}
              onArchiveSession={onArchiveSession}
              onTogglePinSession={onTogglePinSession}
              onAssignSessionToProject={onAssignSessionToProject}
              editingSessionId={editingSessionId}
              collapseEarlier={false}
              onRequestRename={onRequestRename}
              onConfirmRename={onConfirmRename}
              onCancelRename={onCancelRename}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SidebarProjectEmptyHint({
  project,
  onStartProjectConversation,
}: {
  project: Project;
  onStartProjectConversation?: () => void;
}) {
  const copy = useCopy();
  const label = copy.sidebar.newProjectConversation;
  const newConversationTitle = copy.sidebar.newConversationInProjectTitle(
    project.name,
  );
  if (!onStartProjectConversation) {
    // Defensive branch (host didn't wire the action): render plain
    // muted text, NOT the bordered plus-pill — a dead control styled
    // like the live one is a lie of an affordance.
    return (
      <div className="mx-1.5 mt-3 px-3 py-2 text-[12px] italic text-ink-muted">
        {label}
      </div>
    );
  }

  return (
    <IconTooltip text={newConversationTitle}>
      <button
        type="button"
        onClick={onStartProjectConversation}
        aria-label={newConversationTitle}
        className={cn(
          "mx-1.5 mt-3 flex w-[calc(100%-12px)] items-center gap-2 rounded-sm border border-line/70 bg-elevated/55 px-3 py-2 text-left",
          "text-[12px] font-medium text-ink-soft transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
          "hover:border-brand/35 hover:bg-selected/70 hover:text-ink active:translate-y-px",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        )}
      >
        <Plus size={13} weight="regular" className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    </IconTooltip>
  );
}
