import type { Icon } from "@phosphor-icons/react";

/**
 * Status-cluster "lamp" (macOS menu-bar grammar): the state is drawn in
 * the glyph itself, monochrome, in the same ink as every other topbar
 * icon. Lit = a live connection right now: the 16px thin outline over a
 * soft fill of the same shape. Unlit = the thin outline alone.
 *
 * The fill is the Phosphor `fill` weight of the same icon, stacked under
 * the `thin` weight in one box. Not `duotone`: that weight draws its
 * outline at regular stroke width, visibly heavier than the thin
 * neighbours. The fill is `currentColor` mixed down to
 * `--opacity-medium` — 20% on the light canvas, 28% on the dark one,
 * the token ramp's own lift for dark grounds that swallow low alpha
 * (a single 22% was clear in light but faint in dark; 28%+ turned into a
 * grey blob in light). Following the ink, it darkens with the outline on
 * hover. It stays well away from a pressed look: a pressed / open
 * trigger is a button-sized `bg-hover` plate with a press shadow, a
 * different material from a tint confined to the glyph's silhouette. No
 * transition between the two states — healthy state changes carry no
 * motion.
 */
export function TopBarLampIcon({
  icon: Glyph,
  lit,
}: {
  icon: Icon;
  lit: boolean;
}) {
  return (
    <span aria-hidden className="relative inline-flex size-4 shrink-0">
      {lit && (
        <Glyph
          size={16}
          weight="fill"
          className="absolute inset-0 text-current/[var(--opacity-medium)]"
        />
      )}
      <Glyph size={16} weight="thin" className="relative" />
    </span>
  );
}
