import { useEffect, useState } from "react";

/**
 * The user's home directory, for display only (collapsing it to `~` in
 * folder paths, 2026-10-09). Resolved once per app run and shared by
 * every caller; `null` until resolved, outside Tauri (vitest / plain
 * Vite), or when the lookup fails.
 */
let homeDirPromise: Promise<string | null> | null = null;
/** Settled value, so later mounts render `~` on their first frame
 * instead of flashing the full path. `undefined` = not settled yet. */
let settledHomeDir: string | null | undefined;

function loadHomeDir(): Promise<string | null> {
  homeDirPromise ??= (async () => {
    try {
      const { isTauri } = await import("@tauri-apps/api/core");
      if (!isTauri()) return null;
      const { homeDir } = await import("@tauri-apps/api/path");
      return await homeDir();
    } catch (e) {
      console.warn(
        "[useHomeDir] homeDir() failed — folder paths display without ~.",
        e,
      );
      return null;
    }
  })().then((dir) => {
    settledHomeDir = dir;
    return dir;
  });
  return homeDirPromise;
}

export function useHomeDir(): string | null {
  const [homeDir, setHomeDir] = useState<string | null>(
    () => settledHomeDir ?? null,
  );
  useEffect(() => {
    let cancelled = false;
    // setState only in the promise callback, never synchronously in the
    // effect body (react-hooks/set-state-in-effect).
    void loadHomeDir().then((dir) => {
      if (!cancelled) setHomeDir(dir);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return homeDir;
}
