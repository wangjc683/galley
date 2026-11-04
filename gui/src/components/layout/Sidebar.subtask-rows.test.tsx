import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TodoItem, TodoState } from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";
import { makeSession } from "@/test/factories";
import type { Session } from "@/types/session";

import { Sidebar } from "./Sidebar";

/**
 * The subtasks Galley has in hand, under its card (main chat ticket 128,
 * PRD rulings 176, 177). lib/sidebar-subtasks.test.ts covers which and
 * in what order; this is where they stand and how they draw, folded
 * (static rendering: unfolding them in place, ruling 197, is
 * Sidebar.subtask-more.dom.test.tsx).
 */

// Static rendering reads the to-do store's first state; Galley's group
// is seeded here instead, through the real grouping.
const todo = vi.hoisted(() => ({ items: [] as TodoItem[] }));
vi.mock("@/hooks/useSidebarSubtasks", async () => {
  const { sidebarSubtasks } = await import("@/lib/sidebar-subtasks");
  return {
    useSidebarSubtasks: (subtasks: Session[]) =>
      sidebarSubtasks(todo.items, subtasks),
  };
});

afterEach(() => {
  todo.items = [];
});

const managed = (id: string, extra: Partial<Session> = {}) =>
  makeSession({
    id,
    title: `title-${id}`,
    gaRuntimeKind: "managed",
    runtimeKind: "managed",
    ...extra,
  });

const mainChat = managed("s-main", { title: "Galley", mainChat: true });
const sideChat = managed("s-side", { title: "订机票", origin: { via: "gui" } });
/** A subtask session started `minute` minutes past 09:00. */
const subtask = (id: string, title: string, minute: number) =>
  managed(id, {
    title,
    origin: { via: "subtask" },
    parentSessionId: "s-main",
    createdAt: new Date(Date.UTC(2026, 10, 3, 9, minute)).toISOString(),
  });
const item = (id: string, state: TodoState): TodoItem => ({
  kind: "subtask",
  id,
  text: id,
  state,
  createdBy: "assistant",
});

const invoices = subtask("s-inv", "整理下载文件夹里的发票", 1);
const notes = subtask("s-notes", "把会议纪要整理成一页", 2);
const vacuums = subtask("s-vac", "比较三款扫地机器人的价格", 3);

