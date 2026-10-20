import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

/**
 * Composer button + sizing style tokens. Pulled out of Composer.tsx so
 * the component body reads as logic + structure, not 70 lines of Tailwind
 * up front. Each constant is referenced by name at its call site, so the
 * exact utility soup only matters when you're deliberately tuning a
 * button's chrome.
 */

/**
 * Maximum textarea height in pixels (auto-grow cap). The pixel cap stays
 * fixed across conversation font-size preferences: smaller text gets more
 * visible lines, larger text scrolls earlier, matching the density goal.
 * Past this the textarea scrolls internally so the layout doesn't crowd the
 * conversation document above.
 */
export const COMPOSER_MAX_HEIGHT_PX = 280;

export const COMPOSER_ACTION_BUTTON = cn(
  "flex size-8 items-center justify-center rounded-full border",
  "transition-none active:transition-[translate,scale,box-shadow] active:duration-(--motion-press) active:ease-firm",
  // Full key travel: rises a crisp 1px on hover (key meets finger),
  // sinks 2px on press (~3px of perceptible travel) with a slight
  // compression scale. Integer-pixel movement, never sub-pixel.
  "hover:-translate-y-px",
  "active:translate-y-[2px] active:scale-[0.97]",
  "outline-none",
  "disabled:translate-y-0 disabled:scale-100 disabled:shadow-none",
);

export const COMPOSER_TERTIARY_ICON_BUTTON = cn(
  "flex size-8 shrink-0 items-center justify-center rounded-full text-ink-muted",
  "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm",
  "hover:-translate-y-px active:translate-y-[2px] active:scale-[0.97]",
  "hover:bg-hover hover:text-ink outline-none",
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:translate-y-0 disabled:active:scale-100 disabled:hover:bg-transparent disabled:hover:text-ink-muted",
);

export const COMPOSER_SEND_BUTTON = cn(
  COMPOSER_ACTION_BUTTON,
  "border-brand-strong/40 bg-brand text-ink",
  "shadow-[var(--shadow-brand-control)]",
  "hover:bg-brand-strong hover:text-elevated hover:shadow-[var(--shadow-brand-control-hover)]",
  "active:bg-brand-strong active:text-elevated active:shadow-[var(--shadow-control-press)]",
);

export const COMPOSER_STOP_BUTTON = cn(
  COMPOSER_ACTION_BUTTON,
  "border-warning/70 bg-warning text-elevated",
  "shadow-[var(--shadow-composer-stop)]",
  "hover:bg-warning-hover hover:shadow-[var(--shadow-composer-stop-pulse)]",
  "active:shadow-[var(--shadow-control-press)]",
);

export const COMPOSER_CONFIG_BUTTON = cn(
  COMPOSER_ACTION_BUTTON,
  "border-line bg-surface text-ink-soft",
  "shadow-[var(--shadow-neutral-control)]",
  "hover:border-brand/35 hover:bg-brand-soft hover:text-ink hover:shadow-[var(--shadow-neutral-control-hover)]",
  "active:shadow-[var(--shadow-control-press)]",
);

// ---- A session's one-line composer (ComposerOneLine.tsx) ----------------

/**
 * The input's padding centres one line in the 32px row of round buttons
 * at every conversation font size, so the box is 48px high with one line
 * (7px padding + 1px border on each side) and the last line stays level
 * with ＋ and send as it grows.
 */
const ONE_LINE_PAD =
  "calc((32px - 1.55 * var(--conversation-composer-size)) / 2)";

/** Eight lines, then the input scrolls inside the box. */
export const ONE_LINE_MAX_LINES = 8;

export const ONE_LINE_TEXTAREA_STYLE: CSSProperties = {
  paddingTop: ONE_LINE_PAD,
  paddingBottom: ONE_LINE_PAD,
  // 8 lines + the two pads = 7 lines + 32px.
  maxHeight: `calc(32px + ${ONE_LINE_MAX_LINES - 1} * 1.55 * var(--conversation-composer-size))`,
};

export const ONE_LINE_TEXTAREA_CLASS =
  "block w-full resize-none overflow-y-auto border-0 bg-transparent px-0 [font-size:var(--conversation-composer-size)] leading-[1.55] text-ink outline-none placeholder:text-ink-muted/50";

/** The ghost suggestion sits where the first typed line would. */
export const ONE_LINE_GHOST_STYLE: CSSProperties = { top: ONE_LINE_PAD };

export const ONE_LINE_GHOST_CLASS =
  "pointer-events-none absolute inset-x-0 flex items-baseline gap-2 overflow-hidden [font-size:var(--conversation-composer-size)] leading-[1.55]";

/** The image tiles above the input, inside the box: 12px in from its
 * outer edge, so a tile's 12px corner sits concentric in the box's 24px
 * one. */
export const ONE_LINE_IMAGE_STRIP_CLASS = "flex flex-wrap gap-2 px-1 pb-2 pt-1";

/** The hint row under the one-line form (the workbench's; the main chat
 * has none) starts where the input's text does, on the placeholder's
 * line: the 1px border, the 7px padding, the 32px ＋ and the row's 4px
 * gap (ruling 74, item 3). Under the card it is flush with the card. */
export const ONE_LINE_HINT_CLASS = "pl-[44px]";

/** The auto-grow cap: the textarea's own max-height (eight lines at the
 * current font size). */
export function oneLineMaxHeightPx(el: HTMLTextAreaElement): number {
  const cap = Number.parseFloat(window.getComputedStyle(el).maxHeight);
  return Number.isFinite(cap) && cap > 0 ? cap : COMPOSER_MAX_HEIGHT_PX;
}
