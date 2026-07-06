import {
  ArrowsInLineHorizontal,
  ArrowsOutLineHorizontal,
} from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";

import { TopBarIconButton } from "../TopBarIconButton";

/**
 * Conversation width toggle.
 *
 * Icon direction expresses the action (expand while compact, collapse
 * while wide) — that flip is the only state on the button face; the
 * wide mode gets no persistent tint. Tooltip and aria-label carry the
 * text so this stays a light topbar tool instead of a status pill.
 */
export function WidthToggleButton({
  mode,
  onToggle,
}: {
  mode: "compact" | "wide";
  onToggle?: () => void;
}) {
  const copy = useCopy();
  const isWide = mode === "wide";
  const tooltip = isWide
    ? copy.topbar.compactWidthTitle
    : copy.topbar.wideWidthTitle;
  return (
    <TooltipLabel text={tooltip}>
      <TopBarIconButton
        onClick={onToggle}
        aria-label={isWide ? copy.topbar.compactWidth : copy.topbar.wideWidth}
      >
        {/* 14px, not the cluster's usual 16px: the wide horizontal
            arrows read optically larger than the compact TextAa /
            sun / gear glyphs; the smaller box makes the four utility
            buttons weigh the same to the eye. */}
        {isWide ? (
          <ArrowsInLineHorizontal size={14} weight="thin" />
        ) : (
          <ArrowsOutLineHorizontal size={14} weight="thin" />
        )}
      </TopBarIconButton>
    </TooltipLabel>
  );
}
