import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  CaretDown,
  CaretUp,
  DotsThree,
  Folder,
  FolderOpen,
  Pencil,
  Plus,
  PushPin,
  PushPinSlash,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { IconButton } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { IconTooltip } from "@/components/ui/tooltip";
import {
  type SessionsAttentionView,
  useSessionsAttention,
} from "@/hooks/useSessionsAttention";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";
import type { Project, Session } from "@/types/session";

import {
  SidebarRowMenuContent,
  SidebarRowMenuItem,
  type SidebarRowMenuKind,
  SidebarRowMenuPortal,
  SidebarRowMenuSeparator,
} from "./SidebarRowMenu";
import {
  SidebarTimelineRow,
  type SidebarTimelineRowWiring,
} from "./SidebarTimelineRow";

/**
 * A project in the sidebar's 项目 section (2026-10-08,
 * .scratch/sidebar-project-groups/PRD.md, replacing Project Review): one
 * row for the project, its sessions in a drawer underneath.
 *
 * - The row sums its sessions' states in the session row's priority
 *   order (D5) on the same left rail and title weight a session row
 *   uses. It never takes `bg-selected`: the sidebar has exactly one
 *   "you are here" row, and that is a session or 新对话; expansion is
 *   said by FolderOpen alone.
 * - Collapsed, sessions that need the user (erroring / waiting for a
 *   reply, D6) and the selected session (D7) hang under the row as
 *   ordinary rows. Each is then mounted ONLY there — the collapsed
 *   drawer leaves it out — so `data-session-id` stays unique and the
 *   sidebar's reveal-active-row effect finds the visible copy.
 * - Open, the drawer lists the newest sessions and closes with a
 *   「显示更多」 row (2026-10-09): the rest are the same list's back
 *   half, so the control sits where the list ends and opening appends
 *   them in place; the row then moves to the very end as 「收起」.
 * - Every child row is single-line (2026-10-09): the indent and guide
 *   line say whose they are.
 * - Expanding never sets project context (D8); the row's `+` does.
 */
export function SidebarProjectGroup({
  project,
  sessions,
  olderSessions,
  defaultOlderOpen = false,
  expanded,
  onToggleExpanded,
  onStartConversation,
  onTogglePin,
  onEdit,
  onDelete,
  onArchiveAll,
  ...rowWiring
}: {
  project: Project;
  /** The newest sessions (PROJECT_GROUP_RECENT_COUNT), newest first. */
  sessions: Session[];
  /** The rest, newest first — behind the drawer's closing 「显示更多」. */
  olderSessions: Session[];
  /** Start with the tail open (uncontrolled, like Radix's
   * `defaultOpen`); 显示更多 / 收起 own it from there. */
  defaultOlderOpen?: boolean;
  expanded: boolean;
  onToggleExpanded?: () => void;
  onStartConversation?: () => void;
  onTogglePin?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** 归档全部对话 (D10), after its confirm. */
  onArchiveAll?: (sessionIds: string[]) => void;
} & SidebarTimelineRowWiring) {
  const copy = useCopy();
  const { activeId, sessionGoalStatus } = rowWiring;
  const allSessions = [...sessions, ...olderSessions];
  const attention = useSessionsAttention(
    allSessions,
    activeId,
    sessionGoalStatus,
  );
  const [olderOpen, setOlderOpen] = useState(defaultOlderOpen);
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);

  // Collapsed: needs-you sessions and the selected one, in list order.
  const hangingIds = new Set<string>();
  if (!expanded) {
    for (const s of allSessions) {
      if (attention.needsYouIds.has(s.id) || s.id === activeId) {
        hangingIds.add(s.id);
      }
    }
  }
  const hanging = allSessions.filter((s) => hangingIds.has(s.id));
  // Expanded with the tail shut: tail sessions that need the user and
  // the selected one borrow slots above 显示更多 — the tail is a fold
  // too, and nothing that needs you hides behind a fold (D6 / D7). The
  // row's count leaves them out: it says how many are still hidden.
  const borrowedOlder =
    expanded && !olderOpen
      ? olderSessions.filter(
          (s) => attention.needsYouIds.has(s.id) || s.id === activeId,
        )
      : [];
  const hiddenOlderCount = olderSessions.length - borrowedOlder.length;

  const total = allSessions.length;
  const archiveAll =
    onArchiveAll && total > 0 ? () => setConfirmArchiveOpen(true) : undefined;
  const notHanging = (s: Session) => !hangingIds.has(s.id);
  const renderRow = (s: Session) => (
    <SidebarTimelineRow key={s.id} session={s} singleLine {...rowWiring} />
  );

  return (
    <div data-project-id={project.id}>
      <ProjectGroupRow
        project={project}
        expanded={expanded}
        connector={(expanded && total > 0) || hanging.length > 0}
        attention={attention}
        total={total}
        onClick={onToggleExpanded}
        onStartConversation={onStartConversation}
        onTogglePin={onTogglePin}
        onEdit={onEdit}
        onArchiveAll={archiveAll}
        onDelete={onDelete}
      />
      <ProjectGroupDrawer expanded={expanded}>
        {total === 0 ? (
          <ProjectEmptyHint
            project={project}
            onStartConversation={onStartConversation}
          />
        ) : (
          <>
            {sessions.filter(notHanging).map(renderRow)}
            {olderOpen
              ? olderSessions.filter(notHanging).map(renderRow)
              : borrowedOlder.map(renderRow)}
            {/* One slot for both modes, so 收起 stays the same instance
                and its layout effect can hold it under the pointer. */}
            {olderSessions.length > 0 &&
              (olderOpen ? (
                <SidebarShowMoreRow
                  mode="less"
                  label={copy.sidebar.showLess}
                  onToggle={() => setOlderOpen(false)}
                />
              ) : hiddenOlderCount > 0 ? (
                <SidebarShowMoreRow
                  mode="more"
                  label={copy.sidebar.showMore}
                  ariaLabel={copy.sidebar.showMoreSessionsAria(
                    hiddenOlderCount,
                  )}
                  count={hiddenOlderCount}
                  onToggle={() => setOlderOpen(true)}
                />
              ) : null)}
          </>
        )}
      </ProjectGroupDrawer>
      {hanging.length > 0 && (
        <div className={cn(GROUP_CHILDREN_CLASS, "pb-1")}>
          {hanging.map(renderRow)}
        </div>
      )}
      {onArchiveAll && (
        <ConfirmActionDialog
          open={confirmArchiveOpen}
          onOpenChange={setConfirmArchiveOpen}
          title={copy.sidebar.archiveProjectSessionsTitle(project.name, total)}
          body={copy.sidebar.archiveProjectSessionsBody(attention.runningCount)}
          confirmLabel={copy.sidebar.archive}
          confirmVariant="warning"
          onConfirm={() => {
            setConfirmArchiveOpen(false);
            onArchiveAll(allSessions.map((s) => s.id));
          }}
        />
      )}
    </div>
  );
}

