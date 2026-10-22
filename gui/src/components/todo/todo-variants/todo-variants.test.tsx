// @vitest-environment jsdom
import * as Tooltip from "@radix-ui/react-tooltip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
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
} from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import { useAssistantTodoStore } from "@/stores/assistant-todo";
import { useUiStore } from "@/stores/ui";
import { getTauriMocks } from "@/test/setup";

import { TodoPanel } from "../TodoPanel";
import {
  demoTodo,
  densityLook,
  LABEL_PAD,
  useTodoVariants,
  type DensityLook,
} from "./todo-variants";
import { TodoVariantsPill } from "./TodoVariantsPill";

/**
 * The temporary switcher for the to-do panel's density (main chat
 * ticket 85, PRD ruling 130), mounted with the real stores: 现状 is
 * today's markup to the byte (a snapshot taken before the switcher was
 * written), B runs 你的事 as one unlabelled part in Core's order, B+C
 * tightens the group labels, 「演示」 shows a list of its own and asks
 * nothing of Core, the pill is a dev build's only, and the switcher
 * touches only the places its removal steps name. The marker is spelt
 * in two halves here so this file is not one of its own hits.
 */

const MARK = ["TEMP variant switcher", "(main chat 85)"].join(" ");

const autostart = vi.hoisted(() => ({ enabled: true }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => autostart.enabled,
  enable: async () => {},
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

// Times whose words do not change with the day the suite runs on: today,
// tomorrow, two days ago, and a far year.
function inDays(days: number, hour = 9, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
function dayIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todo(extra: Partial<TodoItem>): TodoItem {
  return {
    kind: "todo",
    id: "todo_x",
    text: "",
    state: "open",
    createdBy: "assistant",
    createdIn: { sessionId: "s-main", turnIndex: 4 },
    ...extra,
  };
}

const LATE = todo({
  id: "todo_late",
  text: "交物业费",
  due: { date: dayIn(-2), hasTime: false },
  overdue: true,
});
const TONIGHT = todo({
  id: "todo_tonight",
  text: "取干洗的衣服",
  due: { date: dayIn(0), hasTime: true, at: inDays(0, 18), time: "18:00" },
  reminder: { taskId: "sched_r1", at: inDays(0, 17, 30), state: "scheduled" },
});
const TODAY = todo({
  id: "todo_today",
  text: "给花浇水",
  due: { date: dayIn(0), hasTime: false },
});
const TOMORROW = todo({
  id: "todo_tomorrow",
  text: "去银行办卡",
  due: { date: dayIn(1), hasTime: true, at: inDays(1, 10), time: "10:00" },
  reminder: { taskId: "sched_r2", at: inDays(1, 9, 30), state: "scheduled" },
});
const FAR = todo({
  id: "todo_far",
  text: "续签租房合同",
  due: { date: "2099-11-20", hasTime: false },
  notes: "带上身份证和上次的合同复印件",
});
const ANYTIME = todo({
  id: "todo_anytime",
  text: "买营养土",
  createdIn: undefined,
});
const SUBTASK: TodoItem = {
  kind: "subtask",
  id: "s-sub",
  text: "比较三款空气净化器",
  state: "running",
  createdBy: "assistant",
  at: inDays(0, 9),
};
const OWN: TodoItem = {
  kind: "task",
  id: "sched_umbrella",
  text: "提醒带伞",
  state: "scheduled",
  createdBy: "assistant",
  target: "assistant",
  repeat: { kind: "once" },
  at: inDays(1, 9),
  createdIn: { sessionId: "s-main", turnIndex: 6 },
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
const DONE: TodoItem = todo({
  id: "todo_done",
  text: "订餐厅",
  state: "done",
  at: inDays(0, 7),
});
const LIST: AssistantTodo = {
  ...EMPTY_TODO,
  yours: {
    today: [LATE, TONIGHT, TODAY],
    later: [TOMORROW, FAR],
    anytime: [ANYTIME],
  },
  assistant: [SUBTASK, OWN],
  routine: [ROUTINE],
  done: [DONE],
  todayCount: 3,
};

let root: Root | null = null;
beforeEach(() => {
  useAssistantTodoStore.setState({
    todo: LIST,
    noted: [],
    loaded: true,
    flips: {},
    failures: {},
    cancelling: {},
  });
  useTodoVariants.setState({ look: "now", source: "real" });
  autostart.enabled = true;
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllEnvs();
});

function mount(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <CopyProvider language="zh-CN">
        <Tooltip.Provider>{node}</Tooltip.Provider>
      </CopyProvider>,
    );
  });
  return container;
}

const panel = (
  opts: { doneOpen?: boolean; onOpenSession?: (id: string) => void } = {},
) =>
  mount(
    <TodoPanel
      mainChatId="s-main"
      here="galley"
      onOpenSession={opts.onOpenSession ?? (() => {})}
      onTalk={() => {}}
      onClose={() => {}}
      defaultDoneOpen={opts.doneOpen ?? true}
    />,
  );

/** The panel's list: the groups, as markup. */
const groups = (container: HTMLElement) =>
  container.querySelector('[data-role="todo-groups"]')?.outerHTML ?? "";

describe("现状 (the default)", () => {
  it("draws the panel's groups exactly as before the switcher", () => {
    expect(groups(panel())).toMatchSnapshot("groups");
  });
});

function pick(look: DensityLook) {
  act(() => useTodoVariants.setState({ look }));
}

const rowIds = (el: Element | null | undefined) =>
  [...(el?.querySelectorAll("[data-todo-row]") ?? [])].map((row) =>
    row.getAttribute("data-todo-row"),
  );

const labels = (container: HTMLElement) =>
  [...container.querySelectorAll("section > :first-child")]
    .filter((el) => el.className.includes("font-semibold"))
    .map((el) => el.querySelector("span")?.textContent);

const meta = (container: HTMLElement, id: string) =>
  container
    .querySelector(`[data-todo-row="${id}"] [data-role="todo-meta"]`)
    ?.textContent?.replace(/\s+/g, " ")
    .trim();

describe("the looks", () => {
  it("start on 现状 and 真实; B+C is B and then some", () => {
    expect(useTodoVariants.getInitialState()).toMatchObject({
      look: "now",
      source: "real",
    });
    expect(densityLook("now")).toEqual({
      flatYours: false,
      tightLabels: false,
    });
    expect(densityLook("B")).toEqual({ flatYours: true, tightLabels: false });
    expect(densityLook("BC")).toEqual({ flatYours: true, tightLabels: true });
    expect(LABEL_PAD).toEqual({ normal: "py-1.5", tight: "py-[3px]" });
  });

  it("B: 你的事 is one part with no label, Core's lists end to end, worded as outside 今天", () => {
    const before = panel();
    const beforeRows = Object.fromEntries(
      [...before.querySelectorAll("[data-todo-row]")].map((row) => [
        row.getAttribute("data-todo-row"),
        row.outerHTML,
      ]),
    );
    act(() => root?.unmount());
    pick("B");
    const container = panel();
    const parts = container.querySelectorAll('[data-todo-group="yours"]');
    expect(parts).toHaveLength(1);
    const part = parts[0];
    expect(part.getAttribute("data-todo-part")).toBe("all");
    // First in the list, no label of its own.
    expect(
      container.querySelector('[data-role="todo-groups"]')?.firstElementChild,
    ).toBe(part);
    expect(part.firstElementChild?.hasAttribute("data-todo-row")).toBe(true);
    expect(rowIds(part)).toEqual([
      "todo_late",
      "todo_tonight",
      "todo_today",
      "todo_tomorrow",
      "todo_far",
      "todo_anytime",
    ]);
    // The other groups as they were, under their labels.
    expect(labels(container)).toEqual(["Galley 在办", "例行", "已完成"]);
    // Today's rows say 「今天」; overdue stays warning; the bell stays.
    // The bell is a glyph and a gap, not a space.
    expect(meta(container, "todo_tonight")).toBe("今天 18:0017:30");
    expect(meta(container, "todo_today")).toBe("今天");
    expect(meta(container, "todo_late")).toBe("逾期 2 天");
    expect(
      container.querySelector(
        '[data-todo-row="todo_late"] [data-role="todo-meta"] .text-warning',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-todo-row="todo_tonight"] [aria-label="提醒 今天 17:30"]',
      ),
    ).not.toBeNull();
    // A row not under 今天 is the very row it was.
    for (const id of ["todo_tomorrow", "todo_far", "todo_anytime", "s-sub"]) {
      expect(
        container.querySelector(`[data-todo-row="${id}"]`)?.outerHTML,
      ).toBe(beforeRows[id]);
    }
  });

  it("B: no part when there is none of yours; the first group is the next one", () => {
    act(() =>
      useAssistantTodoStore.setState({
        todo: {
          ...LIST,
          yours: { today: [], later: [], anytime: [] },
          todayCount: 0,
        },
      }),
    );
    pick("B");
    const container = panel();
    expect(container.querySelector('[data-todo-group="yours"]')).toBeNull();
    expect(
      container
        .querySelector('[data-role="todo-groups"]')
        ?.firstElementChild?.getAttribute("data-todo-group"),
    ).toBe("assistant");
  });

  it("B+C: B, and every group label 3px top and bottom, 已完成's button too", () => {
    const labelClasses = (container: HTMLElement) =>
      [...container.querySelectorAll("section > :first-child")]
        .filter((el) => el.className.includes("font-semibold"))
        .map((el) => el.className);
    const now = labelClasses(panel());
    act(() => root?.unmount());
    expect(now).toHaveLength(6);
    for (const c of now) expect(c).toContain("py-1.5");
    pick("B");
    const b = labelClasses(panel());
    act(() => root?.unmount());
    pick("BC");
    const container = panel();
    const bc = labelClasses(container);
    expect(bc).toHaveLength(3);
    expect(bc).toEqual(b.map((c) => c.replace("py-1.5", "py-[3px]")));
    expect(
      container.querySelector('[data-todo-group="done"] button[aria-expanded]')
        ?.className,
    ).toContain("py-[3px]");
    expect(container.querySelector('[data-todo-part="all"]')).not.toBeNull();
    // The gap between groups stays.
    expect(
      container.querySelector('[data-role="todo-groups"]')?.className,
    ).toBe("space-y-3");
  });
});

