import { useEffect, useState } from "react";

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Returns the local-midnight timestamp of the current day, updating
 * itself when the day rolls over.
 *
 * Why it exists: sidebar time buckets (今天 / 本周) and Project
 * Review's 7-day activity split capture `now` inside memoized
 * grouping functions whose deps are only the data arrays. Galley is
 * designed to sit open all day monitoring background agents — after
 * midnight, yesterday's sessions stayed under 今天 until an unrelated
 * mutation happened to retrigger the memo. Including this stamp in
 * the memo deps makes the rollover an explicit re-render.
 *
 * The timer re-arms after each fire ([stamp] dep) and adds a 1s pad
 * so clock skew around 00:00:00 can't schedule a zero-delay loop.
 */
export function useDayStamp(): number {
  const [stamp, setStamp] = useState(startOfTodayMs);
  useEffect(() => {
    const msUntilRollover =
      stamp + 24 * 60 * 60 * 1000 - Date.now() + 1000;
    const id = window.setTimeout(
      () => setStamp(startOfTodayMs()),
      Math.max(msUntilRollover, 1000),
    );
    return () => window.clearTimeout(id);
  }, [stamp]);
  return stamp;
}
