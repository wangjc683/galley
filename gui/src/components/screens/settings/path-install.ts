import type { AppCopy } from "@/i18n/types";
import type { PlatformName } from "@/lib/platform";

/**
 * Pure helpers for Settings → Agent's command-shortcut row
 * (`SettingsIntegration.tsx`): which notice replaces the install
 * buttons, where the Windows CLI folder comes from, and how Core's
 * install / uninstall outcomes read in plain language. Kept out of the
 * component file so they can be unit-tested in the node test env.
 */

/** Mirror of Rust core/src/path_install.rs::PathInstallStatus. */
export type PathInstallStatus =
  | { status: "installed"; symlink: string; target: string }
  | { status: "not_installed" }
  | { status: "other_target"; symlink: string; actual: string }
  | { status: "unsupported"; reason: string };

/** Mirror of PathInstallOutcome (install). */
export type PathInstallOutcome =
  | { outcome: "installed"; symlink: string; target: string }
  | { outcome: "user_cancelled" }
  | { outcome: "cli_binary_not_found"; searched: string }
  | { outcome: "failed"; reason: string; details: string }
  | { outcome: "unsupported"; reason: string };

/** Mirror of PathUninstallOutcome. */
export type PathUninstallOutcome =
  | { outcome: "uninstalled"; symlink: string }
  | { outcome: "not_installed" }
  | { outcome: "user_cancelled" }
  | { outcome: "failed"; reason: string; details: string }
  | { outcome: "unsupported"; reason: string };

type AgentCopy = AppCopy["settings"]["agent"];

/**
 * What the command-shortcut row shows instead of install / remove
 * buttons. `null` means the platform has the one-click path (macOS).
 */
export type PathInstallNotice =
  /** Windows, CLI folder lookup still running: render nothing yet so
   * the row never flips from one sentence to another. */
  | { kind: "pending" }
  /** Windows: no one-click install, but the folder holding galley.exe
   * is known, so the user can add it to PATH by hand. */
  | { kind: "windows-manual"; dir: string }
  | { kind: "generic" };

/**
 * `cliDir` only matters on Windows: `undefined` while the discovery
 * file is still being read, `null` when no usable folder was found
 * (falls back to the generic sentence rather than a dangling
 * "add this folder to PATH:" with nothing after it).
 */
export function pathInstallNotice(
  platform: PlatformName,
  statusUnsupported: boolean,
  cliDir: string | null | undefined,
): PathInstallNotice | null {
  if (platform === "windows") {
    if (cliDir === undefined) return { kind: "pending" };
    return cliDir
      ? { kind: "windows-manual", dir: cliDir }
      : { kind: "generic" };
  }
  if (platform !== "mac" || statusUnsupported) return { kind: "generic" };
  return null;
}

const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

/**
 * Line 1 of the discovery file Galley Core writes at startup
 * (core/src/discovery.rs: line 1 = absolute CLI path, line 2 =
 * `schema_version=…`). Returns null unless it is an absolute path.
 */
export function parseDiscoveryCliPath(body: string): string | null {
  const firstLine = body.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return ABSOLUTE_PATH.test(firstLine) ? firstLine : null;
}

/**
 * Folder part of a file path, for either separator. A file at a drive
 * or filesystem root keeps the root's separator (`C:\galley.exe` →
 * `C:\`, `/galley` → `/`).
 */
export function parentDirectory(path: string): string | null {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (cut < 0) return null;
  const dir = path.slice(0, cut);
  if (dir === "" || /^[A-Za-z]:$/.test(dir)) return path.slice(0, cut + 1);
  return dir;
}

/** A failed path action: a plain-language sentence for the UI, plus
 * Core's raw reason for 「复制详情」 when there is one. */
export interface PathActionError {
  message: string;
  details?: string;
}

/** `run_with_admin_privileges` reason (core/src/path_install.rs) when
 * osascript itself could not start, i.e. no auth prompt ever showed. */
const AUTH_LAUNCH_FAILED_REASON = "osascript spawn failed";

function failedError(
  reason: string,
  details: string,
  actionFailed: string,
  copy: AgentCopy,
): PathActionError {
  return {
    message:
      reason === AUTH_LAUNCH_FAILED_REASON
        ? copy.pathAuthLaunchFailed
        : actionFailed,
    details: details ? `${reason}: ${details}` : reason,
  };
}

/**
 * Install (and Replace, which runs the same `ln -sf`) outcome → error
 * line. `unsupported` yields no error line: the status refresh that
 * follows every action reports `unsupported` too, and the row then shows
 * the platform's own notice instead of Core's English reason.
 */
export function pathInstallError(
  outcome: PathInstallOutcome,
  copy: AgentCopy,
  isDev: boolean,
): PathActionError | null {
  switch (outcome.outcome) {
    case "installed":
    case "user_cancelled":
    case "unsupported":
      return null;
    case "cli_binary_not_found":
      // The dev sentence is an instruction for whoever runs
      // `pnpm tauri dev`; a packaged user can only reinstall.
      return isDev
        ? { message: copy.cliBinaryNotFound(outcome.searched) }
        : {
            message: copy.cliBinaryNotFoundPackaged,
            details: `cli_binary_not_found: ${outcome.searched}`,
          };
    case "failed":
      return failedError(
        outcome.reason,
        outcome.details,
        copy.pathInstallFailed,
        copy,
      );
  }
}

/** Remove outcome → error line. Same `unsupported` rule as install. */
export function pathUninstallError(
  outcome: PathUninstallOutcome,
  copy: AgentCopy,
): PathActionError | null {
  switch (outcome.outcome) {
    case "uninstalled":
    case "not_installed":
    case "user_cancelled":
    case "unsupported":
      return null;
    case "failed":
      return failedError(
        outcome.reason,
        outcome.details,
        copy.pathRemoveFailed,
        copy,
      );
  }
}
