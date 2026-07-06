import * as Popover from "@radix-ui/react-popover";
import {
  CheckCircle,
  FolderOpen,
  Target,
  Warning,
} from "@phosphor-icons/react";
import { useState } from "react";

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
        : Target;
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
              cn("gap-1.5", TOPBAR_POPOVER_OPEN_STATE),
            )}
          >
            <Icon size={14} weight="thin" />
            <span>{label}</span>
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
              const remaining =
                goal.status === "running" || goal.status === "wrapping"
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
                  <div className="mt-1 text-[11px] text-ink-muted">
                    {copy.goalWorkerCount(goal.workerLimit)}
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
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[12px]"
                          onClick={() => onOpenProject?.(goal.projectId)}
                        >
                          {copy.openGoalProject}
                        </Button>
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
  return copy.openGoal;
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
