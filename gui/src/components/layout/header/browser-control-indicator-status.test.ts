import { describe, expect, it } from "vitest";

import {
  type BrowserControlIndicatorInput,
  browserControlErrorGroup,
  browserControlIndicatorView,
  browserControlInviteVisible,
} from "./browser-control-indicator-status";

function input(
  patch: Partial<BrowserControlIndicatorInput> = {},
): BrowserControlIndicatorInput {
  return {
    status: "unknown",
    verified: false,
    verificationHydrated: true,
    tabCount: 0,
    errorKind: null,
    errorDetail: null,
    ...patch,
  };
}

describe("browserControlIndicatorView", () => {
  it("lights the lamp only for a live extension connection", () => {
    expect(
      browserControlIndicatorView(
        input({ status: "connected", verified: true }),
      ),
    ).toEqual({ form: "lamp", lit: true, state: "connected" });
    expect(
      browserControlIndicatorView(
        input({ status: "connected_no_tabs", verified: true }),
      ),
    ).toEqual({ form: "lamp", lit: true, state: "noTabs" });
    expect(
      browserControlIndicatorView(input({ status: "offline", verified: true })),
    ).toEqual({ form: "lamp", lit: false, state: "offline" });
  });

  it("invites setup while never verified", () => {
    expect(
      browserControlIndicatorView(input({ status: "not_connected" })),
    ).toEqual({ form: "pending" });
  });

  it("resolves unknown from the persisted verification, not a checking badge", () => {
    expect(
      browserControlIndicatorView(input({ verificationHydrated: false })),
    ).toEqual({ form: "hidden" });
    expect(browserControlIndicatorView(input({ verified: true }))).toEqual({
      form: "lamp",
      lit: false,
      state: "checking",
    });
    expect(browserControlIndicatorView(input({ verified: false }))).toEqual({
      form: "pending",
    });
  });

  it("names errors by the bridge's cause", () => {
    expect(
      browserControlIndicatorView(
        input({ status: "error", errorKind: "port_in_use" }),
      ),
    ).toEqual({ form: "error", group: "portInUse" });
    expect(
      browserControlIndicatorView(input({ status: "error", verified: true })),
    ).toEqual({ form: "error", group: "generic" });
  });
});

describe("browserControlErrorGroup", () => {
  it("folds bridge and Core kinds into user-facing causes", () => {
    expect(browserControlErrorGroup("missing_dependency")).toBe(
      "missingDependency",
    );
    expect(browserControlErrorGroup("master_unreachable")).toBe("unreachable");
    for (const kind of [
      "start_failed",
      "http_failed",
      "spawn_failed",
      "exited",
    ]) {
      expect(browserControlErrorGroup(kind)).toBe("startFailed");
    }
    expect(browserControlErrorGroup("status_failed")).toBe("generic");
    expect(browserControlErrorGroup(null)).toBe("generic");
  });
});

describe("browserControlInviteVisible", () => {
  it("shows while unverified and not connected, from the first frame", () => {
    expect(browserControlInviteVisible(input({ status: "unknown" }))).toBe(
      true,
    );
    expect(
      browserControlInviteVisible(input({ status: "not_connected" })),
    ).toBe(true);
    expect(browserControlInviteVisible(input({ status: "error" }))).toBe(true);
  });

  it("hides once connected, verified, or before the flag is read", () => {
    expect(browserControlInviteVisible(input({ status: "connected" }))).toBe(
      false,
    );
    expect(
      browserControlInviteVisible(input({ status: "connected_no_tabs" })),
    ).toBe(false);
    expect(
      browserControlInviteVisible(input({ status: "error", verified: true })),
    ).toBe(false);
    expect(
      browserControlInviteVisible(input({ verificationHydrated: false })),
    ).toBe(false);
  });
});
