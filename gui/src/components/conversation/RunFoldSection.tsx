import type { ReactNode } from "react";

import { ExpandSection } from "@/components/conversation/ExpandSection";
import { StepRegion } from "@/components/conversation/StepRegion";

/**
 * Animated container for a folded run's process section (everything
 * between the RunFoldHeader and the final answer body, the final
 * step's marker + StrongHr included). The motion itself — grid-rows
 * sweep, mount/unmount timing, reduced-motion fallback — lives in
 * ExpandSection; this wrapper owns only the fold-specific margin
 * choreography.
 *
 * DOM-economy cost, accepted knowingly: a run that completes while
 * expanded gets rewrapped from the flat render into this section, and
 * that remount re-initializes per-callout manual toggles made mid-run
 * (defaults re-derive identically, so only manual overrides are lost).
 *
 * The margin choreography (why `-mt-5.5 ↔ mt-0` animates with the
 * rows): a grid container is a BFC, so the first TurnMarker's mt-6
 * (24px) stops collapsing with the RunFoldHeader's mb-2.5 (10px) —
 * the naive wrapper shows 10+24=34px. The header→first-step gap is
 * 12px (2026-09-16 rhythm pass: the header is the list's handle and
 * hugs its list; 24px belongs to the run boundary above the header),
 * so the wrapper pulls 22px back. At 0fr the wrapper is an empty box
 * between header and answer, where keeping the negative margin would
 * eat the header's folded 10px hug — so the margin animates to 0
 * alongside the rows and both endpoints land seamlessly on the
 * flat/folded layouts. The bottom edge needs no counterpart: the
 * section ends with StrongHr (my-4, 16px) and the answer body opens
 * with a margin-less root, so BFC or not the gap is 16px either way.
 * Coupling: assumes RunFoldHeader (mb-2.5) directly precedes the
 * section and a TurnMarker (mt-6) opens it.
 *
 * Children render inside a StepRegion whose rail hangs from the
 * header (`railFrom="header"`), the settled twin of the live run's
 * flat region in Conversation.tsx.
 */
export function RunFoldSection({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  return (
    <ExpandSection open={open} openClassName="-mt-5.5" closedClassName="mt-0">
      <StepRegion railFrom="header">{children}</StepRegion>
    </ExpandSection>
  );
}
