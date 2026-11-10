import * as Popover from "@radix-ui/react-popover";
import { CaretDown } from "@phosphor-icons/react";
import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useDayStamp } from "@/hooks/useDayStamp";
import {
  scheduleTime,
  todoFailureText,
  type TodoChange,
  type TodoFailure,
  type TodoItem,
  type TodoRepeat,
  type TodoRepeatRemind,
} from "@/lib/assistant-todo";
import { useCopy, useLanguage } from "@/lib/i18n";
import {
  addDays,
  dueTime,
  dueWrite,
  newReminderTime,
  nextMonday,
  periodReminder,
  REMIND_DAY_CHOICES,
  repeatChoice,
  repeatRuleFor,
  timeValue,
  todayKey,
  todoRepeatWords,
  type DayKey,
  type RepeatChoice,
} from "@/lib/todo-date";
import { yourTodos } from "@/lib/todo-panel";
import { cn } from "@/lib/utils";
import { useAssistantTodoStore } from "@/stores/assistant-todo";

import { TodoCalendar } from "./TodoCalendar";

/**
 * The open row's time line as the way to change when (main chat ticket
 * 156, PRD ruling 205; overturns ruling 153 point 5, where it quoted the
 * to-do into Galley's composer): a button that opens the date popover —
 * 「改日期」 on hover — or, for a to-do with neither a due date nor a
 * reminder, 「添加日期」 in its place (`empty`, 12px `ink-muted` as
 * 「添加备注」, no hover text: it says what it does). The popover is a
 * Radix Popover in DisplayMenu's shell (`galley-pop-in`, `bg-elevated`,
 * `border-line`, `rounded-md`, `shadow-elevated`), under the line and
 * moving aside where the panel is narrow; Esc and a click outside close
 * it, and the focus goes back to this button.
 *
 * Since main chat ticket 157 (the main session's walk of the real window):
 * closing the popover never opens 「改日期」 — the focus handed back to
 * the button is not one the user moved there, so the tooltip, which opens
 * on focus, stays shut; it opens on a pointer's hover and on a focus the
 * user brings (Tab), never while the popover is open, and below the time
 * line, off the title above it. A close begun with the pointer (a day, a
 * quick pick) hands the focus back with no ring (`quietRing`, until the
 * focus moves or a key is pressed there); one begun from the keyboard (Esc,
 * Enter on a day) with its ring, as before. A press outside closes it and
 * leaves the focus where the press put it (Radix's own way).
 */
