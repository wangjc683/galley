import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import { prefersReducedMotion } from "@/lib/animate-scroll";
import type { TodoButtonShape } from "@/lib/todo-button";
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

function setGlideStyle(el: HTMLElement): void {
  for (const [name, value] of Object.entries(TODO_GLIDE_STYLE)) {
    el.style.setProperty(name, value);
  }
}

function unsetGlideStyle(el: HTMLElement): void {
  for (const name of Object.keys(TODO_GLIDE_STYLE)) {
    el.style.removeProperty(name);
  }
}

/** The number on its way out, drawn while the button narrows
 * (TodoToggleButton marks it). */
const LEAVING_ATTR = "data-todo-count-leaving";

/**
 * The button's motion, and the ref for the button. The button draws
 * today's count — or, while it leaves, `motion.leaving` with
 * `data-todo-count-leaving` — in an element keyed by `motion.ticks`,
 * ticking from the first change on (`motion.ticks > 0`).
 *
 * The width before a change is kept as it was last laid out: after
 * every change, and by a ResizeObserver between them — a narrower
 * header folds the capsule and drops the word without this component
 * rendering. A change mid-glide turns it round from where it stands.
 * The glide and its inline style (`TODO_GLIDE_STYLE`) are there only
 * while it runs, so at rest the button is exactly as before.
 */
export function useTodoButtonMotion(
  count: number | null,
  shape: TodoButtonShape,
): {
  motion: TodoCountMotion;
  buttonRef: RefObject<HTMLButtonElement | null>;
} {
  const [motion, setMotion] = useState(() => todoCountStart(count, shape));
  // Guarded setState-in-render: the number that leaves has to be on the
  // page in the same commit as the change, so the glide starts with it.
  if (count !== motion.count || shape !== motion.shape) {
    setMotion(
      todoCountNext(
        motion,
        count,
        shape,
        canAnimate() && !prefersReducedMotion(),
      ),
    );
  }
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  // The width as last laid out at rest, px.
  const widthRef = useRef<number | null>(null);
  // The glide running, if any.
  const glideRef = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    widthRef.current = laidOutWidth(el);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!glideRef.current) widthRef.current = laidOutWidth(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    const running = glideRef.current;
    // Where it stands: mid-glide where the glide has it (read before the
    // glide is stopped, the same task, so no frame shows the jump).
    const from = running ? laidOutWidth(el) : widthRef.current;
    if (running) {
      glideRef.current = null;
      running.cancel();
    }
    unsetGlideStyle(el);
    // Where it goes: laid out without the number that leaves.
    const leaving = el.querySelector<HTMLElement>(`[${LEAVING_ATTR}]`);
    if (leaving) leaving.style.display = "none";
    const to = laidOutWidth(el);
    if (leaving) leaving.style.removeProperty("display");
    widthRef.current = to;
    const timing =
      canAnimate() && !prefersReducedMotion() ? readTodoGlideTiming() : null;
    const settle = () => setMotion(todoCountSettle);
    if (!timing || !todoWidthGlides(from, to)) {
      if (motion.leaving) void Promise.resolve().then(settle);
      return;
    }
    setGlideStyle(el);
    const options = { duration: timing.durationMs, easing: timing.easing };
    const glide = el.animate({ width: [`${from}px`, `${to}px`] }, options);
    glideRef.current = glide;
    if (leaving) {
      // Faded as it is cut, from wherever an earlier glide left it.
      leaving.animate(
        { opacity: [getComputedStyle(leaving).opacity || "1", "0"] },
        { ...options, fill: "forwards" },
      );
    }
    void glide.finished.then(
      () => {
        if (glideRef.current !== glide) return;
        glideRef.current = null;
        // Out of the layout before the glide's width lets go, the same
        // task: the button must not spring back to hold it for the frame
        // before the commit that drops it.
        if (leaving) leaving.style.display = "none";
        unsetGlideStyle(el);
        widthRef.current = laidOutWidth(el);
        settle();
      },
      // Cancelled: a newer change turned it round.
      () => {},
    );
  }, [motion]);

  return { motion, buttonRef };
}
