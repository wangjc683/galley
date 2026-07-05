import { useCallback, useEffect, useRef } from "react";

import {
  expandPlaceholders,
  foldPastedText,
  normalizePastedText,
  PASTE_FOLD_THRESHOLD_LINES,
} from "@/lib/composer-paste";

/**
 * Owns the Composer's paste-fold concern: the registry mapping each
 * folded paste's id → original text, the monotonic id counter, and the
 * post-commit caret restoration. A long paste (> threshold lines)
 * collapses to a `[Pasted text #N +M lines]` placeholder so a wall of
 * pasted text doesn't bury the composer; submit re-expands it via
 * `expandPastePlaceholders`. Pulled out of Composer so the textarea /
 * goal / image logic isn't tangled with the registry bookkeeping.
 *
 * Uncontrolled mode only — controlled callers own their value and we
 * can't intercept paste without their cooperation, so `handleTextPaste`
 * bails when `isControlled`.
 *
 * Refs not state: we never re-render off the registry itself; the
 * placeholder text already living in the textarea value is what drives
 * the visual.
 */
export function usePasteFold({
  text,
  isControlled,
  textareaRef,
  applyValue,
}: {
  /** Current textarea value — the splice target and the trigger for the
   * post-commit caret effect. */
  text: string;
  isControlled: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Commit a new value (uncontrolled setState + onChange notify). Only
   * called from the uncontrolled fold path. */
  applyValue: (next: string) => void;
}) {
  // id → full pasted text. `pasteCounterRef` is a monotonic id source,
  // reset on submit / prefill so it doesn't grow unbounded across a long
  // session. `pendingCursorRef` stashes where the caret belongs AFTER
  // React commits the spliced value — setSelectionRange inside the
  // onPaste handler would race the commit and land a frame early at the
  // wrong column, so a post-commit effect is the reliable path.
  const pastesRef = useRef<Map<number, string>>(new Map());
  const pasteCounterRef = useRef(0);
  const pendingCursorRef = useRef<number | null>(null);

  // Restore the caret after a fold splices a new value in. Shares the
  // [text] trigger with the Composer's auto-grow effect; order doesn't
  // matter since they touch disjoint properties (selection vs height).
  useEffect(() => {
    const pos = pendingCursorRef.current;
    if (pos !== null && textareaRef.current) {
      textareaRef.current.setSelectionRange(pos, pos);
      pendingCursorRef.current = null;
    }
  }, [text, textareaRef]);

  const handleTextPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Controlled callers manage their own state; can't intercept the
    // paste without their cooperation, so fall through to default.
    if (isControlled) return;
    const el = textareaRef.current;
    if (!el) return;
    const { normalized, lineCount } = normalizePastedText(
      e.clipboardData.getData("text"),
    );
    if (lineCount <= PASTE_FOLD_THRESHOLD_LINES) return; // default paste

    e.preventDefault();
    const id = ++pasteCounterRef.current;
    pastesRef.current.set(id, normalized);
    const { next, caret } = foldPastedText({
      text,
      start: el.selectionStart,
      end: el.selectionEnd,
      id,
      lineCount,
    });
    pendingCursorRef.current = caret;
    applyValue(next);
  };

  // Stable identity (only reads the registry ref) so effect callers can
  // list it in deps without re-running every render.
  const expandPastePlaceholders = useCallback(
    (s: string): string => expandPlaceholders(s, pastesRef.current),
    [],
  );

  /** Drop every folded entry and reset the counter. Called after submit
   * (the placeholders are gone from the draft) and on programmatic
   * prefill (the new text isn't a user paste). Stable identity so it can
   * sit in the Composer's `useImperativeHandle` deps without churn. */
  const resetPasteRegistry = useCallback(() => {
    pastesRef.current.clear();
    pasteCounterRef.current = 0;
  }, []);

  return { handleTextPaste, expandPastePlaceholders, resetPasteRegistry };
}
