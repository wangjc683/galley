import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";

import {
  type BrowserControlViewInput,
  browserControlErrorSource,
  browserControlErrorTitle,
  browserControlMaintenance,
  browserControlSetupLine,
  browserControlStatusCard,
  browserControlVerifiedView,
} from "./browser-control-view";

function input(
  patch: Partial<BrowserControlViewInput> = {},
): BrowserControlViewInput {
  return {
    status: "unknown",
    verified: false,
    verificationHydrated: true,
    bridge: null,
    layoutError: null,
    testOutcome: null,
    error: null,
    probing: false,
    ...patch,
  };
}

const runningBridge = { state: "running" as const, errorKind: null };

describe("browserControlVerifiedView", () => {
  it("follows the persisted flag once it is read", () => {
    expect(browserControlVerifiedView(input({ verified: true }))).toBe(true);
    expect(
      browserControlVerifiedView(input({ verified: true, status: "error" })),
    ).toBe(true);
    expect(
      browserControlVerifiedView(
        input({ verified: false, status: "connected" }),
      ),
    ).toBe(false);
  });

  it("before the flag is read, trusts only statuses a verified install has", () => {
    const unread = { verificationHydrated: false };
    for (const status of [
      "connected",
      "connected_no_tabs",
      "offline",
    ] as const) {
      expect(browserControlVerifiedView(input({ ...unread, status }))).toBe(
        true,
      );
    }
    for (const status of ["unknown", "not_connected", "error"] as const) {
      expect(browserControlVerifiedView(input({ ...unread, status }))).toBe(
        false,
      );
    }
  });
});

describe("browserControlErrorSource", () => {
  it("lets a bridge error win, with the topbar's retry rule", () => {
    expect(
      browserControlErrorSource(
        input({
          bridge: { state: "error", errorKind: "port_in_use" },
          layoutError: "copy failed",
          testOutcome: { kind: "script_failed", detail: "x" },
          error: "端口 18765 被占用",
        }),
      ),
    ).toEqual({
      source: "bridge",
      group: "portInUse",
      detail: "端口 18765 被占用",
      retrying: true,
    });
    expect(
      browserControlErrorSource(
        input({
          bridge: { state: "error", errorKind: "master_unreachable" },
          error: "连接中断，正在重试",
        }),
      ),
    ).toMatchObject({ group: "unreachable", retrying: false });
    expect(
      browserControlErrorSource(
        input({ bridge: { state: "error", errorKind: null } }),
      ),
    ).toEqual({
      source: "bridge",
      group: "generic",
      detail: null,
      retrying: false,
    });
  });

  it("falls back to the folder sync, then the probe", () => {
    expect(
      browserControlErrorSource(
        input({
          bridge: runningBridge,
          layoutError: "EACCES",
          error: "EACCES",
        }),
      ),
    ).toEqual({ source: "layout", detail: "EACCES" });
    expect(
      browserControlErrorSource(
        input({
          bridge: runningBridge,
          testOutcome: { kind: "script_failed", detail: "TypeError" },
          error: "TypeError",
        }),
      ),
    ).toEqual({ source: "probe", kind: "script_failed", detail: "TypeError" });
    expect(
      browserControlErrorSource(
        input({ testOutcome: { kind: "no_result", detail: null } }),
      ),
    ).toEqual({ source: "probe", kind: "no_result", detail: null });
  });

  it("reads a probe failure without a known kind as an exception", () => {
    expect(browserControlErrorSource(input({ error: "boom" }))).toEqual({
      source: "probe",
      kind: "exception",
      detail: "boom",
    });
    expect(
      browserControlErrorSource(
        input({ testOutcome: { kind: "exception", detail: "invoke failed" } }),
      ),
    ).toEqual({ source: "probe", kind: "exception", detail: "invoke failed" });
  });
});

describe("browserControlStatusCard", () => {
  it("maps live statuses to the verified card", () => {
    expect(browserControlStatusCard(input({ status: "connected" }))).toEqual({
      kind: "connected",
      testPassed: false,
    });
    expect(
      browserControlStatusCard(input({ status: "connected_no_tabs" })),
    ).toEqual({ kind: "noTabs" });
    expect(browserControlStatusCard(input({ status: "offline" }))).toEqual({
      kind: "offline",
    });
    // A verified install the bridge reports as not connected.
    expect(
      browserControlStatusCard(input({ status: "not_connected" })),
    ).toEqual({ kind: "offline" });
    expect(browserControlStatusCard(input({ status: "unknown" }))).toEqual({
      kind: "connecting",
    });
  });

  it("adds 测试通过 only after a passing test", () => {
    expect(
      browserControlStatusCard(
        input({
          status: "connected",
          testOutcome: { kind: "connected", detail: null },
        }),
      ),
    ).toEqual({ kind: "connected", testPassed: true });
  });

  it("carries the error's source", () => {
    expect(
      browserControlStatusCard(
        input({
          status: "error",
          bridge: { state: "error", errorKind: "missing_dependency" },
        }),
      ),
    ).toEqual({
      kind: "error",
      error: {
        source: "bridge",
        group: "missingDependency",
        detail: null,
        retrying: true,
      },
    });
  });
});

