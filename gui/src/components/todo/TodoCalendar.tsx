import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { IconButton } from "@/components/ui/button";
import { useCopy } from "@/lib/i18n";
import {
  addMonths,
  calendarKeyMove,
  dayKey,
  monthGrid,
  monthOf,
  parseDay,
  type DayKey,
  type MonthCursor,
} from "@/lib/todo-date";
import { cn } from "@/lib/utils";

/** Whether `day` is in `month`. */
function inMonth(day: DayKey | null, month: MonthCursor): day is DayKey {
  if (!day) return false;
  const of = monthOf(day);
  return of.year === month.year && of.month === month.month;
}

/**
 * The date popover's month (main chat ticket 156, PRD ruling 205): drawn
 * here, no library — the same on the Mac and on Windows, the quick picks
 * beside it. Monday first; ‹ › turn the month; today in brand ink, the day
 * picked on a brand tint (the scheduled-tasks dialog's chosen day chip,
 * `border-brand/40 bg-brand/15 text-brand-strong`). It only picks a day:
 * no lunar calendar, no holidays.
 *
 * Keyboard: one day is in the Tab order (the day picked, else today, else
 * the month's 1st — in the month shown); the arrows move it a day or a
 * week, PageUp / PageDown a month, across months as they go; Enter or
 * Space picks it; Esc is the popover's (it closes). The date arithmetic
 * is lib/todo-date.ts's.
 */
export function TodoCalendar({
  selected,
  today,
  onPick,
  disabled = false,
}: {
  /** The due day, or none. */
  selected: DayKey | null;
  today: DayKey;
  onPick: (day: DayKey) => void;
  /** A pick on its way: the days do nothing until it is back. */
  disabled?: boolean;
}) {
  const copy = useCopy();
  const words = copy.todo.date;
  const [month, setMonth] = useState<MonthCursor>(() =>
    monthOf(selected ?? today),
  );
  // The day the keyboard is on; null until an arrow moves it.
  const [focusDay, setFocusDay] = useState<DayKey | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  // Set by a key that moved the day: the cell takes the focus once it
  // is drawn.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current
      ?.querySelector<HTMLElement>(
        '[data-role="todo-calendar-day"][tabindex="0"]',
      )
      ?.focus();
  });

  const tabDay: DayKey = inMonth(focusDay, month)
    ? focusDay
    : inMonth(selected, month)
      ? selected
      : inMonth(today, month)
        ? today
        : dayKey(month.year, month.month, 1);

  const turn = (n: number) => {
    setMonth((now) => addMonths(now, n));
    setFocusDay(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!disabled) onPick(tabDay);
      return;
    }
    const next = calendarKeyMove(tabDay, event.key);
    if (!next) return;
    event.preventDefault();
    moved.current = true;
    setFocusDay(next);
    setMonth(monthOf(next));
  };

  const rows = monthGrid(month);
  return (
    <div data-role="todo-calendar">
      <div className="flex h-7 items-center justify-between">
        <IconButton
          ariaLabel={words.previousMonth}
          size="sm"
          tooltip={false}
          onClick={() => turn(-1)}
        >
          <CaretLeft size={14} weight="thin" />
        </IconButton>
        <span
          data-role="todo-calendar-month"
          aria-live="polite"
          className="text-[12.5px] font-medium tabular-nums text-ink"
        >
          {words.monthTitle(month.year, month.month)}
        </span>
        <IconButton
          ariaLabel={words.nextMonth}
          size="sm"
          tooltip={false}
          onClick={() => turn(1)}
        >
          <CaretRight size={14} weight="thin" />
        </IconButton>
      </div>
      <div
        aria-hidden
        className="mt-1 grid grid-cols-7 text-center text-[11px] leading-5 text-ink-muted"
      >
        {[1, 2, 3, 4, 5, 6, 7].map((day) => (
          <span key={day}>{words.weekdayHead(day)}</span>
        ))}
      </div>
      <div
        ref={grid}
        role="group"
        aria-label={words.monthTitle(month.year, month.month)}
        className="mt-0.5 grid grid-cols-7 gap-y-0.5"
      >
        {rows.flat().map((day, index) => {
          if (!day) return <span key={`blank-${index}`} aria-hidden />;
          const parts = parseDay(day)!;
          const isSelected = day === selected;
          const isToday = day === today;
          return (
            <button
              key={day}
              type="button"
              data-role="todo-calendar-day"
              data-day={day}
              data-today={isToday ? "" : undefined}
              aria-label={words.dayName(parts.year, parts.month, parts.day)}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              tabIndex={day === tabDay ? 0 : -1}
              onClick={() => {
                if (!disabled) onPick(day);
              }}
              onKeyDown={onKeyDown}
              onFocus={() => {
                if (day !== tabDay) setFocusDay(day);
              }}
              className={cn(
                "mx-auto flex h-7 w-8 items-center justify-center rounded-sm border text-[12px] tabular-nums outline-none",
                "focus-visible:ring-2 focus-visible:ring-brand/30",
                isSelected
                  ? "border-brand/40 bg-brand/15 font-medium text-brand-strong"
                  : cn(
                      "border-transparent hover:bg-hover",
                      isToday
                        ? "font-medium text-brand-strong"
                        : "text-ink-soft",
                    ),
              )}
            >
              {parts.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
