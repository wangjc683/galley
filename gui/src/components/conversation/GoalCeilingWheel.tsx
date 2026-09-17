import { useEffect, useRef } from "react";

import {
  GOAL_BUDGET_LADDER,
  DEFAULT_GOAL_BUDGET_MINUTES,
  type GoalBudgetMinutes,
} from "@/lib/goals";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const ROW_PX = 28;
// Five, not three: three fully visible, evenly spaced rows read as a
// three-item menu on the desktop (JC, live app 2026-09-17). Five rows
// with the outer ones fading out is the flat translation of the iOS
// wheel's tilted edges — the "there is more above and below" cue.
const VISIBLE_ROWS = 5;
const CENTER_ROW = Math.floor(VISIBLE_ROWS / 2);

/**
 * iPhone-timer style ceiling wheel (ticket 10): the
 * 10-minute ladder plus "no ceiling" in a five-row snap-scrolling
 * column, centre row highlighted, outer rows fading out, selection =
 * wherever the scroll settles. CSS scroll-snap does the physics; a short debounce on
 * `scroll` decides when it has settled (WebKit's `scrollend` is not
 * reliable across both Tauri webviews yet).
 */
export function GoalCeilingWheel({
  value,
  onChange,
}: {
  value: GoalBudgetMinutes;
  onChange: (next: GoalBudgetMinutes) => void;
}) {
  const copy = useCopy();
  const listRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | null>(null);

  // Park the wheel on the current value when it mounts (popover open).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const index = Math.max(0, GOAL_BUDGET_LADDER.indexOf(value));
    el.scrollTop = index * ROW_PX;
    // Mount-only: later scrolls are the user's, and syncing them back
    // would fight the snap animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = () => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = listRef.current;
      if (!el) return;
      const index = Math.min(
        GOAL_BUDGET_LADDER.length - 1,
        Math.max(0, Math.round(el.scrollTop / ROW_PX)),
      );
      const next = GOAL_BUDGET_LADDER[index];
      if (next !== value) onChange(next);
    }, 90);
  };

  return (
    <div
      className="relative"
      style={{ height: ROW_PX * VISIBLE_ROWS, width: 128 }}
      role="listbox"
      aria-label={copy.composer.goalCeilingLabel}
    >
      {/* Centre band: the "selected" window the rows snap into. It is
          painted first and the list below is positioned, so the band
          sits behind the text instead of covering the chosen row. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-1 rounded-sm bg-hover"
        style={{ top: ROW_PX * CENTER_ROW, height: ROW_PX }}
      />
      <div
        ref={listRef}
        onScroll={handleScroll}
        className={cn(
          "relative h-full snap-y snap-mandatory overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          // Edge fade over the outer rows (mask, so the centre band and
          // text fade together).
          "[mask-image:linear-gradient(to_bottom,transparent,black_30%,black_70%,transparent)]",
        )}
        style={{
          paddingTop: ROW_PX * CENTER_ROW,
          paddingBottom: ROW_PX * CENTER_ROW,
        }}
      >
        {GOAL_BUDGET_LADDER.map((minutes, index) => {
          const selected = minutes === value;
          const label =
            minutes === null
              ? copy.composer.goalDurationNoCeiling
              : copy.composer.goalDurationOption(minutes);
          return (
            <div
              key={minutes ?? "none"}
              role="option"
              aria-selected={selected}
              onClick={() =>
                listRef.current?.scrollTo({
                  top: index * ROW_PX,
                  behavior: "smooth",
                })
              }
              className={cn(
                "flex snap-center items-center justify-center text-[12.5px] tabular-nums",
                selected ? "text-ink" : "text-ink-muted",
              )}
              style={{ height: ROW_PX }}
            >
              {label}
              {minutes === DEFAULT_GOAL_BUDGET_MINUTES && (
                <span className="ml-1.5 text-[10.5px] text-ink-muted">
                  {copy.composer.goalDurationRecommended}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
