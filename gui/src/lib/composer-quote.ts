/**
 * Quoting a conversation selection into the composer (telegram-details
 * ticket 02): the floating toolbar's 「引用」 puts the selected text in
 * the composer as a Markdown quote, so 「这一句什么意思」 can follow it.
 * Telegram's selection menu turns 「回复」 into 「引用并回复」 the same
 * way; ours has no reply bar — the quote is plain text in the composer
 * and is sent as such.
 */

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
 * The composer's text after quoting `selected` into it: the quote, then
 * one blank line and the caret's line (a line typed right under a quote
 * would otherwise continue it). An empty composer gets the quote alone;
 * text already there keeps it and the quote follows after one blank
 * line — the caret's old place was lost when the conversation text was
 * selected, so this does not guess at it. A selection with no text
 * leaves the composer as it was.
 */
export function textWithQuote(existing: string, selected: string): string {
  const quote = markdownQuote(selected);
  if (quote === "") return existing;
  const head = existing.trimEnd();
  return head === "" ? `${quote}\n\n` : `${head}\n\n${quote}\n\n`;
}
