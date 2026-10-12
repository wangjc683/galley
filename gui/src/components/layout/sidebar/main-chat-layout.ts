import { create } from "zustand";

/**
 * TEMPORARY — the A1 / A2 sidebar switcher for the main chat
 * (`.scratch/main-chat` ticket 02, PRD 「桌面形态」). JC compares the two
 * live in tauri dev and picks one; then this file and
 * `MainChatLayoutSwitcher.tsx` go, `useMainChatLayout()` in Sidebar.tsx
 * becomes the chosen constant (or its branch is inlined), and the
 * `<MainChatLayoutSwitcher />` line in App.tsx goes.
 *
 *   A1 — the main-chat row sits above the 新对话 row; nothing else moves.
 *   A2 — the main-chat row takes over the escape exit: fixed at the top
 *        of the list area, the 新对话 row gone, 新旁聊 a fourth masthead
 *        icon (⌘N unchanged).
 *
 * The choice is a per-machine convenience kept in localStorage (wrapped:
 * storage can be unavailable), never in Core.
 */
export type MainChatLayout = "A1" | "A2";

export const MAIN_CHAT_LAYOUTS: readonly MainChatLayout[] = ["A1", "A2"];

const STORAGE_KEY = "galley.tmp.mainChatLayout";
const DEFAULT_LAYOUT: MainChatLayout = "A2";

function readStoredLayout(): MainChatLayout {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "A1" || stored === "A2" ? stored : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

interface MainChatLayoutState {
  layout: MainChatLayout;
  setLayout: (layout: MainChatLayout) => void;
}

export const useMainChatLayoutStore = create<MainChatLayoutState>((set) => ({
  layout: readStoredLayout(),
  setLayout: (layout) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, layout);
    } catch {
      // Not remembered across reloads; the switch itself still works.
    }
    set({ layout });
  },
}));

export function useMainChatLayout(): MainChatLayout {
  return useMainChatLayoutStore((s) => s.layout);
}
