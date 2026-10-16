import type { ReactNode } from "react";

import { ASSISTANT_BUBBLE_MAX } from "@/components/conversation/AssistantParts";
import { ExpandSection } from "@/components/conversation/ExpandSection";
import { TokenMetrics } from "@/components/conversation/MessageActions";
import {
  ProcessCard,
  type ProcessCardStep,
} from "@/components/conversation/ProcessCard";
import { useCopy } from "@/lib/i18n";
import type { RunStats } from "@/lib/run-groups";
import { formatCompactCount, telemetryInputTotal } from "@/lib/telemetry";
import type { MessageTelemetry } from "@/types/conversation";

/*
 * The assistant's process card (main chat PRD ruling 69; spec:
 * conversation.md 「助手的对话」 → 过程; rules in lib/assistant-process.ts):
 * what its process button opens under a settled reply. The card
 * (ProcessCard, the workbench's run fold opens the same one) as wide as
 * the reply bubble's cap; its first line is the round in numbers; under
 * it one line a step, eight at most, the rest scrolling inside the
 * card. A step with something to show opens in place.
 */

/** The RunFoldHeader's duration words (formatDuration there). */
function durationText(
  elapsedMs: number | null,
  copy: ReturnType<typeof useCopy>,
): string | null {
  if (elapsedMs == null || elapsedMs <= 0) return null;
  const sec = Math.round(elapsedMs / 1000);
  if (sec < 1) return null;
  if (sec < 60) return copy.conversation.foldDurationSeconds(sec);
  return copy.conversation.foldDurationMinutes(Math.floor(sec / 60), sec % 60);
}

/** Its figures one ink rung up. */
function inkFigures(text: string): ReactNode {
  return text.split(/(\d+)/).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="text-ink-soft">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * The card's first line, the round in numbers (ruling 68, moved into
 * the card by ruling 69): 「4 步 · 用时 45 秒 · ↑33k ↓1.1k」 — the fold
 * header's structure segment and the action bar's ↑ ↓ with their tips
 * (TokenMetrics, the cache split included). The step count is the
 * round's (the answer's and a question's steps included), as before.
 * No control: no hover ground, no caret, no click. Words ink-muted,
 * figures ink-soft (the token counts whole), at the step size, on a
 * 24px line. No context percentage. Without a duration (a segment that
 * has no telemetry) it reads the step count alone; without tokens, no
 * token segment. It stays put while the steps scroll under it.
 */
function AssistantRunSummary({
  stats,
  telemetry,
}: {
  stats: RunStats;
  telemetry?: MessageTelemetry | null;
}) {
  const copy = useCopy();
  const steps = copy.conversation.foldSteps(stats.stepCount);
  const duration = durationText(stats.elapsedMs, copy);
  const tokens = Boolean(
    formatCompactCount(telemetryInputTotal(telemetry)) ||
    formatCompactCount(telemetry?.outputTokens),
  );
  return (
    <div
      data-role="assistant-run-summary"
      className="h-6 whitespace-nowrap px-3 leading-6 tabular-nums tracking-[0.01em] text-ink-muted [font-size:var(--conversation-step-size)]"
    >
      {inkFigures(duration ? `${steps} · ${duration}` : steps)}
      {tokens && (
        <>
          {" · "}
          <span className="inline-flex items-center gap-1.5 align-middle">
            <TokenMetrics
              telemetry={telemetry}
              valueClassName="text-ink-soft"
            />
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The card, opened in place under the reply's action row by the process
 * button and swept open / closed as ExpandSection does. 6px under the
 * action row (the bubble → action row gap again), 20px of its own under
 * it (the change-of-side gap, assistantRowGap's mt-5), so the next
 * message or time line no longer sits on its edge; both inside the
 * sweep, so they open and close with it.
 */
export function AssistantProcessCard({
  open,
  stats,
  telemetry,
  steps,
}: {
  open: boolean;
  stats: RunStats;
  /** The whole round's (run-groups `RunStats.telemetry`, else the
   * answer turn's): what the action bar's ↑ ↓ read. */
  telemetry?: MessageTelemetry | null;
  /** The steps with a row (lib/assistant-process.ts
   * `assistantProcessSteps`), keyed by their turn's place. */
  steps: ProcessCardStep[];
}) {
  return (
    <ExpandSection open={open} openClassName="mt-1.5" closedClassName="mt-0">
      <div className="pb-5">
        <ProcessCard
          steps={steps}
          heading={<AssistantRunSummary stats={stats} telemetry={telemetry} />}
          capped
          className={ASSISTANT_BUBBLE_MAX}
        />
      </div>
    </ExpandSection>
  );
}
