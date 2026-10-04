import type { Icon } from "@phosphor-icons/react";

/**
 * Status-cluster "lamp" (macOS menu-bar grammar, like Bluetooth turned
 * off): the state is drawn in the glyph itself, monochrome, in the same
 * ink as every other topbar icon. Lit = a live connection right now: the
 * plain 16px thin glyph, identical to its neighbours. Unlit = the same
 * glyph at half opacity.
 *
 * Polarity on purpose (2026-10-04, live check): the healthy state is the
 * common one, so it blends into the row and only a dropped connection
 * deviates. The first version lit the glyph instead (a soft fill under
 * the thin outline) and on the real topbar the two filled icons read a
 * weight heavier than the thin row. Slash / X variants were rejected
 * (a slashed chat bubble reads as "notifications muted", and the puzzle
 * has none), so were an underline (invisible at 16px) and a heavier
 * stroke (still off-family). 50%, not lower, so the unlit glyph reads
 * as "off" rather than "disabled"; the button around it keeps its
 * normal hover plate, and the popover says what is off. No transition
 * between the two states — healthy state changes carry no motion.
 */
export function TopBarLampIcon({
  icon: Glyph,
  lit,
}: {
  icon: Icon;
  lit: boolean;
}) {
  return (
    <Glyph
      size={16}
      weight="thin"
      aria-hidden
      className={lit ? "shrink-0" : "shrink-0 opacity-50"}
    />
  );
}
