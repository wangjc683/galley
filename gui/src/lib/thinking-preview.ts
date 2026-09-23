// Pure helpers for the live thinking preview under the in-flight step
// row (ThinkingPreview, 2026-09-23). Kept out of the component file so
// they are testable and the component file exports components only.

/**
 * How much reasoning the clipped preview hands to the markdown
 * renderer. The box shows three lines — roughly 150 CJK / 300 Latin
 * characters at the compact column — so 1500 leaves a wide margin for
 * paragraph gaps, lists and short lines while keeping the per-tick
 * parse constant: reasoning routinely runs past 10k characters and
 * updates at token rate, and re-parsing all of it 20 times a second
 * would put a long thinking step on the main thread for nothing the
 * reader can see.
 */
export const THINKING_PREVIEW_TAIL_CHARS = 1500;

/**
 * The cut point moves in steps of this many characters, not with every
 * token. A paragraph's line breaks are computed from where it starts:
 * a cut that crept forward per token through one long paragraph would
 * re-wrap the visible bottom lines on every tick. Stepped, the cut sits
 * still for ~500 characters at a time and the rolling box only ever
 * moves by whole lines.
 */
const TAIL_STEP_CHARS = 500;

/**
 * The tail of `text` the clipped preview renders: the last
 * `maxChars`..`maxChars + 500` characters, starting at a paragraph
 * boundary when one lies in the first half of that window (else a
 * line boundary, else a raw cut). Returns `text` unchanged while it is
 * short enough.
 *
 * A cut that lands inside a fenced code block re-opens the fence at
 * the top of the tail — otherwise the block's closing fence would read
 * as an opener and flip every line after it between prose and code.
 */
export function thinkingPreviewTail(
  text: string,
  maxChars = THINKING_PREVIEW_TAIL_CHARS,
): string {
  const start =
    Math.floor((text.length - maxChars) / TAIL_STEP_CHARS) * TAIL_STEP_CHARS;
  if (start <= 0) return text;
  // The boundary search only reads text at least `maxChars / 2` behind
  // the end, which streaming never rewrites — so the cut is a pure
  // function of `start` and holds still between steps.
  const searchEnd = start + Math.floor(maxChars / 2);
  let cut = boundaryAfter(text, "\n\n", start, searchEnd);
  if (cut === -1) cut = boundaryAfter(text, "\n", start, searchEnd);
  if (cut === -1) {
    cut = start;
    // Never split a surrogate pair (emoji, rare CJK).
    const code = text.charCodeAt(cut);
    if (code >= 0xdc00 && code <= 0xdfff) cut += 1;
  }
  const fence = openFenceAt(text.slice(0, cut));
  const tail = text.slice(cut);
  return fence ? `${fence}\n${tail}` : tail;
}

function boundaryAfter(
  text: string,
  separator: string,
  from: number,
  before: number,
): number {
  const i = text.indexOf(separator, from);
  return i !== -1 && i < before ? i + separator.length : -1;
}

/** The fence marker (e.g. "```") of a code block still open at the end
 * of `head`, or null. CommonMark rules, simplified: a fence line is up
 * to three spaces then 3+ backticks or tildes; a closer uses the same
 * character at least as many times and carries nothing else. */
function openFenceAt(head: string): string | null {
  if (!head.includes("```") && !head.includes("~~~")) return null;
  let open: string | null = null;
  for (const line of head.split("\n")) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!m) continue;
    const [, marker, rest] = m;
    if (open === null) {
      open = marker;
    } else if (
      marker[0] === open[0] &&
      marker.length >= open.length &&
      rest.trim() === ""
    ) {
      open = null;
    }
  }
  return open;
}
