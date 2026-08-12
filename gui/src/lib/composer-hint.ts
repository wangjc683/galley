/**
 * Composer footer-hint resolution — the keyboard-truth half of the
 * running-state hand-off whose placeholder half lives in
 * `composer-register.ts`. Pure, total, deterministic; the component
 * (`ComposerFooterHint.tsx`) only maps the returned key through the
 * copy table and styles kbd tokens.
 *
 * The slot only ever lists keys that are live right now. Since the
 * message queue (galley#19/#20) plain Enter is NEVER gated: while the
 * agent runs it queues instead of sending, and the slot's job is to
 * say so. Three running states, and the placeholder and this slot
 * hand off between them rather than speaking at once:
 *
 * - empty draft — the placeholder owns the /btw lesson (it sits where
 *   the prefix gets typed and is itself the format example), so the
 *   slot must not repeat the token; the newline legend stays.
 * - typing — the placeholder is gone; the slot states that Enter
 *   queues (auto-runs after the current task).
 * - /btw staged — Enter sends immediately (side question), so the
 *   plain Enter legend returns.
 *
 * While a stop is in flight and messages are queued, the slot turns
 * into the one-line status the #20 reporter asked for: the stop's
 * wait is the software's problem, and this line says the queued
 * message will go out by itself.
 *
 * Idle has its own hasText hand-off: an empty draft shows the
 * drag-to-reference capability (nothing to send yet, so the Enter
 * legend would be dead weight); the first typed character swaps it for
 * the Enter legend, which is now live.
 */

/** i18n `composer` key of the hint to show; null collapses the slot. */
export type ComposerHintKey =
  | "queueEnterHint"
  | "stoppingQueueHint"
  | "newlineHint"
  | "enterHint"
  | "startGoalWithEnter"
  | "dragToReferenceHint";

export interface ComposerHintState {
  /** The caller wants a keyboard hint at all (surface-level gate). */
  showFooterHint: boolean;
  /** Agent is mid-run. */
  stopMode: boolean;
  /** An abort is in flight (stop clicked, run_complete pending). */
  isStopping: boolean;
  /** The session has queued outbound messages. */
  hasQueuedMessages: boolean;
  /** Draft is non-empty. */
  hasText: boolean;
  /** Draft is a staged `/btw` side question (`lib/side-question.ts`). */
  isSideQuestion: boolean;
  /** Goal armed: Enter opens the Goal preview instead of sending. */
  effectiveGoalArmed: boolean;
}

export function resolveComposerHint(s: ComposerHintState): ComposerHintKey | null {
  if (!s.showFooterHint) return null;
  if (s.stopMode) {
    if (s.isSideQuestion) return "enterHint";
    // Stop in flight with messages parked: the status line outranks
    // the keyboard legend — it answers "did my send get lost?".
    if (s.isStopping && s.hasQueuedMessages) return "stoppingQueueHint";
    return s.hasText ? "queueEnterHint" : "newlineHint";
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
