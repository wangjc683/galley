import * as Dialog from "@radix-ui/react-dialog";
import { Target } from "@phosphor-icons/react";
import { useState } from "react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  DEFAULT_GOAL_BUDGET_PRESET,
  GOAL_BUDGET_PRESET_MINUTES,
  GOAL_CUSTOM_BUDGET_MIN_MINUTES,
  resolveGoalBudgetSeconds,
  type GoalBudgetPreset,
} from "@/lib/goals";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { GoalLaunchConfig } from "@/types/goal";

/**
 * Goal launch confirmation — the modal that turns the composer draft
 * into a Goal. Two things only: the objective it read back, and the
 * time ceiling. The body copy carries the new-user briefing the deleted
 * launch-narration row used to (PRD §6 裁决 6): Galley advances on its
 * own until it judges the objective done or the ceiling arrives, and
 * you can steer or stop at any point.
 *
 * The ceiling row is bare numerals with the unit hoisted into the
 * section label: seven segments with "15 分钟 … 240 分钟" spelled out
 * overflow a 440px dialog, and the full phrasing survives as each
 * segment's tooltip (which is also where "推荐" lives).
 *
 * Keyed per-objective by the caller so it resets cleanly between
 * launches.
 */
export function GoalConfirmDialog({
  open,
  objective,
  submitting,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  objective: string;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (config: GoalLaunchConfig) => void;
}) {
  const copy = useCopy();
  const [budgetPreset, setBudgetPreset] = useState<GoalBudgetPreset>(
    DEFAULT_GOAL_BUDGET_PRESET,
  );
  const [customMinutes, setCustomMinutes] = useState("");

  // `null` = no ceiling; Core reads the absent budget as "run until the
  // model says done or the user stops". `undefined` = the custom field
  // is empty / below the floor, which is what disables Send.
  const budgetSeconds = resolveGoalBudgetSeconds(budgetPreset, customMinutes);
  const budgetReady = budgetSeconds !== undefined;

  const durationOptions: {
    value: GoalBudgetPreset;
    label: string;
    title?: string;
    disabled: boolean;
  }[] = [
    ...GOAL_BUDGET_PRESET_MINUTES.map((minutes) => ({
      value: `${minutes}` as GoalBudgetPreset,
      label: `${minutes}`,
      title:
        `${minutes}` === DEFAULT_GOAL_BUDGET_PRESET
          ? copy.composer.goalDurationRecommendedTip(minutes)
          : copy.composer.goalDurationOption(minutes),
      disabled: submitting,
    })),
    {
      value: "none",
      label: copy.composer.goalDurationNoCeiling,
      disabled: submitting,
    },
    {
      value: "custom",
      label: copy.composer.goalDurationCustom,
      disabled: submitting,
    },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2",
            "max-w-[calc(100vw-32px)] rounded-lg border border-line bg-elevated p-5 shadow-elevated",
          )}
        >
          <Dialog.Title className="text-[16px] font-semibold text-ink">
            {copy.composer.goalConfirmTitle}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
            {copy.composer.goalConfirmBody}
          </Dialog.Description>

          <div className="mt-4 space-y-4">
            <section className="rounded-md border border-line bg-app px-3 py-2.5">
              <div className="text-[11px] font-medium text-ink-muted">
                {copy.composer.goalConfirmObjective}
              </div>
              <div className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-[13px] font-medium leading-relaxed text-ink">
                {objective}
              </div>
            </section>

            <section className="space-y-2">
              <div className="text-[12px] font-medium text-ink-soft">
                {copy.composer.goalConfirmCeiling}
              </div>
              <SegmentedControl<GoalBudgetPreset>
                value={budgetPreset}
                onValueChange={setBudgetPreset}
                options={durationOptions}
                ariaLabel={copy.composer.goalConfirmCeiling}
                size="md"
                className="flex max-w-full flex-wrap"
              />
              {budgetPreset === "custom" && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={GOAL_CUSTOM_BUDGET_MIN_MINUTES}
                    step={1}
                    autoFocus
                    disabled={submitting}
                    value={customMinutes}
                    placeholder={copy.composer.goalCustomMinutesPlaceholder}
                    aria-label={copy.composer.goalCustomMinutesLabel}
                    onChange={(event) =>
                      setCustomMinutes(event.currentTarget.value)
                    }
                    className={cn(
                      "w-24 rounded-sm border border-line bg-surface px-2.5 py-1.5 text-[12.5px] tabular-nums text-ink outline-none",
                      "transition-colors duration-(--motion-fast) ease-firm",
                      "placeholder:text-ink-muted/70 focus:border-brand focus:ring-[3px] focus:ring-brand/20",
                      "disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                  />
                  <span
                    className={cn(
                      "text-[11px] leading-snug",
                      budgetReady ? "text-ink-muted" : "text-ink-soft",
                    )}
                  >
                    {copy.composer.goalCustomMinutesHint(
                      GOAL_CUSTOM_BUDGET_MIN_MINUTES,
                    )}
                  </span>
                </div>
              )}
              {budgetPreset === "none" && (
                <div className="text-[11px] leading-snug text-ink-muted">
                  {copy.composer.goalNoCeilingHint}
                </div>
              )}
            </section>
          </div>

          <DialogActionRow>
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {copy.common.cancel}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (budgetSeconds === undefined) return;
                onConfirm({ budgetSeconds });
              }}
              disabled={submitting || !objective || !budgetReady}
              leadingIcon={<Target size={13} weight="fill" />}
            >
              {submitting
                ? copy.composer.goalStarting
                : copy.composer.startGoal}
            </Button>
          </DialogActionRow>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
