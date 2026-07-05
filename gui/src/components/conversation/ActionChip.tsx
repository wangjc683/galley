import { type ReactNode } from "react";

import { IconTooltip, type TooltipSide } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { blurAfterClick, preventMouseFocus } from "@/lib/pointer-focus";

/**
 * Shared copy / save action chip for the conversation. One visual
 * vocabulary across the places a copy affordance appears, organized by
 * kind:
 *
 *   - persistent: the reply action bar under an assistant answer
 *     (MessageActions) — bare `inline` chips, always visible.
 *   - transient: a `floating` chip that surfaces on a user action —
 *     beside an assistant text selection (SelectionCopyToolbar), or at
 *     a user message's top-right on hover (MessageUser).
 *
 * Single rule: persistent actions live in the reply bar; transient
 * copy is a floating chip that fades in by the content it acts on.
 * Same chip skin throughout.
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
  "transition-[background-color,border-color,color,box-shadow,transform]",
  "duration-[140ms] ease-[cubic-bezier(0.2,0,0,1)] active:duration-[70ms]",
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
