import { describe, expect, it } from "vitest";

import { aggregateChannelsState } from "@/lib/im-supervisor";

describe("aggregateChannelsState", () => {
  it("returns null when no channel reports a state", () => {
    expect(aggregateChannelsState([])).toBeNull();
    expect(aggregateChannelsState([null, undefined])).toBeNull();
  });

  it("ignores nullish channels and returns the lone present state", () => {
    expect(aggregateChannelsState([null, "running", undefined])).toBe("running");
  });

  it("prioritises error/expired above every other state", () => {
    expect(aggregateChannelsState(["running", "expired"])).toBe("error");
    expect(aggregateChannelsState(["waiting_scan", "error"])).toBe("error");
  });

  it("surfaces a pending scan above transitional and running states", () => {
    expect(
      aggregateChannelsState(["running", "waiting_scan", "starting"]),
    ).toBe("waiting_scan");
  });

  it("collapses starting/reconnecting to `starting`", () => {
    expect(aggregateChannelsState(["stopped", "reconnecting"])).toBe("starting");
    expect(aggregateChannelsState(["running", "starting"])).toBe("starting");
  });

  it("prefers running over stopped", () => {
    expect(aggregateChannelsState(["stopped", "running"])).toBe("running");
  });

  it("falls back to the first present state for same-tier inputs", () => {
    expect(aggregateChannelsState(["stopped"])).toBe("stopped");
  });

  it("keeps the same severity order across all four channels", () => {
    // WeChat / Feishu / Telegram / Discord — the arity the callers feed in.
    expect(
      aggregateChannelsState(["running", "stopped", null, "error"]),
    ).toBe("error");
    expect(
      aggregateChannelsState([null, "stopped", "running", "starting"]),
    ).toBe("starting");
    expect(
      aggregateChannelsState(["stopped", null, undefined, "running"]),
    ).toBe("running");
  });
});
