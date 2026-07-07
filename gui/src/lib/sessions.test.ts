import { describe, expect, it } from "vitest";

import { deriveSessionStatus, toDurableStatus } from "@/lib/sessions";

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
