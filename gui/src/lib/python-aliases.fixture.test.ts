import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { resolvePythonPath } from "./bridge";

// Shared fixture with Core: `session_runner::resolve_user_python` (Rust)
// and this resolver must turn every configured `ga_config.python` value
// into the same interpreter. cargo test asserts the same file
// (core/src/session_runner/spawn_config.rs). macOS / Linux table — the
// test environment is not Windows.

const FIXTURE_HOME = "/Users/fixture";

// vi.mock is hoisted above the const — keep the factory self-contained.
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: async () => "/Users/fixture",
  join: async (...parts: string[]) => parts.join("/"),
  resourceDir: async () => "/resources",
}));

interface AliasCase {
  input: string;
  expected: string;
}

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../core/tests/fixtures/python-aliases.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { home: string; cases: AliasCase[] };

describe("python alias table (shared fixture with Core)", () => {
  it("uses the fixture's home", () => {
    expect(fixture.home).toBe(FIXTURE_HOME);
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  it.each(fixture.cases)("resolves $input", async ({ input, expected }) => {
    const want = expected
      .replace("$HOME", fixture.home)
      .replace("$FALLBACK", "python3");
    expect(await resolvePythonPath(input, false)).toBe(want);
  });
});
