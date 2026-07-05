import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  useEffect,
  memo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Archive,
  CaretRight,
  Cat,
  Check,
  DotsThree,
  Folder,
  PauseCircle,
  Pencil,
  PlugsConnected,
  PushPin,
  PushPinSlash,
  WarningCircle,
  X as XIcon,
} from "@phosphor-icons/react";

import { Button, DialogActionRow, IconButton } from "@/components/ui/button";
import { IconTooltip } from "@/components/ui/tooltip";
import { goalStageLabel } from "@/lib/goals";
import { useCopy } from "@/lib/i18n";
import { isImeCompositionKeydown } from "@/lib/ime";
import { StatusIcon } from "@/lib/status-icon";
import { cn } from "@/lib/utils";
import type { GoalBrief } from "@/types/goal";
import type { Project, Session } from "@/types/session";

import {
  SidebarRowMenuContent,
  SidebarRowMenuItem,
  type SidebarRowMenuKind,
  SidebarRowMenuPortal,
  SidebarRowMenuSeparator,
  SidebarRowMenuSub,
  SidebarRowMenuSubContent,
  SidebarRowMenuSubTrigger,
} from "./SidebarRowMenu";


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
  // Four-state sidebar display (Stage 3 round 7+10, V0.2 ask_user):
  //   1. running                  — bold brand spinner + italic "正在工作 · 第 N 步" subline
  //   2. pending ask_user         — warning PauseCircle + "⏸ 等你回复" subline (V0.2)
  //   3. settled + hasUnread=true — static icon + brand dot + bold title
  //   4. settled + hasUnread=false — static icon, no dot
  // Active row is always treated as read (the user is looking at
  // it); even if the final turn_end fires there, bumpSessionAfterTurn
  // skips the unread mark for sessionId === activeSessionId.
  //
  // Pending ask_user takes precedence over hasUnread when both are
  // true (rare — would mean ask_user fired on a session the user
  // wasn't watching). The yellow indicator carries higher actionable
  // weight than "there's something new"; we override.
  //
  // Running gets a second signal beyond the spinning icon: the
  // subline switches from the persisted turn-summary to a live
  // italic "正在工作 · 第 N 步". Color + typography + language all
  // shift so the running state is identifiable at a glance, not
  // just by the icon's rotation.
  const hasPendingAsk = !!session.hasPendingAskUser;
  const isRunning = session.status === "running";
  const hasPendingApproval =
    session.status === "waiting_approval" || session.pendingApprovalCount > 0;
  const hasBlockingError = session.status === "error";
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
  // Right-side dot is unread-only now; the ongoing states
  // (running / waiting / error) are carried by the left status rail.
  const showUnread =
    !!session.hasUnread &&
    !active &&
    !hasPendingAsk &&
    !hasPendingApproval &&
    !hasBlockingError &&
    !isRunning &&
    !goalRunning;
  const supervisorCreated = session.origin?.via === "supervisor";
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
  //   settled → "已完成 · {summary}"
  //     Same {summary} as the running row's final tick — the
  //     transition from running→settled keeps the recap text
  //     stable and only swaps the prefix (and the icon flips
  //     from spinner to check). Visual continuity for the user.
  //
  // Legacy data: pre-this-change rows wrote
  // "第 N 步 · {summary}" into session.summary directly. Strip
  // that prefix at render so old rows display in the new format
  // without a DB migration.
  const cleanSummary = session.summary
    ? stripLegacyStepPrefix(session.summary)
    : null;
  const approvalCount = session.pendingApprovalCount || 0;
  const errorCount = session.errorCount || 0;
  // Goal-master running subline, e.g. "运行中 · 2 个 Agent" — reuses the
  // TopBar stage + worker-count copy so the row reads the same language
  // as the goal pill. Null unless this session masters a goal.
  const goalSubline = goalMaster
    ? `${goalStageLabel(goalMaster.status, copy.topbar)} · ${copy.topbar.goalWorkerCount(goalMaster.workerLimit)}`
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
                session.status === "cancelled"
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
  const inactiveRowClass = hasBlockingError
    ? "bg-error/[var(--opacity-subtle)] hover:bg-error/[var(--opacity-soft)]"
    : hasPendingAsk || hasPendingApproval
      ? "bg-warning/[var(--opacity-subtle)] hover:bg-warning/[var(--opacity-soft)]"
      : showRunningActivity || goalRunning
        ? "bg-brand-soft/60 hover:bg-brand-soft/80"
        : "hover:bg-hover";
  const activateRow = () => {
    if (isEditing) return;
    onClick?.();
  };
  const handleRowPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
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
        "transition-[background-color,box-shadow,color]",
        isEditing
          ? "bg-elevated ring-1 ring-brand/30"
          : cn(
              "cursor-pointer",
              active
                ? "bg-selected"
                : actionsOpen
                  ? "bg-hover"
                  : inactiveRowClass,
            ),
      )}
    >
      {railKind && !isEditing && (
        railKind === "running" ? (
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
        )
      )}
      <span
        key={`icon:${attentionKey}`}
        className={cn(
          "flex h-5 w-4 items-center justify-center pt-0.5",
          shouldPopIcon && "sidebar-state-pop",
        )}
      >
        {/* Same priority order as the rail and subline (error first):
            the three signals must agree on what the row's state is —
            an amber pause icon next to a red rail read as two states. */}
        {hasPendingAsk && !hasBlockingError ? (
          <PauseCircle size={14} weight="fill" className="text-warning" />
        ) : (
          <StatusIcon
            status={goalRunning ? "running" : session.status}
            size={14}
            unread={showUnread}
          />
        )}
      </span>
      <div
        className={cn(
          "min-w-0 flex-1 transition-[padding] duration-75",
          showActionTrigger && "group-hover:pr-6",
          actionsOpen && "pr-6",
        )}
      >
        <div className="flex min-h-5 min-w-0 items-center gap-1.5">
          {isEditing ? (
            <SessionTitleEditor
              initial={session.title}
              onCommit={(t) => onConfirmRename?.(t)}
              onCancel={() => onCancelRename?.()}
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
          {supervisorCreated && (
            <IconTooltip text={copy.sidebar.supervisorCreated}>
              <span
                role="img"
                tabIndex={-1}
                aria-label={copy.sidebar.supervisorCreated}
                className={cn(
                  "inline-flex shrink-0 items-center rounded-sm text-ink-muted transition-colors",
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
            className={cn(
              "mt-0.5 truncate text-[11px] leading-[1.4]",
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
            "pointer-events-none absolute right-2 top-1.5 z-10 flex h-6 w-6 items-center justify-center opacity-0 transition-opacity duration-75",
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
                  size="xs"
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
                className="z-50 min-w-[180px] rounded-md border border-line bg-elevated p-1 shadow-elevated"
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
          <ContextMenu.Content className="z-50 min-w-[180px] rounded-md border border-line bg-elevated p-1 shadow-elevated">
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

function SidebarSessionMenuItems({
  kind,
  session,
  projects,
  onArchive,
  onTogglePin,
  onAssignToProject,
  onRequestRename,
}: {
  kind: SidebarRowMenuKind;
  session: Session;
  projects: Project[];
  onArchive?: () => void;
  onTogglePin?: () => void;
  onAssignToProject?: (projectId: string | null) => void;
  onRequestRename?: () => void;
}) {
  const copy = useCopy();
  const itemClass = cn(
    "flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-[12.5px] text-ink-soft outline-none transition-colors",
    "data-[highlighted]:bg-hover data-[highlighted]:text-ink",
  );

  return (
    <>
      {onRequestRename && (
        <SidebarRowMenuItem
          kind={kind}
          onSelect={onRequestRename}
          className={itemClass}
        >
          <Pencil size={13} weight="thin" />
          {copy.sidebar.rename}
        </SidebarRowMenuItem>
      )}
      {onTogglePin && (
        <SidebarRowMenuItem
          kind={kind}
          onSelect={onTogglePin}
          className={itemClass}
        >
          {session.pinned ? (
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
      {onAssignToProject && (
        <SidebarRowMenuSub kind={kind}>
          <SidebarRowMenuSubTrigger
            kind={kind}
            className={cn(
              itemClass,
              "data-[state=open]:bg-hover data-[state=open]:text-ink",
            )}
          >
            <Folder size={13} weight="thin" />
            {copy.sidebar.addToProject}
            <CaretRight
              size={10}
              weight="thin"
              className="ml-auto text-ink-muted"
            />
          </SidebarRowMenuSubTrigger>
          <SidebarRowMenuPortal kind={kind}>
            <SidebarRowMenuSubContent
              kind={kind}
              className="z-50 min-w-[200px] rounded-md border border-line bg-elevated p-1 shadow-elevated"
              sideOffset={4}
            >
              {projects.length === 0 ? (
                <div className="px-2.5 py-1.5 text-[12px] italic text-ink-muted">
                  {copy.sidebar.noProjects}
                </div>
              ) : (
                projects.map((p) => {
                  const isCurrent = session.projectId === p.id;
                  return (
                    <SidebarRowMenuItem
                      key={p.id}
                      kind={kind}
                      onSelect={() => onAssignToProject(p.id)}
                      disabled={isCurrent}
                      className={cn(
                        itemClass,
                        "data-[disabled]:cursor-default data-[disabled]:opacity-50",
                      )}
                    >
                      <Folder size={13} weight="thin" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {isCurrent && (
                        <Check
                          size={11}
                          weight="bold"
                          className="text-brand-strong"
                        />
                      )}
                    </SidebarRowMenuItem>
                  );
                })
              )}
              {session.projectId && (
                <>
                  <SidebarRowMenuSeparator
                    kind={kind}
                    className="my-1 h-px bg-line"
                  />
                  <SidebarRowMenuItem
                    kind={kind}
                    onSelect={() => onAssignToProject(null)}
                    className={itemClass}
                  >
                    <XIcon size={13} weight="thin" />
                    {copy.sidebar.removeFromProject}
                  </SidebarRowMenuItem>
                </>
              )}
            </SidebarRowMenuSubContent>
          </SidebarRowMenuPortal>
        </SidebarRowMenuSub>
      )}
      {onArchive && (
        <SidebarRowMenuItem
          kind={kind}
          onSelect={onArchive}
          className={itemClass}
        >
          <Archive size={13} weight="thin" />
          {copy.sidebar.archive}
        </SidebarRowMenuItem>
      )}
    </>
  );
}


/**
 * Confirm dialog for archiving a session that is still running (its
 * own run, or a goal it masters). Mirrors ConfirmDeleteProjectDialog's
 * alertdialog shape; warning tone (not error) because archiving is
 * reversible — the risk is losing SIGHT of live work, not losing data.
 */
function ArchiveRunningConfirmDialog({
  title,
  open,
  onCancel,
  onConfirm,
}: {
  title: string;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const copy = useCopy();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-overlay" />
        <Dialog.Content
          role="alertdialog"
          aria-describedby="archive-running-desc"
          className={cn(
            "fixed left-1/2 top-1/2 z-[60] w-[420px] -translate-x-1/2 -translate-y-1/2",
            "rounded-lg border border-line bg-elevated p-5 shadow-elevated",
            "max-w-[calc(100vw-32px)]",
          )}
        >
          <div className="flex items-center gap-2">
            <WarningCircle size={18} weight="bold" className="text-warning" />
            <Dialog.Title className="text-[15px] font-semibold text-ink">
              {copy.sidebar.archiveRunningTitle}
            </Dialog.Title>
          </div>
          <p
            id="archive-running-desc"
            className="mt-2 text-[12.5px] leading-[1.55] text-ink-soft"
          >
            {copy.sidebar.archiveRunningBody(title)}
          </p>
          <DialogActionRow>
            <Button variant="secondary" onClick={onCancel} autoFocus>
              {copy.common.cancel}
            </Button>
            <Button variant="warning" onClick={onConfirm}>
              {copy.sidebar.archiveRunningConfirm}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Inline-edit input for session title (replaces the title span when
 * `SidebarSessionRow.isEditing` is true).
 *
 * Behavior:
 *   - Auto-focuses + selects all text on mount (Notion / Linear style)
 *   - Enter → commit; Esc → cancel; blur → commit (matching the
 *     "click outside doesn't lose work" pattern)
 *   - stopPropagation on click + mousedown so the parent row's
 *     onClick (session activation) doesn't fire while editing
 *   - Local uncontrolled value — store action handles trim + fallback
 *     to default placeholder on empty
 */
function SessionTitleEditor({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (newTitle: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  // Track whether we've already committed/cancelled — protects against
  // a stray blur after Enter (Enter triggers commit synchronously,
  // then focus moves elsewhere → onBlur fires → second commit). Two
  // commits would call renameSession twice with the same value (no
  // harm) but if the second call beats the parent setEditingSessionId
  // race it produces a flash. Guard idempotently.
  const settledRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCommit(value);
  };
  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (isImeCompositionKeydown(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      className={cn(
        "min-w-0 flex-1 truncate rounded-sm bg-app px-1 py-0 text-[13px] font-medium text-ink",
        "border border-line outline-none ring-2 ring-brand/30",
        "focus:border-brand",
      )}
    />
  );
}


/**
 * Strip the legacy "第 N 步 · " prefix that earlier versions of
 * bumpSessionAfterTurn wrote into session.summary. The current
 * write path stores raw summary text and lets the renderer decide
 * which prefix to add (e.g. "已完成 · " when settled). This
 * keeps old rows displaying in the new format without a DB
 * migration — they'll re-save in the new format on next turn_end.
 */
function stripLegacyStepPrefix(s: string): string {
  return s.replace(/^第\s*\d+\s*步\s*·\s*/, "");
}
