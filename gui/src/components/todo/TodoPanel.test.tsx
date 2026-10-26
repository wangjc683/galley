import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TodoCards } from "@/components/conversation/TodoCards";
import {
  EMPTY_TODO,
  type AssistantTodo,
  type TodoItem,
} from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import type { TodoFlip } from "@/lib/todo-panel";

import { TodoPanel } from "./TodoPanel";
import { todoTitleClass } from "./todo-styles";

/**
 * The to-do panel and the to-do card (main chat tickets 42 and 43),
 * rendered.
 * Static rendering reads a zustand store's initial state only, so the
 * list and the ticks on their way are handed in by mocking the hooks; how the store moves them is pinned in
 * stores/assistant-todo.test.ts, the words in lib/todo-panel.test.ts,
 * a click through to Core in TodoPanel.click.test.tsx.
 */

const store = vi.hoisted(() => ({
  todo: null as unknown,
  loaded: true,
  flips: {} as Record<string, unknown>,
  failures: {} as Record<string, unknown>,
  cancelling: {} as Record<string, unknown>,
  deleting: {} as Record<string, unknown>,
}));
vi.mock("@/stores/assistant-todo", () => ({
  useAssistantTodoStore: (select: (state: unknown) => unknown) =>
    select({
      ...store,
      toggle: () => {},
      cancelReminder: () => {},
      cancelTask: () => {},
      deleteTodo: () => {},
      load: async () => {},
    }),
}));

afterEach(() => {
  store.todo = EMPTY_TODO;
  store.loaded = true;
  store.flips = {};
  store.failures = {};
  store.cancelling = {};
  store.deleting = {};
});

function inDays(days: number, hour = 9): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
function dayIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todo(extra: Partial<TodoItem> = {}): TodoItem {
  return {
    kind: "todo",
    id: "todo_1",
    text: "交季度报告",
    state: "open",
    createdBy: "assistant",
    createdIn: { sessionId: "s-main", turnIndex: 4 },
    ...extra,
  };
}

const OVERDUE = todo({
  id: "todo_late",
  text: "回房东电话",
  due: { date: dayIn(-2), hasTime: false },
  overdue: true,
});
const REMINDED = todo({
  id: "todo_report",
  due: { date: dayIn(5), hasTime: false },
  reminder: { taskId: "sched_r", at: inDays(4), state: "scheduled" },
});
const ANYTIME = todo({
  id: "todo_soil",
  text: "买营养土",
  createdIn: undefined,
});
const SUBTASK: TodoItem = {
  kind: "subtask",
  id: "s-sub",
  text: "查周五去上海的机票",
  state: "running",
  createdBy: "assistant",
  at: inDays(0),
};
const ROUTINE: TodoItem = {
  kind: "task",
  id: "sched_daily",
  text: "早报",
  state: "scheduled",
  createdBy: "assistant",
  target: "assistant",
  repeat: { kind: "daily" },
  timeOfDay: "08:00",
  at: inDays(1, 8),
};
const DONE_TODO = todo({
  id: "todo_done",
  text: "订餐厅",
  state: "done",
  at: inDays(0, 7),
});

// Core's seed (ticket 73): its maker's label in `agent`, its prompt
// English for the model.
const REVIEW: TodoItem = {
  ...ROUTINE,
  id: "sched_review",
  text: "Daily review: read wake.md and go over what is in hand.",
  createdBy: "agent",
  agent: "galley-review",
  timeOfDay: "07:30",
  at: new Date(Date.parse(inDays(1, 7)) + 30 * 60_000).toISOString(),
};
// One of Galley's own one-off reminders (ticket 80).
const OWN_REMINDER: TodoItem = {
  kind: "task",
  id: "sched_water",
  text: "提醒喝水",
  state: "scheduled",
  createdBy: "assistant",
  target: "assistant",
  repeat: { kind: "once" },
  at: inDays(1, 15),
  createdIn: { sessionId: "s-main", turnIndex: 6 },
};

const FULL: AssistantTodo = {
  ...EMPTY_TODO,
  yours: { today: [OVERDUE], later: [REMINDED], anytime: [ANYTIME] },
  assistant: [SUBTASK],
  routine: [ROUTINE],
  done: [DONE_TODO],
  doneOmitted: 2,
  todayCount: 1,
};

