import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  memo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Cat,
  Clock,
  DotsThree,
  PauseCircle,
  PlugsConnected,
} from "@phosphor-icons/react";

import { IconButton } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/tooltip";
import { useSessionStatusView } from "@/hooks/useSessionStatusView";
import { goalStageLabel } from "@/lib/goals";
import { useCopy } from "@/lib/i18n";
import { SCHEDULER_SUPERVISOR } from "@/lib/scheduled-tasks";
import { cleanSessionSummary } from "@/lib/session-summary";
import { StatusIcon } from "@/lib/status-icon";
import { cn } from "@/lib/utils";
import type { GoalBrief } from "@/types/goal";
import type { Project, Session } from "@/types/session";

import { SessionTitleEditor } from "../SessionTitleEditor";
import { ArchiveRunningConfirmDialog } from "./ArchiveRunningConfirmDialog";
import { SidebarRowMenuContent, SidebarRowMenuPortal } from "./SidebarRowMenu";
import { SidebarSessionMenuItems } from "./SidebarSessionMenuItems";

export const SidebarSessionRow = memo(function SidebarSessionRow({
  session,
  active,
  petAttached = false,
  goalMaster,
  projects,
  onClick,
  onArchive,
  onTogglePin,
  onAssignToProject,
  isEditing = false,
  onRequestRename,
  onConfirmRename,
  onCancelRename,
}: {
  session: Session;
  active?: boolean;
  /** True when Desktop Pet is bound to this session. Renders a small
   * Cat icon next to the title — status only, not clickable (the
   * row itself is the click target for switching sessions). */
  petAttached?: boolean;
  /** Running/wrapping goal this session is the master of, if any. The
   * master session itself stays idle while workers run, so without this
   * its row would read as idle on a busy board. When present (and the
   * session isn't in its own running/blocking state) the row shows a
   * goal-running state: brand breathing rail + spinner + a goal subline. */
  goalMaster?: GoalBrief;
  /** Full project list — used to populate the "Move to project"
   * submenu. Caller passes navigation-sorted projects so the menu
   * matches the Projects section order. */
  projects: Project[];
  onClick?: () => void;
  /** Provided when the host wires archiving; the right-click menu
   * is suppressed otherwise (no actions = no menu to show). */
  onArchive?: () => void;
  /** Provided when the host wires pinning; menu label flips between
   * Pin / Unpin based on session.pinned. */
  onTogglePin?: () => void;
  /** Assign / remove from project. `null` = unassign. */
  onAssignToProject?: (projectId: string | null) => void;
  /** When true, replace the title span with an inline input. */
  isEditing?: boolean;
  /** Right-click "重命名" handler — flips the row into edit mode.
   * Undefined = no menu item. */
  onRequestRename?: () => void;
  /** Inline input commits (Enter / blur). */
  onConfirmRename?: (newTitle: string) => void;
  /** Inline input cancels (Esc). */
  onCancelRename?: () => void;
}) {
  const copy = useCopy();
  const hasRowActions = !!(
    onArchive ||
    onTogglePin ||
    onAssignToProject ||
    onRequestRename
  );
  const showActionTrigger = hasRowActions && !isEditing;
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const ignoreNextRowClickRef = useRef(false);
  // Row state model (current spec: layout-and-chrome.md §4.2 Session
  // Row) — three independent signals, same priority order in each:
  // status rail (left 3px channel) → status icon → subline text.
  // Priority: error > ask_user > approval > running/goal-running >
  // unread > idle. Unread folds into the left icon (filled brand
  // circle); there is no right-side dot.
  //
  // Active row is always treated as read (the user is looking at
  // it); even if the final turn_end fires there, bumpSessionAfterTurn
  // skips the unread mark for sessionId === activeSessionId.
  // Effective status is derived at read time from live conversation +
  // bridge state (replaces the old fireSessionMirror push onto the row).
  const { status, pendingApprovalCount, hasPendingAskUser } =
    useSessionStatusView(session);
  const hasPendingAsk = hasPendingAskUser;
  const isRunning = status === "running";
  const hasPendingApproval =
    status === "waiting_approval" || pendingApprovalCount > 0;
  const hasBlockingError = status === "error";
  // Master session of a running/wrapping goal: the work happens in
  // worker sessions, so this session's own status is idle. Surface the
  // goal-running state on its row so the board doesn't read it as idle.
  // Yields to the session's own running / blocking states if any.
  const goalRunning =
    !!goalMaster &&
    !isRunning &&
    !hasPendingAsk &&
    !hasPendingApproval &&
    !hasBlockingError;
  const showRunningActivity =
    isRunning && !hasPendingAsk && !hasPendingApproval && !hasBlockingError;
  // Unread renders as the left icon's filled-brand form, and only for
  // fully settled rows — every live/blocking state outranks it.
  const showUnread =
    !!session.hasUnread &&
    !active &&
    !hasPendingAsk &&
    !hasPendingApproval &&
    !hasBlockingError &&
    !isRunning &&
    !goalRunning;
  // Scheduler-created sessions carry via=supervisor on the wire but
  // must not read as "Supervisor 创建" — the user configured a
  // scheduled task, not a supervisor; explain provenance in their own
  // vocabulary (clock, 定时任务创建).
  const schedulerCreated =
    session.origin?.supervisor === SCHEDULER_SUPERVISOR;
  const supervisorCreated =
    session.origin?.via === "supervisor" && !schedulerCreated;
  // Left status-rail kind — one continuous-state channel scanned down
  // the left edge. running breathes (in progress); waiting / error are
  // static color (needs you / stuck). completed / idle = no rail.
  const railKind: "running" | "waiting" | "error" | null = hasBlockingError
    ? "error"
    : hasPendingAsk || hasPendingApproval
      ? "waiting"
      : showRunningActivity || goalRunning
        ? "running"
        : null;
  // Subline composition:
  //
  //   running + last completed step known → "第 N 步 · {summary}"
  //     N is the most-recently-finished step (session.lastStepIndex),
  //     written by bumpSessionAfterTurn on each turn_end. The
  //     summary is GA's per-step recap for THAT same step — so
  //     the number and the text describe the same event, no
  //     semantic mismatch. The sidebar deliberately lags one
  //     step behind real-time: users wanting truly-current
  //     state click into the conversation where TurnMarker and
  //     the thinking placeholder show live progress.
  //
  //   running + no step finished yet → "思考中…"
  //     The first step's LLM call has just begun — no turn_end
  //     has fired so we have no completed-step recap. Same
  //     language as MainView's in-progress placeholder for a
  //     unified register.
  //
  //   settled → "已完成 · {summary}"（cancelled → "已中止 · {summary}"）
  //     Same {summary} as the running row's final tick — the
  //     transition from running→settled keeps the recap text
  //     stable and only swaps the prefix. (Note: locally-settled
  //     sessions have status "idle"; the "completed" enum value is
  //     only ever written by the CLI/supervisor surface.)
  //
  // cleanSessionSummary repairs legacy "第 N 步 · " prefixes and
  // GA fallback-recap junk (residual tags / markdown) at render so
  // old rows display correctly without a DB migration.
  const cleanSummary = session.summary
    ? cleanSessionSummary(session.summary)
    : null;
  const approvalCount = pendingApprovalCount;
  const errorCount = session.errorCount || 0;
  // Goal-master running subline, e.g. "运行中 · 2 个 Agent" — reuses the
  // TopBar stage + worker-count copy so the row reads the same language
  // as the goal pill. Null unless this session masters a goal. Solo is a
  // single agent, so the hive-only "N agents" count is dropped for it.
  const goalSubline = goalMaster
    ? goalMaster.mode === "solo"
      ? goalStageLabel(goalMaster.status, copy.topbar)
      : `${goalStageLabel(goalMaster.status, copy.topbar)} · ${copy.topbar.goalWorkerCount(goalMaster.workerLimit)}`
    : null;
  // Subline doubles as the status line — always state-colored, upright
  // (no italic), text-explicit for the blocking states so a glance
  // reads "等你回复 / 等待审批 / 出错" without decoding an icon.
  const sublineText = hasBlockingError
    ? errorCount > 1
      ? `${copy.sidebar.errored} · ${errorCount}`
      : copy.sidebar.errored
    : hasPendingAsk
      ? copy.sidebar.waitingForYou
      : hasPendingApproval
        ? approvalCount > 1
          ? `${copy.sidebar.waitingApproval} · ${approvalCount}`
          : copy.sidebar.waitingApproval
        : showRunningActivity
          ? session.lastStepIndex != null && cleanSummary
            ? copy.sidebar.stepSummary(session.lastStepIndex, cleanSummary)
            : copy.sidebar.thinking
          : goalRunning
            ? goalSubline
            : cleanSummary
              ? // A user-aborted session must not claim completion —
                // its icon is already Prohibit; the words must match.
                status === "cancelled"
                ? copy.sidebar.cancelledSummary(cleanSummary)
                : copy.sidebar.completedSummary(cleanSummary)
              : null;
  const sublineTone: "running" | "warning" | "error" | "muted" =
    hasBlockingError
      ? "error"
      : hasPendingAsk || hasPendingApproval
        ? "warning"
        : showRunningActivity || goalRunning
          ? "running"
          : "muted";
  // One-shot pop on entering an attention / unread state. Keyed on the
  // icon span below so it replays on entry, never while staying put.
  const attentionKey = hasBlockingError
    ? "error"
    : hasPendingAsk
      ? "ask"
      : hasPendingApproval
        ? "approval"
        : showUnread
          ? "unread"
          : isRunning || goalRunning
            ? "running"
            : "idle";
  const shouldPopIcon =
    hasBlockingError || hasPendingAsk || hasPendingApproval || showUnread;
  // Suppress the pop for the state the row MOUNTED in: app launch and
  // returning from Project Review must not fire a simultaneous burst
  // of "look here" for states that aren't news. Once the key changes,
  // popEnabled latches true and the keyed icon span remounts with the
  // class already present, so the animation plays exactly on entry.
  // Render-time state adjustment (React's "information from previous
  // renders" pattern) — a post-mount effect can't do this, because
  // adding the class one frame after mount still starts the animation.
  const [prevAttentionKey, setPrevAttentionKey] = useState(attentionKey);
  const [popEnabled, setPopEnabled] = useState(false);
  if (attentionKey !== prevAttentionKey) {
    setPrevAttentionKey(attentionKey);
    setPopEnabled(true);
  }
  // Background is selection's channel: bg-selected (apricot) means "you
  // are here" and nothing else. Running rows must NOT tint the background
  // — brand-soft is the same color as bg-selected, so a running row and
  // the selected row were indistinguishable at a glance. Running already
  // owns four signals (breathing rail, spinner, brand subline, semibold
  // title). The blocking-state tints stay: warning/error are different
  // hues and mean "stuck, needs you" — the loudest triage tier.
  const inactiveRowClass = hasBlockingError
    ? "bg-error/[var(--opacity-subtle)] hover:bg-error/[var(--opacity-soft)]"
    : hasPendingAsk || hasPendingApproval
      ? "bg-warning/[var(--opacity-subtle)] hover:bg-warning/[var(--opacity-soft)]"
      : "hover:bg-hover";
  const activateRow = () => {
    if (isEditing) return;
    onClick?.();
  };
  const handleRowPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isEditing || event.defaultPrevented || event.button !== 0) return;
    // macOS Ctrl-click is a context-menu gesture; don't turn it into a
    // session switch while the user is asking for row actions.
    if (event.ctrlKey) return;

    activateRow();
    // Suppress the click this press will produce (activation already
    // happened on pointerdown for snappy switching). A plain ref, not
    // a timer: every click is preceded by a pointerdown that re-arms
    // the flag, and a press that never clicks (dragged off) re-arms on
    // its next press — so there's no timing window to mis-size. The
    // old 500ms timeout double-fired on long presses.
    ignoreNextRowClickRef.current = true;
  };
  const handleRowClick = () => {
    if (ignoreNextRowClickRef.current) {
      ignoreNextRowClickRef.current = false;
      return;
    }
    activateRow();
  };
  // Archiving a running session (own run or goal-master) hides live
  // work from the status board, so it asks for an explicit confirm
  // (2026-07-05 decision). Archive does NOT stop the run — the dialog
  // copy says exactly that. Settled sessions keep the one-click,
  // reversible archive.
  const archiveNeedsConfirm = isRunning || goalRunning;
  const handleArchiveSelect = () => {
    if (!onArchive) return;
    if (archiveNeedsConfirm) {
      setConfirmArchiveOpen(true);
      return;
    }
    onArchive();
  };
  const row = (
    <div
      data-galley-context-menu-trigger={hasRowActions ? "" : undefined}
      onPointerDown={handleRowPointerDown}
      onClick={handleRowClick}
      className={cn(
        "group relative mx-1.5 grid min-h-[48px] grid-cols-[16px_minmax(0,1fr)] items-start gap-2 overflow-hidden rounded-sm px-3 py-1.5",
        // No row-level ring while editing — the input inside carries
        // its own brand ring; two nested rings for one focus state
        // was noisier than the app's quiet register.
        isEditing
          ? "bg-elevated"
          : active
            ? "bg-selected"
            : actionsOpen
              ? "bg-hover"
              : inactiveRowClass,
      )}
    >
      {railKind &&
        !isEditing &&
        (railKind === "running" ? (
          <>
            <span
              aria-hidden
              className="sidebar-liveness-rail absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full bg-brand-strong/55"
            />
            <span
              key={`${session.id}:${session.lastStepIndex ?? "thinking"}:${cleanSummary ?? ""}`}
              aria-hidden
              className="sidebar-liveness-tick absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full bg-brand-strong"
            />
          </>
        ) : (
          <span
            aria-hidden
            className={cn(
              "absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full",
              railKind === "error" ? "bg-error" : "bg-warning",
            )}
          />
        ))}
      <span
        key={`icon:${attentionKey}`}
        className={cn(
          "flex h-5 w-4 items-center justify-center pt-0.5",
          // No-subline rows center their single line in the 48px row
          // instead of hugging the top (dead space below read as
          // misalignment against two-line neighbours).
          !sublineText && !isEditing && "self-center pt-0",
          // Pop only on state TRANSITIONS, not on mount (see
          // popEnabled above).
          shouldPopIcon && popEnabled && "sidebar-state-pop",
        )}
      >
        {/* Same priority order as the rail and subline (error first):
            the three signals must agree on what the row's state is —
            an amber pause icon next to a red rail read as two states. */}
        {hasPendingAsk && !hasBlockingError ? (
          <PauseCircle size={14} weight="fill" className="text-warning" />
        ) : (
          <StatusIcon
            status={goalRunning ? "running" : status}
            size={14}
            unread={showUnread}
          />
        )}
      </span>
      <div
        className={cn(
          "min-w-0 flex-1",
          !sublineText && !isEditing && "self-center",
          showActionTrigger && "group-hover:pr-7",
          actionsOpen && "pr-7",
        )}
      >
        <div className="flex min-h-5 min-w-0 items-center gap-1.5">
          {isEditing ? (
            <SessionTitleEditor
              initial={session.title}
              onCommit={(t) => onConfirmRename?.(t)}
              onCancel={() => onCancelRename?.()}
              stopRowActivation
              className="flex-1 truncate rounded-sm px-1 py-0"
            />
          ) : (
            <div
              title={session.title}
              className={cn(
                "min-w-0 flex-1 truncate text-[13px] text-ink",
                isRunning ||
                  goalRunning ||
                  showUnread ||
                  hasPendingAsk ||
                  hasPendingApproval ||
                  hasBlockingError
                  ? "font-semibold"
                  : "font-medium",
              )}
            >
              {session.title}
            </div>
          )}
          {petAttached && (
            <IconTooltip text={copy.sidebar.desktopPetAttachedTitle}>
              <span
                aria-label={copy.sidebar.desktopPetAttached}
                className="inline-flex shrink-0 text-ink-soft"
              >
                <Cat size={12} weight="thin" />
              </span>
            </IconTooltip>
          )}
          {schedulerCreated && (
            <IconTooltip text={copy.sidebar.scheduledCreated}>
              <span
                role="img"
                tabIndex={-1}
                aria-label={copy.sidebar.scheduledCreated}
                className={cn(
                  "inline-flex shrink-0 items-center rounded-sm text-ink-muted",
                  "hover:text-ink-soft",
                )}
              >
                <Clock size={12} weight="thin" />
              </span>
            </IconTooltip>
          )}
          {supervisorCreated && (
            <IconTooltip text={copy.sidebar.supervisorCreated}>
              <span
                role="img"
                tabIndex={-1}
                aria-label={copy.sidebar.supervisorCreated}
                className={cn(
                  "inline-flex shrink-0 items-center rounded-sm text-ink-muted",
                  "hover:text-ink-soft",
                )}
              >
                <PlugsConnected size={12} weight="thin" />
              </span>
            </IconTooltip>
          )}
        </div>
        {sublineText && (
          <div
            key={`${session.id}:${showRunningActivity ? `running:${session.lastStepIndex ?? "thinking"}:${cleanSummary ?? ""}` : `settled:${sublineText}`}`}
            // Same truncated-text native-title exception as the row
            // title above — at 14% width the status line clips to
            // almost nothing and was otherwise unrecoverable.
            title={sublineText}
            className={cn(
              // tabular-nums: the subline carries live counts (第 N 步 /
              // 等待审批 · N / 出错 · N) that tick while visible.
              "mt-0.5 truncate text-[11px] leading-[1.4] tabular-nums",
              sublineTone === "warning"
                ? "font-medium text-warning"
                : sublineTone === "error"
                  ? "font-medium text-error"
                  : sublineTone === "running"
                    ? "sidebar-step-tick text-brand-strong/85"
                    : "text-ink-muted",
            )}
          >
            {sublineText}
          </div>
        )}
      </div>
      {showActionTrigger && (
        <div
          className={cn(
            // Vertically centered (not pinned top) so the sole actions
            // entry sits on the row's optical middle for one- and
            // two-line rows alike; sm (28px) button over the old 20px
            // xs — this is a precision target used constantly.
            "pointer-events-none absolute right-1.5 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center opacity-0",
            "group-hover:pointer-events-auto group-hover:opacity-100",
            actionsOpen && "pointer-events-auto opacity-100",
          )}
        >
          <DropdownMenu.Root open={actionsOpen} onOpenChange={setActionsOpen}>
            <IconTooltip text={copy.common.more} side="right">
              <DropdownMenu.Trigger asChild>
                <IconButton
                  ariaLabel={copy.common.more}
                  tooltip={false}
                  size="sm"
                  active={actionsOpen}
                  onPointerDown={(e) => {
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
                // Same register as the MainHeader session-title menu —
                // rename appears in both; they must not differ in
                // width, motion, or type size.
                className="galley-pop-in z-50 min-w-[200px] rounded-md border border-line bg-elevated p-1 shadow-elevated"
              >
                <SidebarSessionMenuItems
                  kind="dropdown"
                  session={session}
                  projects={projects}
                  onArchive={handleArchiveSelect}
                  onTogglePin={onTogglePin}
                  onAssignToProject={onAssignToProject}
                  onRequestRename={onRequestRename}
                />
              </SidebarRowMenuContent>
            </SidebarRowMenuPortal>
          </DropdownMenu.Root>
        </div>
      )}
    </div>
  );

  const archiveConfirmDialog = onArchive ? (
    <ArchiveRunningConfirmDialog
      title={session.title}
      open={confirmArchiveOpen}
      onCancel={() => setConfirmArchiveOpen(false)}
      onConfirm={() => {
        setConfirmArchiveOpen(false);
        onArchive();
      }}
    />
  ) : null;

  // While a rename edit is live, the row must not offer a context menu:
  // right-clicking the row padding blurs the input (committing the
  // rename by design) and would then open a menu over the just-
  // committed row — the user thinks they're still editing.
  if (!hasRowActions || isEditing) {
    return (
      <>
        {row}
        {archiveConfirmDialog}
      </>
    );
  }

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{row}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="galley-pop-in z-50 min-w-[200px] rounded-md border border-line bg-elevated p-1 shadow-elevated">
            <SidebarSessionMenuItems
              kind="context"
              session={session}
              projects={projects}
              onArchive={handleArchiveSelect}
              onTogglePin={onTogglePin}
              onAssignToProject={onAssignToProject}
              onRequestRename={onRequestRename}
            />
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {archiveConfirmDialog}
    </>
  );
});
