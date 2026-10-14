import { create } from "zustand";

import type { SessionStatusView } from "@/hooks/useSessionStatusView";
import type { AppCopy } from "@/i18n/types";
import { ASSISTANT_IDLE, type AssistantState } from "@/lib/assistant";
import type { ResolvedLanguage } from "@/lib/language";
import { isMac, isWindows } from "@/lib/platform";
import type { Session } from "@/types/session";

/**
 * TEMPORARY — the sidebar's top half trial (`.scratch/main-chat`
 * ticket 17, PRD rulings 62 / 63). JC turned down both shells of
 * ticket 16: the assistant stays in the sidebar, as an entry that reads
 * as a person, above 「＋ 新对话」 and the conversations as they were.
 * JC compares four variants live in tauri dev (pill:
 * SidebarTopTrialSwitcher.tsx) and rules; removal steps at the end.
 *
 *   现状 — the control: today's B′ (tickets 07–09, 13, 14), exactly as
 *          before — the masthead, ⌂ 主对话, the 「其他对话」 header and
 *          its pressed +.
 *   2    — the masthead is the assistant: right of the traffic lights
 *          (macOS from 88px, elsewhere the 16px gutter) the wordmark
 *          becomes one button, avatar + 「Galley」, selected while the
 *          assistant is open; its states hang on the avatar; only 搜索
 *          stays on the masthead's right. Everything else on the
 *          masthead still drags the window.
 *   3    — the assistant's card: the masthead keeps only the traffic
 *          lights and 搜索 (the rest drags); under it a card — a 32px
 *          avatar, 「Galley」 and, under the name, what it is doing.
 *   3′   — 3 with a 48px avatar centred, the name under it, the state
 *          under that (macOS Messages' pinned contacts).
 *
 * Common to 2 / 3 / 3′, which exist only on the managed runtime with a
 * main chat (the external runtime, or a main chat not loaded yet, is
 * 现状 in all four):
 *   - The entry's state is the main chat row's (lib/assistant.ts):
 *     running 「第 N 步 · 摘要」 / 「思考中」, a question or an error —
 *     a subtask's too — and nothing at rest; unread marks the avatar
 *     and bolds the name. The avatar's mark is the row's status icon
 *     for running, a question, an error and unread; 2 has no room for
 *     the words, its tooltip and accessible name carry them.
 *   - Below it, on the app ground (ticket 09), the list opens on
 *     「＋ 新对话 ⌘N」 with 定时 / 新建项目 at the row's end; it is the
 *     sticky first row, and it is selected while the empty new-chat
 *     composer is up (a project's too), until the first send's row
 *     takes over — replacing ticket 13's pressed + and the 「其他对话」
 *     header. No main chat row; the main chat and its unpromoted
 *     subtasks stay out of the list.
 *   - The main header shows the assistant's identity in the title's
 *     place while it is open (no title menu); the subtask crumb, ⌘K
 *     and the identity call it 「Galley」 (⌘K still finds 主对话 /
 *     助手 / main chat / assistant).
 *   - The sidebar still collapses (⌘\, the main header's toggle).
 *
 * 「演示」 shows one state on the assistant — the entry in 2 / 3 / 3′,
 * the main chat row in 现状 — display only, nothing is written; unread
 * shows only while the assistant is not open, as it would.
 *
 * The pill's choices are per-machine conveniences kept in localStorage
 * (wrapped: storage can be unavailable), never in Core.
 *
 * Removal, after the ruling (every trial line says TEMPORARY or
 * 「票 17」 / "ticket 17"):
 *
 *   Always — delete this file, SidebarTopTrialSwitcher.tsx and
 *   components/layout/Sidebar.top-trial.test.tsx (fold the winner's
 *   cases into Sidebar.main-chat.test.tsx and the header / palette
 *   tests); App's pill, its `topVariant` / `topDemo` wiring and the
 *   main chat's naming switch; Sidebar `topVariant` / `topDemo`;
 *   SidebarSessionRow `statusOverride`; the hooks' `demo` parameter.
 *   现状 wins — also delete components/layout/assistant/,
 *   sidebar/SidebarAssistant.tsx, hooks/useAssistantState.ts,
 *   lib/assistant.ts and the `assistant` copy; drop MainHeader(Host)
 *   `identity`, CommandPalette `sessionKeywords` (palette-search.ts's
 *   `keywords`), NewChatButton's export and `display`, SidebarNavIcons
 *   `items` / `display`.
 *   2, 3 or 3′ wins — keep the winner's pieces of SidebarAssistant.tsx
 *   and delete the others; the managed runtime's sidebar loses the
 *   main chat row, SidebarNarrowNavRow, the 「其他对话」 header, its hint
 *   and the pressed + (tickets 08, 13, 14); the widths below move into
 *   sidebar-width.ts. Then the design docs (layout-and-chrome.md §4.1,
 *   §4.2 「有主对话时」), conversation.md's crumb, and the remaining
 *   「主对话」 copy (改名定稿 is its own step).
 */

