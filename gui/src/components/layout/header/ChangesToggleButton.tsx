import { GitDiff } from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { TopBarIconButton } from "../TopBarIconButton";

/**
 * Header entry for the Git worktree review panel. Phosphor's GitDiff,
 * chosen on a live six-way comparison (2026-09-08): the panel's scope
 * is Git, so the Git-flavoured glyph is the honest one, and its two
 * nodes + connector carry the same visual weight as the round Sun /
 * Gear neighbours. The earlier hand-drawn file-with-plus/minus read as
 * "a note with two lines" at 16px, and ± sat too light in the cluster.
 */
export function ChangesToggleButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: (source: HTMLElement) => void;
}) {
  const copy = useCopy().gitReview;
  return (
    <TooltipLabel text={open ? copy.closeChanges : copy.openChanges}>
      <TopBarIconButton
        aria-label={copy.title}
        aria-pressed={open}
        // "Panel is open" is a selected state, not a hover: bg-selected
        // keeps it a different material from the pointer feedback around it
        // (the sidebar's selected-row lesson, 2026-08-21).
        className="aria-pressed:border-line aria-pressed:bg-selected aria-pressed:text-ink"
        onClick={(event) => onToggle(event.currentTarget)}
      >
        <GitDiff size={16} weight="thin" />
      </TopBarIconButton>
    </TooltipLabel>
  );
}
