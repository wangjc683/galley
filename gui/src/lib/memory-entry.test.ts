import { describe, expect, it } from "vitest";

import { titleMenuOpensMemory } from "./memory-entry";

describe("titleMenuOpensMemory", () => {
  const main = { id: "m", mainChat: true, gaRuntimeKind: "managed" as const };
  const other = { id: "s1", gaRuntimeKind: "managed" as const };

  it("leads the main chat's menu to the memory page", () => {
    expect(
      titleMenuOpensMemory({ runtimeKind: "managed", session: main }),
    ).toBe(true);
  });

  it("offers nothing on other sessions", () => {
    expect(
      titleMenuOpensMemory({ runtimeKind: "managed", session: other }),
    ).toBe(false);
  });

  it("offers nothing on the external runtime", () => {
    expect(
      titleMenuOpensMemory({ runtimeKind: "external", session: main }),
    ).toBe(false);
    expect(
      titleMenuOpensMemory({
        runtimeKind: "managed",
        session: { id: "x", mainChat: true, gaRuntimeKind: "external" },
      }),
    ).toBe(false);
  });

  it("offers nothing without a session", () => {
    expect(
      titleMenuOpensMemory({ runtimeKind: "managed", session: undefined }),
    ).toBe(false);
  });
});
