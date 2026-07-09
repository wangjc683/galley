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
  "flex size-8 items-center justify-center rounded-full border transition-[background-color,border-color,color,box-shadow,transform]",
  "duration-[140ms] ease-[cubic-bezier(0.2,0,0,1)] active:duration-[70ms]",
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
  "transition-[background-color,color,transform] duration-[140ms] ease-[cubic-bezier(0.2,0,0,1)] active:duration-[70ms]",
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

export const COMPOSER_GOAL_BUTTON = cn(
  COMPOSER_ACTION_BUTTON,
  "border-line bg-surface text-ink-soft",
  "shadow-[var(--shadow-neutral-control)]",
  "hover:border-brand/45 hover:bg-brand-soft hover:text-brand-strong hover:shadow-[var(--shadow-neutral-control-hover)]",
  "active:shadow-[var(--shadow-control-press)]",
);

export const COMPOSER_GOAL_BUTTON_ARMED = cn(
  COMPOSER_ACTION_BUTTON,
  "border-brand/45 bg-brand-soft text-brand-strong",
  "shadow-[var(--shadow-neutral-control)]",
  "hover:bg-brand/[var(--opacity-medium)] hover:shadow-[var(--shadow-neutral-control-hover)]",
  "active:shadow-[var(--shadow-control-press)]",
);
