import { Pause } from "@phosphor-icons/react";

import { useCopy } from "@/lib/i18n";

/**
 * Thread tail for a run GA stopped at its per-run step cap (#29). It is
 * a recoverable state, so — like GoalPausedTail, whose visual language
 * this copies line for line (12px, ink-muted, the bold 12px Pause in
 * the leading slot) — it gets a "what now" line at the thread's end,
 * not a closing marker. Shown only while the session is idle (MainView
 * owns the predicate, `lib/step-limit.ts`); nothing is running, so
 * there is no stop control. The copy carries no number: plan mode's
 * cap differs, and the last step's numeral already says how far the
 * run got.
 */
export function StepLimitTail() {
  const conv = useCopy().conversation;
  return (
    <div className="my-5 text-[12px]">
      <div className="flex items-center gap-2 text-ink-muted">
        <Pause size={12} weight="bold" className="shrink-0" />
        <span>{conv.stepLimitTail}</span>
      </div>
    </div>
  );
}
