import { describe, expect, it } from "vitest";

import { isSideQuestion } from "./side-question";

describe("isSideQuestion", () => {
  // The accepted forms mirror the bridge predicate in
  // runner/workbench_bridge.py (lstrip; exact, space, tab) — these
  // cases are the lockstep tripwire for both sides.
  it("accepts the bridge's three forms", () => {
    expect(isSideQuestion("/btw")).toBe(true);
    expect(isSideQuestion("/btw what changed?")).toBe(true);
    expect(isSideQuestion("/btw\ttabbed question")).toBe(true);
  });

  it("ignores leading whitespace, like the bridge's lstrip", () => {
    expect(isSideQuestion("  /btw question")).toBe(true);
    expect(isSideQuestion("\n/btw")).toBe(true);
  });

  it("rejects what the bridge would route as a main-agent turn", () => {
    // A newline directly after the prefix is NOT a side question on the
    // bridge side either — matching it here would strand the draft.
    expect(isSideQuestion("/btw\nquestion")).toBe(false);
    expect(isSideQuestion("/btwquestion")).toBe(false);
    expect(isSideQuestion("btw question")).toBe(false);
    expect(isSideQuestion("say /btw literally")).toBe(false);
    expect(isSideQuestion("")).toBe(false);
  });
});
