/**
 * Composer footer-hint resolution — the keyboard-truth half of the
 * running-state hand-off whose placeholder half lives in
 * `composer-register.ts`. Pure, total, deterministic; the component
 * (`ComposerFooterHint.tsx`) only maps the returned key through the
 * copy table and styles kbd tokens.
 *
 * The slot only ever lists keys that are live right now, so while the
 * agent runs it degrades exactly as far as stopMode gates — it never
 * becomes pure status. Three running states, and the placeholder and
 * this slot hand off between them rather than speaking at once:
 *
 * - empty draft — the placeholder owns the /btw lesson (it sits where
 *   the prefix gets typed and is itself the format example), so the
 *   slot must not repeat the token. Plain Enter is gated but
 *   Shift+Enter is not (handleKeyDown intercepts Enter only without
 *   shift), so the legend keeps the half that stays true.
 * - typing — the placeholder is gone; the slot takes over and states
 *   what Enter needs, pre-empting the block instead of only correcting
 *   it afterwards.
 * - /btw staged — Enter really sends again, so the full hint returns.
 *
 * Idle has its own hasText hand-off: an empty draft shows the
 * drag-to-reference capability (nothing to send yet, so the Enter
 * legend would be dead weight); the first typed character swaps it for
 * the Enter legend, which is now live.
 *
 * The transient `byTheWayPrefixHint` stays as the correction after a
 * blocked Enter attempt.
 */

/** i18n `composer` key of the hint to show; null collapses the slot. */
export type ComposerHintKey =
  | "byTheWayPrefixHint"
  | "byTheWaySendHint"
  | "newlineHint"
  | "enterHint"
  | "startGoalWithEnter"
  | "dragToReferenceHint";

export interface ComposerHintState {
  /** The caller wants a keyboard hint at all (surface-level gate). */
  showFooterHint: boolean;
  /** Agent is mid-run. */
  stopMode: boolean;
  /** Draft is non-empty. */
  hasText: boolean;
  /** Draft is a staged `/btw` side question (`lib/side-question.ts`). */
  isSideQuestion: boolean;
  /** A plain Enter was just blocked by the stop gate (transient). */
  showByTheWayRequiredHint: boolean;
  /** Goal armed: Enter opens the Goal preview instead of sending. */
  effectiveGoalArmed: boolean;
}

export function resolveComposerHint(s: ComposerHintState): ComposerHintKey | null {
  if (!s.showFooterHint) return null;
  if (s.showByTheWayRequiredHint && s.stopMode && !s.isSideQuestion) {
    return "byTheWayPrefixHint";
  }
  if (s.stopMode) {
    if (s.isSideQuestion) return "enterHint";
    return s.hasText ? "byTheWaySendHint" : "newlineHint";
  }
  // Armed changes what Enter does (opens the Goal preview, not send) —
  // with the wide "启动 Goal" pill gone, this hint and the button
  // tooltip carry that semantic.
  if (s.effectiveGoalArmed) return "startGoalWithEnter";
  // Idle hand-off on hasText: with an empty draft there is nothing to
  // send, so the Enter legend is at its least useful — that gap is where
  // the drag-to-reference capability gets stated instead. Like every
  // other key in this slot it is a live truth, not an expiring tip, so
  // it never retires (JC 裁决 A, .scratch/composer-file-drop/issues/06).
  return s.hasText ? "enterHint" : "dragToReferenceHint";
}
