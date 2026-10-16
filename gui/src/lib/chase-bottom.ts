import { animateScroll, type ScrollBox } from "@/lib/animate-scroll";

/**
 * 「回到底部」's click (useStickyScroll): scroll to the bottom and attach
 * to it. The click means "attach to the tail", not "scroll to the
 * coordinate the tail happened to be at": while a run streams, the
 * bottom is a moving target, so a watcher runs beside the animation
 * (lib/animate-scroll.ts) every frame until one of these holds
 * (2026-08-07 rules, kept when the native smooth scroll gave way to
 * our own in 2026-10-16):
 *
 *   arrived    within CHASE_ATTACH_PX of the bottom: attach.
 *   pulled up  `scrollTop` went up by more than 2px since the last
 *              frame: the user changed their mind; let go, don't attach.
 *   timeout    CHASE_TIMEOUT_MS without arriving (streaming outgrew the
 *              animation): write the bottom at once and attach.
 *
 * Meanwhile, whenever the bottom moved, the animation re-aims at the new
 * one (only then, so it is not restarted every frame). Once the user
 * took over (a wheel tick, a key) it is not re-aimed again; the three
 * rules still decide how it ends.
 *
 * `onSettle(attached)` runs once at the end (an animation still covering
 * the last few pixels then runs on); the returned function stops it all
 * without calling it.
 */

/** Within this of the bottom counts as there (useStickyScroll's at-bottom
 * tolerance). */
export const CHASE_ATTACH_PX = 24;
/** Give up animating and write the bottom after this long (ms). */
export const CHASE_TIMEOUT_MS = 1600;
/** `scrollTop` going up by more than this between frames is the user
 * pulling away (px). */
const PULL_UP_PX = 2;

export function chaseBottom(
  el: ScrollBox,
  onSettle: (attached: boolean) => void,
): () => void {
  const bottom = () => Math.max(0, el.scrollHeight - el.clientHeight);
  const startedAt = performance.now();
  let aimedAt = bottom();
  let animation = animateScroll(el, aimedAt);
  let lastTop = el.scrollTop;
  let frame: number | null = null;

  const watch = () => {
    frame = null;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < CHASE_ATTACH_PX) {
      // Attached; the animation (if still running) covers the last few
      // pixels, and the follow-the-bottom snap takes over from there.
      onSettle(true);
      return;
    }
    if (el.scrollTop < lastTop - PULL_UP_PX) {
      animation.cancel();
      onSettle(false);
      return;
    }
    if (performance.now() - startedAt > CHASE_TIMEOUT_MS) {
      animation.cancel();
      el.scrollTop = el.scrollHeight;
      onSettle(true);
      return;
    }
    const next = bottom();
    if (next !== aimedAt) {
      aimedAt = next;
      if (animation.ended === null) animation.retarget(next);
      else if (animation.ended === "arrived") {
        animation = animateScroll(el, next);
      }
    }
    lastTop = el.scrollTop;
    frame = requestAnimationFrame(watch);
  };
  frame = requestAnimationFrame(watch);

  return () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    animation.cancel();
  };
}
