import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";

import {
  memoCardOpens,
  memoCardParts,
  memoDayLabel,
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
 * by the local day each was last noted or changed, the latest first; a
 * last day reads 「到 …」 as a to-do's due day; a row leads back to the
 * reply it was last noted in, or nowhere; a card a write, in the order
 * made, its words opening the panel only while the page lists the memo.
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

describe("the page's groups", () => {
  it("go by the local day last noted or changed, the latest day first, the latest change first in a day", () => {
    // Core's order: as noted.
    const memos = [
      memo("name", { updatedAt: at(20, 9) }),
      memo("cilantro", { updatedAt: at(26, 8) }),
      memo("trip", { updatedAt: at(26, 21, 30), until: "2026-11-01" }),
      memo("punctuation", { updatedAt: at(23, 12) }),
      memo("sixers", { updatedAt: at(26, 10) }),
    ];
    const groups = memoPageGroups(memos);
    expect(groups.map((g) => g.dayMs)).toEqual([
      new Date(2026, 9, 26).getTime(),
      new Date(2026, 9, 23).getTime(),
      new Date(2026, 9, 20).getTime(),
    ]);
    expect(groups.map((g) => g.memos.map((m) => m.id))).toEqual([
      ["trip", "sixers", "cilantro"],
      ["punctuation"],
      ["name"],
    ]);
  });

  it("move a memo changed to that day: the day of its change, not of its noting", () => {
    const changed = memo("office", {
      createdAt: at(10, 9),
      updatedAt: at(26, 7),
    });
    const groups = memoPageGroups([memo("name"), changed]);
    expect(groups[0]).toEqual({
      dayMs: new Date(2026, 9, 26).getTime(),
      memos: [changed],
    });
  });

  it("put the one noted later first when two changed at the same moment", () => {
    const same = at(26, 9);
    const groups = memoPageGroups([
      memo("first", { updatedAt: same }),
      memo("second", { updatedAt: same }),
    ]);
    expect(groups[0].memos.map((m) => m.id)).toEqual(["second", "first"]);
  });

  it("are headed 今天, 昨天, then the date, in both languages", () => {
    const day = (d: number) => new Date(2026, 9, d, 15).getTime();
    expect(memoDayLabel(day(26), TODAY, "zh-CN", zhCopy)).toBe("今天");
    expect(memoDayLabel(day(25), TODAY, "zh-CN", zhCopy)).toBe("昨天");
    expect(memoDayLabel(day(23), TODAY, "zh-CN", zhCopy)).toBe("10月23日");
    expect(memoDayLabel(day(25), TODAY, "en-US", enCopy)).toBe("Yesterday");
    expect(
      memoDayLabel(day(20), TODAY, "en-US", enCopy).replace(/\s/g, " "),
    ).toBe("Oct 20");
  });

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

  it("open the panel only while the page lists the memo, never for 「不再记」", () => {
    const listed = [memo("memo_1")];
    expect(memoCardOpens(event(1), listed, {})).toBe(true);
    expect(memoCardOpens(event(1, { action: "update" }), listed, {})).toBe(
      true,
    );
    // Deleted since, or past its last day: not listed.
    expect(memoCardOpens(event(1), [], {})).toBe(false);
    // Deleted here, its undo toast up.
    expect(
      memoCardOpens(event(1), listed, {
        memo_1: { order: 1, committing: false },
      }),
    ).toBe(false);
    expect(memoCardOpens(event(1, { action: "delete" }), listed, {})).toBe(
      false,
    );
  });
});
