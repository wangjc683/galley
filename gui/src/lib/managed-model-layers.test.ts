import { describe, expect, it } from "vitest";

import {
  DEFAULTS_REASONING_TIERS,
  FACTORY_MODEL_DEFAULTS,
  MANAGED_MODEL_DEFAULT_KEYS,
  defaultsCustomCount,
  effectiveAdvancedOptions,
  hasPromotableOverrides,
  modelLayerBaseline,
  overrideCount,
  promoteOverridesToDefaults,
  withDefaultsOption,
  withLayeredOverride,
} from "@/lib/managed-model-layers";

describe("layer constants", () => {
  it("mirrors Core's six defaults keys", () => {
    expect(MANAGED_MODEL_DEFAULT_KEYS).toEqual([
      "max_retries",
      "read_timeout",
      "max_retry_after",
      "trim_keep_prefix",
      "stream",
      "reasoning_effort",
    ]);
  });

  it("offers five reasoning tiers at the defaults layer", () => {
    expect(DEFAULTS_REASONING_TIERS).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it("leaves reasoning_effort out of the factory recommendation", () => {
    expect(FACTORY_MODEL_DEFAULTS).toEqual({
      max_retries: 3,
      read_timeout: 180,
      max_retry_after: 60,
      trim_keep_prefix: 0,
      stream: true,
    });
    expect("reasoning_effort" in FACTORY_MODEL_DEFAULTS).toBe(false);
  });
});

describe("effectiveAdvancedOptions", () => {
  it("layers defaults over the preset and overrides over both", () => {
    expect(
      effectiveAdvancedOptions(
        { api_mode: "responses", read_timeout: 180, reasoning_effort: "high" },
        { read_timeout: 600, stream: false },
        { reasoning_effort: "max" },
      ),
    ).toEqual({
      api_mode: "responses",
      read_timeout: 600,
      stream: false,
      reasoning_effort: "max",
    });
  });

  it("treats a null override as a tombstone and drops the key", () => {
    expect(
      effectiveAdvancedOptions(
        { reasoning_effort: "high" },
        { reasoning_effort: "medium" },
        { reasoning_effort: null },
      ),
    ).toEqual({});
  });

  it("keeps the inputs untouched", () => {
    const preset = { read_timeout: 180 };
    const defaults = { stream: false };
    const overrides = { max_retries: 5 };
    effectiveAdvancedOptions(preset, defaults, overrides);
    expect(preset).toEqual({ read_timeout: 180 });
    expect(defaults).toEqual({ stream: false });
    expect(overrides).toEqual({ max_retries: 5 });
  });
});

describe("modelLayerBaseline", () => {
  it("is the factory values, then the preset, then the defaults", () => {
    expect(
      modelLayerBaseline(
        { read_timeout: 180, reasoning_effort: "high" },
        { read_timeout: 600 },
      ),
    ).toEqual({
      max_retries: 3,
      read_timeout: 600,
      max_retry_after: 60,
      trim_keep_prefix: 0,
      stream: true,
      reasoning_effort: "high",
    });
  });

  it("lets a displayed fallback be typed back without leaving an override", () => {
    const baseline = modelLayerBaseline({}, {});
    const bumped = withLayeredOverride({}, baseline, "trim_keep_prefix", 4);
    expect(bumped).toEqual({ trim_keep_prefix: 4 });
    expect(
      withLayeredOverride(bumped, baseline, "trim_keep_prefix", 0),
    ).toEqual({});
  });
});

describe("withLayeredOverride", () => {
  const baseline = {
    read_timeout: 180,
    trim_keep_prefix: 4,
    reasoning_effort: "high",
  };

  it("stores a value that deviates from the baseline", () => {
    expect(withLayeredOverride({}, baseline, "read_timeout", 600)).toEqual({
      read_timeout: 600,
    });
  });

  it("deletes the key when the value equals the baseline again", () => {
    const stored = withLayeredOverride({}, baseline, "read_timeout", 600);
    expect(withLayeredOverride(stored, baseline, "read_timeout", 180)).toEqual(
      {},
    );
  });

  it("keeps an explicit 0 when the baseline is not 0", () => {
    // The old "0 = drop the key" sentinel is gone: with a default of 4
    // a model may legitimately want none kept.
    expect(withLayeredOverride({}, baseline, "trim_keep_prefix", 0)).toEqual({
      trim_keep_prefix: 0,
    });
    expect(withLayeredOverride({}, baseline, "trim_keep_prefix", 4)).toEqual(
      {},
    );
  });

  it("stores a tombstone when the baseline sets the key", () => {
    expect(withLayeredOverride({}, baseline, "reasoning_effort", null)).toEqual(
      { reasoning_effort: null },
    );
  });

  it("stores nothing for a tombstone with no baseline value", () => {
    expect(
      withLayeredOverride(
        { reasoning_effort: "low" },
        { read_timeout: 180 },
        "reasoning_effort",
        null,
      ),
    ).toEqual({});
  });

  it("round-trips a tombstone back to following", () => {
    const tombstoned = withLayeredOverride(
      {},
      baseline,
      "reasoning_effort",
      null,
    );
    expect(
      withLayeredOverride(tombstoned, baseline, "reasoning_effort", "high"),
    ).toEqual({});
  });
});

describe("overrideCount", () => {
  it("counts the UI keys present, tombstones included", () => {
    expect(
      overrideCount({ reasoning_effort: null, read_timeout: 600 }, [
        "reasoning_effort",
        "read_timeout",
        "stream",
      ]),
    ).toBe(2);
  });

  it("ignores keys outside the given UI set", () => {
    expect(overrideCount({ api_mode: "responses" }, ["stream"])).toBe(0);
  });
});

describe("withDefaultsOption", () => {
  it("stores a deviation from the factory value", () => {
    expect(withDefaultsOption({}, "read_timeout", 600)).toEqual({
      read_timeout: 600,
    });
  });

  it("deletes the key when the factory value is picked again", () => {
    expect(
      withDefaultsOption({ read_timeout: 600 }, "read_timeout", 180),
    ).toEqual({});
    expect(withDefaultsOption({ stream: false }, "stream", true)).toEqual({});
  });

  it("deletes on null / empty (由服务商决定)", () => {
    expect(
      withDefaultsOption(
        { reasoning_effort: "high" },
        "reasoning_effort",
        null,
      ),
    ).toEqual({});
    expect(
      withDefaultsOption({ reasoning_effort: "high" }, "reasoning_effort", ""),
    ).toEqual({});
  });

  it("stores a reasoning tier — it has no factory value", () => {
    expect(withDefaultsOption({}, "reasoning_effort", "high")).toEqual({
      reasoning_effort: "high",
    });
  });
});

describe("defaultsCustomCount", () => {
  it("counts the stored deviations", () => {
    expect(defaultsCustomCount({})).toBe(0);
    expect(
      defaultsCustomCount({ read_timeout: 600, reasoning_effort: "high" }),
    ).toBe(2);
  });
});

describe("hasPromotableOverrides", () => {
  it("is false for nothing, dialect-only or tombstoned overrides", () => {
    expect(hasPromotableOverrides({})).toBe(false);
    expect(hasPromotableOverrides({ api_mode: "responses" })).toBe(false);
    expect(hasPromotableOverrides({ reasoning_effort: null })).toBe(false);
  });

  it("is false for a tier the defaults layer does not offer", () => {
    expect(hasPromotableOverrides({ reasoning_effort: "minimal" })).toBe(false);
  });

  it("is true for a layered value the defaults can hold", () => {
    expect(hasPromotableOverrides({ stream: false })).toBe(true);
    expect(hasPromotableOverrides({ reasoning_effort: "xhigh" })).toBe(true);
  });
});

describe("promoteOverridesToDefaults", () => {
  it("moves the layered keys and clears them from the overrides", () => {
    expect(
      promoteOverridesToDefaults(
        { read_timeout: 600, reasoning_effort: "xhigh", api_mode: "responses" },
        {},
      ),
    ).toEqual({
      defaults: { read_timeout: 600, reasoning_effort: "xhigh" },
      overrides: { api_mode: "responses" },
    });
  });

  it("leaves a tombstone and an out-of-range tier where they are", () => {
    expect(promoteOverridesToDefaults({ reasoning_effort: null }, {})).toEqual({
      defaults: {},
      overrides: { reasoning_effort: null },
    });
    expect(
      promoteOverridesToDefaults({ reasoning_effort: "minimal" }, {}),
    ).toEqual({ defaults: {}, overrides: { reasoning_effort: "minimal" } });
  });

  it("still un-overrides a value that lands back on the factory one", () => {
    // trim_keep_prefix 0 IS the factory value: the defaults object
    // stays empty and the model follows it — same effective value.
    expect(promoteOverridesToDefaults({ trim_keep_prefix: 0 }, {})).toEqual({
      defaults: {},
      overrides: {},
    });
  });

  it("keeps existing unrelated defaults", () => {
    expect(
      promoteOverridesToDefaults({ stream: false }, { max_retries: 6 }),
    ).toEqual({
      defaults: { max_retries: 6, stream: false },
      overrides: {},
    });
  });
});
