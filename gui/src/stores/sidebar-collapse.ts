import { create } from "zustand";

import { getPref, setPref } from "@/lib/db";

/** Pref key for the collapsed sidebar (main chat ticket 08). */
export const SIDEBAR_COLLAPSED_PREF = "sidebar_collapsed";

interface SidebarCollapseState {
  /** The user's choice. It only takes effect while there is a main chat
   * (the managed runtime): App ANDs it with that, so switching to the
   * external runtime shows the sidebar and switching back hides it
   * again. */
  collapsed: boolean;
  /** The stored value has been read (or failed to read); from then on
   * every change is written back. */
  loaded: boolean;
  /** Toggled before the stored value arrived. */
  changedBeforeLoad: boolean;
  /** Read the stored value once. Safe to call again: a second call,
   * or one racing the first, changes nothing. */
  hydrate: () => Promise<void>;
  toggle: () => void;
}

/**
 * Whether the sidebar is collapsed — expanded by default, remembered
 * across launches in Core prefs, by the 项目 section's rule
 * (hooks/useSidebarProjectsCollapsed.ts): the stored value only fills
 * in the default, so a toggle (⌘\ or the button) that lands before the
 * read returns wins over it, and is written back once the read is in.
 *
 * A store rather than that hook's local reducer: App reads it for
 * AppShell and hands it to the toggle in the main header, two places
 * with no common owner below App.
 */
export const useSidebarCollapseStore = create<SidebarCollapseState>(
  (set, get) => ({
    collapsed: false,
    loaded: false,
    changedBeforeLoad: false,
    hydrate: async () => {
      if (get().loaded) return;
      let stored: boolean | undefined;
      try {
        stored = await getPref<boolean>(SIDEBAR_COLLAPSED_PREF);
      } catch {
        // No Tauri host (plain Vite) or a read error: keep the default,
        // and still let later changes persist.
        stored = undefined;
      }
      const state = get();
      if (state.loaded) return;
      if (state.changedBeforeLoad) {
        set({ loaded: true });
        void setPref(SIDEBAR_COLLAPSED_PREF, state.collapsed).catch(() => {});
        return;
      }
      set({ loaded: true, collapsed: stored === true });
    },
    toggle: () => {
      const { collapsed, loaded, changedBeforeLoad } = get();
      const next = !collapsed;
      set({
        collapsed: next,
        changedBeforeLoad: changedBeforeLoad || !loaded,
      });
      if (loaded) void setPref(SIDEBAR_COLLAPSED_PREF, next).catch(() => {});
    },
  }),
);
