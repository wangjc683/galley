import { PROGRESS_SHIMMER_ANIMATION } from "@/lib/progress-line-motion";
import { parseDurationMs } from "@/lib/typing-bubble-handoff";

/*
 * A copy of the typing bubble that fades out where it stood carries its
 * loops on in step instead of starting them over: the dots' `live-dot`
 * stagger and the sweep on the line's sentence (`progress-shimmer`).
 * Read where they started (document timeline) while the bubble is on the
 * page; give the copy a negative `animation-delay` by how long they ran.
 * Shared by the hand-off (hooks/useTypingBubbleHandoff.ts, rulings 103,
 * 110, 137) and the typing bubble going with nothing growing out of it
 * (lib/bubble-motion-play.ts, ruling 138).
 */

/** When the dots' loop started (document timeline, ms): their running
 * animation's start, else what was read for the same dots before; null
 * without one. */
export function loopStartOf(
  dots: HTMLElement,
  previous: { dots: Element | null; loopStart: number | null } | null,
): number | null {
  const start =
    typeof dots.getAnimations === "function"
      ? dots.getAnimations({ subtree: true })[0]?.startTime
      : null;
  if (typeof start === "number") return start;
  return previous?.dots === dots ? previous.loopStart : null;
}

/** When the sweep on the line's sentence on screen started. Each new
 * sentence is a new element with a sweep of its own, measured in the
 * commit that brings it, before that sweep has a start time (pending
 * until the next frame): then it starts now, within a frame. */
export function sweepStartOf(line: HTMLElement): number | null {
  const sentence = line.querySelector<HTMLElement>(
    '[data-role="assistant-progress-doing"]',
  );
  if (!sentence || typeof sentence.getAnimations !== "function") return null;
  const sweep = sentence
    .getAnimations()
    .find(
      (animation) =>
        "animationName" in animation &&
        animation.animationName === PROGRESS_SHIMMER_ANIMATION,
    );
  if (!sweep) return null;
  if (typeof sweep.startTime === "number") return sweep.startTime;
  const now = document.timeline?.currentTime;
  return typeof now === "number" ? now : null;
}

/** The document timeline's time now (ms), or null. */
export function timelineNow(): number | null {
  const now = document.timeline?.currentTime;
  return typeof now === "number" ? now : null;
}

/** Carry the dots' loop on in `copy` (the dots' row, in the page):
 * each dot's stagger delay less the time the loop has run. */
export function carryLoop(
  copy: HTMLElement,
  loopStart: number | null,
  now: number | null,
): void {
  if (loopStart === null || now === null) return;
  const ran = now - loopStart;
  for (const dot of Array.from(copy.children)) {
    if (!(dot instanceof HTMLElement)) continue;
    const delay = parseDurationMs(getComputedStyle(dot).animationDelay) ?? 0;
    dot.style.animationDelay = `${delay - ran}ms`;
  }
}

/** Only the sentence on screen (ruling 137): one still rolling out is
 * dropped from the line's copy, and the doing part lays out as that
 * sentence alone; it sits at its place (the roll is not copied). */
export function dropRollingSentence(line: HTMLElement): void {
  for (const gone of Array.from(
    line.querySelectorAll('[data-role="assistant-progress-doing-leaving"]'),
  )) {
    gone.remove();
  }
}

/** Carry the sweep on the sentence in `line` (the line's copy, in the
 * page) on where it was, as the dots' loop. */
export function carrySweep(
  line: HTMLElement,
  sweepStart: number | null,
  now: number | null,
): void {
  const sentence = line.querySelector<HTMLElement>(
    '[data-role="assistant-progress-doing"]',
  );
  if (!sentence || sweepStart === null || now === null) return;
  const ran = now - sweepStart;
  const delay = parseDurationMs(getComputedStyle(sentence).animationDelay) ?? 0;
  sentence.style.animationDelay = `${delay - ran}ms`;
}
