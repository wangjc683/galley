import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoCards } from "@/components/conversation/MemoCards";
import { zhCopy } from "@/i18n/locales/zh";
import { CopyProvider } from "@/lib/i18n";
import type { MemoEventItem, MemoItem } from "@/lib/memo";
import type { ResolvedLanguage } from "@/lib/language";

import { MemoPage } from "./MemoPage";

/**
 * The to-do panel's 备忘 page and the memo cards under a reply (main
 * chat ticket 97), rendered. Static rendering reads a zustand store's
 * initial state only, so the memos are handed in by mocking the store's
 * hook (the to-do panel tests' way); a click through, the tabs and the
 * delete's undo are in TodoPanel.memo.test.tsx, the store's timing in
 * stores/memo.test.ts, the words and order in lib/memo.test.ts.
 */

const store = vi.hoisted(() => ({
  memos: [] as unknown[],
  loaded: true,
  deleting: {} as Record<string, unknown>,
  failures: {} as Record<string, unknown>,
}));
vi.mock("@/stores/memo", () => ({
  useMemoStore: (select: (state: unknown) => unknown) =>
    select({ ...store, deleteMemo: () => {}, load: async () => {} }),
}));

afterEach(() => {
  store.memos = [];
  store.loaded = true;
  store.deleting = {};
  store.failures = {};
});

function daysAgo(days: number, hour = 9): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}
function dayIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function memo(id: string, extra: Partial<MemoItem> = {}): MemoItem {
  return {
    id,
    text: id,
    origin: { via: "supervisor", supervisor: "galley-assistant" },
    createdAt: daysAgo(0),
    updatedAt: daysAgo(0),
    changedIn: { sessionId: "s-main", turnIndex: 4 },
    ...extra,
  };
}

const CILANTRO = memo("memo_cilantro", {
  text: "你不吃香菜",
  updatedAt: daysAgo(0, 8),
});
const TRIP = memo("memo_trip", {
  text: "这周在上海出差",
  until: dayIn(30),
  updatedAt: daysAgo(0, 10),
});
const NAME = memo("memo_name", {
  text: "叫你小林；做室内设计",
  updatedAt: daysAgo(1),
  // Noted by another agent through the CLI: nowhere to lead.
  changedIn: undefined,
});

function render(language: ResolvedLanguage = "zh-CN"): string {
  return renderToStaticMarkup(
    <CopyProvider language={language}>
      <Tooltip.Provider>
        <MemoPage mainChatId="s-main" onGo={() => {}} />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the 备忘 page", () => {
  it("groups by the day last noted or changed, the latest first, under the to-do page's labels", () => {
    store.memos = [NAME, CILANTRO, TRIP];
    const html = render();
    expect(count(html, "data-memo-group")).toBe(2);
    // 今天 before 昨天; in today, the latest change first.
    const order = ["今天", TRIP.text, CILANTRO.text, "昨天", NAME.text].map(
      (needle) => html.indexOf(needle),
    );
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The group label's register (GroupLabel): 11px semibold, muted.
    expect(html).toContain("text-[11px] font-semibold text-ink-muted");
    // 12px between groups, as the to-do page's.
    expect(html).toContain('data-role="memo-groups" class="space-y-3"');
  });

  it("writes each memo whole in 13px, a last day 「到 …」 on the right in 12px muted, no icon or box", () => {
    store.memos = [TRIP, CILANTRO];
    const html = render();
    expect(count(html, "data-memo-row=")).toBe(2);
    expect(count(html, 'data-role="memo-until"')).toBe(1);
    expect(html).toMatch(
      /data-role="memo-until" class="shrink-0 text-\[12px\] leading-5 tabular-nums text-ink-muted">到 [^<]+<\/span>/,
    );
    // Never cut: the words wrap; the day does not shrink.
    const rows = html.slice(html.indexOf("data-memo-row="));
    expect(rows).not.toContain("truncate");
    expect(html).toContain("break-words");
    expect(html).toContain("min-w-0 flex-1 text-[13px] leading-5 text-ink");
    // Nothing leads a row: no box, no glyph but the hover ⋯.
    expect(html).not.toContain('role="checkbox"');
    expect(count(html, "<svg")).toBe(2);
  });

  it("makes the words a button back to the sentence only where it was noted in the main chat", () => {
    store.memos = [CILANTRO, NAME];
    const html = render();
    const cilantro = html.slice(html.indexOf(`data-memo-row="${CILANTRO.id}"`));
    const name = html.slice(html.indexOf(`data-memo-row="${NAME.id}"`));
    expect(cilantro.slice(0, cilantro.indexOf(CILANTRO.text))).toContain(
      "<button",
    );
    expect(name.slice(0, name.indexOf(NAME.text))).not.toContain(
      "hover:underline",
    );
    expect(name.slice(0, name.indexOf(NAME.text))).toContain(
      '<span class="break-words">',
    );
  });

  it("leaves out a memo deleted here while its undo toast is up", () => {
    store.memos = [CILANTRO, TRIP];
    store.deleting = { [CILANTRO.id]: { order: 1, committing: false } };
    const html = render();
    expect(html).not.toContain(CILANTRO.text);
    expect(html).toContain(TRIP.text);
  });

  it("says why a delete Core refused failed, under its row", () => {
    store.memos = [CILANTRO];
    store.failures = { [CILANTRO.id]: "failed" };
    expect(render()).toContain(zhCopy.todo.actionFailed);
  });

  it("is one sentence and an example when empty, no button; nothing before the first read", () => {
    const html = render();
    expect(html).toContain('data-role="memo-empty"');
    expect(html).toContain("值得记住的事，Galley 会记在这里。");
    expect(html).toContain("比如「我不吃香菜」");
    expect(html).not.toContain("<button");
    expect(render("en-US")).toContain(
      "Galley keeps what&#x27;s worth remembering here.",
    );
    store.loaded = false;
    expect(render()).toBe("");
  });
});

