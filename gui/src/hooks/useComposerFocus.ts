import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

import { focusComposerUnlessClaimed } from "@/lib/composer-focus";

/**
 * All composer focus wiring in one hook. The policy (when the composer
 * may take focus) lives in lib/composer-focus.ts; this hook owns the
 * triggers:
 *
 * 1. Mount — a composer that appears is a composer ready to type into
 *    (GitHub issue #13). This is a component contract, not an option:
 *    both hosts (EmptyState, MainView's per-session keyed remount)
 *    want the caret without a click.
 * 2. Window activation — two listeners, because the platforms disagree:
 *    Tauri `onFocusChanged` (Rust `WindowEvent::Focused`) is the
 *    reliable cross-platform signal; Windows WebView2 does NOT fire the
 *    DOM `window` focus event on Alt+Tab (WebView2Feedback#4626). The
 *    DOM listener stays as the fallback for non-Tauri hosts (Vite dev
 *    in a plain browser). Both firing for one activation is fine: the
 *    second `focus()` call is a no-op.
 * 3. Outside pointerdown — blur workaround for a desktop WebView quirk
 *    where some focus paths turn the first outside click into "blur
 *    only", swallowing the click on a button / link / menuitem. We blur
 *    during the capture phase, then re-dispatch the click ourselves if
 *    the native one never arrives.
 *
 * Known gap: on Windows, Alt+Tab reactivation sets DOM focus correctly
 * but WebView2 can leave Win32 keyboard focus stranded outside the
 * webview — no JS-side call can fix that (see devlog
 * 2026-07-21-windows-composer-refocus; investigation on debug/win-focus).
 *
 * DOM-only from React's perspective. Safe to mount per Composer:
 * EmptyState and MainView render exclusively, so at most one set of
 * listeners is live.
 */
export function useComposerFocus(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  composerRootRef: React.RefObject<HTMLDivElement | null>,
) {
  // 1. Mount: the appearing composer takes focus (unless claimed).
  // The ref is stable, so this runs once per composer instance.
  useEffect(() => {
    focusComposerUnlessClaimed(textareaRef.current);
  }, [textareaRef]);

  // 2. Window activation → refocus.
  useEffect(() => {
    const refocus = () => focusComposerUnlessClaimed(textareaRef.current);

    window.addEventListener("focus", refocus);

    let cancelled = false;
    let unlistenTauriFocus: (() => void) | undefined;
    void (async () => {
      try {
        const unlisten = await getCurrentWindow().onFocusChanged(
          ({ payload: focused }) => {
            if (cancelled || !focused) return;
            refocus();
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
      window.removeEventListener("focus", refocus);
      unlistenTauriFocus?.();
    };
  }, [textareaRef]);

  // 3. Outside pointerdown → blur, then forward the swallowed click.
  useEffect(() => {
    const blurBeforeOutsidePointerTarget = (event: PointerEvent) => {
      if (document.activeElement !== textareaRef.current) return;
      if (event.button !== 0 || event.ctrlKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (composerRootRef.current?.contains(target)) return;
      const clickTarget = target.closest<HTMLElement>(
        'button, a[href], [role="button"], [role="menuitem"], [role="radio"]',
      );
      let nativeClickSeen = false;

      const markNativeClick = (clickEvent: MouseEvent) => {
        if (!clickTarget) return;
        const nativeTarget = clickEvent.target;
        if (!(nativeTarget instanceof Node)) return;
        if (
          nativeTarget === clickTarget ||
          clickTarget.contains(nativeTarget)
        ) {
          nativeClickSeen = true;
        }
      };

      // Some desktop WebView focus paths can turn the first outside
      // click into "blur only". Blur during capture instead, then
      // let the same pointer event continue to the intended target.
      textareaRef.current?.blur();
      if (!clickTarget) return;

      document.addEventListener("click", markNativeClick, true);
      window.setTimeout(() => {
        document.removeEventListener("click", markNativeClick, true);
        if (nativeClickSeen || !clickTarget.isConnected) return;
        clickTarget.click();
      }, 80);
    };

    document.addEventListener(
      "pointerdown",
      blurBeforeOutsidePointerTarget,
      true,
    );
    return () => {
      document.removeEventListener(
        "pointerdown",
        blurBeforeOutsidePointerTarget,
        true,
      );
    };
  }, [textareaRef, composerRootRef]);
}
