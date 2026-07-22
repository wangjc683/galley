/**
 * Composer focus policy — the single place that decides whether the
 * composer may take keyboard focus, and the single entry that applies
 * the decision. Every focus trigger (mount, window activation, future
 * platform fixes) must route through `focusComposerUnlessClaimed` so
 * the yield rules stay in one spot.
 *
 * The composer yields only to elements that hold a genuinely competing
 * focus claim: another text-editing surface (session-title editor,
 * dialog field, contentEditable) or anything inside an open dialog /
 * popover. It deliberately does NOT yield to `activeElement` merely
 * being non-body: Windows Chromium preserves `activeElement` across
 * window blur and gives clicked buttons DOM focus (macOS WebKit does
 * neither), so an `activeElement === body` guard blocks nearly every
 * refocus on Windows (see devlog 2026-07-21-windows-composer-refocus).
 */

/** Focus `textarea` unless another element holds a competing claim. */
export function focusComposerUnlessClaimed(
  textarea: HTMLTextAreaElement | null,
): void {
  if (!textarea) return;
  if (yieldsToActiveElement(document.activeElement, textarea)) return;
  textarea.focus({ preventScroll: true });
}

/**
 * True when `active` holds a focus claim the composer must not steal.
 * body / null / the composer textarea itself are free to take (the
 * textarea case is Windows Chromium keeping `activeElement` parked on
 * it across window blur — re-focusing is what restores the caret).
 *
 * Structural checks only (tagName / closest), no `document` globals —
 * keeps the policy unit-testable in the node vitest environment.
 */
export function yieldsToActiveElement(
  active: Element | null,
  composerTextarea: Element,
): boolean {
  if (!active || active === composerTextarea) return false;
  const tag = active.tagName;
  if (tag === "BODY") return false;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ("isContentEditable" in active && (active as HTMLElement).isContentEditable)
    return true;
  // Radix dialogs / alert dialogs / popovers (role="dialog") manage
  // their own focus scope — pulling focus out from under them would
  // break Escape/Tab handling and dismiss affordances.
  return active.closest('[role="dialog"], [role="alertdialog"]') !== null;
}
