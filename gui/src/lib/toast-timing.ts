/**
 * Auto-dismiss timing for toasts, kept out of the component so the rule is
 * a pure function and testable without a DOM.
 *
 * `ToastHost` pauses the countdown while the pointer is over a toast or
 * focus is inside it; this decides how long the timer runs for each time it
 * (re)starts.
 */

/**
 * Floor on how long a resumed countdown runs for. Without it, releasing a
 * toast that was paused with 40ms left makes it vanish the moment the
 * pointer moves off — which reads as the toast reacting to the mouse rather
 * than to time, and takes its action button with it.
 */
export const TOAST_RESUME_FLOOR_MS = 800;

/**
 * How long the countdown should run for. `remaining` is null on the first
 * start and the banked leftover on every resume.
 *
 * The floor never exceeds the toast's own total budget: a caller that asked
 * for a 300ms toast means it, and should not get an 800ms one back just
 * because the pointer grazed it.
 */
export function resumeDelay(remaining: number | null, total: number): number {
  if (remaining === null) return total;
  return Math.max(remaining, Math.min(TOAST_RESUME_FLOOR_MS, total));
}
