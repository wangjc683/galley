import { describe, expect, it } from "vitest";

import {
  isExternalGAConfigured,
  resolveRuntimeIndicator,
} from "./runtime-indicator";

describe("isExternalGAConfigured", () => {
  it("is true once a GA folder is set", () => {
    expect(isExternalGAConfigured({ gaPath: "/path/to/ga" })).toBe(true);
  });

  it("is false for a blank or whitespace GA folder", () => {
    expect(isExternalGAConfigured({ gaPath: "" })).toBe(false);
    expect(isExternalGAConfigured({ gaPath: "   " })).toBe(false);
  });
});

describe("resolveRuntimeIndicator", () => {
  const configured = { gaPath: "/path/to/ga", python: "/usr/bin/python3" };

  it("hides the nudge when managed runtime has a configured model", () => {
    expect(resolveRuntimeIndicator("managed", true, configured)).toBe("hidden");
  });

  it("prompts model config when managed runtime has no usable credential", () => {
    expect(resolveRuntimeIndicator("managed", false, configured)).toBe(
      "configure-models",
    );
  });

  it("is external-ready when the GA path is set", () => {
    expect(resolveRuntimeIndicator("external", false, configured)).toBe(
      "external-ready",
    );
  });

  it("is external-unconfigured when the GA path is blank/whitespace", () => {
    const blankPath = { gaPath: "", python: "/usr/bin/python3" };
    const whitespacePath = { gaPath: "   ", python: "/usr/bin/python3" };
    expect(resolveRuntimeIndicator("external", false, blankPath)).toBe(
      "external-unconfigured",
    );
    expect(resolveRuntimeIndicator("external", false, whitespacePath)).toBe(
      "external-unconfigured",
    );
  });

  it("does not require a Python value (spawns fall back to the bundle / PATH)", () => {
    // Same rule as Settings → 运行环境: a blank Python field never
    // blocks a session, so it must not flip the header to
    // "unconfigured" while Settings says the external GA is ready.
    const blankPython = { gaPath: "/path/to/ga", python: "   " };
    expect(resolveRuntimeIndicator("external", false, blankPython)).toBe(
      "external-ready",
    );
  });

  it("ignores managed-model config status for external runtime", () => {
    expect(resolveRuntimeIndicator("external", true, configured)).toBe(
      "external-ready",
    );
  });
});