function render(
  sessions: Session[],
  opts: {
    activeId?: string;
    language?: "zh-CN" | "en-US";
  } = {},
) {
  return renderToStaticMarkup(
    <CopyProvider language={opts.language ?? "zh-CN"}>
      <Tooltip.Provider>
        <Sidebar
          sessions={sessions}
          activeId={opts.activeId}
          expandedProjectIds={[]}
          onNewChat={() => {}}
          onSelectSession={() => {}}
          onArchiveSession={() => {}}
        />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const CARD = 'data-role="assistant-card"';
const ROWS = 'data-role="sidebar-subtasks"';
const ROW = 'data-role="sidebar-subtask"';
const MORE = 'data-role="sidebar-subtasks-more"';
/** The card's block: 8px over the card, 6px under it, the strong line
 * its foot. */
const BLOCK = '<div class="border-b border-line-strong pb-1.5 pt-2">';
const SCROLL = '<div class="scrollbar-stable';

/** The card's block, from its opening tag to the scrolling list. */
const blockOf = (html: string) =>
  html.slice(html.indexOf(BLOCK), html.indexOf(SCROLL));
/** The opening tag of the element carrying `needle`. */
const tagWith = (html: string, needle: string) => {
  const i = html.indexOf(needle);
  return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
};
/** Each subtask row's opening tag, in order. */
const rowTags = (html: string) => {
  const tags: string[] = [];
  for (
    let i = html.indexOf(ROW + " ");
    i >= 0;
    i = html.indexOf(ROW + " ", i + 1)
  ) {
    tags.push(html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1));
  }
  return tags;
};
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("nothing in hand", () => {
  it("leaves the card's block as it was: the card alone", () => {
    for (const sessions of [
      [mainChat, sideChat],
      // Subtasks the sidebar has, none of them in Galley's group: done.
      [mainChat, sideChat, invoices, notes],
    ]) {
      const block = blockOf(render(sessions));
      expect(block.startsWith(BLOCK)).toBe(true);
      expect(count(block, "<button")).toBe(1);
      expect(block).toContain(CARD);
      expect(block.endsWith("</button></div>")).toBe(true);
      expect(block).not.toContain(ROWS);
    }
    // Identical to the pixel: the same markup with or without them.
    expect(blockOf(render([mainChat, sideChat, invoices, notes]))).toBe(
      blockOf(render([mainChat, sideChat])),
    );
  });

  it("lists nothing on the external runtime, which has no card", () => {
    todo.items = [item("s-inv", "running")];
    const html = render([sideChat, { ...invoices, gaRuntimeKind: "external" }]);
    expect(html).not.toContain(ROWS);
  });
});

describe("in hand", () => {
  it("hangs the rows under the card, inside its block, above the strong line", () => {
    todo.items = [item("s-inv", "running")];
    const html = render([mainChat, sideChat, invoices]);
    const block = blockOf(html);
    expect(block.indexOf(CARD)).toBeLessThan(block.indexOf(ROWS));
    expect(block.endsWith("</button></div></div>")).toBe(true);
    // 6px under the card.
    expect(tagWith(html, ROWS)).toContain('class="mt-1.5"');
    // Never in the workbench's list.
    expect(html.slice(html.indexOf(SCROLL))).not.toContain(
      "整理下载文件夹里的发票",
    );
  });

  it("puts what asks you first with its word; running says none, and nothing stopped is listed", () => {
    todo.items = [
      item("s-inv", "running"),
      item("s-notes", "failed"),
      item("s-vac", "asking"),
    ];
    const html = render([mainChat, sideChat, invoices, notes, vacuums]);
    const tags = rowTags(html);
    expect(tags.map((t) => /data-subtask-id="([^"]+)"/.exec(t)?.[1])).toEqual([
      "s-vac",
      "s-inv",
    ]);
    expect(tags.map((t) => /aria-label="([^"]+)"/.exec(t)?.[1])).toEqual([
      "子任务：比较三款扫地机器人的价格，等你回复",
      "子任务：整理下载文件夹里的发票",
    ]);
    const words = html.split('data-role="sidebar-subtask-state"').slice(1);
    expect(words).toHaveLength(1);
    expect(words[0]).toMatch(
      /^ class="[^"]*font-medium text-warning">等你回复</,
    );
    // Failed (ruling 177): no row, no word, no red anywhere in the zone.
    expect(html).not.toContain("把会议纪要整理成一页");
    expect(blockOf(html)).not.toContain("text-error");
  });

  it("lists nothing for subtasks that only failed, ran out of steps or stopped", () => {
    todo.items = [
      item("s-inv", "failed"),
      item("s-notes", "step_limit"),
      item("s-vac", "stopped"),
    ];
    expect(
      blockOf(render([mainChat, sideChat, invoices, notes, vacuums])),
    ).toBe(blockOf(render([mainChat, sideChat])));
  });

  // B3 (ruling 177 point 5): a size down from a session row; colour and
  // weight only for what asks you.
  it("draws B3: 28px rows, 12px titles, a muted spinner, weight for the question alone", () => {
    todo.items = [item("s-inv", "running"), item("s-vac", "asking")];
    const html = render([mainChat, sideChat, invoices, vacuums]);
    const [asking, running] = rowTags(html);
    for (const tag of [asking, running]) {
      expect(tag).toContain('type="button"');
      expect(tag).toContain("mx-1.5");
      expect(tag).toContain("min-h-7");
      expect(tag).toContain("py-1 ");
      expect(tag).toContain("hover:bg-hover");
      expect(tag).not.toContain("aria-current");
    }
    expect(running).toContain("grid-cols-[16px_minmax(0,1fr)]");
    expect(asking).toContain("grid-cols-[16px_minmax(0,1fr)_auto]");
    const title = html.split('data-role="sidebar-subtask-title"').slice(1);
    expect(title[0]).toMatch(
      /truncate-fade min-w-0 text-\[12px\] text-ink-soft font-semibold/,
    );
    expect(title[1]).toMatch(
      /truncate-fade min-w-0 text-\[12px\] text-ink-soft font-medium/,
    );
    // The running glyph: the session rows' bold spinner, turning, in
    // muted ink — not brand.
    const runningRow = html.slice(html.indexOf('data-state="running"'));
    expect(runningRow).toMatch(
      /^[^]*?<span class="inline-flex shrink-0 spin"><svg[^>]*class="text-ink-muted"/,
    );
    expect(
      blockOf(html).split('data-role="sidebar-subtasks"')[1],
    ).not.toContain("text-brand");
    // The question's pause stays amber.
    const askingRow = html.slice(html.indexOf('data-state="asking"'));
    expect(askingRow).toMatch(/^[^]*?<svg[^>]*class="text-warning"/);
    // No menu, no ⋯.
    expect(blockOf(html)).not.toContain('aria-label="更多"');
  });

  it("selects the open subtask's row, and the card steps back", () => {
    todo.items = [item("s-inv", "running"), item("s-vac", "asking")];
    const html = render([mainChat, sideChat, invoices, vacuums], {
      activeId: "s-inv",
    });
    const inv = rowTags(html).find((t) => t.includes('"s-inv"'))!;
    expect(inv).toContain('aria-current="page"');
    expect(inv).toContain("bg-selected shadow-[var(--shadow-selected)]");
    expect(inv).not.toContain("hover:bg-hover");
    // The open one's title in full ink, the others step back.
    const title = html.split('data-role="sidebar-subtask-title"').slice(1);
    expect(title[0]).toMatch(/text-ink-soft font-semibold/);
    expect(title[1]).toMatch(/text-\[12px\] text-ink font-medium/);
    expect(count(html, 'aria-current="page"')).toBe(1);
    expect(tagWith(html, CARD)).not.toContain("aria-current");
  });

  it("keeps the card selected for the main chat, and for a subtask without a row", () => {
    // Six running: the sixth is behind 「还有 1 件在办」.
    const six = Array.from({ length: 6 }, (_, i) =>
      subtask(`s-r${i}`, `差事 ${i}`, 10 + i),
    );
    todo.items = six.map((s) => item(s.id, "running"));
    for (const activeId of ["s-main", "s-r5"]) {
      const html = render([mainChat, sideChat, ...six], { activeId });
      expect(tagWith(html, CARD)).toContain('aria-current="page"');
      expect(count(html, 'aria-current="page"')).toBe(1);
    }
    // A done subtask, open from its card: no row, the card. A failed one
    // too (ruling 177).
    const done = subtask("s-done", "已办完的差事", 0);
    const failed = subtask("s-failed", "没办成的差事", 1);
    todo.items = [...todo.items, item("s-failed", "failed")];
    for (const activeId of ["s-done", "s-failed"]) {
      const html = render([mainChat, sideChat, ...six, done, failed], {
        activeId,
      });
      expect(tagWith(html, CARD)).toContain('aria-current="page"');
      expect(count(html, 'aria-current="page"')).toBe(1);
    }
  });

  it("folds what runs past five into 「还有 N 件在办」, a 「显示更多」 row", () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      subtask(`s-r${i}`, `差事 ${i}`, 10 + i),
    );
    todo.items = [
      ...seven.map((s) => item(s.id, "running")),
      item("s-vac", "asking"),
    ];
    const html = render([mainChat, sideChat, ...seven, vacuums]);
    expect(rowTags(html)).toHaveLength(6);
    // A project group's 「显示更多」 row (ruling 197 point 4: it unfolds in
    // place), folded: its caret down, not out to a panel.
    expect(tagWith(html, MORE)).toMatch(/^<button type="button"/);
    expect(tagWith(html, MORE)).toContain('aria-expanded="false"');
    expect(html).toContain(">还有 2 件在办</span>");
    // Its name is its words.
    expect(tagWith(html, MORE)).not.toContain("aria-label");
  });

  it("speaks English", () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      subtask(`s-r${i}`, `Errand ${i}`, 10 + i),
    );
    todo.items = [
      ...seven.map((s) => item(s.id, "running")),
      item("s-vac", "asking"),
    ];
    const html = render(
      [mainChat, sideChat, ...seven, { ...vacuums, title: "Compare vacuums" }],
      { language: "en-US" },
    );
    expect(html).toContain(
      'aria-label="Subtask: Compare vacuums, Waiting for you"',
    );
    expect(html).toContain('aria-label="Subtask: Errand 0"');
    expect(html).toContain(">2 more in progress</span>");
  });

  it("says 「子任务」 for a subtask with no title", () => {
    todo.items = [{ ...item("s-inv", "running"), text: "" }];
    const html = render([mainChat, sideChat, { ...invoices, title: "" }]);
    expect(tagWith(html, ROW)).toContain('aria-label="子任务：子任务"');
  });
});
