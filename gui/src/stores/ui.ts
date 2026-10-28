import { create } from "zustand";

import type { SettingsTab } from "@/components/screens/settings/settings-types";
import { paletteAfterFind, type PaletteScope } from "@/lib/palette-scope";
import type { TodoGlance } from "@/lib/todo-open";
import {
  readTodoPanelIntroduced,
  readTodoPanelOpen,
  writeTodoPanelIntroduced,
  writeTodoPanelOpen,
  type TodoPlace,
} from "@/lib/todo-panel-memory";
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
   * The to-do panel is wanted (main chat ticket 42), in each of its two
   * places (ticket 46): beside Galley itself, and beside anything else
   * (App shows the one for what is on screen). Leaving for the other
   * place folds it away, coming back brings it again. It shares the
   * reading panel's place, one at a time: a file preview replacing it on
   * screen clears that place, the Git review opening anywhere clears
   * both (LocalFileWorkspace), and opening either closes them.
   * Remembered on this machine across restarts (tickets 45, 46,
   * lib/todo-panel-memory.ts): every set writes its place, and each
   * starts from what was written — closed when nothing readable was.
   * Not shown, and neither read nor written, while the main area is
   * narrow (`todoNarrow`, ticket 87).
   */
  todoPanelOpen: Readonly<Record<TodoPlace, boolean>>;

  /**
   * The main area is narrower than the to-do panel's split (760px,
   * LocalFileWorkspace's ResizeObserver, which writes it): the panel
   * would cover the conversation's right edge, so the remembered open is
   * not shown and a look is taken instead (main chat ticket 87, PRD
   * ruling 131 point 2). Narrow until first measured, so a remembered
   * panel never flashes as a cover before the width is known.
   */
  todoNarrow: boolean;

  /**
   * The to-do panel open for a look, never remembered (ticket 87): taken
   * in a narrow main area, it folds when you leave the conversation it
   * is open in, and stays through a widening (lib/todo-open.ts). Never
   * in localStorage, never in Core.
   */
  todoGlance: TodoGlance | null;

  /**
   * The to-do panel has been met on this machine
   * (lib/todo-panel-memory.ts `readTodoPanelIntroduced`, ticket 87): it
   * no longer opens by itself. Starts from what was written.
   */
  todoPanelIntroduced: boolean;

  /**
   * "Light these rows up" — a card's title, or the panel's one opening
   * by itself (ticket 87). The panel takes it once its rows are on
   * screen: unfolds 已完成 for one there, scrolls the first into view
   * and flashes them (useTodoPanelFlash), then clears it; a card's title
   * on one of your to-dos opens that row too (`open`, ticket 107). Pure
   * UI coordination.
   */
  todoRowRequest: TodoRowRequest | null;

  /**
   * "Show this page of the panel" (main chat ticket 97): a memo card's
   * words want 备忘, ⌘K's 「待办」 wants 待办. The panel takes it as it
   * mounts or while it is on screen, then clears it. Which page is up is
   * the panel's own state, not this: every opening that asks for nothing
   * lands on 待办, and nothing remembers the page once the panel is gone.
   * Pure UI coordination.
   */
  todoPageRequest: TodoPageRequest | null;

  /**
   * "Quote this into that conversation's composer" — the to-do panel's
   * 「说说这件」 (ticket 42), which sits outside MainView and so cannot
   * reach its composer. The MainView showing that session quotes it and
   * clears it: at once when it is on screen, on mounting when the panel
   * sent you there first (ticket 46). Pure UI coordination.
   */
  quoteRequest: QuoteRequest | null;

  /**
   * "Open Settings on this tab" from somewhere App's own handlers can't
   * reach — a ChatGPT plan error in the conversation (SIWC ticket 04).
   * `requestSettings` opens Settings; App takes the tab (a new nonce),
   * Settings → 模型 expands the ChatGPT provider once when asked. Pure
   * UI coordination, never persisted.
   */
  settingsRequest: SettingsRequest | null;
}

export interface SettingsRequest {
  tab: SettingsTab;
  /** Expand the ChatGPT provider's card (its sign-in lives there). */
  expandChatGpt: boolean;
  nonce: number;
}

export interface QuoteRequest {
  sessionId: string;
  text: string;
  nonce: number;
}

/** The to-do panel's two pages (main chat ticket 97, PRD ruling 142
 * point 5): the to-do list, and the memos. */
export type TodoPanelPage = "todo" | "memo";

export interface TodoPageRequest {
  page: TodoPanelPage;
  nonce: number;
}

