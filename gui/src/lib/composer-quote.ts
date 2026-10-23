import { isSideQuestion } from "@/lib/side-question";
import { charColumns, textColumns } from "@/lib/text-columns";

/**
 * Quoting a conversation selection (telegram-details tickets 02, 07).
 * The floating toolbar's 「引用」 adds the selected text to the
 * composer's quotes: a strip above the input, one row per quote, not
 * text in the input (ruling 3a — the `> ` lines in a plain textarea
 * looked crude). The message is written only when it is sent: the
 * quotes as Markdown quote blocks, then your words. A bubble reads them
 * back off the head of the message and draws them apart from your
 * words. Telegram's selection menu turns 「回复」 into 「引用并回复」
 * the same way; there is no jump back to the source (ruling 3a item 4).
 */

/** Quotes one message can carry. Past it the 「引用」 is refused with a
 * note: replacing the oldest would drop one the user picked, unseen. */
export const QUOTE_LIMIT = 3;

/**
 * `selected` as one Markdown quote block: every line behind `> `, a
 * blank line as a bare `>` so the block does not break, runs of blank
 * lines (paragraph gaps in the selection) as one, and no blank lines at
 * either end.
 */
export function markdownQuote(selected: string): string {
  const lines = selected.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const blank = line.trim().length === 0;
    if (blank) {
      if (out.length > 0 && out[out.length - 1] !== ">") out.push(">");
      continue;
    }
    out.push(`> ${line.trimEnd()}`);
  }
  while (out.length > 0 && out[out.length - 1] === ">") out.pop();
  return out.join("\n");
}

/**
 * The text a message with quotes is sent as: each quote a Markdown
 * quote block, the blocks a blank line apart, then a blank line and
 * `text` (already trimmed by the caller). Without quotes it is `text`.
 * A `/btw` side question keeps `/btw ` at the very head — the bridge
 * and GA route on it — with the quotes on the lines after it.
 */
export function composeQuotedMessage(
  quotes: readonly string[],
  text: string,
): string {
  const blocks = quotes.map(markdownQuote).filter((block) => block !== "");
  if (blocks.length === 0) return text;
  const quoted = blocks.join("\n\n");
  if (isSideQuestion(text)) {
    const rest = text.trimStart().slice("/btw".length).trim();
    return `/btw \n${quoted}${rest ? `\n\n${rest}` : ""}`;
  }
  return text ? `${quoted}\n\n${text}` : quoted;
}

export interface QuotedMessage {
  /** The quotes at the head of the message, `>` markers off, in order. */
  quotes: string[];
  /** The rest: the sender's own words ("" when it is quotes only). */
  body: string;
}

const QUOTE_LINE = /^ {0,3}> ?(.*)$/;

/**
 * Read the quotes off the head of a message: the leading run of `>`
 * lines, quote blocks separated by blank lines, up to the first line
 * that is neither. Only the head: a `>` further down is the sender's
 * text like any other. A message typed with a leading `>` reads as a
 * quote too — that is what the Markdown says. A `/btw ` line ahead of
 * the quotes (composeQuotedMessage's side question) stays at the head
 * of the body. Without quotes the body is `text` as it came.
 */
export function splitQuotedMessage(text: string): QuotedMessage {
  const normalized = text.replace(/\r\n?/g, "\n");
  let head = "";
  let rest = normalized;
  const btw = /^\/btw[ \t]*\n/.exec(rest);
  if (btw && QUOTE_LINE.test(rest.slice(btw[0].length).split("\n", 1)[0])) {
    head = "/btw ";
    rest = rest.slice(btw[0].length);
  }
  const lines = rest.split("\n");
  const quotes: string[] = [];
  let block: string[] | null = null;
  const close = () => {
    if (block) {
      const quote = block.join("\n").trim();
      if (quote) quotes.push(quote);
    }
    block = null;
  };
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const quoteLine = QUOTE_LINE.exec(line);
    if (quoteLine) {
      block ??= [];
      block.push(quoteLine[1].trimEnd());
      continue;
    }
    if (line.trim() === "" && (block || quotes.length > 0)) {
      close();
      continue;
    }
    break;
  }
  close();
  if (quotes.length === 0) return { quotes: [], body: text };
  const body = lines.slice(i).join("\n").trim();
  return { quotes, body: head ? `${head}${body}`.trimEnd() : body };
}

/**
 * How much of a whole message the message menu's 「引用」 takes (main
 * chat ticket 38, ruling 85): its first lines, at most three and about
 * 120 CJK characters (240 columns, a CJK character two), then 「…」.
 * That is what your bubble shows of a quote anyway: MessageQuotes clamps
 * it to three lines, and a line of your 560px bubble holds about 39 CJK
 * characters at the standard size. The quote says which message you
 * mean; the assistant has the whole of it in the conversation.
 */
export const WHOLE_QUOTE_LINES = 3;
export const WHOLE_QUOTE_COLUMNS = 240;

/** The longest head of `line` within `budget` columns, and whether that
 * is all of it. */
