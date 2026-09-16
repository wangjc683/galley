import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** --motion-slow (240ms) + settle margin. The unmount timer is the
 * single authority on when a closed section leaves the DOM; a
 * transitionend listener would be more precise but silently never
 * fires under `motion-reduce:transition-none`, and an extra ~60ms of
 * invisible (0fr) DOM is free. */
const UNMOUNT_DELAY_MS = 300;

/**
 * Animated disclosure container shared by the conversation's
 * expand/collapse surfaces (RunFoldSection, TurnMarker's DetailPanel).
 * Expand/collapse is an A-class interaction (§2.7: user-triggered,
 * start and end), so it gets real motion: the
 * `grid-template-rows: 0fr ↔ 1fr` transition — the CSS idiom for
 * animating height:auto — with opacity riding along. A CSS
 * transition, not a keyframe, per polish-checklist P9: toggles must
 * be interruptible and reversible mid-flight, and this one is
 * (flipping `open` mid-sweep reverses from the current position).
 * One duration token (`--motion-slow`) for every site so the process
 * area has a single "expand" feel.
 *
 * DOM economy: closed sections render nothing. Children mount when
 * opening and unmount UNMOUNT_DELAY_MS after closing starts, so a
 * long session keeps its dozens of settled disclosures out of the DOM.
 *
 * `openClassName` / `closedClassName` let a caller animate a margin
 * alongside the rows (RunFoldSection's margin-collapse choreography);
 * the transition property list already includes `margin-top`.
 */
export function ExpandSection({
  open,
  children,
  openClassName,
  closedClassName,
}: {
  open: boolean;
  children: ReactNode;
  openClassName?: string;
  closedClassName?: string;
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
          ? cn("grid-rows-[1fr] opacity-100", openClassName)
          : cn("grid-rows-[0fr] opacity-0", closedClassName),
      )}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}
