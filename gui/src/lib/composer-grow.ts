/**
 * The one-line composer's change of height, animated (telegram-details
 * ticket 05, settled as A3 in ticket 08: PRD ruling 6). Growing and
 * shrinking alike (typing, deleting, back to one line after a send), the
 * input moves to its new height over `round(50 × ln|Δh|)` ms — Telegram's
 * curve for its input (Web A MessageInput, Web K inputFieldAnimated: the
 * same on both), one more line (about 22px) ≈ 155ms, the whole way from
 * one line to eight (157px) ≈ 253ms — eased by our `--ease-firm` token.
 * Like programmatic scrolls (lib/animate-scroll.ts), its time follows the
 * distance, so it is not on the motion scale (foundations.md 「Motion
 * tokens」); its curve is. Instant instead: a change under a pixel, the
 * first height after mounting, reduced motion, and a token that cannot be
 * read. A new line before the last has landed carries on from where the
 * input stands.
 *
 * The real input is never collapsed to measure: a hidden copy of it, in
 * a zero-height box beside it, takes the text and gives the height.
 * Telegram measures with a hidden clone too; the idea and the numbers
 * are theirs, the code is ours.
 *
 * Why frame by frame (requestAnimationFrame) and not a CSS transition,
 * as Telegram has it: the conversation above has to stay at its bottom
 * through every frame (lib/viewport-resize.ts). Its ResizeObserver pins
 * it after each frame's layout, and the pin's scroll event, a frame
 * later, re-reads 「at the bottom」 (useStickyScroll, 24px). A transition
 * has already moved on by then (the browser advances it at the start of
 * the frame), so a step of more than 24px read as 「scrolled up」 and the
 * next frame was not pinned: measured in Chrome with a 100ms transition
 * on a pasted page, one frame 17px low. Set in a frame callback, the
 * height changes after the scroll event has read it. Frame by frame, the
 * curve is evaluated here, from the token's own definition (below).
 *
 * While the content fits under the cap the input does not scroll
 * (`overflow-y: hidden`), so a line arriving ahead of the box shows no
 * scrollbar; past the cap it scrolls as before.
 */

/** Telegram's factor: `50 × ln|Δh|` ms. */
export const COMPOSER_GROW_DISTANCE_FACTOR = 50;

/** How long the input takes to move by `deltaPx` (either way): 0 under
 * a pixel. */
export function composerGrowDurationMs(deltaPx: number): number {
  const delta = Math.abs(deltaPx);
  if (delta < 1) return 0;
  return Math.max(
    0,
    Math.round(COMPOSER_GROW_DISTANCE_FACTOR * Math.log(delta)),
  );
}

/** The easing token the motion follows (globals.css `@theme`, the
 * motion-token table in foundations.md). */
export const COMPOSER_GROW_EASING_TOKEN = "--ease-firm";

/** The four numbers of a CSS `cubic-bezier(x1, y1, x2, y2)` value, or
 * null for anything else. x1 and x2 must lie in 0–1, as CSS requires. */
export function parseCubicBezier(
  value: string,
): [number, number, number, number] | null {
  const match =
    /^\s*cubic-bezier\(\s*([-+.\d]+)\s*,\s*([-+.\d]+)\s*,\s*([-+.\d]+)\s*,\s*([-+.\d]+)\s*\)\s*$/.exec(
      value,
    );
  if (!match) return null;
  const [x1, y1, x2, y2] = match.slice(1).map(Number);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return null;
  return [x1, y1, x2, y2];
}

/** A CSS cubic Bézier timing function: the progress at time fraction
 * `t` (0–1). x(s) rises monotonically when x1 and x2 lie in 0–1, so the
 * curve's parameter for `t` is found by halving. */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const at = (a: number, b: number, s: number) =>
    3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const s = (lo + hi) / 2;
      if (at(x1, x2, s) < t) lo = s;
      else hi = s;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

/** `--ease-firm` as the page has it, read off the root each time a
 * motion starts — one source for the number, the token's definition.
 * Null when it cannot be read (no page, or not a cubic-bezier): the
 * caller then takes the instant path. */
