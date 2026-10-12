import { create } from "zustand";

import { useCopy } from "@/lib/i18n";

/**
 * TEMPORARY — the sidebar switcher for the main chat
 * (`.scratch/main-chat` ticket 02, PRD 「桌面形态」). JC compares the
 * layouts live in tauri dev and picks one; then this file and
 * `MainChatLayoutSwitcher.tsx` go, `useMainChatLayout()` in Sidebar.tsx
 * becomes the chosen constant (or its branch is inlined), the chosen
 * copy pair moves into the locales, and the `<MainChatLayoutSwitcher />`
 * line in App.tsx goes.
 *
 *   A1 — the main-chat row sits above the 新对话 row; nothing else moves.
 *   A2 — the main-chat row takes over the escape exit: fixed at the top
 *        of the list area, the 新对话 row gone, 新旁聊 a fourth masthead
 *        icon (⌘N unchanged).
 *   A3 — A1's order with the hierarchy turned round (JC, 2026-10-12): the
 *        main-chat row is the home, the 新对话 row stays a full-width
 *        labelled row (findable, unlike A2's icon) but smaller and quiet —
 *        no brand plus, regular weight, muted ink.
 *
 * Copy pairs (main-chat label / new-chat label): 甲 follows the copy
 * rule 「用户可见的 session / chat 概念统一叫『对话』」
 * (docs/copy-language-guidelines.md); 乙 is the PRD's own words; 丙 names
 * the home after the assistant.
 *
 * The choices are a per-machine convenience kept in localStorage
 * (wrapped: storage can be unavailable), never in Core.
 */
export type MainChatLayout = "A1" | "A2" | "A3";
export type MainChatCopyVariant = "甲" | "乙" | "丙";

export const MAIN_CHAT_LAYOUTS: readonly MainChatLayout[] = ["A1", "A2", "A3"];
export const MAIN_CHAT_COPY_VARIANTS: readonly MainChatCopyVariant[] = [
  "甲",
  "乙",
  "丙",
];

const STORAGE_KEY = "galley.tmp.mainChatLayout";
const COPY_STORAGE_KEY = "galley.tmp.mainChatCopy";
const DEFAULT_LAYOUT: MainChatLayout = "A3";
const DEFAULT_COPY: MainChatCopyVariant = "甲";

function readStored<T extends string>(
  key: string,
  options: readonly T[],
  fallback: T,
): T {
  try {
    const stored = window.localStorage.getItem(key);
    return options.find((option) => option === stored) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered across reloads; the switch itself still works.
  }
}

interface MainChatLayoutState {
  layout: MainChatLayout;
  copyVariant: MainChatCopyVariant;
  setLayout: (layout: MainChatLayout) => void;
  setCopyVariant: (copyVariant: MainChatCopyVariant) => void;
}

export const useMainChatLayoutStore = create<MainChatLayoutState>((set) => ({
  layout: readStored(STORAGE_KEY, MAIN_CHAT_LAYOUTS, DEFAULT_LAYOUT),
  copyVariant: readStored(
    COPY_STORAGE_KEY,
    MAIN_CHAT_COPY_VARIANTS,
    DEFAULT_COPY,
  ),
  setLayout: (layout) => {
    writeStored(STORAGE_KEY, layout);
    set({ layout });
  },
  setCopyVariant: (copyVariant) => {
    writeStored(COPY_STORAGE_KEY, copyVariant);
    set({ copyVariant });
  },
}));

export function useMainChatLayout(): MainChatLayout {
  return useMainChatLayoutStore((s) => s.layout);
}

/**
 * The trial's labels: the main chat's (sidebar row, header, ⌘K) and the
 * new-chat action's (A1 / A3 row, A2 icon). The English UI keeps its
 * locale strings — the pairs are a Chinese copy question.
 */
export function mainChatTrialCopy(
  copy: { sidebar: { mainChat: string; newConversation: string } },
  variant: MainChatCopyVariant,
): { mainChat: string; newChat: string } {
  if (copy.sidebar.mainChat !== "主聊天") {
    return {
      mainChat: copy.sidebar.mainChat,
      newChat: copy.sidebar.newConversation,
    };
  }
  switch (variant) {
    case "乙":
      return { mainChat: "主聊天", newChat: "新旁聊" };
    case "丙":
      return { mainChat: "助理", newChat: "新对话" };
    default:
      return { mainChat: "主对话", newChat: "新对话" };
  }
}

export function useMainChatTrialCopy(): {
  mainChat: string;
  newChat: string;
} {
  const copy = useCopy();
  const variant = useMainChatLayoutStore((s) => s.copyVariant);
  return mainChatTrialCopy(copy, variant);
}
