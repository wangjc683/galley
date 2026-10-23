import {
  MainHeader,
  type MainHeaderProps,
} from "@/components/layout/MainHeader";
import type { RuntimeIndicator } from "@/components/layout/header/runtime-indicator";
import { type ReactNode, useContext, useState } from "react";
import { GitReviewContext } from "@/lib/git-review";
import { ResetMainChatDialog } from "@/components/screens/settings/runtime/ResetMainChatAccess";
import type { SettingsTab } from "@/components/screens/settings/settings-types";
import { findInOpenConversation } from "@/lib/find-in-conversation";
import type { ImSupervisorStatus } from "@/lib/im-supervisor";
import type { ResolvedTheme } from "@/lib/theme";
import { useAppUpdateStore } from "@/stores/app-update";
import { useBrowserControlStore } from "@/stores/browser-control";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useSessionsStore } from "@/stores/sessions";

/**
 * Self-subscribing wrapper around the MainHeader, extracted from
 * `App.tsx`. Header-only concerns (the 显示 popover's width / font /
 * theme, app-update restart) select their stores here; App passes down
 * only what must stay single-instance at its
 * level (per-platform channel statuses and the restart action from
 * `useChannelsStatus`, the engine indicator from `useLLMDisplay`, the
 * settings opener).
 */
