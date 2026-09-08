import { create } from "zustand";

import type { AppError } from "@/types/app-error";

export type Screen = "onboarding" | "empty" | "main";

interface UiState {
  screen: Screen;
  paletteOpen: boolean;
  settingsOpen: boolean;

  toasts: AppError[];

  /**
   * Desktop Pet implicit-migration staging slot. Set by the title-menu
   * click in a session that doesn't currently hold the pet; consumed
   * by the pet_detached IPC handler to fire the follow-up attach_pet
   * once the old pet's port is released.
   *
   * Pure UI coordination state, no persistence — pet's subprocess dies
   * on app exit anyway.
   */
  pendingPetMigrationTo: string | null;

  /**
   * "Open this session and park this message at the anchor line" —
   * set by a palette full-text hit, consumed by useStickyScroll once
   * the session's turns are on screen. `nonce` lets the same message
   * be re-requested. Pure UI coordination, never persisted.
   */
  locateRequest: LocateRequest | null;
}

export interface LocateRequest {
  sessionId: string;
  messageId: string;
  /** The palette query that produced the hit — term-highlighted inside
   * the located message and used to park its first occurrence, not
   * just the block, at the anchor line. */
  query?: string;
  nonce: number;
}

interface UiActions {
  setScreen: (s: Screen) => void;
  setPaletteOpen: (o: boolean) => void;
  togglePalette: () => void;
  setSettingsOpen: (o: boolean) => void;
  toggleSettings: () => void;

  pushToast: (e: AppError) => void;
  dismissToast: (id: string) => void;

  setPendingPetMigration: (sessionId: string | null) => void;

  requestLocate: (sessionId: string, messageId: string, query?: string) => void;
  clearLocate: () => void;
}

export type UiStore = UiState & UiActions;

export const useUiStore = create<UiStore>((set, get) => ({
  screen: "empty",
  paletteOpen: false,
  settingsOpen: false,
  toasts: [],
  pendingPetMigrationTo: null,
  locateRequest: null,

  setScreen: (s) => set({ screen: s }),
  setPaletteOpen: (o) => set({ paletteOpen: o }),
  togglePalette: () => set({ paletteOpen: !get().paletteOpen }),
  setSettingsOpen: (o) => set({ settingsOpen: o }),
  toggleSettings: () => set({ settingsOpen: !get().settingsOpen }),

  pushToast: (e) =>
    set((state) => ({
      toasts: [e, ...state.toasts.filter((t) => t.id !== e.id)],
    })),

  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  setPendingPetMigration: (sessionId) =>
    set({ pendingPetMigrationTo: sessionId }),

  requestLocate: (sessionId, messageId, query) =>
    set({
      locateRequest: {
        sessionId,
        messageId,
        query: query?.trim() || undefined,
        nonce: Date.now(),
      },
    }),
  clearLocate: () => set({ locateRequest: null }),
}));
