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

export interface StepHeadingFacts {
  /** A TurnMarker row renders for this step: settled, numbered, not a
   * folded run's closing turn, not a merged bare-number pill row. */
  hasMarker: boolean;
  /** Closing-shaped turn — nothing but `no_tool` placeholders. Its
   * prose is an answer (or a goal continuation's progress note), not a
   * step's narration. */
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
