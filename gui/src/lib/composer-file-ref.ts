/**
 * Pure file-reference helpers for the Composer. A dropped (or picked)
 * non-image path becomes a `[File #N: name.ext]` / `[Folder #N: name]`
 * placeholder in the textarea; submit expands it to the absolute path.
 * The stateful side — registry refs, caret restoration, plugin-fs stat —
 * lives in `@/hooks/useFileReferences`; everything here is string math,
 * so it unit-tests without a DOM.
 *
 * The placeholder grammar deliberately mirrors paste-fold
 * (`lib/composer-paste.ts`): fixed English (locale-independent so a
 * language switch can't orphan a pending draft's placeholders), a `#N`
 * counter to disambiguate same-named files, and manual edits trump
 * silent expansion.
 */

export type FileRefKind = "file" | "folder";

/** A registered reference: the exact placeholder text as inserted, and
 * the absolute path it stands for. Expansion requires an exact
 * placeholder match — see {@link expandFileRefPlaceholders}. */
export interface FileRefEntry {
  placeholder: string;
  path: string;
}

/**
 * Pattern matching placeholder-shaped text. Loose on the name segment
 * (anything but `]` / newline) so we can find candidates; the registry's
 * exact-string check is what decides whether a candidate still expands.
 */
export const FILE_REF_PLACEHOLDER_RE = /\[(?:File|Folder) #(\d+): [^\]\n]*\]/g;

export function fileRefPlaceholder(
  kind: FileRefKind,
  id: number,
  name: string,
): string {
  const label = kind === "folder" ? "Folder" : "File";
  // Brackets in a filename would break the placeholder grammar; strip
  // them from the display name (the registry keeps the real path, so
  // nothing is lost at expansion).
  const safe = name.replace(/[[\]]/g, "");
  return `[${label} #${id}: ${safe}]`;
}

/** Absolute path as it should appear in the sent message: double-quoted
 * when it contains whitespace, bare otherwise. No `~` abbreviation — the
 * agent-side expansion of `~` is tool-dependent (PRD 已否决备选). */
export function quotePathForMessage(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

/**
 * Splice placeholders over the `[start, end)` selection in `text`,
 * space-separated, padding either side so the reference never glues to
 * adjacent words. Returns the new value and the caret position (after
 * the trailing pad, so typing continues naturally). Pure — the caller
 * owns minting ids and registering entries.
 */
export function insertFileRefPlaceholders({
  text,
  start,
  end,
  placeholders,
}: {
  text: string;
  start: number;
  end: number;
  placeholders: string[];
}): { next: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trail = /^\s/.test(after) ? "" : " ";
  const inserted = lead + placeholders.join(" ") + trail;
  return {
    next: before + inserted + after,
    caret: start + inserted.length,
  };
}

/**
 * Replace every intact placeholder in `s` with its quoted absolute path.
 * "Intact" means the matched text equals the registered placeholder
 * exactly — a user edit inside the brackets (even one that still parses)
 * de-registers the reference, and unknown ids (registry cleared by a
 * prior submit) stay as-is. Manual edits trump silent expansion, same
 * contract as paste-fold.
 */
export function expandFileRefPlaceholders(
  s: string,
  registry: Map<number, FileRefEntry>,
): string {
  return s.replace(FILE_REF_PLACEHOLDER_RE, (match, idStr: string) => {
    const entry = registry.get(parseInt(idStr, 10));
    if (entry === undefined || entry.placeholder !== match) return match;
    return quotePathForMessage(entry.path);
  });
}
