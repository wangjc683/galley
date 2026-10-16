import { create } from "zustand";

import { paletteAfterFind, type PaletteScope } from "@/lib/palette-scope";
import type { AppError } from "@/types/app-error";

export type Screen = "onboarding" | "empty" | "main";

interface UiState {
  screen: Screen;
  paletteOpen: boolean;
  /**
   * The conversation the palette searches in (⌘F, the title menu's
   * 查找聊天记录; main chat ticket 28); null = everywhere, ⌘K. Every
   * other way of opening the palette, and every close, clears it.
   */
  paletteScope: PaletteScope | null;
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

  /**
   * "Open the Git review" — bumped by the command palette, which App
   * renders outside LocalFileWorkspace (the review's owner) and so
   * cannot reach GitReviewContext. The owner subscribes and opens the
   * panel on every bump. Pure UI coordination, never persisted.
   */
  reviewRequest: number;

  /**
   * The to-do panel beside the main chat is wanted (main chat ticket
   * 42). It shows only while the main chat itself is on screen (App):
   * leaving for the workbench or a subtask folds it away and coming
   * back brings it again. It shares the reading panel's place, one at a
   * time: opening a file preview or the Git review clears it
   * (LocalFileWorkspace), and setting it closes them. Per window run,
   * never persisted.
   */
  todoPanelOpen: boolean;

  /**
   * "Quote this into that conversation's composer" — the to-do panel's
   * 「说说这件」 (ticket 42), which sits outside MainView and so cannot
   * reach its composer. MainView subscribes and quotes on every new
   * request for the session it shows. Pure UI coordination.
   */
  quoteRequest: QuoteRequest | null;
}

export interface QuoteRequest {
  sessionId: string;
  text: string;
  nonce: number;
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
  /** ⌘F / 查找聊天记录: the palette inside `target`, or ⌘K's toggle
   * when no conversation is open (`paletteAfterFind`). */
  findInConversation: (target: PaletteScope | null) => void;
  /** Backspace in the empty input, or the scope's ×: back to ⌘K. */
  dropPaletteScope: () => void;
  setSettingsOpen: (o: boolean) => void;
  toggleSettings: () => void;

  pushToast: (e: AppError) => void;
  dismissToast: (id: string) => void;

  setPendingPetMigration: (sessionId: string | null) => void;

  requestLocate: (sessionId: string, messageId: string, query?: string) => void;
  clearLocate: () => void;

  requestReview: () => void;

  setTodoPanelOpen: (open: boolean) => void;
  requestQuote: (sessionId: string, text: string) => void;
}

export type UiStore = UiState & UiActions;

export const useUiStore = create<UiStore>((set, get) => ({
  screen: "empty",
  paletteOpen: false,
  paletteScope: null,
  settingsOpen: false,
  toasts: [],
  pendingPetMigrationTo: null,
  locateRequest: null,
  reviewRequest: 0,
  todoPanelOpen: false,
  quoteRequest: null,

  setScreen: (s) => set({ screen: s }),
  setPaletteOpen: (o) => set({ paletteOpen: o, paletteScope: null }),
  togglePalette: () =>
    set({ paletteOpen: !get().paletteOpen, paletteScope: null }),
  findInConversation: (target) => {
    const { paletteOpen, paletteScope } = get();
    const next = paletteAfterFind(
      { open: paletteOpen, scope: paletteScope },
      target,
    );
    set({ paletteOpen: next.open, paletteScope: next.scope });
  },
  dropPaletteScope: () => set({ paletteScope: null }),
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

  requestReview: () =>
    set((state) => ({ reviewRequest: state.reviewRequest + 1 })),

  setTodoPanelOpen: (open) => set({ todoPanelOpen: open }),
  requestQuote: (sessionId, text) =>
    set((state) => ({
      quoteRequest: {
        sessionId,
        text,
        nonce: (state.quoteRequest?.nonce ?? 0) + 1,
      },
    })),
}));
