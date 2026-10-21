import { describe, expect, it } from "vitest";
import {
  documentReference,
  isDelimitedPath,
  isOpenableDocument,
  isOpenableWithDefaultApp,
  localFilePath,
  previewKindByPath,
  referenceClick,
} from "./local-file-path";

describe("preview kind by name", () => {
  it("classifies markdown, images, code and data as previewable and leaves opaque files to the OS", () => {
    expect(previewKindByPath("/tmp/report.MD")).toBe("markdown");
    expect(previewKindByPath("C:\\out\\chart.PNG")).toBe("image");
    for (const path of [
      "/tmp/analysis.py",
      "/tmp/data.csv",
      "/tmp/config.yaml",
      "/tmp/run.log",
      "/tmp/Makefile",
      "/tmp/.gitignore",
      "\\\\server\\share\\notes.txt",
    ])
      expect(previewKindByPath(path), path).toBe("text");
    for (const path of ["/tmp/deck.pptx", "/tmp/archive.zip", "/tmp/blob", "/tmp/a.docx"])
      expect(previewKindByPath(path), path).toBeNull();
  });
  it("only offers the default application for documents, never scripts", () => {
    for (const path of ["/tmp/report.md", "/tmp/chart.png", "/tmp/data.csv", "/tmp/out.json"])
      expect(isOpenableWithDefaultApp(path), path).toBe(true);
    for (const path of ["/tmp/run.sh", "/tmp/tool.py", "/tmp/job.bat", "/tmp/task.ps1", "/tmp/Makefile"])
      expect(isOpenableWithDefaultApp(path), path).toBe(false);
  });
  it("opens the same documents Core does, letter for letter (tickets 73, 74)", () => {
    // Core's is_openable document list (core/src/local_file.rs).
    for (const ext of [
      "pdf",
      "docx",
      "xlsx",
      "pptx",
      "pages",
      "numbers",
      "html",
      "htm",
    ]) {
      expect(isOpenableWithDefaultApp(`/tmp/a.${ext}`), ext).toBe(true);
      expect(isOpenableDocument(`/tmp/a.${ext.toUpperCase()}`), ext).toBe(true);
    }
    // Left out on purpose: legacy and macro-enabled Office, Keynote.
    for (const ext of ["doc", "xls", "ppt", "docm", "xlsm", "pptm", "key"]) {
      expect(isOpenableWithDefaultApp(`/tmp/a.${ext}`), ext).toBe(false);
      expect(isOpenableDocument(`/tmp/a.${ext}`), ext).toBe(false);
    }
    // Markdown, images and text open in the default app but are not
    // the documents a card hands to it.
    for (const path of ["/tmp/a.md", "/tmp/a.png", "/tmp/a.txt"])
      expect(isOpenableDocument(path), path).toBe(false);
  });
  it("routes a click on a reference in the text: the panel, the default app, or the panel's judgment", () => {
    expect(referenceClick("/tmp/a.md")).toBe("preview");
    expect(referenceClick("/tmp/a.png")).toBe("preview");
    // HTML stays source in the reading panel (the workbench writes code).
    expect(referenceClick("/tmp/page.html")).toBe("preview");
    expect(referenceClick("/tmp/report.pdf")).toBe("open");
    expect(referenceClick("/tmp/deck.pptx")).toBe("open");
    expect(referenceClick("/tmp/archive.zip")).toBe("locate");
    expect(referenceClick("/tmp/old.doc")).toBe("locate");
    // Core may still sniff an extension-less file as text.
    expect(referenceClick("/tmp/blob")).toBe("locate");
  });
  it("knows which data files may render as a table", () => {
    expect(isDelimitedPath("/tmp/a.csv")).toBe(",");
    expect(isDelimitedPath("/tmp/a.TSV")).toBe("\t");
    expect(isDelimitedPath("/tmp/a.txt")).toBeNull();
  });
});

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
