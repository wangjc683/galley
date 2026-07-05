import { describe, expect, it } from "vitest";

import { settledToolStatus } from "./tool-outcome";

// The denial payload written by runner/handlers.py (coupling point —
// see tool-outcome.ts). Serialized exactly the way GA's agent loop
// does: json.dumps of the StepOutcome data dict.
const DENIED_CONTENT = JSON.stringify({
  status: "denied",
  msg: "User denied this tool call",
});

describe("settledToolStatus", () => {
  it("detects the handler's denial payload (string form)", () => {
    expect(settledToolStatus(DENIED_CONTENT)).toBe("denied");
    expect(settledToolStatus(`  ${DENIED_CONTENT}\n`)).toBe("denied");
  });

  it("detects the denial payload when already parsed to an object", () => {
    expect(
      settledToolStatus({ status: "denied", msg: "User denied this tool call" }),
    ).toBe("denied");
  });

  it("treats ordinary tool output as success", () => {
    expect(settledToolStatus("[FILE] 268 lines...")).toBe("success-historical");
    expect(settledToolStatus("")).toBe("success-historical");
    expect(settledToolStatus(undefined)).toBe("success-historical");
    expect(settledToolStatus(null)).toBe("success-historical");
  });

  it("does not trip on JSON output that merely mentions a status", () => {
    // Real tool results can be arbitrary JSON — only the exact
    // status value "denied" may flip the transcript state.
    expect(settledToolStatus('{"status": "ok"}')).toBe("success-historical");
    expect(settledToolStatus('{"denied": true}')).toBe("success-historical");
    expect(settledToolStatus('{"status": ["denied"]}')).toBe(
      "success-historical",
    );
  });

  it("survives malformed JSON-looking content", () => {
    expect(settledToolStatus('{"status": "denied"')).toBe(
      "success-historical",
    );
    expect(settledToolStatus("{not json}")).toBe("success-historical");
  });
});