export type SidebarTopVariant = "现状" | "2" | "3" | "3′";

export const SIDEBAR_TOP_VARIANTS: readonly SidebarTopVariant[] = [
  "现状",
  "2",
  "3",
  "3′",
];

export type SidebarTopDemo = "无" | "在跑" | "在问你" | "未读";

export const SIDEBAR_TOP_DEMOS: readonly SidebarTopDemo[] = [
  "无",
  "在跑",
  "在问你",
  "未读",
];

const VARIANT_KEY = "galley.tmp.sidebarTopTrial.variant";
const DEMO_KEY = "galley.tmp.sidebarTopTrial.demo";

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered this time; the choice still applies.
  }
}

/** A stored variant, or the control when nothing valid is kept. */
export function readSidebarTopVariant(): SidebarTopVariant {
  const stored = readStorage(VARIANT_KEY);
  return SIDEBAR_TOP_VARIANTS.find((v) => v === stored) ?? "现状";
}

/** A stored demo state, or none. */
export function readSidebarTopDemo(): SidebarTopDemo {
  const stored = readStorage(DEMO_KEY);
  return SIDEBAR_TOP_DEMOS.find((d) => d === stored) ?? "无";
}

export const useSidebarTopTrialStore = create<{
  variant: SidebarTopVariant;
  demo: SidebarTopDemo;
  setVariant: (variant: SidebarTopVariant) => void;
  setDemo: (demo: SidebarTopDemo) => void;
}>((set) => ({
  variant: readSidebarTopVariant(),
  demo: readSidebarTopDemo(),
  setVariant: (variant) => {
    writeStorage(VARIANT_KEY, variant);
    set({ variant });
  },
  setDemo: (demo) => {
    writeStorage(DEMO_KEY, demo);
    set({ demo });
  },
}));

/** Whether a trial variant replaces the top half: one is picked and
 * the main chat is here (so the managed runtime is the active one). */
export function sidebarTopActive(
  variant: SidebarTopVariant,
  hasMainChat: boolean,
): boolean {
  return variant !== "现状" && hasMainChat;
}

// ---- Naming: 主对话 in the control, Galley in 2 / 3 / 3′ ------------

/** The main chat's name in the main header's crumb and ⌘K. */
export interface MainChatNaming {
  label: string;
  crumbAria: string;
  /** Extra words ⌘K matches it by (not shown). */
  searchKeywords?: string;
}

/** ⌘K finds the assistant by its old name and its role too, in either
 * UI language. */
const ASSISTANT_SEARCH_KEYWORDS = "主对话 助手 main chat assistant";

export function mainChatNaming(
  assistantTop: boolean,
  copy: AppCopy,
): MainChatNaming {
  return assistantTop
    ? {
        label: copy.assistant.name,
        crumbAria: copy.assistant.backTo,
        searchKeywords: ASSISTANT_SEARCH_KEYWORDS,
      }
    : { label: copy.sidebar.mainChat, crumbAria: copy.subtask.backToMainChat };
}

// ---- 演示 -------------------------------------------------------------

/** The running demo's step recap (ticket 17's own example). */
const DEMO_STEP_SUMMARY: Record<ResolvedLanguage, string> = {
  "zh-CN": "查厦门明天的天气",
  "en-US": "Checking tomorrow's weather in Xiamen",
};

const DEMO_STEP = 3;

/** What 「演示」 puts on the assistant's entry, or null for none. A new
 * reply is never unread while the assistant is open. */
export function demoAssistantState(
  demo: SidebarTopDemo,
  open: boolean,
  copy: AppCopy,
  language: ResolvedLanguage,
): AssistantState | null {
  switch (demo) {
    case "在跑": {
      const text = copy.sidebar.stepSummary(
        DEMO_STEP,
        DEMO_STEP_SUMMARY[language],
      );
      return { kind: "running", line: { text, tone: "running" }, words: text };
    }
    case "在问你": {
      const text = copy.sidebar.waitingForYou;
      return { kind: "ask", line: { text, tone: "warning" }, words: text };
    }
    case "未读":
      return open
        ? ASSISTANT_IDLE
        : { kind: "unread", line: null, words: copy.sidebar.newReplyTitle };
    case "无":
      return null;
  }
}

/** The same demo on the control's main chat row: a live status over
 * the store's and a patch on the row's session, both display only. */
