/**
 * The conversation's own smooth scroll (telegram-details ticket 04).
 * Every programmatic smooth scroll in the conversation goes through
 * `animateScroll` instead of `scrollTo` / `scrollBy` with
 * `behavior: "smooth"`, whose duration and curve are the engine's and
 * which ignores the system's 「减少动态效果」.
 *
 * The rules (numbers learned from Telegram Web A's message-list scroll,
 * `src/util/animateScroll.ts` and its `config.ts` constants, as of
 * 2026-10-16 `f67a408`; Telegram is GPL-3.0, so only the idea and the
 * numbers are taken, this code is written from scratch):
 *
 *   distance   a target farther than 800px first jumps, instantly, to
 *              800px short of it; only the last 800px are animated. A
 *              long jump is a jump, not a blur of passing messages.
 *   duration   300ms plus 300ms per 800px of the animated distance:
 *              300ms for a nudge, 600ms at most.
 *   curve      ease-out. Up to 300px `1 − (1 − t)^3.5`; farther the
 *              steeper `1 − (1 − t)^6`, which covers most of the way
 *              early and settles gently.
 *   reduced    with `prefers-reduced-motion: reduce` the position is
 *              written at once. Read from `matchMedia` on every call,
 *              never cached, so the system setting applies the moment
 *              it changes (foundations.md §2.7: nothing moves on screen
 *              under reduced motion; fades may stay).
 *
 * Who gets the last word:
 *
 *   - the user: a wheel or trackpad tick, a touch, a press on the
 *     scrollbar, or a key that scrolls (arrows, Page Up / Down, Home /
 *     End, space; not while typing in a field) lets go at once.
 *   - other code: a `scrollTop` that moved between two frames by
 *     something else (the follow-the-bottom snap, the session switch,
 *     an earlier page prepended above) lets go too, the way a native
 *     smooth scroll is dropped by a plain `scrollTop` write. The new
 *     position is someone's decision; animating on from stale
 *     coordinates would undo it.
 *   - a newer request: one animation per container; a new call on the
 *     same container takes over from the old one.
 *
 * A running animation can change its target (`retarget`): the rest of
 * the way restarts from where the container is now, under the same
 * rules (a growing tail that the 「回到底部」 chase keeps re-aiming at;
 * a message that must park while the layout under it moves).
 *
 * Keeping time with something else on screen (`ScrollTiming`, ticket
 * 51: the main chat's follow when its reply grows out of the live line)
 * the caller sets the duration and the curve instead, and then the
 * whole way is animated (no far jump), the clock starts at the first
 * frame, as a Web Animation started in the same task does, and a
 * retarget keeps the end time: the rest of the way runs from where the
 * container is to the new target over what is left of the curve. The
 * user and other code still get the last word; reduced motion still
 * writes at once.
 */

/** Farthest distance animated; beyond it, jump to this far short of the
 * target first (px). */
export const SCROLL_ANIMATED_MAX_PX = 800;
/** Up to this distance the gentler curve (px). */
export const SCROLL_SHORT_PX = 300;
/** Duration of the shortest animation (ms). */
export const SCROLL_MIN_MS = 300;
/** Duration of an animation over the full SCROLL_ANIMATED_MAX_PX (ms). */
export const SCROLL_MAX_MS = 600;
/** A `scrollTop` that moved more than this between two frames moved by
 * someone else (px): above sub-pixel rounding of what was written. */
const FOREIGN_MOVE_PX = 2;

/** Keys that scroll a focused page or scroller natively. */
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

/** How an animation ended. */
export type ScrollEnd =
  /** Reached its target (or wrote it at once). */
  | "arrived"
  /** The user scrolled. */
  | "interrupted"
  /** Something else moved `scrollTop` between two frames. */
  | "displaced"
  /** A newer `animateScroll` on the same container took over. */
  | "superseded"
  /** `cancel()`. */
  | "cancelled";

