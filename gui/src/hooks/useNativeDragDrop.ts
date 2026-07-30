import { useEffect, useRef } from "react";

import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * Subscribe to Tauri's native drag-drop stream for the lifetime of the
 * caller. With `dragDropEnabled: true`, wry consumes every external OS
 * drag before the webview sees it (HTML5 drag events never fire — see
 * .scratch/composer-file-drop/issues/01), so this hook is the only drop
 * intake in the app.
 *
 * The event is window-global with physical coordinates; per the PRD we
 * accept a drop anywhere in the window while a composer is mounted, so
 * the position is deliberately ignored. Exactly one Composer mounts at a
 * time (MainView xor EmptyState) — if that ever changes, this
 * subscription must move up to a single owner or drops double-handle.
 *
 * Text / URL drags arrive with empty `paths` (the payload carries paths
 * only); they surface as `onTextDrop` so the caller can explain the
 * accepted limitation (PRD 定案 8) instead of failing silently.
 */
export function useNativeDragDrop({
  enabled,
  onActiveChange,
  onPathsDrop,
  onTextDrop,
}: {
  /** When false, events are ignored (mirrors "can type ⇒ can drop"). */
  enabled: boolean;
  /** Drives the drop overlay. Only file drags (non-empty paths on enter)
   * activate it; text drags get no affordance since we can't accept them. */
  onActiveChange: (active: boolean) => void;
  /** A drop carrying at least one filesystem path. */
  onPathsDrop: (paths: string[]) => void;
  /** A drop carrying no paths (text / URL / promise-only drag). */
  onTextDrop: () => void;
}) {
  // Latest-callback refs so the singleton subscription never re-arms on
  // render churn (the handlers close over per-render state upstream).
  const handlersRef = useRef({ enabled, onActiveChange, onPathsDrop, onTextDrop });
  useEffect(() => {
    handlersRef.current = { enabled, onActiveChange, onPathsDrop, onTextDrop };
  });

  useEffect(() => {
    // Vite-only browser session (web-only tasks): no Tauri runtime, no
    // native drags to subscribe to. Skip instead of rejecting on import.
    if (!isTauri()) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const handlers = handlersRef.current;
        if (!handlers.enabled) return;
        const payload = event.payload;
        switch (payload.type) {
          case "enter":
            if (payload.paths.length > 0) handlers.onActiveChange(true);
            break;
          case "over":
            break;
          case "leave":
            handlers.onActiveChange(false);
            break;
          case "drop":
            handlers.onActiveChange(false);
            if (payload.paths.length > 0) {
              handlers.onPathsDrop(payload.paths);
            } else {
              handlers.onTextDrop();
            }
            break;
        }
      })
      .then((fn) => {
        // Unmount can win the race against the async subscribe; release
        // immediately in that case instead of leaking the listener.
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((err) => {
        console.warn("[Composer] drag-drop subscription failed", err);
      });

    return () => {
      disposed = true;
      unlisten?.();
      unlisten = null;
    };
  }, []);
}
