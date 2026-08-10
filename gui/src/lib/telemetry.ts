import type { MessageTelemetry } from "@/types/conversation";

export function formatElapsedCompact(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m${seconds}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${String(minutes).padStart(2, "0")}m`;
}

export function formatCompactCount(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  if (value < 1000) return `${Math.round(value)}`;
  if (value < 1_000_000) {
    const k = value / 1000;
    const text = k >= 100 ? `${Math.round(k)}` : k.toFixed(1).replace(/\.0$/, "");
    return `${text}k`;
  }
  const m = value / 1_000_000;
  return `${m.toFixed(1).replace(/\.0$/, "")}m`;
}

export function telemetryInputTotal(
  telemetry: MessageTelemetry | null | undefined,
): number | null {
  if (!telemetry) return null;
  const parts = [
    telemetry.inputTokens,
    telemetry.cacheCreateTokens,
    telemetry.cacheReadTokens,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (parts.length === 0) return null;
  return parts.reduce((sum, value) => sum + Math.max(0, value), 0);
}

/**
 * GA measures the trim budget in CHARACTERS (`llmcore.py`
 * `trim_messages_history`: `cap = context_win * 3`), and the bridge reports
 * both sides in chars. The ×3 is GA's own chars-per-token heuristic, so
 * dividing it back out recovers the operator-facing number: the quotient of
 * `contextLimitChars` is exactly the `context_win` value configured in
 * Settings. That round-trip is the whole reason the meter speaks tokens —
 * the raw char limit (270000) is a number the user has never seen, while
 * 90k is the one they set themselves.
 *
 * The result is an ESTIMATE, unlike `inputTokens`/`outputTokens` which come
 * straight from the provider's usage payload. Copy that renders it must
 * keep the "约" / "~" marker so the two precisions stay distinguishable.
 *
 * SCOPE: this measures `backend.history` ONLY — the system prompt and the
 * tool schema are sent on every call but live outside history, so they are
 * absent here (~3.4k tokens' worth in managed mode). That is deliberate,
 * not a gap: GA only ever trims history (`trim_messages_history` takes
 * history alone), so a meter that predicts trimming has to measure exactly
 * what trimming can reach. The consequence is that `↑` legitimately dwarfs
 * this number early in a session — 3.5k vs 59 on turn one — which is why
 * the tooltip carries a note naming what is excluded.
 */
const GA_CHARS_PER_TOKEN = 3;

export interface ContextUsageTokens {
  usedTokens: number;
  limitTokens: number;
  /** Pre-formatted so the meter and its tooltip can never disagree. */
  percentLabel: string;
}

/**
 * `<1%` rather than `0%` for any non-empty history. Rounding 0.07% down to
 * a flat `0%` reads as "nothing counted yet" — indistinguishable from a
 * broken meter — through the whole early part of a session, which is
 * exactly when the history is small.
 */
function formatUsagePercent(used: number, limit: number): string {
  const pct = Math.round((used / limit) * 100);
  if (pct === 0 && used > 0) return "<1%";
  return `${Math.max(0, Math.min(999, pct))}%`;
}

function readContextChars(
  telemetry: MessageTelemetry | null | undefined,
): { used: number; limit: number } | null {
  const used = telemetry?.contextUsedChars;
  const limit = telemetry?.contextLimitChars;
  if (
    typeof used !== "number" ||
    typeof limit !== "number" ||
    !Number.isFinite(used) ||
    !Number.isFinite(limit) ||
    limit <= 0 ||
    used < 0
  ) {
    return null;
  }
  return { used, limit };
}

/** Percent-only label for the inline meter. Absolute values live in the
 * tooltip: the meter shares a row with two raw token counts, and a bare
 * `120k/270k` there reads as tokens in a different unit. A `%` is
 * dimensionless, so the ambiguity cannot arise. */
export function contextUsagePercentLabel(
  telemetry: MessageTelemetry | null | undefined,
): string | null {
  const chars = readContextChars(telemetry);
  if (!chars) return null;
  return formatUsagePercent(chars.used, chars.limit);
}

/** Token-converted usage for the tooltip. See `GA_CHARS_PER_TOKEN`. */
export function contextUsageTokens(
  telemetry: MessageTelemetry | null | undefined,
): ContextUsageTokens | null {
  const chars = readContextChars(telemetry);
  if (!chars) return null;
  return {
    usedTokens: Math.round(chars.used / GA_CHARS_PER_TOKEN),
    limitTokens: Math.round(chars.limit / GA_CHARS_PER_TOKEN),
    percentLabel: formatUsagePercent(chars.used, chars.limit),
  };
}

/** Cache-read portion of the input total, or null when the provider
 * reported none. Cache reads bill at roughly a tenth of fresh input, so a
 * large `↑` made mostly of cache hits is cheap — surfacing the split stops
 * the total from reading as pure cost. `cacheCreateTokens` is deliberately
 * NOT split out: it bills near parity with fresh input (~1.25x), so folding
 * it into the total distorts little, and a third number would cost more
 * clarity than it buys. */
export function telemetryCachedInput(
  telemetry: MessageTelemetry | null | undefined,
): number | null {
  const cached = telemetry?.cacheReadTokens;
  if (typeof cached !== "number" || !Number.isFinite(cached) || cached <= 0) {
    return null;
  }
  return cached;
}
