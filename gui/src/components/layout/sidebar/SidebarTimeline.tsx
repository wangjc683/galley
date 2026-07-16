import { CaretRight } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";
import { groupSessions, SIDEBAR_BUCKET_ORDER } from "@/lib/sessions";
import { cn } from "@/lib/utils";
import type { GoalBrief } from "@/types/goal";
import type { Project, Session, SessionBucket } from "@/types/session";

import { SidebarSessionRow } from "./SidebarSessionRow";
import type { ProjectScopePhase } from "./types";

export function SidebarTimelineBuckets({
  buckets,
  activeId,
  projects,
  petAttachedSessionId,
  goalMasterStatus,
  collapseEarlier = true,
  onSelectSession,
  onArchiveSession,
  onTogglePinSession,
  onAssignSessionToProject,
  editingSessionId,
  onOpenEarlier,
  onRequestRename,
  onConfirmRename,
  onCancelRename,
}: {
  buckets: ReturnType<typeof groupSessions>;
  activeId?: string;
  projects: Project[];
  petAttachedSessionId?: string | null;
  /** Map of master-session-id -> running/wrapping goal, so a master
   * session row shows a goal-running state instead of reading as idle. */
  goalMasterStatus?: Map<string, GoalBrief>;
  collapseEarlier?: boolean;
  onSelectSession?: (id: string) => void;
  onArchiveSession?: (id: string) => void;
  onTogglePinSession?: (id: string) => void;
  onAssignSessionToProject?: (
    sessionId: string,
    projectId: string | null,
  ) => void;
  editingSessionId?: string | null;
  onOpenEarlier?: () => void;
  onRequestRename?: (id: string) => void;
  onConfirmRename: (id: string, newTitle: string) => void;
  onCancelRename: () => void;
}) {
  return (
    <>
      {SIDEBAR_BUCKET_ORDER.map((bucket) => {
        if (buckets[bucket].length === 0) return null;
        // `earlier` collapses to a single entry row instead of
        // inline-listing every old session — the sidebar is the
        // "current work" surface, not an archive. Browsing the
        // full list happens in EarlierDialog.
        if (bucket === "earlier" && collapseEarlier) {
          return (
            <SidebarEarlierEntry
              key={bucket}
              count={buckets[bucket].length}
              onClick={onOpenEarlier}
            />
          );
        }
        return (
          <SidebarBucket
            key={bucket}
            bucket={bucket}
            sessions={buckets[bucket]}
            activeId={activeId}
            projects={projects}
            petAttachedSessionId={petAttachedSessionId}
            goalMasterStatus={goalMasterStatus}
            onSelectSession={onSelectSession}
            onArchiveSession={onArchiveSession}
            onTogglePinSession={onTogglePinSession}
            onAssignSessionToProject={onAssignSessionToProject}
            editingSessionId={editingSessionId}
            onRequestRename={onRequestRename}
            onConfirmRename={onConfirmRename}
            onCancelRename={onCancelRename}
          />
        );
      })}
    </>
  );
}


function SidebarBucket({
  bucket,
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
  onRequestRename,
  onConfirmRename,
  onCancelRename,
}: {
  bucket: SessionBucket;
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
}) {
  const copy = useCopy();
  const bucketLabel: Record<SessionBucket, string> = {
    pinned: copy.sidebar.bucketPinned,
    today: copy.sidebar.bucketToday,
    week: copy.sidebar.bucketWeek,
    earlier: copy.sidebar.bucketEarlier,
  };
  return (
    <>
      <SidebarSectionLabel count={sessions.length}>
        {bucketLabel[bucket]}
      </SidebarSectionLabel>
      {sessions.map((s) => (
        <SidebarSessionRow
          key={s.id}
          session={s}
          active={s.id === activeId}
          petAttached={s.id === petAttachedSessionId}
          goalMaster={goalMasterStatus?.get(s.id)}
          projects={projects}
          onClick={() => onSelectSession?.(s.id)}
          onArchive={
            onArchiveSession ? () => onArchiveSession(s.id) : undefined
          }
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
      ))}
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
  return (
    <div className="flex items-center gap-1.5 px-4 pb-1.5 pt-3.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
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
  // `更早` is the third time bucket but its contents live in a dialog
  // (the sidebar is current-work, not infinite history). So instead of
  // a foreign button row, it stays in the SAME section-label family as
  // 今天/本周 — identical 10px uppercase register + left inset — and
  // just carries its overflow affordance inline: a right-aligned count
  // + caret, the whole label clickable with a quiet hover. The three
  // buckets read as one family; this one happens to be actionable.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={copy.sidebar.showAll}
      className={cn(
        "mx-1.5 mt-2 flex w-[calc(100%-12px)] items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted",
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
