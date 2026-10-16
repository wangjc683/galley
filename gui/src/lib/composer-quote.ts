import { isSideQuestion } from "@/lib/side-question";

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
