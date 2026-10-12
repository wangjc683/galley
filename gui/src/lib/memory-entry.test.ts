import { describe, expect, it } from "vitest";

import type { LedgerExclusion, LedgerSwitch } from "@/lib/memory";

import { projectMenuExclusion, titleMenuMemoryItems } from "./memory-entry";

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
