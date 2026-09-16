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
