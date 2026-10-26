import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { useDayStamp } from "@/hooks/useDayStamp";
import { MEMOS_CHANGED_EVENT } from "@/lib/memo";
import { useMemoStore } from "@/stores/memo";

/** How long the memos wait after Core's event before reading again: a
 * run noting several reads once. */
const REFRESH_DEBOUNCE_MS = 150;

/**
 * Keep the memos (stores/memo.ts) current while there is a main chat
 * (main chat ticket 97): read them, then again on Core's
 * `memos:changed` (a write, the desktop's delete, a run's end filling in
 * the reply a card hangs under, a reset; debounced), and when the day
 * turns — the page's 今天 is this machine's day, and a memo past its last
 * day leaves the list then. Mounted once, in App; `enabled` false (the
 * external runtime, no main chat yet) reads nothing.
 */
export function useMemoSync(enabled: boolean): void {
  const dayStamp = useDayStamp();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unlisten: (() => void) | null = null;
    const soon = () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void useMemoStore.getState().load();
      }, REFRESH_DEBOUNCE_MS);
    };
    void listen(MEMOS_CHANGED_EVENT, soon).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      unlisten?.();
    };
  }, [enabled]);

  // The first read, and again when the day turns.
  useEffect(() => {
    if (!enabled) return;
    void useMemoStore.getState().load();
  }, [enabled, dayStamp]);
}
