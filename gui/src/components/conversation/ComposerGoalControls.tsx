import { Target, X } from "@phosphor-icons/react";

import { GoalConfirmDialog } from "@/components/conversation/GoalConfirmDialog";
import {
  COMPOSER_GOAL_BUTTON,
  COMPOSER_GOAL_BUTTON_ARMED,
} from "@/components/conversation/composer-styles";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";
import type { GoalLaunchConfig } from "@/types/goal";

interface ComposerGoalControlsProps {
  canShowGoalEntry: boolean;
  effectiveGoalArmed: boolean;
  effectiveGoalConfirmOpen: boolean;
  goalBlockedByActive: boolean;
  goalEntryDisabled: boolean;
  goalSubmitting: boolean;
  requiresModelConfig: boolean;
  stopMode: boolean;
  goalConfirmationObjective: string;
  goalProjectName?: string;
  onArmToggle: () => void;
  onDialogOpenChange: (open: boolean) => void;
  onConfirm: (config: GoalLaunchConfig) => Promise<void>;
}

/**
 * The Goal-mode entry in the Composer's right-hand button row: the
 * "Goal 模式" armed hint, the arm/disarm toggle, and the launch confirm
 * dialog (a Radix portal, so its position here is visually inert).
 * State and gating live in useComposerGoal; this is the view.
 */
export function ComposerGoalControls({
  canShowGoalEntry,
  effectiveGoalArmed,
  effectiveGoalConfirmOpen,
  goalBlockedByActive,
  goalEntryDisabled,
  goalSubmitting,
  requiresModelConfig,
  stopMode,
  goalConfirmationObjective,
  goalProjectName,
  onArmToggle,
  onDialogOpenChange,
  onConfirm,
}: ComposerGoalControlsProps) {
  const copy = useCopy();
  return (
    <>
      {/* Always mounted, width-animated: conditional mounting made
          the hint (and the submit control's circle→pill morph)
          reflow the row in one frame, so the Goal button jumped
          sideways under the pointer the instant it was pressed. */}
      {canShowGoalEntry && (
        <span
          className={cn(
            "hidden min-w-0 truncate text-[11px] font-medium text-ink-soft sm:inline",
            "transition-[max-width,opacity,margin] duration-(--motion-base) ease-firm",
            effectiveGoalArmed
              ? "ml-0 max-w-[160px] opacity-100"
              : "-ml-1.5 max-w-0 opacity-0",
          )}
          aria-hidden={!effectiveGoalArmed || undefined}
        >
          {copy.composer.goalArmedHint}
        </span>
      )}
      {canShowGoalEntry && (
        <TooltipLabel
          text={
            goalBlockedByActive
              ? copy.composer.goalBlockedByActive
              : requiresModelConfig
                ? copy.composer.configureModelBeforeSending
                : stopMode
                  ? copy.composer.goalBlockedByRunning
                  : effectiveGoalArmed
                    ? copy.composer.cancelGoalMode
                    : copy.composer.goalTooltip
          }
        >
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={preventMouseFocus}
            // handleGoalArmToggle already no-ops when blocked;
            // aria-disabled (not `disabled`) keeps pointer events
            // alive so the explanatory tooltip ("已有 Goal 在跑")
            // can actually open.
            onClick={onArmToggle}
            aria-disabled={
              (goalEntryDisabled && !requiresModelConfig) || undefined
            }
            aria-label={
              effectiveGoalArmed
                ? copy.composer.cancelGoalMode
                : copy.composer.goalButton
            }
            className={cn(
              effectiveGoalArmed
                ? COMPOSER_GOAL_BUTTON_ARMED
                : COMPOSER_GOAL_BUTTON,
              goalEntryDisabled &&
                !requiresModelConfig &&
                "cursor-not-allowed opacity-50 hover:translate-y-0 hover:shadow-none active:translate-y-0 active:scale-100",
            )}
          >
            {/* Armed = ×, not a second Target: the launch button
                beside it is the (filled) Target, and two identical
                icons left the pair unreadable. × after the
                "Goal 模式" hint reads as "dismiss this mode". */}
            {effectiveGoalArmed ? (
              <X size={15} weight="bold" />
            ) : (
              <Target size={15} weight="thin" />
            )}
          </button>
        </TooltipLabel>
      )}
      <GoalConfirmDialog
        key={goalConfirmationObjective || "goal-confirm-closed"}
        open={effectiveGoalConfirmOpen}
        objective={goalConfirmationObjective}
        projectName={goalProjectName}
        submitting={goalSubmitting}
        onOpenChange={onDialogOpenChange}
        onConfirm={(config) => {
          void onConfirm(config);
        }}
      />
    </>
  );
}
