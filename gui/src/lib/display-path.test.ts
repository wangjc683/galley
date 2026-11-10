import { describe, expect, it } from "vitest";

import { splitDisplayPath } from "./display-path";

describe("splitDisplayPath", () => {
  describe("macOS / Linux paths", () => {
    it("collapses the home prefix and splits off the leaf", () => {
      expect(
        splitDisplayPath("/Users/me/Documents/genericagent-webui", "/Users/me"),
      ).toEqual({ parent: "~/Documents/", leaf: "genericagent-webui" });
    });

    it("shows the home folder itself as ~", () => {
      expect(splitDisplayPath("/Users/me", "/Users/me")).toEqual({
        parent: "",
        leaf: "~",
      });
      expect(splitDisplayPath("/Users/me/", "/Users/me/")).toEqual({
        parent: "",
        leaf: "~",
      });
    });

    it("keeps a direct child of home as ~/leaf", () => {
      expect(splitDisplayPath("/Users/me/notes", "/Users/me")).toEqual({
        parent: "~/",
        leaf: "notes",
      });
    });

    it("leaves paths outside home untouched", () => {
      expect(splitDisplayPath("/Volumes/Data/work", "/Users/me")).toEqual({
        parent: "/Volumes/Data/",
        leaf: "work",
      });
    });

    it("only matches home on whole segments", () => {
      expect(splitDisplayPath("/Users/mex/work", "/Users/me")).toEqual({
        parent: "/Users/mex/",
        leaf: "work",
      });
    });

    it("compares case-sensitively", () => {
      expect(splitDisplayPath("/users/me/work", "/Users/me")).toEqual({
        parent: "/users/me/",
        leaf: "work",
      });
    });

    it("works without a known home dir", () => {
      expect(splitDisplayPath("/Users/me/work", null)).toEqual({
        parent: "/Users/me/",
        leaf: "work",
      });
    });

    it("drops trailing slashes", () => {
      expect(splitDisplayPath("/Users/me/work/", "/Users/me")).toEqual({
        parent: "~/",
        leaf: "work",
      });
      expect(splitDisplayPath("/srv/app//", null)).toEqual({
        parent: "/srv/",
        leaf: "app",
      });
    });

    it("keeps a backslash in a POSIX folder name as part of the name", () => {
      expect(splitDisplayPath("/Users/me/a\\b", "/Users/me")).toEqual({
        parent: "~/",
        leaf: "a\\b",
      });
    });
  });

  describe("Windows paths", () => {
    it("collapses home case-insensitively", () => {
      expect(
        splitDisplayPath("C:\\Users\\ME\\Documents\\proj", "C:\\Users\\me"),
      ).toEqual({ parent: "~\\Documents\\", leaf: "proj" });
    });

    it("treats / and \\ as the same separator", () => {
      expect(splitDisplayPath("c:/users/me/proj", "C:\\Users\\ME\\")).toEqual({
        parent: "~/",
        leaf: "proj",
      });
      expect(splitDisplayPath("D:\\work/sub\\proj", null)).toEqual({
        parent: "D:\\work/sub\\",
        leaf: "proj",
      });
    });

    it("shows the home folder itself as ~", () => {
      expect(splitDisplayPath("C:\\Users\\me", "C:\\Users\\me")).toEqual({
        parent: "",
        leaf: "~",
      });
    });

    it("leaves paths outside home untouched", () => {
      expect(splitDisplayPath("D:\\work\\proj", "C:\\Users\\me")).toEqual({
        parent: "D:\\work\\",
        leaf: "proj",
      });
    });

    it("drops trailing separators", () => {
      expect(splitDisplayPath("C:\\work\\proj\\\\", null)).toEqual({
        parent: "C:\\work\\",
        leaf: "proj",
      });
    });

    it("splits UNC paths", () => {
      expect(splitDisplayPath("\\\\server\\share\\proj", null)).toEqual({
        parent: "\\\\server\\share\\",
        leaf: "proj",
      });
    });
  });

  describe("edge cases", () => {
    it("handles empty input", () => {
      expect(splitDisplayPath("", "/Users/me")).toEqual({
        parent: "",
        leaf: "",
      });
    });

    it("shows roots whole", () => {
      expect(splitDisplayPath("/", "/Users/me")).toEqual({
        parent: "",
        leaf: "/",
      });
      expect(splitDisplayPath("C:\\", null)).toEqual({
        parent: "",
        leaf: "C:\\",
      });
      expect(splitDisplayPath("C:", null)).toEqual({ parent: "", leaf: "C:" });
    });

    it("splits a top-level folder under the root", () => {
      expect(splitDisplayPath("/Users", "/Users/me")).toEqual({
        parent: "/",
        leaf: "Users",
      });
      expect(splitDisplayPath("C:\\proj", "C:\\Users\\me")).toEqual({
        parent: "C:\\",
        leaf: "proj",
      });
    });

    it("does not collapse against a root home", () => {
      expect(splitDisplayPath("/etc/app", "/")).toEqual({
        parent: "/etc/",
        leaf: "app",
      });
    });

    it("ignores a home of the other path style", () => {
      expect(splitDisplayPath("C:\\Users\\me\\proj", "/Users/me")).toEqual({
        parent: "C:\\Users\\me\\",
        leaf: "proj",
      });
    });

    it("returns a bare segment as the leaf", () => {
      expect(splitDisplayPath("proj", null)).toEqual({
        parent: "",
        leaf: "proj",
      });
    });
  });
});
