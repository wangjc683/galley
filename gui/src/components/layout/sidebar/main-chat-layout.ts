import { create } from "zustand";

import { type AppCopy, useCopy, useLanguage } from "@/lib/i18n";
import type { ResolvedLanguage } from "@/lib/language";

/**
 * TEMPORARY — the sidebar structure trial for the main chat
 * (`.scratch/main-chat` ticket 07, PRD rulings 28–33). JC compares the
 * variants live in tauri dev (pill: MainChatLayoutSwitcher.tsx) and
 * rules on the layout and the naming; removal steps at the end.
 *
 * Layouts:
 *
 *   A3 — the control (ticket 02): the main-chat row is the home, the
 *        新对话 row under it stays a full-width labelled row, quiet.
 *   B  — the skeleton: the main-chat row, then a 「旁聊」 section header
 *        with the new-chat + on it, then 置顶 / 项目 / the time buckets
 *        holding only conversations a person started; agent-started
 *        ones outside projects fold into one 「其他来源 N」 group row.
 *   B′ — B plus a collapsible sidebar (toggle at the far left of the
 *        main header, ⌘\; SidebarCollapseToggle.tsx).
 *
 * Naming: what the non-main conversations are called — 旁聊 / 话题 /
 * 其他对话 — on the section header, the + tooltip, the empty-state
 * line, A3's quiet row, the placeholder row and the busy choice's
 * second button. The main entry is 「主对话」 throughout. The English
 * UI keeps one fixed set (not part of the trial).
 *
 * Demo states: a render-layer overlay of fake live states
 * (main-chat-demo.ts) — JC's own data is mostly idle.
 *
 * Without a main chat (the external runtime) every variant is today's
 * sidebar, the demo stays off and nothing collapses.
 *
 * The choices are a per-machine convenience kept in localStorage
 * (wrapped: storage can be unavailable), never in Core.
 *
 * Removal, after the ruling (every trial line says TEMPORARY or "on
 * trial"):
 *
 *   Always — delete MainChatLayoutSwitcher.tsx and its line in App.tsx;
 *   delete main-chat-demo.ts, the demo reads in
 *   hooks/useSessionStatusView.ts and hooks/useSessionsAttention.ts,
 *   and Sidebar.tsx's `Sidebar` wrapper + `withDemoSessions` (rename
 *   `SidebarBody` back); move the chosen naming's strings into the
 *   locales (zh `sidebar.mainChat` becomes 主对话, `composer.mainChatBusy*`
 *   follow; English after copy review), point the `useMainChatTrialCopy`
 *   callers (Sidebar, App, MainChatBusyChoice, ComposerFooterHint,
 *   SidebarCollapseToggle) at `copy`, then delete this file.
 *   A3 wins — delete SidebarSideChats.tsx, header/SidebarCollapseToggle
 *   (+ test), SidebarNarrowNavRow, Sidebar.tsx's `sectioned` branch,
 *   `splitOtherSources` / `otherSources` / `isHumanStarted` in
 *   lib/sidebar-timeline.ts (+ tests), `otherSourcesSlot` in
 *   SidebarTimeline.tsx, `groupIcon` in SidebarProjectGroup.tsx,
 *   `idleSubline` in SidebarSessionRow.tsx, AppShell's
 *   `sidebarCollapsed`, MainHeader(Host)'s `leading` and App's B′ lines.
 *   B wins — `sectioned` becomes `mainChat !== undefined`; the A3 branch
 *   and SidebarQuickActions' `quiet` / `newChatLabel` go; so do B′'s
 *   pieces: header/SidebarCollapseToggle (+ test), AppShell's
 *   `sidebarCollapsed`, MainHeader(Host)'s `leading`, App's B′ lines.
 *   B′ wins — as B, but the collapse stays: `sidebarCollapsed` moves out
 *   of this store, and the two rules it breaks are rewritten
 *   (layout-and-chrome.md 「Sidebar 不可折叠」 / 「不放 Sidebar toggle」,
 *   AppShell's and app_menu.rs' comments).
 */
export type MainChatLayout = "A3" | "B" | "B′";
export type SideChatNaming = "旁聊" | "话题" | "其他对话";

