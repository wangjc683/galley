import { describe, expect, it } from "vitest";

import type { AppUpdateStatus } from "@/stores/app-update";

import {
  type TopBarUpdateStatus,
  updateBadgeKind,
  updateIndicatorVisible,
  updatePopoverBody,
} from "./update-indicator-status";

const AVAILABLE: TopBarUpdateStatus = {
  kind: "available",
  currentVersion: "0.5.6",
  version: "0.6.0",
  body: null,
  date: null,
};

const READY: TopBarUpdateStatus = {
  kind: "ready",
  currentVersion: "0.5.6",
  version: "0.6.0",
};

describe("updateIndicatorVisible", () => {
  it("shows only while a new version exists, never for an error", () => {
    const hidden: AppUpdateStatus[] = [
      { kind: "idle" },
      { kind: "checking" },
      { kind: "unconfigured", currentVersion: "0.5.6" },
      { kind: "upToDate", currentVersion: "0.5.6" },
      {
        kind: "error",
        message: "m",
        detail: "d",
        manualDownloadUrl: "https://example.test",
      },
    ];
    for (const status of hidden) {
      expect(updateIndicatorVisible(status)).toBe(false);
    }
    expect(updateIndicatorVisible(AVAILABLE)).toBe(true);
    expect(updateIndicatorVisible({ kind: "downloading" })).toBe(true);
    expect(updateIndicatorVisible(READY)).toBe(true);
  });
});

describe("updateBadgeKind", () => {
  it("splits the in-flight state by phase", () => {
    expect(updateBadgeKind(AVAILABLE)).toBe("available");
    expect(updateBadgeKind({ kind: "downloading" })).toBe("downloading");
    expect(updateBadgeKind({ kind: "downloading", phase: "downloading" })).toBe(
      "downloading",
    );
    expect(
      updateBadgeKind({
        kind: "downloading",
        version: "0.6.0",
        phase: "installing",
      }),
    ).toBe("installing");
    expect(updateBadgeKind(READY)).toBe("ready");
  });
});

describe("updatePopoverBody", () => {
  it("offers the download whether or not a task runs", () => {
    expect(updatePopoverBody(AVAILABLE, false)).toEqual({ kind: "download" });
    expect(updatePopoverBody(AVAILABLE, true)).toEqual({ kind: "download" });
  });

  it("draws a bar only with real byte progress", () => {
    expect(
      updatePopoverBody(
        {
          kind: "downloading",
          phase: "downloading",
          progress: { downloaded: 42, total: 100 },
        },
        false,
      ),
    ).toEqual({ kind: "progress", percent: 42 });
    expect(
      updatePopoverBody(
        {
          kind: "downloading",
          phase: "downloading",
          progress: { downloaded: 42, total: null },
        },
        false,
      ),
    ).toEqual({ kind: "spinner", installing: false });
    expect(updatePopoverBody({ kind: "downloading" }, false)).toEqual({
      kind: "spinner",
      installing: false,
    });
  });

  it("spins with its own words while installing", () => {
    expect(
      updatePopoverBody(
        {
          kind: "downloading",
          phase: "installing",
          progress: { downloaded: 100, total: 100 },
        },
        false,
      ),
    ).toEqual({ kind: "spinner", installing: true });
  });

  it("holds the restart while a task runs", () => {
    expect(updatePopoverBody(READY, false)).toEqual({
      kind: "restart",
      waitForTasks: false,
    });
    expect(updatePopoverBody(READY, true)).toEqual({
      kind: "restart",
      waitForTasks: true,
    });
  });
});
