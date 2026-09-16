import * as Popover from "@radix-ui/react-popover";
import {
  CheckCircle,
  Pause,
  Target,
  Timer,
  Warning,
  XCircle,
} from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import {
  GOAL_EXTEND_SECONDS,
  goalPillLabel,
  goalStageLabel,
} from "@/lib/goals";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { isTerminalGoalStatus, type GoalBrief } from "@/types/goal";

import {
  type TopBarStatusTone,
  TOPBAR_POPOVER_OPEN_STATE,
  topBarStatusBadgeClass,
} from "./topbar-status-badge";

export function GoalIndicator({
  goals,
  onOpenGoal,
  onStopGoal,
  onExtendGoal,
}: {
  goals: GoalBrief[];
  onOpenGoal?: (goalId: string) => void;
  onStopGoal?: (goalId: string) => void;
  onExtendGoal?: (goalId: string) => void;
}) {
  const copy = useCopy().topbar;
  const [confirmingStopId, setConfirmingStopId] = useState<string | null>(null);
  // Goal v2 drops the global single-active lock: several sessions can
  // each run one (PRD §6 裁决 3). The popover is therefore a list, and
  // the pill speaks for the one that most wants the user.
  const open = goals.filter((goal) => !isTerminalGoalStatus(goal.status));
  const awaitingReview = goals.filter((goal) =>
    isTerminalGoalStatus(goal.status),
  );
  const pillGoal = goals.length ? goalAttentionGoal(goals) : undefined;
  if (!pillGoal) return null;
  const label =
    goals.length > 1
      ? `${goalPillLabel(pillGoal.status, copy)} · ${goals.length}`
      : goalPillLabel(pillGoal.status, copy);
  const style = goalIndicatorStyle(pillGoal);
  // Inline ternary, not a helper: a function that returns a component
  // trips the compiler's "component created during render" rule.
  const Icon =
    pillGoal.status === "completed"
      ? CheckCircle
      : pillGoal.status === "failed"
        ? XCircle
        : pillGoal.status === "blocked"
          ? Warning
          : pillGoal.status === "budget_limited"
            ? Timer
            : pillGoal.status === "paused" || pillGoal.status === "stopped"
              ? Pause
              : Target;
  // The pill doubles as an ambient progress bar: a quiet brand fill
  // grows left→right as the time ceiling is consumed. `elapsedSeconds`
  // is computed by Core on every read, so the 5s poll (and each
  // `goal-updated` event) is the clock — no local timer, no Date.now
  // during render. A no-ceiling goal draws no bar: there is no
  // denominator, and a full-width fill would read as "out of time".
  const fillFraction = budgetFraction(open[0]);

  const extendMinutes = Math.round(GOAL_EXTEND_SECONDS / 60);

  const renderGoalRow = (goal: GoalBrief) => {
    const stopCandidate = !isTerminalGoalStatus(goal.status);
    // More time is offered wherever a ceiling exists and the run can
    // still use it: at the ceiling (`budget_limited`, the way back out
    // of that terminal state) and while it is being consumed
    // (`active`, for the user who can already see it will run short).
    const extendCandidate =
      Boolean(onExtendGoal) &&
      goal.budgetSeconds != null &&
      (goal.status === "budget_limited" || goal.status === "active");
    return (
      <div
        key={goal.id}
        className="border-b border-line/70 pb-3 last:border-0 last:pb-0"
      >
        {/* Status line: stage dot + word (left), elapsed-of-ceiling
            (right). Elapsed, not a countdown: the ceiling is a stop
            rule, not a delivery promise. */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              goalStageDotClass(goal),
            )}
          />
          <span
            className={cn("text-[12px] font-medium", goalStageTextClass(goal))}
          >
            {goalStageLabel(goal.status, copy)}
          </span>
          <span className="ml-auto text-[12px] tabular-nums text-ink-soft">
            {goal.budgetSeconds != null
              ? copy.goalElapsedOfCeiling(
                  Math.round(goal.elapsedSeconds / 60),
                  Math.round(goal.budgetSeconds / 60),
                )
              : copy.goalElapsed(Math.round(goal.elapsedSeconds / 60))}
          </span>
        </div>

        <div className="mt-2 line-clamp-2 break-words text-[13px] font-medium leading-snug text-ink">
          {goal.objective}
        </div>
        {/* The recoverable states are the ones that need a sentence:
            paused says how to resume, blocked says why it stopped. */}
        {goal.status === "paused" && (
          <div className="mt-1 text-[11.5px] leading-snug text-ink-muted">
            {copy.goalPausedHint}
          </div>
        )}
        {goal.status === "blocked" && (
          <div className="mt-1 text-[11.5px] leading-snug text-warning">
            {copy.goalBlockedHint}
          </div>
        )}
        {goal.latestSummary && (
          <div className="mt-1 line-clamp-3 break-words text-[11.5px] leading-snug text-ink-muted">
            {goal.latestSummary}
          </div>
        )}
        {goal.continuationCount > 0 && (
          <div className="mt-1 text-[11px] tabular-nums text-ink-muted">
            {copy.goalContinuationCount(goal.continuationCount)}
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2">
          <Button
            size="sm"
            variant="brand-soft"
            className="w-full justify-center"
            onClick={() => onOpenGoal?.(goal.id)}
          >
            {goalPrimaryActionLabel(goal, copy)}
          </Button>
          {stopCandidate && confirmingStopId === goal.id && (
            <div className="text-[11px] leading-snug text-error">
              {copy.stopGoalConsequence}
            </div>
          )}
          {(stopCandidate || extendCandidate) && (
            <div className="flex items-center justify-end gap-2 pt-0.5">
              {extendCandidate && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mr-auto h-7 px-2.5 font-medium text-brand-strong hover:bg-brand-soft hover:text-brand-strong"
                  onClick={() => onExtendGoal?.(goal.id)}
                >
                  {goal.status === "budget_limited"
                    ? copy.extendGoalAtCeiling(extendMinutes)
                    : copy.extendGoal(extendMinutes)}
                </Button>
              )}
              {!stopCandidate ? null : confirmingStopId === goal.id ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 border border-error bg-error/[var(--opacity-soft)] px-2.5 font-medium text-error hover:bg-error/[var(--opacity-medium)] hover:text-error"
                  onClick={() => {
                    setConfirmingStopId(null);
                    onStopGoal?.(goal.id);
                  }}
                >
                  {copy.confirmStopGoal}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 border border-error/25 px-2.5 font-medium text-error hover:bg-error/[var(--opacity-soft)] hover:text-error"
                  onClick={() => setConfirmingStopId(goal.id)}
                >
                  {copy.stopGoal}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Popover.Root
      onOpenChange={(popoverOpen) => {
        if (!popoverOpen) setConfirmingStopId(null);
      }}
    >
      <TooltipLabel text={copy.goalTooltip} side="bottom">
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={copy.goalTooltip}
            className={topBarStatusBadgeClass(
              style.tone,
              cn("relative gap-1.5 overflow-hidden", TOPBAR_POPOVER_OPEN_STATE),
            )}
          >
            {fillFraction !== null && (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-brand/15"
                style={{ width: `${(fillFraction * 100).toFixed(1)}%` }}
              />
            )}
            <Icon size={14} weight="thin" className="relative z-[1]" />
            <span className="relative z-[1] tabular-nums">{label}</span>
          </button>
        </Popover.Trigger>
      </TooltipLabel>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="galley-pop-in z-50 max-h-[min(70vh,520px)] w-[320px] overflow-y-auto rounded-md border border-line bg-elevated p-3 shadow-elevated"
        >
          <div className="space-y-4">
            {open.length > 0 && (
              <section className="space-y-2.5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                  {copy.goalSectionInProgress}
                </div>
                <div className="space-y-3">{open.map(renderGoalRow)}</div>
              </section>
            )}
            {awaitingReview.length > 0 && (
              <section className="space-y-2.5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                  {copy.goalSectionToReview}
                </div>
                <div className="space-y-3">
                  {awaitingReview.map(renderGoalRow)}
                </div>
              </section>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function goalPrimaryActionLabel(
  goal: GoalBrief,
  copy: ReturnType<typeof useCopy>["topbar"],
) {
  if (goal.status === "failed" || goal.status === "blocked") {
    return copy.viewGoalDetails;
  }
  if (isTerminalGoalStatus(goal.status)) return copy.openGoalResult;
  return copy.openGoal;
}

/**
 * Elapsed-of-ceiling fill for the pill. Null when there is no open goal
 * or the open one has no ceiling. Reads `elapsedSeconds` straight from
 * the brief — Core computes it at read time, so the value is as fresh
 * as the last poll / event and the render stays pure.
 */
function budgetFraction(goal?: GoalBrief): number | null {
  if (!goal || goal.budgetSeconds == null || goal.budgetSeconds <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, goal.elapsedSeconds / goal.budgetSeconds));
}

function goalAttentionGoal(goals: GoalBrief[]): GoalBrief {
  // Pill color/icon should reflect the most attention-worthy status,
  // not the backend list order. A failed or blocked Goal waiting for
  // the user must not hide behind a calm brand-color pill just because
  // another Goal is still running.
  const priority: Record<GoalBrief["status"], number> = {
    failed: 0,
    blocked: 1,
    completed: 2,
    budget_limited: 3,
    paused: 4,
    active: 5,
    stopped: 6,
  };
  return goals.reduce((best, goal) =>
    priority[goal.status] < priority[best.status] ? goal : best,
  );
}

function goalIndicatorStyle(goal: GoalBrief): { tone: TopBarStatusTone } {
  if (goal.status === "failed") return { tone: "error" };
  if (goal.status === "blocked") return { tone: "warning" };
  if (goal.status === "completed") return { tone: "success" };
  // Paused / stopped / budget-limited linger in the pill until the user
  // reads them — quiet neutral, not brand "still working".
  if (goal.status !== "active") return { tone: "neutral" };
  return { tone: "brand" };
}

function goalStageDotClass(goal: GoalBrief) {
  if (goal.status === "failed") return "bg-error";
  if (goal.status === "blocked") return "bg-warning";
  if (goal.status === "completed") return "bg-success";
  if (goal.status === "active") return "bg-brand-strong";
  return "bg-ink-muted";
}

function goalStageTextClass(goal: GoalBrief) {
  if (goal.status === "failed") return "text-error";
  if (goal.status === "blocked") return "text-warning";
  if (goal.status === "completed") return "text-success";
  if (goal.status === "active") return "text-brand-strong";
  return "text-ink-muted";
}
