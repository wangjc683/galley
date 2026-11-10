// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  EMPTY_TODO,
  type AssistantTodo,
  type TodoItem,
  type TodoRepeatRemind,
  type TodoRepeatRule,
} from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import {
  addDays,
  isoWeekday,
  monthOf,
  nextMonday,
  parseDay,
  todayKey,
} from "@/lib/todo-date";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { usePrefsStore } from "@/stores/prefs";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";

import { TodoPanel } from "./TodoPanel";

/**
 * A to-do's day, reminder and rule changed by hand (main chat ticket 156,
 * PRD ruling 205), through the real stores to Core's `update_todo` and
 * `stop_todo_repeat`: the open row's time line and 「添加日期」, the
 * popover's four blocks, picked is saved (a day closes it, the rest keep
 * it open), a reminder read as days before and a time and written back,
 * the rule's five choices and a rule none of them, a write refused, and
 * the month walked from the keyboard. Every date is counted from today
 * in this machine's zone; the arithmetic is lib/todo-date.test.ts's, and
 * what Core does with the reminder is core/tests/todo_by_hand_test.rs's.
 */

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
}));

// Radix's popper measures its trigger; jsdom has no ResizeObserver.
const hadResizeObserver = "ResizeObserver" in globalThis;
beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  if (!hadResizeObserver) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});
afterAll(() => {
  if (!hadResizeObserver) {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  }
});

const TODAY = todayKey(new Date(new Date().setHours(0, 0, 0, 0)).getTime());
const inDays = (n: number) => addDays(TODAY, n);

/** A local wall-clock instant on `day`, ISO. */
function localIso(day: string, h: number, m: number): string {
  const parsed = parseDay(day)!;
  return new Date(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    h,
    m,
  ).toISOString();
}

const NOW = new Date().toISOString();
const todo = (id: string, extra: Partial<TodoItem> = {}): TodoItem => ({
  kind: "todo",
  id,
  text: id,
  state: "open",
  createdBy: "assistant",
  createdAt: NOW,
  ...extra,
});
const onDay = (day: string): TodoItem["due"] => ({ date: day, hasTime: false });
const atTime = (day: string, h: number, m: number): TodoItem["due"] => ({
  date: day,
  hasTime: true,
  at: localIso(day, h, m),
  time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
});
const remindAt = (day: string, h: number, m: number) => ({
  taskId: "sched_x",
  at: localIso(day, h, m),
  state: "scheduled" as const,
});

/** Due in five days, reminded the evening before at 20:00. */
const REPORT = todo("todo_report", {
  due: onDay(inDays(5)),
  reminder: remindAt(inDays(4), 20, 0),
});
/** Due in three days at 15:00, no reminder. */
const MEETING = todo("todo_meeting", { due: atTime(inDays(3), 15, 0) });
/** No day, no reminder. */
const SOIL = todo("todo_soil");
/** No day, no reminder, an item under it. */
const PACK = todo("todo_pack", {
  items: [{ id: "item_1", text: "护照", done: false }],
});
/** Weekly on its due day's weekday. */
const WEEKLY = todo("todo_weekly", {
  due: onDay(inDays(7)),
  todoRepeat: { kind: "weekly", weekdays: [isoWeekday(inDays(7))] },
  seriesId: "series_w",
});
/** Every 2 weeks on Monday and Thursday. */
const FORTNIGHT = todo("todo_fortnight", {
  due: onDay(inDays(7)),
  todoRepeat: { kind: "weekly", weekdays: [1, 4], every: 2 },
  seriesId: "series_f",
});
/** Reminded five days before, and one a day after its due day. */
const EARLY = todo("todo_early", {
  due: onDay(inDays(10)),
  reminder: remindAt(inDays(5), 9, 0),
});
const LATE = todo("todo_late", {
  due: onDay(inDays(10)),
  reminder: remindAt(inDays(11), 9, 0),
});
/** A weekly period due in three days whose reminder, the rule's (the day
 * itself at 09:00), went off and Core moved on to the next period's time
 * (main chat ticket 157). */
const MOVED = todo("todo_moved", {
  due: onDay(inDays(3)),
  reminder: remindAt(inDays(10), 9, 0),
  todoRepeat: {
    kind: "weekly",
    weekdays: [isoWeekday(inDays(3))],
    remind: { daysBefore: 0, time: "09:00" },
  },
  seriesId: "series_m",
});

const list = (yours: TodoItem[]): AssistantTodo => ({
  ...EMPTY_TODO,
  yours: { today: [], later: [], anytime: yours },
});

interface UpdateArgs {
  id: string;
  due?: string;
  remind?: TodoRepeatRemind;
  noRemind?: boolean;
  repeat?: TodoRepeatRule;
}

/** What Core does with a change, as far as the panel reads it back (the
 * reminder moving with the day is Core's, not drawn here). */
