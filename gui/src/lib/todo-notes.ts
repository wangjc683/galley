import { fileName, localFilePath } from "@/lib/local-file-path";

/**
 * A to-do's notes as the panel reads them (main chat ticket 112, PRD
 * ruling 158 point 3). The notes stay one block of text Galley and the
 * user both write (the box that changes them shows it as written); the
 * panel only draws it apart:
 *
 * - **Paragraphs**: each line is one, a run of blank lines one gap
 *   between two (6px in the open row).
 * - **The day**: a paragraph that starts with a day and a colon
 *   (「10月29日：」, `Oct 29:`, a month's short name and the day) has
 *   that stretch apart, a step darker than the rest (`ink-soft`,
 *   tabular digits): Galley's progress lines start so (ticket 108), and
 *   the day is what the eye runs down.
 * - **A file**: a full path in backticks (absolute, `~/…`, `file://`, a
 *   Windows drive or UNC: `localFilePath`, the reply's rule) is that
 *   file, drawn by its name alone, the backticks gone — clickable in the
 *   open row as a reply's file reference. Backticks round anything else,
 *   and a path with none, stay words as written (a reply's text is not
 *   scanned for bare paths either).
 *
 * Every piece knows where it starts in the notes, so a click in the
 * drawn text puts the caret at that place in the box.
 */

/** A stretch of one paragraph. */
export type TodoNotesPiece =
  | {
      /** The leading day and its colon (「10月29日：」). */
      kind: "day";
      text: string;
      /** Where it starts in the notes. */
      start: number;
    }
  | { kind: "text"; text: string; start: number }
  | {
      /** A full path in backticks: the file, by its name. */
      kind: "path";
      path: string;
      name: string;
      /** Where the opening backtick is, and just past the closing one. */
      start: number;
      end: number;
    };

/** One line of the notes that is not blank. */
export interface TodoNotesParagraph {
  /** Where the line starts in the notes. */
  start: number;
  pieces: TodoNotesPiece[];
}

/** 「10月29日：」 (spaces between the parts allowed, either colon). */
const ZH_DAY = /^\d{1,2}\s*月\s*\d{1,2}\s*日\s*[：:]/;
/** `Oct 29:`, `Sept 3:`, `Oct. 29:`: a month's short name, the day. */
const EN_DAY =
  /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.?\s+\d{1,2}\s*:/;

/** How long the day a line starts with is (with its colon); 0 for none. */
export function todoNotesDay(line: string): number {
  return (ZH_DAY.exec(line) ?? EN_DAY.exec(line))?.[0].length ?? 0;
}

/** A span in single backticks within one line. */
const BACKTICKS = /`([^`\n]+)`/g;

/** A backtick span's path, by CommonMark's rule for inline code (one
 * space off each end when both have one, as the reply's Markdown reads
 * it), or null when it is not a full path. */
function spanPath(inner: string): string | null {
  const code =
    inner.length > 2 &&
    inner.startsWith(" ") &&
    inner.endsWith(" ") &&
    inner.trim()
      ? inner.slice(1, -1)
      : inner;
  return localFilePath(code);
}

/** One line's pieces: its day, then words and files in their order. */
function linePieces(line: string, start: number): TodoNotesPiece[] {
  const pieces: TodoNotesPiece[] = [];
  const day = todoNotesDay(line);
  if (day > 0) pieces.push({ kind: "day", text: line.slice(0, day), start });
  let from = day;
  const words = (to: number) => {
    if (to > from) {
      pieces.push({
        kind: "text",
        text: line.slice(from, to),
        start: start + from,
      });
    }
  };
  for (const match of line.matchAll(BACKTICKS)) {
    const at = match.index;
    if (at < day) continue;
    const path = spanPath(match[1]);
    if (!path) continue;
    words(at);
    const end = at + match[0].length;
    pieces.push({
      kind: "path",
      path,
      name: fileName(path),
      start: start + at,
      end: start + end,
    });
    from = end;
  }
  words(line.length);
  return pieces;
}

/** The notes as the open row draws them: a paragraph a line that is
 * not blank, each in its pieces. */
export function todoNotesParagraphs(notes: string): TodoNotesParagraph[] {
  const paragraphs: TodoNotesParagraph[] = [];
  let start = 0;
  for (const raw of notes.split("\n")) {
    // A Windows break's \r stays out of the drawn words.
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.trim()) {
      paragraphs.push({ start, pieces: linePieces(line, start) });
    }
    start += raw.length + 1;
  }
  return paragraphs;
}

/** The notes as the folded row's one line says them: a full path in
 * backticks only its file's name, the backticks gone, every break and
 * run of space one space. The day is not set apart there: folded, a
 * row keeps its three inks (ruling 146). */
export function todoNotesFolded(notes: string): string {
  return notes
    .split("\n")
    .map((line) =>
      line.replace(BACKTICKS, (whole, inner: string) => {
        const path = spanPath(inner);
        return path ? fileName(path) : whole;
      }),
    )
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}
