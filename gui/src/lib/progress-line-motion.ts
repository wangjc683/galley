import { parseCubicBezier } from "@/lib/composer-grow";
import { parseDurationMs } from "@/lib/typing-bubble-handoff";

/*
 * The motion of the line under the typing bubble (main chat PRD ruling
 * 137, ticket 93; spec: docs/design/conversation.md 「在跑时：三点气泡」,
 * 「三点下面那一行」). The sentence only changes when a step dispatches
 * its tools — about every ten seconds, the longest step 40 seconds
 * without a word changed — and the change was a swap the eye did not
 * catch, so the line read as still. Two halves: when the doing part says
 * something else, the old sentence rolls up and out of its line and the
 * new one rolls in from below (the rules here, on the page in
 * hooks/useProgressRoll.ts); between changes, a slow soft band sweeps
 * the doing part (globals.css `progress-shimmer`, carried on by the
 * hand-off's copy in hooks/useTypingBubbleHandoff.ts). The time after it
 * neither rolls nor sweeps: it ticks every second as before.
 */

// ---- The roll -----------------------------------------------------------

/** One sentence the doing part has said. */
export interface ProgressSentence {
  /** Its key on the page: one more for each change, so the sentence on
   * screen keeps its element when it starts to leave. */
  id: number;
  text: string;
}

/** What the doing part holds: the sentence it says, and those still on
 * their way out of its line (oldest first; drawn under it, `aria-hidden`). */
export interface ProgressRoll {
  current: ProgressSentence;
  leaving: readonly ProgressSentence[];
}

/** The line as it first appears, with the dots: the sentence, nothing
 * rolling (the first appearance does not roll). */
export function progressRollStart(text: string): ProgressRoll {
  return { current: { id: 0, text }, leaving: [] };
}

/**
 * The doing part once it says `text`. The same words are no change — a
 * render that says the same sentence again rolls nothing, and the roll
 * comes back as it was. Otherwise `text` is the sentence and the one it
 * said leaves, after any still leaving: each goes on from where it is
 * (one still coming in turns round and goes up), nothing waits in a
 * queue and no sentence in between is played again — the newest is
 * always the one that comes in. Without motion (`animated` false: no
 * Web Animations) nothing is kept to leave.
 */
export function progressRollNext(
  roll: ProgressRoll,
  text: string,
  animated: boolean,
): ProgressRoll {
  if (text === roll.current.text) return roll;
  return {
    current: { id: roll.current.id + 1, text },
    leaving: animated ? [...roll.leaving, roll.current] : [],
  };
}

/** Sentence `id` has rolled out of the line: gone. */
export function progressRollSettle(
  roll: ProgressRoll,
  id: number,
): ProgressRoll {
  if (!roll.leaving.some((sentence) => sentence.id === id)) return roll;
  return {
    ...roll,
    leaving: roll.leaving.filter((sentence) => sentence.id !== id),
  };
}

/** How a change moves: a roll, or under reduced motion a fade in place
 * (foundations §2.7 「只淡不移」). */
export type ProgressRollMotion = "roll" | "fade";

export function progressRollMotion(reducedMotion: boolean): ProgressRollMotion {
  return reducedMotion ? "fade" : "roll";
}

/** Where a leaving sentence starts from: its transform and opacity as
 * computed when the next one comes in (mid-way if it was still coming
 * in itself). */
export interface ProgressRollFrom {
  transform: string;
  opacity: string;
}

/** The sentence coming in: from one line below its place (its own
 * height, the line's 18px), or from transparent, to its place. */
export function progressRollIn(
  motion: ProgressRollMotion,
): PropertyIndexedKeyframes {
  return motion === "roll"
    ? { transform: ["translateY(100%)", "translateY(0)"] }
    : { opacity: [0, 1] };
}

/** The sentence going out: from where it is to one line above its
 * place, or to transparent where it stands. */
export function progressRollOut(
  motion: ProgressRollMotion,
  from: ProgressRollFrom,
): PropertyIndexedKeyframes {
  return motion === "roll"
    ? { transform: [from.transform || "none", "translateY(-100%)"] }
    : { opacity: [from.opacity || "1", "0"] };
}

// ---- Timing (motion tokens) ---------------------------------------------

/** A roll moves a line's worth of text: 「较大结构位移」 (foundations
 * Motion tokens), on the workhorse ease-out. The fade under reduced
 * motion keeps both. */
export const PROGRESS_ROLL_DURATION_TOKEN = "--motion-slow";
export const PROGRESS_ROLL_EASING_TOKEN = "--ease-firm";

export interface ProgressRollTiming {
  durationMs: number;
  /** The CSS easing, for Web Animations. */
  easing: string;
}

function rootToken(name: string): string {
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle !== "function"
  ) {
    return "";
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

/** The tokens as the page has them, read each time a sentence comes in
 * — one source for the numbers. Null when they cannot be read: then the
 * change is a swap, as before ticket 93. */
export function readProgressRollTiming(): ProgressRollTiming | null {
  const durationMs = parseDurationMs(rootToken(PROGRESS_ROLL_DURATION_TOKEN));
  const easing = rootToken(PROGRESS_ROLL_EASING_TOKEN).trim();
  if (durationMs === null || !parseCubicBezier(easing)) return null;
  return { durationMs, easing };
}

// ---- The sweep ----------------------------------------------------------

/** The doing part's sweep: globals.css `progress-shimmer`, whose
 * keyframes carry the same name (the hand-off finds the running sweep
 * by it). */
export const PROGRESS_SHIMMER_ANIMATION = "progress-shimmer";
