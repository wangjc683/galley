import { useEffect, useState } from "react";

import type { ImageBlockReason } from "@/lib/composer-images";
import {
  DEFAULT_GOAL_BUDGET_PRESET,
  resolveGoalBudgetSeconds,
  type GoalBudgetPreset,
} from "@/lib/goals";
import type { GoalBrief, GoalLaunchConfig } from "@/types/goal";

/**
 * Goal-mode state machine for the Composer: arm/disarm, the time-ceiling
 * choice, launch, and the "blocked by an active Goal" hint. Two states
 * only since ticket 09 (2026-09-17): armed → launched. The confirm
 * dialog that used to sit between them is gone — armed is the preview
 * (the Composer wears the commission marker's dress), Enter launches.
 *
 * The derived flags (`effectiveGoalArmed` &c.) stay exposed because
 * they also drive the Composer's shell colours, eyebrow, placeholder,
 * keydown Escape branch, footer hint, and the send-button icon/label —
 * arming changes the whole Composer's posture, not just one control.
 */
export function useComposerGoal({
  onGoalSubmit,
  goal,
  hasActiveGoal,
  disabled,
  stopMode,
  requiresModelConfig,
  onConfigureModels,
  hasText,
  hasPendingImages,
  onImageBlocked,
  getSubmittableText,
  resetDraftAfterSubmit,
  focusTextarea,
}: {
  onGoalSubmit?: (
    text: string,
    config: GoalLaunchConfig,
  ) => void | Promise<void>;
  goal?: GoalBrief;
  hasActiveGoal: boolean;
  disabled: boolean;
  stopMode: boolean;
  requiresModelConfig: boolean;
  onConfigureModels?: () => void;
  hasText: boolean;
  hasPendingImages: boolean;
  onImageBlocked?: (reason: ImageBlockReason) => void;
  /** `() => expandPastePlaceholders(text).trim()` — closure from the container. */
  getSubmittableText: () => string;
  resetDraftAfterSubmit: () => void;
  focusTextarea: () => void;
}) {
  const [goalArmed, setGoalArmed] = useState(false);
  // Not remembered across launches (ticket 09 裁决 3): every arm starts
  // from the recommended ceiling, so "no ceiling" is always a choice
  // made for this Goal, never inherited from the last one.
  const [goalBudgetPreset, setGoalBudgetPreset] = useState<GoalBudgetPreset>(
    DEFAULT_GOAL_BUDGET_PRESET,
  );
  const [goalSubmitting, setGoalSubmitting] = useState(false);
  const [showGoalBlockedHint, setShowGoalBlockedHint] = useState(false);

  const canShowGoalEntry = Boolean(onGoalSubmit) && !goal;
  // One open Goal per session (PRD §6 裁决 3 dropped the global lock):
  // this conversation already has an active / paused / blocked Goal.
  const goalBlockedByActive = canShowGoalEntry && hasActiveGoal;
  const goalModeBlocked = disabled || stopMode || goalBlockedByActive;
  const goalEntryDisabled = goalModeBlocked || goalSubmitting;
  const goalStartBlocked = goalModeBlocked || !hasText || goalSubmitting;
  const effectiveGoalArmed =
    goalArmed && canShowGoalEntry && !goalModeBlocked && !requiresModelConfig;

  useEffect(() => {
    if (!showGoalBlockedHint) return;
    // Auto-fade after long enough to read. If the blocking Goal finishes
    // first the hint stops rendering anyway (its render gate ANDs in
    // goalBlockedByActive), so no separate early-clear is needed.
    const timer = window.setTimeout(() => {
      setShowGoalBlockedHint(false);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [showGoalBlockedHint]);

  const disarmGoal = () => {
    setGoalArmed(false);
    setGoalBudgetPreset(DEFAULT_GOAL_BUDGET_PRESET);
  };

  const handleGoalArmToggle = () => {
    if (!canShowGoalEntry) return;
    if (requiresModelConfig) {
      onConfigureModels?.();
      return;
    }
    // A second Goal on the same conversation is blocked. Don't fail
    // silently on a disabled-looking button — surface the reason inline.
    // The hover tooltip alone left "why is this greyed out?" unanswered
    // on click.
    if (goalBlockedByActive) {
      setShowGoalBlockedHint(true);
      return;
    }
    if (goalEntryDisabled) return;
    if (goalArmed) {
      disarmGoal();
    } else {
      setGoalBudgetPreset(DEFAULT_GOAL_BUDGET_PRESET);
      setGoalArmed(true);
    }
    focusTextarea();
  };

  /** Armed + Enter / ◎: launch with the eyebrow's ceiling. No confirm
   * step — a v2 Goal runs in this conversation and stops in one click,
   * so the armed dress is the whole "are you sure". */
  const launchGoal = async () => {
    if (hasPendingImages) {
      onImageBlocked?.("goal");
      return;
    }
    const trimmed = getSubmittableText();
    if (!trimmed || disabled) return;
    if (requiresModelConfig) {
      onConfigureModels?.();
      return;
    }
    if (goalStartBlocked || !onGoalSubmit) return;
    setGoalSubmitting(true);
    try {
      await onGoalSubmit(trimmed, {
        budgetSeconds: resolveGoalBudgetSeconds(goalBudgetPreset),
      });
      resetDraftAfterSubmit();
      disarmGoal();
    } catch {
      // App owns user-facing toast copy; keep the draft (and stay
      // armed) so the user can retry.
    } finally {
      setGoalSubmitting(false);
    }
  };

  return {
    canShowGoalEntry,
    goalBlockedByActive,
    goalEntryDisabled,
    goalSubmitting,
    effectiveGoalArmed,
    goalBudgetPreset,
    goalBlockedHintVisible: showGoalBlockedHint && goalBlockedByActive,
    setGoalBudgetPreset,
    handleGoalArmToggle,
    launchGoal,
    disarmGoal,
  };
}
