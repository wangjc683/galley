import { describe, expect, it } from "vitest";

import { resolveDisplayedLLM } from "@/lib/current-llm";
import type { LLMOption } from "@/stores/runtime";

function opt(index: number, displayName: string, isCurrent = false): LLMOption {
  return { index, displayName, isCurrent };
}

const managed = [opt(0, "Managed A", true), opt(1, "Managed B")];
const cached = [opt(0, "Cached X", true), opt(1, "Cached Y")];
const active = [opt(0, "Active M", true)];

const base = {
  managedLLMs: managed,
  managedDisplayName: "Managed A",
  cachedLLMs: cached,
  cachedDisplayName: "Cached X",
};

describe("resolveDisplayedLLM", () => {
  it("prefers the active session's runtime slot over any fallback", () => {
    const r = resolveDisplayedLLM({
      ...base,
      runtimeKind: "external",
      activeRuntimeLLMs: active,
      activeRuntimeDisplayName: "Active M",
    });
    expect(r.llms).toBe(active);
    expect(r.displayName).toBe("Active M");
  });

  it("falls back to the cross-session cache for external with no slot", () => {
    const r = resolveDisplayedLLM({
      ...base,
      runtimeKind: "external",
      activeRuntimeLLMs: undefined,
      activeRuntimeDisplayName: undefined,
    });
    expect(r.llms).toBe(cached);
    expect(r.displayName).toBe("Cached X");
  });

  it("falls back to the managed model list for managed with no slot", () => {
    const r = resolveDisplayedLLM({
      ...base,
      runtimeKind: "managed",
      activeRuntimeLLMs: undefined,
      activeRuntimeDisplayName: undefined,
    });
    expect(r.llms).toBe(managed);
    expect(r.displayName).toBe("Managed A");
  });

  it("floors the display name at empty string, never undefined", () => {
    const r = resolveDisplayedLLM({
      runtimeKind: "external",
      activeRuntimeLLMs: undefined,
      activeRuntimeDisplayName: undefined,
      managedLLMs: [],
      managedDisplayName: "",
      cachedLLMs: [],
      cachedDisplayName: "",
    });
    expect(r.displayName).toBe("");
  });
});