describe("「演示」", () => {
  const MONTH_START = (y: number, m: number, d: number) =>
    new Date(y, m - 1, d).getTime();

  it("lists a dozen things across every group, timed from the day", () => {
    const demo = demoTodo(MONTH_START(2026, 10, 22));
    expect(demo.yours.today.map((t) => t.text)).toEqual([
      "交物业费",
      "取干洗的衣服",
      "给花浇水",
    ]);
    expect(demo.yours.today[0].overdue).toBe(true);
    expect(demo.yours.today[0].due?.date).toBe("2026-10-20");
    expect(demo.yours.today[1].due?.time).toBe("18:00");
    expect(demo.yours.today[1].reminder?.state).toBe("scheduled");
    expect(demo.yours.today[2].due).toEqual({
      date: "2026-10-22",
      hasTime: false,
    });
    expect(demo.yours.later.map((t) => t.due?.date)).toEqual([
      "2026-10-23",
      "2026-10-28",
      "2026-11-20",
    ]);
    expect(demo.yours.later[0].reminder?.state).toBe("scheduled");
    expect(demo.yours.later[2].notes).toBeTruthy();
    expect(demo.yours.anytime).toHaveLength(2);
    expect(demo.yours.anytime.filter((t) => t.notes)).toHaveLength(1);
    expect(demo.assistant.map((t) => [t.kind, t.state])).toEqual([
      ["subtask", "running"],
      ["task", "scheduled"],
    ]);
    expect(demo.routine.map((t) => t.repeat)).toEqual([
      { kind: "daily" },
      { kind: "weekly", weekdays: [1] },
    ]);
    // 2026-10-22 is a Thursday: the Monday after is the 26th.
    expect(new Date(demo.routine[1].at!).getDate()).toBe(26);
    expect(demo.done.map((t) => t.kind)).toEqual(["todo", "subtask", "todo"]);
    expect(demo.doneOmitted).toBe(0);
    // Nothing that leads into a real conversation.
    const all = [
      ...demo.yours.today,
      ...demo.yours.later,
      ...demo.yours.anytime,
      ...demo.assistant,
      ...demo.routine,
      ...demo.done,
    ];
    expect(all).toHaveLength(15);
    expect(all.some((t) => t.createdIn || t.runSessionId)).toBe(false);
    expect(new Set(all.map((t) => t.id)).size).toBe(15);
  });

  it("keeps 以后 in day order whatever the day: 20 November is next year's once it is near", () => {
    for (const start of [
      MONTH_START(2026, 11, 15),
      MONTH_START(2026, 12, 31),
      MONTH_START(2026, 11, 21),
    ]) {
      const dates = demoTodo(start).yours.later.map((t) => t.due!.date);
      expect(dates).toEqual([...dates].sort());
      expect(dates[2]).toBe("2027-11-20");
    }
    // A Monday's next Monday is a week on, not today.
    const monday = demoTodo(MONTH_START(2026, 10, 26)).routine[1];
    expect(new Date(monday.at!).getDate()).toBe(2);
  });

  it("shows the whole demo list in place of the real one, folded 已完成, no empty state", async () => {
    act(() =>
      useAssistantTodoStore.setState({ todo: EMPTY_TODO, loaded: true }),
    );
    act(() => useTodoVariants.setState({ source: "demo" }));
    const container = panel({ doneOpen: false });
    expect(container.querySelector('[data-role="todo-empty"]')).toBeNull();
    expect(rowIds(container)).toHaveLength(12);
    expect(container.querySelector('[data-todo-row="todo_late"]')).toBeNull();
    const done = container.querySelector(
      '[data-todo-group="done"] button[aria-expanded]',
    );
    expect(done?.getAttribute("aria-expanded")).toBe("false");
    expect(done?.textContent).toBe("已完成3");
    expect(labels(container)).toEqual([
      "今天",
      "以后",
      "随时",
      "Galley 在办",
      "例行",
      "已完成",
    ]);
    // The review by its own name, the weekly one by its rule.
    expect(container.textContent).toContain("过一遍在办的事");
    expect(container.textContent).toContain("每周一 09:00");
    // And in B, the demo's 你的事 as one part.
    pick("B");
    expect(
      rowIds(container.querySelector('[data-todo-part="all"]')),
    ).toHaveLength(8);
  });

  it("leaves the launch-at-login hint to the real list", async () => {
    autostart.enabled = false;
    act(() => useTodoVariants.setState({ source: "demo" }));
    // Real: nothing set to go off (the review does not count).
    act(() =>
      useAssistantTodoStore.setState({ todo: EMPTY_TODO, loaded: true }),
    );
    const quiet = panel();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(quiet.querySelector('[data-role="todo-autostart-hint"]')).toBeNull();
    act(() => root?.unmount());
    // Real: a reminder to go off — the hint, whatever the demo shows.
    act(() => useAssistantTodoStore.setState({ todo: LIST }));
    const loud = panel();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      loud.querySelector('[data-role="todo-autostart-hint"]'),
    ).not.toBeNull();
  });

  it("asks nothing of Core and goes nowhere: a box, a cancel, 「说说这件」, a title", async () => {
    const { invoke } = getTauriMocks();
    const opened: string[] = [];
    useUiStore.setState({ quoteRequest: null });
    act(() => useTodoVariants.setState({ source: "demo" }));
    const container = panel({ onOpenSession: (id) => opened.push(id) });
    const click = (selector: string) => {
      const el = container.querySelector(selector);
      if (!(el instanceof HTMLElement)) throw new Error(`no ${selector}`);
      el.click();
    };
    await act(async () => {
      click('[data-todo-check="demo-tonight"]');
      click('[data-todo-row="demo-tonight"] button[aria-label="取消提醒"]');
      click('[data-todo-row="demo-umbrella"] button[aria-label="取消提醒"]');
      click('[data-todo-row="demo-plants"] button[aria-label="说说这件"]');
      click('[data-todo-row="demo-subtask"] .text-\\[13px\\] button');
      // 已完成 is open here (defaultDoneOpen): a done demo box too.
      click('[data-todo-check="demo-paid"]');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(opened).toEqual([]);
    expect(useUiStore.getState().quoteRequest).toBeNull();
    const state = useAssistantTodoStore.getState();
    expect(state.flips).toEqual({});
    expect(state.cancelling).toEqual({});
    expect(
      (
        container.querySelector(
          '[data-todo-check="demo-tonight"]',
        ) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });
});

describe("the pill", () => {
  it("is in a dev build: 现状 / B / B+C and 真实 / 演示, one click each", () => {
    mount(<TodoVariantsPill />);
    const pill = document.body.querySelector(
      '[data-role="todo-variants-pill"]',
    );
    expect(pill).not.toBeNull();
    expect((pill as HTMLElement).style.pointerEvents).toBe("auto");
    expect(pill?.textContent).toContain("临时 · 密度");
    const options = [...pill!.querySelectorAll("button")];
    expect(options.map((b) => b.textContent)).toEqual([
      "现状",
      "B 不分组",
      "B+C 组名收紧",
      "真实",
      "演示",
    ]);
    expect(options[0].getAttribute("aria-pressed")).toBe("true");
    act(() => options[2].click());
    expect(useTodoVariants.getState().look).toBe("BC");
    act(() => options[4].click());
    expect(useTodoVariants.getState().source).toBe("demo");
  });

  it("is nothing outside a dev build", () => {
    vi.stubEnv("DEV", false);
    mount(<TodoVariantsPill />);
    expect(
      document.body.querySelector('[data-role="todo-variants-pill"]'),
    ).toBeNull();
  });

  it("touches only the places its removal steps name", () => {
    const root = path.resolve(__dirname, "../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) {
          if (readFileSync(full, "utf8").includes(MARK)) {
            hits.push(path.relative(root, full).split(path.sep).join("/"));
          }
        }
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(
      [
        "App.tsx",
        "components/todo/TodoCheck.tsx",
        "components/todo/TodoPanel.tsx",
        "components/todo/todo-variants/TodoVariantsPill.tsx",
        "components/todo/todo-variants/todo-variants.ts",
      ].sort(),
    );
  });
});