export const MAIN_CHAT_LAYOUTS: readonly MainChatLayout[] = ["A3", "B", "B′"];
export const SIDE_CHAT_NAMINGS: readonly SideChatNaming[] = [
  "旁聊",
  "话题",
  "其他对话",
];

const LAYOUT_KEY = "galley.tmp.sidebarTrial.layout";
const NAMING_KEY = "galley.tmp.sidebarTrial.naming";
const DEMO_KEY = "galley.tmp.sidebarTrial.demo";
const COLLAPSED_KEY = "galley.tmp.sidebarTrial.collapsed";
// Ticket 02's keys (A1 / A2 / A3, copy pairs 甲乙丙) — superseded.
const RETIRED_KEYS = ["galley.tmp.mainChatLayout", "galley.tmp.mainChatCopy"];

const DEFAULT_LAYOUT: MainChatLayout = "B";
const DEFAULT_NAMING: SideChatNaming = "旁聊";

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

function dropRetiredKeys() {
  try {
    for (const key of RETIRED_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Nothing to tidy without storage.
  }
}

interface MainChatLayoutState {
  layout: MainChatLayout;
  naming: SideChatNaming;
  demo: boolean;
  /** When the demo was switched on (ISO): its fake sessions' activity
   * times count back from here, so rendering never reads the clock. */
  demoAnchor: string;
  /** B′: the sidebar is collapsed. Read only while B′ is on. */
  sidebarCollapsed: boolean;
  setLayout: (layout: MainChatLayout) => void;
  setNaming: (naming: SideChatNaming) => void;
  setDemo: (demo: boolean) => void;
  toggleSidebarCollapsed: () => void;
}

export const useMainChatLayoutStore = create<MainChatLayoutState>((set) => {
  dropRetiredKeys();
  return {
    layout: readStored(LAYOUT_KEY, MAIN_CHAT_LAYOUTS, DEFAULT_LAYOUT),
    naming: readStored(NAMING_KEY, SIDE_CHAT_NAMINGS, DEFAULT_NAMING),
    demo: readStored(DEMO_KEY, ["on", "off"], "off") === "on",
    demoAnchor: new Date().toISOString(),
    sidebarCollapsed:
      readStored(COLLAPSED_KEY, ["collapsed", "expanded"], "expanded") ===
      "collapsed",
    setLayout: (layout) => {
      writeStored(LAYOUT_KEY, layout);
      set({ layout });
    },
    setNaming: (naming) => {
      writeStored(NAMING_KEY, naming);
      set({ naming });
    },
    setDemo: (demo) =>
      set((state) => {
        if (state.demo === demo) return state;
        writeStored(DEMO_KEY, demo ? "on" : "off");
        return demo ? { demo, demoAnchor: new Date().toISOString() } : { demo };
      }),
    toggleSidebarCollapsed: () =>
      set((state) => {
        const sidebarCollapsed = !state.sidebarCollapsed;
        writeStored(COLLAPSED_KEY, sidebarCollapsed ? "collapsed" : "expanded");
        return { sidebarCollapsed };
      }),
  };
});

export function useMainChatLayout(): MainChatLayout {
  return useMainChatLayoutStore((s) => s.layout);
}

/** The demo overlay is on (main-chat-demo.ts decides what it fakes). */
export function useMainChatDemo(): boolean {
  return useMainChatLayoutStore((s) => s.demo);
}

/** B′'s collapse: only with a main chat and while B′ is the layout. */
export function useSidebarCollapsed(hasMainChat: boolean): boolean {
  return useMainChatLayoutStore(
    (s) => hasMainChat && s.layout === "B′" && s.sidebarCollapsed,
  );
}

/** The trial's labels — see the header comment for where each shows. */
export interface MainChatTrialCopy {
  /** The main entry: sidebar row, main header, ⌘K. */
  mainChat: string;
  /** B's section header. */
  sectionLabel: string;
  /** The new-chat action: B's + tooltip and placeholder row, A3's
   * quiet row. */
  newChat: string;
  /** B's one line while the section has no conversation a person
   * started. */
  emptyHint: string;
  /** The main-chat row's subline before its first message (B / B′). */
  idleSubline: string;
  /** B's 「其他来源」 group row. */
  otherSources: string;
  /** B′'s toggle. */
  collapseSidebar: string;
  expandSidebar: string;
  /** B′'s badge, spelled out for its tooltip and accessible name. */
  needsYouCount: (count: number) => string;
  /** The busy choice above the composer (MainChatBusyChoice). */
  busyLabel: string;
  busyQueueTooltip: string;
  busyQueueImages: string;
  busySideChat: string;
  busySideChatTooltip: string;
  busyEnterHint: string;
}

const ZH_NAMING: Record<
  SideChatNaming,
  Pick<
    MainChatTrialCopy,
    | "sectionLabel"
    | "newChat"
    | "emptyHint"
    | "busyQueueImages"
    | "busySideChat"
    | "busySideChatTooltip"
    | "busyEnterHint"
  > & { noun: string }
> = {
  旁聊: {
    noun: "旁聊",
    sectionLabel: "旁聊",
    newChat: "新旁聊",
    emptyHint: "单独聊一件事，主对话不受打扰。",
    busyQueueImages: "带图的消息不能排队，可以开旁聊",
    busySideChat: "开旁聊",
    busySideChatTooltip: "用这句话开一个旁聊，马上开始",
    busyEnterHint: "Enter 后选择排队或开旁聊",
  },
  话题: {
    noun: "话题",
    sectionLabel: "话题",
    newChat: "新话题",
    emptyHint: "一件事一个话题，主对话不受打扰。",
    busyQueueImages: "带图的消息不能排队，可以开新话题",
    busySideChat: "开新话题",
    busySideChatTooltip: "用这句话开一个新话题，马上开始",
    busyEnterHint: "Enter 后选择排队或开新话题",
  },
  其他对话: {
    noun: "对话",
    sectionLabel: "其他对话",
    newChat: "新对话",
    emptyHint: "另开一个对话聊一件事，主对话不受打扰。",
    busyQueueImages: "带图的消息不能排队，可以开新对话",
    busySideChat: "开新对话",
    busySideChatTooltip: "用这句话开一个新对话，马上开始",
    busyEnterHint: "Enter 后选择排队或开新对话",
  },
};

export function mainChatTrialCopy(
  copy: AppCopy,
  language: ResolvedLanguage,
  naming: SideChatNaming,
): MainChatTrialCopy {
  if (language === "en-US") {
    return {
      mainChat: copy.sidebar.mainChat,
      sectionLabel: "Side chats",
      newChat: copy.sidebar.newSideChat,
      emptyHint: "Talk one thing through here. The main chat stays as it is.",
      idleSubline: "Tell it anything",
      otherSources: "Other sources",
      collapseSidebar: "Hide sidebar",
      expandSidebar: "Show sidebar",
      needsYouCount: (count) =>
        count === 1 ? "1 side chat needs you" : `${count} side chats need you`,
      busyLabel: copy.composer.mainChatBusyLabel,
      busyQueueTooltip: copy.composer.mainChatBusyQueueTooltip,
      busyQueueImages: copy.composer.mainChatBusyQueueImages,
      busySideChat: copy.composer.mainChatBusySideChat,
      busySideChatTooltip: copy.composer.mainChatBusySideChatTooltip,
      busyEnterHint: copy.composer.mainChatBusyEnterHint,
    };
  }
  const { noun, ...named } = ZH_NAMING[naming];
  return {
    ...named,
    mainChat: "主对话",
    idleSubline: "什么都可以跟它说",
    otherSources: "其他来源",
    collapseSidebar: "收起侧栏",
    expandSidebar: "展开侧栏",
    needsYouCount: (count) => `${count} 个${noun}在等你`,
    busyLabel: "主对话正在忙",
    busyQueueTooltip: "本轮结束后接着交给主对话",
  };
}

export function useMainChatTrialCopy(): MainChatTrialCopy {
  const copy = useCopy();
  const language = useLanguage();
  const naming = useMainChatLayoutStore((s) => s.naming);
  return mainChatTrialCopy(copy, language, naming);
}
