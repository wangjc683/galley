import { invoke } from "@tauri-apps/api/core";

/**
 * "Reset to Default Layout" — the one place all entry points converge
 * (Window menu via `menu:reset_layout`, command palette, and the
 * sidebar separator's double-click; all three run the full reset).
 *
 * The reset has two halves living on two sides of the IPC boundary:
 * window geometry is Rust (`reset_window_layout` — golden size clamped
 * to the monitor, centered, out of fullscreen/maximized; constants in
 * core/src/app_setup.rs) and the sidebar split is React state inside
 * AppShell's panel Group. AppShell registers its imperative reset here
 * on mount so callers outside the component tree (useGlobalShortcuts,
 * CommandPalette) don't need a prop path to it.
 */

/** Golden sidebar/main split (percent) — AppShell's defaultSize values. */
export const DEFAULT_PANEL_LAYOUT = { sidebar: 20, main: 80 };

let panelReset: (() => void) | null = null;

/** AppShell's mount-time registration. Returns the unregister. */
export function registerPanelLayoutReset(fn: () => void): () => void {
  panelReset = fn;
  return () => {
    if (panelReset === fn) panelReset = null;
  };
}

/** Split-only half (used by the full reset below). */
export function resetPanelLayout(): void {
  panelReset?.();
}

/** Full reset: sidebar split + window geometry. */
export async function resetWindowLayout(): Promise<void> {
  resetPanelLayout();
  try {
    await invoke("reset_window_layout");
  } catch (err) {
    // Vite-only browser session, or the command failed — the split
    // reset above already happened; geometry just stays put.
    console.warn("[layout] reset_window_layout failed", err);
  }
}
