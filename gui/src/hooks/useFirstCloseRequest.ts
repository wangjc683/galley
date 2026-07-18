import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Emitted by the Rust CloseRequested handler (core/src/tray.rs
 * FIRST_CLOSE_REQUESTED_EVENT) while no first-close choice has been
 * recorded. */
const FIRST_CLOSE_REQUESTED_EVENT = "first-close-requested";

/**
 * Opens the first-close choice dialog when Rust asks for it.
 *
 * The close flow stays Rust-authoritative: Rust intercepts the first
 * `CloseRequested`, keeps the window visible, and emits this event;
 * the GUI only renders the question (FirstCloseDialog) and reports
 * the verdict back through `resolveFirstClose`. If the user closes
 * the window again while the dialog is already open, the repeated
 * event is a no-op. In Vite-only browser dev `listen` rejects — the
 * catch keeps that silent, matching the app's degrade-quietly rule.
 */
export function useFirstCloseRequest(): {
  open: boolean;
  setOpen: (open: boolean) => void;
} {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    listen(FIRST_CLOSE_REQUESTED_EVENT, () => setOpen(true))
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch((e: unknown) => {
        console.debug("[first-close] event listener unavailable.", e);
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return { open, setOpen };
}
