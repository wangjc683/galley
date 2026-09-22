import { describe, expect, it } from "vitest";

import {
  COMPOSER_EFFORT_TIERS,
  EFFORT_DEFAULT_ROW,
  effortPillState,
  modelConfiguredEffort,
  normalizeEffortOverride,
  resolveConfiguredEffort,
} from "@/lib/reasoning-effort";

describe("COMPOSER_EFFORT_TIERS", () => {
  it("offers exactly the five tiers both protocols understand", () => {
    // `max` included: the engine maps it to the Claude top tier
    // (same as xhigh) rather than ignoring it. Only `none` /
    // `minimal` stay configuration-only.
    expect(COMPOSER_EFFORT_TIERS).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });
});

describe("normalizeEffortOverride", () => {
  it("clears the override when the pick equals the configured tier", () => {
    expect(normalizeEffortOverride("high", "high")).toBeNull();
  });

  it("keeps a deviating pick", () => {
    expect(normalizeEffortOverride("high", "medium")).toBe("high");
    expect(normalizeEffortOverride("high", null)).toBe("high");
  });

  it("treats the 默认 row (null) as follow-the-configuration", () => {
    expect(normalizeEffortOverride(null, null)).toBeNull();
    expect(normalizeEffortOverride(null, "medium")).toBeNull();
  });
});

describe("effortPillState", () => {
  it("offers the 默认 row and reads 默认 on the chip when nothing is set", () => {
    expect(
      effortPillState({ override: null, effective: null, configured: null }),
    ).toEqual({
      showDefaultRow: true,
      currentRow: EFFORT_DEFAULT_ROW,
      following: true,
    });
  });

  it("hides the 默认 row when the model configures a tier", () => {
    expect(
      effortPillState({
        override: null,
        effective: "medium",
        configured: "medium",
      }),
    ).toEqual({
      showDefaultRow: false,
      currentRow: "medium",
      following: true,
    });
  });

  it("marks a session override as deviating (loud ink)", () => {
    expect(
      effortPillState({
        override: "xhigh",
        effective: "xhigh",
        configured: "medium",
      }),
    ).toEqual({
      showDefaultRow: false,
      currentRow: "xhigh",
      following: false,
    });
  });

  it("keeps the 默认 row alongside an override when the model sets no tier", () => {
    expect(
      effortPillState({ override: "low", effective: "low", configured: null }),
    ).toEqual({
      showDefaultRow: true,
      currentRow: "low",
      following: false,
    });
  });

  it("marks no row current for a configured tier outside the five", () => {
    expect(
      effortPillState({
        override: null,
        effective: "minimal",
        configured: "minimal",
      }),
    ).toEqual({
      showDefaultRow: false,
      currentRow: "minimal",
      following: true,
    });
    // ... and falls back to no current row when there is no effective
    // tier although the configuration has one (inconsistent report).
    expect(
      effortPillState({
        override: null,
        effective: null,
        configured: "minimal",
      }),
    ).toEqual({
      showDefaultRow: false,
      currentRow: null,
      following: true,
    });
  });
});

describe("modelConfiguredEffort", () => {
  it("reads the tier out of the advanced-options bag", () => {
    expect(
      modelConfiguredEffort({
        id: "m1",
        advancedOptions: { reasoning_effort: "HIGH " },
      }),
    ).toBe("high");
  });

  it("returns null for an unset / unknown / missing model", () => {
    expect(modelConfiguredEffort(undefined)).toBeNull();
    expect(modelConfiguredEffort({ id: "m1", advancedOptions: {} })).toBeNull();
    expect(
      modelConfiguredEffort({
        id: "m1",
        advancedOptions: { reasoning_effort: "turbo" },
      }),
    ).toBeNull();
  });

  it("does not apply the Codex minimal→medium badge coercion", () => {
    expect(
      modelConfiguredEffort({
        id: "m1",
        advancedOptions: { reasoning_effort: "minimal", codex_backend: true },
      }),
    ).toBe("minimal");
  });
});

describe("resolveConfiguredEffort", () => {
  const managedModels = [
    { id: "m1", advancedOptions: { reasoning_effort: "high" } },
    { id: "m2", advancedOptions: {} },
  ];

  it("prefers the runner report once one has arrived", () => {
    expect(
      resolveConfiguredEffort({
        known: true,
        reported: "low",
        runtimeKind: "managed",
        selectedModelKey: "m1",
        managedModels,
      }),
    ).toBe("low");
    // A report of "nothing set" is information too, and outranks the
    // model store.
    expect(
      resolveConfiguredEffort({
        known: true,
        reported: null,
        runtimeKind: "managed",
        selectedModelKey: "m1",
        managedModels,
      }),
    ).toBeNull();
  });

  it("reads the managed model configuration before any report", () => {
    expect(
      resolveConfiguredEffort({
        known: false,
        reported: null,
        runtimeKind: "managed",
        selectedModelKey: "m1",
        managedModels,
      }),
    ).toBe("high");
    expect(
      resolveConfiguredEffort({
        known: false,
        reported: null,
        runtimeKind: "managed",
        selectedModelKey: "m2",
        managedModels,
      }),
    ).toBeNull();
    expect(
      resolveConfiguredEffort({
        known: false,
        reported: null,
        runtimeKind: "managed",
        selectedModelKey: "gone",
        managedModels,
      }),
    ).toBeNull();
  });

  it("stays at 默认 for the external runtime until ready reports", () => {
    expect(
      resolveConfiguredEffort({
        known: false,
        reported: null,
        runtimeKind: "external",
        selectedModelKey: "m1",
        managedModels,
      }),
    ).toBeNull();
  });

  it("returns null when no model is selected yet", () => {
    expect(
      resolveConfiguredEffort({
        known: false,
        reported: null,
        runtimeKind: "managed",
        selectedModelKey: undefined,
        managedModels,
      }),
    ).toBeNull();
  });
});
