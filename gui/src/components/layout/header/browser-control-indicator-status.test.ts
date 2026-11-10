import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";

import {
  type BrowserControlIndicatorInput,
  browserControlErrorDetail,
  browserControlErrorGroup,
  browserControlErrorRetries,
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

describe("browserControlErrorRetries", () => {
  it("retries every bridge failure", () => {
    for (const kind of [
      "missing_dependency",
      "port_in_use",
      "start_failed",
      "exited",
      "status_failed",
      // Its own sentence said 正在重试; it is no longer shown (A8).
      "master_unreachable",
    ]) {
      expect(browserControlErrorRetries(kind)).toBe(true);
    }
  });

  it("does not retry probe or folder-sync failures (no kind)", () => {
    expect(browserControlErrorRetries(null)).toBe(false);
    expect(browserControlErrorRetries("")).toBe(false);
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

describe("browserControlErrorDetail", () => {
  const BRIDGE_SENTENCE = "浏览器控制端口 18765 被其他程序占用。";

  it("words the kinds it names in the UI's language, never the bridge's sentence", () => {
    for (const copy of [zhCopy, enCopy]) {
      const details = copy.topbar.browserControlErrorDetails;
      expect(
        browserControlErrorDetail("portInUse", BRIDGE_SENTENCE, copy.topbar),
      ).toBe(details.portInUse);
      expect(
        browserControlErrorDetail(
          "missingDependency",
          BRIDGE_SENTENCE,
          copy.topbar,
        ),
      ).toBe(details.missingDependency);
      // The title and 正在自动重试 say it all.
      for (const group of ["unreachable", "startFailed"] as const) {
        expect(
          browserControlErrorDetail(group, BRIDGE_SENTENCE, copy.topbar),
        ).toBeNull();
      }
    }
  });

  it("falls back to the raw text for a kind it does not know, or none", () => {
    expect(
      browserControlErrorDetail(
        "generic",
        "读取浏览器控制状态失败：x",
        enCopy.topbar,
      ),
    ).toBe("读取浏览器控制状态失败：x");
    expect(
      browserControlErrorDetail("generic", "TypeError: boom", enCopy.topbar),
    ).toBe("TypeError: boom");
    expect(
      browserControlErrorDetail("generic", null, enCopy.topbar),
    ).toBeNull();
  });
});
