import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";

import {
  parentDirectory,
  parseDiscoveryCliPath,
  pathInstallError,
  pathInstallNotice,
  pathUninstallError,
} from "./path-install";

const zh = zhCopy.settings.agent;
const en = enCopy.settings.agent;

describe("pathInstallNotice", () => {
  it("keeps macOS on the one-click path", () => {
    expect(pathInstallNotice("mac", false, undefined)).toBeNull();
    // Core never reports unsupported on macOS, but if it did the row
    // must not offer a button that cannot work.
    expect(pathInstallNotice("mac", true, undefined)).toEqual({
      kind: "generic",
    });
  });

  it("names the CLI folder on Windows once it is known", () => {
    expect(
      pathInstallNotice("windows", true, "C:\\Program Files\\Galley"),
    ).toEqual({ kind: "windows-manual", dir: "C:\\Program Files\\Galley" });
  });

  it("renders nothing on Windows while the folder is still being read", () => {
    expect(pathInstallNotice("windows", true, undefined)).toEqual({
      kind: "pending",
    });
  });

  it("falls back to the generic sentence on Windows without a folder", () => {
    expect(pathInstallNotice("windows", true, null)).toEqual({
      kind: "generic",
    });
    expect(pathInstallNotice("windows", true, "")).toEqual({
      kind: "generic",
    });
  });

  it("uses the generic sentence on other platforms", () => {
    expect(pathInstallNotice("linux", true, undefined)).toEqual({
      kind: "generic",
    });
    expect(pathInstallNotice("linux", false, "/opt/galley")).toEqual({
      kind: "generic",
    });
  });
});

describe("parseDiscoveryCliPath", () => {
  it("reads line 1 of the v1 discovery file", () => {
    expect(
      parseDiscoveryCliPath(
        "C:\\Users\\JC\\AppData\\Local\\Galley\\galley.exe\nschema_version=1\n",
      ),
    ).toBe("C:\\Users\\JC\\AppData\\Local\\Galley\\galley.exe");
    expect(
      parseDiscoveryCliPath(
        "/Applications/Galley.app/Contents/MacOS/galley\nschema_version=1\n",
      ),
    ).toBe("/Applications/Galley.app/Contents/MacOS/galley");
  });

  it("tolerates CRLF and surrounding whitespace", () => {
    expect(
      parseDiscoveryCliPath(
        "  D:\\Galley\\galley.exe \r\nschema_version=1\r\n",
      ),
    ).toBe("D:\\Galley\\galley.exe");
  });

  it("rejects empty or relative content", () => {
    expect(parseDiscoveryCliPath("")).toBeNull();
    expect(parseDiscoveryCliPath("\nschema_version=1\n")).toBeNull();
    expect(parseDiscoveryCliPath("galley.exe\n")).toBeNull();
  });

  it("accepts UNC paths", () => {
    expect(parseDiscoveryCliPath("\\\\server\\share\\galley.exe")).toBe(
      "\\\\server\\share\\galley.exe",
    );
  });
});

describe("parentDirectory", () => {
  it("drops the file name for either separator", () => {
    expect(parentDirectory("C:\\Program Files\\Galley\\galley.exe")).toBe(
      "C:\\Program Files\\Galley",
    );
    expect(parentDirectory("C:/Galley/galley.exe")).toBe("C:/Galley");
    expect(parentDirectory("/usr/local/bin/galley")).toBe("/usr/local/bin");
  });

  it("keeps the root separator for a file at the root", () => {
    expect(parentDirectory("C:\\galley.exe")).toBe("C:\\");
    expect(parentDirectory("/galley")).toBe("/");
  });

  it("returns null without a separator", () => {
    expect(parentDirectory("galley.exe")).toBeNull();
  });
});

describe("pathInstallError", () => {
  it("shows nothing for expected outcomes and unsupported", () => {
    expect(
      pathInstallError(
        {
          outcome: "installed",
          symlink: "/usr/local/bin/galley",
          target: "/x",
        },
        zh,
        false,
      ),
    ).toBeNull();
    expect(
      pathInstallError({ outcome: "user_cancelled" }, zh, false),
    ).toBeNull();
    expect(
      pathInstallError(
        {
          outcome: "unsupported",
          reason: "PATH install is macOS-only in v0.2",
        },
        zh,
        false,
      ),
    ).toBeNull();
  });

  it("says the install failed and keeps osascript's stderr for details", () => {
    expect(
      pathInstallError(
        {
          outcome: "failed",
          reason: "osascript reported failure",
          details: "execution error: ln: Operation not permitted (1)",
        },
        zh,
        false,
      ),
    ).toEqual({
      message: zh.pathInstallFailed,
      details:
        "osascript reported failure: execution error: ln: Operation not permitted (1)",
    });
  });

  it("says the auth prompt could not open when osascript did not start", () => {
    expect(
      pathInstallError(
        {
          outcome: "failed",
          reason: "osascript spawn failed",
          details: "No such file or directory (os error 2)",
        },
        en,
        false,
      ),
    ).toEqual({
      message: en.pathAuthLaunchFailed,
      details: "osascript spawn failed: No such file or directory (os error 2)",
    });
  });

  it("keeps the bare reason as details when stderr is empty", () => {
    expect(
      pathInstallError(
        {
          outcome: "failed",
          reason: "osascript reported failure",
          details: "",
        },
        zh,
        false,
      ),
    ).toEqual({
      message: zh.pathInstallFailed,
      details: "osascript reported failure",
    });
  });

  it("gives packaged builds a user sentence and dev builds the build hint", () => {
    const outcome = {
      outcome: "cli_binary_not_found" as const,
      searched: "/Applications/Galley.app/Contents/MacOS",
    };
    expect(pathInstallError(outcome, zh, false)).toEqual({
      message: zh.cliBinaryNotFoundPackaged,
      details: "cli_binary_not_found: /Applications/Galley.app/Contents/MacOS",
    });
    expect(pathInstallError(outcome, zh, true)).toEqual({
      message: zh.cliBinaryNotFound("/Applications/Galley.app/Contents/MacOS"),
    });
  });
});

describe("pathUninstallError", () => {
  it("shows nothing for expected outcomes and unsupported", () => {
    expect(
      pathUninstallError(
        { outcome: "uninstalled", symlink: "/usr/local/bin/galley" },
        zh,
      ),
    ).toBeNull();
    expect(pathUninstallError({ outcome: "not_installed" }, zh)).toBeNull();
    expect(pathUninstallError({ outcome: "user_cancelled" }, zh)).toBeNull();
    expect(
      pathUninstallError(
        {
          outcome: "unsupported",
          reason: "PATH install is macOS-only in v0.2",
        },
        zh,
      ),
    ).toBeNull();
  });

  it("says the removal failed, or that the auth prompt could not open", () => {
    expect(
      pathUninstallError(
        {
          outcome: "failed",
          reason: "osascript reported failure",
          details: "rm: busy",
        },
        zh,
      ),
    ).toEqual({
      message: zh.pathRemoveFailed,
      details: "osascript reported failure: rm: busy",
    });
    expect(
      pathUninstallError(
        { outcome: "failed", reason: "osascript spawn failed", details: "x" },
        zh,
      )?.message,
    ).toBe(zh.pathAuthLaunchFailed);
  });
});
