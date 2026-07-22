import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

/**
 * Focus the composer textarea when the app window regains focus
 * (Cmd/Alt+Tab or clicking back into the window), so the user can start
 * typing without an extra click (GitHub issue #13).
 *
 * Two triggers, because the platforms disagree:
 *
 * - Tauri `onFocusChanged` (Rust `WindowEvent::Focused`) — the reliable
 *   cross-platform signal. Windows WebView2 does NOT fire the DOM
 *   `window` focus event on Alt+Tab (WebView2Feedback#4626), so the
 *   DOM-only v0.3.6 version of this hook never ran on Windows.
 * - DOM `window` focus — kept as the fallback for non-Tauri hosts
 *   (Vite dev in a plain browser). Both firing for one activation is
 *   fine: the second `focus()` call is a no-op.
 *
 * Takeover yields only to elements that genuinely hold a competing
 * focus claim: another text-editing surface (session-title editor,
 * dialog field, contentEditable) or anything inside an open dialog /
 * popover. It deliberately does NOT yield to `activeElement` merely
 * being non-body: Windows Chromium preserves `activeElement` across
 * window blur and gives clicked buttons DOM focus (macOS WebKit does
 * neither), so the old `activeElement === body` guard blocked nearly
 * every refocus on Windows while relying on a native focus restore
 * that WebView2 doesn't dependably perform.
 *
 * DOM-only from React's perspective. Safe to mount per Composer:
 * EmptyState and MainView render exclusively, so at most one listener
 * is live.
 */
export function useFocusOnWindowFocus(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
) {
  useEffect(() => {
    const focusComposerUnlessClaimed = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      if (yieldsToActiveElement(document.activeElement, textarea)) return;
      textarea.focus({ preventScroll: true });
    };

    window.addEventListener("focus", focusComposerUnlessClaimed);

    let cancelled = false;
    let unlistenTauriFocus: (() => void) | undefined;
    void (async () => {
      try {
        const unlisten = await getCurrentWindow().onFocusChanged(
          ({ payload: focused }) => {
            if (cancelled || !focused) return;
            focusComposerUnlessClaimed();
          },
        );
        if (cancelled) unlisten();
        else unlistenTauriFocus = unlisten;
      } catch {
        // Non-Tauri host — the DOM listener above carries alone.
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("focus", focusComposerUnlessClaimed);
      unlistenTauriFocus?.();
    };
  }, [textareaRef]);
}

/**
 * True when `active` holds a focus claim the composer must not steal.
 * body / null / the composer textarea itself are free to take (the
 * textarea case is Windows Chromium keeping `activeElement` parked on
 * it across window blur — re-focusing is what restores the caret).
 */
function yieldsToActiveElement(
  active: Element | null,
  textarea: HTMLTextAreaElement,
): boolean {
  if (!active || active === document.body || active === textarea) return false;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLSelectElement
  ) {
    return true;
  }
  if (active instanceof HTMLElement && active.isContentEditable) return true;
  // Radix dialogs / alert dialogs / popovers (role="dialog") manage
  // their own focus scope — pulling focus out from under them would
  // break Escape/Tab handling and dismiss affordances.
  return active.closest('[role="dialog"], [role="alertdialog"]') !== null;
}
