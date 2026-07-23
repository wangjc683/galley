import { MainHeader } from "@/components/layout/MainHeader";
import { useActiveRuntime } from "@/hooks/useActiveSession";
import type { SettingsTab } from "@/components/screens/settings/settings-types";
import type { ImSupervisorState } from "@/lib/im-supervisor";
import type { ResolvedTheme } from "@/lib/theme";
import { useAppUpdateStore } from "@/stores/app-update";
import { useBrowserControlStore } from "@/stores/browser-control";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import type { GoalBrief } from "@/types/goal";

/**
 * Self-subscribing wrapper around the MainHeader, extracted from
 * `App.tsx`. Header-only concerns (width / font / theme toggles,
 * reinject, the pet toggle, app-update restart) select their stores
 * here; App passes down only what must stay single-instance at its
 * level (goal state from `useGoalEffects`, channel aggregates from
 * `useChannelsStatus`, the settings opener).
 */
export function MainHeaderHost({
  activeGoals,
  channelsState,
  channelsLoadError,
  onOpenGoalProject,
  onOpenGoal,
  onStopGoal,
  openSettings,
  onOpenSettings,
  resolvedTheme,
  sessionTitle,
}: {
  activeGoals: GoalBrief[];
  channelsState: ImSupervisorState | null;
  channelsLoadError: string | null;
  onOpenGoalProject: (projectId: string) => void;
  onOpenGoal: (goalId: string) => void;
  onStopGoal: (goalId: string) => void;
  /** Open Settings on a specific tab (browser-control / channels entries). */
  openSettings: (tab: SettingsTab) => void;
  /** Open Settings on whatever tab it last showed (the gear entry). */
  onOpenSettings: () => void;
  resolvedTheme: ResolvedTheme;
  sessionTitle: string | undefined;
}) {
  const browserControlStatus = useBrowserControlStore((s) => s.status);
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
  const bridgeStatus = useActiveRuntime((r) => r.bridgeStatus, "idle");
  const sendIPCCommand = useRuntimeStore((s) => s.sendIPCCommand);
  const petAttachedSessionId = useRuntimeStore((s) => s.petAttachedSessionId);
  const setPendingPetMigration = useUiStore((s) => s.setPendingPetMigration);
  const restartAppUpdate = useAppUpdateStore((s) => s.restart);
  const appUpdateStatus = useAppUpdateStore((s) => s.status);

  return (
    <MainHeader
      sessionTitle={sessionTitle}
      browserControlStatus={
        activeRuntimeKind === "managed" ? browserControlStatus : null
      }
      onOpenBrowserControl={() => openSettings("browser")}
      channelsState={activeRuntimeKind === "managed" ? channelsState : null}
      channelsLoadError={
        activeRuntimeKind === "managed" ? channelsLoadError : null
      }
      onOpenChannelsSettings={
        activeRuntimeKind === "managed" ? () => openSettings("im") : undefined
      }
      activeGoals={activeGoals}
      onOpenGoalProject={onOpenGoalProject}
      onOpenGoal={onOpenGoal}
      onStopGoal={onStopGoal}
      appUpdateStatus={appUpdateStatus}
      hasRunningSessions={hasRunningSessions}
      onRestartAppUpdate={() => {
        void restartAppUpdate();
      }}
      conversationWidth={conversationWidth}
      onToggleConversationWidth={() => {
        void setConversationWidth(
          conversationWidth === "wide" ? "compact" : "wide",
        );
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
      onReinjectTools={() => {
        // Reinject targets the currently active session — that's
        // the conversation the user is reading when they notice
        // tool drift. No-op if no active session (button is
        // available but does nothing rather than throwing).
        if (!activeSessionId) return;
        if (bridgeStatus !== "connected") return;
        void sendIPCCommand(activeSessionId, {
          kind: "reinject_tools",
        });
      }}
      onTogglePet={() => {
        // Three cases (see devlog 2026-05-14 pet UX overhaul):
        //   1. Active session HOLDS the pet → detach (close).
        //   2. Pet on another session → implicit migrate:
        //      detach old + stash target; the pet_detached IPC
        //      handler fires the follow-up attach once the
        //      port is released.
        //   3. No pet anywhere → attach to active.
        // The sidebar Cat badge tells the user where the pet
        // currently lives, so the menu's "桌面宠物" always
        // reads as "I want it here" without surprise.
        if (!activeSessionId) return;
        if (petAttachedSessionId === activeSessionId) {
          void sendIPCCommand(activeSessionId, {
            kind: "detach_pet",
          });
          return;
        }
        if (bridgeStatus !== "connected") return;
        if (petAttachedSessionId) {
          setPendingPetMigration(activeSessionId);
          void sendIPCCommand(petAttachedSessionId, {
            kind: "detach_pet",
          });
          return;
        }
        void sendIPCCommand(activeSessionId, {
          kind: "attach_pet",
          port: 41983,
        });
      }}
      currentSessionHasPet={
        !!activeSessionId && petAttachedSessionId === activeSessionId
      }
      onRenameSession={(newTitle) => {
        if (!activeSessionId) return;
        renameSession(activeSessionId, newTitle);
      }}
      onOpenSettings={onOpenSettings}
    />
  );
}
