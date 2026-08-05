import { Check, Prohibit, Target, Warning } from "@phosphor-icons/react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";

import { LiveDots } from "@/components/conversation/LiveIndicators";
import { goalStageLabel, goalWorkspaceHasFiles } from "@/lib/goals";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { GoalBrief, GoalStatus } from "@/types/goal";

/**
 * In-thread markers that bracket a Goal run inside its master session
 * (DESIGN.md §4.3 "Goal run = in-thread episode").
 *
 *   - GoalCommissionMarker opens the run: it is the objective the
 *     operator sent in Goal mode, kept in the user register (left brand
 *     bar + brand-tint + Inter — it is still the user's words) but
 *     "crowned" with a Goal eyebrow, the run's fixed parameters, and a
 *     coarse status badge.
 *   - GoalTerminalMarker closes the run: the durable outcome (done /
 *     failed / stopped) + elapsed + result actions, so reopening a
 *     finished run is not amnesiac.
 *
 * Live progress (countdown, worker detail, stop) stays in the TopBar
 * pill — these markers are the durable record, refreshed only on coarse
 * status transitions, never a per-second ticker.
 */

function GoalStatusBadge({ status }: { status: GoalStatus }) {
  const tb = useCopy().topbar;
  const tone =
    status === "failed"
      ? "text-error bg-error/[var(--opacity-subtle)]"
      : status === "stopped"
        ? "text-ink-muted bg-hover"
        : "text-brand-strong bg-brand-soft";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm px-1.5 py-px text-[10.5px] font-medium tabular-nums",
        tone,
      )}
    >
      {goalStageLabel(status, tb)}
    </span>
  );
}

