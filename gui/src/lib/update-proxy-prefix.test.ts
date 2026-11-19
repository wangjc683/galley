import { describe, expect, it } from "vitest";

import { parseUpdateProxyPrefix } from "@/lib/update-proxy-prefix";

// The same cases as `core/src/app_update.rs`'s prefix tests: Core
// re-checks the saved value with this rule.
describe("parseUpdateProxyPrefix", () => {
  it("treats empty and blank input as off", () => {
    expect(parseUpdateProxyPrefix("")).toEqual({ kind: "empty" });
    expect(parseUpdateProxyPrefix("   ")).toEqual({ kind: "empty" });
  });

  it("rejects anything but an https URL with a host", () => {
    for (const raw of [
      "http://",
      "http://example.com",
      "http://example.com/",
      "example.com",
      "example.com/gh/",
      "https://",
      "ftp://example.com/",
    ]) {
      expect(parseUpdateProxyPrefix(raw), raw).toEqual({ kind: "invalid" });
    }
  });

  it("normalizes a valid prefix to end in exactly one slash", () => {
    for (const [raw, normalized] of [
      ["https://example.com", "https://example.com/"],
      ["https://example.com/", "https://example.com/"],
      ["https://example.com///", "https://example.com/"],
      ["  https://example.com  ", "https://example.com/"],
      ["https://example.com/gh/", "https://example.com/gh/"],
      ["https://example.com/gh", "https://example.com/gh/"],
    ]) {
      expect(parseUpdateProxyPrefix(raw), raw).toEqual({
        kind: "valid",
        normalized,
      });
    }
  });

  it("gives the prefix Core puts in front of the original URL", () => {
    const parsed = parseUpdateProxyPrefix("https://example.com");
    expect(parsed.kind).toBe("valid");
    if (parsed.kind !== "valid") return;
    expect(
      `${parsed.normalized}https://github.com/o/r/releases/download/v1/a.exe`,
    ).toBe(
      "https://example.com/https://github.com/o/r/releases/download/v1/a.exe",
    );
  });
});
