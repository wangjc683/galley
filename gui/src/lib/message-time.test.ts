import { describe, expect, it } from "vitest";

import {
  formatMessageDateTime,
  formatMessageTime,
  formatMessageTimeFull,
  userTimeMarks,
  type MessageTimeDayWords,
} from "@/lib/message-time";
import type { AgentTurn, Turn, UserTurn } from "@/types/conversation";

// Inputs are built from LOCAL wall-clock parts, so the assertions about
// local dates and clock times hold in whatever timezone the suite runs.
function local(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  return new Date(year, month - 1, day, hour, minute, second);
}

function iso(date: Date): string {
  return date.toISOString();
}

function user(
  at: Date | undefined,
  overrides: Partial<UserTurn> = {},
): UserTurn {
  return {
    role: "user",
    content: "hi",
    createdAt: at ? iso(at) : undefined,
    ...overrides,
  };
}

function agent(): AgentTurn {
  return { role: "agent", turnIndex: 1, tools: [] } as unknown as AgentTurn;
}

const ZH_WORDS: MessageTimeDayWords = {
  today: (time) => `今天 ${time}`,
  yesterday: (time) => `昨天 ${time}`,
};
const EN_WORDS: MessageTimeDayWords = {
  today: (time) => `Today ${time}`,
  yesterday: (time) => `Yesterday ${time}`,
};

// ICU puts a narrow no-break space before AM / PM; compare on plain spaces.
function plain(s: string | null): string | null {
  return s === null ? null : s.replace(/\s/g, " ");
}

describe("userTimeMarks", () => {
  it("pins the session's first user message, with no today word", () => {
    const marks = userTimeMarks([user(local(2026, 9, 28, 9, 0)), agent()]);
    expect(marks.get(0)).toEqual({ pinned: true, withTodayWord: false });
    expect(marks.has(1)).toBe(false);
  });

  it("pins only a gap strictly over 60 minutes", () => {
    const base = local(2026, 9, 28, 9, 0);
    const after = (minutes: number) =>
      new Date(base.getTime() + minutes * 60_000);
    const pinnedAfter = (minutes: number) =>
      userTimeMarks([user(base), agent(), user(after(minutes))]).get(2)?.pinned;
    expect(pinnedAfter(59)).toBe(false);
    expect(pinnedAfter(60)).toBe(false);
    expect(pinnedAfter(61)).toBe(true);
  });

  it("pins a short gap that crosses local midnight, with the today word", () => {
    const marks = userTimeMarks([
      user(local(2026, 9, 27, 23, 58)),
      agent(),
      user(local(2026, 9, 28, 0, 3)),
    ]);
    expect(marks.get(2)).toEqual({ pinned: true, withTodayWord: true });
  });

  it("counts an ask_user reply in the sequence", () => {
    // question 09:00 → reply 10:30 (a break) → next question 10:50,
    // which is measured against the reply, not the 09:00 question.
    const marks = userTimeMarks([
      user(local(2026, 9, 28, 9, 0)),
      agent(),
      user(local(2026, 9, 28, 10, 30), { content: "选 A" }),
      agent(),
      user(local(2026, 9, 28, 10, 50)),
    ]);
    expect(marks.get(2)?.pinned).toBe(true);
    expect(marks.get(4)?.pinned).toBe(false);
  });

  it("always pins a Supervisor-originated message", () => {
    const marks = userTimeMarks([
      user(local(2026, 9, 28, 9, 0)),
      user(local(2026, 9, 28, 9, 1), {
        origin: { via: "supervisor", supervisor: "ga-claude-1" },
      }),
      user(local(2026, 9, 28, 9, 2), { origin: { via: "cli" } }),
    ]);
    expect(marks.get(1)?.pinned).toBe(true);
    expect(marks.get(2)?.pinned).toBe(false);
  });

  it("skips a turn without createdAt and compares past it", () => {
    const turns: Turn[] = [
      user(local(2026, 9, 28, 9, 0)),
      user(undefined),
      user(local(2026, 9, 28, 9, 30), { createdAt: "not a date" }),
      user(local(2026, 9, 28, 9, 40)),
    ];
    const marks = userTimeMarks(turns);
    expect(marks.has(1)).toBe(false);
    expect(marks.has(2)).toBe(false);
    // 09:40 is measured against 09:00: 40 minutes, no break.
    expect(marks.get(3)).toEqual({ pinned: false, withTodayWord: false });
  });

  it("treats the first dated turn as the first message", () => {
    const marks = userTimeMarks([
      user(undefined),
      agent(),
      user(local(2026, 9, 28, 9, 0)),
    ]);
    expect(marks.get(2)).toEqual({ pinned: true, withTodayWord: false });
  });

  it("honours a custom threshold", () => {
    const marks = userTimeMarks(
      [user(local(2026, 9, 28, 9, 0)), user(local(2026, 9, 28, 9, 2))],
      60_000,
    );
    expect(marks.get(1)?.pinned).toBe(true);
  });
});

