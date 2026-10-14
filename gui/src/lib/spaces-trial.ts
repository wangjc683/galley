import { create } from "zustand";

import type { SessionsAttentionKind } from "@/hooks/useSessionsAttention";
import type { AppCopy } from "@/i18n/types";
import {
  ensureMainChatListed,
  findMainChat,
  openMainChat,
} from "@/lib/main-chat";
import { displaySessionSummary } from "@/lib/session-summary";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import type { Session } from "@/types/session";

/**
 * TEMPORARY — the assistant / workbench shell trial (`.scratch/main-chat`
 * ticket 16, PRD rulings 60 / 61). One window, two spaces: the assistant
 * (the main chat, standing on its own like a conversation with a person)
 * and the workbench (Galley as it was: sessions, projects, the sidebar).
 * JC compares three shells live in tauri dev (pill: SpacesTrialSwitcher)
 * and rules; removal steps at the end.
 *
 *   现状 — the control: today's B′, the main chat's row on top of the
 *          sectioned, collapsible sidebar. Exactly as before.
 *   乙   — no new column: a two-segment switch 「助手｜工作台」 right of
 *          the traffic lights (macOS from 88px, elsewhere the 16px
 *          gutter), in the same place in both spaces. In the workbench
 *          it takes the masthead wordmark's place and the three masthead
 *          icons sit in the new-chat row under it (the narrow sidebar's
 *          one-row layout); in the assistant it heads the full-width
 *          header. The sidebar never gets narrower than the switch needs.
 *   甲   — an icon rail down the window's left edge, in both spaces, wide
 *          enough to carry the traffic lights on top (80px): the
 *          assistant's avatar and the workbench icon, each labelled, and
 *          the settings gear at its foot (it leaves the header's utility
 *          cluster). The sidebar's masthead no longer clears the lights.
 *
 * Common to 乙 and 甲, which exist only on the managed runtime with a
 * main chat (the external runtime, or a managed one whose main chat has
 * not loaded yet, is 现状 in all three):
 *   - The space is the open session's: the main chat is the assistant;
 *     anything else — another session, a subtask opened from its card,
 *     the empty new-chat composer — is the workbench (`spaceOf`). Every
 *     way in (⌘K, a subtask card, 开旁聊, ⌘N, the reset in Settings)
 *     lands in the right space without knowing that spaces exist.
 *   - Assistant: no sidebar; the header is the avatar, 「Galley」 and
 *     what it is doing now (AssistantIdentity), with no title menu.
 *   - Workbench: the unsectioned sidebar (Sidebar `workbench`), never
 *     collapsed, no toggle; going there reopens what it last showed this
 *     run, or an empty new chat (`switchSpace`).
 *   - Badges only on the space you are not in: the assistant's, its main
 *     chat row's states (an error over a question over unread, its
 *     subtasks' included; running none); the workbench's, the count of
 *     conversations erroring or asking. 「演示」 adds an unread one and an
 *     asking one where nothing real shows — display only, nothing is
 *     written anywhere.
 *   - ⌘1 / ⌘2 (Ctrl+1 / Ctrl+2 elsewhere) switch: free in the page
 *     (useGlobalShortcuts, every keydown handler), the native menu and
 *     the webviews.
 *   - The subtask breadcrumb reads 「助手 ›」; ⌘K lists the main chat as
 *     助手.
 *   - A launch lands in the space last used (no record: the assistant).
 *
 * The pill's choice, the demo switch and the last space are per-machine
 * conveniences kept in localStorage (wrapped: storage can be
 * unavailable), never in Core.
 *
 * Removal, after the ruling (every trial line says TEMPORARY or
 * "ticket 16"):
 *
 *   Always — delete this file, hooks/useSpacesTrial.ts,
 *   components/layout/spaces/ and components/layout/spaces-trial.test.tsx
 *   (fold the winner's cases into the permanent tests); App.tsx's spaces
 *   wiring and the pill; hydrate.ts's `landAtLaunch()` goes back to
 *   `openMainChat()` (with 乙 or 甲, a landing that reads the last space
 *   from a Core pref) and main-chat.ts's `ensureMainChatListed` once
 *   nothing uses it; the `spaces` copy (the winner's strings move to
 *   their permanent namespaces).
 *   现状 wins — also drop Sidebar `workbench` / `mastheadLead`,
 *   SidebarHeader `lead`, AppShell `rail` / `sidebarMinSize` /
 *   `sidebarWidths`, MainHeader(Host) `titleSlot` / `hideSettings`,
 *   UtilityCluster `showSettings` and sidebar-width.ts's context (its
 *   set goes back to being this platform's constants).
 *   乙 wins — drop the rail: AppShell `rail`, SpacesRail, MainHeader
 *   `hideSettings`, UtilityCluster `showSettings`, sidebar-width's
 *   `trafficLights: false`.
 *   甲 wins — drop SpaceSwitch, Sidebar `mastheadLead`, SidebarHeader
 *   `lead`, AppShell `sidebarMinSize`, sidebar-width's `navIconsInRow`.
 *   With 乙 or 甲 — the sectioned sidebar and its collapse (tickets
 *   07–09, 13, 14) come out in a ticket of their own (ruling 60); the
 *   design docs follow (layout-and-chrome.md §3, §4.1, §4.2); ⌘1 / ⌘2
 *   join Settings → Shortcuts and overlays-and-settings.md.
 */

