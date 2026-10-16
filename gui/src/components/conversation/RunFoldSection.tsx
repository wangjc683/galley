import { ExpandSection } from "@/components/conversation/ExpandSection";
import {
  ProcessCard,
  type ProcessCardStep,
} from "@/components/conversation/ProcessCard";

/**
 * What a run's fold header opens (workbench conversation PRD ruling 6,
 * 2026-10-16): the run's steps one line a step, in the process card the
 * assistant opens too (ProcessCard) — no numbers line (the header right
 * above says the steps, the time and the tool mix), no row cap and no
 * scroll inside (reading the process is the work here), as wide as the
 * column, as the answer under it is. The settled header and the live
 * one (「已完成 N 步」) open the same section under the same key, so a
 * run opened while live settles open without remounting: its rows stay
 * and the steps that settle join them.
 *
 * Opens and closes as ExpandSection sweeps. Spacing: the header's own
 * mb-2.5 above the card, its hug for whatever is under it (the answer,
 * when closed); 16px of its own under the card, inside the sweep, so it
 * opens and closes with it: the answer starts as far under the card as
 * it started under the StrongHr the old step region ended with (my-4).
 * No StrongHr here: the card's edge already parts the action from the
 * conclusion, and a full-width rule under it would be a second line.
 * Nothing to show (every step behind the header only asked) opens
 * nothing.
 */
export function RunFoldSection({
  open,
  steps,
}: {
  open: boolean;
  /** The steps with a row (lib/run-fold-plan.ts), keyed by their turn's
   * place. */
  steps: ProcessCardStep[];
}) {
  return (
    <ExpandSection open={open}>
      {steps.length > 0 && (
        <div className="pb-4">
          <ProcessCard steps={steps} />
        </div>
      )}
    </ExpandSection>
  );
}
