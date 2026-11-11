import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import { prefersReducedMotion } from "@/lib/animate-scroll";
import type { TodoButtonShape, TodoCapsule } from "@/lib/todo-button";
import {
  TODO_GLIDE_STYLE,
  readTodoGlideTiming,
  todoCountNext,
  todoCountSettle,
  todoCountStart,
  todoWidthGlides,
  type TodoCountMotion,
} from "@/lib/todo-button-motion";

/*
 * The top bar's 「待办」 button moving when today's count changes (main
 * chat ticket 162, PRD ruling 208 point 4; the rules in
 * lib/todo-button-motion.ts). The number's tick is a class
 * TodoToggleButton puts on an element keyed by the changes; the width's
 * glide is a Web Animation of the button's own `width`, from the width
 * it had to the one it takes, measured in the commit that brings the
 * change: the hand-off's way (hooks/useProgressRoll.ts), so it plays in
 * the app's WebKit and in WebView2 alike, with no CSS WebKit lacks
 * (`interpolate-size`, `calc-size()`).
 */

/** Web Animations on the page (the app's WebKit; not jsdom). */
function canAnimate(): boolean {
  return (
    typeof Element !== "undefined" &&
    typeof Element.prototype.animate === "function"
  );
}

/** The button's width as laid out, px: its border box, mid-glide where
 * the glide has it, and not the bounding box — the catch's pop scales
 * the whole button (`todo-catch-pop`) and must not be read as width.
 * Null where nothing is laid out (jsdom). */
function laidOutWidth(el: HTMLElement): number | null {
  const width = parseFloat(getComputedStyle(el).width);
  return Number.isFinite(width) && width > 0 ? width : null;
}

/** A part's inline style while the button glides. */
const BODY_GLIDE_STYLE = ["flex-shrink", "width"] as const;

function setGlideStyle(el: HTMLElement): void {
  for (const [name, value] of Object.entries(TODO_GLIDE_STYLE)) {
    el.style.setProperty(name, value);
  }
}

/** The button and its capsule's row back to their classes alone. */
function unsetGlideStyle(el: HTMLElement): void {
  for (const name of Object.keys(TODO_GLIDE_STYLE)) {
    el.style.removeProperty(name);
  }
  const body = liveBody(el);
  if (body)
    for (const name of BODY_GLIDE_STYLE) body.style.removeProperty(name);
}

/** What is on its way out, drawn while the button narrows
 * (TodoToggleButton marks them): the number, the capsule's row. */
const LEAVING = "[data-todo-count-leaving], [data-todo-capsule-leaving]";

/** The capsule's row on the button now (not one leaving). */
function liveBody(el: HTMLElement): HTMLElement | null {
  return el.querySelector<HTMLElement>("[data-capsule-body]");
}

/** Shown: not `display: none` (the narrow header's classes, or set
 * here). */
function drawn(el: Element): boolean {
  return el.getClientRects().length > 0;
}

/**
 * The button's motion, and the ref for the button. The button draws
 * today's count — or, while it leaves, `motion.leaving.count` with
 * `data-todo-count-leaving` — in an element keyed by `motion.ticks`,
 * ticking from the first change on (`motion.ticks > 0`); and, while it
 * leaves, the capsule's row (`motion.leaving.capsule`) with
 * `data-todo-capsule-leaving`, placed where the row was (TodoToggleButton
 * `LeavingCapsule`).
 *
 * The width before a change is kept as it was last laid out: after
 * every change, and by a ResizeObserver between them — a narrower
 * header folds the capsule and drops the word without this component
 * rendering; the capsule's row too, so the row that leaves is drawn at
 * the width it had. A change mid-glide turns it round from where it
 * stands. While the button glides, the capsule's row it ends with is
 * laid out at the width it ends at, so the edge only cuts it; a capsule
 * that leaves keeps its frame on the button, fading to the look it ends
 * as; the word coming in where that row was fades in under it. The
 * glide and every inline style (`TODO_GLIDE_STYLE`) are there only while
 * it runs, so at rest the button is exactly as before.
 */
