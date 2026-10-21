import {
  fileName,
  isOpenableDocument,
  previewKindByPath,
} from "@/lib/local-file-path";
import { accessLocalFile, type LocalFileResult } from "@/lib/local-files";
import type { Turn } from "@/types/conversation";

/**
 * The files the assistant hands over in a reply, drawn as cards under
 * its bubble (main chat ticket 74, assistant PRD ruling 10): the reply's
 * `[FILE:<path>]` markers, which the conversation's cleaned answer drops
 * (`cleanFinalAnswer`) and the turn keeps as `files`
 * (`finalAnswerFileRefs`). Only in the main chat; the sidebar card's
 * 「[文件] 名字」 is its own.
 *
 * Everything here is pure but the one Core call (`inspect`, through
 * `local_file.access`): which reply has which files, what a card shows
 * for a path, and whether the file is still there — checked once when
 * the conversation opens, remembered for the page's lifetime so a
 * revisit draws the last answer on its first frame.
 */

/** A reply's files, by its row id (`AgentTurn.messageId`, the key the
 * other cards under a reply hang by), in marker order. */
export function filesByMessage(
  turns: readonly Turn[],
): Map<string, readonly string[]> {
  const byMessage = new Map<string, readonly string[]>();
  for (const turn of turns) {
    if (turn.role !== "agent" || !turn.messageId) continue;
    if (turn.files && turn.files.length > 0) {
      byMessage.set(turn.messageId, turn.files);
    }
  }
  return byMessage;
}

/** What a card knows about its file: there (with Core's kind and the
 * path Core resolved, `~` expanded), gone, or not known — not asked yet,
 * or Core could not say (no permission, not an absolute path): such a
 * card draws as there, and a click lets the reading panel say why. */
export type FilePresence =
  | { state: "present"; kind: LocalFileResult["kind"]; path: string }
  | { state: "missing" }
  | { state: "unknown" };

const known = new Map<string, FilePresence>();

/** The last answer for `path` this page lifetime, if any. */
export function knownFilePresence(path: string): FilePresence | undefined {
  return known.get(path);
}

export function rememberFilePresence(
  path: string,
  presence: FilePresence,
): void {
  known.set(path, presence);
}

/** Ask Core whether the file is there (`inspect`: metadata and kind,
 * nothing read, nothing opened). Only Core's not-found counts as gone. */
export async function inspectFilePresence(path: string): Promise<FilePresence> {
  try {
    const file = await accessLocalFile(path, "inspect");
    return { state: "present", kind: file.kind, path: file.path };
  } catch (error) {
    return String(error).includes("local_file_missing")
      ? { state: "missing" }
      : { state: "unknown" };
  }
}

/** Whether two answers say the same (a re-check that changes nothing
 * sets no state). */
export function samePresence(
  a: FilePresence | undefined,
  b: FilePresence,
): boolean {
  if (!a || a.state !== b.state) return false;
  if (a.state === "present" && b.state === "present") {
    return a.kind === b.kind && a.path === b.path;
  }
  return true;
}

/**
 * The path a thumbnail loads from (the asset protocol, as the user's
 * own image attachments do), or null when the card draws as a file: not
 * a png / jpg / jpeg / gif / webp by name (the reading panel's image
 * list, `previewKindByPath`), gone, a folder by Core's answer, or `~`
 * not yet expanded by Core.
 */
export function thumbnailPath(
  path: string,
  presence: FilePresence | undefined,
): string | null {
  if (previewKindByPath(path) !== "image") return null;
  if (presence?.state === "missing") return null;
  if (presence?.state === "present") {
    return presence.kind === "image" ? presence.path : null;
  }
  return /^~[\\/]/.test(path) ? null : path;
}

/** A Pages or Numbers document saved as a package: a folder on disk,
 * one document to the user. Core's `open` lets these two through for a
 * folder and no other (ticket 73); mirror of that list. */
const DOCUMENT_PACKAGE = /\.(?:pages|numbers)$/i;

/** A folder by Core's answer that is a Pages / Numbers package. */
function documentPackage(path: string, presence: FilePresence | undefined) {
  return (
    presence?.state === "present" &&
    presence.kind === "directory" &&
    DOCUMENT_PACKAGE.test(fileName(path))
  );
}

/**
 * Where a click on a file card goes (ticket 74; a thumbnail opens the
 * image viewer instead): a document the default application opens —
 * pdf, docx, xlsx, pptx, pages, numbers, and HTML, a delivered page to
 * be seen rendered — opens there (`open`); everything else goes where a
 * file reference in the text goes (`panel`: the reading panel for
 * Markdown, images and text, the folder for the rest). A folder Core
 * named, whatever its name, is a folder — but a Pages / Numbers package,
 * which is a document.
 */
