/**
 * Settled-tool status detection from the tool result content.
 *
 * The GA tool-result stream carries no general structured outcome —
 * results are free-form strings whose error conventions vary per tool,
 * so we deliberately do NOT guess "failed" from content (mislabeling
 * real output as a failure damages trust more than staying quiet).
 *
 * Two structured exceptions, both exact-match on a known envelope:
 *
 *   - Denial. When the user rejects an approval, Galley's own
 *     WorkbenchHandler returns this exact payload to GA as the tool
 *     result (runner/handlers.py, "User denied" — coupling point,
 *     keep the shape in sync):
 *
 *       {"status": "denied", "msg": "User denied this tool call"}
 *
 *   - GA tool-error envelope (#22 / 2026-08-11 decision). GA's own
 *     tool implementations settle on one result dict shape
 *     (managed-ga/code/ga.py — coupling point on the pinned managed
 *     baseline):
 *
 *       {"status": "error", "stdout": "...", "exit_code": 1}   code_run
 *       {"status": "error", "msg": "..."}                      most others
 *
 *     This is still not content-guessing: only a JSON object whose
 *     `status` field is exactly "error" qualifies; prose / file
 *     content / logs never parse into that shape.
 *
 * GA JSON-serializes outcome data verbatim into
 * `turn_end.toolResults[].content`, so parsing it here reads a
 * documented wire format. Denials render as the collapsed denied
 * callout; tool errors as "failed-historical" (red, auto-collapsed,
 * headline-first — see toolErrorDisplay).
 */
export function settledToolStatus(
  content: unknown,
): "denied" | "failed-historical" | "success-historical" {
  const payload = parseResultEnvelope(content);
  if (payload?.status === "denied") return "denied";
  if (payload?.status === "error") return "failed-historical";
  return "success-historical";
}

/** JSON-object envelope of a settled tool result, or null when the
 * content is anything else (prose, logs, non-object JSON). */
function parseResultEnvelope(
  content: unknown,
): Record<string, unknown> | null {
  let payload: unknown = content;
  if (typeof content === "string") {
    const trimmed = content.trim();
    // Cheap gate before JSON.parse — almost every real tool result is
    // prose / file content / logs, not a JSON object.
    if (!trimmed.startsWith("{")) return null;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (typeof payload !== "object" || payload === null) return null;
  return payload as Record<string, unknown>;
}

export interface ToolErrorDisplay {
  /** One-line cause, shown first (collapsed lead + expanded lead).
   * Undefined when the envelope carries no recognizable cause line —
   * the status chrome alone says "failed" then. */
  headline?: string;
  /** Decoded human-readable error body: the envelope's stdout / msg
   * with real newlines (JSON.parse already unescaped `\r\n` / `\\`),
   * tail-capped — the exception line lives at the END of a Python
   * traceback, so the head is what gets dropped. */
  detail: string;
}

/** Keep the last N chars of an error body: for tracebacks the tail is
 * the signal and the head is banner / frames. Visible marker over
 * silent truncation, same principle as previewFromContent. */
const ERROR_DETAIL_MAX_CHARS = 4000;
const HEADLINE_MAX_CHARS = 200;
const TRACEBACK_MARKER = "Traceback (most recent call last):";

/**
 * Headline + decoded detail for a settled tool result that
 * `settledToolStatus` classified as "failed-historical"; null for
 * everything else. Headline extraction is deliberately narrow
 * (2026-08-11 decision): the last line of a Python traceback, or the
 * envelope's own `msg` field — no best-effort guessing over free-form
 * output.
 */
export function toolErrorDisplay(content: unknown): ToolErrorDisplay | null {
  const payload = parseResultEnvelope(content);
  if (payload?.status !== "error") return null;

  const stdout = typeof payload.stdout === "string" ? payload.stdout : "";
  const msg = typeof payload.msg === "string" ? payload.msg : "";
  let detail = [stdout, msg].filter(Boolean).join("\n").replace(/\r\n/g, "\n");
  if (!detail) {
    // Unknown error-envelope variant: fall back to the raw content so
    // the user still sees something in the expanded body.
    detail = typeof content === "string" ? content : JSON.stringify(content);
  }
  if (detail.length > ERROR_DETAIL_MAX_CHARS) {
    detail = `… ${detail.slice(-ERROR_DETAIL_MAX_CHARS)}`;
  }

  let headline: string | undefined;
  if (detail.includes(TRACEBACK_MARKER)) {
    // The last non-empty line of a traceback is the exception line
    // ("JSONDecodeError: Expecting value: …").
    const lines = detail.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line) {
        headline = line;
        break;
      }
    }
  } else if (msg) {
    headline = msg.split("\n", 1)[0].trim() || undefined;
  }
  if (headline && headline.length > HEADLINE_MAX_CHARS) {
    headline = `${headline.slice(0, HEADLINE_MAX_CHARS)}…`;
  }

  return { headline, detail };
}
