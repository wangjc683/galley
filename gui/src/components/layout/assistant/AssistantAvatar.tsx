import {
  Circle,
  CircleNotch,
  PauseCircle,
  XCircle,
} from "@phosphor-icons/react";

import type { AssistantStateKind } from "@/lib/assistant";
import { cn } from "@/lib/utils";

/** The disc's sizes: 20 in 方案 2's masthead button, 28 in the main
 * header's identity, 32 on 方案 3's card, 48 on 3′'s. */
export type AssistantAvatarSize = 20 | 28 | 32 | 48;

// The letter keeps the 28px disc's 17px (the old wordmark's size).
const DISC: Record<AssistantAvatarSize, string> = {
  20: "size-5 text-[12px]",
  28: "size-7 text-[17px]",
  32: "size-8 text-[19px]",
  48: "size-12 text-[29px]",
};

/**
 * The assistant's mark until it has a real likeness (main chat ticket
 * 17; first drawn for ticket 16): a brand-apricot disc carrying the
 * retired masthead wordmark's italic Newsreader 「G」, no image asset.
 * The letter is a deep shade of the same apricot rather than ink, so it
 * reads in both themes (brand stays light in dark mode, where ink turns
 * light). The italic leans right and the cap sits high: a nudge back
 * and down, in em so it scales with the disc, centres its ink (measured
 * on screen at 28px: one pixel back, two down).
 */
export function AssistantAvatar({
  size = 28,
  className,
}: {
  size?: AssistantAvatarSize;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-role="assistant-avatar"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-brand",
        "font-serif font-medium italic leading-none",
        "text-[color-mix(in_oklab,var(--color-brand)_22%,black)]",
        DISC[size],
        className,
      )}
    >
      <span className="translate-x-[-0.06em] translate-y-[0.12em]">G</span>
    </span>
  );
}

// Badge diameter and glyph size per disc, and where the badge sits: its
// centre on the disc's 45° point, r(1 − 1/√2) in from the box corner.
const BADGE: Record<
  AssistantAvatarSize,
  { box: string; glyph: number; at: string }
> = {
  20: { box: "size-3", glyph: 10, at: "-right-[3px] -top-[3px]" },
  28: { box: "size-[15px]", glyph: 12, at: "-right-[3px] -top-[3px]" },
  32: { box: "size-[15px]", glyph: 12, at: "-right-[3px] -top-[3px]" },
  48: { box: "size-[18px]", glyph: 15, at: "-right-0.5 -top-0.5" },
};

/**
 * The avatar's mark for a state: the main chat row's status icon in
 * the badge corner (layout-and-chrome.md, Session Row) — the spinning
 * bold brand ring while it runs, the filled amber pause of a question,
 * the red x of an error (filled: the row's thin one is illegible this
 * small, and the row has a rail, a tint and words to carry it), the
 * filled apricot dot of unread (a step stronger than the row's, to
 * stand off the apricot disc). Nothing at rest.
 *
 * Ringed in what the entry is filled with right now, so it reads as cut
 * into the disc's corner: the entry sets `--assistant-ground` (chrome,
 * hover, selected) and the ring follows.
 *
 * The header bans status dots (§4.1 禁止) because a dot reads as an
 * unread message; here the only dot is unread, so that reading is the
 * meaning.
 */
export function AssistantAvatarBadge({
  kind,
  size,
  pop = false,
}: {
  kind: AssistantStateKind;
  size: AssistantAvatarSize;
  /** Play the entry pop (a state just became news). */
  pop?: boolean;
}) {
  if (kind === "idle") return null;
  const badge = BADGE[size];
  return (
    <span
      aria-hidden
      data-role="assistant-badge"
      data-kind={kind}
      className={cn(
        "pointer-events-none absolute inline-flex items-center justify-center rounded-full",
        "bg-[var(--assistant-ground,var(--color-chrome))]",
        badge.box,
        badge.at,
        pop && "sidebar-state-pop",
      )}
    >
      {kind === "running" ? (
        <span className="spin">
          <CircleNotch
            size={badge.glyph}
            weight="bold"
            className="text-brand-strong"
          />
        </span>
      ) : kind === "ask" ? (
        <PauseCircle
          size={badge.glyph}
          weight="fill"
          className="text-warning"
        />
      ) : kind === "error" ? (
        <XCircle size={badge.glyph} weight="fill" className="text-error" />
      ) : (
        <Circle
          size={Math.round(badge.glyph * 0.75)}
          weight="fill"
          className="text-brand-strong"
        />
      )}
    </span>
  );
}