export type SpacesTrialVariant = "现状" | "乙" | "甲";

export const SPACES_TRIAL_VARIANTS: readonly SpacesTrialVariant[] = [
  "现状",
  "乙",
  "甲",
];

export type Space = "assistant" | "workbench";

const VARIANT_KEY = "galley.tmp.spacesTrial.variant";
const DEMO_KEY = "galley.tmp.spacesTrial.demo";
const SPACE_KEY = "galley.tmp.spacesTrial.space";

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

/** The pill's stored variant; the control when nothing (valid) is kept. */
export function readTrialVariant(): SpacesTrialVariant {
  const stored = readStorage(VARIANT_KEY);
  return stored === "乙" || stored === "甲" ? stored : "现状";
}

export const useSpacesTrialStore = create<{
  variant: SpacesTrialVariant;
  demo: boolean;
  setVariant: (variant: SpacesTrialVariant) => void;
  setDemo: (demo: boolean) => void;
}>((set) => ({
  variant: readTrialVariant(),
  demo: readStorage(DEMO_KEY) === "1",
  setVariant: (variant) => {
    writeStorage(VARIANT_KEY, variant);
    set({ variant });
  },
  setDemo: (demo) => {
    writeStorage(DEMO_KEY, demo ? "1" : "0");
    set({ demo });
  },
}));

/** Whether there are two spaces at all: a trial shell is picked and the
 * main chat is here (so the managed runtime is the active one). */
export function spacesActive(
  variant: SpacesTrialVariant,
  hasMainChat: boolean,
): boolean {
  return variant !== "现状" && hasMainChat;
}

/** The space the main area is in, from the session it shows (undefined:
 * the empty new-chat composer). */
export function spaceOf(shown: Pick<Session, "mainChat"> | undefined): Space {
  return shown?.mainChat ? "assistant" : "workbench";
}

/** What App lays out for a trial shell in a space. */
export interface SpacesLayout {
  /** The sidebar panel is hidden (not unmounted): the assistant space. */
  sidebarHidden: boolean;
  /** 甲: the icon rail, in both spaces, with the gear at its foot. */
  rail: boolean;
  /** 乙: the switch, in the masthead (workbench) or the header
   * (assistant). */
  switchIn: "masthead" | "header" | null;
  /** The header shows the assistant's identity instead of a title. */
  identity: boolean;
  /** 乙's sidebar floor, wide enough for the masthead's switch. */
  sidebarMinSize?: string;
}

