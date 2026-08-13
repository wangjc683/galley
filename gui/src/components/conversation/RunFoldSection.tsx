import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** --motion-slow (240ms) + settle margin. The unmount timer is the
 * single authority on when a closed section leaves the DOM; a
 * transitionend listener would be more precise but silently never
 * fires under `motion-reduce:transition-none`, and an extra ~60ms of
 * invisible (0fr) DOM is free. */
const UNMOUNT_DELAY_MS = 300;

/**
 * Animated container for a folded run's process section (everything
 * between the RunFoldHeader and the final answer body, the final
 * step's marker + StrongHr included). Expand/collapse is an A-class
 * interaction (§2.7: user-triggered, start and end), so it gets real
 * motion: the `grid-template-rows: 0fr ↔ 1fr` transition — the CSS
 * idiom for animating height:auto — with opacity riding along.
 * A CSS transition, not a keyframe, per polish-checklist P9: toggles
 * must be interruptible and reversible mid-flight, and this one is
 * (flipping `open` mid-sweep reverses from the current position).
 *
 * DOM economy: closed sections render nothing, exactly like the
 * pre-animation fold (long sessions keep dozens of settled runs out
 * of the DOM). Children mount when opening and unmount UNMOUNT_DELAY_MS
 * after closing starts. The cost, accepted knowingly: a run that
 * completes while expanded gets rewrapped from the flat render into
 * this section, and that remount re-initializes per-callout manual
 * toggles made mid-run (defaults re-derive identically, so only
 * manual overrides are lost).
 *
 * The margin choreography (why `-mt-2.5 ↔ mt-0` animates with the
 * rows): a grid container is a BFC, so the first TurnMarker's mt-6
 * (24px) stops collapsing with the RunFoldHeader's mb-2.5 (10px) —
 * flat layout showed max(10,24)=24px, the naive wrapper shows
 * 10+24=34px. `-mt-2.5` on the wrapper sibling-collapses the header's
 * 10px away and restores exactly 24px while open. At 0fr the wrapper
 * is an empty box between header and answer, where keeping -10px
 * would eat the header's folded 10px hug — so the margin animates to
 * 0 alongside the rows and both endpoints land seamlessly on the
 * flat/folded layouts. The bottom edge needs no counterpart: the
 * section ends with StrongHr (my-4, 16px) and the answer body opens
 * with a margin-less root, so BFC or not the gap is 16px either way.
 * Coupling: assumes RunFoldHeader (mb-2.5) directly precedes the
 * section and a TurnMarker (mt-6) opens it.
 */
export function RunFoldSection({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);

  // Render-phase adjusts (React's sanctioned guarded setState-in-
  // render, same pattern as Conversation's keepOpener): opening must
  // mount the children in THIS render so the expand transition has a
  // committed 0fr state to start from; closing must flip to 0fr in
  // THIS render so the sweep starts immediately. The effect below
  // only schedules the async halves (the 1fr flip, the unmount).
  if (open && !mounted) setMounted(true);
  if (!open && expanded) setExpanded(false);

  useEffect(() => {
    if (open) {
      // Double rAF: the children must be committed at the 0fr state
      // and that state given a frame of its own before flipping to
      // 1fr — a single rAF can land in the same style pass and the
      // transition never runs.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setExpanded(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    const timer = window.setTimeout(() => setMounted(false), UNMOUNT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,margin-top,opacity] duration-(--motion-slow) ease-firm motion-reduce:transition-none",
        expanded
          ? "-mt-2.5 grid-rows-[1fr] opacity-100"
          : "mt-0 grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}
