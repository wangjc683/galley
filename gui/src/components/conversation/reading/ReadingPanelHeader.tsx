import type { ReactNode } from "react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * One header grammar for the right-hand reading panel, whatever it is
 * showing (Markdown preview, Git review): title, optional subtitle with
 * a tooltip carrying the full value, a right-aligned action group, and
 * the close control the host supplies (IconButton in the wide pane,
 * DialogCloseButton in the narrow-window dialog). The panels used to
 * grow their own headers at different densities; keeping the shell here
 * means the two views read as the same surface.
 */
export function ReadingPanelHeader({
  title,
  subtitle,
  subtitleTooltip,
  subtitleMono = false,
  actions,
  close,
}: {
  title: string;
  subtitle?: string;
  subtitleTooltip?: string;
  /** Paths and ids read better in the mono register; prose subtitles
   * (baseline descriptions) stay in sans. */
  subtitleMono?: boolean;
  actions?: ReactNode;
  close?: ReactNode;
}) {
  const subtitleNode = subtitle && (
    <span
      className={cn(
        "truncate text-ink-muted",
        subtitleMono ? "font-mono text-[11px]" : "text-ui-tertiary",
      )}
    >
      {subtitle}
    </span>
  );
  return (
    <div className="flex items-start gap-1 border-b border-line px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-ink">{title}</span>
        {subtitleNode &&
          (subtitleTooltip ? (
            <TooltipLabel text={subtitleTooltip}>{subtitleNode}</TooltipLabel>
          ) : (
            subtitleNode
          ))}
      </div>
      {actions}
      {close}
    </div>
  );
}
