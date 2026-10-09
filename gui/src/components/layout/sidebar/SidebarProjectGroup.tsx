import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  CaretRight,
  DotsThree,
  Folder,
  FolderOpen,
  Pencil,
  Plus,
  PushPin,
  PushPinSlash,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

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
 * - Expanding never sets project context (D8); the row's `+` does.
 */
export function SidebarProjectGroup({
  project,
  sessions,
  olderSessions,
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
  /** The rest, newest first — the drawer's 「更早 N 个」 tail. */
  olderSessions: Session[];
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
  const [olderOpen, setOlderOpen] = useState(false);
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
  // the selected one borrow slots above the tail row — the tail is a
  // fold too, and nothing that needs you hides behind a fold (D6 / D7).
  const borrowedOlder =
    expanded && !olderOpen
      ? olderSessions.filter(
          (s) => attention.needsYouIds.has(s.id) || s.id === activeId,
        )
      : [];

  const total = allSessions.length;
  const archiveAll =
    onArchiveAll && total > 0 ? () => setConfirmArchiveOpen(true) : undefined;

  return (
    <div data-project-id={project.id}>
      <ProjectGroupRow
        project={project}
        expanded={expanded}
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
            {sessions
              .filter((s) => !hangingIds.has(s.id))
              .map((s) => (
                <SidebarTimelineRow key={s.id} session={s} {...rowWiring} />
              ))}
            {borrowedOlder.map((s) => (
              <SidebarTimelineRow key={s.id} session={s} {...rowWiring} />
            ))}
            {olderSessions.length > 0 && (
              <SidebarTailToggle
                label={copy.sidebar.bucketEarlier}
                ariaLabel={copy.sidebar.groupOlder(olderSessions.length)}
                count={olderSessions.length}
                open={olderOpen}
                onToggle={() => setOlderOpen((open) => !open)}
              />
            )}
            {olderOpen &&
              olderSessions
                .filter((s) => !hangingIds.has(s.id))
                .map((s) => (
                  <SidebarTimelineRow key={s.id} session={s} {...rowWiring} />
                ))}
          </>
        )}
      </ProjectGroupDrawer>
      {hanging.length > 0 && (
        <div className={cn(GROUP_CHILDREN_CLASS, "pb-1")}>
          {hanging.map((s) => (
            <SidebarTimelineRow key={s.id} session={s} {...rowWiring} />
          ))}
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
 * a collapsed group's hung sessions read as its children. */
const GROUP_CHILDREN_CLASS = "ml-6 mr-1.5 border-l border-brand/35 pl-1";

function ProjectGroupRow({
  project,
  expanded,
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
  const { kind, count } = attention;

  // One-shot pop when the group ENTERS a blocking / unread state — the
  // session row's latch: the state a group mounted in is not news.
  const [prevKind, setPrevKind] = useState(kind);
  const [popEnabled, setPopEnabled] = useState(false);
  if (kind !== prevKind) {
    setPrevKind(kind);
    setPopEnabled(true);
  }
  const shouldPop = kind === "error" || kind === "ask" || kind === "unread";

  const summary =
    kind === "error"
      ? copy.sidebar.groupErrored(count, total)
      : kind === "ask"
        ? copy.sidebar.groupWaiting(count, total)
        : kind === "running"
          ? copy.sidebar.groupWorking(count, total)
          : kind === "unread"
            ? copy.sidebar.groupUnread(count, total)
            : copy.sidebar.groupTotal(total);
  const summaryTone =
    kind === "error"
      ? "font-medium text-error"
      : kind === "ask"
        ? "font-medium text-warning"
        : kind === "running"
          ? "text-brand-strong/85"
          : "text-ink-muted";
  const showActions = !!(onStartConversation || hasRowActions);

  const row = (
    <div
      data-galley-context-menu-trigger={hasRowActions ? "" : undefined}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        // The session rows' grid: the folder in the 16px status column
        // (left edge 18px), the name on the 42px title edge.
        // Two lines and 48px like a session row, the second line the
        // summary (JC picked it on real hardware over a one-line icon +
        // name + count row, 2026-10-08).
        "group relative mx-1.5 grid min-h-[48px] scroll-my-2 grid-cols-[16px_minmax(0,1fr)] items-start gap-2 overflow-hidden rounded-sm px-3 py-1.5 text-left outline-none",
        "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
        "active:translate-y-px",
        actionsOpen ? "bg-hover" : "hover:bg-hover",
      )}
    >
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
        </div>
        <div
          className={cn(
            "mt-0.5 truncate text-[11px] leading-[1.4] tabular-nums",
            summaryTone,
          )}
        >
          {summary}
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
  onTogglePin,
  onEdit,
  onArchiveAll,
  onDelete,
}: {
  kind: SidebarRowMenuKind;
  project: Project;
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

/** A fold that closes a list and expands in place, in the 更早 entry's
 * register (10px label + count, with the caret hung in the right
 * padding so the count keeps the section labels' edge): a drawer's
 * 「更早 N 个」 tail (D4), and the 项目 section's 「其他项目」 row. */
export function SidebarTailToggle({
  label,
  ariaLabel,
  count,
  open,
  onToggle,
}: {
  label: string;
  ariaLabel: string;
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
      aria-label={ariaLabel}
      className={cn(
        "mx-1.5 mt-1 flex w-[calc(100%-12px)] items-center gap-1.5 rounded-sm px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted",
        "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm hover:bg-hover hover:text-ink-soft",
        "active:translate-y-px",
        "outline-none",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="-mr-[11px] flex items-center gap-0.5 tabular-nums normal-case tracking-normal">
        {count}
        <CaretRight
          size={9}
          weight="thin"
          className={cn(
            "opacity-70 transition-transform duration-(--motion-fast)",
            open && "rotate-90",
          )}
        />
      </span>
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
