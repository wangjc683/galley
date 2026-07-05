/**
 * Settled-tool status detection from the tool result content.
 *
 * The GA tool-result stream carries no general structured outcome —
 * results are free-form strings whose error conventions vary per tool,
 * so we deliberately do NOT guess "failed" from content (mislabeling
 * real output as a failure damages trust more than staying quiet).
 *
 * The one structured exception is denial. When the user rejects an
 * approval, Galley's own WorkbenchHandler returns this exact payload
 * to GA as the tool result (runner/handlers.py, "User denied" —
 * coupling point, keep the shape in sync):
 *
 *   {"status": "denied", "msg": "User denied this tool call"}
 *
 * GA JSON-serializes outcome data verbatim into
 * `turn_end.toolResults[].content`, so parsing it here reads Galley's
 * own wire format, not GA internals. This makes a user's denial
 * visible in the transcript (denied block callout) instead of
 * rendering indistinguishably from success.
 */
export function settledToolStatus(
  content: unknown,
): "denied" | "success-historical" {
  let payload: unknown = content;
  if (typeof content === "string") {
    const trimmed = content.trim();
    // Cheap gate before JSON.parse — almost every real tool result is
    // prose / file content / logs, not a JSON object.
    if (!trimmed.startsWith("{")) return "success-historical";
    try {
      payload = JSON.parse(trimmed);
    } catch {
      return "success-historical";
    }
  }
  if (
    typeof payload === "object" &&
    payload !== null &&
    (payload as Record<string, unknown>).status === "denied"
  ) {
    return "denied";
  }
  return "success-historical";
}