export function MainHeaderHost({
  channelStatuses,
  channelsLoadError,
  onRestartChannels,
  runtimeIndicator,
  openSettings,
  onOpenSettings,
  resolvedTheme,
  sessionTitle,
  canRenameSession = true,
  isMainChat = false,
  leading,
  breadcrumb,
  identity,
  todoOpen = false,
  onToggleTodo,
}: {
  channelStatuses: ReadonlyArray<ImSupervisorStatus | null>;
  channelsLoadError: string | null;
  onRestartChannels: () => void;
  runtimeIndicator: RuntimeIndicator;
  /** Open Settings on a specific tab (engine / browser-control /
   * channels / Supervisor SOP entries). */
  openSettings: (tab: SettingsTab) => void;
  /** Open Settings on whatever tab it last showed (the gear entry). */
  onOpenSettings: () => void;
  resolvedTheme: ResolvedTheme;
  sessionTitle: string | undefined;
  /** False for the main chat (主聊天): the title menu has no Rename. */
  canRenameSession?: boolean;
  /** The open conversation is the main chat: on the managed runtime its
   * title menu ends with 重置主对话… (ticket 28). */
  isMainChat?: boolean;
  /** MainHeader's leftmost slot (the sidebar toggle, with a main chat). */
  leading?: ReactNode;
  /** 「Galley ›」 before the title while a subtask is open (ticket 06a). */
  breadcrumb?: MainHeaderProps["breadcrumb"];
  /** The assistant's identity as the title menu's trigger (ticket 18). */
  identity?: MainHeaderProps["identity"];
  /** The to-do panel is on screen (ticket 45). */
  todoOpen?: boolean;
  /** The 待办 button: passed in every conversation's top bar while
   * there is a main chat (App, ticket 46); on the managed runtime only,
   * as the main chat is. */
  onToggleTodo?: () => void;
}) {
  const browserControlStatus = useBrowserControlStore((s) => s.status);
  const browserControlVerified = useBrowserControlStore((s) => s.verified);
  const browserControlVerificationHydrated = useBrowserControlStore(
    (s) => s.verificationHydrated,
  );
  const browserControlTabCount = useBrowserControlStore(
    (s) => s.bridge?.tabCount ?? s.lastProbe?.tabCount ?? 0,
  );
  const browserControlErrorKind = useBrowserControlStore(
    (s) => s.bridge?.errorKind ?? null,
  );
  const browserControlError = useBrowserControlStore((s) => s.error);
  const gitReview = useContext(GitReviewContext);
  const activeRuntimeKind = usePrefsStore((s) => s.activeRuntimeKind);
  const conversationWidth = usePrefsStore((s) => s.conversationWidth);
  const setConversationWidth = usePrefsStore((s) => s.setConversationWidth);
  const conversationFontSize = usePrefsStore((s) => s.conversationFontSize);
  const setConversationFontSize = usePrefsStore(
    (s) => s.setConversationFontSize,
  );
  const themePreference = usePrefsStore((s) => s.themePreference);
  const setThemePreference = usePrefsStore((s) => s.setThemePreference);
  const activeSessionId = useSessionsStore((s) => s.activeSessionId);
  const renameSession = useSessionsStore((s) => s.renameSession);
  const hasRunningSessions = useMessagesStore((s) =>
    Object.values(s.byId).some((messages) => messages.agentRunning),
  );
  const restartAppUpdate = useAppUpdateStore((s) => s.restart);
  const appUpdateStatus = useAppUpdateStore((s) => s.status);
  // 重置主对话… from the title menu opens Settings' own confirm (ticket
  // 28; the row in Settings stays). The conditions are that row's: the
  // managed runtime, a main chat (here: the open one).
  const [resetOpen, setResetOpen] = useState(false);
  const canResetMainChat = isMainChat && activeRuntimeKind === "managed";

  // Changes shows only while there is a repository to open (project
  // root or the one last reviewed) — without one the button only led to
  // an empty "choose a repository" panel. It stays while the review is
  // open so it can close it. The palette's 查看仓库改动 is always there.
  const showChanges =
    gitReview !== null && (gitReview.isOpen || gitReview.repositoryKnown);

  const header = (
    <MainHeader
      onToggleTodo={activeRuntimeKind === "managed" ? onToggleTodo : undefined}
      todoOpen={todoOpen}
      onToggleChanges={showChanges ? gitReview.toggle : undefined}
      changesOpen={gitReview?.isOpen}
      sessionTitle={sessionTitle}
      browserControl={
        activeRuntimeKind === "managed"
          ? {
              status: browserControlStatus,
              verified: browserControlVerified,
              verificationHydrated: browserControlVerificationHydrated,
              tabCount: browserControlTabCount,
              errorKind: browserControlErrorKind,
              errorDetail: browserControlError,
            }
          : null
      }
      onOpenBrowserControl={() => openSettings("browser")}
      channelStatuses={activeRuntimeKind === "managed" ? channelStatuses : []}
      channelsLoadError={
        activeRuntimeKind === "managed" ? channelsLoadError : null
      }
      onOpenChannelsSettings={
        activeRuntimeKind === "managed" ? () => openSettings("im") : undefined
      }
      onRestartChannels={
        activeRuntimeKind === "managed" ? onRestartChannels : undefined
      }
      runtimeIndicator={runtimeIndicator}
      onOpenRuntimeSettings={() => openSettings("runtime")}
      onOpenModelsSettings={() => openSettings("models")}
      // The assistant is the supervisor on the managed runtime: no SOP
      // icon there, Settings → Agent and ⌘K still reach it (ruling 106).
      onOpenSupervisorSop={
        activeRuntimeKind === "managed"
          ? undefined
          : () => openSettings("integration")
      }
      appUpdateStatus={appUpdateStatus}
      hasRunningSessions={hasRunningSessions}
      onRestartAppUpdate={() => {
        void restartAppUpdate();
      }}
      conversationWidth={conversationWidth}
      onChangeConversationWidth={(width) => {
        void setConversationWidth(width);
      }}
      conversationFontSize={conversationFontSize}
      onChangeConversationFontSize={(size) => {
        void setConversationFontSize(size);
      }}
      themePreference={themePreference}
      resolvedTheme={resolvedTheme}
      onChangeThemePreference={(preference) => {
        void setThemePreference(preference);
      }}
      onRenameSession={
        canRenameSession
          ? (newTitle) => {
              if (!activeSessionId) return;
              renameSession(activeSessionId, newTitle);
            }
          : undefined
      }
      onFindInChat={findInOpenConversation}
      onResetMainChat={canResetMainChat ? () => setResetOpen(true) : undefined}
      resetMainChatBlocked={hasRunningSessions}
      onOpenSettings={onOpenSettings}
      leading={leading}
      breadcrumb={breadcrumb}
      identity={identity}
    />
  );

  return (
    <>
      {header}
      {/* Mounted only while open, as in Settings: every opening starts
          clean. */}
      {resetOpen && (
        <ResetMainChatDialog
          open
          onOpenChange={setResetOpen}
          hasRunningSessions={hasRunningSessions}
        />
      )}
    </>
  );
}
