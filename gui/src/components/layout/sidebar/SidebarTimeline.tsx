import { CaretRight } from "@phosphor-icons/react";

import { useSessionsAttention } from "@/hooks/useSessionsAttention";
import { useCopy } from "@/lib/i18n";
import {
  SIDEBAR_TIME_BUCKETS,
  type SidebarProjectGroupItem,
  type SidebarSections,
  type SidebarTimeBucket,
} from "@/lib/sidebar-timeline";
import { cn } from "@/lib/utils";
import type { Session } from "@/types/session";

import { SidebarProjectGroup, SidebarShowMoreRow } from "./SidebarProjectGroup";
import {
  SidebarTimelineRow,
  type SidebarTimelineRowWiring,
} from "./SidebarTimelineRow";

/** Project-level wiring for the sidebar's project groups. */
export type SidebarProjectGroupWiring = {
  /** Project ids whose drawers are open (this run only, D9). */
  expandedProjectIds: Set<string>;
  onToggleProjectExpanded?: (id: string) => void;
  onStartProjectConversation?: (id: string) => void;
  onTogglePinProject?: (id: string) => void;
  onEditProject?: (id: string) => void;
  onDeleteProject?: (id: string) => void;
  onArchiveSessions?: (ids: string[]) => void;
};

/** A project group with the sidebar's wiring bound to its project. */
function WiredProjectGroup({
  item,
  groupWiring,
  ...rowWiring
}: {
  item: SidebarProjectGroupItem;
  groupWiring: SidebarProjectGroupWiring;
} & SidebarTimelineRowWiring) {
  const {
    expandedProjectIds,
    onToggleProjectExpanded,
    onStartProjectConversation,
    onTogglePinProject,
    onEditProject,
    onDeleteProject,
    onArchiveSessions,
  } = groupWiring;
  const id = item.project.id;
  return (
    <SidebarProjectGroup
      project={item.project}
      sessions={item.sessions}
      olderSessions={item.olderSessions}
      expanded={expandedProjectIds.has(id)}
      onToggleExpanded={
        onToggleProjectExpanded ? () => onToggleProjectExpanded(id) : undefined
      }
      onStartConversation={
        onStartProjectConversation
          ? () => onStartProjectConversation(id)
          : undefined
      }
      onTogglePin={
        onTogglePinProject ? () => onTogglePinProject(id) : undefined
      }
      onEdit={onEditProject ? () => onEditProject(id) : undefined}
      onDelete={onDeleteProject ? () => onDeleteProject(id) : undefined}
      onArchiveAll={onArchiveSessions}
      {...rowWiring}
    />
  );
}

/**
 * The 更早 entry. `earlier` collapses to a single entry row instead of
 * inline-listing every old session — the sidebar is the "current work"
 * surface, not an archive. Browsing the full list happens in
 * EarlierDialog.
 *
 * …except the session you're in. Opened from search / ⌘K /
 * EarlierDialog, an old session would otherwise have no row anywhere in
 * the sidebar — no "you are here". It borrows one slot directly under
 * the entry for as long as it's active; the entry's count still includes
 * it, because it still belongs to 更早 (activation doesn't bump
 * lastActivityAt). Switching away drops the row, no animation: it was
 * only ever a position marker. An old session a project group lists
 * (behind its 显示更多) is shown by that group instead. Keyed by id so
 * hopping between two old sessions remounts the row rather than carrying
 * one row's local state to the next.
 */
function SidebarEarlier({
  earlier,
  groupedSessionIds,
  onOpenEarlier,
  ...rowWiring
}: {
  earlier: Session[];
  groupedSessionIds: Set<string>;
  onOpenEarlier?: () => void;
} & SidebarTimelineRowWiring) {
  const { activeId } = rowWiring;
  if (earlier.length === 0) return null;
  const borrowed =
    activeId && !groupedSessionIds.has(activeId)
      ? earlier.find((s) => s.id === activeId)
      : undefined;
  return (
    <>
      <SidebarEarlierEntry count={earlier.length} onClick={onOpenEarlier} />
      {borrowed && (
        <SidebarTimelineRow
          key={borrowed.id}
          session={borrowed}
          {...rowWiring}
        />
      )}
    </>
  );
}

/**
 * The sidebar list (S1): 置顶, the 项目 section, then the time buckets
 * — holding only sessions outside projects (S4) — and the 更早 entry.
 */