describe("browserControlMaintenance", () => {
  it("offers the test while connected or after a failed probe, the demo only while connected", () => {
    expect(
      browserControlMaintenance({ kind: "connected", testPassed: false }),
    ).toEqual({ test: true, demo: true });
    expect(
      browserControlMaintenance({
        kind: "error",
        error: { source: "probe", kind: "script_failed", detail: null },
      }),
    ).toEqual({ test: true, demo: false });
  });

  it("stays empty where a test cannot tell anything new", () => {
    for (const card of [
      { kind: "noTabs" },
      { kind: "offline" },
      { kind: "connecting" },
      {
        kind: "error",
        error: {
          source: "bridge",
          group: "portInUse",
          detail: null,
          retrying: true,
        },
      },
      { kind: "error", error: { source: "layout", detail: "EACCES" } },
    ] as const) {
      expect(browserControlMaintenance(card)).toEqual({
        test: false,
        demo: false,
      });
    }
  });
});

describe("browserControlSetupLine", () => {
  it("stays empty while a test runs (the button spins)", () => {
    expect(
      browserControlSetupLine(
        input({
          probing: true,
          status: "error",
          testOutcome: { kind: "script_failed", detail: null },
        }),
      ),
    ).toBeNull();
  });

  it("then the test's outcome", () => {
    expect(
      browserControlSetupLine(
        input({
          status: "not_connected",
          bridge: runningBridge,
          testOutcome: { kind: "not_connected", detail: null },
        }),
      ),
    ).toEqual({ kind: "notConnected" });
    expect(
      browserControlSetupLine(
        input({ testOutcome: { kind: "no_tabs", detail: null } }),
      ),
    ).toEqual({ kind: "passed" });
    expect(
      browserControlSetupLine(
        input({
          status: "error",
          bridge: runningBridge,
          testOutcome: { kind: "no_result", detail: "stderr tail" },
          error: "stderr tail",
        }),
      ),
    ).toEqual({
      kind: "error",
      error: { source: "probe", kind: "no_result", detail: "stderr tail" },
    });
  });

  it("then the live status", () => {
    expect(browserControlSetupLine(input({ status: "not_connected" }))).toEqual(
      { kind: "notConnected" },
    );
    expect(browserControlSetupLine(input({ status: "unknown" }))).toEqual({
      kind: "connecting",
    });
    expect(
      browserControlSetupLine(
        input({
          status: "error",
          bridge: { state: "error", errorKind: "exited" },
          error: "bridge exited",
        }),
      ),
    ).toEqual({
      kind: "error",
      error: {
        source: "bridge",
        group: "startFailed",
        detail: "bridge exited",
        retrying: true,
      },
    });
    // Live but not yet verified (a failed automatic verification whose
    // outcome a later status change cleared): said, not left blank.
    expect(browserControlSetupLine(input({ status: "connected" }))).toEqual({
      kind: "connected",
    });
    expect(
      browserControlSetupLine(input({ status: "connected_no_tabs" })),
    ).toEqual({ kind: "noTabs" });
  });
});

describe("browserControlErrorTitle", () => {
  it("words each source in both languages", () => {
    for (const copy of [zhCopy, enCopy]) {
      expect(
        browserControlErrorTitle(
          {
            source: "bridge",
            group: "portInUse",
            detail: null,
            retrying: true,
          },
          copy,
        ),
      ).toBe(copy.topbar.browserControlErrors.portInUse.title);
      expect(
        browserControlErrorTitle(
          { source: "bridge", group: "generic", detail: null, retrying: false },
          copy,
        ),
      ).toBe(copy.topbar.browserControlErrorTitle);
      expect(
        browserControlErrorTitle({ source: "layout", detail: "x" }, copy),
      ).toBe(copy.browserControl.stepPrepareFailed);
      expect(
        browserControlErrorTitle(
          { source: "probe", kind: "script_failed", detail: null },
          copy,
        ),
      ).toBe(copy.browserControl.testScriptFailed);
      expect(
        browserControlErrorTitle(
          { source: "probe", kind: "no_result", detail: null },
          copy,
        ),
      ).toBe(copy.browserControl.testNoResult);
      expect(
        browserControlErrorTitle(
          { source: "probe", kind: "exception", detail: null },
          copy,
        ),
      ).toBe(copy.browserControl.testException);
    }
  });
});
