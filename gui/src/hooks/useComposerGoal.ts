import { useEffect, useState } from "react";

import type { ImageBlockReason } from "@/lib/composer-images";
import type { GoalBrief, GoalLaunchConfig } from "@/types/goal";

/**
 * Goal-mode state machine for the Composer: arm/disarm, the confirm
 * dialog lifecycle, and the "blocked by an active Goal" hint. The
 * derived flags (`effectiveGoalArmed` &c.) stay exposed because they
 * also drive the Composer's placeholder, keydown Escape branch, footer
 * hint, and the send-button icon/label — the view side of Goal mode
 * lives in ComposerGoalControls, but arming changes the whole
 * Composer's posture, not just those two controls.
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
  const [goalConfirmOpen, setGoalConfirmOpen] = useState(false);
  const [goalConfirmationObjective, setGoalConfirmationObjective] =
    useState("");
  const [goalSubmitting, setGoalSubmitting] = useState(false);
  const [showGoalBlockedHint, setShowGoalBlockedHint] = useState(false);

  const canShowGoalEntry = Boolean(onGoalSubmit) && !goal;
  // Single active Goal: another Goal is already running elsewhere (this
  // Composer isn't the one showing it, since canShowGoalEntry requires !goal).
  const goalBlockedByActive = canShowGoalEntry && hasActiveGoal;
  const goalModeBlocked = disabled || stopMode || goalBlockedByActive;
  const goalEntryDisabled = goalModeBlocked || goalSubmitting;
  const goalStartBlocked = goalModeBlocked || !hasText || goalSubmitting;
  const effectiveGoalArmed =
    goalArmed && canShowGoalEntry && !goalModeBlocked && !requiresModelConfig;
  const effectiveGoalConfirmOpen = goalConfirmOpen && effectiveGoalArmed;

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

  const handleGoalArmToggle = () => {
    if (!canShowGoalEntry) return;
    if (requiresModelConfig) {
      onConfigureModels?.();
      return;
    }
    // A second Goal is blocked while one is running. Don't fail silently
    // on a disabled-looking button — surface the reason inline. The hover
    // tooltip alone left "why is this greyed out?" unanswered on click.
    if (goalBlockedByActive) {
      setShowGoalBlockedHint(true);
      return;
    }
    if (goalEntryDisabled) return;
    setGoalArmed((armed) => !armed);
    focusTextarea();
  };

  const openGoalConfirmation = () => {
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
    if (goalStartBlocked) return;
    setGoalConfirmationObjective(trimmed);
    setGoalConfirmOpen(true);
  };

  const handleConfirmGoal = async (config: GoalLaunchConfig) => {
    const trimmed = goalConfirmationObjective || getSubmittableText();
    if (!trimmed || !onGoalSubmit || goalSubmitting) return;
    setGoalSubmitting(true);
    try {
      await onGoalSubmit(trimmed, config);
      resetDraftAfterSubmit();
      setGoalArmed(false);
      setGoalConfirmOpen(false);
      setGoalConfirmationObjective("");
    } catch {
      // App owns user-facing toast copy; keep the draft so the user can retry.
    } finally {
      setGoalSubmitting(false);
    }
  };

  const handleGoalDialogOpenChange = (open: boolean) => {
    if (goalSubmitting) return;
    setGoalConfirmOpen(open);
    if (!open) {
      setGoalArmed(false);
      setGoalConfirmationObjective("");
    }
  };

  const disarmGoal = () => {
    setGoalArmed(false);
  };

  return {
    canShowGoalEntry,
    goalBlockedByActive,
    goalEntryDisabled,
    goalSubmitting,
    effectiveGoalArmed,
    effectiveGoalConfirmOpen,
    goalConfirmationObjective,
    goalBlockedHintVisible: showGoalBlockedHint && goalBlockedByActive,
    handleGoalArmToggle,
    openGoalConfirmation,
    handleConfirmGoal,
    handleGoalDialogOpenChange,
    disarmGoal,
  };
}
