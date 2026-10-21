import { describe, expect, it, vi } from "vitest";

import type { AgentTurn, Turn } from "@/types/conversation";

import {
  fileCardClick,
  fileCardRuns,
  fileFolder,
  fileGlyph,
  filesByMessage,
  inspectFilePresence,
  samePresence,
  splitFileName,
  thumbnailPath,
  type FilePresence,
} from "./file-cards";

/**
 * The file cards under a main chat reply (main chat ticket 74): which
 * reply has which files, what a card shows for a path, and what Core's
 * answer about the file means. How a card draws is pinned in
 * components/conversation/FileCards.test.tsx; where they hang in
 * MainView.assistant.test.tsx.
 */

const access = vi.hoisted(() => ({
  answer: null as unknown,
  error: null as unknown,
}));
vi.mock("@/lib/local-files", () => ({
  accessLocalFile: async (path: string) => {
    if (access.error) throw access.error;
    return access.answer ?? { path, kind: "file", content: null };
  },
}));

function reply(id: string, files?: string[]): AgentTurn {
  return {
    role: "agent",
    turnIndex: 1,
    finalAnswer: "好了。",
    tools: [],
    messageId: id,
    ...(files ? { files } : {}),
  };
}

describe("filesByMessage", () => {
  it("keys each reply's files by its row id, in marker order", () => {
    const turns: Turn[] = [
      { role: "user", content: "做个计划" },
      reply("a-1", ["/Users/jc/plan.html", "/Users/jc/banner.png"]),
      reply("a-2"),
      reply("a-3", ["/tmp/out/report.pdf"]),
    ];
    const byMessage = filesByMessage(turns);
    expect([...byMessage.keys()]).toEqual(["a-1", "a-3"]);
    expect(byMessage.get("a-1")).toEqual([
      "/Users/jc/plan.html",
      "/Users/jc/banner.png",
    ]);
  });

  it("skips a turn with no row id and an empty list", () => {
    const loose = reply("x", ["/tmp/a.txt"]);
    delete loose.messageId;
    expect(filesByMessage([loose, reply("a-2", [])]).size).toBe(0);
  });
});

describe("splitFileName (a middle cut that keeps the extension)", () => {
  it("keeps the extension and four characters before it with the tail", () => {
    expect(splitFileName("Banner-草稿-final.png")).toEqual({
      head: "Banner-草稿-f",
      tail: "inal.png",
    });
    expect(splitFileName("2026年第三季度经营分析报告.pdf")).toEqual({
      head: "2026年第三季度经营",
      tail: "分析报告.pdf",
    });
  });

  it("keeps only the extension when the name is short", () => {
    expect(splitFileName("plan.html")).toEqual({ head: "plan", tail: ".html" });
  });

  it("does not take a dotfile's name or a long run after a dot for an extension", () => {
    expect(splitFileName(".gitignore")).toEqual({
      head: ".gitignore",
      tail: "",
    });
    expect(splitFileName("Makefile")).toEqual({ head: "Makefile", tail: "" });
    expect(splitFileName("notes.from-the-meeting-today")).toEqual({
      head: "notes.from-the-meeting-today",
      tail: "",
    });
  });

  it("never splits a character outside the BMP", () => {
    const { head, tail } = splitFileName("😀😀😀😀😀😀😀😀😀.txt");
    expect(head).toBe("😀😀😀😀😀");
    expect(tail).toBe("😀😀😀😀.txt");
  });
});

describe("fileFolder", () => {
  it("is the folder the path names, as written", () => {
    expect(fileFolder("/Users/jc/Documents/报告/q3.pdf")).toBe(
      "/Users/jc/Documents/报告",
    );
    expect(fileFolder("~/Desktop/a.png")).toBe("~/Desktop");
    expect(fileFolder("C:\\Users\\jc\\Desktop\\a.docx")).toBe(
      "C:\\Users\\jc\\Desktop",
    );
  });

  it("names the root, and nothing for a bare name", () => {
    expect(fileFolder("/a.txt")).toBe("/");
    expect(fileFolder("C:\\a.txt")).toBe("C:\\");
    expect(fileFolder("report.pdf")).toBe("");
  });
});