export interface ScrollAnimation {
  /** Aim at a new `scrollTop`; the rest of the way restarts from where
   * the container is now. Ignored once the animation has ended (start a
   * new one). */
  retarget(top: number): void;
  /** Stop where it is. */
  cancel(): void;
  /** Null while running. */
  readonly ended: ScrollEnd | null;
  /** The `scrollTop` it is heading for, clamped to the scrollable range. */
  readonly target: number;
}

/** A scroll that keeps time with an animation beside it (see the
 * module note): its duration and its curve. */
export interface ScrollTiming {
  /** The whole way, in ms; a retarget keeps the end time. */
  durationMs: number;
  /** Progress (0–1) at time fraction `t` (0–1). */
  easing: (t: number) => number;
}

/** The scroll container as this module uses it (an HTMLElement in the
 * app; a stand-in in tests). */
export interface ScrollBox extends EventTarget {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  /** Where key presses are heard; the document in the app. */
  readonly ownerDocument: EventTarget | null;
}

/** Duration for an animated distance (ms). */
export function scrollDurationMs(distance: number): number {
  const animated = Math.min(Math.abs(distance), SCROLL_ANIMATED_MAX_PX);
  return (
    SCROLL_MIN_MS +
    (SCROLL_MAX_MS - SCROLL_MIN_MS) * (animated / SCROLL_ANIMATED_MAX_PX)
  );
}

/** Progress (0–1) at time fraction `t` (0–1) for an animated distance. */
export function scrollProgress(distance: number, t: number): number {
  const exponent = Math.abs(distance) <= SCROLL_SHORT_PX ? 3.5 : 6;
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, exponent);
}

/** Where the animation starts from: `from` itself when the target is
 * within SCROLL_ANIMATED_MAX_PX, else that far short of the target on
 * the side it comes from. */
export function scrollJumpFrom(from: number, to: number): number {
  const distance = to - from;
  if (Math.abs(distance) <= SCROLL_ANIMATED_MAX_PX) return from;
  return to - Math.sign(distance) * SCROLL_ANIMATED_MAX_PX;
}

/** Whether the system asks for reduced motion right now. */
export function prefersReducedMotion(): boolean {
  const match = globalThis.matchMedia;
  return (
    typeof match === "function" &&
    match("(prefers-reduced-motion: reduce)").matches
  );
}

/** The highest `scrollTop` the container can take. */
function maxScrollTop(el: ScrollBox): number {
  return Math.max(0, el.scrollHeight - el.clientHeight);
}

function isEditable(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const node = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
  };
  return (
    node.isContentEditable === true ||
    node.tagName === "INPUT" ||
    node.tagName === "TEXTAREA" ||
    node.tagName === "SELECT"
  );
}

/** The animation running on each container, with its way to end it. */
const running = new WeakMap<
  ScrollBox,
  { animation: ScrollAnimation; finish: (end: ScrollEnd) => void }
>();

/** The target of the animation running on `el`, or null. ⌥↑ / ⌥↓ pick
 * the next message from there, so a second press during the animation
 * goes one further instead of re-aiming at the same one. */
export function scrollDestination(el: ScrollBox): number | null {
  return running.get(el)?.animation.target ?? null;
}

/**
 * Smoothly scrolls `el` to `top` under the rules above. `onEnd` runs
 * once when it ends, with how; it can run before this returns (reduced
 * motion, already there). `timing` sets the duration and the curve for
 * a scroll that keeps time with something else (see the module note);
 * without it, they follow the distance.
 */
