/**
 * The one-line composer's change of height, animated (telegram-details
 * ticket 05; a trial until JC rules, see
 * components/conversation/td-variants/td-variants.ts).
 *
 * Today the input snaps to its new height as a line comes or goes
 * (Composer's auto-grow: `height: auto`, read `scrollHeight`, write it
 * back). Animated, the real input is never collapsed to measure: a
 * hidden copy of it, in a zero-height box beside it, takes the text and
 * gives the height, and the input moves there over the option's time,
 * CSS `ease-out` (cubic-bezier(0, 0, 0.58, 1)), carrying on from wherever
 * it is when the next line comes before the last has landed. Growing and
 * shrinking alike (typing, deleting, back to one line after a send).
 * Telegram measures with a hidden clone too (Web A MessageInput, Web K
 * inputFieldAnimated); the idea and the numbers are theirs, the code is
 * ours.
 *
 * Why frame by frame (requestAnimationFrame) and not a CSS transition,
 * as Telegram has it: the conversation above has to stay at its bottom
 * through every frame (lib/viewport-resize.ts). Its ResizeObserver pins
 * it after each frame's layout, and the pin's scroll event, a frame
 * later, re-reads 「at the bottom」 (useStickyScroll, 24px). A transition
 * has already moved on by then (the browser advances it at the start of
 * the frame), so a step of more than 24px — 100ms for a pasted page
 * takes up to ~45px a frame — read as 「scrolled up」 and the next frame
 * was not pinned: measured in Chrome, one frame 17px low. Set in a frame
 * callback, the height changes after the scroll event has read it.
 *
 * While the content fits under the cap the input does not scroll
 * (`overflow-y: hidden`), so a line arriving ahead of the box shows no
 * scrollbar; past the cap it scrolls as before.
 *
 * Reduced motion: always the instant path.
 */

export type ComposerGrowTiming = "instant" | "fixed" | "distance";

/** A2: the same 100ms for any change. */
export const COMPOSER_GROW_FIXED_MS = 100;

/** A3: Telegram's `50 × ln|Δh|` ms (Web A MessageInput, Web K
 * inputFieldAnimated: the same curve on both): one more line (about
 * 22px) ≈ 155ms; the whole way from one line to eight (157px) ≈ 253ms. */
export const COMPOSER_GROW_DISTANCE_FACTOR = 50;

export function composerGrowDurationMs(
  timing: ComposerGrowTiming,
  deltaPx: number,
): number {
  const delta = Math.abs(deltaPx);
  if (timing === "instant" || delta < 1) return 0;
  if (timing === "fixed") return COMPOSER_GROW_FIXED_MS;
  return Math.max(
    0,
    Math.round(COMPOSER_GROW_DISTANCE_FACTOR * Math.log(delta)),
  );
}

/** CSS `ease-out`, cubic-bezier(0, 0, 0.58, 1): the progress at time
 * fraction `t` (0–1). */
export function easeOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // x(s) = 3(1−s)s²·0.58 + s³ rises monotonically; find s with x(s) = t.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const s = (lo + hi) / 2;
    if (3 * (1 - s) * s * s * 0.58 + s * s * s < t) lo = s;
    else hi = s;
  }
  const s = (lo + hi) / 2;
  return 3 * (1 - s) * s * s + s * s * s;
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
  motion.at = motion.from + (motion.to - motion.from) * easeOut(t);
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

/** Back to today's input: the motion, the overflow and the hidden copy
 * go. Touches nothing that was not set. */
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
 * Moves the input to its text's height, animated by `timing`, capped at
 * `cap(el)`. False for the instant path (`instant`, or reduced motion),
 * which the caller then takes as it always has; true when it set the
 * height itself. The first height an input gets (no inline height yet:
 * the composer just mounted) is set at once, not animated.
 */
export function animateTextareaHeight(
  el: HTMLTextAreaElement,
  timing: ComposerGrowTiming,
  cap: (el: HTMLTextAreaElement) => number,
): boolean {
  if (timing === "instant" || prefersReducedMotion()) {
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
    ? composerGrowDurationMs(timing, next - current)
    : 0;
  if (ms === 0) {
    el.style.height = `${next}px`;
    return true;
  }
  // From where it stands; the first frame moves it.
  const motion: Motion = {
    from: current,
    to: next,
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
