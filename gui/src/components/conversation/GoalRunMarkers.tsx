import { Check, Pause, Target, Timer, Warning, X } from "@phosphor-icons/react";
import { useState } from "react";

import { GOAL_EXTEND_SECONDS, goalStageLabel } from "@/lib/goals";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { GoalBrief, GoalStatus } from "@/types/goal";

/**
 * In-thread markers that bracket a Goal run inside its session
 * (DESIGN.md §4.3 "Goal run = in-thread episode").
 *
 *   - GoalCommissionMarker opens the run: it is the objective the
 *     operator sent in Goal mode — still the user's words, dressed in
 *     the formal bar + brand-tint slab (the pre-2026-08-06 user
 *     register, deliberately retained after plain user messages moved
 *     to highlighter strokes) and "crowned" with a Goal eyebrow, the
 *     run's time ceiling, and a coarse status badge.
 *   - GoalTerminalMarker closes the run: the durable outcome (done /
 *     budget-limited / stopped / failed) + elapsed + continuations, so
 *     reopening a finished run is not amnesiac.
 *   - GoalPausedTail is the home of the two RECOVERABLE states
 *     (`paused` / `blocked`): they get no closing marker, because the
 *     run is not over — one message resumes it.
 *
 * Live progress and the stop control also live in the TopBar pill —
 * these markers are the durable record, refreshed only on coarse
 * status transitions, never a per-second ticker.
 */

function goalBadgeTone(status: GoalStatus): string {
  switch (status) {
    case "failed":
      return "text-error bg-error/[var(--opacity-subtle)]";
    case "blocked":
      return "text-warning bg-warning/[var(--opacity-subtle)]";
    case "stopped":
    case "paused":
    case "budget_limited":
      return "text-ink-muted bg-hover";
    default:
      return "text-brand-strong bg-brand-soft";
  }
}

function GoalStatusBadge({ status }: { status: GoalStatus }) {
  const tb = useCopy().topbar;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm px-1.5 py-px text-[10.5px] font-medium tabular-nums",
        goalBadgeTone(status),
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
  const budgetMinutes =
    goal.budgetSeconds != null
      ? Math.max(1, Math.round(goal.budgetSeconds / 60))
      : null;

  return (
    <div className="my-5">
      {/* Eyebrow: Goal identity (left) + the one parameter the operator
          actually set (the ceiling) and the coarse status (right).
          Upright tabular metadata — cool structure above the warm
          user-register objective below. */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-brand-strong">
          <Target size={12} weight="bold" />
          {conv.goalEyebrow}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] tabular-nums text-ink-muted">
          <span>
            {budgetMinutes != null
              ? conv.goalBudgetCeiling(budgetMinutes)
              : conv.goalNoBudget}
          </span>
        </span>
        <GoalStatusBadge status={goal.status} />
      </div>
      {/* Objective — the operator's own words in the commission's
          formal dress: 4px brand bar + brand-tint slab + sharp right
          edge + Inter medium + shrink-to-fit. Until 2026-08-06 this
          was "same DNA as MessageUser" and kept in lockstep; plain
          user messages now render as highlighter strokes and this
          slab stays behind on purpose — the strokes-vs-slab contrast
          is part of what marks a Goal commission apart from an
          ordinary message (DESIGN.md §4.3). */}
      <div className="relative w-fit max-w-full select-text border-l-4 border-brand-strong bg-brand-tint py-2.5 pl-4 pr-4 [font-size:var(--conversation-body-size)] font-medium [line-height:var(--conversation-body-leading)] text-ink">
        <span className="block whitespace-pre-wrap break-words">{content}</span>
      </div>
    </div>
  );
}

