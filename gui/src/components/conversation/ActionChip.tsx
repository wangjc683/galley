import { type ReactNode } from "react";

import { IconTooltip, type TooltipSide } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { blurAfterClick, preventMouseFocus } from "@/lib/pointer-focus";

/**
 * Shared copy / save action chip for the conversation. One visual
 * vocabulary across the places a copy affordance appears.
 *
 * WHEN it shows (persistent vs transient) and WHICH SKIN it wears are
 * two independent questions — conflating them is what put a bordered
 * box against a highlighter stroke until 2026-08-10.
 *
 *   - persistent: always visible in the reply action bar under an
 *     assistant answer (MessageActions).
 *   - transient: fades in on a user action — hovering a user message
 *     (MessageUser) or selecting assistant text (SelectionCopyToolbar).
 *
 * Skin is decided by WHAT IS BEHIND THE CHIP, not by its lifetime:
 *
 *   - `floating` (border + solid `bg-elevated` + shadow): only when the
 *     chip lands on top of arbitrary content and has to cut itself out
 *     of it. The portal'd selection toolbar is the one such case.
 *   - `inline` (bare muted glyph, hover-only background): everywhere the
 *     chip sits on clean canvas — the reply bar, and a user message's
 *     hover chip out in the margin. Armour it does not need reads as a
 *     UI part intruding on the content.
 *
 * Quiet tier of the button-press language (DESIGN.md §2.5): muted →
 * ink on hover, a crisp integer 1px press, success flips to a green
 * Check. `floating` adds a firm bordered container (solid `bg-elevated`,
 * no glassmorphism) for the portal'd selection chip; `inline` is a
 * bare muted icon that lives in an action row.
 *
 * Presentational only — callers own the copied / saved state and its
 * reset timer, and (for the hover row) the `revealed` flag.
 */
const ACTION_CHIP_BASE = cn(
  "inline-flex select-none items-center justify-center rounded-sm",
  "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm",
  "active:translate-y-px outline-none",
);

export interface ActionChipProps {
  /** Success state — flips the glyph to the active icon + success color. */
  active: boolean;
  idleIcon: ReactNode;
  activeIcon: ReactNode;
  idleLabel: string;
  activeLabel: string;
  onClick: () => void;
  variant?: "inline" | "floating";
  /**
   * Hover-reveal control for inline rows. When false the chip is
   * transparent + non-focusable but keeps its layout box, so revealing
   * it never shifts surrounding content.
   */
  revealed?: boolean;
  tooltipSide?: TooltipSide;
  className?: string;
}

export function ActionChip({
  active,
  idleIcon,
  activeIcon,
  idleLabel,
  activeLabel,
  onClick,
  variant = "inline",
  revealed = true,
  tooltipSide,
  className,
}: ActionChipProps) {
  const floating = variant === "floating";
  const label = active ? activeLabel : idleLabel;

  const button = (
    <button
      type="button"
      aria-label={label}
      aria-hidden={!revealed || undefined}
      tabIndex={-1}
      // Floating chip lives on a transient selection; every chip also
      // avoids mouse focus so hover-only UI doesn't stick after click.
      onMouseDown={preventMouseFocus}
      onClick={(event) => {
        onClick();
        blurAfterClick(event);
      }}
      className={cn(
        ACTION_CHIP_BASE,
        floating
          ? "size-7 border border-line bg-elevated shadow-[var(--shadow-float)] hover:border-line-strong"
          : "size-6 border border-transparent",
        active
          ? "text-success"
          : "text-ink-muted hover:bg-hover hover:text-ink-soft",
        !revealed && "pointer-events-none opacity-0",
        className,
      )}
    >
      {active ? activeIcon : idleIcon}
      <span className="sr-only" aria-live="polite">
        {label}
      </span>
    </button>
  );

  return (
    // Tooltip tracks the current state: hovering right after a copy
    // must read "已复制", not contradict the green check with "复制".
    <IconTooltip text={label} side={tooltipSide}>
      {button}
    </IconTooltip>
  );
}