export interface TodoRowRequest {
  /** The rows' ids (`data-todo-row`). */
  ids: readonly string[];
  nonce: number;
  /** Open the row too: a to-do card's title (main chat ticket 107, PRD
   * ruling 153), on one of your to-dos not done. The panel opening by
   * itself only lights. */
  open?: boolean;
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

  requestLocate: (sessionId: string, messageId: string, query?: string) => void;
  clearLocate: () => void;

  requestReview: () => void;

  setTodoPanelOpen: (place: TodoPlace, open: boolean) => void;
  setTodoNarrow: (narrow: boolean) => void;
  setTodoGlance: (glance: TodoGlance | null) => void;
  /** Write that the panel has been met (ticket 87). */
  markTodoPanelIntroduced: () => void;
  requestTodoRows: (
    ids: readonly string[],
    options?: { open?: boolean },
  ) => void;
  /** The panel took the request with this nonce. */
  clearTodoRowRequest: (nonce: number) => void;
  requestTodoPage: (page: TodoPanelPage) => void;
  /** The panel took the page request with this nonce. */
  clearTodoPageRequest: (nonce: number) => void;
  requestQuote: (sessionId: string, text: string) => void;
  clearQuote: () => void;
  requestSettings: (
    tab: SettingsTab,
    options?: { expandChatGpt?: boolean },
  ) => void;
  /** Settings → 模型 expanded the ChatGPT card the request asked for. */
  clearSettingsExpand: () => void;
}

export type UiStore = UiState & UiActions;

export const useUiStore = create<UiStore>((set, get) => ({
  screen: "empty",
  paletteOpen: false,
  paletteScope: null,
  settingsOpen: false,
  toasts: [],
  locateRequest: null,
  reviewRequest: 0,
  todoPanelOpen: {
    galley: readTodoPanelOpen("galley"),
    elsewhere: readTodoPanelOpen("elsewhere"),
  },
  todoNarrow: true,
  todoGlance: null,
  todoPanelIntroduced: readTodoPanelIntroduced(),
  todoRowRequest: null,
  todoPageRequest: null,
  quoteRequest: null,
  settingsRequest: null,

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

  setTodoPanelOpen: (place, open) => {
    writeTodoPanelOpen(place, open);
    // A remembered open or close is one you saw (a preview replacing
    // the panel on screen included), or the one time it opened by
    // itself: met either way (ticket 87). A close deletes the open key,
    // so the flag is what keeps it met.
    get().markTodoPanelIntroduced();
    set((state) => ({
      todoPanelOpen: { ...state.todoPanelOpen, [place]: open },
    }));
  },
  setTodoNarrow: (narrow) => {
    if (get().todoNarrow !== narrow) set({ todoNarrow: narrow });
  },
  setTodoGlance: (glance) => set({ todoGlance: glance }),
  markTodoPanelIntroduced: () => {
    // Written every time, not only the first: met at start because a
    // place was open, it must stay met once that key is deleted.
    writeTodoPanelIntroduced();
    if (!get().todoPanelIntroduced) set({ todoPanelIntroduced: true });
  },
  requestTodoRows: (ids, options) =>
    set((state) => ({
      todoRowRequest: {
        ids,
        nonce: (state.todoRowRequest?.nonce ?? 0) + 1,
        ...(options?.open ? { open: true } : {}),
      },
    })),
  clearTodoRowRequest: (nonce) => {
    if (get().todoRowRequest?.nonce === nonce) set({ todoRowRequest: null });
  },
  requestTodoPage: (page) =>
    set((state) => ({
      todoPageRequest: {
        page,
        nonce: (state.todoPageRequest?.nonce ?? 0) + 1,
      },
    })),
  clearTodoPageRequest: (nonce) => {
    if (get().todoPageRequest?.nonce === nonce) set({ todoPageRequest: null });
  },
  requestQuote: (sessionId, text) =>
    set((state) => ({
      quoteRequest: {
        sessionId,
        text,
        nonce: (state.quoteRequest?.nonce ?? 0) + 1,
      },
    })),
  clearQuote: () => set({ quoteRequest: null }),
  requestSettings: (tab, options) =>
    set((state) => ({
      settingsOpen: true,
      settingsRequest: {
        tab,
        expandChatGpt: options?.expandChatGpt ?? false,
        nonce: (state.settingsRequest?.nonce ?? 0) + 1,
      },
    })),
  clearSettingsExpand: () =>
    set((state) =>
      state.settingsRequest?.expandChatGpt
        ? {
            settingsRequest: { ...state.settingsRequest, expandChatGpt: false },
          }
        : state,
    ),
}));
