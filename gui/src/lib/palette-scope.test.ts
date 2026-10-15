import { describe, expect, it } from "vitest";

import {
  dropsScope,
  openConversationScope,
  PALETTE_MESSAGE_HITS,
  paletteAfterFind,
  paletteSearch,
  paletteSearchRequest,
  SCOPED_MESSAGE_HITS,
  scopedHitDate,
  scopedListView,
  type PaletteScope,
} from "@/lib/palette-scope";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";

const main = makeSession({
  id: "s-main",
  title: "主聊天",
  mainChat: true,
  gaRuntimeKind: "managed",
});
const flight = makeSession({ id: "s-flight", title: "订机票" });
const archived = makeSession({ id: "s-old", status: "archived" });
const sessions = [main, flight, archived];

const MAIN: PaletteScope = { sessionId: "s-main", mainChat: true };
const FLIGHT: PaletteScope = { sessionId: "s-flight", mainChat: false };

describe("openConversationScope (what ⌘F finds in)", () => {
  const open = (overrides: {
    screen?: string;
    settingsOpen?: boolean;
    activeSessionId?: string;
  }) =>
    openConversationScope({
      screen: "main",
      settingsOpen: false,
      activeSessionId: undefined,
      sessions,
      ...overrides,
    });

  it("is the conversation open in the main area, the main chat told apart", () => {
    expect(open({ activeSessionId: "s-main" })).toEqual(MAIN);
    expect(open({ activeSessionId: "s-flight" })).toEqual(FLIGHT);
  });

  it("is none without an open conversation: the empty state, Settings, onboarding", () => {
    expect(open({ screen: "empty", activeSessionId: "s-flight" })).toBeNull();
    expect(
      open({ activeSessionId: "s-flight", settingsOpen: true }),
    ).toBeNull();
    expect(
      open({ screen: "onboarding", activeSessionId: "s-flight" }),
    ).toBeNull();
    expect(open({})).toBeNull();
    expect(open({ activeSessionId: "s-gone" })).toBeNull();
    expect(open({ activeSessionId: "s-old" })).toBeNull();
  });
});

describe("paletteAfterFind (⌘F from whatever the palette is doing)", () => {
  const closed = { open: false, scope: null };

  it("opens the palette inside the conversation", () => {
    expect(paletteAfterFind(closed, MAIN)).toEqual({ open: true, scope: MAIN });
  });

  it("gives an open ⌘K palette the scope, and moves it to another conversation", () => {
    expect(paletteAfterFind({ open: true, scope: null }, FLIGHT)).toEqual({
      open: true,
      scope: FLIGHT,
    });
    expect(paletteAfterFind({ open: true, scope: MAIN }, FLIGHT)).toEqual({
      open: true,
      scope: FLIGHT,
    });
  });

  it("closes on a second ⌘F, as a second ⌘K does", () => {
    expect(paletteAfterFind({ open: true, scope: MAIN }, MAIN)).toEqual(closed);
  });

  it("is ⌘K without a conversation: a toggle, everywhere", () => {
    expect(paletteAfterFind(closed, null)).toEqual({ open: true, scope: null });
    expect(paletteAfterFind({ open: true, scope: null }, null)).toEqual(closed);
    expect(paletteAfterFind({ open: true, scope: MAIN }, null)).toEqual(closed);
  });
});

describe("dropsScope (Backspace in the empty input)", () => {
  const key = (overrides: Partial<Parameters<typeof dropsScope>[0]>) =>
    dropsScope({
      scoped: true,
      key: "Backspace",
      value: "",
      composing: false,
      ...overrides,
    });

  it("drops the scope only from an empty input", () => {
    expect(key({})).toBe(true);
    expect(key({ value: "花" })).toBe(false);
    // A space is text: the first Backspace deletes it.
    expect(key({ value: " " })).toBe(false);
    expect(key({ key: "Delete" })).toBe(false);
    expect(key({ scoped: false })).toBe(false);
  });

  it("leaves a Backspace an IME is composing with alone", () => {
    expect(key({ composing: true })).toBe(false);
  });
});

