import { useEffect, useState } from "react";

import { useCopy } from "@/lib/i18n";

/**
 * Persistent run-level elapsed chip, floating over the conversation's
 * bottom-right corner for the whole run — the "still going, however
 * far you've scrolled" signal (see 2026-08-07 scroll-button devlog for
 * that charter). Chrome register on purpose: border, elevation, blur —
 * unlike the in-document thinking row, this is a monitoring surface.
 *
 * Two 2026-08-12 convergences (thinking-timer devlog, same-day
 * postscript):
 *
 * - Speaks the conversation duration dialect ("1 分 23 秒") instead of
 *   the telemetry-compact "1m23s" it originally borrowed — the chip's
 *   number is the same quantity the settled fold header prints as
 *   "用时 1 分 23 秒", and it shares a screen with the thinking row's
 *   step clock, so it must not be the one surface speaking latin.
 *   Whole seconds: run time is a minute-scale monitoring number
 *   (tenths at that scale read frenetic, per the step-clock rule).
 * - No working animation: the once-a-second tick is the liveness
 *   proof (same argument that removed "仍在运行" and the dots from
 *   the thinking row). LiveDots left; shimmer deliberately NOT added —
 *   §2.7's carve-out allows one status-text shimmer per view and the
 *   thinking row holds it.
 */
export function RunElapsedHud({
  startedAtMs,
}: {
  startedAtMs: number | null;
}) {
  const copy = useCopy();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAtMs == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAtMs]);

  if (startedAtMs == null) return null;
  const elapsed = formatRunElapsed(now - startedAtMs, copy);

  return (
    <div
      aria-label={`${copy.conversation.runWorking} ${elapsed}`}
      className={[
        "inline-flex h-6 items-center gap-1.5 rounded-sm border border-line",
        "bg-elevated/88 px-2 text-[11.5px] leading-[14px]",
        "text-ink-muted shadow-[var(--shadow-float)] backdrop-blur-md",
        "[font-variant-numeric:tabular-nums]",
      ].join(" ")}
    >
      <span className="inline-flex h-3.5 items-center">
        {copy.conversation.runWorking}
      </span>
      <span className="inline-flex h-3.5 items-center tabular-nums">
        {elapsed}
      </span>
    </div>
  );
}

function formatRunElapsed(
  ms: number,
  copy: ReturnType<typeof useCopy>,
): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return copy.conversation.seconds(String(totalSec));
  const minutes = Math.floor(totalSec / 60);
  const remainder = totalSec % 60;
  return copy.conversation.minutesSeconds(minutes, remainder);
}
