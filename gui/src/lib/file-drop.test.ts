import { describe, expect, it } from "vitest";

import {
  dropPathBasename,
  imageMimeForPath,
  splitDropPaths,
} from "@/lib/file-drop";

describe("dropPathBasename", () => {
  it("takes the last segment of a POSIX path", () => {
    expect(dropPathBasename("/Users/jc/Documents/report.pdf")).toBe(
      "report.pdf",
    );
  });

  it("takes the last segment of a Windows path", () => {
    expect(dropPathBasename("C:\\Users\\jc\\Desktop\\notes.txt")).toBe(
      "notes.txt",
    );
  });

  it("tolerates a trailing separator on directory paths", () => {
    expect(dropPathBasename("/Users/jc/project/")).toBe("project");
    expect(dropPathBasename("C:\\Users\\jc\\project\\")).toBe("project");
  });

  it("keeps CJK and spaces intact", () => {
    expect(dropPathBasename("/Users/jc/文档/年度 报告.pdf")).toBe(
      "年度 报告.pdf",
    );
  });

  it("falls back to the input for bare roots", () => {
    expect(dropPathBasename("/")).toBe("/");
  });
});

describe("imageMimeForPath", () => {
  it("maps the attachable image extensions, case-insensitively", () => {
    expect(imageMimeForPath("/a/b/pic.png")).toBe("image/png");
    expect(imageMimeForPath("/a/b/PIC.JPG")).toBe("image/jpeg");
    expect(imageMimeForPath("/a/b/pic.jpeg")).toBe("image/jpeg");
    expect(imageMimeForPath("C:\\a\\pic.WebP")).toBe("image/webp");
  });

  it("routes everything else to the file side", () => {
    // GIF / HEIC are deliberately files-not-attachments: the pipeline
    // doesn't transcode them (see lib/composer-images.ts), so a path
    // reference is the honest handling.
    expect(imageMimeForPath("/a/anim.gif")).toBeNull();
    expect(imageMimeForPath("/a/photo.heic")).toBeNull();
    expect(imageMimeForPath("/a/report.pdf")).toBeNull();
    expect(imageMimeForPath("/a/folder")).toBeNull();
  });

  it("does not treat dotfiles as extensions", () => {
    expect(imageMimeForPath("/a/.png")).toBeNull();
  });
});

describe("splitDropPaths", () => {
  it("splits a mixed drop preserving order within each subset", () => {
    const { imagePaths, filePaths } = splitDropPaths([
      "/a/one.png",
      "/a/report.pdf",
      "/a/two.jpg",
      "/a/src",
    ]);
    expect(imagePaths).toEqual(["/a/one.png", "/a/two.jpg"]);
    expect(filePaths).toEqual(["/a/report.pdf", "/a/src"]);
  });
});