function apply(item: TodoItem, args: UpdateArgs): TodoItem {
  let next = { ...item };
  if (args.due !== undefined) {
    if (args.due === "") {
      next = { ...next, due: undefined, reminder: undefined };
    } else if (args.due.includes("T")) {
      const [day, time] = args.due.split("T");
      const [h, m] = time.split(":").map(Number);
      next = { ...next, due: atTime(day, h, m) };
    } else {
      next = { ...next, due: onDay(args.due) };
    }
  }
  if (args.noRemind) next = { ...next, reminder: undefined };
  if (args.remind && next.due) {
    const [h, m] = args.remind.time.split(":").map(Number);
    const reminder = remindAt(
      addDays(next.due.date, -args.remind.daysBefore),
      h,
      m,
    );
    // A time passed is not hung; a repeating period's Core hangs later
    // (here: where asked, which is all the panel reads back).
    next =
      Date.parse(reminder.at) <= Date.now() && !next.todoRepeat
        ? { ...next, reminder: undefined }
        : { ...next, reminder };
  }
  if (args.repeat) next = { ...next, todoRepeat: args.repeat };
  return next;
}

let core: AssistantTodo = list([]);
let refuse: string | null = null;
let root: Root | null = null;

beforeEach(() => {
  core = list([
    REPORT,
    MEETING,
    SOIL,
    PACK,
    WEEKLY,
    FORTNIGHT,
    EARLY,
    LATE,
    MOVED,
  ]);
  refuse = null;
  useAssistantTodoStore.setState({
    todo: core,
    noted: [],
    loaded: true,
    flips: {},
    failures: {},
    cancelling: {},
    deleting: {},
    deleteToastId: null,
    editing: {},
  });
  useUiStore.setState({
    toasts: [],
    todoRowRequest: null,
    todoPageRequest: null,
    quoteRequest: null,
    locateRequest: null,
    todoPanelOpen: { galley: true, elsewhere: false },
    todoNarrow: false,
    todoGlance: null,
  });
  usePrefsStore.setState({ languagePreference: "zh-CN" });
  getTauriMocks().invoke.mockImplementation(async (command, args) => {
    if (command === "list_assistant_todo") return core;
    if (command === "list_noted_todos") return [];
    if (command === "update_todo" || command === "stop_todo_repeat") {
      if (refuse) throw refuse;
      const change = args as unknown as UpdateArgs;
      core = list(
        core.yours.anytime.map((item) =>
          item.id !== change.id
            ? item
            : command === "stop_todo_repeat"
              ? { ...item, todoRepeat: undefined }
              : apply(item, change),
        ),
      );
      return { id: change.id };
    }
    return undefined;
  });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <CopyProvider language="zh-CN">
        <Tooltip.Provider>
          <TodoPanel
            mainChatId="s-main"
            spot={{ here: "galley", at: "main:s-main", narrow: false }}
            onOpenSession={() => {}}
            onTalk={() => {}}
            onClose={() => {}}
          />
        </Tooltip.Provider>
      </CopyProvider>,
    );
  });
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

const row = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLElement>(`[data-todo-row="${id}"]`)!;
const popover = () =>
  document.querySelector<HTMLElement>('[data-role="todo-date-popover"]');
const inPopover = <T extends Element = HTMLElement>(selector: string) =>
  popover()!.querySelector<T>(selector)!;