describe("thumbnailPath (an image draws as a thumbnail)", () => {
  const present = (path: string, kind = "image"): FilePresence => ({
    state: "present",
    kind: kind as "image",
    path,
  });

  it("is the five raster kinds the reading panel shows", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "PNG"]) {
      expect(thumbnailPath(`/tmp/a.${ext}`, undefined)).toBe(`/tmp/a.${ext}`);
    }
    expect(thumbnailPath("/tmp/a.svg", undefined)).toBeNull();
    expect(thumbnailPath("/tmp/a.pdf", undefined)).toBeNull();
  });

  it("draws a gone image, or a folder named like one, as a file", () => {
    expect(thumbnailPath("/tmp/a.png", { state: "missing" })).toBeNull();
    expect(
      thumbnailPath("/tmp/a.png", present("/tmp/a.png", "directory")),
    ).toBeNull();
  });

  it("loads `~` from the path Core expanded, and not before", () => {
    expect(thumbnailPath("~/Desktop/a.png", undefined)).toBeNull();
    expect(
      thumbnailPath("~/Desktop/a.png", present("/Users/jc/Desktop/a.png")),
    ).toBe("/Users/jc/Desktop/a.png");
  });
});

describe("fileCardRuns", () => {
  it("keeps marker order, thumbnails side by side in a run", () => {
    const paths = ["/a.png", "/b.jpg", "/c.pdf", "/d.webp"];
    const runs = fileCardRuns(paths, (p) => !p.endsWith(".pdf"));
    expect(runs).toEqual([
      { kind: "images", paths: ["/a.png", "/b.jpg"] },
      { kind: "file", path: "/c.pdf" },
      { kind: "images", paths: ["/d.webp"] },
    ]);
  });
});

describe("fileCardClick (where a click on a card goes)", () => {
  it("opens documents in the default application, HTML included; the rest where a reference goes", () => {
    expect(fileCardClick("/a/report.pdf", undefined)).toBe("open");
    expect(fileCardClick("/a/plan.html", undefined)).toBe("open");
    expect(fileCardClick("/a/deck.PPTX", undefined)).toBe("open");
    expect(fileCardClick("/a/notes.md", undefined)).toBe("panel");
    expect(fileCardClick("/a/banner.png", undefined)).toBe("panel");
    expect(fileCardClick("/a/data.csv", undefined)).toBe("panel");
    expect(fileCardClick("/a/bundle.zip", undefined)).toBe("panel");
    expect(fileCardClick("/a/old.doc", undefined)).toBe("panel");
  });

  it("takes a folder Core named for a folder, whatever its name", () => {
    expect(
      fileCardClick("/a/site.html", {
        state: "present",
        kind: "directory",
        path: "/a/site.html",
      }),
    ).toBe("panel");
  });
});

describe("fileGlyph", () => {
  it("names the kind by extension; a folder by Core's answer", () => {
    expect(fileGlyph("/a/q3.pdf", undefined)).toBe("pdf");
    expect(fileGlyph("/a/plan.HTML", undefined)).toBe("html");
    expect(fileGlyph("/a/notes.md", undefined)).toBe("markdown");
    expect(fileGlyph("/a/data.xlsx", undefined)).toBe("sheet");
    expect(fileGlyph("/a/run.py", undefined)).toBe("code");
    expect(fileGlyph("/a/b.png", undefined)).toBe("image");
    expect(fileGlyph("/a/blob.bin", undefined)).toBe("file");
    expect(
      fileGlyph("/a/out", {
        state: "present",
        kind: "directory",
        path: "/a/out",
      }),
    ).toBe("folder");
  });
});

describe("inspectFilePresence (Core's answer)", () => {
  it("is there with Core's kind and resolved path", async () => {
    access.error = null;
    access.answer = { path: "/Users/jc/a.md", kind: "markdown", content: null };
    await expect(inspectFilePresence("~/a.md")).resolves.toEqual({
      state: "present",
      kind: "markdown",
      path: "/Users/jc/a.md",
    });
  });

  it("is gone only on Core's not-found; anything else is not known", async () => {
    access.error = "not_found: local_file_missing";
    await expect(inspectFilePresence("/x")).resolves.toEqual({
      state: "missing",
    });
    access.error = "internal: local_file_permission";
    await expect(inspectFilePresence("/x")).resolves.toEqual({
      state: "unknown",
    });
    access.error = null;
    access.answer = null;
  });

  it("compares two answers by what they say", () => {
    const a: FilePresence = { state: "present", kind: "file", path: "/a" };
    expect(samePresence(a, { ...a })).toBe(true);
    expect(samePresence(a, { ...a, kind: "text" })).toBe(false);
    expect(samePresence(undefined, { state: "missing" })).toBe(false);
    expect(samePresence({ state: "missing" }, { state: "missing" })).toBe(true);
  });
});
