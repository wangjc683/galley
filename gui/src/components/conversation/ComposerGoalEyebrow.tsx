import * as Popover from "@radix-ui/react-popover";
import { CaretDown, Check, Target } from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import {
  DEFAULT_GOAL_BUDGET_PRESET,
  GOAL_BUDGET_PRESETS,
  goalBudgetPresetMinutes,
  type GoalBudgetPreset,
} from "@/lib/goals";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";

interface ComposerGoalEyebrowProps {
  budgetPreset: GoalBudgetPreset;
  disabled: boolean;
  onBudgetPresetChange: (preset: GoalBudgetPreset) => void;
}

/**
 * The armed Composer's eyebrow row — a live copy of the commission
 * marker's eyebrow (`GoalRunMarkers.tsx`): `Target + GOAL` on the left,
 * the one parameter the operator sets (the ceiling) on the right. The
 * draft below it is literally what the marker will show once Enter
 * lands, so this row is the launch preview the deleted confirm dialog
 * used to be (ticket 09).
 *
 * The ceiling is a pill that opens a content-width menu: the five
 * presets + "no ceiling", nothing else. What the ceiling means lives in
 * the pill's tooltip (everyone hovers before they click), because any
 * sentence inside the popover set its width — and the "you can steer
 * or stop" briefing is gone entirely: the running state teaches that
 * itself (top-bar stop, paused / blocked tails).
 */
export function ComposerGoalEyebrow({
  budgetPreset,
  disabled,
  onBudgetPresetChange,
}: ComposerGoalEyebrowProps) {
  const copy = useCopy();
  const conv = copy.conversation;
  const minutes = goalBudgetPresetMinutes(budgetPreset);
  const pillLabel =
    minutes != null ? conv.goalBudgetCeiling(minutes) : conv.goalNoBudget;

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
              <CaretDown size={10} weight="thin" className="text-ink-muted" />
            </button>
          </Popover.Trigger>
        </TooltipLabel>
        <Popover.Portal>
          <Popover.Content
            align="end"
            side="top"
            sideOffset={6}
            onOpenAutoFocus={(event) => {
              // Sibling-popover convention (LLMPill): every row is
              // tabIndex={-1}, so Radix's open autofocus would land on
              // the container and WebKit would ring the whole popover.
              event.preventDefault();
            }}
            className={cn(
              "galley-pop-in z-50 rounded-md border border-line bg-elevated p-1 shadow-elevated outline-none",
            )}
          >
            {GOAL_BUDGET_PRESETS.map((preset) => {
              const selected = preset === budgetPreset;
              const presetMinutes = goalBudgetPresetMinutes(preset);
              const label =
                presetMinutes != null
                  ? copy.composer.goalDurationOption(presetMinutes)
                  : copy.composer.goalDurationNoCeiling;
              return (
                <Popover.Close asChild key={preset}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={preventMouseFocus}
                    onClick={() => onBudgetPresetChange(preset)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2 rounded-callout px-2.5 py-1.5 text-left text-[12.5px] hover:bg-hover",
                      selected ? "text-ink" : "text-ink-soft",
                    )}
                  >
                    <span className="flex w-3.5 shrink-0 items-center justify-center">
                      {selected && (
                        <Check
                          size={12}
                          weight="bold"
                          className="text-brand-strong"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-nowrap tabular-nums">
                      {label}
                    </span>
                    {preset === DEFAULT_GOAL_BUDGET_PRESET && (
                      <span className="ml-3 shrink-0 text-[10.5px] text-ink-muted">
                        {copy.composer.goalDurationRecommended}
                      </span>
                    )}
                  </button>
                </Popover.Close>
              );
            })}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