export function GoalCommissionMarker({
  goal,
  content,
}: {
  goal: GoalBrief;
  content: string;
}) {
  const copy = useCopy();
  const conv = copy.conversation;
  const tb = copy.topbar;
  const budgetMinutes = Math.max(1, Math.round(goal.budgetSeconds / 60));

  return (
    <div className="my-5">
      {/* Eyebrow: Goal identity (left) + run parameters & coarse status
          (right). Upright tabular metadata — cool structure above the
          warm user-register objective below. */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-brand-strong">
          <Target size={12} weight="bold" />
          {conv.goalEyebrow}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] tabular-nums text-ink-muted">
          {/* Solo is a single agent — drop the hive-only "N agents". */}
          {goal.mode !== "solo" && (
            <>
              <span>{tb.goalWorkerCount(goal.workerLimit)}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <span>{conv.goalBudget(budgetMinutes)}</span>
          {/* Write mode surfaces only when it deviates from the default:
              the confirm dialog offers no write-mode knob, so labeling
              every run "autonomous" is a parameter the user never set. */}
          {goal.writeMode === "read_only" && (
            <>
              <span aria-hidden>·</span>
              <span>{conv.goalWriteReadonly}</span>
            </>
          )}
        </span>
        <GoalStatusBadge status={goal.status} />
      </div>
      {/* Objective — user register (this is the operator's own words),
          same DNA as MessageUser: 4px brand bar + brand-tint + sharp
          right edge + Inter medium + shrink-to-fit (kept in sync
          2026-08-05 — these two are one visual family; changing the
          geometry in one place alone breaks the register). */}
      <div className="relative w-fit max-w-full select-text border-l-4 border-brand-strong bg-brand-tint py-2.5 pl-4 pr-4 [font-size:var(--conversation-body-size)] font-medium [line-height:var(--conversation-body-leading)] text-ink">
        <span className="block whitespace-pre-wrap break-words">{content}</span>
      </div>
    </div>
  );
}

function elapsedMinutes(startedAt: string, endedAt?: string): number | null {
  if (!endedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.max(1, Math.round((end - start) / 60_000));
}

export function GoalTerminalMarker({ goal }: { goal: GoalBrief }) {
  const copy = useCopy();
  const tb = copy.topbar;
  const conv = copy.conversation;
  const minutes = elapsedMinutes(goal.startedAt, goal.endedAt);
  // Gate the "open output folder" affordance on the workspace actually
  // holding files — same check the TopBar popover uses. A purely textual
  // goal gets a `workspacePath` (created lazily) but may never write to
  // it, so keying off `workspacePath` alone would offer a button that
  // opens an empty folder, and disagree with the popover. Checked once
  // per terminal marker (rare) rather than on a poll.
  const [workspaceHasFiles, setWorkspaceHasFiles] = useState(false);
  useEffect(() => {
    if (!goal.workspacePath) return;
    let cancelled = false;
    void goalWorkspaceHasFiles(goal.id)
      .then((hasFiles) => {
        if (!cancelled) setWorkspaceHasFiles(hasFiles);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [goal.id, goal.workspacePath]);
  const Icon =
    goal.status === "completed"
      ? Check
      : goal.status === "failed"
        ? Warning
        : Prohibit;
  const tone =
    goal.status === "completed"
      ? "text-brand-strong"
      : goal.status === "failed"
        ? "text-error"
        : "text-ink-muted";

  const actionClass = cn(
    "inline-flex h-6 shrink-0 items-center rounded-sm px-1.5 text-[11.5px] text-ink-muted",
    "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm",
    "hover:bg-hover hover:text-ink active:translate-y-px",
  );

  // Provenance line — the only visible evidence of the "keeps improving
  // until the budget ends" promise: N/T tasks done, elapsed, and (when
  // the anchor was actually revised) how many deliverable versions it
  // went through. Fields absent on pre-counter goals just drop their
  // segment; a version of 1 is "wrote it once", not an improvement, so
  // the revisions chip starts at 2.
  const showTasks =
    goal.taskCount != null &&
    goal.completedTaskCount != null &&
    goal.taskCount > 0;
  const showRevisions =
    goal.deliverableVersion != null && goal.deliverableVersion >= 2;
  return (
    <div className="my-5">
      <div className="flex items-center gap-2 text-[12px]">
        <Icon size={13} weight="bold" className={cn("shrink-0", tone)} />
        <span className={cn("shrink-0 font-medium", tone)}>
          {goalStageLabel(goal.status, tb)}
        </span>
        {showTasks && (
          <span className="shrink-0 tabular-nums text-ink-muted">
            {`· ${conv.goalTasksCompleted(
              goal.completedTaskCount ?? 0,
              goal.taskCount ?? 0,
            )}`}
          </span>
        )}
        {minutes != null && (
          <span className="shrink-0 tabular-nums text-ink-muted">
            {`· ${conv.goalRunElapsed(minutes)}`}
          </span>
        )}
        {showRevisions && (
          <span className="shrink-0 tabular-nums text-ink-muted">
            {`· ${conv.goalImprovedVersions(goal.deliverableVersion ?? 0)}`}
          </span>
        )}
        <span className="h-px min-w-4 flex-1 bg-line" aria-hidden />
        {workspaceHasFiles && goal.workspacePath && (
          <button
            type="button"
            className={actionClass}
            onClick={() => {
              const path = goal.workspacePath;
              if (path) void revealItemInDir(path).catch(() => undefined);
            }}
          >
            {tb.openGoalWorkspace}
          </button>
        )}
      </div>
      {/* A failure without a reason is a dead-end ("反馈引导行动") — the
          controller records the cause in latestSummary on failure, so
          surface it right where the run ended. */}
      {goal.status === "failed" && goal.latestSummary && (
        <div className="mt-1 break-words pl-[21px] text-[11.5px] leading-snug text-ink-muted">
          {goal.latestSummary}
        </div>
      )}
    </div>
  );
}

/**
 * Ambient liveness tail for a running Goal master thread. The master
 * session does not itself run an agent loop (workers do the work), so
 * between controller checkpoints the thread sits silent for long
 * stretches. This quiet brand-tinted line + LiveDots reassures the
 * operator the run is still progressing without pretending to be a
 * per-step ticker (live detail stays in the TopBar pill). Rendered only
 * while a goal is running/wrapping and the master is not itself
 * mid-turn. Consistent with DESIGN.md §2.7: running = allowed liveness.
 *
 * `onStop` adds an inline stop control so the reader of the thread can
 * cancel without hunting for the TopBar pill — same two-step confirm
 * (and consequence copy) as the pill popover.
 */
export function GoalRunningTail({ onStop }: { onStop?: () => void }) {
  const copy = useCopy();
  const tb = copy.topbar;
  const [confirmingStop, setConfirmingStop] = useState(false);
  return (
    <div className="my-5 text-[12px]">
      <div className="flex items-center gap-2 text-brand-strong/70">
        <Target size={12} weight="thin" className="shrink-0" />
        <span>{copy.conversation.goalWorking}</span>
        <LiveDots className="pb-px text-brand-strong/50" />
        {onStop && (
          <button
            type="button"
            className={cn(
              "ml-auto inline-flex h-6 shrink-0 items-center rounded-sm px-1.5 text-[11.5px]",
              "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm",
              "active:translate-y-px",
              confirmingStop
                ? "border border-error bg-error/[var(--opacity-soft)] font-medium text-error hover:bg-error/[var(--opacity-medium)]"
                : "text-ink-muted hover:bg-hover hover:text-ink",
            )}
            onClick={() => {
              if (!confirmingStop) {
                setConfirmingStop(true);
                return;
              }
              setConfirmingStop(false);
              onStop();
            }}
          >
            {confirmingStop ? tb.confirmStopGoal : tb.stopGoal}
          </button>
        )}
      </div>
      {confirmingStop && (
        <div className="mt-1 pl-5 text-[11px] leading-snug text-error">
          {tb.stopGoalConsequence}
        </div>
      )}
    </div>
  );
}
