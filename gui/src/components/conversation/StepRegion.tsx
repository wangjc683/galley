import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The process region of a run: everything the agent did between the
 * user's message and the final answer (step markers, tool rows and
 * cards, narration, ask_user echoes). Two jobs (conversation.md
 * TurnMarker section, 2026-09-16):
 *
 * 1. Inset the region one `--step-gutter` (24px) so step numerals sit
 *    to the RIGHT of the RunFoldHeader's text, not under its caret —
 *    the header is the handle, the steps are its subordinate list.
 *    Numerals then occupy 24–48 and step content starts at 48, the
 *    same proportions as the reference trace component this was
 *    modelled on.
 * 2. Draw a 1px rail at the header caret's centre (x = 5) that runs
 *    the region's full height: a settled run's rail hangs from the
 *    header, a live run's rail starts at its first step (no header
 *    exists yet) and reads as "process in progress".
 *
 * The final answer never lives in here — it stays full width after
 * the StrongHr, which breaks out of the inset via its own negative
 * margin. Applies to live and settled runs alike so nothing shifts
 * horizontally when a run completes and gets rewrapped into its
 * RunFoldSection.
 *
 * `railFrom="header"` pulls the rail top up 10px into the gap above
 * the region (the region's top edge is the first marker's border
 * edge, its mt-* having collapsed through); "content" starts the rail
 * at that edge. The 10px covers both gaps a region can follow: the
 * fold header's hug (mb-2.5) and the in-run step gap (mt-2.5), so the
 * live window region and MainView's in-flight region use it too and
 * the rail reads as one line from the header down to the thinking
 * row (live-run-window PRD, 2026-09-16).
 */
export function StepRegion({
  children,
  railFrom = "content",
  className,
}: {
  children: ReactNode;
  railFrom?: "header" | "content";
  className?: string;
}) {
  return (
    <div className={cn("relative pl-(--step-gutter)", className)}>
      <div
        aria-hidden
        className={cn(
          "absolute bottom-0 left-[5px] w-px bg-line",
          railFrom === "header" ? "-top-2.5" : "top-0",
        )}
      />
      {children}
    </div>
  );
}
