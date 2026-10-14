import { create } from "zustand";

/**
 * TEMPORARY — the new-chat placeholder trial (`.scratch/main-chat`
 * ticket 13). With a main chat, where the empty new-chat composer's
 * "you are here" sits in the sidebar. JC compares the variants live in
 * tauri dev (pill: NewChatTrialSwitcher.tsx) and rules; removal steps
 * at the end.
 *
 *   现状 — the control (ticket 08): a selected 新对话 row at the top of
 *          其他对话 (SidebarNewSideChatRow), above 置顶 / 项目.
 *   B    — no row: the + that opened the composer stays pressed — the
 *          section header's, or the project group row's (shown while
 *          pressed, like on hover).
 *   A    — a draft row where the conversation will land: the first row
 *          of 今天 (its label comes along when today has nothing yet),
 *          or of its project's group (hanging under a folded group or
 *          项目 section, as a selected session does).
 *
 * In B and A the first send's session takes over at once: it is listed
 * (and the store's active session) a beat before the screen flips, and
 * its row is selected from then on. The external runtime has no trial.
 *
 * The choice is a per-machine convenience kept in localStorage
 * (wrapped: storage can be unavailable), never in Core.
 *
 * Removal, after the ruling (every trial line says TEMPORARY or "on
 * trial"):
 *
 *   Always — delete this file, NewChatTrialSwitcher.tsx and its line in
 *   App.tsx; Sidebar.tsx's `trialVariant` goes and `newChat` becomes the
 *   winner.
 *   现状 wins — drop `SidebarNewChatDraftRow`, the header's
 *   `plusPressed`, SidebarTimeline / SidebarProjectGroup's `newChatDraft`
 *   / `pressedPlusProjectId` / `draft` / `plusPressed`, and App's
 *   `newChatProjectId` / `newChatSessionId`.
 *   B wins — drop SidebarNewSideChatRow, `SidebarNewChatDraftRow` and
 *   the draft plumbing.
 *   A wins — drop SidebarNewSideChatRow, the header's `plusPressed` and
 *   the pressed-plus plumbing.
 *   Then the design doc: layout-and-chrome.md 「有主对话时由占位行承接
 *   『你在这里』」, the sectioned sketch and the 组行 rule that names the
 *   placeholder row.
 */
export type NewChatTrialVariant = "现状" | "B" | "A";

export const NEW_CHAT_TRIAL_VARIANTS: readonly NewChatTrialVariant[] = [
  "现状",
  "B",
  "A",
];

const VARIANT_KEY = "galley.tmp.newChatTrial.variant";

function readVariant(): NewChatTrialVariant {
  if (typeof window === "undefined") return "现状";
  try {
    const stored = window.localStorage.getItem(VARIANT_KEY);
    if (stored === "现状" || stored === "B" || stored === "A") return stored;
  } catch {
    // Storage unavailable: start on the control.
  }
  return "现状";
}

export const useNewChatTrialStore = create<{
  variant: NewChatTrialVariant;
  setVariant: (variant: NewChatTrialVariant) => void;
}>((set) => ({
  variant: readVariant(),
  setVariant: (variant) => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(VARIANT_KEY, variant);
      } catch {
        // Not remembered this time; the pick still applies.
      }
    }
    set({ variant });
  },
}));