export function animateScroll(
  el: ScrollBox,
  top: number,
  onEnd?: (end: ScrollEnd) => void,
  timing?: ScrollTiming,
): ScrollAnimation {
  running.get(el)?.finish("superseded");

  let ended: ScrollEnd | null = null;
  let target = 0;
  let from = 0;
  let distance = 0;
  let startedAt = 0;
  let duration = SCROLL_MIN_MS;
  /** `scrollTop` as read right after our last write. */
  let written = 0;
  let frame: number | null = null;
  // With `timing`: the first frame's time (the clock starts there), the
  // time fraction the last frame reached, and the curve's progress where
  // the current leg began (0, or where a retarget picked up).
  let clockAt: number | null = null;
  let reached = 0;
  let legFrom = 0;

  // A wheel / trackpad tick or a touch on the scroller.
  const onUserScroll = () => finish("interrupted");
  const onPointerDown = (event: Event) => {
    // On the container itself: its scrollbar (or its padding), not
    // the content inside.
    if (event.target === el) finish("interrupted");
  };
  const onKeyDown = (event: Event) => {
    const key = (event as KeyboardEvent).key;
    if (!SCROLL_KEYS.has(key) || event.defaultPrevented) return;
    if (isEditable(event.target)) return;
    finish("interrupted");
  };
  const doc = el.ownerDocument;

  const detach = () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    el.removeEventListener("wheel", onUserScroll);
    el.removeEventListener("touchstart", onUserScroll);
    el.removeEventListener("pointerdown", onPointerDown);
    doc?.removeEventListener("keydown", onKeyDown);
    if (running.get(el)?.animation === animation) running.delete(el);
  };

  function finish(end: ScrollEnd) {
    if (ended) return;
    ended = end;
    detach();
    onEnd?.(end);
  }

  /** Where the current leg is at time fraction `t`: the distance's own
   * curve, or with `timing` its curve over what is left of it. */
  const legProgress = (t: number): number => {
    if (!timing) return scrollProgress(distance, t);
    const left = 1 - legFrom;
    if (left <= 1e-9) return 1;
    return (timing.easing(Math.min(1, Math.max(0, t))) - legFrom) / left;
  };

  const step = (frameTime: number) => {
    frame = null;
    if (ended) return;
    if (Math.abs(el.scrollTop - written) > FOREIGN_MOVE_PX) {
      finish("displaced");
      return;
    }
    let t: number;
    if (timing) {
      if (clockAt === null) clockAt = frameTime;
      t = (frameTime - clockAt) / duration;
      reached = Math.min(1, t);
    } else {
      t = (performance.now() - startedAt) / duration;
    }
    const done = t >= 1;
    el.scrollTop = done ? target : from + distance * legProgress(t);
    written = el.scrollTop;
    if (done) {
      finish("arrived");
      return;
    }
    frame = requestAnimationFrame(step);
  };

  const aim = (top: number) => {
    target = Math.min(Math.max(0, top), maxScrollTop(el));
    if (prefersReducedMotion()) {
      el.scrollTop = target;
      finish("arrived");
      return;
    }
    // Kept in time with something else: the whole way, no far jump.
    const start = timing ? el.scrollTop : scrollJumpFrom(el.scrollTop, target);
    if (start !== el.scrollTop) el.scrollTop = start;
    from = el.scrollTop;
    written = from;
    distance = target - from;
    if (Math.abs(distance) < 1) {
      el.scrollTop = target;
      finish("arrived");
      return;
    }
    if (timing) {
      // The end time stays where the first aim put it; this leg runs
      // over the rest of the curve.
      duration = timing.durationMs;
      legFrom = timing.easing(reached);
    } else {
      duration = scrollDurationMs(distance);
      startedAt = performance.now();
    }
    if (frame === null) frame = requestAnimationFrame(step);
  };

  const animation: ScrollAnimation = {
    retarget(next) {
      if (!ended) aim(next);
    },
    cancel() {
      finish("cancelled");
    },
    get ended() {
      return ended;
    },
    get target() {
      return target;
    },
  };

  running.set(el, { animation, finish });
  el.addEventListener("wheel", onUserScroll, { passive: true });
  el.addEventListener("touchstart", onUserScroll, { passive: true });
  el.addEventListener("pointerdown", onPointerDown, { passive: true });
  doc?.addEventListener("keydown", onKeyDown);
  aim(top);
  return animation;
}
