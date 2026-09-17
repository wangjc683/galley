import { describe, expect, it } from "vitest";
import { buildWrittenFileResolver } from "./written-files";
import type { Turn } from "@/types/conversation";

function agentTurn(
  tools: { name: string; path?: string; resolvedPath?: string }[],
): Turn {
  return {
    role: "agent",
    turnIndex: 1,
    finalAnswer: null,
    tools: tools.map((t, i) => ({
      id: `t-${i}`,
      name: t.name,
      status: "success-historical" as const,
      args: t.path ? { path: t.path } : {},
      ...(t.resolvedPath ? { resolvedPath: t.resolvedPath } : {}),
    })),
  };
}

const TEMP =
  "/Users/me/Library/Application Support/app.galley/managed-ga-state/temp";

describe("buildWrittenFileResolver", () => {
  it("resolves a written file by its relative spelling or bare name only", () => {
    const resolve = buildWrittenFileResolver([
      { role: "user", content: "go", turnIndex: 0 } as Turn,
      agentTurn([
        {
          name: "file_write",
          path: "汕尾旅游指南.md",
          resolvedPath: `${TEMP}/汕尾旅游指南.md`,
        },
        {
          name: "file_patch",
          path: "./notes/a.txt",
          resolvedPath: `${TEMP}/notes/a.txt`,
        },
        { name: "file_read", path: "other.md" },
      ]),
    ]);
    expect(resolve("./汕尾旅游指南.md")).toBe(`${TEMP}/汕尾旅游指南.md`);
    expect(resolve("汕尾旅游指南.md")).toBe(`${TEMP}/汕尾旅游指南.md`);
    expect(resolve("notes/a.txt")).toBe(`${TEMP}/notes/a.txt`);
    expect(resolve("a.txt")).toBe(`${TEMP}/notes/a.txt`);
    // Read-only tools and unrelated names never resolve; no fuzzy match.
    expect(resolve("other.md")).toBeNull();
    expect(resolve("旅游指南.md")).toBeNull();
    expect(resolve("temp/汕尾旅游指南.md")).toBeNull();
  });

  it("refuses a name two different files share", () => {
    const resolve = buildWrittenFileResolver([
      agentTurn([
        {
          name: "file_write",
          path: "a/report.md",
          resolvedPath: "/w/a/report.md",
        },
        {
          name: "file_write",
          path: "b/report.md",
          resolvedPath: "/w/b/report.md",
        },
      ]),
    ]);
    expect(resolve("report.md")).toBeNull();
    expect(resolve("a/report.md")).toBe("/w/a/report.md");
    expect(resolve("b/report.md")).toBe("/w/b/report.md");
  });

  it("is inert for sessions that wrote nothing", () => {
    expect(
      buildWrittenFileResolver([agentTurn([{ name: "file_read", path: "x" }])])(
        "x",
      ),
    ).toBeNull();
  });
});
