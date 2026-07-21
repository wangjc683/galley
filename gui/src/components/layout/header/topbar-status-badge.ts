import { cn } from "@/lib/utils";

/**
 * Shared visual vocabulary for the MainHeader status cluster — the
 * text-badge status indicators (Goal / Channels / Browser Control)
 * all key off the same tone map so a colour or motion tweak lands in
 * one place instead of drifting across the call sites.
 *
 * Icon-form indicators use TopBarIconButton instead; this module is
 * only the text-badge track.
 */

export type TopBarStatusTone =
  | "brand"
  | "error"
  | "neutral"
  | "success"
  | "warning";

const TOPBAR_CONTROL_MOTION = cn(
  "transition-none active:transition-[transform,box-shadow]",
  "active:duration-(--motion-press) active:ease-firm",
  "active:translate-y-[0.5px]",
);

/**
 * Press-in affordance for badges that are also popover triggers — Radix
 * sets `data-state="open"` on the trigger while its popover is open, so
 * the badge sinks + gains a pressed shadow for the duration.
 */
export const TOPBAR_POPOVER_OPEN_STATE =
  "data-[state=open]:translate-y-px data-[state=open]:shadow-[var(--shadow-control-press)]";

const TOPBAR_STATUS_BADGE_BASE = cn(
  "inline-flex h-7 items-center whitespace-nowrap rounded-md border px-2.5 text-[12px] font-medium",
  "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
  TOPBAR_CONTROL_MOTION,
);

const TOPBAR_STATUS_BADGE_TONE: Record<TopBarStatusTone, string> = {
  brand:
    "border-brand/30 bg-brand-soft text-brand-strong hover:bg-brand-soft/80",
  error:
    "border-error/30 bg-error/[var(--opacity-soft)] text-error hover:bg-error/[var(--opacity-medium)]",
  neutral:
    "border-line bg-elevated text-ink-muted hover:bg-hover hover:text-ink",
  success:
    "border-success/30 bg-success/[var(--opacity-soft)] text-success hover:bg-success/[var(--opacity-medium)]",
  warning:
    "border-warning/30 bg-warning/[var(--opacity-soft)] text-warning hover:bg-warning/[var(--opacity-medium)]",
};

export function topBarStatusBadgeClass(
  tone: TopBarStatusTone,
  className?: string,
) {
  return cn(
    TOPBAR_STATUS_BADGE_BASE,
    TOPBAR_STATUS_BADGE_TONE[tone],
    className,
  );
}
