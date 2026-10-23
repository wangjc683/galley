/**
 * How wide text sets, counted in columns the way a monospace grid counts
 * it: a wide character (CJK, Hangul, fullwidth forms, emoji) takes two,
 * anything else one. An estimate, not a measurement, for rules that have
 * to decide from the text alone: how much of a whole message a quote
 * takes (composer-quote.ts) and which table columns are short enough to
 * keep on one line (table-short-columns.ts).
 */

/** A code point that takes two columns: CJK, Hangul, fullwidth forms,
 * emoji. */
const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

/** One character's columns: 2 if it is wide, else 1. */
export function charColumns(char: string): number {
  return WIDE.test(char) ? 2 : 1;
}

/** A text's columns: its characters' added up. */
export function textColumns(text: string): number {
  let width = 0;
  for (const char of text) width += charColumns(char);
  return width;
}
