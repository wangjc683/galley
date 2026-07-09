import * as Popover from "@radix-ui/react-popover";
import {
  CheckCircle,
  FolderOpen,
  Prohibit,
  Target,
  Warning,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import {
  goalPillLabel,
  goalStageLabel,
  goalWorkspaceHasFiles,
} from "@/lib/goals";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { GoalBrief } from "@/types/goal";

import {
  type TopBarStatusTone,
  TOPBAR_POPOVER_OPEN_STATE,
  topBarStatusBadgeClass,
} from "./topbar-status-badge";

export function GoalIndicator({
  goals,
  onOpenProject,
  onOpenGoal,
  onStopGoal,
}: {
  goals: GoalBrief[];
  onOpenProject?: (projectId: string) => void;
  onOpenGoal?: (goalId: string) => void;
  onStopGoal?: (goalId: string) => void;
}) {
  const copy = useCopy().topbar;
  const [confirmingStopId, setConfirmingStopId] = useState<string | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState<Record<string, boolean>>(
    {},
  );
  const primary = goals[0];
  const visualGoal = goalAttentionGoal(goals);
  const label =
    goals.length > 1
      ? copy.goalPillMultiple(goals.length)
      : goalPillLabel(primary.status, copy);
  const style = goalIndicatorStyle(visualGoal);
  const Icon =
    visualGoal.status === "completed"
      ? CheckCircle
      : visualGoal.status === "failed"
        ? Warning
        : visualGoal.status === "stopped"
          ? Prohibit
          : Target;
  // The pill doubles as an ambient progress bar: a quiet brand fill
  // grows left→right as the time budget is consumed. It restores the
  // at-a-glance progress the countdown removal took away, without
  // reintroducing an anxious ticking number. deadline is frozen at
  // launch, so this runs on a local clock — no dependency on the 5s
  // poll. Wrapping = full bar + breathe (deadline passed, still
  // working — not stuck).
  const fillGoal = goals.find(
    (goal) => goal.status === "running" || goal.status === "wrapping",
  );
  const fillFraction = useGoalBudgetFraction(fillGoal);
  return (
    <Popover.Root
      onOpenChange={(open) => {
        if (!open) {
          setConfirmingStopId(null);
          return;
        }
        // On open, gate the "open output folder" affordance: only goals
        // whose scratch workspace actually holds files get the button.
        // Checked here (rare) rather than on the 5s poll.
        for (const goal of goals) {
          if (!goal.workspacePath) continue;
          void goalWorkspaceHasFiles(goal.id)
            .then((hasFiles) => {
              setWorkspaceReady((prev) =>
                prev[goal.id] === hasFiles
                  ? prev
                  : { ...prev, [goal.id]: hasFiles },
              );
            })
            .catch(() => undefined);
        }
      }}
    >
      <TooltipLabel text={copy.goalTooltip} side="bottom">
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={copy.goalTooltip}
            className={topBarStatusBadgeClass(
              style.tone,
              cn(
                "relative gap-1.5 overflow-hidden",
                TOPBAR_POPOVER_OPEN_STATE,
              ),
            )}
          >
            {fillFraction !== null && (
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 bg-brand/15",
                  fillGoal?.status === "wrapping" && "goal-pill-fill-breathe",
                )}
                style={{ width: `${(fillFraction * 100).toFixed(1)}%` }}
              />
            )}
            <Icon size={14} weight="thin" className="relative z-[1]" />
            <span className="relative z-[1]">{label}</span>
          </button>
        </Popover.Trigger>
      </TooltipLabel>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="galley-pop-in z-50 max-h-[min(70vh,520px)] w-[320px] overflow-y-auto rounded-md border border-line bg-elevated p-3 shadow-elevated"
        >
          <div className="space-y-3">
            {goals.map((goal) => {
              // Wrapping shows no countdown: the budget has ticked to zero
              // but the wrap-up is still working — "剩余 0 分钟" reads as
              // stuck. The stage word already says what's happening.
              const remaining =
                goal.status === "running"
                  ? remainingMinutes(goal.deadlineAt)
                  : null;
              return (
                <div
                  key={goal.id}
                  className="border-b border-line/70 pb-3 last:border-0 last:pb-0"
                >
                  {/* Status line: stage dot + word (left), live
                      countdown (right). The countdown lives here, not
                      on the pill, because it ticks to zero at the
                      deadline while the Goal is still wrapping up. */}
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        goalStageDotClass(goal),
                      )}
                    />
                    <span
                      className={cn(
                        "text-[12px] font-medium",
                        goalStageTextClass(goal),
                      )}
                    >
                      {goalStageLabel(goal.status, copy)}
                    </span>
                    {remaining !== null && (
                      <span className="ml-auto text-[12px] tabular-nums text-ink-soft">
                        {copy.goalRemaining(remaining)}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 line-clamp-2 break-words text-[13px] font-medium leading-snug text-ink">
                    {goal.objective}
                  </div>
                  {/* "What is it doing right now" — the controller's
                      latest progress beat. The single highest-signal
                      line the backend already had and the popover never
                      showed. */}
                  {goal.latestSummary && (
                    <div className="mt-1 line-clamp-2 break-words text-[11.5px] leading-snug text-ink-muted">
                      {goal.latestSummary}
                    </div>
                  )}
                  <div className="mt-1 text-[11px] tabular-nums text-ink-muted">
                    {[
                      // Solo is a single agent — drop the hive-only "N agents".
                      goal.mode !== "solo"
                        ? copy.goalWorkerCount(goal.workerLimit)
                        : null,
                      goal.taskCount != null &&
                      goal.completedTaskCount != null &&
                      goal.taskCount > 0
                        ? copy.goalTaskProgress(
                            goal.completedTaskCount,
                            goal.taskCount,
                          )
                        : null,
                      // No elapsed-of-budget line: the countdown above and
                      // the pill's ambient fill already carry time, and two
                      // framings of the same clock read as noise.
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    <Button
                      size="sm"
                      variant="brand-soft"
                      className="w-full justify-center"
                      onClick={() => onOpenGoal?.(goal.id)}
                    >
                      {goalPrimaryActionLabel(goal, copy)}
                    </Button>
                    {(goal.status === "running" ||
                      goal.status === "wrapping") &&
                      confirmingStopId === goal.id && (
                        <div className="text-[11px] leading-snug text-error">
                          {copy.stopGoalConsequence}
                        </div>
                      )}
                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <div className="flex min-w-0 items-center gap-1">
                        {goal.projectId != null && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[12px]"
                            onClick={() => {
                              const projectId = goal.projectId;
                              if (projectId) onOpenProject?.(projectId);
                            }}
                          >
                            {copy.openGoalProject}
                          </Button>
                        )}
                        {workspaceReady[goal.id] && goal.workspacePath && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[12px]"
                            leadingIcon={<FolderOpen size={13} weight="thin" />}
                            onClick={() => {
                              const path = goal.workspacePath;
                              if (path) {
                                void revealItemInDir(path).catch(
                                  () => undefined,
                                );
                              }
                            }}
                          >
                            {copy.openGoalWorkspace}
                          </Button>
                        )}
                      </div>
                      {(goal.status === "running" ||
                        goal.status === "wrapping") &&
                        (confirmingStopId === goal.id ? (
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
                        ))}
                    </div>
                  </div>
                </div>
              );
            })}
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
  if (goal.status === "completed") return copy.openGoalResult;
  if (goal.status === "failed") return copy.viewGoalDetails;
  // stopped now ends in a brief wrap-up summary — "open result" is the
  // honest label for what's waiting in the master session.
  if (goal.status === "stopped") return copy.openGoalResult;
  return copy.openGoal;
}

