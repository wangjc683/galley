/**
 * Pure helpers for the native (Tauri) drag-drop intake. Since
 * `dragDropEnabled: true` (core/tauri.conf.json), the OS drop arrives as
 * filesystem paths via `onDragDropEvent` — HTML5 drop never fires (wry
 * consumes every external drag; see .scratch/composer-file-drop/issues/01).
 * These helpers split a dropped path list into the image subset (fed to
 * the existing attachment pipeline) and everything else (inserted as
 * file-reference placeholders). String math only — unit-tests without
 * Tauri.
 */

/** Extensions routed to the image-attachment pipeline. Mirrors
 * SUPPORTED_PASTE_IMAGE_TYPES in `lib/composer-images.ts` — anything
 * outside this set (GIF, HEIC, PDF, …) becomes a path reference instead,
 * which is the predictable half of the "images attach, files refer"
 * rule. */
const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Last path segment, tolerant of both separators (native paths keep the
 * platform's own separator; Windows gives `C:\Users\…`) and a trailing
 * separator on directory paths. */
export function dropPathBasename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  // A bare root ("/" or "C:\") trims to little or nothing — fall back to
  // the original string so the placeholder never renders empty.
  return base.length > 0 ? base : path;
}

/** MIME for paths the image pipeline can take, else null. */
export function imageMimeForPath(path: string): string | null {
  const base = dropPathBasename(path);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return null; // no extension, or dotfile like ".env"
  const ext = base.slice(dot + 1).toLowerCase();
  return IMAGE_EXT_TO_MIME[ext] ?? null;
}

/** Split a native drop into the image subset and the path-reference
 * subset, preserving drop order within each. */
export function splitDropPaths(paths: string[]): {
  imagePaths: string[];
  filePaths: string[];
} {
  const imagePaths: string[] = [];
  const filePaths: string[] = [];
  for (const path of paths) {
    (imageMimeForPath(path) !== null ? imagePaths : filePaths).push(path);
  }
  return { imagePaths, filePaths };
}
