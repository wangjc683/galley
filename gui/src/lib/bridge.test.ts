import { describe, expect, it } from "vitest";

import { shouldUseBundledPython } from "./bridge";

describe("shouldUseBundledPython", () => {
  it("never uses the bundle in dev builds", () => {
    expect(
      shouldUseBundledPython({ isProd: false, runtimeKind: "managed" }),
    ).toBe(false);
    expect(
      shouldUseBundledPython({
        isProd: false,
        runtimeKind: "external",
        useExternalPython: false,
      }),
    ).toBe(false);
  });

  it("pins bundled-engine sessions to the bundle even with external Python on", () => {
    expect(
      shouldUseBundledPython({
        isProd: true,
        runtimeKind: "managed",
        useExternalPython: true,
      }),
    ).toBe(true);
    expect(
      shouldUseBundledPython({
        isProd: true,
        runtimeKind: "managed",
        useExternalPython: false,
      }),
    ).toBe(true);
  });

  it("lets external sessions opt out of the bundle", () => {
    expect(
      shouldUseBundledPython({
        isProd: true,
        runtimeKind: "external",
        useExternalPython: true,
      }),
    ).toBe(false);
    expect(
      shouldUseBundledPython({
        isProd: true,
        runtimeKind: "external",
        useExternalPython: false,
      }),
    ).toBe(true);
  });

  it("treats an omitted runtime kind as the legacy external default", () => {
    expect(
      shouldUseBundledPython({ isProd: true, useExternalPython: true }),
    ).toBe(false);
    expect(shouldUseBundledPython({ isProd: true })).toBe(true);
  });
});
