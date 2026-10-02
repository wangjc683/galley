import { describe, expect, it } from "vitest";

import { resolveSidebarRuntimeIndicator } from "./runtime-indicator";

describe("resolveSidebarRuntimeIndicator", () => {
  const configured = { gaPath: "/path/to/ga", python: "/usr/bin/python3" };

  it("hides the nudge when managed runtime has a configured model", () => {
    expect(resolveSidebarRuntimeIndicator("managed", true, configured)).toBe(
      "hidden",
    );
  });

  it("prompts model config when managed runtime has no usable credential", () => {
    expect(resolveSidebarRuntimeIndicator("managed", false, configured)).toBe(
      "configure-models",
    );
  });

  it("is external-ready when both GA path and python are set", () => {
    expect(resolveSidebarRuntimeIndicator("external", false, configured)).toBe(
      "external-ready",
    );
  });

  it("is external-unconfigured when GA path or python is blank/whitespace", () => {
    expect(
      resolveSidebarRuntimeIndicator("external", false, {
        gaPath: "",
        python: "/usr/bin/python3",
      }),
    ).toBe("external-unconfigured");
    expect(
      resolveSidebarRuntimeIndicator("external", false, {
        gaPath: "/path/to/ga",
        python: "   ",
      }),
    ).toBe("external-unconfigured");
  });

  it("ignores managed-model config status for external runtime", () => {
    expect(resolveSidebarRuntimeIndicator("external", true, configured)).toBe(
      "external-ready",
    );
  });
});