export function SidebarSectionsList({
  sections,
  projectsCollapsed,
  onToggleProjectsCollapsed,
  othersOpen,
  onToggleOthers,
  onOpenEarlier,
  groupWiring,
  ...rowWiring
}: {
  sections: SidebarSections;
  projectsCollapsed: boolean;
  onToggleProjectsCollapsed: () => void;
  othersOpen: boolean;
  onToggleOthers: () => void;
  onOpenEarlier?: () => void;
  groupWiring: SidebarProjectGroupWiring;
} & SidebarTimelineRowWiring) {
  const copy = useCopy();
  const labels: Record<SidebarTimeBucket, string> = {
    today: copy.sidebar.bucketToday,
    week: copy.sidebar.bucketWeek,
    month: copy.sidebar.bucketMonth,
    recent: copy.sidebar.bucketRecent,
  };
  return (
    <>
      <SidebarSessionBucket
        label={copy.sidebar.bucketPinned}
        sessions={sections.pinned}
        {...rowWiring}
      />
      <SidebarProjectsSection
        groups={sections.projects}
        otherGroups={sections.otherProjects}
        collapsed={projectsCollapsed}
        onToggleCollapsed={onToggleProjectsCollapsed}
        othersOpen={othersOpen}
        onToggleOthers={onToggleOthers}
        groupWiring={groupWiring}
        {...rowWiring}
      />
      {SIDEBAR_TIME_BUCKETS.map((bucket) => (
        <SidebarSessionBucket
          key={bucket}
          label={labels[bucket]}
          sessions={sections.buckets[bucket]}
          {...rowWiring}
        />
      ))}
      <SidebarEarlier
        earlier={sections.earlier}
        groupedSessionIds={sections.groupedSessionIds}
        onOpenEarlier={onOpenEarlier}
        {...rowWiring}
      />
    </>
  );
}

function SidebarSessionBucket({
  label,
  sessions,
  ...rowWiring
}: {
  label: string;
  sessions: Session[];
} & SidebarTimelineRowWiring) {
  if (sessions.length === 0) return null;
  return (
    <>
      <SidebarSectionLabel count={sessions.length}>{label}</SidebarSectionLabel>
      {sessions.map((s) => (
        <SidebarTimelineRow key={s.id} session={s} {...rowWiring} />
      ))}
    </>
  );
}

/**
 * The 项目 section (S2 / S3 / S5): a time-bucket-style header whose count
 * is the listed projects and whose caret folds the section, then one
 * group per project. The quiet ones (`otherProjects`, outside the
 * 30-day window) continue the list behind a closing 「更多项目 N」 row
 * (2026-10-09), like a group's tail: opening appends their groups in
 * place and the row moves to the end as 「收起」. No section when there
 * is no project at all; no 新建项目 + on the header (S6).
 *
 * Folds hang what needs the user. Collapsed (persisted, see
 * useSidebarProjectsCollapsed), no group is mounted; project sessions
 * that need the user — erroring / waiting for a reply — and the selected
 * one hang directly under the header as plain two-line rows, the way a
 * time bucket lists its rows. 更多项目, shut, lends the slot to the whole
 * group row of a quiet project holding such a session, above the row and
 * out of its count: a project list borrows projects, and the session
 * then hangs indented under its own project, so you can tell whose it
 * is. Either way each session stays mounted once, so `data-session-id`
 * stays unique and the reveal-active-row effect finds it.
 */
