import * as Tooltip from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

/**
 * Project-wide tooltip primitive. Built on Radix Tooltip so we get
 * portal positioning (doesn't get clipped by ancestor `overflow:
 * hidden`), keyboard focus support, and proper ARIA wiring out of
 * the box — the native `title` attribute's 500–700ms delay is a
 * spec behaviour we can't tune, so Radix is the only path to a
 * "responsive" hover affordance.
 *
 * Pair this with a single `<Tooltip.Provider delayDuration={100}>`
 * at the app root (App.tsx). The default 100ms feels immediate
 * without flickering on quick mouse drift.
 *
 * Usage:
 *
 *   <TooltipLabel text="Copy">
 *     <button>...</button>
 *   </TooltipLabel>
 *
 * The child must be a single element that accepts ref/props
 * (Radix's `asChild` requirement). Wrap a fragment with a single
 * element if you're composing multiple things.
 *
 * Multi-line tooltips (`text` accepts a node): the ink step of a second
 * line encodes what KIND of thing it is, so don't normalize them.
 *
 *   - second line is a NOTE (defines/bounds the metric above, same every
 *     time, read once) → lowest step, `text-ink-muted`. The context
 *     meter's "不含系统提示与工具定义" is this.
 *   - second line is DATA (a number that moves every turn) → same weight
 *     as the first line. Dimming it says "skippable" about the very value
 *     the reader opened the tooltip to find.
 *
 * A tooltip whose extra line is conditional (present only sometimes) is
 * usually better kept on ONE line: a box that alternates between one and
 * two lines in the same spot reads as jitter. That is why the `↑` metric
 * appends its cache split inline instead of stacking it.
 */
export type TooltipSide = "top" | "right" | "bottom" | "left";

export interface TooltipLabelProps {
  /** Tooltip body text. */
  text: React.ReactNode;
  /** Placement relative to the trigger. Default "top". */
  side?: TooltipSide;
  /** Alignment along the trigger side. */
  align?: "start" | "center" | "end";
  sideOffset?: number;
  /** Offset along the align axis, e.g. to anchor near the pointer on a
   * tall trigger (the sidebar separator). */
  alignOffset?: number;
  contentClassName?: string;
  /** Per-instance override of the provider's default delay. Use
   * sparingly — consistent timing across the app is what makes the
   * tooltip system feel cohesive. */
  delay?: number;
  children: React.ReactNode;
}

export function TooltipLabel({
  text,
  side = "top",
  align = "center",
  sideOffset = 6,
  alignOffset,
  contentClassName,
  delay,
  children,
}: TooltipLabelProps) {
  const trigger = (
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
  );

  const content = (
    <Tooltip.Portal>
      <Tooltip.Content
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn(
          "z-[80] select-none rounded-sm border border-line bg-elevated px-2 py-1",
          "text-[11.5px] leading-none text-ink-soft shadow-elevated",
          contentClassName,
        )}
      >
        {text}
      </Tooltip.Content>
    </Tooltip.Portal>
  );

  // Per-instance delay nests a local Provider inside the app-root
  // one so the global default isn't disturbed. Most callers should
  // skip the prop and let the root setting govern.
  if (delay != null) {
    return (
      <Tooltip.Provider delayDuration={delay}>
        <Tooltip.Root>
          {trigger}
          {content}
        </Tooltip.Root>
      </Tooltip.Provider>
    );
  }

  return (
    <Tooltip.Root>
      {trigger}
      {content}
    </Tooltip.Root>
  );
}

export const IconTooltip = TooltipLabel;
