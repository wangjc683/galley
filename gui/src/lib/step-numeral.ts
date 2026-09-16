/**
 * Zero-padded ordinal for the conversation's step gutter ("01" … "99").
 * Two digits give the gutter column a fixed width so every step's
 * summary and process body share one x (conversation.md, TurnMarker).
 * Shared by TurnMarker and ToolCallout's merged-step prefix; the
 * localized "第 N 步" copy stays for sr-only text and the sidebar.
 */
export function formatStepNumeral(index: number): string {
  return String(index).padStart(2, "0");
}

/**
 * Gutter placeholder for the in-flight step (2026-09-16): two middle
 * dots, the width of a two-digit ordinal in the same mono column, so
 * the live row reads as "next item, not yet stamped" instead of an
 * empty slot. Chosen over an empty gutter and over a gutter-less
 * flush row in a live A/B (devlog postscript six).
 */
export const PENDING_STEP_NUMERAL = "\u00b7\u00b7";
