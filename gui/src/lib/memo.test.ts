import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import {
  bucketForTimestamp,
  MONTH_WINDOW_DAYS,
  WEEK_WINDOW_DAYS,
} from "@/lib/sessions";

import {
  memoCardParts,
  memoCardState,
  memoDayLabel,
  memoDayMs,
  memoPageGroups,
  memoRowTarget,
  memosByMessage,
  memosWithoutDeleting,
  memoUntilLabel,
  type MemoEventItem,
  type MemoItem,
} from "./memo";

/**
 * The memos' words and order (main chat ticket 97): the 备忘 page groups
 * by when each was last noted or changed, in the sidebar's time periods
 * (ticket 121), the latest first, a row's day shown on its hover; a
 * last day reads 「到 …」 as a to-do's due day; a row leads back to the
 * reply it was last noted in, or nowhere; a card a write, in the order
 * made, its words opening the panel only while the page lists the memo,
 * and where its memo stands now drawing it (ticket 99).
 */

// Built from local wall-clock parts, so the days hold in any zone.
function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 9, day, hour, minute).toISOString();
}
const TODAY = new Date(2026, 9, 26).getTime(); // Monday 2026-10-26

function memo(id: string, extra: Partial<MemoItem> = {}): MemoItem {
  return {
    id,
    text: id,
    origin: { via: "supervisor", supervisor: "galley-assistant" },
    createdAt: at(20, 9),
    updatedAt: at(20, 9),
    ...extra,
  };
}

function event(id: number, extra: Partial<MemoEventItem> = {}): MemoEventItem {
  return {
    id,
    memoId: `memo_${id}`,
    action: "add",
    text: "你不吃香菜",
    sessionId: "s-main",
    turnIndex: 4,
    memoExists: true,
    createdAt: at(26, 9),
    ...extra,
  };
}

// Ticket 121, PRD ruling 166: the sidebar's periods, by its own rule.
describe("the page's groups", () => {
  /** A moment by its local wall clock, any month. */
  const on = (month: number, day: number, hour: number, minute = 0) =>
    new Date(2026, month - 1, day, hour, minute).toISOString();
  // The sidebar's windows: 7 and 30 days of 24 hours back from the start
  // of today (lib/sessions.ts). Built the same way, the edges hold in
  // any zone, a daylight-saving change between them or not (Europe's
  // falls on 10-25).
  const DAY = 24 * 3600 * 1000;
  const MINUTE = 60 * 1000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const weekFrom = TODAY - WEEK_WINDOW_DAYS * DAY;
  const monthFrom = TODAY - MONTH_WINDOW_DAYS * DAY;

  it("are the sidebar's time periods of when each was last noted or changed, the latest first, the latest change first in one", () => {
    // Core's order: as noted. Today is Monday 10-26: 本周 is from about
    // 10-19, 本月 from about 9-26; each edge with one on it and one a
    // minute before.
    const memos = [
      memo("name", { updatedAt: on(10, 20, 9) }),
      memo("cilantro", { updatedAt: at(26, 8) }),
      memo("week-first", { updatedAt: iso(weekFrom) }),
      memo("trip", { updatedAt: at(26, 21, 30), until: "2026-11-01" }),
      memo("week-before", { updatedAt: iso(weekFrom - MINUTE) }),
      memo("month-first", { updatedAt: iso(monthFrom) }),
      memo("month-before", { updatedAt: iso(monthFrom - MINUTE) }),
      memo("last-year", { updatedAt: new Date(2025, 11, 30, 9).toISOString() }),
      memo("sixers", { updatedAt: at(26, 10) }),
      memo("yesterday", { updatedAt: at(25, 22) }),
    ];
    const groups = memoPageGroups(memos, TODAY);
    expect(groups.map((g) => g.bucket)).toEqual([
      "today",
      "week",
      "month",
      "earlier",
    ]);
    expect(groups.map((g) => g.memos.map((m) => m.id))).toEqual([
      ["trip", "sixers", "cilantro"],
      ["yesterday", "name", "week-first"],
      ["week-before", "month-first"],
      ["month-before", "last-year"],
    ]);
  });

  it("place a memo as the sidebar places a conversation (bucketForTimestamp), whatever the hour of today", () => {
    const memos = [
      memo("a", { updatedAt: at(26, 0) }),
      memo("b", { updatedAt: iso(weekFrom) }),
      memo("c", { updatedAt: iso(weekFrom - MINUTE) }),
      memo("d", { updatedAt: iso(monthFrom) }),
      memo("e", { updatedAt: iso(monthFrom - MINUTE) }),
      memo("f", { updatedAt: on(10, 19, 12) }),
    ];
    // The page's day stamp, not the moment: the same groups at 00:00
    // and late in the day.
    const late = new Date(2026, 9, 26, 23, 30).getTime();
    expect(memoPageGroups(memos, late)).toEqual(memoPageGroups(memos, TODAY));
    for (const group of memoPageGroups(memos, TODAY)) {
      for (const m of group.memos) {
        expect(bucketForTimestamp(m.updatedAt, new Date(TODAY))).toBe(
          group.bucket,
        );
      }
    }
  });

  it("leave an empty period out", () => {
    const groups = memoPageGroups(
      [
        memo("old", { updatedAt: on(8, 1, 9) }),
        memo("today", { updatedAt: at(26, 9) }),
      ],
      TODAY,
    );
    expect(groups.map((g) => g.bucket)).toEqual(["today", "earlier"]);
    expect(memoPageGroups([], TODAY)).toEqual([]);
  });

  it("move a memo changed to the period of its change, not of its noting", () => {
    const changed = memo("office", {
      createdAt: on(8, 10, 9),
      updatedAt: at(26, 7),
    });
    const groups = memoPageGroups([memo("name"), changed], TODAY);
    expect(groups[0]).toEqual({ bucket: "today", memos: [changed] });
  });

  it("put the one noted later first when two changed at the same moment", () => {
    const same = at(26, 9);
    const groups = memoPageGroups(
      [memo("first", { updatedAt: same }), memo("second", { updatedAt: same })],
      TODAY,
    );
    expect(groups[0].memos.map((m) => m.id)).toEqual(["second", "first"]);
  });

  it("move along at midnight: tomorrow's day stamp puts today's in 本周", () => {
    const groups = memoPageGroups(
      [memo("today", { updatedAt: at(26, 9) })],
      new Date(2026, 9, 27).getTime(),
    );
    expect(groups.map((g) => g.bucket)).toEqual(["week"]);
  });
});

