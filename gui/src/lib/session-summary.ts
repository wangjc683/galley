/**
 * Display-side cleaner for `session.summary`.
 *
 * session.summary is GA's per-turn recap. Two dirty shapes live in the
 * DB and must be repaired at render time (historical rows are not
 * migrated):
 *
 *   - Legacy prefix: early bumpSessionAfterTurn wrote
 *     "第 N 步 · {text}" into the field directly.
 *   - GA fallback recap: when the model omits <summary>, GA's
 *     turn_end_callback falls back to the raw reply body — markdown
 *     markers and protocol tags like <suggestion> survive, and
 *     smart_format's middle truncation (" ... ") can chop a tag in
 *     half, leaving fragments like "estion>".
 *
 * The runner sanitizes new summaries at the source
 * (workbench_bridge._clean_turn_summary — keep the rules in sync);
 * this helper covers rows persisted before that fix and any summary
 * arriving through an external/attach-mode GA.
 */
export function cleanSessionSummary(raw: string): string {
  let s = raw.replace(/^第\s*\d+\s*步\s*·\s*/, "");
  // Complete protocol/markup tags: <suggestion>, </summary>, …
  s = s.replace(/<\/?[a-zA-Z][\w-]*>/g, " ");
  // Tag halves chopped by smart_format's middle truncation: an
  // unterminated "<sugg" head before the " ... " marker, or an orphan
  // "estion>" tail right after it.
  s = s.replace(/<[\w/-]*(?=\s*\.\.\.(\s|$))/g, "");
  s = s.replace(/(\.\.\.\s*)[\w/-]+>/g, "$1");
  // Markdown noise from raw-reply fallbacks: heading marks, emphasis
  // runs, backticks. Single "*" / "_" stay (they may be literal text).
  // No leading-whitespace guard on headings: GA strips newlines before
  // truncating, so "###" often lands glued to the previous sentence.
  s = s.replace(/#{1,6}(?=\s|$)/g, " ");
  s = s.replace(/[*_]{2,}|`+/g, "");
  // GA's ASCII truncation marker → single-glyph ellipsis.
  s = s.replace(/\s*\.\.\.\s*/g, " … ");
  return s.replace(/\s+/g, " ").trim();
}
