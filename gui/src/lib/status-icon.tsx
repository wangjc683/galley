import {
  Archive,
  CheckCircle,
  Circle,
  CircleNotch,
  Prohibit,
  XCircle,
} from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import type { SessionStatus } from "@/types/session";

/**
 * Maps SessionStatus to the Phosphor icon + color + weight it should
 * render with on session rows. Per DESIGN.md §4.2 Sidebar Spec +
 * prototype's chrome.jsx.
 *
 * - running: spinning brand-strong CircleNotch, BOLD weight so the
 *   "agent is working" state pops on sidebar scan. Thin weight at
 *   14px was visually too quiet to distinguish from idle even with
 *   the spin animation.
 * - completed: muted CheckCircle (thin — passive success). Also how a
 *   settled `idle` row whose run completed draws (see `incomplete`):
 *   GUI-local runs settle to `idle`, only the CLI writes `completed`,
 *   and both mean "this ran to the end" (2026-10-03). Muted, not brand:
 *   it is the resting state of nearly every row, so it has to be the
 *   quiet one; brand is reserved for its unread form.
 * - error: deep red XCircle (thin)
 * - idle (not done) / connecting / archived: muted (thin)
 * - cancelled: muted Prohibit (different from error — user-initiated)
 */
const STATUS_MAP: Record<
  SessionStatus,
  {
    Icon: typeof Circle;
    className: string;
    weight?: "thin" | "regular" | "bold";
    spin?: boolean;
  }
> = {
  idle: { Icon: Circle, className: "text-ink-muted" },
  connecting: { Icon: CircleNotch, className: "text-ink-muted", spin: true },
  running: {
    Icon: CircleNotch,
    className: "text-brand-strong",
    weight: "bold",
    spin: true,
  },
  error: { Icon: XCircle, className: "text-error" },
  cancelled: { Icon: Prohibit, className: "text-ink-muted" },
  completed: { Icon: CheckCircle, className: "text-ink-muted" },
  archived: { Icon: Archive, className: "text-ink-muted" },
};

export function StatusIcon({
  status,
  size = 14,
  unread = false,
  incomplete = false,
}: {
  status: SessionStatus;
  size?: number;
  /** Settled-but-unread: render the glyph filled + brand so the row's
   * leftmost icon carries the unread signal (no separate dot). */
  unread?: boolean;
  /** A settled `idle` row that must not claim "done" — paused at the
   * step cap, a parked goal, no recap. It keeps the hollow ring; every
   * other `idle` row draws the `completed` check circle. */
  incomplete?: boolean;
}) {
  // "Done" lives in the icon, not in the subline's words (a 已完成
  // prefix on nearly every row was noise, 2026-10-03). The hollow ring
  // is left for idle rows that stopped without finishing — in the
  // to-do grammar users already know, an empty circle means "not done".
  const shown: SessionStatus =
    status === "idle" && !incomplete ? "completed" : status;
  const cfg = STATUS_MAP[shown];
  const { Icon } = cfg;
  // The not-done idle Circle (read = hollow ring, unread = filled disc) is
  // the only plain disc/ring in the column, so it's tuned by optical weight
  // rather than raw diameter: a filled disc carries far more ink than a thin
  // ring of equal size. Shrink the filled unread dot most (it reads heavy),
  // and shrink the hollow ring a touch less so it stays slightly larger than
  // the dot — the two then balance in perceived weight. Other glyphs
  // (spinner, check, pause, x) have internal shape and keep full size; the
  // done check's unread fill matches ask_user's filled pause at 14px, told
  // apart by its glyph and hue (checked in dark mode, 2026-10-03).
  let renderSize = size;
  if (shown === "idle") {
    renderSize = Math.round(size * (unread ? 0.7 : 0.78));
  }
  return (
    <span className={cn("inline-flex shrink-0", cfg.spin && "spin")}>
      <Icon
        size={renderSize}
        weight={unread ? "fill" : (cfg.weight ?? "thin")}
        className={unread ? "text-brand" : cfg.className}
      />
    </span>
  );
}
