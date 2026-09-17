import { Target, X } from "@phosphor-icons/react";

import {
  COMPOSER_GOAL_BUTTON,
  COMPOSER_GOAL_BUTTON_ARMED,
} from "@/components/conversation/composer-styles";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

interface ComposerGoalControlsProps {
  canShowGoalEntry: boolean;
  effectiveGoalArmed: boolean;
  goalBlockedByActive: boolean;
  goalEntryDisabled: boolean;
  requiresModelConfig: boolean;
  stopMode: boolean;
  onArmToggle: () => void;
}

/**
 * The Goal-mode entry in the Composer's right-hand button row: the
 * arm/disarm toggle. Since ticket 09 the armed state is announced by
 * the Composer's dress (brand-tint shell + eyebrow row), not by a text
 * hint here, so this control never changes the row's geometry.
 * State and gating live in useComposerGoal; this is the view.
 */
export function ComposerGoalControls({
  canShowGoalEntry,
  effectiveGoalArmed,
  goalBlockedByActive,
  goalEntryDisabled,
  requiresModelConfig,
  stopMode,
  onArmToggle,
}: ComposerGoalControlsProps) {
  const copy = useCopy();
  if (!canShowGoalEntry) return null;
  return (
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
        aria-disabled={(goalEntryDisabled && !requiresModelConfig) || undefined}
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
        {/* Armed = ×, not a second Target: the launch button beside
            it is the (filled) Target, and two identical icons left
            the pair unreadable. × reads as "leave this mode". */}
        {effectiveGoalArmed ? (
          <X size={15} weight="bold" />
        ) : (
          <Target size={15} weight="thin" />
        )}
      </button>
    </TooltipLabel>
  );
}