function event(id: number, extra: Partial<MemoEventItem> = {}): MemoEventItem {
  return {
    id,
    memoId: CILANTRO.id,
    action: "add",
    text: "你不吃香菜",
    sessionId: "s-main",
    turnIndex: 4,
    memoExists: true,
    createdAt: daysAgo(0),
    ...extra,
  };
}

function renderCards(
  events: MemoEventItem[],
  afterCards = false,
  language: ResolvedLanguage = "zh-CN",
): string {
  return renderToStaticMarkup(
    <CopyProvider language={language}>
      <MemoCards events={events} afterCards={afterCards} />
    </CopyProvider>,
  );
}

describe("the memo cards under a reply", () => {
  it("say what each write did, a card each, in the to-do card's form", () => {
    store.memos = [CILANTRO];
    const html = renderCards([
      event(1),
      event(2, { action: "update", text: "你不吃香菜和葱" }),
      event(3, { action: "delete", text: "这周在上海出差", memoId: TRIP.id }),
    ]);
    expect(count(html, 'data-role="memo-card"')).toBe(3);
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toContain("记下了 · 你不吃香菜");
    expect(text).toContain("改为 · 你不吃香菜和葱");
    expect(text).toContain("不再记 · 这周在上海出差");
    expect(html).toContain('class="rounded-md border border-line bg-app"');
    expect(html).toContain("flex min-h-10 items-center");
    // A 16px glyph in the box's 16px column.
    expect(html).toContain('width="16"');
    expect(
      renderCards([event(1)], false, "en-US").replace(/<[^>]+>/g, ""),
    ).toContain("Noted · 你不吃香菜");
  });

  it("open the panel from their words only while the page lists the memo, never for 「不再记」", () => {
    store.memos = [CILANTRO];
    const listed = renderCards([event(1)]);
    expect(count(listed, "<button")).toBe(1);
    expect(listed).toContain("hover:underline");
    // Deleted since, or past its last day: words.
    store.memos = [];
    expect(renderCards([event(1, { memoExists: false })])).not.toContain(
      "<button",
    );
    expect(renderCards([event(1)])).not.toContain("<button");
    // 「不再记」: words, though a memo with that id were listed.
    store.memos = [CILANTRO];
    expect(renderCards([event(3, { action: "delete" })])).not.toContain(
      "<button",
    );
    // Deleted on the page, its undo toast up: words.
    store.deleting = { [CILANTRO.id]: { order: 1, committing: false } };
    expect(renderCards([event(1)])).not.toContain("<button");
  });

  // Ticket 99, PRD ruling 144 point 2.
  describe("strike what is gone, the words only", () => {
    const STATE_CELL =
      'data-role="memo-card-state" class="shrink-0 select-none text-[12px] tabular-nums text-ink-muted"';
    const MUTED_LINE = "truncate text-[13px] leading-5 text-ink-muted";

    it("still there: the words as they are, a button, nothing on the right", () => {
      store.memos = [CILANTRO];
      const html = renderCards([event(1)]);
      expect(html).toContain('data-memo-state="listed"');
      expect(html).toContain('leading-5 text-ink"><button');
      expect(html).toContain("<span>你不吃香菜</span>");
      expect(html).not.toContain("line-through");
      expect(html).not.toContain('data-role="memo-card-state"');
    });

    it("gone, by you or by Galley: the words struck and muted, 「已删除」 on the right, not a button", () => {
      store.memos = [];
      const html = renderCards([event(1, { memoExists: false })]);
      expect(html).toContain('data-memo-state="deleted"');
      expect(html).not.toContain("<button");
      expect(html).toContain(MUTED_LINE);
      // The words alone struck: 「记下了 ·」 is not.
      expect(html).toContain('<span class="line-through">你不吃香菜</span>');
      expect(count(html, "line-through")).toBe(1);
      expect(html).toMatch(
        /<span class="text-ink-muted">记下了[^<]*(<!-- -->)?[^<]*<\/span>/,
      );
      // Where a deleted to-do card says 「已删除」, and the same way.
      expect(html).toContain(`${STATE_CELL}>已删除</span>`);
      // A 「改为」 card of a memo gone since, the same.
      const changed = renderCards([
        event(2, {
          action: "update",
          text: "你不吃香菜和葱",
          memoExists: false,
        }),
      ]);
      expect(changed).toContain(
        '<span class="line-through">你不吃香菜和葱</span>',
      );
      expect(changed).toContain(`${STATE_CELL}>已删除</span>`);
      expect(
        renderCards([event(1, { memoExists: false })], false, "en-US"),
      ).toContain(">Deleted</span>");
    });

    it("deleted on the page, its undo toast up: already so", () => {
      store.memos = [CILANTRO];
      store.deleting = { [CILANTRO.id]: { order: 1, committing: false } };
      const html = renderCards([event(1)]);
      expect(html).toContain('data-memo-state="deleted"');
      expect(html).toContain('<span class="line-through">你不吃香菜</span>');
      expect(html).toContain(`${STATE_CELL}>已删除</span>`);
      expect(html).not.toContain("<button");
    });

    it("「不再记」: the words struck and muted, nothing on the right — its prefix says so", () => {
      store.memos = [];
      const html = renderCards([
        event(3, {
          action: "delete",
          text: "这周在上海出差",
          memoId: TRIP.id,
          memoExists: false,
        }),
      ]);
      expect(html).toContain('data-memo-state="dropped"');
      expect(html).toContain(MUTED_LINE);
      expect(html).toContain(
        '<span class="line-through">这周在上海出差</span>',
      );
      expect(count(html, "line-through")).toBe(1);
      expect(html).not.toContain('data-role="memo-card-state"');
      expect(html).not.toContain("<button");
    });

    it("past its last day: muted, not struck, 「已过期」 on the right, not a button", () => {
      // Still there in Core, off the page (ticket 95).
      store.memos = [];
      const html = renderCards([event(1, { until: dayIn(-1) })]);
      expect(html).toContain('data-memo-state="expired"');
      expect(html).toContain(MUTED_LINE);
      expect(html).not.toContain("line-through");
      expect(html).toContain("<span>你不吃香菜</span>");
      expect(html).toContain(`${STATE_CELL}>已过期</span>`);
      expect(html).not.toContain("<button");
      expect(renderCards([event(1)], false, "en-US")).toContain(
        ">Expired</span>",
      );
    });
  });

  it("sit 12px off the bubble, 8px under other cards", () => {
    expect(renderCards([event(1)])).toContain(
      'data-role="memo-cards" class="flex flex-col gap-2 mt-3"',
    );
    expect(renderCards([event(1)], true)).toContain(
      'data-role="memo-cards" class="flex flex-col gap-2 mt-2"',
    );
  });
});
