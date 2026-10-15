// Which settled steps have no heading sentence of their own
// (2026-09-23). When the model omits `<summary>`, GA falls back to the
// whole reply as the turn summary, so on a tool step that wrote
// narration the "summary" is that same narration again — 114 of 143
// narration steps since 2026-09-01. On such a step the narration
// itself is the marker line and gets no row of its own (AgentTurnView's
// `narrationIsHeading`); the marker used to fall back to
// `stepCalledTools`, which only repeated the tool pill right below it.
// Every other step keeps its summary and its narration row.

import { summaryEchoesAnswer } from "@/lib/ipc/ga-output-cleaning";
import { cleanSessionSummary } from "@/lib/session-summary";

export interface StepHeadingFacts {
  /** A TurnMarker row renders for this step: settled, numbered, not a
   * folded run's closing turn, not a merged bare-number pill row. */
  hasMarker: boolean;
  /** Closing-shaped turn — nothing but `no_tool` placeholders. Its
   * prose is an answer, not a step's narration. */
  closingShaped: boolean;
  /** The step's narration: `finalAnswer` on a turn with real tools. */
  narration: string | null | undefined;
  /** GA's turn summary for the step. */
  summary: string | null | undefined;
}

/**
 * True for a tool step whose narration is also its summary — GA's
 * fallback echo, detected by `summaryEchoesAnswer` (exact match or
 * smart_format's middle elision). A step whose model wrote its own
 * `<summary>`, a step without narration, and a step with no summary
 * at all (the bare-marker case) are all false.
 */
export function isEchoNarrationStep(facts: StepHeadingFacts): boolean {
  if (!facts.hasMarker || facts.closingShaped) return false;
  const narration = facts.narration ?? "";
  if (narration.trim() === "") return false;
  return summaryEchoesAnswer(facts.summary, narration);
}

/** The marker's two fallback lines (`copy.conversation`). */
export interface StepMarkerWords {
  stepDirectAnswer: string;
  stepCalledTools: (names: string[]) => string;
}

/**
 * The marker's summary before the echo-narration swap: GA's turn
 * summary, unless it only echoes the step's prose (GA's fallback when
 * the model wrote no `<summary>`); then GA's own two-way fallback
 * (ga.py:599) — the direct-answer line for a step without real tools,
 * 「调用了 X」 otherwise. Undefined when GA wrote no summary at all (a
 * bare step). The step marker (Conversation's AgentTurnView) and the
 * assistant's process card (lib/assistant-process.ts) both read it.
 */
export function stepMarkerSummary(
  summary: string | undefined,
  prose: string | null,
  realToolNames: string[],
  words: StepMarkerWords,
): string | undefined {
  if (!summaryEchoesAnswer(summary, prose)) return summary;
  return realToolNames.length === 0
    ? words.stepDirectAnswer
    : words.stepCalledTools(realToolNames);
}

/**
 * The marker line's words: on an echo-narration step
 * (`isEchoNarrationStep`) the narration itself, run through the
 * sidebar's recap cleaner (markdown markers out, whitespace collapsed),
 * not GA's summary, which may be middle-elided past 80 characters;
 * otherwise the marker summary (`stepMarkerSummary`).
 */
export function stepMarkerLine(
  markerSummary: string | undefined,
  narration: string | null,
  narrationIsHeading: boolean,
): string | undefined {
  return narrationIsHeading && narration
    ? cleanSessionSummary(narration) || markerSummary
    : markerSummary;
}
