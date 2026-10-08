import { CaretRight } from "@phosphor-icons/react";
import { Fragment } from "react";

import { useCopy } from "@/lib/i18n";
import { groupSessions, SIDEBAR_BUCKET_ORDER } from "@/lib/sessions";
import { cn } from "@/lib/utils";
import type { GoalBrief } from "@/types/goal";
import type { Project, Session, SessionBucket } from "@/types/session";

import { SidebarSessionRow } from "./SidebarSessionRow";
import type { ProjectScopePhase } from "./types";

/** Everything a timeline row needs besides its session — shared by the
 * bucket lists and the borrowed `earlier` row so the two can't drift. */
type SidebarTimelineRowWiring = {
  activeId?: string;
  projects: Project[];
  petAttachedSessionId?: string | null;
  /** Map of session-id -> that session's open goal, so a row carrying
   * a goal shows its state instead of reading as a finished chat. */
  sessionGoalStatus?: Map<string, GoalBrief>;
  onSelectSession?: (id: string) => void;
  onArchiveSession?: (id: string) => void;
  onTogglePinSession?: (id: string) => void;
  onAssignSessionToProject?: (
    sessionId: string,
    projectId: string | null,
  ) => void;
  /** Session currently in inline-edit mode (one at a time across the
   * whole sidebar). Tracked by the parent `Sidebar`. */
  editingSessionId?: string | null;
  /** Right-click "重命名" → flip this session into edit mode.
   * Undefined when host doesn't wire renameSession. */
  onRequestRename?: (id: string) => void;
  /** Inline input commits (Enter / blur). */
  onConfirmRename: (id: string, newTitle: string) => void;
  /** Inline input cancels (Esc). */
  onCancelRename: () => void;
};

export function SidebarTimelineBuckets({
  buckets,
  collapseEarlier = true,
  onOpenEarlier,
  ...rowWiring
}: {
  buckets: ReturnType<typeof groupSessions>;
  collapseEarlier?: boolean;
  onOpenEarlier?: () => void;
} & SidebarTimelineRowWiring) {
  const { activeId } = rowWiring;
  return (
    <>
      {SIDEBAR_BUCKET_ORDER.map((bucket) => {
        if (buckets[bucket].length === 0) return null;
        // `earlier` collapses to a single entry row instead of
        // inline-listing every old session — the sidebar is the
        // "current work" surface, not an archive. Browsing the
        // full list happens in EarlierDialog.
        if (bucket === "earlier" && collapseEarlier) {
          // …except the session you're in. Opened from search / ⌘K /
          // EarlierDialog, an old session would otherwise have no row
          // anywhere in the sidebar — no "you are here". It borrows one
          // slot directly under the entry for as long as it's active;
          // the entry's count still includes it, because it still
          // belongs to 更早 (activation doesn't bump lastActivityAt).
          // Switching away drops the row, no animation: it was only
          // ever a position marker. Only `earlier` matters here —
          // backfill-promoted `recent` rows are already inlined. Keyed
          // by id so hopping between two old sessions remounts the row
          // rather than carrying one row's local state to the next.
          const borrowed = activeId
            ? buckets.earlier.find((s) => s.id === activeId)
            : undefined;
          return (
            <Fragment key={bucket}>
              <SidebarEarlierEntry
                count={buckets[bucket].length}
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
          );
        }
        return (
          <SidebarBucket
            key={bucket}
            bucket={bucket}
            sessions={buckets[bucket]}
            {...rowWiring}
          />
        );
      })}
    </>
  );
}


function SidebarBucket({
  bucket,
  sessions,
  ...rowWiring
}: {
  bucket: SessionBucket;
  sessions: Session[];
} & SidebarTimelineRowWiring) {
  const copy = useCopy();
  const bucketLabel: Record<SessionBucket, string> = {
    pinned: copy.sidebar.bucketPinned,
    today: copy.sidebar.bucketToday,
    week: copy.sidebar.bucketWeek,
    month: copy.sidebar.bucketMonth,
    recent: copy.sidebar.bucketRecent,
    earlier: copy.sidebar.bucketEarlier,
  };
  return (
    <>
      <SidebarSectionLabel count={sessions.length}>
        {bucketLabel[bucket]}
      </SidebarSectionLabel>
      {sessions.map((s) => (
        <SidebarTimelineRow key={s.id} session={s} {...rowWiring} />
      ))}
    </>
  );
}

function SidebarTimelineRow({
  session: s,
  activeId,
  projects,
  petAttachedSessionId,
  sessionGoalStatus,
  onSelectSession,
  onArchiveSession,
  onTogglePinSession,
  onAssignSessionToProject,
  editingSessionId,
  onRequestRename,
  onConfirmRename,
  onCancelRename,
}: { session: Session } & SidebarTimelineRowWiring) {
  return (
    <SidebarSessionRow
      session={s}
      active={s.id === activeId}
      petAttached={s.id === petAttachedSessionId}
      sessionGoal={sessionGoalStatus?.get(s.id)}
      projects={projects}
      onClick={() => onSelectSession?.(s.id)}
      onArchive={onArchiveSession ? () => onArchiveSession(s.id) : undefined}
      onTogglePin={
        onTogglePinSession ? () => onTogglePinSession(s.id) : undefined
      }
      onAssignToProject={
        onAssignSessionToProject
          ? (projectId) => onAssignSessionToProject(s.id, projectId)
          : undefined
      }
      isEditing={editingSessionId === s.id}
      onRequestRename={
        onRequestRename ? () => onRequestRename(s.id) : undefined
      }
      onConfirmRename={(newTitle) => onConfirmRename(s.id, newTitle)}
      onCancelRename={onCancelRename}
    />
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

export function SidebarTimelinePresence({
  phase,
  children,
}: {
  phase: ProjectScopePhase;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "transition-[opacity,transform] duration-(--motion-slow) ease-pop motion-reduce:transition-none",
        phase === "entered" && "translate-y-0 opacity-100",
        phase === "entering" && "translate-y-3 opacity-0",
        phase === "exiting" &&
          "translate-y-4 opacity-0 duration-(--motion-base) ease-in",
        phase !== "entered" && "pointer-events-none",
      )}
    >
      {children}
    </div>
  );
}
