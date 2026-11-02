import { memo, type RefObject } from "react";

import { useFloatingDay } from "@/hooks/useFloatingDay";
import { cn } from "@/lib/utils";

/**
 * The main chat's floating day (main chat PRD ruling 171, ticket 124):
 * scrolling back, a capsule at the top of the conversation area says
 * which day the top of the viewport is on — 昨天, 10月28日 — and fades
 * a second after you stop (when and what: useFloatingDay).
 *
 * Top centre, 12px under the area's top edge, mirroring 「回到底部」 at
 * the bottom centre, in that button's material: the elevated ground at
 * 92% with its blur, the 1px line, the float shadow. A time line
 * between two messages has no chip behind it (MessageTimeDivider); this
 * one floats over bubbles as they scroll past and would not read
 * without one. 24px tall, 10px either side, 12px ink-soft tabular
 * figures on one line.
 *
 * Only its opacity moves: in at `--motion-fast`, out at
 * `--motion-slow`; no slide, no scale, so reduced motion keeps it as it
 * is (foundations §2.7, 只淡不移). Not a control: no pointer, no focus,
 * hidden from screen readers — the time lines in the conversation are
 * still read out. Mounted from the start, empty and transparent, so its
 * first appearance fades in too.
 */
export const FloatingDay = memo(function FloatingDay({
  scrollContainerRef,
  atBottom,
}: {
  /** The main chat's scroll container (useStickyScroll's). */
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** useStickyScroll's `atBottom`: following the bottom, when the
   * scrolls are Galley's own. */
  atBottom: boolean;
}) {
  const { text, shown } = useFloatingDay({ scrollContainerRef, atBottom });
  return (
    <div
      aria-hidden="true"
      data-role="floating-day"
      className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center"
    >
      <div
        data-shown={shown || undefined}
        className={cn(
          "flex h-6 items-center rounded-full border border-line bg-elevated/92 px-2.5 shadow-[var(--shadow-float)] backdrop-blur-md",
          "text-ui-meta leading-none whitespace-nowrap text-ink-soft tabular-nums select-none",
          "transition-opacity",
          shown
            ? "opacity-100 duration-(--motion-fast) ease-firm"
            : "opacity-0 duration-(--motion-slow) ease-exit",
        )}
      >
        {text}
      </div>
    </div>
  );
});
