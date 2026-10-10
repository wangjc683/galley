import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import {
  getRemoteStatus,
  REMOTE_STATUS_EVENT,
  type RemoteStatus,
} from "@/lib/remote";

/**
 * Core's remote-access status for Settings → Phone (ticket 05d):
 * `undefined` until Core answers, `null` when remote access does not
 * exist in this build (no relay URL — the Phone tab never shows), else
 * the latest status. Live from `remote-status` (no polling); read again
 * each time Settings opens or closes, which is cheap and covers a missed
 * event. A read that started before an event arrived is dropped, so an
 * older snapshot never overwrites a newer event.
 */
export function useRemoteStatus(
  settingsOpen: boolean,
): RemoteStatus | null | undefined {
  const [status, setStatus] = useState<RemoteStatus | null | undefined>(
    undefined,
  );
  const eventCount = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    listen<RemoteStatus>(REMOTE_STATUS_EVENT, (event) => {
      if (cancelled) return;
      eventCount.current += 1;
      setStatus(event.payload);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((e: unknown) => {
        console.warn("[remote] subscribing to remote-status failed", e);
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const eventsBefore = eventCount.current;
    getRemoteStatus()
      .then((snapshot) => {
        if (!cancelled && eventCount.current === eventsBefore) {
          setStatus(snapshot);
        }
      })
      .catch((e: unknown) => {
        // No Core to ask (a Vite-only page): no Phone tab. A failed
        // re-read keeps what is already known.
        console.warn("[remote] reading the remote status failed", e);
        if (cancelled || eventCount.current !== eventsBefore) return;
        setStatus((known) => (known === undefined ? null : known));
      });
    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  return status;
}
