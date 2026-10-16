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
 *    the region's full height: the live window's rail hangs from its
 *    header, a live run's rail starts at its first step (no header
 *    exists yet) and reads as "process in progress".
 *
 * The final answer never lives in here — it stays full width after
 * the StrongHr, which breaks out of the inset via its own negative
 * margin. Since 2026-10-16 (workbench conversation PRD ruling 6) a
 * settled run's steps behind its fold header are no region but one
 * line a step in a card (RunFoldSection); regions are what is not
 * behind a header — the live window, MainView's in-flight row, and a
 * run drawn flat in full (no answer, /btw).
 *
 * `railFrom="header"` pulls the rail top up 10px into the gap above
 * the region (the region's top edge is the first marker's border
 * edge, its mt-* having collapsed through); "content" starts the rail
 * at that edge. The 10px covers both gaps a region can follow: the
 * fold header's hug (mb-2.5) and the in-run step gap (mt-2.5), so the
 * live window region and MainView's in-flight region use it too and
 * the rail reads as one line from the header down to the thinking
 * row (live-run-window PRD, 2026-09-16). "step" starts it 10px down,
 * at the first step of a region that carries the in-run gap as its own
 * top padding (pt-2.5): the live window under its open header, where
 * the card of the folded steps sits between the two (workbench
 * conversation PRD ruling 6) and is no line for the rail to hang from.
 */
export function StepRegion({
  children,
  railFrom = "content",
  className,
}: {
  children: ReactNode;
  railFrom?: "header" | "content" | "step";
  className?: string;
}) {
  return (
    <div className={cn("relative pl-(--step-gutter)", className)}>
      <div
        aria-hidden
        className={cn(
          "absolute bottom-0 left-[5px] w-px bg-line",
          railFrom === "header"
            ? "-top-2.5"
            : railFrom === "step"
              ? "top-2.5"
              : "top-0",
        )}
      />
      {children}
    </div>
  );
}
