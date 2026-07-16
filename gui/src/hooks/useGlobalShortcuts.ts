import { listen } from "@tauri-apps/api/event";
import { type Dispatch, type SetStateAction, useEffect } from "react";

import type { SettingsTab } from "@/components/screens/settings/settings-types";
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
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === "k" || e.key === "K") {
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
  ]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const handlers: Array<[string, () => void]> = [
      ["menu:settings", () => setSettingsOpen(true)],
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
    setSettingsTab,
    checkForAppUpdate,
  ]);
}
