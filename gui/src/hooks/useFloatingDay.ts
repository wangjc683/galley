import { useEffect, useState, type RefObject } from "react";

import { useDayStamp } from "@/hooks/useDayStamp";
import { floatingDayLabel, topRowAt } from "@/lib/floating-day";
import { useCopy, useLanguage } from "@/lib/i18n";
import { localDayStart } from "@/lib/message-time";

/** How long the capsule stays after the last scroll, in ms. */
export const FLOATING_DAY_IDLE_MS = 1000;

/**
 * The main chat's floating day (main chat PRD ruling 171, ticket 124),
 * the wiring: on a scroll of the conversation, read the day of the row
 * at the top of the viewport (once a frame at most, lib/floating-day.ts
 * `topRowAt`) and show it until FLOATING_DAY_IDLE_MS after the last
 * one. Reads the scroll position, never writes it.
 *
 * Not shown:
 *   - while that row is today (or later: a skewed clock) — reading the
 *     latest reply at the bottom you scroll a little all the time, and
 *     「今天」 flashing at the top each time is noise; leaving today is
 *     when it says something;
 *   - while the conversation follows its bottom (`atBottom`,
 *     useStickyScroll's): the scrolls then are Galley's own, not yours —
 *     the landing on the bottom when the main chat opens, on a session
 *     switch or back from the workbench (and its re-snaps over the
 *     following 500ms), following a reply as it grows, keeping the
 *     bottom in view as the composer grows. Scrolling away from the
 *     bottom is yours, and so are ⌘K's locate, ⌥↑ / ⌥↓ and the chase of
 *     「回到底部」 on their way: each leaves the bottom, so a day it
 *     lands on shows; reaching the bottom puts it away.
 *
 * `text` stays on the last day shown while the capsule fades out.
 */
export function useFloatingDay({
  scrollContainerRef,
  atBottom,
}: {
  /** The main chat's scroll container (useStickyScroll's). */
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  /** useStickyScroll's `atBottom`: following the bottom. */
  atBottom: boolean;
}): { text: string | null; shown: boolean } {
  const todayStartMs = useDayStamp();
  const language = useLanguage();
  const copy = useCopy();
  // The local midnight of the top row's day, as last read; null when
  // there was no row with a moment.
  const [day, setDay] = useState<number | null>(null);
  // A scroll within the last FLOATING_DAY_IDLE_MS.
  const [scrolling, setScrolling] = useState(false);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    let frame: number | null = null;
    let idle: number | null = null;
    // What the state holds, so an unchanged day sets nothing.
    let lastDay: number | null = null;
    let active = false;
    const read = () => {
      frame = null;
      const at = topRowAt(el);
      const next = at === null ? null : localDayStart(at);
      if (next !== lastDay) {
        lastDay = next;
        setDay(next);
      }
      if (!active) {
        active = true;
        setScrolling(true);
      }
      if (idle !== null) window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        idle = null;
        active = false;
        setScrolling(false);
      }, FLOATING_DAY_IDLE_MS);
    };
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(read);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
      if (idle !== null) window.clearTimeout(idle);
    };
  }, [scrollContainerRef]);

  const label = floatingDayLabel(day, todayStartMs, language, {
    today: copy.todo.dayToday,
    yesterday: copy.todo.dayYesterday,
  });
  // The words it fades out with once the top row is today again.
  const [lastLabel, setLastLabel] = useState<string | null>(null);
  if (label !== null && label !== lastLabel) setLastLabel(label);
  return {
    text: label ?? lastLabel,
    shown: scrolling && !atBottom && label !== null,
  };
}
