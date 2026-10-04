import { listen } from "@tauri-apps/api/event";
import { type Dispatch, type SetStateAction, useEffect } from "react";

import type { SettingsTab } from "@/components/screens/settings/settings-types";
import { stepConversationFontSize } from "@/lib/conversation-font-size";
import { resetWindowLayout } from "@/lib/layout-reset";
import { useAppUpdateStore } from "@/stores/app-update";
import { usePrefsStore } from "@/stores/prefs";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";

function shouldSkipGlobalContextMenuGuard(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    'input, textarea, select, [contenteditable], [role="textbox"], [data-galley-context-menu-trigger]',
  );
}

/** One conversation font-size tier up or down from the size current at
 * call time (read from the store, so neither the keydown effect nor the
 * menu listeners re-bind on every size change). No write at either end. */
function stepFontSizePref(direction: 1 | -1): void {
  const { conversationFontSize, setConversationFontSize } =
    usePrefsStore.getState();
  const next = stepConversationFontSize(conversationFontSize, direction);
  if (next !== conversationFontSize) void setConversationFontSize(next);
}

export function useGlobalShortcuts({
  setEmptyComposerFocusTick,
  setSettingsTab,
}: {
  setEmptyComposerFocusTick: Dispatch<SetStateAction<number>>;
  setSettingsTab: Dispatch<SetStateAction<SettingsTab>>;
}): void {
  const togglePalette = useUiStore((s) => s.togglePalette);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const setScreen = useUiStore((s) => s.setScreen);
  const setActiveProjectFilter = useSessionsStore(
    (s) => s.setActiveProjectFilter,
  );
  const setActiveSession = useSessionsStore((s) => s.setActiveSession);
  const setConversationWidth = usePrefsStore((s) => s.setConversationWidth);
  const setConversationFontSize = usePrefsStore(
    (s) => s.setConversationFontSize,
  );
  const checkForAppUpdate = useAppUpdateStore((s) => s.check);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (shouldSkipGlobalContextMenuGuard(e.target)) return;
      e.preventDefault();
    };
    // Page zoom is a browser affordance, not a desktop-app one. Tauri's
    // `zoomHotkeysEnabled: false` covers the webview hotkeys; these two
    // guards cover the input paths it does not: Ctrl+wheel (Chromium /
    // WebView2 also reports trackpad pinch this way) and WKWebView's
    // proprietary gesture events (macOS trackpad pinch).
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    const preventGestureZoom = (e: Event) => e.preventDefault();
    const gestureTarget = window as EventTarget;
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("wheel", onWheel, { passive: false });
    gestureTarget.addEventListener("gesturestart", preventGestureZoom);
    gestureTarget.addEventListener("gesturechange", preventGestureZoom);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("wheel", onWheel);
      gestureTarget.removeEventListener("gesturestart", preventGestureZoom);
      gestureTarget.removeEventListener("gesturechange", preventGestureZoom);
    };
  }, []);

  useEffect(() => {
    // Conversation font size: ⌘= / ⌘+ up, ⌘− down, ⌘0 back to standard
    // (Ctrl on Windows / Linux) — the keys browsers use for page zoom,
    // free here because page zoom is off. `+` is taken as well as `=`
    // because + needs Shift on US layouts and is its own key elsewhere.
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      // macOS also binds these to View > Conversation Font Size, and
      // ⌘N / ⌘, to their menu items. A keystroke still acts once:
      // whichever of AppKit and the webview sees it first handles it,
      // and preventDefault below keeps WebKit from passing a handled
      // key on to the menu. Alt is excluded so AltGr (Ctrl+Alt on
      // Windows) typing a character is never read as a shortcut.
      if (!e.altKey && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        stepFontSizePref(1);
      } else if (!e.altKey && e.key === "-") {
        e.preventDefault();
        stepFontSizePref(-1);
      } else if (!e.altKey && e.key === "0") {
        e.preventDefault();
        void setConversationFontSize("standard");
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        togglePalette();
      } else if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setActiveProjectFilter(undefined);
        setActiveSession(undefined);
        setScreen("empty");
        setEmptyComposerFocusTick((tick) => tick + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    togglePalette,
    setSettingsOpen,
    setActiveProjectFilter,
    setActiveSession,
    setScreen,
    setEmptyComposerFocusTick,
    setConversationFontSize,
  ]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const handlers: Array<[string, () => void]> = [
      [
        "menu:settings",
        () => {
          // Generic entry — land on the first tab (matches the tab
          // list's visual order), same as the gear button and the
          // command palette. Deep links set their tab explicitly.
          setSettingsTab("general");
          setSettingsOpen(true);
        },
      ],
      [
        "menu:check_updates",
        () => {
          setSettingsTab("about");
          setSettingsOpen(true);
          void checkForAppUpdate({ silent: false });
        },
      ],
      [
        "menu:new_chat",
        () => {
          setActiveProjectFilter(undefined);
          setActiveSession(undefined);
          setScreen("empty");
        },
      ],
      [
        "menu:width_compact",
        () => {
          void setConversationWidth("compact");
        },
      ],
      [
        "menu:width_wide",
        () => {
          void setConversationWidth("wide");
        },
      ],
      [
        "menu:font_size_small",
        () => {
          void setConversationFontSize("small");
        },
      ],
      [
        "menu:font_size_standard",
        () => {
          void setConversationFontSize("standard");
        },
      ],
      [
        "menu:font_size_large",
        () => {
          void setConversationFontSize("large");
        },
      ],
      ["menu:font_size_bigger", () => stepFontSizePref(1)],
      ["menu:font_size_smaller", () => stepFontSizePref(-1)],
      [
        "menu:reset_layout",
        () => {
          void resetWindowLayout();
        },
      ],
    ];

    void (async () => {
      for (const [event, handler] of handlers) {
        const fn = await listen(event, handler);
        if (cancelled) {
          fn();
        } else {
          unlisteners.push(fn);
        }
      }
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [
    setSettingsOpen,
    setActiveProjectFilter,
    setActiveSession,
    setScreen,
    setConversationWidth,
    setConversationFontSize,
    setSettingsTab,
    checkForAppUpdate,
  ]);
}
