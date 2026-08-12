import { describe, expect, it } from "vitest";

import { settledToolStatus, toolErrorDisplay } from "./tool-outcome";

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

  it("classifies GA's error envelope as failed-historical (#22)", () => {
    expect(
      settledToolStatus('{"status": "error", "stdout": "boom", "exit_code": 1}'),
    ).toBe("failed-historical");
    expect(settledToolStatus('{"status": "error", "msg": "file not found"}')).toBe(
      "failed-historical",
    );
    // `status: "success"` envelopes and prose stay success.
    expect(settledToolStatus('{"status": "success", "stdout": "ok"}')).toBe(
      "success-historical",
    );
  });
});

// #22 sample 1 (redacted): GA's code_run error envelope as it actually
// reaches turn_end.toolResults[].content — a JSON string whose stdout
// holds a banner line + CRLF-separated traceback frames with the
// exception line at the very end.
const TRACEBACK_STDOUT =
  "# banner line printed by the sandbox preamble\r\n" +
  "Traceback (most recent call last):\r\n" +
  '  File "C:\\Users\\<USER>\\AppData\\Roaming\\app.galley\\managed-ga-state\\temp\\tmp8gr34dt6.ai.py", line 45, in <module>\r\n' +
  "    d=json.loads(r2.stdout)\r\n" +
  "      ^^^^^^^^^^^^^^^^^^^^^\r\n" +
  "JSONDecodeError: Expecting value: line 1 column 1 (char 0)\r\n";
const ERROR_ENVELOPE = JSON.stringify({
  status: "error",
  stdout: TRACEBACK_STDOUT,
  exit_code: 1,
});

describe("toolErrorDisplay", () => {
  it("headline is the traceback's last line; detail has real newlines", () => {
    const display = toolErrorDisplay(ERROR_ENVELOPE);
    expect(display).not.toBeNull();
    expect(display?.headline).toBe(
      "JSONDecodeError: Expecting value: line 1 column 1 (char 0)",
    );
    // JSON.parse decoded the in-band escapes: real newlines, single
    // backslashes, no literal "\r\n" text.
    expect(display?.detail).toContain(
      "Traceback (most recent call last):\n",
    );
    expect(display?.detail).toContain("C:\\Users\\<USER>");
    expect(display?.detail).not.toContain("\\r\\n");
  });

  it("msg-shaped envelopes use msg's first line as the headline", () => {
    const display = toolErrorDisplay(
      '{"status": "error", "msg": "file not found\\nsecond line"}',
    );
    expect(display?.headline).toBe("file not found");
    expect(display?.detail).toBe("file not found\nsecond line");
  });

  it("stdout without a traceback gets no headline (no guessing)", () => {
    const display = toolErrorDisplay(
      '{"status": "error", "stdout": "npm ERR! something", "exit_code": 1}',
    );
    expect(display?.headline).toBeUndefined();
    expect(display?.detail).toBe("npm ERR! something");
  });

  it("tail-caps long bodies — the exception end survives, not the head", () => {
    const longEnvelope = JSON.stringify({
      status: "error",
      stdout: `${"x".repeat(10000)}\nValueError: tail wins`,
      exit_code: 1,
    });
    const display = toolErrorDisplay(longEnvelope);
    expect(display?.detail.startsWith("… ")).toBe(true);
    expect(display?.detail.endsWith("ValueError: tail wins")).toBe(true);
    expect(display?.detail.length).toBeLessThanOrEqual(4010);
  });

  it("returns null for anything that is not the error envelope", () => {
    expect(toolErrorDisplay("[FILE] 268 lines...")).toBeNull();
    expect(toolErrorDisplay(DENIED_CONTENT)).toBeNull();
    expect(toolErrorDisplay('{"status": "success", "stdout": "ok"}')).toBeNull();
    expect(toolErrorDisplay(undefined)).toBeNull();
  });
});