/** The drawer's indent and guide line — shared by the hanging rows so
 * a collapsed group's hung sessions read as its children (2026-10-09
 * geometry, picked on real hardware). The line sits on the folder
 * icon's center (25.5px: the 16px icon box spans 18–34px), and pl-6
 * puts a child's status icon on the project name's 42px edge (pl-6 +
 * the row's mx-1.5 + px-3). A pseudo-element, not a border, so the
 * line's position doesn't depend on the indent. */
const GROUP_CHILDREN_CLASS =
  "relative mr-1.5 pl-6 before:pointer-events-none before:absolute before:inset-y-0 before:left-[25.5px] before:w-px before:bg-brand/35";

function ProjectGroupRow({
  project,
  expanded,
  connector = false,
  attention,
  total,
  onClick,
  onStartConversation,
  onTogglePin,
  onEdit,
  onArchiveAll,
  onDelete,
}: {
  project: Project;
  expanded: boolean;
  /** Draw the guide line up into the row from under the folder icon,
   * so the children's line hangs from the project (open with
   * sessions, or collapsed with hung rows). */
  connector?: boolean;
  attention: SessionsAttentionView;
  total: number;
  onClick?: () => void;
  onStartConversation?: () => void;
  onTogglePin?: () => void;
  onEdit?: () => void;
  onArchiveAll?: () => void;
  onDelete?: () => void;
}) {
  const copy = useCopy();
  const hasRowActions = !!(onTogglePin || onEdit || onArchiveAll || onDelete);
  const [actionsOpen, setActionsOpen] = useState(false);
  const ProjectIcon = expanded ? FolderOpen : Folder;
  const newConversationTitle = copy.sidebar.newConversationInProjectTitle(
    project.name,
  );
  const { kind } = attention;

  // One-shot pop when the group ENTERS a blocking / unread state — the
  // session row's latch: the state a group mounted in is not news.
  const [prevKind, setPrevKind] = useState(kind);
  const [popEnabled, setPopEnabled] = useState(false);
  if (kind !== prevKind) {
    setPrevKind(kind);
    setPopEnabled(true);
  }
  const shouldPop = kind === "error" || kind === "ask" || kind === "unread";
  const showActions = !!(onStartConversation || hasRowActions);

  const row = (
    <div
      data-galley-context-menu-trigger={hasRowActions ? "" : undefined}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        // The session rows' grid: the folder in the 16px status column
        // (left edge 18px), the name on the 42px title edge.
        // One line, 36px, the total on the right text edge (2026-10-09,
        // picked on real hardware over 10-08's two-line summary row):
        // state rides the rail, the name's weight and the folder's pop,
        // with no summary words to read.
        "group relative mx-1.5 grid min-h-9 scroll-my-2 grid-cols-[16px_minmax(0,1fr)] items-center gap-2 overflow-hidden rounded-sm px-3 py-1 text-left outline-none",
        "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
        "active:translate-y-px",
        actionsOpen ? "bg-hover" : "hover:bg-hover",
      )}
    >
      {connector && (
        <span
          aria-hidden
          // 25.5px in sidebar space minus the row's mx-1.5; starts 2px
          // under the 14px folder glyph (the 20px icon box centers in
          // the 36px row at 8px, the glyph at 11–25px).
          className="pointer-events-none absolute bottom-0 left-[19.5px] top-[27px] w-px bg-brand/35"
        />
      )}
      {kind === "running" ? (
        <span
          aria-hidden
          className="sidebar-liveness-rail absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full bg-brand-strong/55"
        />
      ) : kind === "error" || kind === "ask" ? (
        <span
          aria-hidden
          className={cn(
            "absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full",
            kind === "error" ? "bg-error" : "bg-warning",
          )}
        />
      ) : null}
      <span
        key={`icon:${kind}`}
        className={cn(
          "flex h-5 w-4 items-center justify-center",
          shouldPop && popEnabled && "sidebar-state-pop",
        )}
      >
        <ProjectIcon
          size={14}
          weight="thin"
          className={expanded ? "text-brand-strong" : "text-ink-muted"}
        />
      </span>
      <div
        className={cn(
          "min-w-0",
          showActions && "group-hover:pr-16",
          actionsOpen && "pr-16",
        )}
      >
        <div className="flex min-h-5 min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px] text-ink-soft",
              kind === "idle" ? "font-medium" : "font-semibold",
            )}
          >
            {project.name}
          </span>
          {project.pinned && (
            <PushPin
              size={10}
              weight="fill"
              className="shrink-0 text-ink-muted"
              aria-label="pinned"
            />
          )}
          {/* The total, on the 18px right text edge like a section
              label's count; it yields its place to + / ⋯ on hover. An
              empty project shows none, as the 项目 header drops its 0. */}
          {total > 0 && (
            <span
              className={cn(
                "shrink-0 text-[11px] tabular-nums text-ink-muted",
                showActions && "group-hover:invisible",
                actionsOpen && "invisible",
              )}
            >
              {total}
            </span>
          )}
        </div>
      </div>
      {showActions && (
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
                  // light-button rules (layout-and-chrome.md §4.2
                  // Project 行).
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
            <DropdownMenu.Root open={actionsOpen} onOpenChange={setActionsOpen}>
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
                  <ProjectMenuItems
                    kind="dropdown"
                    project={project}
                    onStartConversation={onStartConversation}
                    onTogglePin={onTogglePin}
                    onEdit={onEdit}
                    onArchiveAll={onArchiveAll}
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
          <ProjectMenuItems
            kind="context"
            project={project}
            onStartConversation={onStartConversation}
            onTogglePin={onTogglePin}
            onEdit={onEdit}
            onArchiveAll={onArchiveAll}
            onDelete={onDelete}
          />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function ProjectMenuItems({
  kind,
  project,
  onStartConversation,
  onTogglePin,
  onEdit,
  onArchiveAll,
  onDelete,
}: {
  kind: SidebarRowMenuKind;
  project: Project;
  onStartConversation?: () => void;
  onTogglePin?: () => void;
  onEdit?: () => void;
  onArchiveAll?: () => void;
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
      {/* The row's + only shows on hover; the menu gives the project's
          new chat a second, non-hover way in, now that the sidebar's
          新对话 is always a plain chat (2026-10-09). */}
      {onStartConversation && (
        <SidebarRowMenuItem
          kind={kind}
          onSelect={onStartConversation}
          className={itemClass}
        >
          <Plus size={13} weight="thin" />
          {copy.sidebar.newProjectConversation}
        </SidebarRowMenuItem>
      )}
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
        <SidebarRowMenuItem kind={kind} onSelect={onEdit} className={itemClass}>
          {/* Pencil, not FolderOpen: on project rows FolderOpen already
              means "expanded" — the menu glyph must say "edit" (same
              icon as session rename). */}
          <Pencil size={13} weight="thin" />
          {copy.sidebar.editProject}
        </SidebarRowMenuItem>
      )}
      {onArchiveAll && (
        <SidebarRowMenuItem
          kind={kind}
          onSelect={onArchiveAll}
          className={itemClass}
        >
          <Archive size={13} weight="thin" />
          {copy.sidebar.archiveProjectSessions}
        </SidebarRowMenuItem>
      )}
      {onDelete && (
        <>
          <SidebarRowMenuSeparator kind={kind} className="my-1 h-px bg-line" />
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

function ProjectGroupDrawer({
  expanded,
  children,
}: {
  expanded: boolean;
  children: React.ReactNode;
}) {
  // Expanding a group near the bottom of the scroll container would
  // animate the drawer open below the fold — the click appeared to do
  // nothing. After the 240ms height animation settles, nudge the
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
      // A collapsed drawer keeps its rows mounted at zero height; the
      // Sidebar's reveal-active-row effect reads this to leave them be.
      data-collapsed-drawer={expanded ? undefined : ""}
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
            GROUP_CHILDREN_CLASS,
            "pb-2",
            "transition-[opacity,transform] duration-(--motion-base) ease-pop motion-reduce:transition-none",
            expanded
              ? "translate-y-0 opacity-100 delay-[40ms]"
              : "-translate-y-2 opacity-0",
            !expanded &&
              "pointer-events-none delay-0 duration-(--motion-fast) ease-in",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** The row that closes a truncated list (2026-10-09): 「显示更多」 + the
 * hidden count, or 「收起」 at the end of the opened list — a project
 * group's tail, and the 项目 section's quiet projects. The hidden part
 * is the same list's back half, so the control sits where the list
 * ends and opening appends the rest above it; hence a list row on the
 * status / title columns, not the section-label register: it continues
 * the list, it doesn't head one. Folding from the bottom keeps the row
 * under the pointer: the rows above it vanish, and WebKit has no CSS
 * scroll anchoring to rely on. The caller keeps both modes in one JSX
 * slot so 收起 → 显示更多 is the same instance. */
export function SidebarShowMoreRow({
  mode,
  label,
  ariaLabel,
  count,
  onToggle,
}: {
  mode: "more" | "less";
  label: string;
  /** What the count means (显示更多 says how many); 收起 needs none. */
  ariaLabel?: string;
  count?: number;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const anchorTopRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const top = anchorTopRef.current;
    anchorTopRef.current = null;
    const el = ref.current;
    if (top == null || !el) return;
    let scroller: HTMLElement | null = el.parentElement;
    while (
      scroller &&
      !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
    ) {
      scroller = scroller.parentElement;
    }
    if (scroller) scroller.scrollTop += el.getBoundingClientRect().top - top;
  }, [mode]);
  const Icon = mode === "more" ? CaretDown : CaretUp;
  return (
    <button
      ref={ref}
      type="button"
      tabIndex={-1}
      onMouseDown={preventMouseFocus}
      onClick={() => {
        if (mode === "less" && ref.current) {
          anchorTopRef.current = ref.current.getBoundingClientRect().top;
        }
        onToggle();
      }}
      aria-expanded={mode === "less"}
      aria-label={ariaLabel}
      className={cn(
        "mx-1.5 grid min-h-7 w-[calc(100%-12px)] grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-3 text-left text-[11px] text-ink-muted",
        "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm hover:bg-hover hover:text-ink-soft",
        "active:translate-y-px outline-none",
      )}
    >
      <span className="flex justify-center">
        <Icon size={10} weight="regular" className="opacity-60" />
      </span>
      <span className="min-w-0 truncate">{label}</span>
      {mode === "more" && count != null && (
        <span className="tabular-nums">{count}</span>
      )}
    </button>
  );
}

function ProjectEmptyHint({
  project,
  onStartConversation,
}: {
  project: Project;
  onStartConversation?: () => void;
}) {
  const copy = useCopy();
  const label = copy.sidebar.newProjectConversation;
  const newConversationTitle = copy.sidebar.newConversationInProjectTitle(
    project.name,
  );
  if (!onStartConversation) {
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
        onClick={onStartConversation}
        aria-label={newConversationTitle}
        className={cn(
          "mx-1.5 mt-2 flex w-[calc(100%-12px)] items-center gap-2 rounded-sm border border-line/70 bg-elevated/55 px-3 py-2 text-left",
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
