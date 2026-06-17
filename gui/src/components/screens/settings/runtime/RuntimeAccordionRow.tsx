import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared row idiom for the Runtime "更多" group. The three entries
 * (Setup Assistant, external GA, managed diagnostics) used to be three
 * different shapes — two floaty ghost-link carets plus an always-open
 * card. They now share one hairline-divided container with consistent
 * row headers: expandable rows carry a caret, action rows carry a
 * trailing control. Inner content stays borderless so the list reads
 * as one group instead of boxes inside a box.
 */

export function RuntimeAccordionRow({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
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
        <span className="text-[12.5px] font-medium text-ink">{title}</span>
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

export function RuntimeActionRow({
  title,
  subtitle,
  trailing,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  trailing: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-[220px] flex-1">
        <div className="text-[12.5px] font-medium text-ink">{title}</div>
        {subtitle && (
          <div className="mt-0.5 text-[11.5px] leading-[1.5] text-ink-muted">
            {subtitle}
          </div>
        )}
      </div>
      {trailing}
    </div>
  );
}
