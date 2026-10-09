import { describe, expect, it } from "vitest";

import { splitDisplayPath } from "./display-path";

describe("splitDisplayPath", () => {
  describe("macOS / Linux paths", () => {
    it("collapses the home prefix and splits off the leaf", () => {
      expect(
        splitDisplayPath("/Users/jc/Documents/genericagent-webui", "/Users/jc"),
      ).toEqual({ parent: "~/Documents/", leaf: "genericagent-webui" });
    });

    it("shows the home folder itself as ~", () => {
      expect(splitDisplayPath("/Users/jc", "/Users/jc")).toEqual({
        parent: "",
        leaf: "~",
      });
      expect(splitDisplayPath("/Users/jc/", "/Users/jc/")).toEqual({
        parent: "",
        leaf: "~",
      });
    });

    it("keeps a direct child of home as ~/leaf", () => {
      expect(splitDisplayPath("/Users/jc/notes", "/Users/jc")).toEqual({
        parent: "~/",
        leaf: "notes",
      });
    });

    it("leaves paths outside home untouched", () => {
      expect(splitDisplayPath("/Volumes/Data/work", "/Users/jc")).toEqual({
        parent: "/Volumes/Data/",
        leaf: "work",
      });
    });

    it("only matches home on whole segments", () => {
      expect(splitDisplayPath("/Users/jcx/work", "/Users/jc")).toEqual({
        parent: "/Users/jcx/",
        leaf: "work",
      });
    });

    it("compares case-sensitively", () => {
      expect(splitDisplayPath("/users/jc/work", "/Users/jc")).toEqual({
        parent: "/users/jc/",
        leaf: "work",
      });
    });

    it("works without a known home dir", () => {
      expect(splitDisplayPath("/Users/jc/work", null)).toEqual({
        parent: "/Users/jc/",
        leaf: "work",
      });
    });

    it("drops trailing slashes", () => {
      expect(splitDisplayPath("/Users/jc/work/", "/Users/jc")).toEqual({
        parent: "~/",
        leaf: "work",
      });
      expect(splitDisplayPath("/srv/app//", null)).toEqual({
        parent: "/srv/",
        leaf: "app",
      });
    });

    it("keeps a backslash in a POSIX folder name as part of the name", () => {
      expect(splitDisplayPath("/Users/jc/a\\b", "/Users/jc")).toEqual({
        parent: "~/",
        leaf: "a\\b",
      });
    });
  });

  describe("Windows paths", () => {
    it("collapses home case-insensitively", () => {
      expect(
        splitDisplayPath("C:\\Users\\JC\\Documents\\proj", "C:\\Users\\jc"),
      ).toEqual({ parent: "~\\Documents\\", leaf: "proj" });
    });

    it("treats / and \\ as the same separator", () => {
      expect(splitDisplayPath("c:/users/jc/proj", "C:\\Users\\JC\\")).toEqual({
        parent: "~/",
        leaf: "proj",
      });
      expect(splitDisplayPath("D:\\work/sub\\proj", null)).toEqual({
        parent: "D:\\work/sub\\",
        leaf: "proj",
      });
    });

    it("shows the home folder itself as ~", () => {
      expect(splitDisplayPath("C:\\Users\\jc", "C:\\Users\\jc")).toEqual({
        parent: "",
        leaf: "~",
      });
    });

    it("leaves paths outside home untouched", () => {
      expect(splitDisplayPath("D:\\work\\proj", "C:\\Users\\jc")).toEqual({
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
      expect(splitDisplayPath("", "/Users/jc")).toEqual({
        parent: "",
        leaf: "",
      });
    });

    it("shows roots whole", () => {
      expect(splitDisplayPath("/", "/Users/jc")).toEqual({
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
      expect(splitDisplayPath("/Users", "/Users/jc")).toEqual({
        parent: "/",
        leaf: "Users",
      });
      expect(splitDisplayPath("C:\\proj", "C:\\Users\\jc")).toEqual({
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
      expect(splitDisplayPath("C:\\Users\\jc\\proj", "/Users/jc")).toEqual({
        parent: "C:\\Users\\jc\\",
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
