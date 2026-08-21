import { ArrowUp, Gear, Stop, Target } from "@phosphor-icons/react";

import {
  COMPOSER_CONFIG_BUTTON,
  COMPOSER_SEND_BUTTON,
  COMPOSER_STOP_BUTTON,
} from "@/components/conversation/composer-styles";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

interface ComposerActionSlotProps {
  stopMode: boolean;
  isSideQuestion: boolean;
  isStopping: boolean;
  submitAckTick: number;
  disabled: boolean;
  hasSendableContent: boolean;
  goalSubmitting: boolean;
  effectiveGoalArmed: boolean;
  requiresModelConfig: boolean;
  hasConfigureModels: boolean;
  onStop?: () => void;
  onSubmit: () => void;
}

/**
 * The send / stop control at the right edge of the Composer's button
 * row. Fixed 32px circle in EVERY state. The armed state used to
 * morph this into a 116px "启动 Goal" pill, which shoved the
 * Goal toggle ~84px left in this right-aligned row — the
 * pointer then hovered the (often unlit) pill, so a second
 * press to cancel hit a dead control. Geometry stability
 * beats the wide-label emphasis: armed is conveyed by the
 * Target icon morph + hint + tooltip instead.
 */
export function ComposerActionSlot({
  stopMode,
  isSideQuestion,
  isStopping,
  submitAckTick,
  disabled,
  hasSendableContent,
  goalSubmitting,
  effectiveGoalArmed,
  requiresModelConfig,
  hasConfigureModels,
  onStop,
  onSubmit,
}: ComposerActionSlotProps) {
  const copy = useCopy();
  return (
    <span
      key={`composer-action-${submitAckTick}`}
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center rounded-full",
        submitAckTick > 0 && "composer-submit-ack",
      )}
    >
      {stopMode && !isSideQuestion ? (
        // The slot stays Stop for the whole run — queueing is
        // Enter-only, taught by the footer hint (variant B verdict,
        // devlog 2026-08-12-queue-slot-variant-verdict). Geometry
        // stability again beats a morphing affordance: Stop is used
        // under impatience, exactly when a shape-shifted slot causes
        // the worst misclick (meant stop, queued a half-typed draft).
        <TooltipLabel
          text={isStopping ? copy.composer.stopping : copy.composer.stop}
        >
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={preventMouseFocus}
            onClick={() => {
              if (isStopping) return;
              onStop?.();
            }}
            aria-disabled={isStopping || undefined}
            aria-label={
              isStopping ? copy.composer.stopping : copy.composer.stop
            }
            className={cn(
              COMPOSER_STOP_BUTTON,
              // Resting pulse halo + no hover lift while the
              // abort is in flight: reads as "acknowledged,
              // locked" without going fully disabled — disabled
              // would wipe the halo via COMPOSER_ACTION_BUTTON's
              // disabled:shadow-none.
              isStopping &&
                "cursor-default shadow-[var(--shadow-composer-stop-pulse)] hover:translate-y-0",
            )}
          >
            <Stop size={14} weight="fill" />
          </button>
        </TooltipLabel>
      ) : (
        <TooltipLabel
          text={
            requiresModelConfig
              ? copy.composer.configureModelBeforeSending
              : effectiveGoalArmed
                ? copy.composer.startGoalWithEnter
                : copy.composer.sendWithEnter
          }
        >
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={preventMouseFocus}
            // aria-disabled + click guard (not `disabled`) so the
            // "发送 · Enter" / "先配置模型" tooltips still open on
            // the unlit button — see ComposerAttachButton.
            onClick={() => {
              if (
                disabled ||
                !hasSendableContent ||
                goalSubmitting ||
                (requiresModelConfig && !hasConfigureModels)
              ) {
                return;
              }
              onSubmit();
            }}
            aria-disabled={
              disabled ||
              !hasSendableContent ||
              goalSubmitting ||
              (requiresModelConfig && !hasConfigureModels) ||
              undefined
            }
            aria-label={
              requiresModelConfig
                ? copy.composer.configureModelBeforeSending
                : effectiveGoalArmed
                  ? copy.composer.startGoal
                  : copy.composer.send
            }
            className={cn(
              requiresModelConfig
                ? COMPOSER_CONFIG_BUTTON
                : COMPOSER_SEND_BUTTON,
              (disabled ||
                !hasSendableContent ||
                goalSubmitting ||
                (requiresModelConfig && !hasConfigureModels)) &&
                // Empty/disabled = a quiet neutral "unlit" circle, not a
                // faded brand fill (50% of pale apricot still read as a
                // soft button). The brand fill flips in instantly the
                // moment the first character lands (the base button is
                // transition-none; state flips are instant by design).
                //
                // Fill is --color-hover, the neutral "inert control"
                // step. Was --color-chrome until 2026-08-05, which only
                // ever fit by greyscale coincidence: chrome belongs to
                // the sidebar layer and moves whenever that relationship
                // is retuned. It has moved twice since — deepened on
                // 08-05, then lifted and flipped to the *lighter* side
                // of --color-app in dark on 08-21 — so borrowing it here
                // would have broken this button twice. --color-hover is
                // the token that actually means "unlit control", and it
                // stays a step off the canvas in the right direction in
                // both themes.
                "cursor-not-allowed border-line bg-hover text-ink-muted shadow-none hover:translate-y-0 hover:border-line hover:bg-hover hover:text-ink-muted hover:shadow-none active:translate-y-0 active:scale-100",
            )}
          >
            {requiresModelConfig ? (
              <Gear size={15} weight="thin" />
            ) : effectiveGoalArmed ? (
              <Target size={16} weight="fill" />
            ) : (
              <ArrowUp size={16} weight="bold" />
            )}
          </button>
        </TooltipLabel>
      )}
    </span>
  );
}
