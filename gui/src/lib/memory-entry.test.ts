import { describe, expect, it } from "vitest";

import type { LedgerExclusion, LedgerSwitch } from "@/lib/memory";
import type { Turn } from "@/types/conversation";

import {
  hasCompletedExchange,
  projectMenuExclusion,
  shouldAskAboutMemory,
  titleMenuMemoryItems,
} from "./memory-entry";

const ON: LedgerSwitch = {
  state: "on",
  since: "2026-10-12T06:30:00Z",
  lookBack: false,
};
const MARKS: LedgerExclusion[] = [
  { target: { kind: "session", id: "s2" }, createdAt: "2026-10-12" },
  { target: { kind: "project", id: "p1" }, createdAt: "2026-10-12" },
];

describe("titleMenuMemoryItems", () => {
  const main = { id: "m", mainChat: true, gaRuntimeKind: "managed" as const };
  const other = { id: "s1", gaRuntimeKind: "managed" as const };

  it("offers nothing on the external runtime", () => {
    for (const session of [main, other]) {
      expect(
        titleMenuMemoryItems({
          runtimeKind: "external",
          session,
          ledgerSwitch: ON,
          exclusions: [],
        }),
      ).toEqual({ whatItRemembers: false, exclusion: null });
    }
    expect(
      titleMenuMemoryItems({
        runtimeKind: "managed",
        session: { id: "x", gaRuntimeKind: "external" },
        ledgerSwitch: ON,
        exclusions: [],
      }),
    ).toEqual({ whatItRemembers: false, exclusion: null });
  });

  it("leads the main chat to the page, never offering the exclusion", () => {
    for (const ledgerSwitch of [null, ON, { state: "undecided" } as const]) {
      expect(
        titleMenuMemoryItems({
          runtimeKind: "managed",
          session: main,
          ledgerSwitch,
          exclusions: [],
        }),
      ).toEqual({ whatItRemembers: true, exclusion: null });
    }
  });

  it("offers 不用于了解我 on other sessions only while the ledger is on", () => {
    for (const ledgerSwitch of [
      null,
      { state: "undecided" } as const,
      { state: "off" } as const,
    ]) {
      expect(
        titleMenuMemoryItems({
          runtimeKind: "managed",
          session: other,
          ledgerSwitch,
          exclusions: [],
        }).exclusion,
      ).toBeNull();
    }
    expect(
      titleMenuMemoryItems({
        runtimeKind: "managed",
        session: other,
        ledgerSwitch: ON,
        exclusions: MARKS,
      }),
    ).toEqual({ whatItRemembers: false, exclusion: { checked: false } });
    expect(
      titleMenuMemoryItems({
        runtimeKind: "managed",
        session: { id: "s2", gaRuntimeKind: "managed" },
        ledgerSwitch: ON,
        exclusions: MARKS,
      }).exclusion,
    ).toEqual({ checked: true });
  });

  it("offers nothing without a session", () => {
    expect(
      titleMenuMemoryItems({
        runtimeKind: "managed",
        session: undefined,
        ledgerSwitch: ON,
        exclusions: [],
      }),
    ).toEqual({ whatItRemembers: false, exclusion: null });
  });
});

describe("projectMenuExclusion", () => {
  it("is offered only on the managed runtime while the ledger is on", () => {
    expect(
      projectMenuExclusion({
        runtimeKind: "external",
        projectId: "p1",
        ledgerSwitch: ON,
        exclusions: MARKS,
      }),
    ).toBeNull();
    expect(
      projectMenuExclusion({
        runtimeKind: "managed",
        projectId: "p1",
        ledgerSwitch: { state: "off" },
        exclusions: MARKS,
      }),
    ).toBeNull();
    expect(
      projectMenuExclusion({
        runtimeKind: "managed",
        projectId: "p1",
        ledgerSwitch: ON,
        exclusions: MARKS,
      }),
    ).toEqual({ checked: true });
    expect(
      projectMenuExclusion({
        runtimeKind: "managed",
        projectId: "s2", // a session mark is not a project mark
        ledgerSwitch: ON,
        exclusions: MARKS,
      }),
    ).toEqual({ checked: false });
  });
});

const user = (content: string): Turn => ({ role: "user", content });
const agent = (finalAnswer: string | null): Turn => ({
  role: "agent",
  tools: [],
  finalAnswer,
});

describe("hasCompletedExchange", () => {
  it("needs a user message followed by a finished answer", () => {
    expect(hasCompletedExchange([])).toBe(false);
    expect(hasCompletedExchange([user("hi")])).toBe(false);
    expect(hasCompletedExchange([user("hi"), agent(null)])).toBe(false);
    expect(hasCompletedExchange([user("hi"), agent("  ")])).toBe(false);
    expect(hasCompletedExchange([agent("hello"), user("hi")])).toBe(false);
    expect(hasCompletedExchange([user("hi"), agent("hello")])).toBe(true);
  });
});

describe("shouldAskAboutMemory", () => {
  const ask = (
    overrides: Partial<Parameters<typeof shouldAskAboutMemory>[0]>,
  ) =>
    shouldAskAboutMemory({
      runtimeKind: "managed",
      isMainChat: true,
      ledgerSwitch: { state: "undecided" },
      turns: [user("hi"), agent("hello")],
      runOpen: false,
      waitingAskUser: false,
      ...overrides,
    });

  it("asks in the main chat after the first exchange while undecided", () => {
    expect(ask({})).toBe(true);
  });

  it("does not ask in an empty main chat or mid-first-exchange", () => {
    expect(ask({ turns: [] })).toBe(false);
    expect(ask({ turns: [user("hi")] })).toBe(false);
  });

  it("asks once: not after an answer, nor before the switch is known", () => {
    expect(ask({ ledgerSwitch: { state: "off" } })).toBe(false);
    expect(
      ask({ ledgerSwitch: { state: "on", since: "x", lookBack: false } }),
    ).toBe(false);
    expect(ask({ ledgerSwitch: null })).toBe(false);
  });

  it("only in the managed runtime's main chat", () => {
    expect(ask({ isMainChat: false })).toBe(false);
    expect(ask({ runtimeKind: "external" })).toBe(false);
  });

  it("waits while a run is open or the AI is asking", () => {
    expect(ask({ runOpen: true })).toBe(false);
    expect(ask({ waitingAskUser: true })).toBe(false);
  });

  it("demo mode forces it, still only in the managed main chat", () => {
    expect(ask({ demo: true, turns: [], ledgerSwitch: ON })).toBe(true);
    expect(ask({ demo: true, isMainChat: false })).toBe(false);
    expect(ask({ demo: true, runtimeKind: "external" })).toBe(false);
  });
});