describe("a row's day, shown on its hover", () => {
  it("is the local day it was last noted or changed", () => {
    expect(memoDayMs(memo("a", { updatedAt: at(23, 21, 30) }))).toBe(
      new Date(2026, 9, 23).getTime(),
    );
  });

  it("reads 今天, 昨天, then the date, the year when it is another, in both languages", () => {
    const day = (d: number) => new Date(2026, 9, d, 15).getTime();
    expect(memoDayLabel(day(26), TODAY, "zh-CN", zhCopy)).toBe("今天");
    expect(memoDayLabel(day(25), TODAY, "zh-CN", zhCopy)).toBe("昨天");
    expect(memoDayLabel(day(23), TODAY, "zh-CN", zhCopy)).toBe("10月23日");
    const lastYear = new Date(2025, 11, 30, 9).getTime();
    expect(memoDayLabel(lastYear, TODAY, "zh-CN", zhCopy)).toBe(
      "2025年12月30日",
    );
    expect(memoDayLabel(day(25), TODAY, "en-US", enCopy)).toBe("Yesterday");
    expect(
      memoDayLabel(day(20), TODAY, "en-US", enCopy).replace(/\s/g, " "),
    ).toBe("Oct 20");
    expect(
      memoDayLabel(lastYear, TODAY, "en-US", enCopy).replace(/\s/g, " "),
    ).toBe("Dec 30, 2025");
  });
});

describe("the page's memos", () => {
  it("leave out what is deleted here and waiting for its undo", () => {
    const memos = [memo("a"), memo("b")];
    expect(memosWithoutDeleting(memos, {})).toBe(memos);
    expect(
      memosWithoutDeleting(memos, { a: { order: 1, committing: false } }),
    ).toEqual([memos[1]]);
  });
});

