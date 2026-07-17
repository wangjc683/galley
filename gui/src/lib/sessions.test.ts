import { describe, expect, it } from "vitest";

import {
  backfillRecentSessions,
  deriveSessionStatus,
  groupSessions,
  RECENT_BACKFILL_COUNT,
  toDurableStatus,
} from "@/lib/sessions";
import type { Session } from "@/types/session";

describe("toDurableStatus", () => {
  it("passes through the durable lifecycle states", () => {
    expect(toDurableStatus("idle")).toBe("idle");
    expect(toDurableStatus("completed")).toBe("completed");
    expect(toDurableStatus("cancelled")).toBe("cancelled");
    expect(toDurableStatus("archived")).toBe("archived");
  });

  it("collapses stale runtime states to idle", () => {
    // Core's persisted column can carry a stale runtime value from a
    // session that was live when the app died; on load nothing runs.
    expect(toDurableStatus("running")).toBe("idle");
    expect(toDurableStatus("connecting")).toBe("idle");
    expect(toDurableStatus("waiting_approval")).toBe("idle");
    expect(toDurableStatus("error")).toBe("idle");
  });
});

describe("deriveSessionStatus", () => {
  const idle = { status: "idle" } as const;

  it("terminal durable states always win over live state", () => {
    for (const status of ["archived", "completed", "cancelled"] as const) {
      expect(
        deriveSessionStatus(
          { status },
          { agentRunning: true, pendingApprovalCount: 3 },
          "spawning",
        ),
      ).toBe(status);
    }
  });

  it("falls back to the durable row status when no slice is loaded", () => {
    expect(deriveSessionStatus(idle, undefined)).toBe("idle");
    expect(deriveSessionStatus(idle, undefined, "spawning")).toBe("idle");
  });

  it("ranks pending approval above running", () => {
    expect(
      deriveSessionStatus(idle, { agentRunning: true, pendingApprovalCount: 1 }),
    ).toBe("waiting_approval");
  });

  it("reports running when the agent is active and nothing is pending", () => {
    expect(
      deriveSessionStatus(idle, { agentRunning: true, pendingApprovalCount: 0 }),
    ).toBe("running");
  });

  it("overlays bridge status when the agent is idle", () => {
    const quiet = { agentRunning: false, pendingApprovalCount: 0 };
    expect(deriveSessionStatus(idle, quiet, "spawning")).toBe("connecting");
    expect(deriveSessionStatus(idle, quiet, "error")).toBe("error");
    expect(deriveSessionStatus(idle, quiet, "connected")).toBe("idle");
    expect(deriveSessionStatus(idle, quiet)).toBe("idle");
  });
});

describe("backfillRecentSessions", () => {
  const NOW = new Date("2026-07-17T12:00:00");

  const session = (id: string, daysAgo: number, pinned = false): Session =>
    ({
      id,
      title: id,
      status: "idle",
      errorCount: 0,
      pinned,
      lastActivityAt: new Date(
        NOW.getTime() - daysAgo * 24 * 3600 * 1000,
      ).toISOString(),
    }) as Session;

  it("promotes the most recent old sessions when the active window is empty", () => {
    const old = [10, 12, 20, 30, 40, 50, 60].map((d, i) =>
      session(`s${i}`, d),
    );
    const buckets = backfillRecentSessions(groupSessions(old, NOW));
    expect(buckets.recent.map((s) => s.id)).toEqual([
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
    ]);
    // Promoted rows leave `earlier` so the "更早 N" count and the
    // EarlierDialog list match what's inlined.
    expect(buckets.earlier.map((s) => s.id)).toEqual(["s5", "s6"]);
    expect(buckets.recent).toHaveLength(RECENT_BACKFILL_COUNT);
  });

  it("promotes everything when there are fewer old sessions than the cap", () => {
    const buckets = backfillRecentSessions(
      groupSessions([session("a", 10), session("b", 20)], NOW),
    );
    expect(buckets.recent.map((s) => s.id)).toEqual(["a", "b"]);
    expect(buckets.earlier).toEqual([]);
  });

  it("does nothing when a session is active this week", () => {
    const grouped = groupSessions([session("new", 2), session("old", 30)], NOW);
    expect(backfillRecentSessions(grouped)).toBe(grouped);
  });

  it("does nothing when a pinned session keeps the sidebar populated", () => {
    const grouped = groupSessions(
      [session("pin", 90, true), session("old", 30)],
      NOW,
    );
    expect(backfillRecentSessions(grouped)).toBe(grouped);
  });

  it("does nothing when there are no sessions at all", () => {
    const grouped = groupSessions([], NOW);
    expect(backfillRecentSessions(grouped)).toBe(grouped);
  });
});
