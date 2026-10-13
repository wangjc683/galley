import { describe, expect, it } from "vitest";

import { getTauriMocks } from "@/test/setup";

import {
  deleteEntryEmotion,
  deleteLedgerEntry,
  getLedgerSwitch,
  getMemoryOverview,
  memoryErrorId,
  setLedgerSwitch,
  writeGlobalMemory,
} from "./memory";

describe("memoryErrorId", () => {
  it("reads the bare identifier, a typed error and a Display form", () => {
    expect(memoryErrorId("ledger_busy")).toBe("ledger_busy");
    expect(memoryErrorId(new Error("changed_on_disk"))).toBe("changed_on_disk");
    expect(
      memoryErrorId('{"error":"not_found","message":"entry A001 not found"}'),
    ).toBe("not_found");
    expect(memoryErrorId("managed_only: attach mode")).toBe("managed_only");
  });

  it("is null for anything else", () => {
    expect(memoryErrorId("disk full")).toBeNull();
    expect(memoryErrorId('{"error":"internal","message":"x"}')).toBeNull();
    expect(memoryErrorId("not_foundish")).toBeNull();
  });
});

describe("command wrappers (interface of ticket 04)", () => {
  it("call the commands by name with the interface's arguments", async () => {
    const { invoke } = getTauriMocks();
    await getLedgerSwitch();
    await getMemoryOverview();
    await setLedgerSwitch({ action: "enable", lookBack: true });
    await setLedgerSwitch({ action: "disable", clear: false });
    await deleteLedgerEntry("A001");
    await deleteEntryEmotion("A001", "- 情绪：焦急——“一”");
    await writeGlobalMemory("global_mem.txt", "text", "rev1");
    expect(invoke.mock.calls).toEqual([
      ["get_ledger_switch"],
      ["get_memory_overview"],
      ["set_ledger_switch", { action: "enable", lookBack: true }],
      ["set_ledger_switch", { action: "disable", clear: false }],
      ["delete_ledger_entry", { id: "A001" }],
      ["delete_ledger_emotion", { id: "A001", line: "- 情绪：焦急——“一”" }],
      [
        "write_global_memory",
        { name: "global_mem.txt", content: "text", revision: "rev1" },
      ],
    ]);
  });
});
