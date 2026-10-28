import * as Tooltip from "@radix-ui/react-tooltip";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_TODO,
  type TodoItem,
  type YourTodos,
} from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import { todoButtonFit } from "@/lib/todo-button";

import { TodoToggleButton } from "./TodoToggleButton";

/**
 * Galley's 待办 in its top bar (main chat ticket 45): the list icon, N
 * beside it only when N > 0 (Core's `todayCount`, plain text, never a
 * badge), pressed and `bg-selected` while the panel is open; named
 * 「待办与备忘」 since ticket 103 (PRD ruling 148 point 4). Three looks
 * by your things since ticket 106 (ruling 152, 戊2 of ticket 104's
 * pick): the word 「待办」 with none of yours, the capsule — the first
 * row in a hairline pill — while that row is one of today's or overdue,
 * the icon otherwise; the word and the capsule give way on a narrow
 * header by its width. Static rendering reads a store's initial state,
 * so the list and today are handed in by mocking the hooks. Today is
 * Wednesday 28 October 2026 in whatever zone the run is in.
 */

const TODAY = vi.hoisted(() => new Date(2026, 9, 28).getTime());
vi.mock("@/hooks/useDayStamp", () => ({ useDayStamp: () => TODAY }));

const list = vi.hoisted(() => ({
  yours: { today: [], later: [], anytime: [] } as YourTodos,
  todayCount: 0,
  deleting: {} as Record<string, unknown>,
}));
vi.mock("@/stores/assistant-todo", () => ({
  useAssistantTodoStore: (select: (state: unknown) => unknown) =>
    select({
      todo: { ...EMPTY_TODO, yours: list.yours, todayCount: list.todayCount },
      deleting: list.deleting,
    }),
}));
afterEach(() => {
  list.yours = { today: [], later: [], anytime: [] };
  list.todayCount = 0;
  list.deleting = {};
});

function todo(
  id: string,
  text: string,
  days?: number,
  hh?: number,
  extra: Partial<TodoItem> = {},
): TodoItem {
  const item: TodoItem = {
    kind: "todo",
    id,
    text,
    state: "open",
    createdBy: "assistant",
    ...extra,
  };
  if (days === undefined) return item;
  const d = new Date(2026, 9, 28 + days);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (hh === undefined) return { ...item, due: { date, hasTime: false } };
  d.setHours(hh);
  return {
    ...item,
    due: { date, hasTime: true, at: d.toISOString(), time: `${hh}:00` },
  };
}