function headWithin(line: string, budget: number): [string, boolean] {
  let width = 0;
  let head = "";
  for (const char of line) {
    width += charColumns(char);
    if (width > budget) return [head, false];
    head += char;
  }
  return [head, true];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const TABLE_DELIMITER = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const SETEXT_UNDERLINE = /^ {0,3}=+\s*$/;

/** One line of a reply as it reads: Markdown markers off (headings,
 * quotes, emphasis, code spans, link targets, images, tags), a bullet
 * as 「•」, a numbered item's number kept, spaces collapsed. */
function readMarkdownLine(line: string): string {
  return line
    .replace(/^ {0,3}(>\s?)+/, "")
    .replace(/^ {0,3}#{1,6}\s+/, "")
    .replace(/\s+#+\s*$/, "")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "• ")
    .replace(/^\s*[-*+]\s+/, "• ")
    .replace(/^\s+(\d+[.)]\s)/, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
    .replace(/<\/?[a-zA-Z][^<>]*>/g, "")
    .replace(/\*\*|__|~~|`+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A table row's cells, ` | ` between them. */
function readTableRow(line: string): string {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => readMarkdownLine(cell))
    .filter((cell) => cell !== "")
    .join(" | ");
}

/**
 * The lines a reply's quote is read from, and whether anything after
 * them was left out. Prose runs until the first code block or table:
 * neither reads as a quote, so the prose before it is the quote; a reply
 * that opens with one is quoted by its first line (the first line of
 * code, the table's header row).
 */
function markdownLines(source: string): { lines: string[]; more: boolean } {
  const raw = source.split("\n");
  const lines: string[] = [];
  const hasTextFrom = (from: number) =>
    raw.slice(from).some((line) => line.trim() !== "");
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (line.trim() === "") continue;
    const fence = FENCE.exec(line);
    const table =
      line.includes("|") &&
      i + 1 < raw.length &&
      raw[i + 1].includes("|") &&
      TABLE_DELIMITER.test(raw[i + 1]);
    if (fence || table) {
      if (lines.length > 0) return { lines, more: true };
      if (!fence) return { lines: [readTableRow(line)], more: true };
      let close = raw.length;
      for (let j = i + 1; j < raw.length; j++) {
        if (raw[j].trim().startsWith(fence[1])) {
          close = j;
          break;
        }
      }
      const code = raw
        .slice(i + 1, close)
        .map((codeLine) => codeLine.trim())
        .filter((codeLine) => codeLine !== "");
      if (code.length === 0) {
        // An empty block says nothing: read on after it.
        i = close;
        continue;
      }
      return {
        lines: [code[0]],
        more: code.length > 1 || hasTextFrom(close + 1),
      };
    }
    if (THEMATIC_BREAK.test(line) || SETEXT_UNDERLINE.test(line)) continue;
    const text = readMarkdownLine(line);
    if (text) lines.push(text);
  }
  return { lines, more: false };
}

/**
 * The text the message menu's 「引用」 puts in the quote strip (main chat
 * ticket 38): the message whole when it is short, else its first lines
 * within {@link WHOLE_QUOTE_LINES} and {@link WHOLE_QUOTE_COLUMNS},
 * ending 「…」 where something was left out. `markdown`: a reply (its
 * Markdown read as it shows, up to a code block or a table); otherwise
 * your plain words, the quotes at their head left out unless they are
 * all there is. Blank lines go. "" when there is no text.
 */
export function wholeMessageQuote(text: string, markdown: boolean): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  let lines: string[];
  let more = false;
  if (markdown) {
    ({ lines, more } = markdownLines(normalized));
  } else {
    const { quotes, body } = splitQuotedMessage(normalized);
    lines = (body || quotes.join("\n"))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
  }
  const out: string[] = [];
  let left = WHOLE_QUOTE_COLUMNS;
  for (let i = 0; i < lines.length; i++) {
    if (out.length === WHOLE_QUOTE_LINES || left <= 0) {
      more = true;
      break;
    }
    const [head, whole] = headWithin(lines[i], left);
    if (head !== "") out.push(head);
    left -= textColumns(head);
    if (!whole) {
      more = true;
      break;
    }
  }
  if (out.length === 0) return "";
  if (more) {
    // No separator left dangling before the 「…」.
    const last = out[out.length - 1].replace(/[\s,，、;；:：]+$/, "");
    out[out.length - 1] = `${last}…`;
  }
  return out.join("\n");
}

/** One line for a preview of a message (sidebar card, question rail,
 * queue strip): the sender's own words, or with none, the quotes. */
export function quotedMessagePreview(text: string): string {
  const { quotes, body } = splitQuotedMessage(text);
  return body || quotes.join(" ");
}

export interface SnippetSegment {
  /** A quote's text (markers off), or the sender's own. */
  quote: boolean;
  text: string;
}

/**
 * A search snippet of one of your messages (⌘K / ⌘F, Core's FTS
 * `snippet()`: a short window of the raw text with `«` / `»` around the
 * hits) cut into quote and own-words runs, so a hit inside a quote reads
 * as one. A line starting `>` (after the snippet's `…`, if it opens with
 * one) is a quote line; consecutive lines of a kind join with a space.
 * A window that starts mid-line cannot tell, and reads as your words.
 */
export function snippetQuoteSegments(raw: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const quoted = /^(…?) {0,3}> ?(.*)$/.exec(line);
    const quote = quoted !== null;
    const text = quoted ? quoted[1] + quoted[2] : line;
    if (text.trim() === "") continue;
    const last = segments[segments.length - 1];
    if (last && last.quote === quote) last.text = `${last.text} ${text}`;
    else segments.push({ quote, text });
  }
  return segments;
}
