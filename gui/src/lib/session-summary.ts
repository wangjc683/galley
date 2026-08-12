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
const LEGACY_STEP_PREFIX = /^第\s*\d+\s*步\s*·\s*/;

export function cleanSessionSummary(raw: string): string {
  let s = raw.replace(LEGACY_STEP_PREFIX, "");
  // Complete protocol/markup tags, with or without attributes:
  // <suggestion>, </summary>, <invoke name="code_run">, …
  s = s.replace(/<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g, " ");
  // Tag halves chopped by smart_format's middle truncation: an
  // unterminated "<sugg" / "<invoke nam" head before the " ... "
  // marker, or an orphan "estion>" / 'e_run">' tail right after it.
  s = s.replace(/<[\w/-]*(?:\s[^<>]*)?(?=\s*\.\.\.(\s|$))/g, "");
  s = s.replace(/(\.\.\.\s*)[\w"'=/-]+>/g, "$1");
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

/**
 * The runner's fixed replacement summary for a turn whose reply was
 * leaked tool-call markup (workbench_bridge.TURN_PROTOCOL_FAILURE_SUMMARY
 * — keep the string in sync). Matched exactly here so the GUI can
 * localize what the runner wrote into SQLite.
 */
const TURN_PROTOCOL_FAILURE_SUMMARY = "回合协议错误：工具调用未能送达";

/**
 * A summary that STARTS with tool-call markup (`<invoke …` /
 * `<parameter …`). GA's fallback recap starts at the reply's first
 * character, so a reply that was really a leaked-as-text tool call
 * (third-party proxies that never translate tool calls into
 * structured blocks — #22) puts the markup right at the front.
 * Same shape rule as the runner's _TOOL_MARKUP_START_RE.
 */
const TOOL_MARKUP_START = /^\s*<\/?(?:invoke|parameter)[\s>/]/;

/**
 * True when the stored summary is really a turn-protocol failure:
 * either raw leaked markup (historical rows, attach-mode GA) or the
 * runner's replacement marker (new rows). Callers show localized
 * copy (`copy.sidebar.turnProtocolFailure`) instead of cleaning —
 * tag-stripped markup is script residue with zero information.
 */
export function isProtocolFailureSummary(raw: string): boolean {
  const s = raw.replace(LEGACY_STEP_PREFIX, "");
  return TOOL_MARKUP_START.test(s) || s.trim() === TURN_PROTOCOL_FAILURE_SUMMARY;
}

/**
 * The one-stop display form of `session.summary`: localized
 * protocol-failure label when the row is a leaked-markup casualty,
 * repaired recap text otherwise. `protocolFailureLabel` is the
 * caller's `copy.sidebar.turnProtocolFailure`.
 */
export function displaySessionSummary(
  raw: string,
  protocolFailureLabel: string,
): string {
  return isProtocolFailureSummary(raw)
    ? protocolFailureLabel
    : cleanSessionSummary(raw);
}
