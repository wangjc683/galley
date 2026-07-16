import { describe, expect, it } from "vitest";

import {
  applyProgressEvent,
  downloadPercent,
} from "@/lib/app-update";

describe("applyProgressEvent", () => {
  it("maps a downloading event to phase + progress", () => {
    expect(
      applyProgressEvent({
        phase: "downloading",
        downloaded: 42,
        total: 100,
      }),
    ).toEqual({
      phase: "downloading",
      progress: { downloaded: 42, total: 100 },
    });
  });

  it("keeps a null total so the UI can fall back to the spinner", () => {
    expect(
      applyProgressEvent({
        phase: "downloading",
        downloaded: 42,
        total: null,
      }),
    ).toEqual({
      phase: "downloading",
      progress: { downloaded: 42, total: null },
    });
  });

  it("maps an installing event without progress", () => {
    expect(applyProgressEvent({ phase: "installing" })).toEqual({
      phase: "installing",
    });
  });
});

describe("downloadPercent", () => {
  it("returns an integer percent", () => {
    expect(downloadPercent({ downloaded: 42_000, total: 100_000 })).toBe(42);
    expect(downloadPercent({ downloaded: 429, total: 1000 })).toBe(42);
  });

  it("clamps a lying Content-Length to 100", () => {
    expect(downloadPercent({ downloaded: 2_000, total: 1_000 })).toBe(100);
  });

  it("returns null without a usable total", () => {
    expect(downloadPercent(undefined)).toBeNull();
    expect(downloadPercent({ downloaded: 42, total: null })).toBeNull();
    expect(downloadPercent({ downloaded: 42, total: 0 })).toBeNull();
  });
});
