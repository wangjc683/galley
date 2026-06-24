// ---------------- GA tag stripping ----------------

const GA_TAG_PATTERNS: RegExp[] = [
  /<thinking>[\s\S]*?<\/thinking>/g,
  /<summary>[\s\S]*?<\/summary>/g,
  /<tool_use>[\s\S]*?<\/tool_use>/g,
  /<file_content[^>]*>[\s\S]*?<\/file_content>/g,
];

const FILE_REF_PATTERN = /\[FILE:[^\]]+\]/g;

/**
 * Strip GA's internal structured tags + file refs from a free-text
 * field the LLM wrote. Used for ask_user's `question` / `candidates`:
 * those arrive raw from the tool args, and the LLM occasionally wraps
 * its turn recap in `<summary>...</summary>` (GA's internal one-liner
 * already surfaced separately via TurnMarker). Same tag set + file-ref
 * cleanup as `cleanPartialContent` / `extractPreamble`, minus the
 * streaming-partial / unclosed-tag handling (tool args are complete
 * payloads, never partial). Returns "" when nothing user-facing
 * remains — callers keep that as a valid empty question/candidate.
 */
export function stripGATags(text: string): string {
  if (!text) return "";
  let out = text;
  for (const p of GA_TAG_PATTERNS) out = out.replace(p, "");
  out = out.replace(FILE_REF_PATTERN, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/**
 * GA's `agent_loop.py` prints `LLM Running (Turn N) ...` (sometimes
 * wrapped in `**...**`) to the display queue at the start of every
 * turn. It's a frontend-side marker — every official GA frontend
 * (dcapp / tgapp / qtapp / stapp / wechatapp) strips it before
 * showing the user. We do the same: this string should never reach
 * the conversation document; our own per-turn placeholder
 * ("第 N 轮 · 思考中…") covers the same UX intent in the product's
 * voice.
 *
 * Pattern matches the line on its own row, with optional surrounding
 * `**` markdown bold markers, leading/trailing whitespace, and any
 * turn number.
 */
const LLM_RUNNING_MARKER =
  /^\s*\*{0,2}LLM Running \(Turn \d+\) \.\.\.\*{0,2}\s*$/gm;

/**
 * GA's `agent_loop.py:73` yields a display-only line of the form
 * `🛠️ tool_name(compact_args)` to the display queue every time a
 * tool dispatches. It's meant for GA's terminal frontends (dcapp /
 * tgapp / qtapp) — the structured tool call arrives separately via
 * turn_end's `toolCalls[]`, which the conversation renders as a
 * proper ToolCallout pill.
 *
 * Without stripping, the streaming partial flashes the raw marker as
 * document prose, then snaps to the compact pill when turn_end fires
 * — a noticeable "floppy" transition users notice right away.
 *
 * The variation selector after the hammer (`️`) is optional —
 * some renderers and terminal pipes drop it.
 */
const TOOL_DISPATCH_MARKER_LINE = /^🛠️?\s+\w+\(.*\)[ \t]*$/gm;

/**
 * Mid-stream partial of the dispatch marker — chunk boundary fell
 * after the prefix but before the closing paren. Same role as the
 * unclosed-tag truncation: avoid showing "🛠 web_exec" for one
 * frame while we wait for the rest of the chunk.
 */
const TOOL_DISPATCH_MARKER_PARTIAL = /🛠️?\s+\w+\(/;

/**
 * Verbose-mode tool dispatch marker — emitted by `agent_loop.py:72`
 * when GA runs with `verbose=True` (which Galley's bridge sets so
 * the LLM streams per-token). Format:
 *
 *   🛠️ Tool: `tool_name`  📥 args:
 *   ````text
 *   {pretty JSON args}
 *   ````
 *
 * Different shape from the compact form (above) — multi-line, with
 * a 4-backtick fenced args block. Same role though: this is GA's
 * terminal-frontend chrome, not content the user should read in
 * Galley's document register. ToolCallout renders the structured
 * version on turn_end.
 */
const TOOL_DISPATCH_VERBOSE_BLOCK =
  /🛠️?\s+Tool:\s+`[^`\n]+`\s+📥\s+args:\n````text\n[\s\S]*?\n````\n?/g;

/**
 * Partial-truncation pattern for the verbose marker — chunk
 * boundary fell anywhere inside the block before the closing
 * 4-backtick fence. Truncating at the leading 🛠 keeps the partial
 * render clean while the rest of the block arrives.
 */
const TOOL_DISPATCH_VERBOSE_PARTIAL = /🛠️?\s+Tool:\s+`/;

/**
 * 5-backtick fenced block — wraps the streamed stdout/stderr of a
 * tool's dispatch generator while GA is in verbose mode
 * (`agent_loop.py:79-81`):
 *
 *   `````
 *   <tool's yielded output, potentially many lines / chunks>
 *   `````
 *
 * Stripped wholesale (including content). The structured outcome
 * lands at turn_end via `toolResults[]`; ToolCallout's resultPreview
 * surfaces it there. Showing raw tool stdout as document prose during
 * streaming is uglier than a brief "stream pauses" feel during tool
 * execution.
 */
const FIVE_BACKTICK_BLOCK = /`{5}\n[\s\S]*?\n`{5}\n?/g;

/**
 * Trailing 5-backtick fence open without a matching close — chunk
 * boundary fell after the fence opener but before any line of
 * content has arrived (or before the closer arrives). Truncate at
 * the fence start to avoid rendering "`````" plus partial stdout
 * as prose.
 */
const FIVE_BACKTICK_PARTIAL = /`{5}\n?$/;

/**
 * GA tool-dispatch yields all start with `[Action] ...` — first
 * line of every `do_*` tool method (ga.py:18, :360, :378, :408,
 * etc.) ahead of any subprocess output. These live INSIDE the
 * 5-backtick fence that wraps tool output in verbose mode, so the
 * fence truncation below `should` catch them — but if chunk timing
 * ever delivers the [Action] line without the fence-open in the
 * same partial-render window, the line would leak as prose. This
 * line-level strip is the defensive belt-and-suspenders for that.
 *
 * Subprocess stdout that follows the [Action] line is also inside
 * the fence and likewise caught there; we don't have a pattern for
 * arbitrary stdout, so the fence is the only defense for it.
 */
const TOOL_ACTION_LINE = /^\[Action\] [^\n]*$/gm;

/**
 * "当前阶段：..." preamble that GA's [sys_prompt.txt:4] obliges the
 * LLM to write before every tool call ("调用工具前先推演：当前阶段、
 * 上步结果是否符合预期、下步策略"). The structured `<summary>` form
 * of the same content lands as TurnMarker副标题 via turn_end's
 * `summary` field — the prose preamble is a verbose duplicate.
 *
 * Pattern matches the line beginning + everything up to the next
 * blank line (or end-of-buffer for partials). The optional `**`
 * wrapping covers the cases where the LLM markdown-bolds the
 * label. `[：:]` handles both full-width and half-width colon.
 *
 * If the LLM's entire intermediate-turn prose is just this
 * preamble, stripping it leaves the partial empty → the
 * ThinkingMarker placeholder takes over, which is the right UX
 * (a tight "思考中" beats verbose "当前阶段：还在走 Google 搜索"
 * filler).
 */
const PHASE_PREAMBLE = /^\*{0,2}当前阶段\*{0,2}\s*[：:][\s\S]*?(?=\n\n|$)/gm;

/**
 * Mirror of bridge's `_clean_response_for_display`. Strips GA's
 * structured tags so the user sees the prose-ish final answer
 * MarkdownView can render directly. Bridge emits the raw responseContent
 * in turn_end (to keep the wire faithful); this is the desktop
 * equivalent of that python helper.
 */
export function cleanFinalAnswer(text: string): string {
  if (!text) return "";
  let out = text;
  for (const p of GA_TAG_PATTERNS) out = out.replace(p, "");
  out = out.replace(LLM_RUNNING_MARKER, "");
  out = out.replace(TOOL_ACTION_LINE, "");
  out = out.replace(PHASE_PREAMBLE, "");
  out = out.replace(FILE_REF_PATTERN, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

const GA_TAG_NAMES = ["thinking", "summary", "tool_use", "file_content"];

/**
 * Stripping for **partial** GA output (turn_progress streaming).
 *
 * Different from cleanFinalAnswer because the input may end mid-tag:
 *   - "Some text <thi"        → could be the start of <thinking>
 *   - "Some text <thinking>x" → inside an open tag, content not yet
 *                                complete
 *   - "Some text <thinking>x</thinking> rest" → complete, strip block
 *
 * Strategy:
 *   1. Strip every well-formed <tag>...</tag> block.
 *   2. Find the leftmost unclosed open tag (one of GA_TAG_NAMES).
 *      Truncate the string at that position — content past it
 *      belongs to the in-flight tag and shouldn't be rendered.
 *   3. Find a trailing partial open-tag start (e.g. "<thi" with no
 *      closing ">") and truncate it too — otherwise the user would
 *      see a stray "<thi" rendered as text for one frame.
 *   4. Strip [FILE:...] refs and normalise blank-line runs.
 *
 * Result: a string the user can read at any sampling instant
 * without seeing GA's internal scaffolding flash through.
 */
export function cleanPartialContent(text: string): string {
  if (!text) return "";
  let out = text;

  // 1. Complete blocks.
  for (const p of GA_TAG_PATTERNS) out = out.replace(p, "");

  // 1b. Strip GA's per-turn `LLM Running (Turn N) ...` marker. This
  //     is a frontend-side string GA writes to its display queue;
  //     our own thinking placeholder covers the same UX in product
  //     voice. Done before the unclosed-tag truncation so the
  //     marker doesn't accidentally survive when the partial ends
  //     mid-line. The /gm flag handles multiple occurrences in
  //     accumulated streaming buffers (multi-turn runs).
  out = out.replace(LLM_RUNNING_MARKER, "");

  // 1c. Strip GA's compact `🛠️ tool_name(args)` dispatch markers.
  //     Emitted by `agent_loop.py:73` in verbose=False mode. Galley
  //     now runs verbose=True so these don't appear in practice, but
  //     the stripper stays as backstop in case the user runs against
  //     an older GA baseline where the bridge still falls back.
  out = out.replace(TOOL_DISPATCH_MARKER_LINE, "");

  // 1d. Mid-stream partial of the compact dispatch marker (chunk
  //     arrived with just the prefix, no closing paren yet).
  const partialMarkerIdx = out.search(TOOL_DISPATCH_MARKER_PARTIAL);
  if (partialMarkerIdx !== -1) out = out.slice(0, partialMarkerIdx);

  // 1e. Verbose-mode `🛠️ Tool: ... 📥 args: ...` multi-line marker
  //     block. Same role as the compact marker but with a 4-backtick
  //     fenced args section underneath. Complete blocks first, then
  //     partial truncation if the chunk boundary fell inside.
  out = out.replace(TOOL_DISPATCH_VERBOSE_BLOCK, "");
  const partialVerboseIdx = out.search(TOOL_DISPATCH_VERBOSE_PARTIAL);
  if (partialVerboseIdx !== -1) out = out.slice(0, partialVerboseIdx);

  // 1f. 5-backtick fenced tool-output blocks (verbose mode wraps the
  //     tool's dispatch stream in these). Strip wholesale — the
  //     structured result lands at turn_end via toolResults[] and
  //     ToolCallout renders the preview from there.
  out = out.replace(FIVE_BACKTICK_BLOCK, "");
  // Trailing un-closed 5-fence — truncate so the user doesn't see
  // raw stdout-as-prose pile up between the opener and the chunk
  // carrying the closer.
  const fenceOpenIdx = out.search(/`{5}\n/);
  if (fenceOpenIdx !== -1) {
    out = out.slice(0, fenceOpenIdx);
  } else if (FIVE_BACKTICK_PARTIAL.test(out)) {
    // Chunk ended exactly on a fence open, no newline yet.
    out = out.replace(FIVE_BACKTICK_PARTIAL, "");
  }

  // 1g. Defensive line-level strip for GA tool-output lines that
  //     start with [Action]. See TOOL_ACTION_LINE — these live
  //     inside the 5-backtick fence and should already be hidden
  //     by the fence truncation above, but chunk-timing edge cases
  //     can leave the fence context out of the partial-render
  //     window. The line strip is cheap and harmless when the fence
  //     already caught them.
  out = out.replace(TOOL_ACTION_LINE, "");

  // 1h. Strip "当前阶段：..." preamble paragraphs that GA's
  //     sys_prompt obliges the LLM to write before every tool call.
  //     The same content arrives in structured form via <summary>
  //     → TurnMarker副标题; the prose preamble is a duplicate the
  //     user reads twice. See PHASE_PREAMBLE comment.
  out = out.replace(PHASE_PREAMBLE, "");

  // 2. Unclosed open tag — truncate at its position.
  let earliestUnclosed = -1;
  for (const name of GA_TAG_NAMES) {
    // Look for an opener that has no matching closer further along.
    // The complete-block regex above already removed matched pairs,
    // so any remaining opener is by construction unclosed.
    const openRe = new RegExp(`<${name}(?:\\s[^>]*)?>`);
    const m = out.match(openRe);
    if (m && m.index !== undefined) {
      if (earliestUnclosed === -1 || m.index < earliestUnclosed) {
        earliestUnclosed = m.index;
      }
    }
  }
  if (earliestUnclosed !== -1) out = out.slice(0, earliestUnclosed);

  // 3. Trailing partial open-tag start ("<thi", "<sum", etc.).
  // Find the last "<" — if what follows it is a prefix of any GA tag
  // name AND there's no ">" yet, drop it.
  const lastLt = out.lastIndexOf("<");
  if (lastLt !== -1 && out.indexOf(">", lastLt) === -1) {
    const tail = out.slice(lastLt + 1).toLowerCase();
    const couldBeTag =
      tail === "" ||
      tail === "/" ||
      GA_TAG_NAMES.some(
        (n) =>
          n.startsWith(tail) ||
          // closing form like "</thi" → tail = "/thi"
          (tail.startsWith("/") && n.startsWith(tail.slice(1))),
      );
    if (couldBeTag) out = out.slice(0, lastLt);
  }

  // 4. Cleanups.
  out = out.replace(FILE_REF_PATTERN, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

export function extractThinking(text: string): string | undefined {
  const m = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
  if (!m) return undefined;
  const inner = m[1].trim();
  return inner || undefined;
}

/**
 * Pull the LLM's natural-language pre-tool reasoning prose out of a
 * raw response.content. GA's sys_prompt asks the LLM to "推演：当前阶
 * 段、上步结果是否符合预期、下步策略" before each tool call but
 * doesn't pin a specific format — different LLMs surface this as:
 *
 *   - "当前阶段：xxx；上一步：yyy；下一步：zzz"  (some Claude variants)
 *   - "我需要先 X 因为 Y，然后再 Z"            (freeform narrator)
 *   - "1. 当前阶段...\n2. 上一步..."           (bullet-numbered)
 *   - Nothing outside <summary> at all          (terse models)
 *
 * Instead of pattern-matching one specific phrase, we strip every
 * structured tag and known frontend marker — whatever natural-
 * language prose remains IS the preamble. Captures all of the above
 * styles uniformly; empty result (LLM wrote nothing outside tags)
 * naturally returns undefined and the TurnMarker chevron stays
 * hidden — correct UX, nothing to expand.
 *
 * Used in two paths:
 *   - turn_end (settled): callers gate on "is this an intermediate
 *     turn" so a final-answer turn's prose doesn't double-render as
 *     both preamble AND finalAnswer.
 *   - turn_progress (streaming): MainView feeds the in-flight buffer
 *     directly; TurnMarker can show a compact one-line live status
 *     when no answer body is streaming yet.
 */
export function extractPreamble(text: string): string | undefined {
  if (!text) return undefined;
  let segment = text;
  // Structured-tag blocks: stripped wholesale so the remainder is
  // pure narrator prose.
  segment = segment.replace(/<thinking>[\s\S]*?<\/thinking>/g, "");
  segment = segment.replace(/<summary>[\s\S]*?<\/summary>/g, "");
  segment = segment.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, "");
  segment = segment.replace(/<file_content[^>]*>[\s\S]*?<\/file_content>/g, "");
  // Frontend / dispatch markers that occasionally leak into raw
  // response content (see cleanPartialContent for the full set; we
  // care about the ones that produce text noise).
  segment = segment.replace(LLM_RUNNING_MARKER, "");
  segment = segment.replace(TOOL_DISPATCH_MARKER_LINE, "");
  segment = segment.replace(TOOL_ACTION_LINE, "");
  segment = segment.replace(FILE_REF_PATTERN, "");
  // Streaming-partial case: an open tag without a matching close
  // means the chunk fell mid-block. Truncate at the open so we
  // don't leak partial tag content into the preamble display.
  segment = segment.replace(
    /<(thinking|summary|tool_use|file_content)(?:\s[^>]*)?>[\s\S]*$/,
    "",
  );
  segment = segment.replace(/\n{3,}/g, "\n\n");
  const trimmed = segment.trim();
  return trimmed || undefined;
}