export function spacesLayout(
  variant: Exclude<SpacesTrialVariant, "现状">,
  space: Space,
  sidebarMinSize?: string,
): SpacesLayout {
  const assistant = space === "assistant";
  return {
    sidebarHidden: assistant,
    rail: variant === "甲",
    switchIn: variant === "乙" ? (assistant ? "header" : "masthead") : null,
    identity: assistant,
    sidebarMinSize: variant === "乙" ? sidebarMinSize : undefined,
  };
}

/** The assistant's badge: its main chat row's state. */
export type AssistantBadgeKind = "error" | "ask" | "unread";

/**
 * In the main chat row's own priority (layout-and-chrome.md, 有主对话时):
 * an error — its own or a subtask's — over a question — its own or a
 * subtask's — over running, which gets none (the header line says it),
 * over unread.
 */
export function assistantBadgeKind(
  own: SessionsAttentionKind,
  subtasks: SessionsAttentionKind,
): AssistantBadgeKind | null {
  if (own === "error" || subtasks === "error") return "error";
  if (own === "ask" || subtasks === "ask") return "ask";
  if (own === "unread") return "unread";
  return null;
}

/** The workbench's badge: how many conversations need you, tinted error
 * when any has errored (the collapsed sidebar toggle's recipe). */
export interface WorkbenchBadge {
  count: number;
  tone: "warning" | "error";
}

export function workbenchBadge(attention: {
  kind: SessionsAttentionKind;
  needsYouIds: ReadonlySet<string>;
}): WorkbenchBadge | null {
  const count = attention.needsYouIds.size;
  if (count === 0) return null;
  return { count, tone: attention.kind === "error" ? "error" : "warning" };
}

export interface SpaceBadges {
  assistant: AssistantBadgeKind | null;
  workbench: WorkbenchBadge | null;
}

/** The badges, the demo filling in an unread assistant and one asking
 * conversation where nothing real shows. */
export function spaceBadges({
  assistant,
  workbench,
  demo,
}: {
  assistant: AssistantBadgeKind | null;
  workbench: WorkbenchBadge | null;
  demo: boolean;
}): SpaceBadges {
  return {
    assistant: assistant ?? (demo ? "unread" : null),
    workbench: workbench ?? (demo ? { count: 1, tone: "warning" } : null),
  };
}

/** A space's badge shows only while you are in the other one: the space
 * you are in is in front of you. */
export function showsBadge(badgeSpace: Space, current: Space): boolean {
  return badgeSpace !== current;
}

export interface AssistantLine {
  text: string;
  tone: "running" | "warning" | "error";
}

/**
 * What the assistant is doing now, under its name in the header: the main
 * chat row's subline (it speaks only of a state, ruling 58) — its error,
 * a subtask's error, 「在等你回复」, a subtask's question, 「第 N 步 · 摘要」
 * or 「思考中」 — and nothing at rest.
 */
export function assistantStatusLine(
  mainChat: Pick<Session, "summary" | "lastStepIndex" | "errorCount">,
  own: SessionsAttentionKind,
  subtasks: SessionsAttentionKind,
  copy: AppCopy,
): AssistantLine | null {
  if (own === "error") {
    const count = mainChat.errorCount || 0;
    return {
      text:
        count > 1 ? `${copy.sidebar.errored} · ${count}` : copy.sidebar.errored,
      tone: "error",
    };
  }
  if (subtasks === "error") {
    return { text: copy.subtask.sidebarErrored, tone: "error" };
  }
  if (own === "ask")
    return { text: copy.spaces.waitingForYou, tone: "warning" };
  if (subtasks === "ask") {
    return { text: copy.subtask.sidebarWaiting, tone: "warning" };
  }
  if (own === "running") {
    const summary = mainChat.summary
      ? displaySessionSummary(
          mainChat.summary,
          copy.sidebar.turnProtocolFailure,
        )
      : null;
    return {
      text:
        mainChat.lastStepIndex != null && summary
          ? copy.sidebar.stepSummary(mainChat.lastStepIndex, summary)
          : copy.sidebar.thinking,
      tone: "running",
    };
  }
  return null;
}