function firmEasing(): ((t: number) => number) | null {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function")
    return null;
  const curve = parseCubicBezier(
    getComputedStyle(document.documentElement).getPropertyValue(
      COMPOSER_GROW_EASING_TOKEN,
    ),
  );
  return curve ? cubicBezier(...curve) : null;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/** The hidden copy each input measures with. */
const copies = new WeakMap<HTMLTextAreaElement, HTMLTextAreaElement>();

/**
 * The height `el`'s text takes, read off its hidden copy: the copy keeps
 * the input's classes, inline padding and caps (cloned), sits beside it
 * so it inherits the same font size, and is as wide; its own height is
 * `auto`, so `scrollHeight` is the text's. The box around it is
 * zero-height, hidden and contained, so it takes no room, shows nothing
 * and adds no scrollable overflow; inert, so nothing can focus or read
 * it.
 */
function measuredHeight(el: HTMLTextAreaElement): number {
  const parent = el.parentElement;
  if (!parent) return el.scrollHeight;
  let copy = copies.get(el);
  if (!copy || copy.parentElement?.parentElement !== parent) {
    const box = document.createElement("div");
    // Out of reach: no focus, no pointer, nothing for assistive tech.
    box.inert = true;
    box.setAttribute("aria-hidden", "true");
    box.dataset.role = "composer-measure";
    box.style.cssText =
      "position:absolute;left:0;top:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;contain:strict";
    copy = el.cloneNode(false) as HTMLTextAreaElement;
    copy.removeAttribute("id");
    copy.removeAttribute("aria-describedby");
    copy.removeAttribute("title");
    copy.tabIndex = -1;
    copy.readOnly = true;
    copy.style.height = "auto";
    copy.style.overflowY = "hidden";
    box.appendChild(copy);
    parent.appendChild(box);
    copies.set(el, copy);
  }
  const box = copy.parentElement as HTMLElement;
  box.style.width = `${el.getBoundingClientRect().width}px`;
  copy.placeholder = el.placeholder;
  copy.value = el.value;
  return copy.scrollHeight;
}

/** An input's height on its way somewhere. */
interface Motion {
  from: number;
  to: number;
  /** The curve it follows (`--ease-firm`). */
  ease: (t: number) => number;
  /** When it set off (performance.now()), and for how long. */
  start: number;
  ms: number;
  /** Where it stands now (the last frame's height). */
  at: number;
  frame: number | null;
}

const motions = new WeakMap<HTMLTextAreaElement, Motion>();

function step(el: HTMLTextAreaElement, motion: Motion, now: number): void {
  const t = motion.ms > 0 ? (now - motion.start) / motion.ms : 1;
  motion.at = motion.from + (motion.to - motion.from) * motion.ease(t);
  el.style.height = `${motion.at}px`;
  if (t >= 1) {
    motion.frame = null;
    motions.delete(el);
    return;
  }
  motion.frame = requestAnimationFrame(() =>
    step(el, motion, performance.now()),
  );
}

/** Back to the instant input: the motion, the overflow and the hidden
 * copy go. Touches nothing that was not set. */
function stopAnimating(el: HTMLTextAreaElement): void {
  const motion = motions.get(el);
  if (motion) {
    if (motion.frame !== null) cancelAnimationFrame(motion.frame);
    motions.delete(el);
  }
  if (el.style.overflowY) el.style.overflowY = "";
  const copy = copies.get(el);
  if (copy) {
    copy.parentElement?.remove();
    copies.delete(el);
  }
}

/**
 * Moves the input to its text's height, capped at `cap(el)`, over
 * `composerGrowDurationMs` eased by `--ease-firm`. False for the instant
 * path (reduced motion, or the token unreadable), which the caller then
 * takes; true when it set the height itself. The first height an input
 * gets (no inline height yet: the composer just mounted) is set at once,
 * not animated.
 */
export function animateTextareaHeight(
  el: HTMLTextAreaElement,
  cap: (el: HTMLTextAreaElement) => number,
): boolean {
  const ease = prefersReducedMotion() ? null : firmEasing();
  if (!ease) {
    stopAnimating(el);
    return false;
  }
  const content = measuredHeight(el);
  const max = cap(el);
  const next = Math.min(content, max);
  el.style.overflowY = content > max ? "" : "hidden";
  const running = motions.get(el);
  const current = running ? running.at : Number.parseFloat(el.style.height);
  if (running && running.to === next) return true;
  if (running?.frame != null) cancelAnimationFrame(running.frame);
  motions.delete(el);
  const ms = Number.isFinite(current)
    ? composerGrowDurationMs(next - current)
    : 0;
  if (ms === 0) {
    el.style.height = `${next}px`;
    return true;
  }
  // From where it stands; the first frame moves it.
  const motion: Motion = {
    from: current,
    to: next,
    ease,
    start: performance.now(),
    ms,
    at: current,
    frame: null,
  };
  motions.set(el, motion);
  motion.frame = requestAnimationFrame(() =>
    step(el, motion, performance.now()),
  );
  return true;
}