/**
 * Time-budget fill fraction for the pill background. Running scales
 * elapsed/budget on a coarse local clock (20s ticks — the budget is
 * minutes-grained, per-second motion would just be noise); wrapping
 * pins to 1. Returns null when no goal is running/wrapping (no fill).
 * The interval only bumps a re-render tick (state changes strictly in
 * the timer callback); the fraction itself derives at render, like
 * `remainingMinutes` in the popover.
 */
function useGoalBudgetFraction(goal?: GoalBrief): number | null {
  const [, setTick] = useState(0);
  const running = goal?.status === "running";
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 20_000);
    return () => window.clearInterval(id);
  }, [running]);
  if (!goal) return null;
  if (goal.status === "wrapping") return 1;
  if (goal.status !== "running") return null;
  return budgetFractionNow(goal.startedAt, goal.deadlineAt);
}

function budgetFractionNow(
  startedAt: string,
  deadlineAt: string,
): number | null {
  const start = Date.parse(startedAt);
  const end = Date.parse(deadlineAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
}

function goalAttentionGoal(goals: GoalBrief[]): GoalBrief {
  // Pill color/icon should reflect the most attention-worthy status,
  // not the backend list order (which puts running first). A failed
  // Goal waiting for the user must not hide behind a calm brand-color
  // pill just because another Goal is still running.
  const priority: Record<GoalBrief["status"], number> = {
    failed: 0,
    completed: 1,
    wrapping: 2,
    running: 3,
    stopped: 4,
  };
  return goals.reduce((best, goal) =>
    priority[goal.status] < priority[best.status] ? goal : best,
  );
}

function goalIndicatorStyle(goal: GoalBrief): { tone: TopBarStatusTone } {
  if (goal.status === "failed") {
    return {
      tone: "error",
    };
  }
  if (goal.status === "completed") {
    return {
      tone: "success",
    };
  }
  // stopped-unseen lingers in the pill until the user reads the wrap-up
  // — user-initiated, so quiet neutral, not brand "still working".
  if (goal.status === "stopped") {
    return {
      tone: "neutral",
    };
  }
  return {
    tone: "brand",
  };
}

function goalStageDotClass(goal: GoalBrief) {
  if (goal.status === "failed") return "bg-error";
  if (goal.status === "completed") return "bg-success";
  if (goal.status === "stopped") return "bg-ink-muted";
  return "bg-brand-strong";
}

function goalStageTextClass(goal: GoalBrief) {
  if (goal.status === "failed") return "text-error";
  if (goal.status === "completed") return "text-success";
  if (goal.status === "stopped") return "text-ink-muted";
  return "text-brand-strong";
}

function remainingMinutes(deadlineAt: string) {
  const deadline = Date.parse(deadlineAt);
  if (!Number.isFinite(deadline)) return null;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 60_000));
}