describe("formatMessageTime", () => {
  const today = local(2026, 9, 28).getTime();
  const zh = (at: Date, withTodayWord = false, todayStart = today) =>
    formatMessageTime(iso(at), todayStart, "zh-CN", {
      withTodayWord,
      words: ZH_WORDS,
    });
  const en = (at: Date, withTodayWord = false, todayStart = today) =>
    plain(
      formatMessageTime(iso(at), todayStart, "en-US", {
        withTodayWord,
        words: EN_WORDS,
      }),
    );

  it("formats today as a bare clock time", () => {
    expect(zh(local(2026, 9, 28, 16, 5))).toBe("16:05");
    expect(zh(local(2026, 9, 28, 9, 10))).toBe("09:10");
    expect(en(local(2026, 9, 28, 16, 5))).toBe("4:05 PM");
  });

  it("adds the today word when asked", () => {
    expect(zh(local(2026, 9, 28, 9, 10), true)).toBe("今天 09:10");
    expect(en(local(2026, 9, 28, 9, 10), true)).toBe("Today 9:10 AM");
  });

  it("formats yesterday with its word, regardless of withTodayWord", () => {
    expect(zh(local(2026, 9, 27, 21, 14))).toBe("昨天 21:14");
    expect(zh(local(2026, 9, 27, 21, 14), true)).toBe("昨天 21:14");
    expect(en(local(2026, 9, 27, 21, 14))).toBe("Yesterday 9:14 PM");
  });

  it("formats earlier this year as month and day", () => {
    expect(zh(local(2026, 9, 21, 14, 32))).toBe("9月21日 14:32");
    expect(zh(local(2026, 1, 3, 8, 0))).toBe("1月3日 08:00");
    expect(en(local(2026, 9, 21, 14, 32))).toBe("Sep 21, 2:32 PM");
  });

  it("adds the year for an earlier year", () => {
    expect(zh(local(2025, 9, 21, 14, 32))).toBe("2025年9月21日 14:32");
    expect(zh(local(2025, 12, 31, 23, 59))).toBe("2025年12月31日 23:59");
    expect(en(local(2025, 9, 21, 14, 32))).toBe("Sep 21, 2025, 2:32 PM");
  });

  it("moves labels along when the day rolls over", () => {
    const at = local(2026, 9, 28, 16, 5);
    const tomorrow = local(2026, 9, 29).getTime();
    const dayAfter = local(2026, 9, 30).getTime();
    expect(zh(at, false, today)).toBe("16:05");
    expect(zh(at, false, tomorrow)).toBe("昨天 16:05");
    expect(zh(at, false, dayAfter)).toBe("9月28日 16:05");
    // New Year: last year's message picks up its year.
    const newYear = local(2027, 1, 2).getTime();
    expect(zh(at, false, newYear)).toBe("2026年9月28日 16:05");
  });

  it("returns null for an unparseable timestamp", () => {
    expect(
      formatMessageTime("nope", today, "zh-CN", {
        withTodayWord: false,
        words: ZH_WORDS,
      }),
    ).toBeNull();
  });
});

describe("formatMessageDateTime", () => {
  const today = local(2026, 9, 28).getTime();

  it("always carries the date, with no today / yesterday words", () => {
    const at = local(2026, 9, 28, 9, 10);
    expect(formatMessageDateTime(iso(at), today, "zh-CN")).toBe(
      "9月28日 09:10",
    );
    expect(plain(formatMessageDateTime(iso(at), today, "en-US"))).toBe(
      "Sep 28, 9:10 AM",
    );
    expect(
      formatMessageDateTime(iso(local(2026, 9, 27, 21, 14)), today, "zh-CN"),
    ).toBe("9月27日 21:14");
  });

  it("adds the year for an earlier year, and drops seconds", () => {
    const at = local(2025, 7, 3, 11, 34, 47);
    expect(formatMessageDateTime(iso(at), today, "zh-CN")).toBe(
      "2025年7月3日 11:34",
    );
    expect(plain(formatMessageDateTime(iso(at), today, "en-US"))).toBe(
      "Jul 3, 2025, 11:34 AM",
    );
  });

  it("returns null for an unparseable timestamp", () => {
    expect(formatMessageDateTime("nope", today, "zh-CN")).toBeNull();
  });
});

describe("formatMessageTimeFull", () => {
  it("includes the weekday and the minute", () => {
    // 2026-09-28 is a Monday.
    const at = iso(local(2026, 9, 28, 16, 5));
    const zh = formatMessageTimeFull(at, "zh-CN");
    expect(zh).toContain("2026年9月28日");
    expect(zh).toContain("星期一");
    expect(zh).toContain("16:05");
    const en = plain(formatMessageTimeFull(at, "en-US"));
    expect(en).toContain("Monday");
    expect(en).toContain("September 28, 2026");
    expect(en).toContain("4:05 PM");
  });

  it("returns null for an unparseable timestamp", () => {
    expect(formatMessageTimeFull("", "en-US")).toBeNull();
  });
});
