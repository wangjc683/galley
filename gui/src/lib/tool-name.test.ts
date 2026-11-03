import { describe, expect, it } from "vitest";

import { canonicalToolName } from "@/lib/tool-name";

describe("the tool a call ran as", () => {
  it("is code_run for Bash and PowerShell, which GA runs as code_run", () => {
    expect(canonicalToolName("Bash")).toBe("code_run");
    expect(canonicalToolName("PowerShell")).toBe("code_run");
  });

  it("is the name itself for every other tool", () => {
    for (const name of [
      "code_run",
      "file_read",
      "web_scan",
      "no_tool",
      "something_new",
      // GA matches the two names exactly (agent_loop.py:19).
      "bash",
      "powershell",
    ]) {
      expect(canonicalToolName(name), name).toBe(name);
    }
  });
});