function SidebarProjectsSection({
  groups,
  otherGroups,
  collapsed,
  onToggleCollapsed,
  othersOpen,
  onToggleOthers,
  groupWiring,
  ...rowWiring
}: {
  groups: SidebarProjectGroupItem[];
  otherGroups: SidebarProjectGroupItem[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  othersOpen: boolean;
  onToggleOthers: () => void;
  groupWiring: SidebarProjectGroupWiring;
} & SidebarTimelineRowWiring) {
  const copy = useCopy();
  const { activeId, sessionGoalStatus } = rowWiring;
  const sessionsOf = (items: SidebarProjectGroupItem[]) =>
    items.flatMap((g) => [...g.sessions, ...g.olderSessions]);
  const listedSessions = sessionsOf(groups);
  const otherSessions = sessionsOf(otherGroups);
  const attention = useSessionsAttention(
    [...listedSessions, ...otherSessions],
    activeId,
    sessionGoalStatus,
  );
  if (groups.length === 0 && otherGroups.length === 0) return null;
  const hangs = (sessions: Session[]) =>
    sessions.filter(
      (s) => attention.needsYouIds.has(s.id) || s.id === activeId,
    );
  const renderRows = (sessions: Session[]) =>
    sessions.map((s) => (
      <SidebarTimelineRow key={s.id} session={s} {...rowWiring} />
    ));
  const renderGroups = (items: SidebarProjectGroupItem[]) =>
    items.map((item) => (
      <WiredProjectGroup
        key={`project:${item.project.id}`}
        item={item}
        groupWiring={groupWiring}
        {...rowWiring}
      />
    ));
  const borrowedOthers = othersOpen
    ? []
    : otherGroups.filter((g) => hangs(sessionsOf([g])).length > 0);
  const hiddenOthers = otherGroups.length - borrowedOthers.length;
  return (
    <>
      <SidebarCollapsibleSectionLabel
        label={copy.sidebar.projects}
        count={groups.length}
        open={!collapsed}
        onToggle={onToggleCollapsed}
      />
      {collapsed ? (
        renderRows(hangs([...listedSessions, ...otherSessions]))
      ) : (
        <>
          {renderGroups(groups)}
          {renderGroups(othersOpen ? otherGroups : borrowedOthers)}
          {/* One slot for both modes, so 收起 stays the same instance
              and its layout effect can hold it under the pointer. */}
          {otherGroups.length > 0 &&
            (othersOpen ? (
              <SidebarShowMoreRow
                mode="less"
                label={copy.sidebar.showLess}
                onToggle={onToggleOthers}
              />
            ) : hiddenOthers > 0 ? (
              <SidebarShowMoreRow
                mode="more"
                label={copy.sidebar.moreProjects}
                ariaLabel={copy.sidebar.showMoreProjectsAria(hiddenOthers)}
                count={hiddenOthers}
                onToggle={onToggleOthers}
              />
            ) : null)}
        </>
      )}
    </>
  );
}

/** A section label that folds its section: the time-bucket label's
 * register and grid (label on the 18px edge, count on the right text
 * edge, in line with 本周 / 本月's), the 更早 entry's quiet hover, and a
 * caret hung in the button's right padding past the count that turns
 * down while the section is open. */
function SidebarCollapsibleSectionLabel({
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
  // pt-2 + py-1.5 = the plain label's pt-3.5 / pb-1.5, with the hover
  // fill hugging the text the way the 更早 entry's does.
  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "mx-1.5 flex w-[calc(100%-12px)] items-center gap-1.5 rounded-sm px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted",
          "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm hover:bg-hover hover:text-ink-soft",
          "active:translate-y-px",
          "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {/* -mr-[11px] hangs the caret (9px + gap-0.5) in the px-3
            padding, so the count ends on the plain label's edge. */}
        <span className="-mr-[11px] flex items-center gap-0.5 tabular-nums normal-case tracking-normal text-ink-muted">
          {/* 0 when only 更多项目 are left: the row below carries the number. */}
          {count > 0 && count}
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
    </div>
  );
}

export function SidebarSectionLabel({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  // mx-1.5 + px-3 puts the label on the session rows' grid (2026-10-08):
  // it starts on the 18px status-icon edge and the count ends on the
  // 18px text edge, under the new-chat row's ⌘N. It was px-4 (16px).
  return (
    <div className="mx-1.5 flex items-center gap-1.5 px-3 pb-1.5 pt-3.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count != null && (
        <span className="shrink-0 tabular-nums normal-case tracking-normal text-ink-muted">
          {count}
        </span>
      )}
    </div>
  );
}


function SidebarEarlierEntry({
  count,
  onClick,
}: {
  count: number;
  onClick?: () => void;
}) {
  const copy = useCopy();
  // `更早` is the last time bucket but its contents live in a dialog
  // (the sidebar is current-work, not infinite history). So instead of
  // a foreign button row, it stays in the SAME section-label family as
  // 今天/本周/本月 — identical 10px uppercase register + left inset —
  // and just carries its overflow affordance inline: the count on the
  // buckets' count edge with a caret hung in the right padding past it,
  // the whole label clickable with a quiet hover. The buckets read as
  // one family; this one happens to be actionable.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copy.sidebar.showAll}
      className={cn(
        "mx-1.5 mt-2 flex w-[calc(100%-12px)] items-center gap-1.5 rounded-sm px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted",
        "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm hover:bg-hover hover:text-ink-soft",
        "active:translate-y-px",
        "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
      )}
    >
      <span className="min-w-0 flex-1 truncate">
        {copy.sidebar.bucketEarlier}
      </span>
      <span className="-mr-[11px] flex items-center gap-0.5 tabular-nums normal-case tracking-normal text-ink-muted">
        {count}
        <CaretRight size={9} weight="thin" className="opacity-70" />
      </span>
    </button>
  );
}
