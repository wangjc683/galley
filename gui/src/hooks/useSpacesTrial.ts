import { useEffect, useMemo } from "react";

import { useSessionsAttention } from "@/hooks/useSessionsAttention";
import type { AppCopy } from "@/i18n/types";
import type { ResolvedLanguage } from "@/lib/language";
import { findMainChat } from "@/lib/main-chat";
import { isMac, isWindows } from "@/lib/platform";
import {
  type AssistantLine,
  assistantBadgeKind,
  assistantBadgeWords,
  assistantStatusLine,
  rememberSpace,
  rememberWorkbench,
  type Space,
  type SpaceBadges,
  spaceBadges,
  spaceForShortcut,
  spaceOf,
  type SpacesLayout,
  spacesActive,
  spacesLayout,
  type SpacesTrialVariant,
  switchSpace,
  useSpacesTrialStore,
  workbenchBadge,
} from "@/lib/spaces-trial";
import { isUnpromotedSubtask, unpromotedSubtasksOf } from "@/lib/subtasks";
import type { Screen } from "@/stores/ui";
import type { Session } from "@/types/session";

/**
 * 乙's sidebar floor: the masthead's left padding + the switch + the
 * header's right padding, so the switch is never cut. The switch is its
 * two 12px labels with 8px sides, a 2px gap and a 2px-padded 1px track:
 * 「助手」「工作台」 100px, 「Assistant」「Workbench」 157px (Inter 400,
 * measured from the font file); 4px of slack for font fallback.
 */
function switchSidebarMinSize(language: ResolvedLanguage): string {
  const switchWidth = language === "en-US" ? 161 : 104;
  const padding = isMac ? 88 + 12 : isWindows ? 16 + 22 : 16 + 12;
  return `${switchWidth + padding}px`;
}

export interface SpacesTrialView {
  variant: SpacesTrialVariant;
  /** Two spaces on screen (乙 or 甲, with a main chat). */
  active: boolean;
  space: Space;
  /** What App lays out; null for the control (or no spaces). */
  layout: SpacesLayout | null;
  badges: SpaceBadges;
  assistantWords?: string;
  workbenchWords?: string;
  /** Under the assistant's name in its header. */
  statusLine: AssistantLine | null;
  switchTo: (space: Space) => void;
}

/**
 * TEMPORARY (ticket 16) — App's side of the spaces trial
 * (lib/spaces-trial.ts): which shell, which space, the badges and the
 * assistant's status line; it keeps the last space (for the next
 * launch) and what the workbench shows (for coming back to it), and
 * binds ⌘1 / ⌘2 while two spaces are on screen.
 *
 * `shown` is the session in the main area (undefined: the empty
 * composer). Badge sources follow the sidebar: the main chat and its
 * unpromoted subtasks for the assistant — but not a subtask open in
 * front of you — and the workbench's list (no main chat, no unpromoted
 * subtask) for the workbench.
 */
export function useSpacesTrial({
  sessions,
  shown,
  screen,
  activeSessionId,
  activeProjectFilter,
  focusEmptyComposer,
  copy,
  language,
}: {
  /** Visible (unarchived) sessions. */
  sessions: Session[];
  shown: Session | undefined;
  screen: Screen;
  activeSessionId: string | undefined;
  activeProjectFilter: string | undefined;
  focusEmptyComposer: () => void;
  copy: AppCopy;
  language: ResolvedLanguage;
}): SpacesTrialView {
  const variant = useSpacesTrialStore((s) => s.variant);
  const demo = useSpacesTrialStore((s) => s.demo);
  const mainChat = useMemo(() => findMainChat(sessions), [sessions]);
  const active = spacesActive(variant, mainChat !== undefined);
  const space = spaceOf(shown);
  const shownId = shown?.id;

  // Without spaces (the control, the external runtime) the lists stay
  // empty, so App subscribes to no session state it did not before.
  const mainChatList = useMemo(
    () => (active && mainChat ? [mainChat] : []),
    [active, mainChat],
  );
  const subtasksNotShown = useMemo(
    () =>
      active
        ? unpromotedSubtasksOf(sessions, mainChat?.id).filter(
            (s) => s.id !== shownId,
          )
        : [],
    [active, sessions, mainChat, shownId],
  );
  const workbenchSessions = useMemo(
    () =>
      active
        ? sessions.filter((s) => !s.mainChat && !isUnpromotedSubtask(s))
        : [],
    [active, sessions],
  );
  const own = useSessionsAttention(mainChatList, shownId);
  const subtaskAttention = useSessionsAttention(subtasksNotShown, shownId);
  const workbenchAttention = useSessionsAttention(workbenchSessions, shownId);

  const badges = spaceBadges({
    assistant: assistantBadgeKind(own.kind, subtaskAttention.kind),
    workbench: workbenchBadge(workbenchAttention),
    demo,
  });
  const statusLine =
    active && mainChat
      ? assistantStatusLine(mainChat, own.kind, subtaskAttention.kind, copy)
      : null;
  const assistantWords = badges.assistant
    ? assistantBadgeWords(badges.assistant, statusLine, copy)
    : undefined;
  const workbenchWords = badges.workbench
    ? copy.topbar.sidebarNeedsYou(badges.workbench.count)
    : undefined;

  // The space last used, for the next launch.
  useEffect(() => {
    if (active) rememberSpace(space);
  }, [active, space]);
  // What the workbench shows, to come back to it.
  useEffect(() => {
    if (!active || space !== "workbench") return;
    rememberWorkbench(
      screen === "main" && activeSessionId
        ? { kind: "session", id: activeSessionId }
        : { kind: "empty", projectId: activeProjectFilter },
    );
  }, [active, space, screen, activeSessionId, activeProjectFilter]);
  // ⌘1 / ⌘2.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const target = spaceForShortcut(e, isMac);
      if (!target) return;
      e.preventDefault();
      switchSpace(target, focusEmptyComposer);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, focusEmptyComposer]);

  const layout =
    active && variant !== "现状"
      ? spacesLayout(variant, space, switchSidebarMinSize(language))
      : null;
  return {
    variant,
    active,
    space,
    layout,
    badges,
    assistantWords,
    workbenchWords,
    statusLine,
    switchTo: (target) => switchSpace(target, focusEmptyComposer),
  };
}
