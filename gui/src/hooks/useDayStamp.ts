import { useEffect, useState } from "react";

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Milliseconds from `nowMs` to the next local midnight. Built from the
 * calendar (`new Date(y, m, d + 1)`), not `+24h`: a DST day is 23 or 25
 * hours long.
 */
export function msUntilNextLocalMidnight(nowMs: number): number {
  const now = new Date(nowMs);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - nowMs;
}

/**
 * Returns the local-midnight timestamp of the current day, updating
 * itself when the day rolls over.
 *
 * Why it exists: sidebar time buckets (今天 / 本周) and the other
 * day-relative labels capture `now` inside memoized grouping functions
 * whose deps are only the data arrays. Galley is designed to sit open
 * all day monitoring background agents — after midnight, yesterday's
 * sessions stayed under 今天 until an unrelated mutation happened to
 * retrigger the memo. Including this stamp in the memo deps makes the
 * rollover an explicit re-render.
 *
 * The timer re-arms after every fire, whether or not the stamp changed
 * (a timer that fires early must not end the loop), and adds a 1s pad
 * so clock skew around 00:00:00 can't schedule a zero-delay loop.
 */
export function useDayStamp(): number {
  const [stamp, setStamp] = useState(startOfTodayMs);
  useEffect(() => {
    let id = 0;
    const arm = () => {
      id = window.setTimeout(
        () => {
          setStamp(startOfTodayMs());
          arm();
        },
        msUntilNextLocalMidnight(Date.now()) + 1000,
      );
    };
    arm();
    return () => window.clearTimeout(id);
  }, []);
  return stamp;
}
