import { create } from "zustand";

/**
 * TEMPORARY — the main chat row's second-line trial (`.scratch/main-chat`
 * ticket 14). What the main chat's row says under 主对话 once nothing is
 * going on. JC compares the variants live in tauri dev (pill:
 * MainChatSublineTrialSwitcher.tsx) and rules; removal steps at the end.
 *
 *   A    — states only: running, waiting for you, error (a subtask's
 *          question or error too). Settled, the row says nothing, a new
 *          reply included: the filled house and the weight say it.
 *   A′   — A, plus the turn's recap while it is unread: what the main
 *          chat said while you were away, as every other row shows it.
 *   现状 — the control: a session row's subline, the recap at rest.
 *
 * In A and A′ the row keeps the two-line height whether or not the line
 * is there, so the list under it never moves; a title standing alone
 * centres in it, as a fresh main chat's does. Other rows are unchanged
 * in every variant, and the external runtime has no main chat.
 *
 * The choice is a per-machine convenience kept in localStorage
 * (wrapped: storage can be unavailable), never in Core.
 *
 * Removal, after the ruling (every trial line says TEMPORARY or "on
 * trial"):
 *
 *   Always — delete this file, MainChatSublineTrialSwitcher.tsx, its
 *   line in App.tsx and Sidebar.main-chat-subline-trial.test.tsx (keep
 *   the winner's cases in Sidebar.main-chat.test.tsx);
 *   SidebarSessionRow's `sublineVariant` goes.
 *   现状 wins — drop `mainChatSublineTrial` / `quietSubline` and the
 *   50px height.
 *   A or A′ wins — the main chat's row always gets the 50px height, and
 *   `quietSubline` keeps (A′) or drops (A) its unread exception.
 *   Then the design doc: layout-and-chrome.md 主对话行 (「之后副行照常是
 *   状态摘要」).
 */
export type MainChatSublineVariant = "A" | "A′" | "现状";

export const MAIN_CHAT_SUBLINE_VARIANTS: readonly MainChatSublineVariant[] = [
  "A",
  "A′",
  "现状",
];

const VARIANT_KEY = "galley.tmp.mainChatSublineTrial.variant";

function readVariant(): MainChatSublineVariant {
  if (typeof window === "undefined") return "现状";
  try {
    const stored = window.localStorage.getItem(VARIANT_KEY);
    if (stored === "A" || stored === "A′" || stored === "现状") return stored;
  } catch {
    // Storage unavailable: start on the control.
  }
  return "现状";
}

export const useMainChatSublineTrialStore = create<{
  variant: MainChatSublineVariant;
  setVariant: (variant: MainChatSublineVariant) => void;
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
