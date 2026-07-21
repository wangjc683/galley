import { useEffect } from "react";

/**
 * Focus the composer textarea when the app window regains focus
 * (Cmd/Alt+Tab or clicking back into the window), so the user can start
 * typing without an extra click (GitHub issue #13).
 *
 * Only takes over when nothing holds focus: the WebView keeps
 * `document.activeElement` across window blur, so a session-title
 * editor, dialog field, or any other input the user left focused stays
 * focused — no per-surface allowlist needed.
 *
 * DOM-only, same shape as useBlurOnOutsidePointer. Safe to mount per
 * Composer: EmptyState and MainView render exclusively, so at most one
 * listener is live.
 */
export function useFocusOnWindowFocus(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
) {
  useEffect(() => {
    const focusComposerIfIdle = () => {
      if (document.activeElement !== document.body) return;
      textareaRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("focus", focusComposerIfIdle);
    return () => {
      window.removeEventListener("focus", focusComposerIfIdle);
    };
  }, [textareaRef]);
}