function panel(
  todo: AssistantTodo,
  opts: { language?: "zh-CN" | "en-US"; doneOpen?: boolean } = {},
): string {
  store.todo = todo;
  return renderToStaticMarkup(
    <CopyProvider language={opts.language ?? "zh-CN"}>
      <Tooltip.Provider>
        <TodoPanel
          mainChatId="s-main"
          spot={{ here: "galley", at: "main:s-main", narrow: false }}
          onOpenSession={() => {}}
          onTalk={() => {}}
          onClose={() => {}}
          defaultDoneOpen={opts.doneOpen}
        />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;
/** The classes of the drawn box beside a to-do's input (`ui/checkbox.tsx`). */
function box(html: string, id: string): string {
  const match = new RegExp(
    `data-todo-check="${id}"[^>]*/?>\\s*<span aria-hidden="true" class="([^"]*)"`,
  ).exec(html);
  if (!match) throw new Error(`no box for ${id}`);
  return match[1];
}
// The box's ticked fills (ruling 129 point 2: B, ticket 84) and its
// empty one.
const BRAND = "border-brand bg-brand text-ink";
const QUIET = "border-line-strong bg-line-strong text-ink-soft";
const EMPTY_BOX = "border-line-strong bg-elevated text-transparent";
/** The markup of one row, from its opening to the next row. */
function row(html: string, id: string): string {
  const start = html.indexOf(`data-todo-row="${id}"`);
  const next = html.indexOf("data-todo-row=", start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

describe("the panel's groups", () => {
  it("draws your to-dos first, one part with no label (ruling 130), then Galley's groups under theirs", () => {
    const html = panel(FULL);
    expect(html).toContain('aria-label="待办"');
    const order = [
      'data-todo-group="yours"',
      'data-todo-group="assistant"',
      'data-todo-group="routine"',
      'data-todo-group="done"',
    ].map((g) => html.indexOf(g));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(count(html, 'data-todo-group="yours"')).toBe(1);
    // No label over yours: the part opens on its first row.
    expect(html).toMatch(
      /data-todo-group="yours"><div data-todo-row="todo_late"/,
    );
    for (const label of ["Galley 在办", "例行", "已完成"]) {
      expect(html).toContain(`>${label}<`);
    }
    for (const gone of ["今天", "以后", "随时", "你的事"]) {
      expect(html).not.toContain(`>${gone}<`);
    }
    // No input anywhere (ruling 91 point 6).
    expect(html).not.toContain('<input type="text"');
    expect(html).not.toContain("<textarea");
  });

  it("runs Core's three lists end to end, not sorted again: overdue, today, later, no time", () => {
    const tonight = todo({
      id: "todo_tonight",
      text: "取干洗的衣服",
      due: {
        date: dayIn(0),
        hasTime: true,
        at: inDays(0, 18),
        time: "18:00",
      },
    });
    const today = todo({
      id: "todo_today",
      text: "给花浇水",
      due: { date: dayIn(0), hasTime: false },
    });
    const html = panel({
      ...FULL,
      yours: {
        today: [OVERDUE, tonight, today],
        later: [REMINDED],
        anytime: [ANYTIME],
      },
    });
    const yours = html.slice(
      html.indexOf('data-todo-group="yours"'),
      html.indexOf('data-todo-group="assistant"'),
    );
    const ids = [...yours.matchAll(/data-todo-row="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(ids).toEqual([
      "todo_late",
      "todo_tonight",
      "todo_today",
      "todo_report",
      "todo_soil",
    ]);
    // Today's rows say so; overdue stays warning.
    expect(row(html, "todo_tonight")).toMatch(
      /data-role="todo-meta"[^]*>今天 18:00</,
    );
    expect(row(html, "todo_today")).toMatch(/data-role="todo-meta"[^]*>今天</);
    expect(row(html, "todo_late")).toMatch(/text-warning[^>]*>逾期 2 天</);
  });

  it("draws no empty group, and no part of yours when there is none", () => {
    const html = panel({
      ...EMPTY_TODO,
      yours: { today: [], later: [REMINDED], anytime: [] },
      routine: [ROUTINE],
    });
    expect(html).toContain('data-todo-group="yours"');
    expect(html).not.toContain('data-todo-group="assistant"');
    expect(html).not.toContain('data-todo-group="done"');
    expect(html).toContain('data-todo-group="routine"');
    // None of yours: 「Galley 在办」 is the first group.
    const galleys = panel({
      ...FULL,
      yours: { today: [], later: [], anytime: [] },
    });
    expect(galleys).not.toContain('data-todo-group="yours"');
    expect(galleys).toMatch(
      /data-role="todo-groups" class="space-y-3"><section data-todo-group="assistant">/,
    );
  });

  it("sets the groups 12px apart, none over the first, under the empty state too (ticket 83)", () => {
    const groups = (html: string) =>
      html.slice(html.indexOf('data-role="todo-groups"'));
    const html = panel(FULL);
    // One gap between sibling sections, whichever are drawn.
    expect(groups(html)).toMatch(
      /^data-role="todo-groups" class="space-y-3"><section/,
    );
    expect(count(html, "<section")).toBe(4);
    // No group label carries a margin of its own any more.
    expect(html).not.toContain("first:mt-0");
    expect(html).not.toMatch(/class="mt-3 flex w-full/);
    // Each label 3px above and below (ticket 86, ruling 130), 已完成's
    // button too.
    const labels = [
      ...html.matchAll(/class="(flex w-full items-center gap-1\.5[^"]*)"/g),
    ].map((m) => m[1]);
    expect(labels).toHaveLength(3);
    for (const label of labels) {
      expect(label).toContain("py-[3px]");
      expect(label).not.toContain("py-1.5");
    }
    // Under the empty state, 例行 is the first group: nothing over it.
    const empty = panel({ ...EMPTY_TODO, routine: [REVIEW] });
    expect(empty.indexOf('data-role="todo-empty"')).toBeLessThan(
      empty.indexOf('data-role="todo-groups"'),
    );
    expect(groups(empty)).toMatch(
      /^data-role="todo-groups" class="space-y-3"><section data-todo-group="routine">/,
    );
  });

  it("folds 已完成 with its count, open on asking", () => {
    const folded = panel(FULL);
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).not.toContain('data-todo-row="todo_done"');
    // 1 listed + 2 past the cap.
    expect(folded).toMatch(/已完成<\/span><span[^>]*>3<svg/);
    const open = panel(FULL, { doneOpen: true });
    expect(open).toContain('data-todo-row="todo_done"');
    expect(open).toContain("还有 2 件没有列出");
    // A done to-do keeps its box, ticked, its title struck through.
    const done = row(open, "todo_done");
    expect(done).toContain('type="checkbox"');
    expect(done).toContain("checked");
    expect(done).toContain("line-through");
  });

  it("says what is empty, with an example and a way to Galley, once read", () => {
    // One sentence, one example, one button; the name only on the
    // button (ticket 46, ruling 95 point 5).
    const html = panel(EMPTY_TODO);
    const empty = html.slice(html.indexOf('data-role="todo-empty"'));
    expect(empty).toMatch(
      /<p class="[^"]*text-\[13px\][^"]*">要办的事，说一声就记在这里。<\/p>/,
    );
    expect(empty).toMatch(
      /<p class="[^"]*text-\[12px\][^"]*">比如「周三下午 3 点前要交季度报告」<\/p>/,
    );
    expect(empty).toContain(">跟 Galley 说<");
    expect(empty.split("Galley").length - 1).toBe(1);
    const en = panel(EMPTY_TODO, { language: "en-US" });
    expect(en).toContain(
      ">Say what you need to do, and it&#x27;s noted here.<",
    );
    expect(en).toContain(
      ">For example: “I need to hand in the quarterly report by 3 PM Wednesday.”<",
    );
    expect(en).toContain(">Tell Galley<");
    const enEmpty = en.slice(en.indexOf('data-role="todo-empty"'));
    expect(enEmpty.split("Galley").length - 1).toBe(1);
    // Before the first read: nothing, no flash of the empty state.
    store.loaded = false;
    expect(panel(EMPTY_TODO)).not.toContain('data-role="todo-empty"');
  });

  it("says what is empty with the daily review alone, 例行 drawn under it as ever (ticket 80)", () => {
    const html = panel({ ...EMPTY_TODO, routine: [REVIEW] });
    const empty = html.indexOf('data-role="todo-empty"');
    const routine = html.indexOf('data-todo-group="routine"');
    expect(empty).toBeGreaterThan(-1);
    expect(routine).toBeGreaterThan(empty);
    // The empty state word for word: its sentence, example and button.
    const words = html.slice(empty, routine);
    expect(words).toContain(">要办的事，说一声就记在这里。<");
    expect(words).toContain(">比如「周三下午 3 点前要交季度报告」<");
    expect(words).toContain(">跟 Galley 说<");
    // 例行 as it looks in the list: its label, the review's row.
    const after = html.slice(routine);
    expect(after).toMatch(
      /^[^>]*><div class="[^"]*font-semibold[^"]*"><span[^>]*>例行</,
    );
    expect(after).toContain('data-todo-row="sched_review"');
    expect(after).toContain(">过一遍在办的事<");
    expect(after).toContain(">每天 07:30 · 下次 明天 07:30<");
    expect(after).toContain('aria-label="说说这件"');
    expect(html).not.toContain('data-todo-group="yours"');
    expect(html).not.toContain('data-todo-group="assistant"');
    expect(html).not.toContain('data-todo-group="done"');
    // The same row the list draws beside another routine.
    const listed = panel({ ...EMPTY_TODO, routine: [ROUTINE, REVIEW] });
    expect(listed).not.toContain('data-role="todo-empty"');
    expect(row(after, "sched_review")).toBe(row(listed, "sched_review"));
    // Paused, still the review: still empty.
    const off = panel({
      ...EMPTY_TODO,
      routine: [{ ...REVIEW, state: "paused", at: undefined }],
    });
    expect(off).toContain('data-role="todo-empty"');
    expect(off).toContain(">每天 07:30 · 已暂停<");
  });

  it("is the list, not the empty state, with anything beside the review", () => {
    for (const todo of [
      { ...EMPTY_TODO, routine: [REVIEW, ROUTINE] },
      {
        ...EMPTY_TODO,
        yours: { today: [], later: [REMINDED], anytime: [] },
        routine: [REVIEW],
      },
      { ...EMPTY_TODO, assistant: [OWN_REMINDER], routine: [REVIEW] },
    ]) {
      const html = panel(todo);
      expect(html).not.toContain('data-role="todo-empty"');
      expect(html).toContain('data-todo-row="sched_review"');
    }
  });

  it("puts 「跟 Galley 说」 in the header, an icon before the close (ticket 89, ruling 133)", () => {
    const html = panel(FULL);
    const header = html.slice(0, html.indexOf('data-todo-group="yours"'));
    const talk = header.indexOf('aria-label="跟 Galley 说"');
    expect(talk).toBeGreaterThan(-1);
    expect(talk).toBeLessThan(header.indexOf('aria-label="关闭"'));
    // An icon, no words in the list: nothing reads as one more item.
    expect(count(html, ">跟 Galley 说<")).toBe(0);
    expect(count(html, 'aria-label="跟 Galley 说"')).toBe(1);
    expect(panel(FULL, { language: "en-US" })).toContain(
      'aria-label="Tell Galley"',
    );
    // Empty too, beside the empty state's own button with the words.
    const empty = panel({ ...EMPTY_TODO, routine: [REVIEW] });
    expect(empty).toContain('aria-label="跟 Galley 说"');
    expect(count(empty, ">跟 Galley 说<")).toBe(1);
  });

  it("names the groups in English, never 「Galley」 in capitals", () => {
    const html = panel(FULL, { language: "en-US" });
    expect(html).not.toContain("uppercase");
    for (const label of ["Galley&#x27;s on it", "Routine", "Done"]) {
      expect(html).toContain(`>${label}<`);
    }
    for (const gone of ["Today", "Later", "Anytime"]) {
      expect(html).not.toContain(`>${gone}<`);
    }
    expect(html).toContain('aria-label="Talk about this"');
  });
});

describe("the panel's rows", () => {
  it("gives the user's to-dos a box, the due date and the reminder", () => {
    const html = panel(FULL);
    const late = row(html, "todo_late");
    expect(late).toContain('type="checkbox"');
    expect(late).not.toContain("checked");
    expect(late).toContain('aria-label="回房东电话"');
    expect(late).toMatch(/text-warning[^>]*>逾期 2 天</);
    const report = row(html, "todo_report");
    expect(report).toContain("提醒 ");
    // Its actions: 「说说这件」, and 「取消提醒」 while it can still go off.
    expect(report).toContain('aria-label="说说这件"');
    // 「取消提醒」 by the reminder, not a second button at the row's end.
    const meta = report.slice(report.indexOf('data-role="todo-meta"'));
    expect(meta).toContain('aria-label="取消提醒"');
    expect(meta.indexOf("提醒 ")).toBeLessThan(meta.indexOf("取消提醒"));
    expect(late).toContain('aria-label="说说这件"');
    expect(late).not.toContain('aria-label="取消提醒"');
    // A title noted in a reply leads there; one noted nowhere does not.
    expect(late).toMatch(/<button[^>]*hover:underline[^>]*>回房东电话</);
    expect(row(html, "todo_soil")).toMatch(/<span[^>]*>买营养土</);
  });

  it("gives what Galley is on no box but the session rows' glyph", () => {
    const html = panel(FULL);
    const sub = row(html, "s-sub");
    expect(sub).not.toContain('type="checkbox"');
    expect(sub).toContain("spin");
    expect(sub).toContain(">正在工作<");
    expect(sub).toContain('aria-label="说说这件"');
    const daily = row(html, "sched_daily");
    expect(daily).not.toContain('type="checkbox"');
    expect(daily).toContain("每天 08:00 · 下次 明天 08:00");
    expect(daily).toContain('aria-label="说说这件"');
  });

  it("names the daily review in its own words, a routine like the others (ticket 74)", () => {
    const prompt = "Daily review: read wake.md and go over what is in hand.";
    const review: TodoItem = {
      ...ROUTINE,
      id: "sched_review",
      text: prompt,
      createdBy: "agent",
      agent: "galley-review",
      timeOfDay: "07:30",
      at: new Date(Date.parse(inDays(1, 7)) + 30 * 60_000).toISOString(),
    };
    const html = panel({ ...FULL, routine: [ROUTINE, review] });
    const routine = html.slice(
      html.indexOf('data-todo-group="routine"'),
      html.indexOf('data-todo-group="done"'),
    );
    expect(routine).toContain('data-todo-row="sched_daily"');
    const row = (id: string) => {
      const start = routine.indexOf(`data-todo-row="${id}"`);
      const next = routine.indexOf("data-todo-row=", start + 1);
      return routine.slice(start, next === -1 ? undefined : next);
    };
    const named = row("sched_review");
    // The name has no time; the time is said once, on the second line.
    expect(named).toContain(">过一遍在办的事<");
    expect(named).toContain(">每天 07:30 · 下次 明天 07:30<");
    expect(named).not.toContain("7:30 过一遍");
    expect(html).not.toContain(prompt);
    // Same glyph, same title ink, same hover action as the other routine.
    const glyph = (r: string) => r.slice(0, r.indexOf("</svg>"));
    expect(glyph(named)).toBe(
      glyph(row("sched_daily")).replace("sched_daily", "sched_review"),
    );
    expect(named).toContain('aria-label="说说这件"');
    // Switched off: the paused routine's look.
    const off = panel({
      ...FULL,
      routine: [{ ...review, state: "paused", at: undefined }],
    });
    expect(off).toContain("每天 07:30 · 已暂停");
    expect(off).toContain("text-ink-soft");
    // In English.
    const en = panel({ ...FULL, routine: [review] }, { language: "en-US" });
    expect(count(en, ">Go over what’s in hand<")).toBe(1);
    expect(en).toContain(">Daily 07:30 · Next Tomorrow 7:30 AM<");
    expect(en).not.toContain(prompt);
  });

  it("holds a tick in place: ticked, struck through, its reminder gone", () => {
    store.flips = { todo_report: { done: true, phase: "settling" } };
    const report = row(panel(FULL), "todo_report");
    expect(report).toContain("checked");
    expect(report).toContain("line-through");
    expect(report).not.toContain("提醒 ");
    expect(report).not.toContain('aria-label="取消提醒"');
    // Still where it was: after the overdue one, before the one with no
    // time.
    const html = panel(FULL);
    const at = (id: string) => html.indexOf(`data-todo-row="${id}"`);
    expect(at("todo_report")).toBeGreaterThan(at("todo_late"));
    expect(at("todo_report")).toBeLessThan(at("todo_soil"));
  });

  it("says why a write failed, under the row", () => {
    store.failures = { todo_late: "failed" };
    expect(row(panel(FULL), "todo_late")).toContain(
      'role="alert" class="pb-1.5 pl-9 pr-3 text-[11.5px] leading-[1.45] text-error">没能完成，再试一次。',
    );
    store.failures = { todo_late: "gone" };
    expect(row(panel(FULL), "todo_late")).toContain("这件事已经不在了。");
  });

  it("draws 你的事's second line as ruling 97: one time, then the bell, never the day it was noted", () => {
    const html = panel({
      ...FULL,
      yours: {
        today: [{ ...OVERDUE, createdAt: inDays(-3, 10) }],
        later: [{ ...REMINDED, createdAt: inDays(-1, 22) }],
        anytime: [{ ...ANYTIME, createdAt: inDays(0, 8) }],
      },
    });
    expect(html).not.toContain("记下");
    expect(html).not.toContain("截止");
    const report = row(html, "todo_report");
    const meta = report.slice(report.indexOf('data-role="todo-meta"'));
    // The bell, its full words as its name, no 「·」 before it, and
    // 「取消提醒」 after it, outside what is cut.
    expect(meta).toMatch(/aria-label="提醒 [^"]+"/);
    expect(meta).not.toContain(" · ");
    expect(meta.indexOf('aria-label="提醒 ')).toBeLessThan(
      meta.indexOf("取消提醒"),
    );
    expect(meta).toMatch(
      /<span class="min-w-0 truncate">[^]*<\/span><button[^>]*aria-label="取消提醒"/,
    );
    // A row with nothing to say has no second line.
    expect(row(html, "todo_soil")).not.toContain('data-role="todo-meta"');
  });

  it("strikes a done row's title in ink-muted and fades nothing else (C1, ticket 45)", () => {
    store.flips = { todo_report: { done: true, phase: "settling" } };
    const held = row(panel(FULL), "todo_report");
    expect(held).toMatch(/text-ink-muted line-through[^>]*>交季度报告/);
    expect(held).not.toContain("opacity-60");
    const done = row(panel(FULL, { doneOpen: true }), "todo_done");
    expect(done).toContain("line-through");
    expect(done).not.toContain("opacity-60");
  });

  // Ticket 84 (ruling 129 point 2: B).
  it("ticks a done to-do's box in neutral grey under 已完成, still to be unticked", () => {
    const html = panel(FULL, { doneOpen: true });
    const done = row(html, "todo_done");
    expect(box(done, "todo_done")).toContain(QUIET);
    expect(box(done, "todo_done")).not.toContain("bg-brand");
    expect(done).not.toContain('disabled=""');
    // Nothing faded: the row and the card keep full opacity.
    expect(done).not.toContain("opacity-");
    // The boxes not done above it as ever.
    expect(box(row(html, "todo_late"), "todo_late")).toContain(EMPTY_BOX);
    expect(box(row(html, "todo_report"), "todo_report")).toContain(EMPTY_BOX);
  });

  it("keeps a tick brand through its hold; grey only once Core has it done", () => {
    store.flips = { todo_report: { done: true, phase: "settling" } };
    const held = row(panel(FULL), "todo_report");
    expect(box(held, "todo_report")).toContain(BRAND);
    store.flips = { todo_report: { done: true, phase: "saving" } };
    expect(box(row(panel(FULL), "todo_report"), "todo_report")).toContain(
      BRAND,
    );
    // Read back under 已完成: grey.
    store.flips = {};
    const after = panel(
      {
        ...FULL,
        yours: { today: [OVERDUE], later: [], anytime: [ANYTIME] },
        done: [{ ...REMINDED, state: "done", at: inDays(0, 10) }, DONE_TODO],
      },
      { doneOpen: true },
    );
    expect(box(row(after, "todo_report"), "todo_report")).toContain(QUIET);
    // Unticked in its hold under 已完成: an empty box, as any not done.
    store.flips = { todo_done: { done: false, phase: "settling" } };
    expect(
      box(row(panel(FULL, { doneOpen: true }), "todo_done"), "todo_done"),
    ).toContain(EMPTY_BOX);
  });

  it("sets a done subtask's and a gone-off reminder's title in ink-muted, a ticked to-do's ink", () => {
    const html = panel(
      {
        ...FULL,
        done: [
          DONE_TODO,
          { ...SUBTASK, id: "s-back", state: "done", at: inDays(0, 8) },
          {
            kind: "task",
            id: "sched_water",
            text: "提醒喝水",
            state: "fired",
            createdBy: "assistant",
            target: "assistant",
            repeat: { kind: "once" },
            at: inDays(0, 10),
          },
        ],
      },
      { doneOpen: true },
    );
    const sub = row(html, "s-back");
    expect(sub).toMatch(/<button[^>]*text-ink-muted"[^>]*>查周五去上海的机票</);
    expect(sub).not.toContain("text-ink-soft");
    const fired = row(html, "sched_water");
    expect(fired).toMatch(
      /<span class="block truncate text-ink-muted">提醒喝水</,
    );
    expect(fired).not.toContain("text-ink-soft");
    expect(fired).toContain(">今天 10:00 · 已提醒<");
  });
});

describe("a to-do's notes (ticket 80)", () => {
  const NOTES = "王老师\n电话 138 0000 0000，A 座 3 楼";

  it("go on their own line under the time, 12px ink-muted, cut", () => {
    const html = panel({
      ...FULL,
      yours: {
        today: [{ ...OVERDUE, notes: NOTES }],
        later: [{ ...REMINDED, notes: `  ${NOTES}  ` }],
        anytime: [ANYTIME],
      },
    });
    for (const id of ["todo_late", "todo_report"]) {
      const r = row(html, id);
      const meta = r.indexOf('data-role="todo-meta"');
      const notes = r.indexOf('data-role="todo-notes"');
      expect(meta).toBeGreaterThan(-1);
      expect(notes).toBeGreaterThan(meta);
      // Breaks and runs of space one space.
      expect(r).toMatch(
        /<p data-role="todo-notes" class="truncate text-\[12px\] leading-\[1\.4\] text-ink-muted">王老师 电话 138 0000 0000，A 座 3 楼<\/p>/,
      );
      // Outside the box the hover actions centre in, so they stay level
      // with the title and the time.
      expect(r.indexOf("absolute inset-y-0")).toBeLessThan(notes);
      expect(r.slice(0, notes)).toContain('aria-label="说说这件"');
    }
    // Overdue: the time in warning, the notes not.
    const late = row(html, "todo_late");
    const notes = late.slice(late.indexOf('data-role="todo-notes"'));
    expect(notes).not.toMatch(/^[^>]*text-warning/);
    // 「取消提醒」 still on the time's line, before the notes.
    const report = row(html, "todo_report");
    expect(report.indexOf('aria-label="取消提醒"')).toBeLessThan(
      report.indexOf('data-role="todo-notes"'),
    );
  });

  it("go right under the title when there is no time line", () => {
    const html = panel({
      ...FULL,
      yours: { today: [], later: [], anytime: [{ ...ANYTIME, notes: NOTES }] },
    });
    const soil = row(html, "todo_soil");
    expect(soil).not.toContain('data-role="todo-meta"');
    expect(soil.indexOf(">买营养土<")).toBeLessThan(
      soil.indexOf('data-role="todo-notes"'),
    );
  });

  it("are not drawn when blank, nor under 已完成, nor on the card", () => {
    const blank = panel({
      ...FULL,
      yours: {
        today: [{ ...OVERDUE, notes: "  \n " }],
        later: [{ ...REMINDED, notes: "" }],
        anytime: [ANYTIME],
      },
    });
    expect(blank).not.toContain('data-role="todo-notes"');
    const done = panel(
      { ...FULL, done: [{ ...DONE_TODO, notes: NOTES }] },
      { doneOpen: true },
    );
    expect(row(done, "todo_done")).not.toContain('data-role="todo-notes"');
    expect(done).not.toContain("王老师");
    const card = renderToStaticMarkup(
      <Tooltip.Provider>
        <TodoCards items={[{ ...REMINDED, notes: NOTES }]} />
      </Tooltip.Provider>,
    );
    expect(card).toContain(">交季度报告<");
    expect(card).not.toContain("王老师");
    expect(card).not.toContain('data-role="todo-notes"');
  });
});

describe("cancelling Galley's own reminder from the panel (ticket 80)", () => {
  const list = (assistant: TodoItem[]): AssistantTodo => ({
    ...FULL,
    assistant,
  });

  it("puts 「取消提醒」 at the end of its second line on hover, the to-do's very button", () => {
    const html = panel(list([SUBTASK, OWN_REMINDER]));
    const own = row(html, "sched_water");
    expect(own).toContain(">明天 15:00 · 待提醒<");
    // After the text, outside what is cut, shown on hover or focus.
    expect(own).toMatch(
      /<span class="min-w-0 truncate">明天 15:00 · 待提醒<\/span><button[^>]*aria-label="取消提醒"/,
    );
    const button = (html: string) =>
      html.match(/<button[^>]*aria-label="取消提醒"[^>]*>[^]*?<\/button>/)![0];
    expect(button(own)).toContain("group-hover/todo-row:opacity-100");
    expect(button(own)).toContain("group-focus-within/todo-row:opacity-100");
    expect(button(own)).not.toContain('disabled=""');
    // The same button a to-do's reminder has: size, glyph, place.
    expect(button(own)).toBe(button(row(html, "todo_report")));
    // 「说说这件」 stays.
    expect(own).toContain('aria-label="说说这件"');
    // Paused: it can still go off once switched on, so it can be cancelled.
    const paused = row(
      panel(list([{ ...OWN_REMINDER, state: "paused" }])),
      "sched_water",
    );
    expect(paused).toContain(">明天 15:00 · 已暂停<");
    expect(paused).toContain('aria-label="取消提醒"');
  });

  it("is held while Core cancels it, and says why it failed, under the row", () => {
    store.cancelling = { sched_water: true };
    const held = row(panel(list([OWN_REMINDER])), "sched_water");
    expect(held).toMatch(/<button[^>]*aria-label="取消提醒"[^>]*disabled=""/);
    store.cancelling = {};
    store.failures = { sched_water: "gone" };
    expect(row(panel(list([OWN_REMINDER])), "sched_water")).toContain(
      'role="alert" class="pb-1.5 pl-9 pr-3 text-[11.5px] leading-[1.45] text-error">这件事已经不在了。',
    );
    store.failures = { sched_water: "failed" };
    expect(row(panel(list([OWN_REMINDER])), "sched_water")).toContain(
      "没能完成，再试一次。",
    );
  });

  it("is not on a subtask, a routine, or what is done", () => {
    const html = panel(
      {
        ...list([SUBTASK, OWN_REMINDER]),
        routine: [ROUTINE, REVIEW],
        done: [
          DONE_TODO,
          { ...OWN_REMINDER, id: "sched_fired", state: "fired" },
        ],
      },
      { doneOpen: true },
    );
    for (const id of [
      "s-sub",
      "sched_daily",
      "sched_review",
      "todo_done",
      "sched_fired",
    ]) {
      expect(row(html, id)).not.toContain('aria-label="取消提醒"');
    }
    // A subtask's line is as it was: one cut line, no button after it.
    expect(row(html, "s-sub")).toMatch(
      /<div class="mt-0\.5 truncate text-\[12px\][^"]*">正在工作<\/div>/,
    );
  });
});

// Ticket 88 (PRD ruling 132 point 3): your to-do's ⋯ and right-click
// menu, and a row deleted there. The menu's rows are pinned in
// TodoRowMenu.test.tsx, a click through to the store in
// TodoPanel.click.test.tsx.
describe("your to-do's menu (ticket 88)", () => {
  /** The `<button …>` tag named `label` in `html`. */
  const buttonTag = (html: string, label: string) =>
    html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))![0];

  it("ends your row's hover buttons with ⋯, after 说说这件, the title giving way to both", () => {
    const html = panel(FULL);
    for (const id of ["todo_late", "todo_report", "todo_soil"]) {
      const own = row(html, id);
      expect(own).toMatch(/aria-label="说说这件"[^]*aria-label="更多"/);
      // The row is the right-click's trigger, let past the webview guard.
      expect(own).toContain('data-galley-context-menu-trigger=""');
      expect(own).toContain("group-hover/todo-row:pr-[60px]");
      expect(own).toContain("group-focus-within/todo-row:pr-[60px]");
    }
    // In the hover buttons' box: shown on hover or keyboard focus.
    expect(row(html, "todo_late")).toMatch(
      /opacity-0 group-focus-within\/todo-row:opacity-100 group-hover\/todo-row:opacity-100"><button[^>]*aria-label="说说这件"[^]*<button[^>]*aria-label="更多"/,
    );
    // The panel's own button, as 说说这件: the same size, a menu button,
    // not pressed while closed.
    const more = buttonTag(row(html, "todo_late"), "更多");
    const talk = buttonTag(row(html, "todo_late"), "说说这件");
    expect(more).toContain('aria-haspopup="menu"');
    expect(more).toContain('aria-expanded="false"');
    expect(more).toContain("size-7");
    expect(talk).toContain("size-7");
    // English: More.
    expect(row(panel(FULL, { language: "en-US" }), "todo_late")).toContain(
      'aria-label="More"',
    );
  });

  it("is on no row but yours not done: not one ticked and holding, nor 已完成, Galley's or a routine", () => {
    store.flips = { todo_report: { done: true, phase: "settling" } };
    const html = panel(
      { ...FULL, assistant: [SUBTASK, OWN_REMINDER], routine: [ROUTINE] },
      { doneOpen: true },
    );
    for (const id of [
      "todo_report",
      "todo_done",
      "s-sub",
      "sched_water",
      "sched_daily",
    ]) {
      expect(row(html, id)).not.toContain('aria-label="更多"');
      expect(row(html, id)).not.toContain("data-galley-context-menu-trigger");
    }
    // A row with 说说这件 alone keeps its 32px.
    expect(row(html, "s-sub")).toContain("group-hover/todo-row:pr-8");
    expect(row(html, "todo_late")).toContain('aria-label="更多"');
  });

  it("takes a row deleted here off the panel at once; the last one leaves the empty state", () => {
    store.deleting = { todo_report: { order: 1, committing: false } };
    const html = panel(FULL);
    expect(html).not.toContain('data-todo-row="todo_report"');
    expect(html).toContain('data-todo-row="todo_late"');
    expect(html).toContain('data-todo-row="todo_soil"');
    // Sent and not yet answered: still off.
    store.deleting = { todo_report: { order: 1, committing: true } };
    expect(panel(FULL)).not.toContain('data-todo-row="todo_report"');
    store.deleting = {
      todo_late: { order: 1, committing: false },
      todo_report: { order: 2, committing: false },
      todo_soil: { order: 3, committing: false },
    };
    const emptied = panel({ ...EMPTY_TODO, yours: FULL.yours, todayCount: 1 });
    expect(emptied).toContain('data-role="todo-empty"');
    expect(emptied).not.toContain('data-todo-group="yours"');
  });
});

describe("the card under the reply", () => {
  function cards(items: TodoItem[]): string {
    return renderToStaticMarkup(
      <Tooltip.Provider>
        <TodoCards items={items} />
      </Tooltip.Provider>,
    );
  }

  it("its title is the panel's title button while the panel lists it (ticket 87)", () => {
    store.todo = FULL;
    const html = cards([REMINDED, { ...REMINDED, id: "todo_gone" }]);
    const listed = html.match(
      /<div data-role="todo-card" data-todo-id="todo_report"[^]*?<\/button>/,
    )![0];
    // Underlined on hover, a ring on keyboard focus, cut with the full
    // text on hover — the panel's title button.
    expect(listed).toMatch(
      /<button type="button" class="block max-w-full truncate rounded-sm text-left outline-none underline-offset-2 hover:underline hover:decoration-ink-muted\/60 focus-visible:ring-2 focus-visible:ring-brand\/30 [^"]*">交季度报告<\/button>/,
    );
    // Not in the panel (cancelled, or done long ago): words.
    const gone = html.slice(html.indexOf('data-todo-id="todo_gone"'));
    expect(gone).not.toContain('<button type="button" class="block');
    expect(gone).toContain(">交季度报告</span>");
  });

  it("is a box, the title, when it is due and its reminder", () => {
    const html = cards([OVERDUE, REMINDED]);
    expect(count(html, 'data-role="todo-card"')).toBe(2);
    expect(html).toContain('class="rounded-md border border-line bg-app"');
    expect(html).toContain(">交季度报告<");
    expect(html).toMatch(/text-warning[^>]*>逾期 2 天</);
    expect(html).toContain("提醒 ");
    expect(count(html, 'type="checkbox"')).toBe(2);
  });

  it("ticks with the panel: one store, one state", () => {
    store.flips = {
      todo_report: { done: true, phase: "settling" } satisfies TodoFlip,
    };
    const card = cards([REMINDED]);
    const panelRow = row(panel(FULL), "todo_report");
    for (const html of [card, panelRow]) {
      expect(html).toContain("checked");
      expect(html).toContain("line-through");
    }
    expect(card).toContain('data-todo-checked="true"');
    // A done one, unticked on the way, is unticked on both.
    store.flips = { todo_done: { done: false, phase: "settling" } };
    expect(cards([DONE_TODO])).toContain('data-todo-checked="false"');
    expect(row(panel(FULL, { doneOpen: true }), "todo_done")).not.toContain(
      "line-through",
    );
  });

  it("says why a tick failed, under the card", () => {
    store.failures = { todo_report: "failed" };
    expect(cards([REMINDED])).toContain("没能完成，再试一次。");
  });

  it("names no 「记下」 day: the reply above it is dated", () => {
    expect(cards([{ ...REMINDED, createdAt: inDays(-1, 8) }])).not.toContain(
      "记下",
    );
  });

  // Ticket 43: a card stays under its reply, in three states.
  const LONG_DONE = todo({
    id: "todo_old",
    text: "交房租",
    state: "done",
    at: inDays(-30, 7),
    due: { date: dayIn(-31), hasTime: false },
  });
  const CANCELLED = todo({
    id: "todo_gone",
    text: "买营养土",
    due: { date: dayIn(-2), hasTime: false },
    reminder: { taskId: "sched_g", at: inDays(-3), state: "fired" },
    cancelledAt: inDays(-1, 9),
  });

  it("not done: an open box, as before", () => {
    const html = cards([REMINDED]);
    expect(html).toContain('data-todo-state="open"');
    expect(html).toContain('data-todo-checked="false"');
    expect(html).not.toContain('disabled=""');
    expect(html).toMatch(/text-ink"[^>]*>交季度报告</);
    expect(html).not.toContain("line-through");
  });

  it("done a month ago: still there, as 已完成 looks in the panel, and can be unticked", () => {
    const html = cards([LONG_DONE]);
    expect(html).toContain('data-todo-state="done"');
    expect(html).toContain('data-todo-checked="true"');
    expect(html).toContain('checked=""');
    expect(html).not.toContain('disabled=""');
    expect(html).toMatch(/text-ink-muted line-through[^>]*>交房租</);
    // Its due date quietly, never overdue, with no word before it.
    expect(html).not.toContain("逾期");
    expect(html).not.toContain("截止");
    expect(html).toMatch(/data-role="todo-meta"[^>]*><span><span>[^<]+</);
    // C1 (ticket 45): the strike-through alone, the card not faded.
    expect(html).not.toContain("opacity-60");
    // B (ticket 84): its box ticked in neutral grey, as under 已完成.
    expect(box(html, "todo_old")).toContain(QUIET);
    expect(html).not.toContain("bg-brand");
    expect(html).not.toContain("opacity-");
  });

  it("keeps the box brand on a card being ticked, and empty on one not done or cancelled (ticket 84)", () => {
    store.flips = { todo_report: { done: true, phase: "settling" } };
    expect(box(cards([REMINDED]), "todo_report")).toContain(BRAND);
    store.flips = {};
    expect(box(cards([REMINDED]), "todo_report")).toContain(EMPTY_BOX);
    expect(box(cards([CANCELLED]), "todo_gone")).toContain(EMPTY_BOX);
    // Done, then cancelled: unticked, its box as any cancelled one.
    expect(
      box(cards([{ ...CANCELLED, state: "done" }]), "todo_gone"),
    ).toContain(EMPTY_BOX);
  });

  it("cancelled: the box takes no click, the title struck, 「已删除」 beside it", () => {
    const html = cards([CANCELLED]);
    expect(html).toContain('data-todo-state="cancelled"');
    expect(html).toContain('data-todo-checked="false"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('disabled=""');
    expect(html).toContain("cursor-not-allowed");
    // Struck through as a ticked one is, the same line and colour (ticket
    // 99, PRD ruling 144 point 1: a line through reads as not wanted);
    // the unticked box and 「已删除」 tell it from one done.
    expect(html).toMatch(/text-ink-muted line-through"[^>]*>买营养土</);
    expect(todoTitleClass(false, true)).toBe(todoTitleClass(true));
    expect(count(html, "line-through")).toBe(1);
    // Deleted at the desktop or by Galley, one word (ticket 88, ruling
    // 132 point 5); a reminder card keeps 「已取消」.
    expect(html).toMatch(/data-role="todo-meta"[^>]*><span>[^]*>已删除</);
    expect(html).not.toContain("已取消");
    // 「已删除」 in place of when it was due and its reminder.
    expect(html).not.toContain("逾期");
    expect(html).not.toContain("截止");
    expect(html).not.toContain("提醒");
    expect(html).not.toContain("text-warning");
    // Done before it was cancelled: still unticked.
    expect(cards([{ ...CANCELLED, state: "done" }])).not.toContain(
      'checked=""',
    );
    // A tick on its way does not tick it either.
    store.flips = { todo_gone: { done: true, phase: "settling" } };
    expect(cards([CANCELLED])).not.toContain('checked=""');
    expect(cards([CANCELLED])).not.toContain("opacity-60");
    expect(
      renderToStaticMarkup(
        <CopyProvider language="en-US">
          <Tooltip.Provider>
            <TodoCards items={[CANCELLED]} />
          </Tooltip.Provider>
        </CopyProvider>,
      ),
    ).toContain(">Deleted<");
  });

  it("strikes a done title and a deleted one alike, full ink-muted: a title button's 60% is for its hover underline only (ticket 99, ruling 144 point 1)", () => {
    const classes = (html: string, text: string) =>
      html.match(new RegExp(`class="([^"]*)">${text}<`))![1].split(" ");
    // Done today: the panel lists it, so its title is a button, on the
    // card and under 已完成; deleted, the card's title is words.
    store.todo = FULL;
    const done = classes(cards([DONE_TODO]), "订餐厅");
    const deleted = classes(cards([CANCELLED]), "买营养土");
    const panelDone = classes(
      row(panel(FULL, { doneOpen: true }), "todo_done"),
      "订餐厅",
    );
    for (const title of [done, deleted, panelDone]) {
      expect(title).toContain("line-through");
      expect(title).toContain("text-ink-muted");
      // No decoration colour of its own: the strike takes the text's.
      expect(title.filter((c) => c.startsWith("decoration-"))).toEqual([]);
    }
    for (const button of [done, panelDone]) {
      expect(button).toContain("hover:underline");
      expect(button).toContain("hover:decoration-ink-muted/60");
    }
  });

  // Ticket 88: deleted from the panel, its undo toast still up.
  it("deleted from the panel and not yet by Core: already as a deleted one, its title words", () => {
    store.todo = {
      ...EMPTY_TODO,
      yours: { ...EMPTY_TODO.yours, later: [REMINDED] },
    };
    const listedHtml = cards([REMINDED]);
    expect(listedHtml).toMatch(/<button[^>]*>交季度报告<\/button>/);
    store.deleting = { todo_report: { order: 1, committing: false } };
    const html = cards([REMINDED]);
    expect(html).toContain('data-todo-state="cancelled"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('disabled=""');
    expect(html).toMatch(/data-role="todo-meta"[^>]*><span>[^]*>已删除</);
    expect(html).not.toContain("提醒");
    // Not a way into the panel: the panel no longer draws it. Struck
    // already, as one deleted is (ticket 99).
    expect(html).not.toMatch(/<button[^>]*>交季度报告<\/button>/);
    expect(html).toMatch(/text-ink-muted line-through"[^>]*>交季度报告</);
    // A tick on its way does not tick it either.
    store.flips = { todo_report: { done: true, phase: "settling" } };
    expect(cards([REMINDED])).not.toContain('checked=""');
  });

  it("draws the three in the order given, a reply's in the order noted", () => {
    const html = cards([REMINDED, LONG_DONE, CANCELLED]);
    expect(count(html, 'data-role="todo-card"')).toBe(3);
    expect(html.indexOf('data-todo-id="todo_report"')).toBeLessThan(
      html.indexOf('data-todo-id="todo_old"'),
    );
    expect(html.indexOf('data-todo-id="todo_old"')).toBeLessThan(
      html.indexOf('data-todo-id="todo_gone"'),
    );
  });
});
