import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import { prefersReducedMotion } from "@/lib/animate-scroll";
import {
  progressRollIn,
  progressRollMotion,
  progressRollNext,
  progressRollOut,
  progressRollSettle,
  progressRollStart,
  readProgressRollTiming,
  type ProgressRoll,
} from "@/lib/progress-line-motion";

/*
 * The doing part of the line under the typing bubble rolling one line
 * when it says something else (main chat PRD ruling 137, ticket 93;
 * rules in lib/progress-line-motion.ts). The sentence that leaves and
 * the one that comes in are both on the page for the roll, stacked in
 * one grid cell of a box that clips them to its 18px line
 * (TypingBubble's `ProgressDoing`); Web Animations move them, as the
 * hand-off does (hooks/useTypingBubbleHandoff.ts), and a sentence is
 * dropped from the page once it has rolled out.
 */

/** Web Animations on the page (the app's WebKit; not jsdom). Without
 * them a change is a swap: nothing is kept to leave. */
function canAnimate(): boolean {
  return (
    typeof Element !== "undefined" &&
    typeof Element.prototype.animate === "function"
  );
}

/**
 * The sentences for the doing part, and the ref for the box that holds
 * them. The box draws `[...roll.leaving, roll.current]` in that order,
 * one element each, keyed by sentence id — so the sentence on screen
 * keeps its element when it starts to leave, and the newest is the
 * box's last child.
 *
 * Each change plays once, in the commit that brings it: the sentence
 * that was on screen goes up out of the line from wherever it stands
 * (read off its computed style before its own coming-in is stopped, so
 * a change mid-roll turns it round without a jump), and the new one
 * comes up from a line below. Sentences that were already leaving go
 * on undisturbed. Under reduced motion — read each time, never cached —
 * both fade where they stand instead. Duration and curve are the
 * `--motion-slow` / `--ease-firm` tokens; unreadable, the change is a
 * swap. The first sentence, which comes with the dots, does not roll.
 */
export function useProgressRoll(text: string): {
  roll: ProgressRoll;
  boxRef: RefObject<HTMLSpanElement | null>;
} {
  const [roll, setRoll] = useState(() => progressRollStart(text));
  // Guarded setState-in-render: the sentence that leaves has to be on
  // the page in the same commit as the one that comes in, so the roll
  // starts from both.
  if (text !== roll.current.text) {
    setRoll(progressRollNext(roll, text, canAnimate()));
  }
  const boxRef = useRef<HTMLSpanElement | null>(null);
  // The newest sentence whose coming-in has been played: the first is
  // taken as played.
  const playedRef = useRef(roll.current.id);
  // The roll animations in flight, by sentence id.
  const runningRef = useRef(new Map<number, Animation>());

  useLayoutEffect(() => {
    const box = boxRef.current;
    const { current, leaving } = roll;
    if (!box || current.id === playedRef.current) return;
    playedRef.current = current.id;
    const running = runningRef.current;
    const settle = (id: number) =>
      setRoll((now) => progressRollSettle(now, id));
    // The sentence that was on screen until this commit, if it is kept
    // to leave: the newest of the leaving ones, right before the new.
    const outgoing = leaving[leaving.length - 1];
    const incoming = box.lastElementChild;
    const outgoingElement = outgoing ? incoming?.previousElementSibling : null;
    const timing = canAnimate() ? readProgressRollTiming() : null;
    if (!timing || !(incoming instanceof HTMLElement)) {
      // A swap: the one that was on screen goes before the next paint.
      if (outgoing) void Promise.resolve().then(() => settle(outgoing.id));
      return;
    }
    const motion = progressRollMotion(prefersReducedMotion());
    const options = { duration: timing.durationMs, easing: timing.easing };

    if (outgoing && outgoingElement instanceof HTMLElement) {
      // From where it stands, then its coming-in (if any) is stopped:
      // the same task, so no frame shows it back at its place.
      const style = getComputedStyle(outgoingElement);
      const from = { transform: style.transform, opacity: style.opacity };
      running.get(outgoing.id)?.cancel();
      // Held out of the line until the commit that drops it.
      const out = outgoingElement.animate(progressRollOut(motion, from), {
        ...options,
        fill: "forwards",
      });
      running.set(outgoing.id, out);
      void out.finished.then(
        () => {
          if (running.get(outgoing.id) === out) running.delete(outgoing.id);
          settle(outgoing.id);
        },
        // Nothing here cancels a sentence on its way out.
        () => {},
      );
    } else if (outgoing) {
      void Promise.resolve().then(() => settle(outgoing.id));
    }

    const comeIn = incoming.animate(progressRollIn(motion), options);
    running.set(current.id, comeIn);
    void comeIn.finished.then(
      () => {
        if (running.get(current.id) === comeIn) running.delete(current.id);
      },
      // Cancelled: a newer sentence turned it round.
      () => {},
    );
  }, [roll]);

  return { roll, boxRef };
}
