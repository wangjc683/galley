import { CaretRight } from "@phosphor-icons/react";
import { Fragment } from "react";

import { useCopy } from "@/lib/i18n";
import {
  SIDEBAR_INLINE_BUCKETS,
  type SidebarInlineBucket,
  type SidebarTimeline,
  type SidebarTimelineItem,
} from "@/lib/sidebar-timeline";
import { cn } from "@/lib/utils";

import { SidebarProjectGroup } from "./SidebarProjectGroup";
import {
  SidebarTimelineRow,
  type SidebarTimelineRowWiring,
} from "./SidebarTimelineRow";

/** Project-level wiring for the timeline's project groups. */
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

export function SidebarTimelineBuckets({
  timeline,
  onOpenEarlier,
  groupWiring,
  ...rowWiring
}: {
  timeline: SidebarTimeline;
  onOpenEarlier?: () => void;
  groupWiring: SidebarProjectGroupWiring;
} & SidebarTimelineRowWiring) {
  const { activeId } = rowWiring;
  // `earlier` collapses to a single entry row instead of inline-listing
  // every old session — the sidebar is the "current work" surface, not
  // an archive. Browsing the full list happens in EarlierDialog.
  //
  // …except the session you're in. Opened from search / ⌘K /
  // EarlierDialog, an old session would otherwise have no row anywhere
  // in the sidebar — no "you are here". It borrows one slot directly
  // under the entry for as long as it's active; the entry's count still
  // includes it, because it still belongs to 更早 (activation doesn't
  // bump lastActivityAt). Switching away drops the row, no animation: it
  // was only ever a position marker. An old session a project group
  // lists (its 更早 tail) is shown by that group instead. Keyed by id so
  // hopping between two old sessions remounts the row rather than
  // carrying one row's local state to the next.
  const borrowed =
    activeId && !timeline.groupedSessionIds.has(activeId)
      ? timeline.earlier.find((s) => s.id === activeId)
      : undefined;
  return (
    <>
      {SIDEBAR_INLINE_BUCKETS.map((bucket) =>
        timeline.items[bucket].length === 0 ? null : (
          <SidebarBucket
            key={bucket}
            bucket={bucket}
            items={timeline.items[bucket]}
            groupWiring={groupWiring}
            {...rowWiring}
          />
        ),
      )}
      {timeline.earlier.length > 0 && (
        <Fragment key="earlier">
          <SidebarEarlierEntry
            count={timeline.earlier.length}
            onClick={onOpenEarlier}
          />
          {borrowed && (
            <SidebarTimelineRow
              key={borrowed.id}
              session={borrowed}
              {...rowWiring}
            />
          )}
        </Fragment>
      )}
    </>
  );
}

function SidebarBucket({
  bucket,
  items,
  groupWiring,
  ...rowWiring
}: {
  bucket: SidebarInlineBucket;
  items: SidebarTimelineItem[];
  groupWiring: SidebarProjectGroupWiring;
} & SidebarTimelineRowWiring) {
  const copy = useCopy();
  const bucketLabel: Record<SidebarInlineBucket, string> = {
    pinned: copy.sidebar.bucketPinned,
    today: copy.sidebar.bucketToday,
    week: copy.sidebar.bucketWeek,
    month: copy.sidebar.bucketMonth,
    recent: copy.sidebar.bucketRecent,
  };
  const {
    expandedProjectIds,
    onToggleProjectExpanded,
    onStartProjectConversation,
    onTogglePinProject,
    onEditProject,
    onDeleteProject,
    onArchiveSessions,
  } = groupWiring;
  // The count is the rows under the label — a project group is one.
  return (
    <>
      <SidebarSectionLabel count={items.length}>
        {bucketLabel[bucket]}
      </SidebarSectionLabel>
      {items.map((item) => {
        if (item.kind === "session") {
          return (
            <SidebarTimelineRow
              key={item.session.id}
              session={item.session}
              {...rowWiring}
            />
          );
        }
        const id = item.project.id;
        return (
          <SidebarProjectGroup
            key={`project:${id}`}
            project={item.project}
            sessions={item.sessions}
            olderSessions={item.olderSessions}
            expanded={expandedProjectIds.has(id)}
            onToggleExpanded={
              onToggleProjectExpanded
                ? () => onToggleProjectExpanded(id)
                : undefined
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
      })}
    </>
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
  // and just carries its overflow affordance inline: a right-aligned
  // count + caret, the whole label clickable with a quiet hover. The
  // buckets read as one family; this one happens to be actionable.
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
      <span className="flex items-center gap-0.5 tabular-nums normal-case tracking-normal text-ink-muted">
        {count}
        <CaretRight size={9} weight="thin" className="opacity-70" />
      </span>
    </button>
  );
}
