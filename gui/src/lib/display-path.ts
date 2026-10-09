/**
 * Display-only split of a folder path into a muted parent and the leaf
 * name people actually recognise (2026-10-09). Truncating a long path
 * from the right cuts off exactly the part that identifies the folder
 * (`/Users/x/Documents/g…`), so `FolderPathText` lets `parent` shrink
 * first and keeps `leaf` whole. The home prefix collapses to `~`.
 *
 * Never feed the result back into filesystem calls — it is lossy (`~`)
 * and exists for rendering only.
 */
export interface DisplayPathParts {
  /** Everything before the leaf, ending in a separator (`~/Documents/`).
   * Empty when the path has no parent to show (`~`, `/`, `C:\`). */
  parent: string;
  /** Last path segment (`genericagent-webui`), or the whole path when it
   * has no separator left (`~`, `/`, `C:\`). */
  leaf: string;
}

const WINDOWS_DRIVE = /^[A-Za-z]:(?:[\\/]|$)/;

/** A drive letter, or a backslash in a path that isn't POSIX-absolute
 * (UNC `\\server\share`), means Windows rules: `/` and `\` are both
 * separators and comparison ignores case. A POSIX path may legally
 * contain `\` in a folder name, so a leading `/` keeps POSIX rules. */
function isWindowsStyle(path: string): boolean {
  return (
    WINDOWS_DRIVE.test(path) || (path.includes("\\") && !path.startsWith("/"))
  );
}

function stripTrailingSeparators(path: string, windows: boolean): string {
  return path.replace(windows ? /[\\/]+$/ : /\/+$/, "");
}

function normalizeForCompare(path: string, windows: boolean): string {
  return windows ? path.replace(/\\/g, "/").toLowerCase() : path;
}

/** Replace a leading `homeDir` with `~`. Only whole segments match:
 * `/Users/jcx` is not under `/Users/jc`. */
function collapseHome(
  path: string,
  homeDir: string | null,
  windows: boolean,
): string {
  if (!homeDir) return path;
  // Home must use the same path style as the path being displayed.
  if (isWindowsStyle(homeDir) !== windows) return path;
  const home = stripTrailingSeparators(homeDir, windows);
  // A root home (`/`, `C:`) would turn every path into `~…`; skip it.
  if (home === "" || (windows && /^[A-Za-z]:$/.test(home))) return path;
  const target = normalizeForCompare(path, windows);
  const prefix = normalizeForCompare(home, windows);
  if (target === prefix) return "~";
  if (target.startsWith(`${prefix}/`)) return `~${path.slice(home.length)}`;
  return path;
}

export function splitDisplayPath(
  path: string,
  homeDir: string | null,
): DisplayPathParts {
  if (path === "") return { parent: "", leaf: "" };
  const windows = isWindowsStyle(path);
  const stripped = stripTrailingSeparators(path, windows);

  // Roots have no leaf of their own; show them as-is.
  if (stripped === "") return { parent: "", leaf: "/" };
  if (windows && /^[A-Za-z]:$/.test(stripped)) {
    return { parent: "", leaf: path.slice(0, 3) };
  }

  const display = collapseHome(stripped, homeDir, windows);
  const cut = windows
    ? Math.max(display.lastIndexOf("/"), display.lastIndexOf("\\"))
    : display.lastIndexOf("/");
  if (cut < 0) return { parent: "", leaf: display };
  return { parent: display.slice(0, cut + 1), leaf: display.slice(cut + 1) };
}
