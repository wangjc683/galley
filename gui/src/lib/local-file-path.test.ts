import { describe, expect, it } from "vitest";
import { documentReference, localFilePath } from "./local-file-path";

describe("local file references", () => {
  it("recognizes native full paths without decoding literal filename characters", () => {
    for (const path of [
      "/Users/我/报告 with spaces.md",
      "C:\\输出\\报告.MD",
      "\\\\server\\share\\report.md",
      "~/notes.md",
      "/tmp/100%20done.md",
    ]) {
      expect(localFilePath(path)).toBe(path);
    }
    expect(localFilePath("/tmp/a%20b.md", true)).toBe("/tmp/a b.md");
    expect(localFilePath("/tmp/a.md#summary", true)).toBe("/tmp/a.md");
    expect(localFilePath("/tmp/a%23b.md", true)).toBe("/tmp/a#b.md");
    expect(localFilePath("file:///C:/%E6%8A%A5%E5%91%8A.md")).toBe(
      "C:/报告.md",
    );
    expect(localFilePath("file://server/share/a.md")).toBe(
      "\\\\server\\share\\a.md",
    );
  });
  it("leaves ambiguous and nonlocal references inactive", () => {
    for (const path of [
      "report.md",
      "output/report.md",
      "../report.md",
      "C:report.md",
      "//example.com/a",
      "https://example.com/a",
      "javascript:alert(1)",
      "file:///tmp/%00.md",
      "/tmp/a\n.md",
    ])
      expect(localFilePath(path)).toBeNull();
  });
  it("resolves document assets from the file directory, including Windows and special names", () => {
    expect(
      localFilePath(
        documentReference("../images/chart%201.png", "/tmp/reports/a.md"),
      ),
    ).toBe("/tmp/images/chart 1.png");
    expect(
      localFilePath(documentReference("./图.png", "C:\\work\\报告.md")),
    ).toBe("C:/work/图.png");
    expect(
      localFilePath(documentReference("./x.png", "/tmp/100% #?/a.md")),
    ).toBe("/tmp/100% #?/x.png");
    expect(
      localFilePath(documentReference("./x.png", "\\\\server\\share\\a.md")),
    ).toBe("\\\\server\\share\\x.png");
    expect(documentReference("output/a.md", null)).toBe("output/a.md");
    expect(documentReference("https://example.com/a.png", "/tmp/a.md")).toBe(
      "https://example.com/a.png",
    );
    expect(documentReference("#summary", "/tmp/a.md")).toBe("#summary");
  });
});
