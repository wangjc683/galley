import { describe, expect, it } from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import type { LedgerEntry, LedgerQuote, MemoryOverview } from "@/lib/memory";

import { MEMORY_OVERVIEW_FIXTURE } from "./memory-overview.fixture";
import {
  entrySources,
  formatLedgerDay,
  formatLedgerMinute,
  formatScheduleTime,
  parseImSource,
  resolveSource,
  showsLedgerAreas,
  sortByLastSeen,
  switchStatus,
  switchToggle,
} from "./memory-view";

const TODAY = new Date(2026, 9, 12).getTime(); // 2026-10-12, local midnight
const copy = zhCopy.settings.memory;

function overview(ledger: Partial<MemoryOverview["ledger"]>): MemoryOverview {
  return {
    ledger: {
      switch: { state: "undecided" },
      running: false,
      activities: { kind: "absent" },
      emotions: { kind: "absent" },
      forgotten: [],
      exclusions: [],
      ...ledger,
    },
    globalMemory: [],
  };
}

function entry(id: string, lastSeen?: string): LedgerEntry {
  return { id, title: id, lastSeen, sessions: [], quotes: [], extra: [] };
}

describe("showsLedgerAreas", () => {
  it("leaves areas 2–6 out while not on and nothing is there", () => {
    expect(showsLedgerAreas(overview({}))).toBe(false);
    expect(showsLedgerAreas(overview({ switch: { state: "off" } }))).toBe(
      false,
    );
  });

  it("shows them while on, even before the first run", () => {
    expect(
      showsLedgerAreas(
        overview({
          switch: {
            state: "on",
            since: "2026-10-12T06:30:00Z",
            lookBack: false,
          },
        }),
      ),
    ).toBe(true);
  });

  it("shows them when off but something was kept", () => {
    const off = { switch: { state: "off" } as const };
    expect(
      showsLedgerAreas(
        overview({ ...off, emotions: { kind: "raw", text: "x" } }),
      ),
    ).toBe(true);
    expect(
      showsLedgerAreas(
        overview({
          ...off,
          forgotten: [
            { id: "A1", kind: "activity", title: "t", deletedAt: "2026-10-01" },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      showsLedgerAreas(
        overview({
          ...off,
          exclusions: [
            {
              target: { kind: "session", id: "s1" },
              createdAt: "2026-10-01",
              title: "x",
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe("sortByLastSeen", () => {
  it("puts the newest 最近 first and undated entries last in file order", () => {
    const sorted = sortByLastSeen([
      entry("old", "2026-09-01"),
      entry("undated-1"),
      entry("new", "2026-09-27"),
      entry("undated-2"),
      entry("mid", "2026-09-17"),
    ]);
    expect(sorted.map((e) => e.id)).toEqual([
      "new",
      "mid",
      "old",
      "undated-1",
      "undated-2",
    ]);
  });

  it("keeps file order between equal dates", () => {
    const sorted = sortByLastSeen([
      entry("a", "2026-09-27"),
      entry("b", "2026-09-27"),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("sources", () => {
  it("lists sessions, then quote sessions not listed, without repeats", () => {
    const quotes: LedgerQuote[] = [
      { session: "s2", text: "" },
      { session: "s1", text: "" },
      { text: "" },
    ];
    expect(
      entrySources({
        sessions: ["s1", "im-feishu-2026-09-21", "s1"],
        quotes,
      }),
    ).toEqual(["s1", "im-feishu-2026-09-21", "s2"]);
  });

  it("reads IM source ids", () => {
    expect(parseImSource("im-feishu-2026-09-21")).toEqual({
      channel: "feishu",
      day: "2026-09-21",
    });
    expect(parseImSource("im-unknown-2026-10-11")).toEqual({
      channel: "unknown",
      day: "2026-10-11",
    });
    expect(parseImSource("s-0927-run")).toBeNull();
  });

  it("resolves sessions through the lookup and IM ids by channel", () => {
    const lookup = (id: string) =>
      id === "s1" ? { title: "跑步", archived: true } : null;
    expect(resolveSource("s1", lookup)).toEqual({
      kind: "session",
      id: "s1",
      session: { title: "跑步", archived: true },
    });
    expect(resolveSource("gone", lookup)).toEqual({
      kind: "session",
      id: "gone",
      session: null,
    });
    expect(resolveSource("im-wechat-2026-09-24", lookup)).toEqual({
      kind: "im",
      id: "im-wechat-2026-09-24",
      channel: "wechat",
      day: "2026-09-24",
    });
    expect(resolveSource("im-unknown-2026-09-24", lookup)).toMatchObject({
      kind: "im",
      channel: null,
    });
  });
});

describe("dates", () => {
  it("writes a ledger day the app's way", () => {
    expect(formatLedgerDay("2026-09-27", TODAY, "zh-CN")).toBe("9月27日");
    expect(formatLedgerDay("2025-09-27", TODAY, "zh-CN")).toBe("2025年9月27日");
    expect(formatLedgerDay("2026-09-27", TODAY, "en-US")).toBe("Sep 27");
    expect(formatLedgerDay("soon", TODAY, "zh-CN")).toBe("soon");
  });

  it("writes a ledger minute the app's way", () => {
    expect(formatLedgerMinute("2026-09-27 07:00", TODAY, "zh-CN")).toBe(
      "9月27日 07:00",
    );
    expect(formatLedgerMinute("whenever", TODAY, "zh-CN")).toBe("whenever");
  });

  it("names today, tomorrow and yesterday for run times", () => {
    const words = copy.dayWords;
    const at = (day: number, hour: number) =>
      new Date(2026, 9, day, hour, 0).toISOString();
    expect(formatScheduleTime(at(12, 4), TODAY, "zh-CN", words)).toBe(
      "今天 04:00",
    );
    expect(formatScheduleTime(at(13, 4), TODAY, "zh-CN", words)).toBe(
      "明天 04:00",
    );
    expect(formatScheduleTime(at(11, 4), TODAY, "zh-CN", words)).toBe(
      "昨天 04:00",
    );
    expect(formatScheduleTime(at(9, 4), TODAY, "zh-CN", words)).toBe(
      "10月9日 04:00",
    );
    expect(formatScheduleTime("nope", TODAY, "zh-CN", words)).toBeNull();
  });
});

describe("switchStatus", () => {
  const base = {
    todayStartMs: TODAY,
    language: "zh-CN" as const,
    copy,
  };

  it("says nothing while the ledger is not on", () => {
    expect(
      switchStatus({ ...base, ledgerSwitch: { state: "off" }, running: false }),
    ).toBeNull();
  });

  it("says where reading starts, the last run and the next", () => {
    const status = switchStatus({
      ...base,
      ledgerSwitch: {
        state: "on",
        since: new Date(2026, 9, 12, 14, 30).toISOString(),
        lookBack: false,
      },
      running: false,
      lastRun: {
        startedAt: new Date(2026, 9, 12, 4, 0).toISOString(),
        outcome: "succeeded",
        turns: 3,
      },
      nextRunAt: new Date(2026, 9, 13, 4, 0).toISOString(),
    });
    expect(status?.parts).toEqual([
      "从 10月12日 14:30 开始",
      "上次整理 今天 04:00，已更新",
      "下次 明天 04:00",
    ]);
    expect(status?.failureDetail).toBeNull();
  });

  it("reads 从最早的对话开始 when it looks back", () => {
    const status = switchStatus({
      ...base,
      ledgerSwitch: MEMORY_OVERVIEW_FIXTURE.ledger.switch,
      running: false,
    });
    expect(status?.parts).toEqual(["从最早的对话开始"]);
  });

  it("says 正在整理 while a run is going, without the next run", () => {
    const status = switchStatus({
      ...base,
      ledgerSwitch: {
        state: "on",
        since: "1970-01-01T00:00:00Z",
        lookBack: true,
      },
      running: true,
      nextRunAt: new Date(2026, 9, 13, 4, 0).toISOString(),
    });
    expect(status?.parts).toEqual(["从最早的对话开始", "正在整理"]);
    expect(status?.running).toBe(true);
  });

  it("carries a failed run's reason", () => {
    const status = switchStatus({
      ...base,
      ledgerSwitch: {
        state: "on",
        since: "1970-01-01T00:00:00Z",
        lookBack: true,
      },
      running: false,
      lastRun: {
        startedAt: new Date(2026, 9, 11, 4, 0).toISOString(),
        outcome: "failed",
        turns: 0,
        detail: "model timed out",
      },
    });
    expect(status?.parts).toContain("上次整理 昨天 04:00，没有完成");
    expect(status?.failureDetail).toBe("model timed out");
  });
});

// Ticket 04c: one allow switch. On asks nothing and reads earlier
// conversations too; off asks 保留 / 清空.
describe("switchToggle", () => {
  it("turns on at once, earlier conversations included", () => {
    expect(switchToggle(true)).toEqual({
      kind: "apply",
      args: { action: "enable", lookBack: true },
    });
  });

  it("asks before turning off", () => {
    expect(switchToggle(false)).toEqual({ kind: "ask-disable" });
  });
});
