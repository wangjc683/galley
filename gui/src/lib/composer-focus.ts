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

// ---------------------------------------------------------------------
// Keeping the caret in the composer (telegram-details ticket 03).
// In a conversation you are nearly always typing; a click on a copy
// chip or on blank space, and the key you type next, should not lose
// that. Telegram Web A does the same three things: buttons and the
// message list's own blank backdrop don't take focus on press, and
// typing anywhere that isn't a field goes into the message input.

/**
 * Typing on the conversation goes into the composer. One switch for
 * the whole behaviour, kept for the live Chinese-IME test (a WebKit
 * IME only takes over when the key arrives at an already-focused
 * field, so the first key may land as a plain letter):
 * - `pass`: focus the composer and let the key land in it.
 * - `swallow`: focus the composer and drop the key (fallback a).
 * - `off`: no type-to-focus; presses still keep focus (fallback b).
 */
export type TypeToFocusMode = "pass" | "swallow" | "off";
export const TYPE_TO_FOCUS_MODE: TypeToFocusMode = "pass";

/** The marker on the composer's textarea. */
export const COMPOSER_INPUT_ATTR = "data-composer-input";
/** The marker on the conversation's area (scroller, question rail,
 * jump-to-latest button): presses on buttons in it keep focus. */
export const CONVERSATION_AREA_ATTR = "data-conversation-area";
/** The marker on the conversation's scroll container: a press on its
 * own blank backdrop (not on anything inside it) keeps focus. */
export const CONVERSATION_BACKDROP_ATTR = "data-conversation-backdrop";

/** Where a press on a button keeps the composer focused: the
 * conversation area, and the selection toolbar portalled out of it. */
const KEEP_FOCUS_AREA = `[${CONVERSATION_AREA_ATTR}], [data-selection-copy-toolbar]`;

/** Open layers that own the keyboard: dialogs (Settings, ⌘K, prompt
 * manager, confirmations, Radix popovers) and menus. Tooltips are not
 * layers. */
const OPEN_LAYER =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"]';

/** Focused widgets that read printable keys themselves (type-ahead). */
const KEY_READING_WIDGET =
  '[role="listbox"], [role="menu"], [role="menubar"], [role="tree"], [role="grid"], [role="combobox"], [role="textbox"]';

/** Is a dialog or menu open anywhere on the page? */
export function hasOpenLayer(root: Pick<ParentNode, "querySelector">): boolean {
  return root.querySelector(OPEN_LAYER) !== null;
}

/** Does `active` take typed characters itself? */
function isKeyReceiver(active: Element | null): boolean {
  if (!active) return false;
  const tag = active.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (
    "isContentEditable" in active &&
    (active as HTMLElement).isContentEditable
  )
    return true;
  return active.closest(KEY_READING_WIDGET) !== null;
}

/** The parts of a keydown the type-to-focus rule reads. */
export interface TypeToFocusKey {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  keyCode: number;
  defaultPrevented: boolean;
}

/**
 * What to do with a keydown on the page while a composer is on screen:
 * `none`, `focus` (focus the composer and let the key land in it), or
 * `focus-swallow` (focus it and drop the key). Taken only when nothing
 * that takes keys has focus, no dialog or menu is open, and the key is
 * one printable character with no ⌘ / Ctrl / Alt (Shift is fine).
 * Space is not taken: no message starts with one, and on the
 * conversation it is the reader's page-down.
 */
export function typeToFocusAction(
  event: TypeToFocusKey,
  active: Element | null,
  layerOpen: boolean,
  mode: TypeToFocusMode = TYPE_TO_FOCUS_MODE,
): "none" | "focus" | "focus-swallow" {
  if (mode === "off") return "none";
  if (event.defaultPrevented) return "none";
  if (event.metaKey || event.ctrlKey || event.altKey) return "none";
  if (event.isComposing || event.keyCode === 229) return "none";
  if (event.key.length !== 1 || event.key === " ") return "none";
  if (layerOpen || isKeyReceiver(active)) return "none";
  return mode === "swallow" ? "focus-swallow" : "focus";
}

/**
 * Whether a primary press on `target` leaves a focused composer
 * focused (the caller prevents the mousedown's default and skips the
 * outside-press blur). Two kinds:
 * - the conversation's blank backdrop: the scroll container itself,
 *   not a child — a press on text still starts a selection;
 * - a button in the conversation area or the selection toolbar (copy,
 *   save, process, fold header, show more, code copy, question-rail
 *   dots, jump to latest, ask_user candidates…). Not one that opens a
 *   menu or dialog (`aria-haspopup`: that layer takes focus), and not
 *   a press on selectable text inside a `role="button"` row (a step
 *   marker's summary: dragging there selects).
 * `selectsText(el)` reports whether a press on `el` would start a text
 * selection (computed `user-select`); injected so this stays testable
 * without a DOM.
 */
export function pressKeepsComposerFocus(
  target: Element,
  selectsText: (el: Element) => boolean,
): boolean {
  if (target.hasAttribute(CONVERSATION_BACKDROP_ATTR)) return true;
  const control = target.closest('button, [role="button"]');
  if (!control || control.closest(KEEP_FOCUS_AREA) === null) return false;
  const popup = control.getAttribute("aria-haspopup");
  if (popup !== null && popup !== "false") return false;
  if (control.tagName !== "BUTTON" && selectsText(target)) return false;
  return true;
}

/**
 * Whether ⌥↑ / ⌥↓ belong to the focused element (the paragraph caret
 * moves of a text field) rather than the conversation's jump between
 * your messages. A field keeps them, except an empty composer: there is
 * no caret to move there, and the composer now holds focus nearly all
 * the time (the same idea as Telegram's ↑ editing the last message
 * only from an empty input).
 */
export function altArrowBelongsToField(active: Element | null): boolean {
  if (!active) return false;
  if (
    active.hasAttribute(COMPOSER_INPUT_ATTR) &&
    (active as HTMLTextAreaElement).value === ""
  ) {
    return false;
  }
  const tag = active.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    ("isContentEditable" in active && (active as HTMLElement).isContentEditable)
  );
}
