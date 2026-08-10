import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import {
  getImSupervisorStatus,
  type ImSupervisorPlatform,
  type ImSupervisorStatus,
} from "@/lib/im-supervisor";

/**
 * Last-known status per platform, module-level so re-entering the
 * Channels tab paints the correct card state on the first frame.
 * Without it every mount starts from null, and cards whose default
 * expansion derives from the status briefly render the wrong state,
 * then snap when the fetch lands (the Channels collapse-flash).
 * Kept fresh by the mount fetch, the `im-supervisor-updated`
 * listener, and explicit setStatus calls; a caller setting null
 * (e.g. after a credential save invalidates the old state) clears
 * the entry.
 */
const statusCache = new Map<ImSupervisorPlatform, ImSupervisorStatus>();

export function useImSupervisorStatus(
  platform: ImSupervisorPlatform,
  enabled = true,
) {
  const [status, setStatus] = useState<ImSupervisorStatus | null>(() =>
    enabled ? (statusCache.get(platform) ?? null) : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const replaceStatus = useCallback(
    (next: ImSupervisorStatus | null) => {
      if (next) statusCache.set(platform, next);
      else statusCache.delete(platform);
      setStatus(next);
      setLoadError(null);
    },
    [platform],
  );

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const setError = (e: unknown) => {
      void Promise.resolve().then(() => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      });
    };

    if (!enabled) {
      void Promise.resolve().then(() => {
        if (!cancelled) replaceStatus(null);
      });
      return () => {
        cancelled = true;
      };
    }

    try {
      void getImSupervisorStatus(platform)
        .then((next) => {
          if (!cancelled) replaceStatus(next);
        })
        .catch(setError);
    } catch (e) {
      setError(e);
    }

    try {
      void listen<ImSupervisorStatus>("im-supervisor-updated", (event) => {
        if (!cancelled && event.payload.platform === platform) {
          replaceStatus(event.payload);
        }
      })
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(setError);
    } catch (e) {
      setError(e);
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, platform, replaceStatus]);

  return { status, setStatus: replaceStatus, loadError };
}