function click(el: Element) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }),
    );
  });
}
function key(el: Element, name: string) {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
/** Open a row, then its time line's popover. */
function openPopover(container: HTMLElement, id: string) {
  click(row(container, id));
  const trigger = row(container, id).querySelector(
    '[data-role="todo-meta-date"], [data-role="todo-add-date"]',
  )!;
  click(trigger);
  expect(popover()).not.toBeNull();
}
function choose(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function typeTime(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => input.focus());
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const updates = () =>
  getTauriMocks()
    .invoke.mock.calls.filter(([command]) => command === "update_todo")
    .map(([, args]) => args);
/** The last `update_todo` sent. */
const last = () => updates()[updates().length - 1];
const stops = () =>
  getTauriMocks()
    .invoke.mock.calls.filter(([command]) => command === "stop_todo_repeat")
    .map(([, args]) => args);
const quickPick = (name: string) =>
  inPopover<HTMLButtonElement>(`[data-quick="${name}"]`);
const selectedText = (select: HTMLSelectElement) =>
  select.options[select.selectedIndex]?.textContent;

describe("the way in (ticket 156 一)", () => {
  it("is the open row's time line, or 「添加日期」 where there is none; nothing folded", () => {
    const container = mount();
    // Folded: no button on any time line, no 「添加日期」.
    expect(
      container.querySelector(
        '[data-role="todo-meta-date"], [data-role="todo-add-date"]',
      ),
    ).toBeNull();
    // Open with a day: the time line is the button.
    click(row(container, "todo_report"));
    expect(
      row(container, "todo_report").querySelector(
        '[data-role="todo-meta-date"]',
      ),
    ).not.toBeNull();
    expect(
      row(container, "todo_report").querySelector(
        '[data-role="todo-add-date"]',
      ),
    ).toBeNull();
    // Open with neither a day nor a reminder: 「添加日期」 in its place.
    click(row(container, "todo_soil"));
    const add = row(container, "todo_soil").querySelector(
      '[data-role="todo-add-date"]',
    )!;
    expect(add.textContent).toBe("添加日期");
    expect(add.className).toContain("text-ink-muted");
    // Only an item count: 「添加日期」 before it.
    click(row(container, "todo_pack"));
    const meta = row(container, "todo_pack").querySelector(
      '[data-role="todo-meta"]',
    )!;
    expect(
      Array.from(meta.children, (child) => child.textContent).slice(0, 2),
    ).toEqual(["添加日期", "0/1 项"]);
    // Folded again, the count alone.
    click(row(container, "todo_pack"));
    expect(
      row(container, "todo_pack").querySelector('[data-role="todo-add-date"]'),
    ).toBeNull();
    expect(
      row(container, "todo_pack").querySelector('[data-role="todo-meta"]')
        ?.textContent,
    ).toBe("0/1 项");
  });

  it("opens the popover's four blocks, named 「改日期」, today and the day marked", () => {
    const container = mount();
    openPopover(container, "todo_soil");
    expect(popover()!.getAttribute("aria-label")).toBe("改日期");
    expect(
      Array.from(
        popover()!.querySelectorAll("[data-quick]"),
        (b) => b.textContent,
      ),
    ).toEqual(["今天", "明天", "下周一", "不定日子"]);
    // The month: today's, today marked, no day picked.
    const month = monthOf(TODAY);
    expect(inPopover('[data-role="todo-calendar-month"]').textContent).toBe(
      `${month.year}年${month.month}月`,
    );
    const today = inPopover(`[data-day="${TODAY}"]`);
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(popover()!.querySelector('[aria-pressed="true"]')).toBeNull();
    // Three rows; without a day the time, the reminder and the rule are off.
    for (const role of ["time", "remind", "repeat"]) {
      const field = inPopover<HTMLInputElement>(
        `[data-role="todo-date-${role}"]`,
      );
      expect(field.disabled).toBe(true);
    }
    expect(popover()!.textContent).toContain("时刻");
    expect(popover()!.textContent).toContain("提醒");
    expect(popover()!.textContent).toContain("重复");
  });
});

describe("picked is saved (ticket 156 二)", () => {
  it("a day from the month: written, and the popover closes", async () => {
    const container = mount();
    openPopover(container, "todo_report");
    const due = inDays(5);
    expect(inPopover(`[data-day="${due}"]`).getAttribute("aria-pressed")).toBe(
      "true",
    );
    const other = Array.from(
      popover()!.querySelectorAll<HTMLElement>(
        '[data-role="todo-calendar-day"]',
      ),
    ).find((day) => day.dataset.day !== due)!;
    click(other);
    await settle();
    expect(updates()).toEqual([{ id: "todo_report", due: other.dataset.day }]);
    expect(popover()).toBeNull();
    // The focus back on the time line it opened from.
    await settle();
    expect((document.activeElement as HTMLElement).dataset.role).toBe(
      "todo-meta-date",
    );
    expect(row(container, "todo_report").contains(document.activeElement)).toBe(
      true,
    );
    // The row took it, and it is still open.
    expect(row(container, "todo_report").hasAttribute("data-todo-open")).toBe(
      true,
    );
  });

  it("the quick picks: today, tomorrow, next Monday — keeping the time of day", async () => {
    const container = mount();
    openPopover(container, "todo_meeting");
    click(quickPick("tomorrow"));
    await settle();
    expect(updates()).toEqual([
      { id: "todo_meeting", due: `${inDays(1)}T15:00` },
    ]);
    expect(popover()).toBeNull();
    openPopover(container, "todo_soil");
    click(quickPick("next-monday"));
    await settle();
    click(row(container, "todo_soil")); // fold
    openPopover(container, "todo_pack");
    click(quickPick("today"));
    await settle();
    expect(updates().slice(1)).toEqual([
      { id: "todo_soil", due: nextMonday(TODAY) },
      { id: "todo_pack", due: TODAY },
    ]);
  });

  it("「不定日子」 takes the day away, and is off on a repeating one", async () => {
    const container = mount();
    openPopover(container, "todo_weekly");
    expect(quickPick("no-date").disabled).toBe(true);
    key(document.activeElement!, "Escape");
    expect(popover()).toBeNull();
    openPopover(container, "todo_report");
    expect(quickPick("no-date").disabled).toBe(false);
    click(quickPick("no-date"));
    await settle();
    expect(updates()).toEqual([{ id: "todo_report", due: "" }]);
    expect(popover()).toBeNull();
    // No day now: 「添加日期」.
    expect(
      row(container, "todo_report").querySelector('[data-role="todo-add-date"]')
        ?.textContent,
    ).toBe("添加日期");
  });

  it("the time: written on leaving the field or on Enter, open still; Esc puts it back; 不设 clears it", async () => {
    const container = mount();
    openPopover(container, "todo_report");
    const time = inPopover<HTMLInputElement>('[data-role="todo-date-time"]');
    expect(time.value).toBe("");
    typeTime(time, "17:30");
    // Not at each keystroke.
    expect(updates()).toEqual([]);
    act(() => time.blur());
    await settle();
    expect(updates()).toEqual([
      { id: "todo_report", due: `${inDays(5)}T17:30` },
    ]);
    expect(popover()).not.toBeNull();
    expect(
      inPopover<HTMLInputElement>('[data-role="todo-date-time"]').value,
    ).toBe("17:30");
    // Enter writes.
    const field = inPopover<HTMLInputElement>('[data-role="todo-date-time"]');
    typeTime(field, "08:05");
    key(field, "Enter");
    await settle();
    expect(last()).toEqual({
      id: "todo_report",
      due: `${inDays(5)}T08:05`,
    });
    // 不设: the day alone.
    click(inPopover('[data-role="todo-date-no-time"]'));
    await settle();
    expect(last()).toEqual({ id: "todo_report", due: inDays(5) });
    expect(popover()).not.toBeNull();
    expect(
      inPopover<HTMLButtonElement>('[data-role="todo-date-no-time"]').disabled,
    ).toBe(true);
    // Esc puts the field back, writes nothing, and closes.
    const count = updates().length;
    const again = inPopover<HTMLInputElement>('[data-role="todo-date-time"]');
    typeTime(again, "11:11");
    key(again, "Escape");
    await settle();
    expect(updates()).toHaveLength(count);
    expect(popover()).toBeNull();
  });
});

describe("the reminder (ticket 156 二、三)", () => {
  it("reads as days before and a time, and writes each back, open still", async () => {
    const container = mount();
    openPopover(container, "todo_report");
    const days = inPopover<HTMLSelectElement>('[data-role="todo-date-remind"]');
    expect(days.value).toBe("1");
    expect(selectedText(days)).toBe("提前 1 天");
    expect(Array.from(days.options, (option) => option.textContent)).toEqual([
      "不提醒",
      "当天",
      "提前 1 天",
      "提前 2 天",
      "提前 3 天",
      "提前 1 周",
    ]);
    expect(
      inPopover<HTMLInputElement>('[data-role="todo-date-remind-time"]').value,
    ).toBe("20:00");
    // Three days before a day five days out: still ahead (a week before
    // would have passed, and Core hangs no such reminder, ticket 157).
    choose(days, "3");
    await settle();
    expect(updates()).toEqual([
      { id: "todo_report", remind: { daysBefore: 3, time: "20:00" } },
    ]);
    expect(popover()).not.toBeNull();
    const time = inPopover<HTMLInputElement>(
      '[data-role="todo-date-remind-time"]',
    );
    typeTime(time, "21:15");
    act(() => time.blur());
    await settle();
    expect(last()).toEqual({
      id: "todo_report",
      remind: { daysBefore: 3, time: "21:15" },
    });
    choose(inPopover('[data-role="todo-date-remind"]'), "none");
    await settle();
    expect(last()).toEqual({ id: "todo_report", noRemind: true });
    // None now: no time field.
    expect(
      popover()!.querySelector('[data-role="todo-date-remind-time"]'),
    ).toBeNull();
  });

  it("says one outside the choices as it is: 「提前 5 天」, 「到期后 1 天」", () => {
    const container = mount();
    openPopover(container, "todo_early");
    let days = inPopover<HTMLSelectElement>('[data-role="todo-date-remind"]');
    expect(selectedText(days)).toBe("提前 5 天");
    expect(
      inPopover<HTMLInputElement>('[data-role="todo-date-remind-time"]').value,
    ).toBe("09:00");
    key(document.activeElement!, "Escape");
    openPopover(container, "todo_late");
    days = inPopover<HTMLSelectElement>('[data-role="todo-date-remind"]');
    expect(selectedText(days)).toBe("到期后 1 天");
  });

  it("a new one starts at the due time, else 09:00", async () => {
    const container = mount();
    openPopover(container, "todo_meeting");
    choose(inPopover('[data-role="todo-date-remind"]'), "2");
    await settle();
    expect(updates()).toEqual([
      { id: "todo_meeting", remind: { daysBefore: 2, time: "15:00" } },
    ]);
    key(document.activeElement!, "Escape");
    openPopover(container, "todo_weekly");
    choose(inPopover('[data-role="todo-date-remind"]'), "1");
    await settle();
    expect(last()).toEqual({
      id: "todo_weekly",
      remind: { daysBefore: 1, time: "09:00" },
    });
  });
});

describe("the rule (ticket 156 二、三)", () => {
  it("each of the five sends its own write", async () => {
    const container = mount();
    openPopover(container, "todo_report");
    const due = inDays(5);
    const repeat = () =>
      inPopover<HTMLSelectElement>('[data-role="todo-date-repeat"]');
    expect(repeat().value).toBe("none");
    expect(Array.from(repeat().options, (o) => o.textContent)).toEqual([
      "不重复",
      "每天",
      "每周",
      "每月",
      "每年",
    ]);
    // 「不重复」 on one that does not repeat: nothing.
    choose(repeat(), "none");
    for (const kind of ["daily", "weekly", "monthly", "yearly"]) {
      choose(repeat(), kind);
      await settle();
      expect(repeat().value).toBe(kind);
    }
    expect(updates()).toEqual([
      { id: "todo_report", repeat: { kind: "daily" } },
      {
        id: "todo_report",
        repeat: { kind: "weekly", weekdays: [isoWeekday(due)] },
      },
      {
        id: "todo_report",
        repeat: { kind: "monthly", monthdays: [parseDay(due)!.day] },
      },
      { id: "todo_report", repeat: { kind: "yearly" } },
    ]);
    // 「不重复」 ends it: `stop_todo_repeat`.
    choose(repeat(), "none");
    await settle();
    expect(stops()).toEqual([{ id: "todo_report" }]);
    expect(repeat().value).toBe("none");
    expect(popover()).not.toBeNull();
  });

  it("a rule none of the five reads as itself, read only, with 「改规则跟 Galley 说」", async () => {
    const container = mount();
    openPopover(container, "todo_fortnight");
    const repeat = inPopover<HTMLSelectElement>(
      '[data-role="todo-date-repeat"]',
    );
    expect(repeat.value).toBe("other");
    expect(selectedText(repeat)).toBe("每 2 周的周一·四");
    expect(repeat.options[repeat.selectedIndex].disabled).toBe(true);
    expect(inPopover('[data-role="todo-date-repeat-talk"]').textContent).toBe(
      "改规则跟 Galley 说",
    );
    // One of the five replaces it.
    choose(repeat, "weekly");
    await settle();
    expect(updates()).toEqual([
      {
        id: "todo_fortnight",
        repeat: { kind: "weekly", weekdays: [isoWeekday(inDays(7))] },
      },
    ]);
    expect(
      popover()!.querySelector('[data-role="todo-date-repeat-talk"]'),
    ).toBeNull();
  });
});

describe("a write refused (ticket 156 二)", () => {
  it("says why under its block and goes back", async () => {
    const container = mount();
    openPopover(container, "todo_report");
    refuse = JSON.stringify({ error: "internal", message: "no" });
    choose(inPopover('[data-role="todo-date-remind"]'), "0");
    await settle();
    const days = inPopover<HTMLSelectElement>('[data-role="todo-date-remind"]');
    expect(days.value).toBe("1");
    expect(
      Array.from(
        popover()!.querySelectorAll('[role="alert"]'),
        (p) => p.textContent,
      ),
    ).toEqual(["没能完成，再试一次。"]);
    // A day refused: the popover stays, the day as it was, why under the
    // month; gone is said as gone.
    refuse = JSON.stringify({ error: "not_found", message: "gone" });
    click(quickPick("tomorrow"));
    await settle();
    expect(popover()).not.toBeNull();
    expect(
      inPopover(`[data-day="${inDays(5)}"]`).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      Array.from(
        popover()!.querySelectorAll('[role="alert"]'),
        (p) => p.textContent,
      ),
    ).toEqual(["这件事已经不在了。", "没能完成，再试一次。"]);
    // The next try clears it.
    refuse = null;
    choose(inPopover('[data-role="todo-date-remind"]'), "0");
    await settle();
    expect(
      Array.from(
        popover()!.querySelectorAll('[role="alert"]'),
        (p) => p.textContent,
      ),
    ).toEqual(["这件事已经不在了。"]);
  });
});

describe("the month from the keyboard (ticket 156 二)", () => {
  it("starts on the day picked, moves by day, week and month, picks on Enter", async () => {
    const container = mount();
    openPopover(container, "todo_report");
    const due = inDays(5);
    expect((document.activeElement as HTMLElement).dataset.day).toBe(due);
    key(document.activeElement!, "ArrowRight");
    expect((document.activeElement as HTMLElement).dataset.day).toBe(
      addDays(due, 1),
    );
    key(document.activeElement!, "ArrowDown");
    expect((document.activeElement as HTMLElement).dataset.day).toBe(
      addDays(due, 8),
    );
    key(document.activeElement!, "ArrowUp");
    key(document.activeElement!, "ArrowLeft");
    expect((document.activeElement as HTMLElement).dataset.day).toBe(due);
    // A month on, the title with it.
    key(document.activeElement!, "PageDown");
    const next = (document.activeElement as HTMLElement).dataset.day!;
    const month = monthOf(next);
    expect(inPopover('[data-role="todo-calendar-month"]').textContent).toBe(
      `${month.year}年${month.month}月`,
    );
    key(document.activeElement!, "PageUp");
    key(document.activeElement!, "PageDown");
    key(document.activeElement!, "Enter");
    await settle();
    expect(updates()).toEqual([{ id: "todo_report", due: next }]);
    expect(popover()).toBeNull();
  });

  it("‹ › turn the month; Esc closes, the focus back on the time line", async () => {
    const container = mount();
    openPopover(container, "todo_soil");
    const month = monthOf(TODAY);
    click(inPopover('button[aria-label="下个月"]'));
    const next = month.month === 12 ? 1 : month.month + 1;
    expect(inPopover('[data-role="todo-calendar-month"]').textContent).toBe(
      `${month.month === 12 ? month.year + 1 : month.year}年${next}月`,
    );
    click(inPopover('button[aria-label="上个月"]'));
    click(inPopover('button[aria-label="上个月"]'));
    const back = month.month === 1 ? 12 : month.month - 1;
    expect(inPopover('[data-role="todo-calendar-month"]').textContent).toBe(
      `${month.month === 1 ? month.year - 1 : month.year}年${back}月`,
    );
    key(document.activeElement!, "Escape");
    expect(popover()).toBeNull();
    // Radix hands the focus back a tick later.
    await settle();
    expect((document.activeElement as HTMLElement).dataset.role).toBe(
      "todo-add-date",
    );
    // The row stays open: Esc was the popover's.
    expect(row(container, "todo_soil").hasAttribute("data-todo-open")).toBe(
      true,
    );
  });
});

// Main chat ticket 157 (PRD ruling 204 point 7; 四).
describe("a period of a rule (ticket 157)", () => {
  it("open, its repeat mark is inside the time line's button", () => {
    const container = mount();
    click(row(container, "todo_weekly"));
    const button = row(container, "todo_weekly").querySelector(
      '[data-role="todo-meta-date"]',
    )!;
    expect(
      button.querySelector('[data-role="todo-meta-repeat"]'),
    ).not.toBeNull();
    // Folded too, outside any button.
    click(row(container, "todo_weekly"));
    expect(
      row(container, "todo_weekly").querySelector(
        '[data-role="todo-meta-repeat"]',
      ),
    ).not.toBeNull();
  });

  it("reads a reminder Core moved on as the rule's offset, not 「到期后 7 天」; its bell not drawn", () => {
    const container = mount();
    // Not overdue, its reminder past its day: no bell, no 取消提醒 by it.
    const meta = row(container, "todo_moved").querySelector(
      '[data-role="todo-meta"]',
    )!;
    expect(meta.querySelector('[aria-label^="提醒 "]')).toBeNull();
    expect(meta.querySelector('button[aria-label="取消提醒"]')).toBeNull();
    openPopover(container, "todo_moved");
    const days = inPopover<HTMLSelectElement>('[data-role="todo-date-remind"]');
    expect(selectedText(days)).toBe("当天");
    expect(
      inPopover<HTMLInputElement>('[data-role="todo-date-remind-time"]').value,
    ).toBe("09:00");
  });
});

// Main chat ticket 157, the main session's addendum (the real window).
describe("the popover's addendum (ticket 157)", () => {
  const tooltip = () => document.querySelector('[role="tooltip"]');
  const dateButton = (container: HTMLElement) =>
    row(container, "todo_report").querySelector<HTMLElement>(
      '[data-role="todo-meta-date"]',
    )!;

  it("a day picked with the pointer: the focus back on the time line, no tooltip, no ring", async () => {
    const container = mount();
    openPopover(container, "todo_report");
    const other = Array.from(
      popover()!.querySelectorAll<HTMLElement>(
        '[data-role="todo-calendar-day"]',
      ),
    ).find((day) => day.dataset.day !== inDays(5))!;
    act(() => {
      other.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    click(other);
    await settle();
    await settle();
    expect(popover()).toBeNull();
    const button = dateButton(container);
    expect(document.activeElement).toBe(button);
    expect(tooltip()).toBeNull();
    expect(button.dataset.ring).toBe("quiet");
    expect(button.className).not.toContain("focus-visible:ring-2");
    // A key pressed there brings the ring back.
    key(button, "Shift");
    expect(button.dataset.ring).toBeUndefined();
    expect(button.className).toContain("focus-visible:ring-2");
  });

  it("Esc: the focus back with its ring, no tooltip; a hover still shows it, below the time line", async () => {
    const container = mount();
    openPopover(container, "todo_report");
    key(document.activeElement!, "Escape");
    await settle();
    await settle();
    const button = dateButton(container);
    expect(document.activeElement).toBe(button);
    expect(tooltip()).toBeNull();
    expect(button.dataset.ring).toBeUndefined();
    expect(button.className).toContain("focus-visible:ring-2");
    // The pointer over it: 「改日期」, under the line, off the title.
    act(() => {
      button.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
    });
    expect(tooltip()?.textContent).toBe("改日期");
    expect(tooltip()!.closest("[data-side]")?.getAttribute("data-side")).toBe(
      "bottom",
    );
  });

  it("a focus the user brings (Tab) shows it; none while the popover is open", async () => {
    const container = mount();
    click(row(container, "todo_report"));
    const button = dateButton(container);
    act(() => button.focus());
    expect(tooltip()?.textContent).toBe("改日期");
    click(button);
    expect(popover()).not.toBeNull();
    expect(tooltip()).toBeNull();
  });

  it("says so when a reminder just picked was not hung, its time passed; not after 不提醒, nor on a period", async () => {
    const passed = () =>
      popover()!.querySelector('[data-role="todo-date-remind-passed"]');
    const container = mount();
    // Due in three days at 15:00; a week before has passed.
    openPopover(container, "todo_meeting");
    choose(inPopover('[data-role="todo-date-remind"]'), "7");
    await settle();
    expect(last()).toEqual({
      id: "todo_meeting",
      remind: { daysBefore: 7, time: "15:00" },
    });
    expect(
      inPopover<HTMLSelectElement>('[data-role="todo-date-remind"]').value,
    ).toBe("none");
    expect(passed()?.textContent).toBe("这个时刻已经过了，没有挂提醒");
    expect(passed()!.className).toContain("text-ink-muted");
    expect(passed()!.className).not.toContain("text-error");
    // The next change takes it away.
    choose(inPopover('[data-role="todo-date-remind"]'), "1");
    await settle();
    expect(passed()).toBeNull();
    // 「不提醒」 itself: nothing to say.
    choose(inPopover('[data-role="todo-date-remind"]'), "none");
    await settle();
    expect(last()).toEqual({ id: "todo_meeting", noRemind: true });
    expect(passed()).toBeNull();
    // Gone once it closes.
    choose(inPopover('[data-role="todo-date-remind"]'), "7");
    await settle();
    expect(passed()).not.toBeNull();
    key(document.activeElement!, "Escape");
    await settle();
    // The row is still open: its time line again.
    click(
      row(container, "todo_meeting").querySelector(
        '[data-role="todo-meta-date"]',
      )!,
    );
    expect(popover()).not.toBeNull();
    expect(passed()).toBeNull();
    key(document.activeElement!, "Escape");
    await settle();
    // A period of a rule: Core hangs it later; nothing said.
    openPopover(container, "todo_weekly");
    choose(inPopover('[data-role="todo-date-remind"]'), "7");
    await settle();
    const time = inPopover<HTMLInputElement>(
      '[data-role="todo-date-remind-time"]',
    );
    typeTime(time, "00:00");
    act(() => time.blur());
    await settle();
    expect(last()).toEqual({
      id: "todo_weekly",
      remind: { daysBefore: 7, time: "00:00" },
    });
    expect(passed()).toBeNull();
  });

  it("「不定日子」 is off on a to-do with no due date", () => {
    const container = mount();
    openPopover(container, "todo_soil");
    expect(quickPick("no-date").disabled).toBe(true);
    key(document.activeElement!, "Escape");
    openPopover(container, "todo_report");
    expect(quickPick("no-date").disabled).toBe(false);
  });
});

// Main chat ticket 159 (PRD ruling 207 point 4). jsdom lays nothing out:
// what is pinned here is where the line can break and what goes together;
// the main session measures the wrap itself in the real window.
describe("the open row's time line goes onto a second line (ticket 159)", () => {
  /** A weekly period ten days out (its day a date, not a weekday), reminded
   * the day before at 09:00 as its rule records, two items under it. */
  const LONG = todo("todo_long", {
    due: onDay(inDays(10)),
    reminder: remindAt(inDays(9), 9, 0),
    todoRepeat: {
      kind: "weekly",
      weekdays: [isoWeekday(inDays(10))],
      remind: { daysBefore: 1, time: "09:00" },
    },
    seriesId: "series_l",
    items: [
      { id: "item_a", text: "数据", done: true },
      { id: "item_b", text: "图表", done: false },
    ],
  });
  const meta = (container: HTMLElement) =>
    row(container, "todo_long").querySelector<HTMLElement>(
      '[data-role="todo-meta"]',
    )!;
  function mountLong(): HTMLElement {
    core = list([LONG, REPORT]);
    useAssistantTodoStore.setState({ todo: core });
    return mount();
  }

  it("breaks only between whole parts — the day and the rule, the bell's, the count — 「取消提醒」 with the last", () => {
    const container = mountLong();
    click(row(container, "todo_long"));
    const line = meta(container);
    expect(line.hasAttribute("data-wrap")).toBe(true);
    expect(line.className).toContain("whitespace-nowrap");
    expect(line.className).not.toContain("flex");
    expect(line.className).not.toContain("truncate");
    // Where it may break: 8px, then a <wbr>, before the rule, the bell
    // and the count — nowhere else on the line.
    const breaks = Array.from(
      line.querySelectorAll<HTMLElement>('[data-role="todo-meta-break"]'),
    );
    expect(breaks).toHaveLength(3);
    for (const each of breaks) {
      expect(each.className).toBe("ml-2 whitespace-normal");
      expect(Array.from(each.childNodes, (node) => node.nodeName)).toEqual([
        "WBR",
      ]);
    }
    expect(
      Array.from(line.querySelectorAll(".whitespace-normal")).every(
        (each) => each.getAttribute("data-role") === "todo-meta-break",
      ),
    ).toBe(true);
    // Each part whole: an inline block on one line, no break inside.
    const parts = Array.from(
      line.querySelectorAll<HTMLElement>("[data-segment]"),
    );
    expect(parts.map((part) => part.textContent)).toEqual([
      parts[0].textContent,
      "每周",
      "前一天 09:00",
      "1/2 项",
    ]);
    expect(parts[0].textContent).toMatch(/^\d+月\d+日$/);
    for (const part of parts) {
      expect(part.className).toBe("inline-block max-w-full truncate align-top");
      expect(part.querySelector('[data-role="todo-meta-break"]')).toBeNull();
    }
    // The day, the rule and the bell are the button's; the count is not.
    const words = line.querySelector<HTMLElement>(
      '[data-role="todo-meta-date"]',
    )!;
    expect(words.tagName).toBe("SPAN");
    expect(words.getAttribute("role")).toBe("button");
    expect(words.tabIndex).toBe(0);
    expect(parts.slice(0, 3).every((part) => words.contains(part))).toBe(true);
    expect(words.contains(parts[3])).toBe(false);
    expect(
      line.querySelector('[data-role="todo-item-count"]')!.textContent,
    ).toBe("1/2 项");
    // 「取消提醒」 last, no break before it: it goes with what comes last.
    const cancel = line.querySelector<HTMLElement>(
      'button[aria-label="取消提醒"]',
    )!;
    expect(line.lastElementChild).toBe(cancel);
    expect(cancel.previousElementSibling?.getAttribute("data-role")).toBe(
      "todo-item-count",
    );
    expect(cancel.className).toContain("align-top");
    // The hovers keep the rule and the day whole.
    expect(parts[1].getAttribute("title")).toMatch(
      /^重复：每周[一二三四五六日]$/,
    );
    expect(parts[2].getAttribute("title")).toMatch(/^提醒 /);
    expect(parts[2].getAttribute("title")).not.toContain("前一天");
  });

  it("draws the folded row as ever: one line, cut at its end", () => {
    const container = mountLong();
    // Folded first, then opened and folded again.
    for (const step of ["folded", "open", "folded again"]) {
      if (step !== "folded") click(row(container, "todo_long"));
      if (step === "open") continue;
      const line = meta(container);
      expect(line.className, step).toContain("flex");
      expect(line.className, step).toContain("items-center");
      expect(line.hasAttribute("data-wrap"), step).toBe(false);
      expect(line.firstElementChild!.className, step).toBe("min-w-0 truncate");
      expect(
        line.querySelector(
          '[data-role="todo-meta-break"], [data-segment], wbr',
        ),
        step,
      ).toBeNull();
      // The glyph alone where the short words would stand (PRD ruling
      // 207 point 8); the rule whole in its hover.
      expect(line.textContent, step).not.toContain("每周");
      expect(
        line
          .querySelector('[data-role="todo-meta-repeat"]')!
          .getAttribute("title"),
        step,
      ).toMatch(/^重复：每周/);
      expect(line.textContent, step).toContain("前一天 09:00");
    }
    // Open, the words are there.
    click(row(container, "todo_long"));
    expect(meta(container).textContent).toContain("每周");
  });

  it("opens the popover from any of its parts, and on Enter or Space", async () => {
    const container = mountLong();
    click(row(container, "todo_long"));
    const parts = () =>
      Array.from(
        meta(container).querySelectorAll<HTMLElement>("[data-segment]"),
      );
    for (const index of [0, 1, 2]) {
      click(parts()[index]);
      expect(popover(), `part ${index}`).not.toBeNull();
      key(document.activeElement!, "Escape");
      await settle();
      expect(popover()).toBeNull();
    }
    // The count is not a time: a click there is the row's (it folds).
    click(parts()[3]);
    expect(popover()).toBeNull();
    expect(row(container, "todo_long").hasAttribute("data-todo-open")).toBe(
      false,
    );
    click(row(container, "todo_long"));
    for (const name of ["Enter", " "]) {
      const words = meta(container).querySelector<HTMLElement>(
        '[data-role="todo-meta-date"]',
      )!;
      act(() => words.focus());
      key(words, name);
      expect(popover(), JSON.stringify(name)).not.toBeNull();
      key(document.activeElement!, "Escape");
      await settle();
      expect(popover()).toBeNull();
      expect(document.activeElement).toBe(
        meta(container).querySelector('[data-role="todo-meta-date"]'),
      );
    }
  });

  it("hangs the popover under the whole line — on two lines, under the second", async () => {
    const container = mountLong();
    click(row(container, "todo_long"));
    const rect = (left: number, top: number, width: number, height: number) =>
      ({
        x: left,
        y: top,
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        toJSON: () => ({}),
      }) as DOMRect;
    // The line on two lines; its words, inline, a box of their own that
    // starts and ends elsewhere.
    meta(container).getBoundingClientRect = () => rect(40, 100, 200, 34);
    meta(container).querySelector<HTMLElement>(
      '[data-role="todo-meta-date"]',
    )!.getBoundingClientRect = () => rect(52, 101, 180, 15);
    // A window for the popper to stay inside (jsdom's is 0 × 0, which
    // flips it above).
    const html = document.documentElement;
    Object.defineProperty(html, "clientWidth", {
      configurable: true,
      value: 1024,
    });
    Object.defineProperty(html, "clientHeight", {
      configurable: true,
      value: 768,
    });
    try {
      click(meta(container).querySelector('[data-role="todo-meta-date"]')!);
      await settle();
      const wrapper = popover()!.closest<HTMLElement>(
        "[data-radix-popper-content-wrapper]",
      )!;
      // The line's start, its foot (134) and the 4px offset.
      expect(wrapper.style.transform).toBe("translate(40px, 138px)");
    } finally {
      delete (html as unknown as Record<string, unknown>).clientWidth;
      delete (html as unknown as Record<string, unknown>).clientHeight;
    }
  });
});