describe("a last day", () => {
  it("reads 「到 …」 with the day as a to-do's due day is written", () => {
    expect(
      memoUntilLabel({ until: "2026-11-01" }, TODAY, "zh-CN", zhCopy),
    ).toBe("到 周日");
    expect(
      memoUntilLabel({ until: "2026-10-27" }, TODAY, "zh-CN", zhCopy),
    ).toBe("到 明天");
    expect(
      memoUntilLabel({ until: "2026-10-26" }, TODAY, "zh-CN", zhCopy),
    ).toBe("到 今天");
    expect(
      memoUntilLabel({ until: "2026-11-06" }, TODAY, "zh-CN", zhCopy),
    ).toBe("到 11月6日");
    expect(
      memoUntilLabel({ until: "2026-11-06" }, TODAY, "en-US", enCopy)?.replace(
        /\s/g,
        " ",
      ),
    ).toBe("Until Nov 6");
  });

  it("is not there without one", () => {
    expect(memoUntilLabel({}, TODAY, "zh-CN", zhCopy)).toBeNull();
  });
});

describe("where a row leads", () => {
  it("is the reply in the main chat it was last noted or changed in", () => {
    expect(
      memoRowTarget(
        { changedIn: { sessionId: "s-main", turnIndex: 6 } },
        "s-main",
      ),
    ).toEqual({
      kind: "reply",
      sessionId: "s-main",
      messageId: "msg_s-main_6_assistant",
    });
  });

  it("is nowhere for one noted outside a main chat run, before its run ended, or in another session", () => {
    expect(memoRowTarget({}, "s-main")).toBeNull();
    expect(
      memoRowTarget({ changedIn: { sessionId: "s-main" } }, "s-main"),
    ).toBeNull();
    expect(
      memoRowTarget(
        { changedIn: { sessionId: "s-old", turnIndex: 2 } },
        "s-main",
      ),
    ).toBeNull();
  });
});

describe("the cards", () => {
  it("hang under the reply of each write, in the order made, the main chat's only and once its run ended", () => {
    const events = [
      event(3, { turnIndex: 8, action: "update" }),
      event(1),
      event(2, { memoId: "memo_9" }),
      event(4, { turnIndex: undefined }),
      event(5, { sessionId: "s-other" }),
    ];
    const byMessage = memosByMessage(events, "s-main");
    expect([...byMessage.keys()]).toEqual([
      "msg_s-main_4_assistant",
      "msg_s-main_8_assistant",
    ]);
    expect(byMessage.get("msg_s-main_4_assistant")?.map((e) => e.id)).toEqual([
      1, 2,
    ]);
    expect(memosByMessage(events, undefined).size).toBe(0);
  });

  it("say what the write did, with the words as they were then", () => {
    expect(memoCardParts(event(1), zhCopy)).toEqual({
      prefix: "记下了",
      text: "你不吃香菜",
    });
    expect(
      memoCardParts(
        event(2, { action: "update", text: "你不吃香菜和葱" }),
        zhCopy,
      ),
    ).toEqual({ prefix: "改为", text: "你不吃香菜和葱" });
    expect(memoCardParts(event(3, { action: "delete" }), zhCopy).prefix).toBe(
      "不再记",
    );
    expect(memoCardParts(event(1), enCopy).prefix).toBe("Noted");
    expect(memoCardParts(event(2, { action: "update" }), enCopy).prefix).toBe(
      "Changed to",
    );
    expect(memoCardParts(event(3, { action: "delete" }), enCopy).prefix).toBe(
      "No longer noted",
    );
  });

  it("stand as the memo does now: listed, deleted, dropped or expired (ticket 99)", () => {
    const listed = [memo("memo_1")];
    const toast = { memo_1: { order: 1, committing: false } };
    // On the page: the only state whose words open the panel.
    expect(memoCardState(event(1), listed, {})).toBe("listed");
    expect(memoCardState(event(1, { action: "update" }), listed, {})).toBe(
      "listed",
    );
    // Gone, by you or by Galley.
    expect(memoCardState(event(1, { memoExists: false }), [], {})).toBe(
      "deleted",
    );
    expect(
      memoCardState(event(1, { action: "update", memoExists: false }), [], {}),
    ).toBe("deleted");
    // Deleted here, its undo toast up: already deleted, though Core still
    // lists it.
    expect(memoCardState(event(1), listed, toast)).toBe("deleted");
    // Still there, off the page: past its last day.
    expect(memoCardState(event(1), [], {})).toBe("expired");
    // A 「不再记」 card, whatever the memo's state: its own.
    expect(
      memoCardState(event(1, { action: "delete", memoExists: false }), [], {}),
    ).toBe("dropped");
    expect(memoCardState(event(1, { action: "delete" }), listed, {})).toBe(
      "dropped",
    );
  });
});
