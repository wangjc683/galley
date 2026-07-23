import { Settings } from "@/components/screens/settings/Settings";
import type { SettingsTab } from "@/components/screens/settings/settings-types";
import type { ResolvedTheme } from "@/lib/theme";
import { useCopy, useLanguage } from "@/lib/i18n";
import { useManagedModelsStore } from "@/stores/managed-models";
import { useMessagesStore } from "@/stores/messages";
import { usePrefsStore } from "@/stores/prefs";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

/**
 * Self-subscribing wrapper around the Settings dialog, extracted from
 * `App.tsx`. Everything Settings needs from prefs / runtime / sessions
 * stores is selected here so App only owns the open/tab state and the
 * few cross-cutting callbacks (onboarding re-entry, browser-control
 * demo) that must stay single-instance at the App level. Must render
 * inside `CopyProvider` (uses the copy / language context).
 */
export function SettingsHost({
  open,
  onOpenChange,
  tab,
  onTabChange,
  resolvedTheme,
  onReRunHealthCheck,
  onOpenSetupAssistant,
  onRunBrowserControlDemo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  resolvedTheme: ResolvedTheme;
  onReRunHealthCheck: () => void;
  onOpenSetupAssistant: () => void;
  onRunBrowserControlDemo: () => void;
}) {
  const copy = useCopy();
  const resolvedLanguage = useLanguage();

  const runtimeInfo = useRuntimeStore((s) => s.runtimeInfo);
  const approvalConfig = usePrefsStore((s) => s.approvalConfig);
  const setApprovalRequiredTools = usePrefsStore(
    (s) => s.setApprovalRequiredTools,
  );
  const removeAlwaysAllow = usePrefsStore((s) => s.removeAlwaysAllow);
  const yoloMode = usePrefsStore((s) => s.yoloMode);
  const setYoloMode = usePrefsStore((s) => s.setYoloMode);
  const languagePreference = usePrefsStore((s) => s.languagePreference);
  const setLanguagePreference = usePrefsStore((s) => s.setLanguagePreference);
  const themePreference = usePrefsStore((s) => s.themePreference);
  const setThemePreference = usePrefsStore((s) => s.setThemePreference);
  const conversationFontSize = usePrefsStore((s) => s.conversationFontSize);
  const setConversationFontSize = usePrefsStore(
    (s) => s.setConversationFontSize,
  );
  const notifyOnGoalEnd = usePrefsStore((s) => s.notifyOnGoalEnd);
  const setNotifyOnGoalEnd = usePrefsStore((s) => s.setNotifyOnGoalEnd);
  const notifyOnApproval = usePrefsStore((s) => s.notifyOnApproval);
  const setNotifyOnApproval = usePrefsStore((s) => s.setNotifyOnApproval);
  const notifyOnReplyDone = usePrefsStore((s) => s.notifyOnReplyDone);
  const setNotifyOnReplyDone = usePrefsStore((s) => s.setNotifyOnReplyDone);
  const keepInBackgroundOnClose = usePrefsStore(
    (s) => s.keepInBackgroundOnClose,
  );
  const setKeepInBackgroundOnClose = usePrefsStore(
    (s) => s.setKeepInBackgroundOnClose,
  );
  const autoDownloadUpdates = usePrefsStore((s) => s.autoDownloadUpdates);
  const setAutoDownloadUpdates = usePrefsStore(
    (s) => s.setAutoDownloadUpdates,
  );
  const setGAConfig = usePrefsStore((s) => s.setGAConfig);
  const setActiveRuntimeKind = usePrefsStore((s) => s.setActiveRuntimeKind);
  const gaConfig = usePrefsStore((s) => s.gaConfig);
  const activeRuntimeKind = usePrefsStore((s) => s.activeRuntimeKind);
  const managedModels = useManagedModelsStore((s) => s.models);
  const hasConfiguredManagedModel = managedModels.some(
    (model) => model.credentialStatus !== "missing",
  );
  const projects = useSessionsStore((s) => s.projects);
  const setActiveProjectFilter = useSessionsStore(
    (s) => s.setActiveProjectFilter,
  );
  const setActiveSession = useSessionsStore((s) => s.setActiveSession);
  const hasRunningSessions = useMessagesStore((s) =>
    Object.values(s.byId).some((messages) => messages.agentRunning),
  );
  const setScreen = useUiStore((s) => s.setScreen);
  const pushToast = useUiStore((s) => s.pushToast);

  return (
    <Settings
      open={open}
      onOpenChange={onOpenChange}
      tab={tab}
      onTabChange={onTabChange}
      runtimeInfo={runtimeInfo}
      approval={approvalConfig}
      projectCount={projects.length}
      hasRunningSessions={hasRunningSessions}
      activeRuntimeKind={activeRuntimeKind}
      hasManagedRuntimeConfigured={hasConfiguredManagedModel}
      hasExternalRuntimeConfigured={gaConfig.gaPath.trim() !== ""}
      yoloMode={yoloMode}
      useExternalPython={gaConfig.useExternalPython}
      onChangeYoloMode={(enabled) => {
        // Fire-and-forget: setYoloMode persists + notifies bridge,
        // but the UI updates synchronously from the store action.
        void setYoloMode(enabled);
      }}
      onChangeRequiredTools={setApprovalRequiredTools}
      onRemoveAlwaysAllow={removeAlwaysAllow}
      onChangeGAPath={() => {
        void pickGAPath(setGAConfig, copy.app.chooseGAFolderTitle);
      }}
      onCommitGAPath={async (path) => {
        // Manual-typed GA path from Settings → Runtime. The
        // SettingsRuntime field has already validated and refuses to
        // call this on `not-found`; we trust it here. setGAConfig
        // shows the same "重启 Galley 才能生效" toast as the picker
        // flow, keeping both entry points symmetric.
        await setGAConfig({ gaPath: path });
      }}
      onToggleExternalPython={(useExternal) => {
        // v0.1.1: persist the bundled-vs-external choice. Like
        // gaPath, takes effect on next bridge spawn (existing live
        // sessions keep their current Python). setGAConfig shows
        // the same "重启 Galley" toast.
        void setGAConfig({ useExternalPython: useExternal });
      }}
      onChangeRuntimeKind={(kind) => {
        if (kind === activeRuntimeKind) return;
        void (async () => {
          await setActiveRuntimeKind(kind);
          useRuntimeStore.setState({ pendingLLMIndex: undefined });
          setActiveProjectFilter(undefined);
          setActiveSession(undefined);
          setScreen("empty");
          await useSessionsStore.getState().hydrate();
          pushToast(
            makeAppError({
              category: "business",
              severity: "info",
              title: copy.toasts.switchedRuntime(kind),
              message: copy.toasts.runtimeSwitchKept,
              hint: null,
              retryable: false,
              context: null,
              traceback: null,
              autoDismissMs: 4200,
            }),
          );
        })();
      }}
      // Bridge Python picker intentionally not wired — V0.1 relies
      // on the python probe to pick the interpreter; advanced users
      // edit prefs / capabilities by hand. Settings just shows the
      // resolved path.
      //
      // "跑一次 Health Check" routes back through Onboarding's
      // StepHealth in revisit mode (skips Welcome / Attach). One
      // canonical health-check UX instead of a divergent inline
      // copy in Settings — see Settings-Health-Check devlog
      // 2026-05-15.
      onReRunHealthCheck={onReRunHealthCheck}
      onOpenSetupAssistant={onOpenSetupAssistant}
      onRunBrowserControlDemo={onRunBrowserControlDemo}
      languagePreference={languagePreference}
      resolvedLanguage={resolvedLanguage}
      onChangeLanguagePreference={(preference) => {
        void setLanguagePreference(preference);
      }}
      themePreference={themePreference}
      resolvedTheme={resolvedTheme}
      onChangeThemePreference={(preference) => {
        void setThemePreference(preference);
      }}
      conversationFontSize={conversationFontSize}
      onChangeConversationFontSize={(size) => {
        void setConversationFontSize(size);
      }}
      notifyOnGoalEnd={notifyOnGoalEnd}
      onChangeNotifyOnGoalEnd={(enabled) => {
        void setNotifyOnGoalEnd(enabled);
      }}
      notifyOnApproval={notifyOnApproval}
      onChangeNotifyOnApproval={(enabled) => {
        void setNotifyOnApproval(enabled);
      }}
      notifyOnReplyDone={notifyOnReplyDone}
      onChangeNotifyOnReplyDone={(enabled) => {
        void setNotifyOnReplyDone(enabled);
      }}
      keepInBackgroundOnClose={keepInBackgroundOnClose}
      onChangeKeepInBackgroundOnClose={(enabled) => {
        void setKeepInBackgroundOnClose(enabled);
      }}
      autoDownloadUpdates={autoDownloadUpdates}
      onChangeAutoDownloadUpdates={(enabled) => {
        void setAutoDownloadUpdates(enabled);
      }}
    />
  );
}

// ---------------- Settings path pickers ----------------
//
// Lazy-import the Tauri dialog plugin so a Vite-only dev build doesn't
// fail to load this module. In Tauri the dialog returns a string
// (single selection), null on cancel, or string[] when multiple=true.

async function pickGAPath(
  setGAConfig: (
    p: Partial<{ python: string; gaPath: string; bridgeCwd: string }>,
  ) => Promise<void>,
  title: string,
): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title,
    });
    if (typeof selected === "string" && selected.length > 0) {
      await setGAConfig({ gaPath: selected });
    }
  } catch (e) {
    console.warn("[settings] pickGAPath failed.", e);
  }
}