export function useTodoButtonMotion(
  count: number | null,
  shape: TodoButtonShape,
  capsule: TodoCapsule | null,
): {
  motion: TodoCountMotion;
  buttonRef: RefObject<HTMLButtonElement | null>;
} {
  const [motion, setMotion] = useState(() =>
    todoCountStart(count, shape, capsule),
  );
  // Guarded setState-in-render: what leaves has to be on the page in
  // the same commit as the change, so the glide starts with it.
  const next = todoCountNext(
    motion,
    count,
    shape,
    capsule,
    canAnimate() && !prefersReducedMotion(),
  );
  if (next !== motion) setMotion(next);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // The width as last laid out at rest, px.
  const widthRef = useRef<number | null>(null);
  // The capsule's row as last laid out (null while none is drawn).
  const bodyWidthRef = useRef<number | null>(null);
  // The glide running, if any.
  const glideRef = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    const record = () => {
      widthRef.current = laidOutWidth(el);
      const body = liveBody(el);
      bodyWidthRef.current = body ? laidOutWidth(body) : null;
    };
    record();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!glideRef.current) record();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { ticks, leaving } = motion;
  useLayoutEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    const running = glideRef.current;
    // Where it stands: mid-glide where the glide has it (read before the
    // glide is stopped, the same task, so no frame shows the jump).
    const from = running ? laidOutWidth(el) : widthRef.current;
    const midway = running ? getComputedStyle(el) : null;
    const frameFrom = midway && {
      color: midway.borderTopColor,
      // A pill's 9999px is drawn as half its height.
      radius: `${Math.min(
        parseFloat(midway.borderTopLeftRadius) || 0,
        (parseFloat(midway.height) || 0) / 2,
      )}px`,
    };
    if (running) {
      glideRef.current = null;
      running.cancel();
    }
    unsetGlideStyle(el);
    // Where it goes: laid out without what leaves.
    const gone = [...el.querySelectorAll<HTMLElement>(LEAVING)];
    for (const part of gone) part.style.display = "none";
    const to = laidOutWidth(el);
    const body = liveBody(el);
    const bodyTo = body ? laidOutWidth(body) : null;
    const ends = getComputedStyle(el);
    const frameTo = {
      color: ends.borderTopColor,
      radius: ends.borderTopLeftRadius,
      height: parseFloat(ends.height),
    };
    for (const part of gone) part.style.removeProperty("display");
    const bodyFrom = bodyWidthRef.current;
    widthRef.current = to;
    bodyWidthRef.current = bodyTo;
    const timing =
      canAnimate() && !prefersReducedMotion() ? readTodoGlideTiming() : null;
    const settle = () => setMotion(todoCountSettle);
    if (!timing || !todoWidthGlides(from, to)) {
      if (leaving) {
        for (const part of gone) part.style.display = "none";
        void Promise.resolve().then(settle);
      }
      return;
    }
    setGlideStyle(el);
    // The row it ends with, laid out as it ends up: the edge cuts it on
    // the way, its ellipsis (if any) already where it stays.
    if (body && bodyTo !== null) {
      body.style.setProperty("flex-shrink", "0");
      body.style.setProperty("width", `${bodyTo}px`);
    }
    const keyframes: PropertyIndexedKeyframes = {
      width: [`${from}px`, `${to}px`],
    };
    // The capsule that leaves (shown: the header is wide enough for it):
    // its row at the width it had, its frame on the button — the
    // hairline and the round ends, following the width — fading to the
    // look it ends as.
    const row = el.querySelector<HTMLElement>("[data-todo-capsule-leaving]");
    const frameLeaves = !!row && drawn(row);
    if (row && bodyFrom !== null) row.style.width = `${bodyFrom}px`;
    if (frameLeaves) {
      // From the capsule's hairline and round ends — or, turned round
      // mid-glide, from where the frame stood.
      el.style.setProperty("border-color", "var(--color-line)");
      const line = getComputedStyle(el).borderTopColor;
      el.style.removeProperty("border-color");
      const round = Number.isFinite(frameTo.height)
        ? `${frameTo.height / 2}px`
        : "9999px";
      keyframes.borderColor = [frameFrom?.color ?? line, frameTo.color];
      keyframes.borderRadius = [frameFrom?.radius ?? round, frameTo.radius];
    }
    const options = { duration: timing.durationMs, easing: timing.easing };
    const glide = el.animate(keyframes, options);
    glideRef.current = glide;
    for (const part of gone) {
      // Faded as it is cut, from wherever an earlier glide left it.
      part.animate(
        { opacity: [getComputedStyle(part).opacity || "1", "0"] },
        { ...options, fill: "forwards" },
      );
    }
    if (frameLeaves) {
      // The word coming in where the row was fades in under it.
      el.querySelector("[data-todo-word]")?.animate(
        { opacity: ["0", "1"] },
        options,
      );
    }
    void glide.finished.then(
      () => {
        if (glideRef.current !== glide) return;
        glideRef.current = null;
        // Out of the layout before the glide's width lets go, the same
        // task: the button must not spring back to hold it for the frame
        // before the commit that drops it.
        for (const part of gone) part.style.display = "none";
        unsetGlideStyle(el);
        widthRef.current = laidOutWidth(el);
        const now = liveBody(el);
        bodyWidthRef.current = now ? laidOutWidth(now) : null;
        settle();
      },
      // Cancelled: a newer change turned it round.
      () => {},
    );
  }, [ticks, leaving, motion.count, motion.shape]);

  return { motion, buttonRef };
}
