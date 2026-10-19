import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { IconTooltip, type TooltipSide } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { blurAfterClick, preventMouseFocus } from "@/lib/pointer-focus";

/**
 * Shared copy / save action chip for the conversation. One visual
 * vocabulary across the places a copy affordance appears.
 *
 * WHEN it shows (bar vs transient) and WHICH SKIN it wears are
 * two independent questions — conflating them is what put a bordered
 * box against a highlighter stroke until 2026-08-10.
 *
 *   - bar: in the reply action bar under an assistant answer
 *     (MessageActions), shown while that answer is hovered
 *     (2026-09-28; always visible until then).
 *   - transient: fades in on a user action — hovering a user message
 *     (MessageUser) or selecting assistant text (SelectionCopyToolbar).
 *
 * Skin is decided by WHAT IS BEHIND THE CHIP, not by its lifetime, and
 * the chip itself is always the bare one (`inline` in the design docs):
 * a muted glyph, a background only on hover. On clean canvas — the reply
 * bar, the row under a user message out in the margin — that is all it
 * wears; armour it does not need reads as a UI part intruding on the
 * content. Where chips land on top of arbitrary content and have to cut
 * themselves out of it (the portal'd selection toolbar, the one such
 * case), the armour is on the shell around them, worn once
 * (SelectionToolbarShell: solid `bg-elevated`, border, float shadow, no
 * glassmorphism; main chat PRD ruling 108). Until 2026-10-19 each
 * selection chip wore it (a `floating` variant), and two bordered boxes
 * beside a selection read as another family than the hover rows.
 *
 * Quiet tier of the button-press language (DESIGN.md §2.5): muted →
 * ink on hover, a crisp integer 1px press, success flips to a green
 * Check.
 *
 * Presentational only — callers own the copied / saved state and its
 * reset timer, and (for the hover row) the `revealed` flag.
 *
 * One chip is a disclosure, not a one-shot action: the assistant's
 * process button (`expanded`; conversation.md 「助手的对话」). Same size,
 * ink, hover ground and pointer-first focus as copy and save; open, it
 * holds the hover ground with the ink one rung up (the pressed look),
 * never the green Check, which means done.
 *
 * And one opens a menu: the ⋯ that ends the assistant's reply bar (main
 * chat ticket 38), a Radix menu trigger's child (`asChild`). For that the
 * chip takes a ref and passes the trigger's props on to its button; it
 * has no `onClick` of its own, and `expanded` is the menu open.
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
  /** The action; none for a menu trigger (the trigger's props open it). */
  onClick?: () => void;
  /**
   * Hover-reveal control for inline rows. When false the chip is
   * transparent + non-focusable but keeps its layout box, so revealing
   * it never shifts surrounding content.
   */
  revealed?: boolean;
  /** A disclosure chip: its `aria-expanded`, and the pressed look while
   * open. Undefined for copy / save. */
  expanded?: boolean;
  tooltipSide?: TooltipSide;
  className?: string;
}

/** A menu trigger's props (`asChild`), passed on to the button. */
type TriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  keyof ActionChipProps | "children"
>;

export const ActionChip = forwardRef<
  HTMLButtonElement,
  ActionChipProps & TriggerProps
>(function ActionChip(
  {
    active,
    idleIcon,
    activeIcon,
    idleLabel,
    activeLabel,
    onClick,
    revealed = true,
    expanded,
    tooltipSide,
    className,
    ...trigger
  },
  ref,
) {
  const label = active ? activeLabel : idleLabel;

  const button = (
    <button
      {...trigger}
      ref={ref}
      type="button"
      aria-label={label}
      aria-hidden={!revealed || undefined}
      aria-expanded={expanded}
      tabIndex={-1}
      // Every chip avoids mouse focus so hover-only UI doesn't stick
      // after a click, and a press keeps a selection where it is (the
      // selection toolbar's chips act on it).
      onMouseDown={preventMouseFocus}
      onClick={(event) => {
        onClick?.();
        blurAfterClick(event);
      }}
      className={cn(
        ACTION_CHIP_BASE,
        "size-6 border border-transparent",
        active
          ? "text-success"
          : expanded
            ? "bg-hover text-ink"
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
});
