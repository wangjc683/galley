import * as Dialog from "@radix-ui/react-dialog";
import { Target } from "@phosphor-icons/react";
import { useState } from "react";

import { Button, DialogActionRow } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { GoalLaunchConfig, GoalMode } from "@/types/goal";

const DEFAULT_GOAL_BUDGET_MINUTES = 30;
const MIN_CUSTOM_GOAL_BUDGET_MINUTES = 5;
const MAX_CUSTOM_GOAL_BUDGET_MINUTES = 120;
const DEFAULT_GOAL_AGENT_COUNT = 3;
// Below this budget, the hive engine spends most of its time on spin-up and
// coordination rather than the work — so the multi-viewpoint option is gated
// off and the run falls back to solo. See .scratch/goal-solo-hive/PRD.md D2.
const HIVE_MIN_BUDGET_MINUTES = 10;
type GoalBudgetPreset = "15" | "30" | "60" | "custom";
type GoalAgentCountPreset = "2" | "3" | "4" | "5";

/**
 * Goal launch confirmation — the modal that turns the composer draft
 * into a Goal. Owns the budget (duration) + agent-count presets and the
 * custom-minutes validation; the composer only opens it with the
 * objective text and receives the resolved `GoalLaunchConfig` back via
 * `onConfirm`. Keyed per-objective by the caller so it resets cleanly
 * between launches.
 */