export function demoMainChatRow(
  demo: SidebarTopDemo,
  language: ResolvedLanguage,
): { statusOverride?: Partial<SessionStatusView>; patch?: Partial<Session> } {
  switch (demo) {
    case "在跑":
      return {
        statusOverride: { status: "running" },
        patch: {
          lastStepIndex: DEMO_STEP,
          summary: DEMO_STEP_SUMMARY[language],
        },
      };
    case "在问你":
      return { statusOverride: { hasPendingAskUser: true } };
    case "未读":
      return { patch: { hasUnread: true } };
    case "无":
      return {};
  }
}

// ---- Widths -----------------------------------------------------------

/**
 * The width-driven classes of 2 / 3 / 3′'s top rows, against
 * `@container/sidebar` (sidebar-width.ts explains the container and why
 * every class is written out). The arithmetic:
 *
 * The new-chat row: mx-1.5 × 2 + pr-1 = 16, each 32px icon with its
 * 2px gap 34; the button is pl-3 12 + the plus column 16 + gap-2 8 +
 * the label + its pr-2 8 (44 + label), and the hint + its pr-3 12 on
 * top. Labels: 新对话 3 × 13 = 39px, New chat 58.84px (Inter 500 13px,
 * from the font file). Hints, measured in Chrome: ⌘N 16.6px, Ctrl+N
 * 39.4px. On Windows the row, the scroll list's sticky first row, loses
 * the 10px scrollbar lane.
 *   label (2 icons)  16 + 68 + 44 + label     zh 167 → 168 / en 187
 *                    Windows +10              zh 177 / en 197
 *   hint (2 icons)   + 12 + hint, rounded up with ~1.5px for WebKit's
 *                    ⌘: mac zh 197 / en 217; Windows zh 230 / en 250;
 *                    Linux zh 220 / en 240
 *
 * 2's masthead: pl (80 under the macOS lights, 8 elsewhere) + the entry
 * (px-2 8 + 20px avatar + gap-1.5 6 + 「Galley」 Inter 600 13px 39.34 +
 * px-2 8 = 81.34) + gap-3 12 + 搜索 28 + pr (12; Windows 22). Narrower,
 * the name goes first and 搜索 stays put: mac 214, Windows 152, Linux
 * 142. The avatar alone (36) still fits 搜索 beside it down to mac 168
 * (80 + 36 + 12 + 28 + 12); below that 搜索 steps down into the new-chat
 * row (3 icons: the label would need zh 201 / en 221, so the row is the
 * plus alone there — hence zh's 168). Off macOS 8 + 36 + 12 + 28 + 22 =
 * 106 always fits.
 *
 * 3 / 3′'s masthead (the lights or nothing, then 搜索) and their cards
 * fit the 134px minimum; the card's words fade when cut.
 */
export interface AssistantTopWidths {
  /** 2: the entry's name. */
  entryName: string;
  /** 2: 搜索 on the masthead, and in the new-chat row (the complement). */
  mastheadSearch: string;
  rowSearch: string;
  /** The new-chat row's label, by UI language, and its ⌘N. */
  label: { zh: string; en: string };
  hint: Record<ResolvedLanguage, string>;
}

const MAC_WIDTHS: AssistantTopWidths = {
  entryName: "@max-[214px]/sidebar:hidden",
  mastheadSearch: "hidden @min-[168px]/sidebar:flex",
  rowSearch: "flex @min-[168px]/sidebar:hidden",
  label: {
    zh: "@max-[168px]/sidebar:hidden",
    en: "@max-[187px]/sidebar:hidden",
  },
  hint: {
    "zh-CN": "hidden @min-[197px]/sidebar:block",
    "en-US": "hidden @min-[217px]/sidebar:block",
  },
};

const WINDOWS_WIDTHS: AssistantTopWidths = {
  entryName: "@max-[152px]/sidebar:hidden",
  mastheadSearch: "flex",
  rowSearch: "hidden",
  label: {
    zh: "@max-[177px]/sidebar:hidden",
    en: "@max-[197px]/sidebar:hidden",
  },
  hint: {
    "zh-CN": "hidden @min-[230px]/sidebar:block",
    "en-US": "hidden @min-[250px]/sidebar:block",
  },
};

const OTHER_WIDTHS: AssistantTopWidths = {
  entryName: "@max-[142px]/sidebar:hidden",
  mastheadSearch: "flex",
  rowSearch: "hidden",
  label: {
    zh: "@max-[168px]/sidebar:hidden",
    en: "@max-[187px]/sidebar:hidden",
  },
  hint: {
    "zh-CN": "hidden @min-[220px]/sidebar:block",
    "en-US": "hidden @min-[240px]/sidebar:block",
  },
};

export const ASSISTANT_TOP_WIDTHS: AssistantTopWidths = isMac
  ? MAC_WIDTHS
  : isWindows
    ? WINDOWS_WIDTHS
    : OTHER_WIDTHS;