export function TodoDateButton({
  item,
  empty,
  children,
}: {
  item: TodoItem;
  /** No due date and no reminder: 「添加日期」. */
  empty: boolean;
  children: ReactNode;
}) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // 「改日期」, held shut while the focus is handed back (ticket 157).
  const [tip, setTip] = useState(false);
  const handingBack = useRef(false);
  // How the popover is left: a press in it or outside it, or a key.
  const closedBy = useRef<"pointer" | "keyboard">("keyboard");
  const pressedOutside = useRef(false);
  // The focus handed back after a pointer's close: no ring on it.
  const [quietRing, setQuietRing] = useState(false);
  const onOpenChange = (next: boolean) => {
    if (next) {
      closedBy.current = "keyboard";
      pressedOutside.current = false;
      setTip(false);
    }
    setOpen(next);
  };
  const button = (
    <Popover.Trigger asChild>
      <button
        ref={trigger}
        type="button"
        data-role={empty ? "todo-add-date" : "todo-meta-date"}
        data-ring={quietRing ? "quiet" : undefined}
        onBlur={() => setQuietRing(false)}
        onKeyDown={() => setQuietRing(false)}
        className={cn(
          "min-w-0 truncate rounded-sm text-left outline-none",
          !quietRing && "focus-visible:ring-2 focus-visible:ring-brand/30",
          empty && "text-ink-muted hover:text-ink-soft",
        )}
      >
        {children}
      </button>
    </Popover.Trigger>
  );
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {empty ? (
        button
      ) : (
        <TooltipLabel
          text={copy.todo.dateHint}
          side="bottom"
          align="start"
          open={tip && !open}
          onOpenChange={(next) => {
            // Not on the focus handed back as the popover closes.
            if (next && handingBack.current) return;
            setTip(next);
          }}
        >
          {button}
        </TooltipLabel>
      )}
      <Popover.Portal>
        <Popover.Content
          ref={content}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          aria-label={copy.todo.dateHint}
          data-role="todo-date-popover"
          onPointerDownCapture={() => {
            closedBy.current = "pointer";
          }}
          onKeyDownCapture={() => {
            closedBy.current = "keyboard";
          }}
          onInteractOutside={() => {
            pressedOutside.current = true;
          }}
          onCloseAutoFocus={(event) => {
            // The focus handed back here, not by Radix: so the tooltip
            // knows it is not the user's, and a pointer's close paints no
            // ring. A press outside keeps the focus where it went.
            event.preventDefault();
            if (pressedOutside.current) return;
            // Drawn without its ring before the focus lands on it.
            flushSync(() => setQuietRing(closedBy.current === "pointer"));
            handingBack.current = true;
            trigger.current?.focus();
            handingBack.current = false;
          }}
          onOpenAutoFocus={(event) => {
            // The month's day in the Tab order takes the focus, not the
            // first quick pick: the arrows move from there at once. A
            // pointer opening paints no ring (a script's focus after a
            // click is not :focus-visible).
            event.preventDefault();
            content.current
              ?.querySelector<HTMLElement>(
                '[data-role="todo-calendar-day"][tabindex="0"]',
              )
              ?.focus();
          }}
          className="galley-pop-in z-[70] w-64 rounded-md border border-line bg-elevated p-2 shadow-elevated"
        >
          <TodoDatePanel item={item} onClose={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Which block of the popover a write is from: its failure is said under
 * it. */
type Block = "date" | "time" | "remind" | "repeat";

/** When, as the popover draws it: the due day and its time. */
interface DueShown {
  day: DayKey;
  time: string | null;
}

/** A write on its way, drawn at once: `value` is what it will leave. The
 * box is its identity — a later write on the same block replaces it, and
 * the earlier one coming back does not drop the later one's. */
interface Pending<T> {
  value: T;
}

/** The fields' type: the scheduled-tasks dialog's `INPUT_CLASS`, smaller
 * (12px, 28px tall). */
const FIELD_CLASS = cn(
  "rounded-sm border border-line bg-app px-2 text-[12px] text-ink",
  "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

/** A row's name: 时刻 / 提醒 / 重复. */
const LABEL_CLASS = "text-[12px] leading-7 text-ink-muted";

/**
 * The popover's four blocks (ticket 156): the quick picks (今天, 明天,
 * 下周一, 不定日子), the month, then three rows — the time of day, the
 * reminder as 「提前几天 · 几点」, the rule's five choices.
 *
 * Picked is saved, no 确定 or 取消: a day (the month's or a quick pick's)
 * is written and the popover closes once Core has it; the time, the
 * reminder and the rule are written and it stays. A time field writes on
 * leaving it or on Enter, not at each keystroke; Esc there puts it back.
 * While a write is on its way the block draws what it will leave; failed,
 * the block is back as it was and says why under it (the open row's
 * edit failure: 「没能完成，再试一次。」, 「这件事已经不在了。」). A day
 * keeps the time of day the to-do had. What Core does with the reminder
 * (it moves with the day, a time already passed is not hung, a repeating
 * period's goes to the next time ahead) is Core's (`update_todo`); this
 * draws what comes back. The writes are this window's own: the row does
 * not light (`editing`).
 *
 * A repeating to-do (ticket 154): its day, time and reminder are the
 * period's own; only the rule's row changes the rule — 「不重复」 ends it
 * (`stop_todo_repeat`), the other four give it that rule from the due
 * date. A rule that is none of the four reads as itself, read only, with
 * 「改规则跟 Galley 说」 under it; picking one of the five replaces it. A
 * period cannot be without a due date: 「不定日子」 is off. Its reminder,
 * once Core moved it on to a later period's time (it went off and the
 * period stayed open, ticket 154 behaviour 13), reads as the rule's offset
 * (`periodReminder`, ticket 157), which Core moves it by when the day
 * changes; one set by hand on the period reads as it is.
 */
function TodoDatePanel({
  item,
  onClose,
}: {
  item: TodoItem;
  onClose: () => void;
}) {
  const copy = useCopy();
  const language = useLanguage();
  const words = copy.todo.date;
  const todayStartMs = useDayStamp();
  const today = todayKey(todayStartMs);
  const editTodo = useAssistantTodoStore((s) => s.editTodo);
  const stopTodoRepeat = useAssistantTodoStore((s) => s.stopTodoRepeat);
  const [pendingDue, setPendingDue] = useState<Pending<DueShown | null> | null>(
    null,
  );
  const [pendingRemind, setPendingRemind] =
    useState<Pending<TodoRepeatRemind | null> | null>(null);
  const [pendingRepeat, setPendingRepeat] =
    useState<Pending<TodoRepeat | null> | null>(null);
  const [picking, setPicking] = useState(false);
  const [failures, setFailures] = useState<Partial<Record<Block, TodoFailure>>>(
    {},
  );
  // A time field being typed in: null shows the time as it stands.
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  const [remindTimeDraft, setRemindTimeDraft] = useState<string | null>(null);
  // The reminder just picked was not hung, its time having passed
  // (ticket 157): said under its row until the next change.
  const [remindPassed, setRemindPassed] = useState(false);

  const due: DueShown | null = pendingDue
    ? pendingDue.value
    : item.due
      ? { day: item.due.date, time: dueTime(item.due) }
      : null;
  // A repeating period's reminder Core moved on to a later period's time
  // reads as its rule's offset (ticket 157), not 「到期后 7 天」.
  const remind = pendingRemind ? pendingRemind.value : periodReminder(item);
  const repeat = pendingRepeat
    ? pendingRepeat.value
    : (item.todoRepeat ?? null);
  const choice = repeatChoice(repeat ?? undefined);

  const fail = (block: Block, kind: TodoFailure | null) =>
    setFailures((now) => {
      if ((now[block] ?? null) === kind) return now;
      const next = { ...now };
      if (kind) next[block] = kind;
      else delete next[block];
      return next;
    });

  /** Write `change`, drawing `mine` meanwhile; null when it took. */
  const send = async <T,>(
    block: Block,
    mine: Pending<T>,
    hold: (pending: Pending<T> | null, only?: Pending<T>) => void,
    write: () => Promise<TodoFailure | null>,
  ): Promise<TodoFailure | null> => {
    hold(mine);
    fail(block, null);
    setRemindPassed(false);
    const failed = await write();
    hold(null, mine);
    if (failed) fail(block, failed);
    return failed;
  };

  const holdDue = (
    pending: Pending<DueShown | null> | null,
    only?: Pending<DueShown | null>,
  ) => setPendingDue((now) => (only && now !== only ? now : pending));
  const holdRemind = (
    pending: Pending<TodoRepeatRemind | null> | null,
    only?: Pending<TodoRepeatRemind | null>,
  ) => setPendingRemind((now) => (only && now !== only ? now : pending));
  const holdRepeat = (
    pending: Pending<TodoRepeat | null> | null,
    only?: Pending<TodoRepeat | null>,
  ) => setPendingRepeat((now) => (only && now !== only ? now : pending));

  const writeDue = (block: "date" | "time", next: DueShown | null) => {
    const change: TodoChange = {
      due: next ? dueWrite(next.day, next.time) : "",
    };
    return send(block, { value: next }, holdDue, () =>
      editTodo(item.id, change),
    );
  };

  // A day: saved, then closed; the time of day it had stays.
  const pickDay = async (day: DayKey | null) => {
    if (picking) return;
    if (day === (due?.day ?? null)) {
      onClose();
      return;
    }
    setPicking(true);
    const failed = await writeDue(
      "date",
      day ? { day, time: due?.time ?? null } : null,
    );
    setPicking(false);
    if (!failed) onClose();
  };

  const commitTime = (raw: string) => {
    setTimeDraft(null);
    const time = timeValue(raw);
    if (!due || !time || time === due.time) return;
    void writeDue("time", { day: due.day, time });
  };

  const writeRemind = async (next: TodoRepeatRemind | null) => {
    const failed = await send("remind", { value: next }, holdRemind, () =>
      editTodo(item.id, next ? { remind: next } : { noRemind: true }),
    );
    if (failed || !next) return;
    // A reminder asked for and none came back: Core hangs none whose time
    // has passed (ticket 156), and says nothing. A repeating period's it
    // hangs at a later time instead: nothing to say there.
    const now = yourTodos(useAssistantTodoStore.getState().todo).find(
      (each) => each.id === item.id,
    );
    if (now && !now.reminder && !now.todoRepeat) setRemindPassed(true);
  };

  const pickRemindDays = (value: string) => {
    if (!due) return;
    if (value === "none") {
      if (remind) void writeRemind(null);
      return;
    }
    const daysBefore = Number(value);
    if (remind?.daysBefore === daysBefore) return;
    const now = new Date();
    const time =
      remind?.time ??
      newReminderTime(
        due.time,
        addDays(due.day, -daysBefore),
        today,
        now.getHours() * 60 + now.getMinutes(),
      );
    void writeRemind({ daysBefore, time });
  };

  const commitRemindTime = (raw: string) => {
    setRemindTimeDraft(null);
    const time = timeValue(raw);
    if (!remind || !time || time === remind.time) return;
    void writeRemind({ daysBefore: remind.daysBefore, time });
  };

  const pickRepeat = (value: string) => {
    if (!due || value === choice) return;
    const next = value as RepeatChoice;
    if (next === "none") {
      if (!repeat) return;
      void send("repeat", { value: null }, holdRepeat, () =>
        stopTodoRepeat(item.id),
      );
      return;
    }
    const rule = repeatRuleFor(next, due.day);
    void send(
      "repeat",
      { value: { ...rule, remind: repeat?.remind } },
      holdRepeat,
      () => editTodo(item.id, { repeat: rule }),
    );
  };

  /** A time field's keys: Enter writes, Esc puts it back (and closes the
   * popover, Radix's). */
  const timeKeys =
    (commit: (raw: string) => void, reset: () => void) =>
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit(event.currentTarget.value);
      } else if (event.key === "Escape") {
        reset();
      }
    };

  const remindListed =
    remind !== null && REMIND_DAY_CHOICES.includes(remind.daysBefore);
  // A reminder on a to-do with no due date has no days before anything:
  // the row (off without a due date) says its time as the time line does.
  const floating =
    !due && item.reminder
      ? scheduleTime(item.reminder.at, todayStartMs, language, copy)
      : null;

  return (
    <div data-role="todo-date-panel">
      <div className="flex flex-wrap gap-0.5" data-role="todo-date-quick">
        {(
          [
            ["today", words.today, today],
            ["tomorrow", words.tomorrow, addDays(today, 1)],
            ["next-monday", words.nextMonday, nextMonday(today)],
          ] as const
        ).map(([key, label, day]) => (
          <Button
            key={key}
            variant="ghost"
            size="sm"
            data-quick={key}
            className="px-2"
            disabled={picking}
            onClick={() => void pickDay(day)}
          >
            {label}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          data-quick="no-date"
          className="px-2"
          // A period of a rule keeps a due date (`repeat_needs_due:`); one
          // with none has nothing to take away (ticket 157).
          disabled={picking || repeat !== null || !due}
          onClick={() => void pickDay(null)}
        >
          {words.noDate}
        </Button>
      </div>
      <div className="-mx-2 my-2 border-t border-line" />
      <TodoCalendar
        selected={due?.day ?? null}
        today={today}
        onPick={(day) => void pickDay(day)}
        disabled={picking}
      />
      {failures.date && <BlockFailure kind={failures.date} />}
      <div className="-mx-2 my-2 border-t border-line" />
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
        <span className={LABEL_CLASS}>{words.time}</span>
        <div className="flex min-w-0 items-center gap-1">
          <input
            type="time"
            aria-label={words.time}
            data-role="todo-date-time"
            disabled={!due}
            value={timeDraft ?? due?.time ?? ""}
            onChange={(event) => setTimeDraft(event.target.value)}
            onBlur={(event) => {
              if (timeDraft !== null) commitTime(event.currentTarget.value);
            }}
            onKeyDown={timeKeys(commitTime, () => setTimeDraft(null))}
            className={cn(FIELD_CLASS, "h-7 w-[84px] tabular-nums")}
          />
          <Button
            variant="ghost"
            size="sm"
            data-role="todo-date-no-time"
            className="px-2"
            disabled={!due?.time}
            onClick={() => {
              if (due?.time)
                void writeDue("time", { day: due.day, time: null });
            }}
          >
            {words.noTime}
          </Button>
        </div>
        {failures.time && (
          <BlockFailure kind={failures.time} className="col-start-2" />
        )}

        <span className={LABEL_CLASS}>{words.remind}</span>
        <div className="flex min-w-0 items-center gap-1">
          <PopoverSelect
            ariaLabel={words.remind}
            role="todo-date-remind"
            disabled={!due}
            value={
              remind
                ? String(remind.daysBefore)
                : floating
                  ? "floating"
                  : "none"
            }
            onChange={pickRemindDays}
          >
            {floating && <option value="floating">{floating}</option>}
            <option value="none">{words.noRemind}</option>
            {REMIND_DAY_CHOICES.map((days) => (
              <option key={days} value={String(days)}>
                {words.remindDays(days)}
              </option>
            ))}
            {/* Read off a reminder that is none of the choices (5 days
                before, a day after): said as it is, the choices still
                there to change it. */}
            {remind && !remindListed && (
              <option value={String(remind.daysBefore)}>
                {words.remindDays(remind.daysBefore)}
              </option>
            )}
          </PopoverSelect>
          {remind && due && (
            <>
              <span aria-hidden className="text-[12px] text-ink-muted">
                ·
              </span>
              <input
                type="time"
                aria-label={words.remindTime}
                data-role="todo-date-remind-time"
                value={remindTimeDraft ?? remind.time}
                onChange={(event) => setRemindTimeDraft(event.target.value)}
                onBlur={(event) => {
                  if (remindTimeDraft !== null) {
                    commitRemindTime(event.currentTarget.value);
                  }
                }}
                onKeyDown={timeKeys(commitRemindTime, () =>
                  setRemindTimeDraft(null),
                )}
                className={cn(FIELD_CLASS, "h-7 w-[84px] tabular-nums")}
              />
            </>
          )}
        </div>
        {failures.remind && (
          <BlockFailure kind={failures.remind} className="col-start-2" />
        )}
        {remindPassed && (
          <p
            data-role="todo-date-remind-passed"
            className="col-start-2 -mt-0.5 text-[11.5px] leading-[1.45] text-ink-muted"
          >
            {words.remindPassed}
          </p>
        )}

        <span className={LABEL_CLASS}>{words.repeat}</span>
        <div className="flex min-w-0 items-center">
          <PopoverSelect
            ariaLabel={words.repeat}
            role="todo-date-repeat"
            disabled={!due}
            value={choice}
            onChange={pickRepeat}
          >
            {/* A rule none of the five: itself, in words, read only. */}
            {choice === "other" && repeat && (
              <option value="other" disabled>
                {todoRepeatWords(repeat, copy)}
              </option>
            )}
            <option value="none">{words.repeatNone}</option>
            <option value="daily">{words.repeatDaily}</option>
            <option value="weekly">{words.repeatWeekly}</option>
            <option value="monthly">{words.repeatMonthly}</option>
            <option value="yearly">{words.repeatYearly}</option>
          </PopoverSelect>
        </div>
        {choice === "other" && (
          <p
            data-role="todo-date-repeat-talk"
            className="col-start-2 -mt-0.5 text-[11.5px] leading-[1.45] text-ink-muted"
          >
            {words.repeatTalk}
          </p>
        )}
        {failures.repeat && (
          <BlockFailure kind={failures.repeat} className="col-start-2" />
        )}
      </div>
    </div>
  );
}

/** A native select in the popover's field type, its chevron drawn (the
 * scheduled-tasks dialog's way: `appearance-none` strips the system one).
 * The system's menu opens on it, as the time field is the system's. */
function PopoverSelect({
  ariaLabel,
  role,
  value,
  disabled,
  onChange,
  children,
}: {
  ariaLabel: string;
  role: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-flex min-w-0">
      <select
        aria-label={ariaLabel}
        data-role={role}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={cn(FIELD_CLASS, "h-7 min-w-0 appearance-none truncate pr-6")}
      >
        {children}
      </select>
      <CaretDown
        size={10}
        weight="bold"
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted"
      />
    </span>
  );
}

/** Why a write from a block failed, under it: the open row's edit failure
 * (`EditFailure` in TodoPanel), its words and type. */
function BlockFailure({
  kind,
  className,
}: {
  kind: TodoFailure;
  className?: string;
}) {
  const copy = useCopy();
  return (
    <p
      role="alert"
      className={cn("mt-1 text-[11.5px] leading-[1.45] text-error", className)}
    >
      {todoFailureText(kind, copy)}
    </p>
  );
}