/** The badge's words, for its tooltip and accessible name. */
export function assistantBadgeWords(
  kind: AssistantBadgeKind,
  line: AssistantLine | null,
  copy: AppCopy,
): string {
  if (kind === "unread" || !line) return copy.spaces.assistantUnread;
  return line.text;
}

// ---- Launch: the space last used -------------------------------------

/** Kept while a trial shell is on screen (App). */
export function rememberSpace(space: Space): void {
  writeStorage(SPACE_KEY, space);
}

/** Whether a launch should land in the workbench: a trial shell is
 * picked and the workbench was the space last used. No record (or the
 * control) lands on the main chat, as before. */
export function launchesInWorkbench(): boolean {
  return (
    readTrialVariant() !== "现状" && readStorage(SPACE_KEY) === "workbench"
  );
}

/**
 * The managed runtime's landing at launch (hydrate.ts): in the
 * workbench when that was the space last used — the main chat is
 * listed (the assistant space and its badge need it) but the main area
 * stays on the empty composer — and otherwise on the main chat, as
 * before. Resolves whether there is a main chat.
 */
export function landAtLaunch(): Promise<boolean> {
  return launchesInWorkbench() ? ensureMainChatListed() : openMainChat();
}

// ---- What the workbench last showed (this run only) -------------------

export type WorkbenchSelection =
  | { kind: "session"; id: string }
  | { kind: "empty"; projectId?: string };

let lastWorkbench: WorkbenchSelection = { kind: "empty" };

/** Noted by App whenever the workbench is on screen. */
export function rememberWorkbench(selection: WorkbenchSelection): void {
  lastWorkbench = selection;
}

export function rememberedWorkbench(): WorkbenchSelection {
  return lastWorkbench;
}

/**
 * Go to a space with the actions every other entry point uses: the
 * assistant is the main chat opened as its row opened it; the workbench
 * reopens what it last showed — a session still listed, or the empty
 * composer with its project — and otherwise an empty new chat. Already
 * there, nothing changes.
 */
export function switchSpace(
  target: Space,
  focusEmptyComposer: () => void,
): void {
  const sessionsState = useSessionsStore.getState();
  const ui = useUiStore.getState();
  const shown =
    ui.screen === "main"
      ? sessionsState.sessions.find(
          (s) => s.id === sessionsState.activeSessionId,
        )
      : undefined;
  if (spaceOf(shown) === target) return;
  if (target === "assistant") {
    const mainChat = findMainChat(sessionsState.sessions);
    if (!mainChat) return;
    sessionsState.setActiveProjectFilter(undefined);
    void sessionsState.activateSession(mainChat.id);
    ui.setScreen("main");
    return;
  }
  const last = lastWorkbench;
  if (last.kind === "session") {
    const session = sessionsState.sessions.find(
      (s) => s.id === last.id && s.status !== "archived" && !s.mainChat,
    );
    if (session) {
      sessionsState.setActiveProjectFilter(undefined);
      void sessionsState.activateSession(session.id);
      ui.setScreen("main");
      return;
    }
  }
  sessionsState.setActiveProjectFilter(
    last.kind === "empty" ? last.projectId : undefined,
  );
  sessionsState.setActiveSession(undefined);
  ui.setScreen("empty");
  focusEmptyComposer();
}

/** ⌘1 / ⌘2 (Ctrl+1 / Ctrl+2 off macOS) → the space it names. */
export function spaceForShortcut(
  e: Pick<
    KeyboardEvent,
    "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
  >,
  mac: boolean,
): Space | null {
  if (!(mac ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return null;
  if (e.key === "1" || e.code === "Digit1") return "assistant";
  if (e.key === "2" || e.code === "Digit2") return "workbench";
  return null;
}
