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

/**
 * The to-do panel and the to-do card (main chat tickets 42 and 43),
 * rendered.
 * Static rendering reads a zustand store's initial state only, so the
 * list, the ticks on their way and the variant are handed in by mocking
 * the hooks; how the store moves them is pinned in
 * stores/assistant-todo.test.ts, the words in lib/todo-panel.test.ts.
 */

const store = vi.hoisted(() => ({
  todo: null as unknown,
  loaded: true,
  flips: {} as Record<string, unknown>,
  failures: {} as Record<string, unknown>,
  cancelling: {} as Record<string, unknown>,
}));
vi.mock("@/stores/assistant-todo", () => ({
  useAssistantTodoStore: (select: (state: unknown) => unknown) =>
    select({
      ...store,
      toggle: () => {},
      cancelReminder: () => {},
      load: async () => {},
    }),
}));
const variants = vi.hoisted(() => ({
  row: "A1",
  width: "B1",
  done: "C1",
}));
vi.mock(
  "@/components/todo/todo-variants/todo-variants",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/todo/todo-variants/todo-variants")
      >();
    return {
      ...actual,
      useTodoVariants: (select: (state: unknown) => unknown) =>
        select({ ...variants, set: () => {} }),
    };
  },
);

afterEach(() => {
  store.todo = EMPTY_TODO;
  store.loaded = true;
  store.flips = {};
  store.failures = {};
  store.cancelling = {};
  variants.done = "C1";
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
/** The markup of one row, from its opening to the next row. */
function row(html: string, id: string): string {
  const start = html.indexOf(`data-todo-row="${id}"`);
  const next = html.indexOf("data-todo-row=", start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

describe("the panel's groups", () => {
  it("draws the four groups in order, 你的事 in its three parts", () => {
    const html = panel(FULL);
    expect(html).toContain('aria-label="待办"');
    const order = ["yours", "assistant", "routine", "done"].map((g) =>
      html.indexOf(`data-todo-group="${g}"`),
    );
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const label of ["你的事", "Galley 在办", "例行", "已完成"]) {
      expect(html).toContain(`>${label}<`);
    }
    const parts = ["today", "later", "anytime"].map((p) =>
      html.indexOf(`data-todo-part="${p}"`),
    );
    expect(parts).toEqual([...parts].sort((a, b) => a - b));
    // No input anywhere (ruling 91 point 6).
    expect(html).not.toContain('<input type="text"');
    expect(html).not.toContain("<textarea");
  });

  it("draws no empty group and no empty part", () => {
    const html = panel({
      ...EMPTY_TODO,
      yours: { today: [], later: [REMINDED], anytime: [] },
      routine: [ROUTINE],
    });
    expect(html).toContain('data-todo-group="yours"');
    expect(html).toContain('data-todo-part="later"');
    expect(html).not.toContain('data-todo-part="today"');
    expect(html).not.toContain('data-todo-part="anytime"');
    expect(html).not.toContain('data-todo-group="assistant"');
    expect(html).not.toContain('data-todo-group="done"');
    expect(html).toContain('data-todo-group="routine"');
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
    const html = panel(EMPTY_TODO);
    expect(html).toContain('data-role="todo-empty"');
    expect(html).toContain("你要办的事、Galley 在办的事，都会记在这里。");
    expect(html).toContain("比如跟 Galley 说：「周三下午 3 点前要交季度报告」");
    expect(html).toContain(">去跟 Galley 说<");
    // Before the first read: nothing, no flash of the empty state.
    store.loaded = false;
    expect(panel(EMPTY_TODO)).not.toContain('data-role="todo-empty"');
  });

  it("names the groups in English, never 「Galley」 in capitals", () => {
    const html = panel(FULL, { language: "en-US" });
    expect(html).not.toContain("uppercase");
    for (const label of ["Yours", "Galley&#x27;s on it", "Routine", "Done"]) {
      expect(html).toContain(`>${label}<`);
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

  it("holds a tick in place: ticked, struck through, its reminder gone", () => {
    store.flips = { todo_report: { done: true, phase: "settling" } };
    const report = row(panel(FULL), "todo_report");
    expect(report).toContain("checked");
    expect(report).toContain("line-through");
    expect(report).not.toContain("提醒 ");
    expect(report).not.toContain('aria-label="取消提醒"');
    // Still in 以后, where it was.
    const html = panel(FULL);
    expect(html.indexOf('data-todo-row="todo_report"')).toBeGreaterThan(
      html.indexOf('data-todo-part="later"'),
    );
  });

  it("says why a write failed, under the row", () => {
    store.failures = { todo_late: "failed" };
    expect(row(panel(FULL), "todo_late")).toContain(
      'role="alert" class="pb-1.5 pl-9 pr-3 text-[11.5px] leading-[1.45] text-error">没能完成，再试一次。',
    );
    store.failures = { todo_late: "gone" };
    expect(row(panel(FULL), "todo_late")).toContain("这件事已经不在了。");
  });

  it("writes the day each of 你的事's rows was noted, last on its second line (ticket 43)", () => {
    const html = panel({
      ...FULL,
      yours: {
        today: [{ ...OVERDUE, createdAt: inDays(-3, 10) }],
        later: [{ ...REMINDED, createdAt: inDays(-1, 22) }],
        anytime: [{ ...ANYTIME, createdAt: inDays(0, 8) }],
      },
      done: [{ ...DONE_TODO, createdAt: inDays(-1, 8) }],
    });
    const d = new Date(inDays(-3, 10));
    expect(row(html, "todo_late")).toContain(
      `>${d.getMonth() + 1}月${d.getDate()}日 记下<`,
    );
    const report = row(html, "todo_report");
    expect(report).toContain(">昨天 记下<");
    // Due, reminder, then the day (cut first when narrow); 「取消提醒」
    // stays on that line, outside what is cut.
    const meta = report.slice(report.indexOf('data-role="todo-meta"'));
    expect(meta.indexOf("截止 ")).toBeLessThan(meta.indexOf("提醒 "));
    expect(meta.indexOf("提醒 ")).toBeLessThan(meta.indexOf("昨天 记下"));
    expect(meta.indexOf("昨天 记下")).toBeLessThan(meta.indexOf("取消提醒"));
    expect(meta).toMatch(
      /<span class="min-w-0 truncate">[^]*昨天 记下[^]*<\/span><button[^>]*aria-label="取消提醒"/,
    );
    // A row with nothing else to say has the day alone.
    expect(row(html, "todo_soil")).toContain(">今天 记下<");
    // 已完成 dates the tick, not the noting.
    expect(
      row(
        panel(
          { ...FULL, done: [{ ...DONE_TODO, createdAt: inDays(-1, 8) }] },
          { doneOpen: true },
        ),
        "todo_done",
      ),
    ).not.toContain("记下");
    expect(
      row(
        panel(
          {
            ...FULL,
            yours: {
              ...FULL.yours,
              anytime: [{ ...ANYTIME, createdAt: inDays(0, 8) }],
            },
          },
          { language: "en-US" },
        ),
        "todo_soil",
      ),
    ).toContain(">Noted today<");
  });

  it("fades a done row only under C2 (TEMP variant switcher, main chat 42)", () => {
    store.flips = { todo_report: { done: true, phase: "settling" } };
    expect(row(panel(FULL), "todo_report")).not.toContain("opacity-60");
    variants.done = "C2";
    expect(row(panel(FULL), "todo_report")).toContain("opacity-60");
    expect(row(panel(FULL), "todo_late")).not.toContain("opacity-60");
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
  });

  it("done a month ago: still there, as 已完成 looks in the panel, and can be unticked", () => {
    const html = cards([LONG_DONE]);
    expect(html).toContain('data-todo-state="done"');
    expect(html).toContain('data-todo-checked="true"');
    expect(html).toContain('checked=""');
    expect(html).not.toContain('disabled=""');
    expect(html).toMatch(/text-ink-muted line-through[^>]*>交房租</);
    // Its due date quietly, never overdue.
    expect(html).not.toContain("逾期");
    expect(html).toContain("截止 ");
    // Under C2 the whole card fades, as the panel's done row does.
    expect(html).not.toContain("opacity-60");
    variants.done = "C2";
    expect(cards([LONG_DONE])).toContain("opacity-60");
    expect(row(panel(FULL, { doneOpen: true }), "todo_done")).toContain(
      "opacity-60",
    );
  });

  it("cancelled: the box takes no click, the title faded, 「已取消」 beside it", () => {
    const html = cards([CANCELLED]);
    expect(html).toContain('data-todo-state="cancelled"');
    expect(html).toContain('data-todo-checked="false"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('disabled=""');
    expect(html).toContain("cursor-not-allowed");
    // Faded, not struck: it was not done.
    expect(html).toMatch(/text-ink-muted"[^>]*>买营养土</);
    expect(html).not.toContain("line-through");
    expect(html).toMatch(/data-role="todo-meta"[^>]*><span>[^]*>已取消</);
    // 「已取消」 in place of when it was due and its reminder.
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
    ).toContain(">Cancelled<");
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