function render(
  opts: { open?: boolean; language?: "zh-CN" | "en-US" } = {},
): string {
  return renderToStaticMarkup(
    <CopyProvider language={opts.language ?? "zh-CN"}>
      <Tooltip.Provider>
        <TodoToggleButton open={opts.open ?? false} onToggle={() => {}} />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

/** The button's own tag. */
const tag = (html: string) =>
  html.slice(
    html.indexOf("<button"),
    html.indexOf(">", html.indexOf("<button")),
  );

/** Three of today's (「+2」) and one later. */
const today3 = () => {
  list.yours = {
    today: [
      todo("t1", "交周报", 0, 15),
      todo("t2", "回邮件", 0, 18),
      todo("t3", "订机票", 0),
    ],
    later: [todo("l1", "取快递", 2, 15)],
    anytime: [],
  };
  list.todayCount = 3;
};

describe("the three looks (ticket 106, PRD ruling 152)", () => {
  it("writes 待办 after the icon with none of yours, 13px in the button's ink, the count after it", () => {
    const html = render();
    expect(html).toContain('data-shape="word"');
    expect(html).toContain('aria-label="待办与备忘"');
    const icon = html.indexOf("<svg");
    const word = html.indexOf(">待办<");
    expect(icon).toBeGreaterThan(-1);
    expect(word).toBeGreaterThan(icon);
    expect(html).toMatch(/class="text-\[13px\] leading-none [^"]*">待办</);
    // 4px after the icon, the icon where the square has it.
    expect(html).toContain("w-auto gap-1 px-[5px]");
    // No colour of its own, no capsule frame.
    expect(html).not.toMatch(/text-(ink|warning|brand)[^-]*">待办</);
    expect(html).not.toContain("rounded-full");
    expect(html).not.toContain("data-capsule-body");
    expect(render({ language: "en-US" })).toContain(">To-do<");
    // A count Core still has for today's deleted ones comes after it.
    list.todayCount = 2;
    const counted = render();
    expect(counted.indexOf(">2<")).toBeGreaterThan(counted.indexOf(">待办<"));
  });

  it("is the list icon alone while the first of yours is later's or anytime's: a 28px square", () => {
    const fills: Record<string, YourTodos> = {
      later: { today: [], later: [todo("l1", "取快递", 2, 15)], anytime: [] },
      anytime: { today: [], later: [], anytime: [todo("a1", "整理发票")] },
    };
    for (const [name, yours] of Object.entries(fills)) {
      list.yours = yours;
      const html = render();
      expect(html, name).toContain('data-role="topbar-todo"');
      expect(html, name).toContain('data-shape="icon"');
      expect(html, name).toContain('aria-label="待办与备忘"');
      expect(html, name).toContain("size-7");
      expect(html, name).not.toContain("w-auto");
      expect(html, name).not.toContain("tabular-nums");
      // Neither the row nor the word.
      expect(html, name).not.toContain("取快递");
      expect(html, name).not.toContain("整理发票");
      expect(html, name).not.toContain(">待办<");
      expect(html, name).not.toContain("data-capsule-body");
      expect(render({ language: "en-US" }), name).toContain(
        'aria-label="To-do and memos"',
      );
    }
  });

  it("is the capsule while the first of yours is one of today's, 「+N」 for today's others", () => {
    today3();
    const html = render();
    expect(html).toContain('data-shape="capsule"');
    expect(html).toContain(">今天 15:00<");
    expect(html).toContain(">交周报<");
    expect(html).toContain(">+2<");
    expect(html).not.toContain(">待办<");
  });

  it("is the capsule while the first of yours is overdue, 「+N」 for today's others", () => {
    list.yours = {
      today: [
        todo("q1", "交季度报告", -2, undefined, { overdue: true }),
        todo("t1", "交周报", 0, 15),
      ],
      later: [todo("l1", "取快递", 2, 15)],
      anytime: [],
    };
    list.todayCount = 2;
    const html = render();
    expect(html).toContain('data-shape="capsule"');
    expect(html).toContain(">逾期 2 天<");
    expect(html).toContain(">交季度报告<");
    expect(html).toContain(">+1<");
  });
});

describe("the top bar's 待办 button", () => {
  it("writes today's count beside the icon, as text and not a badge", () => {
    // The icon look with a count: today's three deleted in the panel and
    // waiting on their undo, Core still counting them.
    today3();
    list.deleting = { t1: {}, t2: {}, t3: {} };
    const html = render();
    expect(html).toContain('data-shape="icon"');
    expect(html).toContain('aria-label="待办与备忘 · 今天 3"');
    expect(html).toMatch(/text-\[12px\] leading-none tabular-nums">3</);
    // Widened from the square's left edge, the icon where it was.
    expect(html).toContain("w-auto gap-1 px-[5px]");
    // Not a badge: no pill, no fill, no status colour.
    expect(html).not.toContain("rounded-full");
    expect(html).not.toMatch(/bg-(warning|error|brand)/);
    expect(html).not.toMatch(/text-(warning|error|brand)/);
    expect(render({ language: "en-US" })).toContain(
      'aria-label="To-do and memos · Today 3"',
    );
  });

  it("is a pressed toggle, selected while the panel is open (the Changes button's grammar)", () => {
    const closed = render();
    expect(closed).toContain('aria-pressed="false"');
    // The selected material only answers aria-pressed; at rest the hover.
    expect(closed).toContain("aria-pressed:bg-selected");
    expect(closed).toContain("hover:bg-hover");
    // Not a popover trigger: no aria-expanded press state.
    expect(closed).not.toContain('aria-expanded="');
    expect(render({ open: true })).toContain('aria-pressed="true"');
  });
});

describe("the word", () => {
  it("gives way first on a narrow header, by the header's width", () => {
    const html = render();
    // jsdom-free: the classes say it — hidden, inline from the header's
    // threshold, 7px on the right only with the word.
    expect(html).toMatch(
      /class="text-\[13px\] leading-none hidden @min-\[\d+px\]\/main-header:inline"/,
    );
    expect(html).toMatch(/@min-\[\d+px\]\/main-header:pr-\[7px\]/);
  });
});

describe("the capsule (ticket 104, PRD ruling 150)", () => {
  it("writes the first row 「时间 · 标题」 and 「+N」 for today's others, named in full", () => {
    today3();
    const html = render();
    expect(html).toContain('data-shape="capsule"');
    expect(html).toContain('aria-label="待办与备忘 · 今天 15:00 · 交周报"');
    const body = html.slice(html.indexOf("data-capsule-body"));
    const at = (s: string) => body.indexOf(s);
    expect(at(">今天 15:00<")).toBeGreaterThan(-1);
    expect(at("> · <")).toBeGreaterThan(at(">今天 15:00<"));
    expect(at(">交周报<")).toBeGreaterThan(at("> · <"));
    expect(at(">+2<")).toBeGreaterThan(at(">交周报<"));
    // The icon first, as on every look.
    expect(html.indexOf("<svg")).toBeLessThan(
      html.indexOf("data-capsule-body"),
    );
  });

  it("draws time and 「 · 」 ink-muted, the title ink-soft and cut, 「+N」 tabular ink-muted", () => {
    today3();
    const html = render();
    expect(html).toMatch(
      /class="shrink-0 whitespace-nowrap tabular-nums text-ink-muted">今天 15:00</,
    );
    expect(html).toMatch(/class="shrink-0 whitespace-pre text-ink-muted"> · </);
    expect(html).toMatch(/class="min-w-0 truncate text-ink-soft">交周报</);
    expect(html).toMatch(
      /class="ml-1 shrink-0 tabular-nums text-ink-muted">\+/,
    );
    expect(html).toMatch(
      /data-capsule-body="" class="min-w-0 items-baseline text-\[12px\] leading-none /,
    );
  });

  it("writes the overdue part in warning, as the panel's row, and nothing else in colour", () => {
    list.yours = {
      today: [todo("q1", "交季度报告", -2, undefined, { overdue: true })],
      later: [],
      anytime: [],
    };
    list.todayCount = 1;
    const html = render();
    expect(html).toMatch(
      /class="shrink-0 whitespace-nowrap tabular-nums font-medium text-warning">逾期 2 天</,
    );
    expect(html.match(/text-warning/g)).toHaveLength(1);
    expect(html).not.toMatch(/bg-(warning|error|brand)/);
  });

  it("is a 28px hairline pill from the fold up: rounded-full, border-line, 5px left, 9px right, 220px at most", () => {
    today3();
    const button = tag(render());
    for (const cls of [
      "w-auto",
      "rounded-full",
      "border-line",
      "pl-[5px]",
      "pr-[9px]",
      "justify-start",
    ]) {
      expect(button, cls).toMatch(
        new RegExp(
          `@min-\\[\\d+px\\]/main-header:${cls.replace(/[[\]]/g, "\\$&")}(\\s|")`,
        ),
      );
    }
    expect(button).toMatch(
      /@min-\[\d+px\]\/main-header:max-w-\[min\(220px,calc\(100cqw_-_\d+px\)\)\]/,
    );
    // 28px high: the square's height stays.
    expect(button).toContain("size-7");
    // The pressed state as on every look.
    expect(button).toContain("aria-pressed:bg-selected");
  });

  it("folds to the icon and today's count under the fold: the body hidden until the header is wide enough", () => {
    today3();
    const html = render();
    expect(html).toMatch(
      /data-capsule-body="" class="[^"]* hidden @min-\[\d+px\]\/main-header:flex"/,
    );
    expect(html).toMatch(
      /class="text-\[12px\] leading-none tabular-nums @min-\[\d+px\]\/main-header:hidden">3</,
    );
  });

  it("reads the panel's list: a to-do deleted there and waiting on its undo is not the first row", () => {
    today3();
    list.deleting = { t1: {} };
    expect(render()).toContain(">回邮件<");
    expect(render()).not.toContain(">交周报<");
  });

  it("writes To-do and memos in English", () => {
    today3();
    expect(render({ language: "en-US" })).toContain(
      'aria-label="To-do and memos · Today 3:00 PM · 交周报"',
    );
  });
});

describe("the narrow-header classes, pinned to lib/todo-button.ts", () => {
  /** Each table's entries in source order: macOS zh, en, then Windows /
   * Linux zh, en (a static render only reaches one platform's). */
  const source = readFileSync(
    path.resolve(__dirname, "TodoToggleButton.tsx"),
    "utf8",
  );
  const block = (name: string) =>
    source.slice(
      source.indexOf(`const ${name} = isMac`),
      source.indexOf("};\n", source.indexOf(`const ${name} = isMac`)),
    );
  const order = [
    ["zh", "mac"],
    ["en", "mac"],
    ["zh", "other"],
    ["en", "other"],
  ] as const;

  it("shows the word from `word` up", () => {
    const words = [
      ...block("WORD").matchAll(
        /word: "hidden @min-\[(\d+)px\]\/main-header:inline"/g,
      ),
    ].map((m) => Number(m[1]));
    const pads = [
      ...block("WORD").matchAll(
        /pad: "@min-\[(\d+)px\]\/main-header:pr-\[7px\]"/g,
      ),
    ].map((m) => Number(m[1]));
    const want = order.map(([l, p]) => todoButtonFit(l, p).word);
    expect(words).toEqual(want);
    expect(pads).toEqual(want);
  });

  it("draws the capsule from `fold` up, at most `min(220px, 100cqw - rest)`", () => {
    const shells = [...block("CAPSULE").matchAll(/shell:\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    const bodies = [
      ...block("CAPSULE").matchAll(
        /body: "hidden @min-\[(\d+)px\]\/main-header:flex"/g,
      ),
    ].map((m) => Number(m[1]));
    const folded = [
      ...block("CAPSULE").matchAll(
        /folded: "@min-\[(\d+)px\]\/main-header:hidden"/g,
      ),
    ].map((m) => Number(m[1]));
    expect(shells).toHaveLength(4);
    order.forEach(([l, p], i) => {
      const { rest, fold } = todoButtonFit(l, p);
      const at = new Set(
        [...shells[i].matchAll(/@min-\[(\d+)px\]/g)].map((m) => Number(m[1])),
      );
      expect([...at], `${l} ${p}`).toEqual([fold]);
      expect(shells[i], `${l} ${p}`).toContain(
        `max-w-[min(220px,calc(100cqw_-_${rest}px))]`,
      );
      expect(bodies[i], `${l} ${p}`).toBe(fold);
      expect(folded[i], `${l} ${p}`).toBe(fold);
    });
  });

  it("renders this platform's numbers (Windows / Linux in a test run)", () => {
    today3();
    const zh = todoButtonFit("zh", "other");
    const en = todoButtonFit("en", "other");
    expect(render()).toContain(`@min-[${zh.fold}px]/main-header:rounded-full`);
    expect(render({ language: "en-US" })).toContain(
      `@min-[${en.fold}px]/main-header:rounded-full`,
    );
    list.yours = { today: [], later: [], anytime: [] };
    list.todayCount = 0;
    expect(render()).toContain(`@min-[${zh.word}px]/main-header:inline`);
    expect(render({ language: "en-US" })).toContain(
      `@min-[${en.word}px]/main-header:inline`,
    );
  });
});

describe("ticket 104's switcher is gone (ticket 106)", () => {
  const SRC = path.resolve(__dirname, "../../..");
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
    });
  }

  it("leaves no pill, store, storage key, replay or marker behind", () => {
    // Spelled in pieces, so a grep of the tree for them finds none (the
    // ticket's check), this file included. Tickets 102's and 103's
    // switchers went with ticket 104; their markers and keys too.
    const marker = ["TEMP variant switcher", "(main chat 10"].join(" ");
    const leftovers = [
      ["todo-button", "variants"].join("-"),
      ["useTodoButton", "Variants"].join(""),
      ["TodoButton", "VariantsPill"].join(""),
      ["galley.tmp.todoButton", "Place"].join(""),
      ["galley.tmp.todoButton", "Capsule"].join(""),
      ["galley.tmp.todo", "Flight"].join(""),
      ["introduced", "AtLaunch"].join(""),
      ["replay", "Flight"].join(""),
      `${marker}2)`,
      `${marker}3)`,
      `${marker}4)`,
    ];
    const hits = sources(SRC)
      .filter((file) => !file.includes("zz-harness"))
      .flatMap((file) => {
        const text = readFileSync(file, "utf8");
        return leftovers
          .filter((needle) => text.includes(needle))
          .map((needle) => `${path.relative(SRC, file)}: ${needle}`);
      });
    expect(hits).toEqual([]);
  });
});