export function GoalConfirmDialog({
  open,
  objective,
  projectName,
  submitting,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  objective: string;
  /** Project the Goal will run in; undefined = the backend creates a
   * fresh project for the run. Rendered as a one-line consequence so
   * where the run lands is never a silent decision. */
  projectName?: string;
  submitting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (config: GoalLaunchConfig) => void;
}) {
  const copy = useCopy();
  const [budgetPreset, setBudgetPreset] = useState<GoalBudgetPreset>(
    String(DEFAULT_GOAL_BUDGET_MINUTES) as GoalBudgetPreset,
  );
  const [agentCountPreset, setAgentCountPreset] =
    useState<GoalAgentCountPreset>(
      String(DEFAULT_GOAL_AGENT_COUNT) as GoalAgentCountPreset,
    );
  const [customBudgetMinutes, setCustomBudgetMinutes] = useState(
    String(DEFAULT_GOAL_BUDGET_MINUTES),
  );
  // Solo is the product default; hive is a deliberate opt-in (a secondary,
  // outcome-labeled control), not a peer choice presented up front.
  const [mode, setMode] = useState<GoalMode>("solo");

  const customBudgetNumber = Number.parseInt(customBudgetMinutes, 10);
  const customBudgetValid =
    budgetPreset !== "custom" ||
    (Number.isInteger(customBudgetNumber) &&
      customBudgetNumber >= MIN_CUSTOM_GOAL_BUDGET_MINUTES &&
      customBudgetNumber <= MAX_CUSTOM_GOAL_BUDGET_MINUTES);
  const budgetMinutes =
    budgetPreset === "custom"
      ? customBudgetValid
        ? customBudgetNumber
        : DEFAULT_GOAL_BUDGET_MINUTES
      : Number.parseInt(budgetPreset, 10);
  const workerLimit = Number.parseInt(agentCountPreset, 10);
  const hiveAllowed = budgetMinutes >= HIVE_MIN_BUDGET_MINUTES;
  // A budget too small for hive silently falls back to solo so the run never
  // burns its whole budget on coordination — see HIVE_MIN_BUDGET_MINUTES.
  const effectiveMode: GoalMode =
    mode === "hive" && hiveAllowed ? "hive" : "solo";
  const disabledDurationOptions: {
    value: GoalBudgetPreset;
    label: string;
    disabled: boolean;
  }[] = [
    {
      value: "15",
      label: copy.composer.goalDurationFast,
      disabled: submitting,
    },
    {
      value: "30",
      label: copy.composer.goalDurationRecommended,
      disabled: submitting,
    },
    {
      value: "60",
      label: copy.composer.goalDurationDeep,
      disabled: submitting,
    },
    {
      value: "custom",
      label: copy.composer.goalDurationCustom,
      disabled: submitting,
    },
  ];
  const disabledAgentCountOptions: {
    value: GoalAgentCountPreset;
    label: string;
    disabled: boolean;
  }[] = [
    {
      value: "2",
      label: "2",
      disabled: submitting,
    },
    {
      value: "3",
      label: "3",
      disabled: submitting,
    },
    {
      value: "4",
      label: "4",
      disabled: submitting,
    },
    {
      value: "5",
      label: "5",
      disabled: submitting,
    },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2",
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
              <div className="mt-1.5 text-[11.5px] text-ink-muted">
                {projectName
                  ? copy.composer.goalRunInProject(projectName)
                  : effectiveMode === "hive"
                    ? copy.composer.goalRunNewProject
                    : copy.composer.goalRunHere}
              </div>
            </section>

            <section className="space-y-2">
              <div className="text-[12px] font-medium text-ink-soft">
                {copy.composer.goalConfirmDuration}
              </div>
              <SegmentedControl<GoalBudgetPreset>
                value={budgetPreset}
                onValueChange={setBudgetPreset}
                options={disabledDurationOptions}
                ariaLabel={copy.composer.goalConfirmDuration}
                size="md"
                className="max-w-full"
              />
              {budgetPreset === "custom" && (
                <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
                  <input
                    type="number"
                    min={MIN_CUSTOM_GOAL_BUDGET_MINUTES}
                    max={MAX_CUSTOM_GOAL_BUDGET_MINUTES}
                    step={1}
                    value={customBudgetMinutes}
                    onChange={(e) =>
                      setCustomBudgetMinutes(
                        e.target.value.replace(/[^\d]/g, "").slice(0, 3),
                      )
                    }
                    disabled={submitting}
                    aria-label={copy.composer.goalDurationCustomInput}
                    className={cn(
                      "h-8 w-20 rounded-sm border bg-app px-2 text-[12.5px] font-medium text-ink outline-none transition-colors duration-(--motion-fast) focus:border-brand focus:ring-2 focus:ring-brand/20",
                      customBudgetValid ? "border-line" : "border-error/40",
                    )}
                  />
                  <span>{copy.composer.goalDurationMinutes}</span>
                  {!customBudgetValid && (
                    <span className="text-[11px] text-error">
                      {copy.composer.goalDurationRange}
                    </span>
                  )}
                </label>
              )}
            </section>

            {effectiveMode === "solo" ? (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => setMode("hive")}
                  disabled={submitting || !hiveAllowed}
                  className={cn(
                    "self-start text-[12px] font-medium underline-offset-2",
                    hiveAllowed
                      ? "text-ink-muted hover:text-brand hover:underline"
                      : "cursor-not-allowed text-ink-muted/50",
                  )}
                >
                  {copy.composer.goalHiveToggle}
                </button>
                {!hiveAllowed && (
                  <span className="text-[11px] text-ink-muted">
                    {/* The user had opted into hive and the budget change
                        overrode that choice — say so explicitly instead of
                        the generic "toggle disabled" hint. */}
                    {mode === "hive"
                      ? copy.composer.goalHiveFallbackNotice(
                          HIVE_MIN_BUDGET_MINUTES,
                        )
                      : copy.composer.goalHiveBudgetHint(
                          HIVE_MIN_BUDGET_MINUTES,
                        )}
                  </span>
                )}
              </div>
            ) : (
              <section className="flex flex-col gap-2 rounded-md border border-line bg-app px-3 py-2.5">
                <div className="text-[12px] font-medium text-ink">
                  {copy.composer.goalHiveTitle}
                </div>
                <div className="text-[11.5px] leading-relaxed text-ink-muted">
                  {copy.composer.goalHiveDescription}
                </div>
                <div className="pt-1 text-[12px] font-medium text-ink-soft">
                  {copy.composer.goalHiveAgentCount}
                </div>
                <SegmentedControl<GoalAgentCountPreset>
                  value={agentCountPreset}
                  onValueChange={setAgentCountPreset}
                  options={disabledAgentCountOptions}
                  ariaLabel={copy.composer.goalHiveAgentCount}
                  size="md"
                  className="max-w-full"
                />
                <button
                  type="button"
                  onClick={() => setMode("solo")}
                  disabled={submitting}
                  className="self-start text-[11.5px] text-ink-muted underline-offset-2 hover:text-ink-soft hover:underline"
                >
                  {copy.composer.goalHiveBackToSolo}
                </button>
              </section>
            )}
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
              onClick={() =>
                onConfirm({
                  workerLimit,
                  budgetSeconds: budgetMinutes * 60,
                  mode: effectiveMode,
                })
              }
              disabled={submitting || !objective || !customBudgetValid}
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