export function GoalTerminalMarker({
  goal,
  onExtend,
}: {
  goal: GoalBrief;
  onExtend?: () => void;
}) {
  const copy = useCopy();
  const tb = copy.topbar;
  const conv = copy.conversation;
  const minutes = Math.max(1, Math.round(goal.elapsedSeconds / 60));
  const Icon =
    goal.status === "completed"
      ? Check
      : goal.status === "budget_limited"
        ? Timer
        : goal.status === "stopped"
          ? Pause
          : goal.status === "failed"
            ? X
            : Warning;
  // budget_limited is neutral, not a failure: the run did the work it
  // was given time for (PRD §3.7).
  const tone =
    goal.status === "completed"
      ? "text-brand-strong"
      : goal.status === "failed"
        ? "text-error"
        : "text-ink-muted";
  // The whole provenance line in v2: how long it ran and how many
  // continuations Core dispatched — the visible evidence of "it kept
  // going by itself". A run that never continued drops the segment.
  const showContinuations = goal.continuationCount > 0;
  // A failure or a time-out without a reason is a dead-end
  // ("反馈引导行动"): the engine records the cause / the state of play
  // in latestSummary, so surface it right where the run ended.
  const showSummary =
    (goal.status === "failed" || goal.status === "budget_limited") &&
    Boolean(goal.latestSummary);
  // "Time's up" is the one terminal state with a way back: raising the
  // ceiling flips the goal to `active` and Core dispatches the next
  // continuation itself — at which point this marker stops being
  // emitted at all (goal-thread only closes terminal runs), so the
  // control removes itself. A goal with no ceiling can never land here,
  // but the guard keeps the button honest with the command's contract.
  const canExtend =
    Boolean(onExtend) &&
    goal.status === "budget_limited" &&
    goal.budgetSeconds != null;
  const extendMinutes = Math.round(GOAL_EXTEND_SECONDS / 60);
  return (
    <div className="my-5">
      <div className="flex items-center gap-2 text-[12px]">
        <Icon size={13} weight="bold" className={cn("shrink-0", tone)} />
        <span className={cn("shrink-0 font-medium", tone)}>
          {goalStageLabel(goal.status, tb)}
        </span>
        <span className="shrink-0 tabular-nums text-ink-muted">
          {`· ${conv.goalRunElapsed(minutes)}`}
        </span>
        {showContinuations && (
          <span className="shrink-0 tabular-nums text-ink-muted">
            {`· ${conv.goalContinuations(goal.continuationCount)}`}
          </span>
        )}
        <span className="h-px min-w-4 flex-1 bg-line" aria-hidden />
        {canExtend && (
          <button
            type="button"
            className={cn(
              "inline-flex h-6 shrink-0 items-center rounded-sm px-1.5 text-[11.5px] font-medium",
              "text-brand-strong hover:bg-brand-soft",
              "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm",
              "active:translate-y-px",
            )}
            onClick={() => onExtend?.()}
          >
            {tb.extendGoalAtCeiling(extendMinutes)}
          </button>
        )}
      </div>
      {showSummary && (
        <div className="mt-1 break-words pl-[21px] text-[11.5px] leading-snug text-ink-muted">
          {goal.latestSummary}
        </div>
      )}
    </div>
  );
}

/**
 * Thread tail for a Goal in one of its two RECOVERABLE states. Rendered
 * only when the session is idle — while the run works, the steps
 * themselves are the liveness and Core bridges the gaps between
 * continuations in-process, so `active` needs no tail at all.
 *
 *   - `paused`  — the user aborted the run, or Core restarted. "Send a
 *     message to continue" is the whole instruction.
 *   - `blocked` — the model (or a run error) says it cannot proceed;
 *     `latestSummary` is its account of what it needs from the user.
 *
 * `onStop` keeps the stop control within reach of the reader of the
 * thread — same two-step confirm (and consequence copy) as the pill.
 */
export function GoalPausedTail({
  goal,
  onStop,
}: {
  goal: GoalBrief;
  onStop?: () => void;
}) {
  const copy = useCopy();
  const tb = copy.topbar;
  const conv = copy.conversation;
  const [confirmingStop, setConfirmingStop] = useState(false);
  const blocked = goal.status === "blocked";
  const Icon = blocked ? Warning : Pause;
  return (
    <div className="my-5 text-[12px]">
      <div
        className={cn(
          "flex items-center gap-2",
          blocked ? "text-warning" : "text-ink-muted",
        )}
      >
        <Icon size={12} weight="bold" className="shrink-0" />
        <span>{blocked ? conv.goalBlockedTail : conv.goalPausedTail}</span>
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
      {blocked && goal.latestSummary && (
        <div className="mt-1 break-words pl-5 text-[11.5px] leading-snug text-ink-muted">
          {goal.latestSummary}
        </div>
      )}
      {confirmingStop && (
        <div className="mt-1 pl-5 text-[11px] leading-snug text-error">
          {tb.stopGoalConsequence}
        </div>
      )}
    </div>
  );
}
