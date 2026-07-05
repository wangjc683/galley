import { ArrowRight, CaretDown, CaretRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared row idiom for the Runtime "更多" group. All three entries
 * (Setup Assistant, external GA, managed diagnostics) are whole-row
 * clickable headers inside one hairline-divided container; the
 * trailing glyph tells the row's behavior apart — caret expands in
 * place, arrow navigates away. Inner content stays borderless so the
 * list reads as one group instead of boxes inside a box.
 */

export function RuntimeAccordionRow({
  title,
  badge,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  /** Status chip next to the title — visible while collapsed, so state
   * (e.g. "external GA active") never hides inside the accordion. */
  badge?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors",
          "hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40",
        )}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-ui-secondary font-medium text-ink">
            {title}
          </span>
          {badge}
        </span>
        {expanded ? (
          <CaretDown size={12} weight="bold" className="shrink-0 text-ink-soft" />
        ) : (
          <CaretRight size={12} weight="bold" className="shrink-0 text-ink-soft" />
        )}
      </button>
      {expanded && <div className="px-3 pb-4 pt-2">{children}</div>}
    </div>
  );
}

export function RuntimeNavRow({
  title,
  subtitle,
  disabled = false,
  onOpen,
}: {
  title: string;
  subtitle?: ReactNode;
  disabled?: boolean;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      className={cn(
        "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40",
        disabled ? "cursor-not-allowed opacity-60" : "hover:bg-hover",
      )}
    >
      <span className="min-w-0">
        <span className="block text-ui-secondary font-medium text-ink">
          {title}
        </span>
        {subtitle && (
          <span className="mt-0.5 block text-ui-tertiary leading-[1.5] text-ink-muted">
            {subtitle}
          </span>
        )}
      </span>
      <ArrowRight size={12} weight="bold" className="shrink-0 text-ink-soft" />
    </button>
  );
}