describe("paletteSearchRequest (what the palette asks Core)", () => {
  it("asks for one conversation's hits when scoped", () => {
    expect(paletteSearchRequest("花市", MAIN, "managed")).toEqual({
      query: "花市",
      limit: SCOPED_MESSAGE_HITS,
      runtimeKind: "managed",
      sessionId: "s-main",
    });
  });

  it("asks ⌘K's question unchanged without a scope", () => {
    expect(paletteSearchRequest("花市", null, "external")).toEqual({
      query: "花市",
      limit: PALETTE_MESSAGE_HITS,
      runtimeKind: "external",
    });
    expect(PALETTE_MESSAGE_HITS).toBe(8);
  });

  it("reaches Core's search_messages with the session, and without it as before", async () => {
    const { invoke } = getTauriMocks();
    invoke.mockResolvedValue([]);
    await paletteSearch("花市", MAIN, "managed");
    expect(invoke).toHaveBeenLastCalledWith("search_messages", {
      query: "花市",
      limit: 20,
      runtimeKind: "managed",
      sessionId: "s-main",
    });
    await paletteSearch("花市", null, "managed");
    const args = invoke.mock.lastCall?.[1];
    expect(args).toEqual({ query: "花市", limit: 8, runtimeKind: "managed" });
    expect(Object.keys(args ?? {})).not.toContain("sessionId");
    // Under two characters nothing is asked at all.
    invoke.mockClear();
    await paletteSearch("花", MAIN, "managed");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("scopedListView", () => {
  it("hints under two characters", () => {
    expect(scopedListView("", null, 0)).toBe("hint");
    expect(scopedListView("花", null, 0)).toBe("hint");
    expect(scopedListView(" 花 ", "花市", 3)).toBe("hint");
  });

  it("waits quietly for a query still out, says 没找到 only for one that came back empty", () => {
    expect(scopedListView("花市", null, 0)).toBe("pending");
    expect(scopedListView("花市场", "花市", 0)).toBe("pending");
    expect(scopedListView("花市", "花市", 0)).toBe("empty");
    expect(scopedListView("花市 ", "花市", 0)).toBe("empty");
  });

  it("shows hits, the last query's until the next arrive", () => {
    expect(scopedListView("花市", "花市", 2)).toBe("hits");
    expect(scopedListView("花市场", "花市", 2)).toBe("hits");
  });
});

describe("scopedHitDate (a scoped hit's first line)", () => {
  // Built from local wall-clock parts: the assertions hold in any
  // timezone the suite runs in.
  const at = (y: number, m: number, d: number, h: number, min: number) =>
    new Date(y, m - 1, d, h, min).toISOString();
  const today = new Date(2026, 9, 15).getTime();
  const words = {
    today: (time: string) => `今天 ${time}`,
    yesterday: (time: string) => `昨天 ${time}`,
  };

  it("reads like the conversation's time bar, the day word kept", () => {
    expect(scopedHitDate(at(2026, 10, 15, 21, 40), today, "zh-CN", words)).toBe(
      "今天 21:40",
    );
    expect(scopedHitDate(at(2026, 10, 14, 9, 5), today, "zh-CN", words)).toBe(
      "昨天 09:05",
    );
    expect(scopedHitDate(at(2026, 10, 13, 21, 40), today, "zh-CN", words)).toBe(
      "10月13日 21:40",
    );
    expect(scopedHitDate(at(2025, 12, 31, 8, 0), today, "zh-CN", words)).toBe(
      "2025年12月31日 08:00",
    );
  });

  it("is null for a time that does not parse", () => {
    expect(scopedHitDate("not a time", today, "zh-CN", words)).toBeNull();
  });
});
