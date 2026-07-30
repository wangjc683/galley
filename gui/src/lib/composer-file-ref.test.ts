import { describe, expect, it } from "vitest";

import {
  expandFileRefPlaceholders,
  fileRefPlaceholder,
  insertFileRefPlaceholders,
  quotePathForMessage,
  type FileRefEntry,
} from "@/lib/composer-file-ref";

function registryOf(
  ...entries: Array<[number, FileRefEntry]>
): Map<number, FileRefEntry> {
  return new Map(entries);
}

describe("fileRefPlaceholder", () => {
  it("formats file and folder labels with the counter", () => {
    expect(fileRefPlaceholder("file", 1, "report.pdf")).toBe(
      "[File #1: report.pdf]",
    );
    expect(fileRefPlaceholder("folder", 3, "src")).toBe("[Folder #3: src]");
  });

  it("strips brackets from the display name to keep the grammar intact", () => {
    expect(fileRefPlaceholder("file", 1, "weird[1].txt")).toBe(
      "[File #1: weird1.txt]",
    );
  });
});

describe("quotePathForMessage", () => {
  it("quotes only when the path contains whitespace", () => {
    expect(quotePathForMessage("/a/b.txt")).toBe("/a/b.txt");
    expect(quotePathForMessage("/a/年度 报告.pdf")).toBe('"/a/年度 报告.pdf"');
    expect(quotePathForMessage("C:\\Users\\jc\\notes.txt")).toBe(
      "C:\\Users\\jc\\notes.txt",
    );
  });
});

describe("insertFileRefPlaceholders", () => {
  it("pads both sides when spliced between words", () => {
    const { next, caret } = insertFileRefPlaceholders({
      text: "看看这个然后总结",
      start: 4,
      end: 4,
      placeholders: ["[File #1: a.txt]"],
    });
    expect(next).toBe("看看这个 [File #1: a.txt] 然后总结");
    expect(next.slice(caret)).toBe("然后总结");
  });

  it("skips the lead pad at the start and after whitespace", () => {
    expect(
      insertFileRefPlaceholders({
        text: "",
        start: 0,
        end: 0,
        placeholders: ["[File #1: a.txt]"],
      }).next,
    ).toBe("[File #1: a.txt] ");
    expect(
      insertFileRefPlaceholders({
        text: "看看 ",
        start: 3,
        end: 3,
        placeholders: ["[File #1: a.txt]"],
      }).next,
    ).toBe("看看 [File #1: a.txt] ");
  });

  it("replaces a selection and joins multiple placeholders with spaces", () => {
    const { next } = insertFileRefPlaceholders({
      text: "把 XXX 读一遍",
      start: 2,
      end: 5,
      placeholders: ["[File #1: a.txt]", "[Folder #2: src]"],
    });
    expect(next).toBe("把 [File #1: a.txt] [Folder #2: src] 读一遍");
  });
});

describe("expandFileRefPlaceholders", () => {
  const reg = registryOf(
    [1, { placeholder: "[File #1: a.txt]", path: "/u/a.txt" }],
    [2, { placeholder: "[Folder #2: my docs]", path: "/u/my docs" }],
  );

  it("expands intact placeholders to quoted absolute paths", () => {
    expect(
      expandFileRefPlaceholders("读一下 [File #1: a.txt] 和 [Folder #2: my docs]", reg),
    ).toBe('读一下 /u/a.txt 和 "/u/my docs"');
  });

  it("keeps the /btw prefix untouched", () => {
    expect(expandFileRefPlaceholders("/btw 看 [File #1: a.txt]", reg)).toBe(
      "/btw 看 /u/a.txt",
    );
  });

  it("leaves user-edited placeholders alone (manual edits trump expansion)", () => {
    // Still placeholder-shaped, but no longer the registered string.
    expect(expandFileRefPlaceholders("[File #1: renamed.txt]", reg)).toBe(
      "[File #1: renamed.txt]",
    );
  });

  it("leaves unknown ids alone (registry cleared by a prior submit)", () => {
    expect(expandFileRefPlaceholders("[File #9: ghost.txt]", reg)).toBe(
      "[File #9: ghost.txt]",
    );
  });

  it("expands the same id only where the exact placeholder appears", () => {
    const s = "[File #1: a.txt] 与 [File #1: b.txt]";
    expect(expandFileRefPlaceholders(s, reg)).toBe(
      "/u/a.txt 与 [File #1: b.txt]",
    );
  });
});