export function fileCardClick(
  path: string,
  presence: FilePresence | undefined,
): "open" | "panel" {
  if (presence?.state === "present" && presence.kind === "directory") {
    return documentPackage(path, presence) ? "open" : "panel";
  }
  return isOpenableDocument(path) ? "open" : "panel";
}

/** A reply's cards in marker order, images side by side: a run of
 * thumbnails wraps as one row, every other file is a line of its own. */
export type FileCardRun =
  | { kind: "images"; paths: string[] }
  | { kind: "file"; path: string };

export function fileCardRuns(
  paths: readonly string[],
  asThumbnail: (path: string) => boolean,
): FileCardRun[] {
  const runs: FileCardRun[] = [];
  for (const path of paths) {
    if (!asThumbnail(path)) {
      runs.push({ kind: "file", path });
      continue;
    }
    const last = runs[runs.length - 1];
    if (last?.kind === "images") last.paths.push(path);
    else runs.push({ kind: "images", paths: [path] });
  }
  return runs;
}

/** How many characters before the extension stay with it when a name
 * is cut: 「Banner-草稿-f…inal.png」 reads as the same file, 「Banner-草…png」
 * hardly. */
const TAIL_STEM_CHARS = 4;

/**
 * A file name in two parts for a middle cut: the head truncates (CSS
 * ellipsis), the tail — the extension and the few characters before it
 * — never does. A name too short to cut, or with no extension, keeps
 * no stem in the tail. By code point, so a CJK name never splits a
 * surrogate pair.
 */
export function splitFileName(name: string): { head: string; tail: string } {
  const dot = name.lastIndexOf(".");
  // A leading dot is a dotfile's name, not an extension; a very long
  // "extension" is part of the name.
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
  const stem = Array.from(ext ? name.slice(0, dot) : name);
  const keep = ext && stem.length > TAIL_STEM_CHARS * 2 ? TAIL_STEM_CHARS : 0;
  return {
    head: stem.slice(0, stem.length - keep).join(""),
    tail: stem.slice(stem.length - keep).join("") + ext,
  };
}

/** The folder a file sits in, as the path wrote it (`FolderPathText`
 * shortens the home part to `~`); empty when the path names no folder. */
export function fileFolder(path: string): string {
  const windows =
    /^[A-Za-z]:(?:[\\/]|$)/.test(path) ||
    (path.includes("\\") && !path.startsWith("/"));
  const stripped = path.replace(windows ? /[\\/]+$/ : /\/+$/, "");
  const cut = windows
    ? Math.max(stripped.lastIndexOf("/"), stripped.lastIndexOf("\\"))
    : stripped.lastIndexOf("/");
  if (cut < 0) return "";
  const folder = stripped.slice(0, cut);
  // The root itself: 「/」, 「C:\」.
  if (folder === "") return stripped.slice(0, 1);
  if (windows && /^[A-Za-z]:$/.test(folder)) return stripped.slice(0, cut + 1);
  return folder;
}

/** The card's glyph, by name (and a folder by Core's answer). */
export type FileGlyph =
  | "folder"
  | "image"
  | "pdf"
  | "doc"
  | "sheet"
  | "csv"
  | "slides"
  | "html"
  | "markdown"
  | "text"
  | "code"
  | "archive"
  | "audio"
  | "video"
  | "file";

const GLYPH_BY_EXTENSION: Record<string, FileGlyph> = {
  pdf: "pdf",
  doc: "doc",
  docx: "doc",
  rtf: "doc",
  odt: "doc",
  pages: "doc",
  xls: "sheet",
  xlsx: "sheet",
  numbers: "sheet",
  ods: "sheet",
  csv: "csv",
  tsv: "csv",
  ppt: "slides",
  pptx: "slides",
  key: "slides",
  odp: "slides",
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  txt: "text",
  log: "text",
  rst: "text",
  zip: "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  "7z": "archive",
  rar: "archive",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  flac: "audio",
  aac: "audio",
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  avi: "video",
  svg: "image",
  heic: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
};

export function fileGlyph(
  path: string,
  presence: FilePresence | undefined,
): FileGlyph {
  if (
    presence?.state === "present" &&
    presence.kind === "directory" &&
    !documentPackage(path, presence)
  ) {
    return "folder";
  }
  const name = fileName(path);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const byName = GLYPH_BY_EXTENSION[ext];
  if (byName) return byName;
  const preview = previewKindByPath(path);
  if (preview === "image") return "image";
  if (preview === "text") return "code";
  return "file";
}
