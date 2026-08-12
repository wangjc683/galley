/**
 * Close hanging code spans and link destinations in a *streaming* markdown
 * tail, so already-rendered text stops being rewritten as the closer arrives.
 *
 * ## The problem
 *
 * While a paragraph streams, `` `core/src/session/lifecycle.rs `` parses as
 * literal text — backtick and all. The moment the closing backtick lands, the
 * two backticks vanish and the run switches from serif to mono at 0.92em with
 * a pill background. Text that was already laid out changes width, so the
 * paragraph re-wraps behind the cursor. Links are far worse: the whole
 * destination is on screen as literal text until the `)` arrives, then ~40
 * characters disappear at once.
 *
 * Measured on a representative Chinese technical answer (509 chars, 20 Hz
 * flush cadence): 16 retroactive rewrites, one every ~32 characters, 230
 * characters displaced in total with a single worst case of 75. By construct,
 * code spans accounted for ~59% of the displacement and links ~35%.
 *
 * ## What this does
 *
 * Appends the missing closer to the *displayed* string only. Callers apply it
 * to the streaming partial; the settled turn renders the raw source. That
 * split is free here — the in-flight partial and the finished turn are already
 * two different render paths — so a marker that genuinely never closes settles
 * honestly with one flip at the end instead of jittering throughout.
 *
 * ## What this deliberately does NOT do
 *
 * - **Emphasis** (`**`, `*`, `_`, `~~`). It measured at ~6% of the
 *   displacement while carrying most of the complexity: correct CommonMark
 *   delimiter-run resolution needs an open-delimiter stack with nesting and
 *   "closers owed" bookkeeping, and a wrong guess makes text flip from italic
 *   to bold mid-stream — a new flicker in place of the old one. Bad trade.
 * - **Tables.** `| a | b |` renders as a paragraph until the delimiter row
 *   arrives, then relayouts wholesale. That is GFM's grammar, not a hanging
 *   marker; nothing can be appended to fix it.
 * - **Bare `[text`** with no `](` yet. A bracket in prose is far more common
 *   than a link, and guessing wrong would style ordinary text as a link.
 *
 * The scanner is deliberately approximate rather than a second CommonMark
 * implementation: any mid-stream misjudgement is corrected by the very next
 * flush or by the settle, so "stable and close to the final parse" beats
 * "exactly right".
 */

/**
 * Destination given to a link whose URL is still streaming.
 *
 * `markdownUrlTransform` maps it to `null`, which drops the `href` entirely:
 * the anchor still matches the `[&_a]` prose rules so it looks like a link and
 * nothing shifts when the real URL lands, but there is nothing to click. That
 * matters — GFM's autolink literal already turns a half-typed `https://exa`
 * into a live anchor today, and mending without this would keep that hazard
 * while making it more inviting.
 */
export const PENDING_LINK_HREF = "galley:pending-link";

export function mendStreamingMarkdown(source: string): string {
  if (source === "") return source;

  const start = lastBlockStart(source);
  // `null` = the tail is inside an open fence. Everything there is literal
  // code; a backtick or bracket in it means nothing.
  if (start === null) return source;

  const scan = scanTail(source.slice(start));
  switch (scan.kind) {
    case "link":
      // Everything from the `(` onward is a partial URL. Replacing it (rather
      // than appending `)`) is what removes the destination from the display,
      // which is where the large displacement comes from.
      return `${source.slice(0, start + scan.at + 1)}${PENDING_LINK_HREF})`;
    case "code":
      return source + "`".repeat(scan.len);
    case "none":
      return source;
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Byte offset of the last top-level block, or `null` when the source ends
 * inside an open fence.
 *
 * Appending to a markdown source cannot change anything before the last
 * block's start, so that offset bounds how much of the document a hanging
 * marker could possibly belong to. It also keeps the scanner off backticks
 * that closed several paragraphs ago.
 *
 * This is a full pass per flush, but the markdown parse it feeds is already
 * O(n) over the same string, so it costs a constant factor rather than a
 * complexity class. Fence tracking is why it cannot simply search backwards
 * for the last blank line: a blank line inside a fenced block is not a block
 * boundary.
 */
function lastBlockStart(source: string): number | null {
  let index = 0;
  let blockStart = 0;
  let fence: string | null = null;
  let prevBlank = true;

  for (;;) {
    const newline = source.indexOf("\n", index);
    const end = newline === -1 ? source.length : newline;
    const line = source.slice(index, end);
    const marker = FENCE.exec(line)?.[1];

    if (fence === null) {
      if (line.trim() === "") {
        prevBlank = true;
      } else {
        if (prevBlank) blockStart = index;
        prevBlank = false;
        if (marker) fence = marker;
      }
    } else {
      // Only a same-character run at least as long as the opener closes a
      // fence; blank lines inside one are content, not boundaries.
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
    }

    if (newline === -1) break;
    index = end + 1;
  }

  return fence === null ? blockStart : null;
}

type Scan =
  | { kind: "none" }
  /** An open code span: `len` backticks are owed. */
  | { kind: "code"; len: number }
  /** A link destination running off the end; `at` indexes its `(`. */
  | { kind: "link"; at: number };

function scanTail(tail: string): Scan {
  let index = 0;
  // Backticks owed by an open code span; 0 when none is open.
  let codeLen = 0;
  // Guards against mending `path is \`` into an empty span. An opener with
  // nothing after it is not yet emphasis of anything, and CommonMark would
  // leave the empty result literal anyway.
  let codeContent = false;
  let brackets = 0;

  while (index < tail.length) {
    const char = tail[index];

    if (codeLen === 0 && char === "\\") {
      index += 2;
      continue;
    }

    if (char === "`") {
      let run = 1;
      while (tail[index + run] === "`") run += 1;
      if (codeLen === 0) {
        codeLen = run;
        codeContent = false;
      } else if (run === codeLen) {
        codeLen = 0;
      } else {
        // A shorter or longer run inside a span is ordinary content.
        codeContent = true;
      }
      index += run;
      continue;
    }

    if (codeLen > 0) {
      codeContent = true;
      index += 1;
      continue;
    }

    if (char === "[") {
      brackets += 1;
      index += 1;
      continue;
    }

    if (char === "]") {
      const wasOpen = brackets > 0;
      if (wasOpen) brackets -= 1;
      if (wasOpen && tail[index + 1] === "(") {
        const paren = index + 1;
        const close = findDestinationEnd(tail, paren + 1);
        if (close === null) return { kind: "link", at: paren };
        index = close + 1;
        continue;
      }
      index += 1;
      continue;
    }

    index += 1;
  }

  return codeLen > 0 && codeContent ? { kind: "code", len: codeLen } : { kind: "none" };
}

/** Index of the `)` closing a link destination, or `null` if it never comes. */
function findDestinationEnd(tail: string, from: number): number | null {
  let depth = 0;
  for (let index = from; index < tail.length; index += 1) {
    const char = tail[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return null;
}
