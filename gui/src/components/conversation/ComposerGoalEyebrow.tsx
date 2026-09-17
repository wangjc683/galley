import * as Popover from "@radix-ui/react-popover";
import { CaretUp, Target } from "@phosphor-icons/react";

import { GoalCeilingWheel } from "@/components/conversation/GoalCeilingWheel";
import { TooltipLabel } from "@/components/ui/tooltip";
import type { GoalBudgetMinutes } from "@/lib/goals";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

interface ComposerGoalEyebrowProps {
  budgetMinutes: GoalBudgetMinutes;
  disabled: boolean;
  onBudgetMinutesChange: (minutes: GoalBudgetMinutes) => void;
}

/**
 * The armed Composer's eyebrow row — a live copy of the commission
 * marker's eyebrow (`GoalRunMarkers.tsx`): `Target + GOAL` on the left,
 * the one parameter the operator sets (the ceiling) on the right. The
 * draft below it is literally what the marker will show once Enter
 * lands, so this row is the launch preview the deleted confirm dialog
 * used to be (ticket 09).
 *
 * The ceiling pill opens a timer-style wheel (ticket 10): the ceiling
 * is a quantity that often maps to an external deadline, and on the
 * live app the snap wheel beat both a six-preset menu and a stepper
 * pill. What the ceiling means lives in the pill's tooltip — any
 * sentence inside the popover would set its width.
 */
export function ComposerGoalEyebrow({
  budgetMinutes,
  disabled,
  onBudgetMinutesChange,
}: ComposerGoalEyebrowProps) {
  const copy = useCopy();
  const conv = copy.conversation;
  const pillLabel =
    budgetMinutes !== null
      ? conv.goalBudgetCeiling(budgetMinutes)
      : conv.goalNoBudget;

  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-brand-strong">
        <Target size={12} weight="bold" />
        {conv.goalEyebrow}
      </span>
      <Popover.Root>
        <TooltipLabel text={copy.composer.goalCeilingTooltip}>
          <Popover.Trigger asChild>
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={preventMouseFocus}
              disabled={disabled}
              aria-label={copy.composer.goalCeilingLabel}
              className={cn(
                "ml-auto inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] tabular-nums text-ink-muted outline-none",
                "transition-none hover:bg-elevated hover:text-ink",
                "data-[state=open]:bg-elevated data-[state=open]:text-ink",
                "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
              )}
            >
              <span>{pillLabel}</span>
              {/* Points where the popover opens (up, like LLMPill's). */}
              <CaretUp size={10} weight="thin" className="text-ink-muted" />
            </button>
          </Popover.Trigger>
        </TooltipLabel>
        <Popover.Portal>
          <Popover.Content
            align="end"
            side="top"
            sideOffset={6}
            onOpenAutoFocus={(event) => {
              // Sibling-popover convention (LLMPill): nothing inside is
              // tabbable, so Radix's open autofocus would land on the
              // container and WebKit would ring the whole popover.
              event.preventDefault();
            }}
            className="galley-pop-in z-50 rounded-md border border-line bg-elevated p-1 shadow-elevated outline-none"
          >
            <GoalCeilingWheel
              value={budgetMinutes}
              onChange={onBudgetMinutesChange}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
