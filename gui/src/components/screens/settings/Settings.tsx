import * as Dialog from "@radix-ui/react-dialog";
import { X as XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { SettingsAbout } from "@/components/screens/settings/SettingsAbout";
import { SettingsApproval } from "@/components/screens/settings/SettingsApproval";
import { SettingsGeneral } from "@/components/screens/settings/SettingsGeneral";
import { SettingsBrowserControl } from "@/components/screens/settings/SettingsBrowserControl";
import { SettingsIM } from "@/components/screens/settings/SettingsIM";
import { SettingsIntegration } from "@/components/screens/settings/SettingsIntegration";
import { SettingsModels } from "@/components/screens/settings/SettingsModels";
import { SettingsRuntime } from "@/components/screens/settings/SettingsRuntime";
import { SettingsSidebar } from "@/components/screens/settings/SettingsSidebar";
import { SettingsShortcuts } from "@/components/screens/settings/SettingsShortcuts";
import { IconButton } from "@/components/ui/button";
import type { ConversationFontSize } from "@/lib/conversation-font-size";
import { useCopy } from "@/lib/i18n";
import type { LanguagePreference, ResolvedLanguage } from "@/lib/language";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { RuntimeInfo } from "@/types/inspector";
import type { RuntimeKind } from "@/types/session";
import type { ApprovalConfig, SettingsTab } from "./settings-types";

export interface SettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  runtimeInfo: RuntimeInfo;
  approval: ApprovalConfig;
  /** Total project count — drives whether the Approval tab's
   * "Per-project" section renders. */
  projectCount?: number;
  /** PRD §11.5 / DESIGN.md §9 Approval. */
  yoloMode: boolean;
  hasRunningSessions: boolean;
  activeRuntimeKind: RuntimeKind;
  hasManagedRuntimeConfigured: boolean;
  hasExternalRuntimeConfigured: boolean;

  defaultTab?: SettingsTab;
  tab?: SettingsTab;
  onTabChange?: (tab: SettingsTab) => void;

  /** v0.1.1+ Python mode (bundled vs external). Threaded into Runtime
   * tab so its Python panel can switch between the read-only bundled
   * card and the legacy picker. */
  useExternalPython: boolean;

  onChangeRequiredTools?: (tools: string[]) => void;
  onRemoveAlwaysAllow?: (scope: "project" | "global", tool: string) => void;
  onChangeYoloMode: (enabled: boolean) => void;
  onChangeGAPath?: () => void;
  onChangeBridgePython?: () => void;
  onReRunHealthCheck?: () => void;
  onOpenSetupAssistant?: () => void;
  onRunBrowserControlDemo?: () => void;
  onToggleExternalPython?: (useExternal: boolean) => void;
  onCommitGAPath?: (path: string) => Promise<void>;
  onChangeRuntimeKind?: (kind: RuntimeKind) => void;
  languagePreference: LanguagePreference;
  resolvedLanguage: ResolvedLanguage;
  onChangeLanguagePreference: (preference: LanguagePreference) => void;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  onChangeThemePreference: (preference: ThemePreference) => void;
  conversationFontSize: ConversationFontSize;
  onChangeConversationFontSize: (size: ConversationFontSize) => void;
  notifyOnGoalEnd: boolean;
  onChangeNotifyOnGoalEnd: (enabled: boolean) => void;
  notifyOnApproval: boolean;
  onChangeNotifyOnApproval: (enabled: boolean) => void;
  notifyOnReplyDone: boolean;
  onChangeNotifyOnReplyDone: (enabled: boolean) => void;
  keepInBackgroundOnClose: boolean;
  onChangeKeepInBackgroundOnClose: (enabled: boolean) => void;
  autoDownloadUpdates: boolean;
  onChangeAutoDownloadUpdates: (enabled: boolean) => void;
}

/**
 * Settings — DESIGN.md §9.
 *
 * Spec calls for a true independent macOS window (so users can keep
 * Settings open while operating the main session). Doing that needs a
 * Tauri WebviewWindow + a second React entry, which lands in #10
 * alongside IPC. For #7 we ship a modal-style overlay with the same
 * 1040x680 frame and the same tab/content split — when #10 graduates
 * to a real window the React API stays exactly the same.
 *
 * Layout:
 *   - 1040x680, centered (uses portal + backdrop scrim)
 *   - left tab list 180px
 *   - right content area 860px
 *   - close button top-right (Esc also works via Radix Dialog)
 *   - backdrop clicks do not close Settings; users often leave Galley
 *     to copy model provider keys/URLs, and accidental outside clicks
 *     must not discard in-progress settings forms.
 *
 * Changes are immediate (DESIGN.md §9 "no sticky save button"); each
 * tab fires the matching callback when the user makes an edit. The
 * parent persists.
 */
export function Settings({
  open,
  onOpenChange,
  runtimeInfo,
  approval,
  projectCount,
  yoloMode,
  hasRunningSessions,
  activeRuntimeKind,
  hasManagedRuntimeConfigured,
  hasExternalRuntimeConfigured,
  defaultTab = "runtime",
  useExternalPython,
  onChangeRequiredTools,
  onRemoveAlwaysAllow,
  onChangeYoloMode,
  onChangeGAPath,
  onChangeBridgePython,
  onReRunHealthCheck,
  onOpenSetupAssistant,
  onRunBrowserControlDemo,
  onToggleExternalPython,
  onCommitGAPath,
  onChangeRuntimeKind,
  languagePreference,
  resolvedLanguage,
  onChangeLanguagePreference,
  themePreference,
  resolvedTheme,
  onChangeThemePreference,
  conversationFontSize,
  onChangeConversationFontSize,
  notifyOnGoalEnd,
  onChangeNotifyOnGoalEnd,
  notifyOnApproval,
  onChangeNotifyOnApproval,
  notifyOnReplyDone,
  onChangeNotifyOnReplyDone,
  keepInBackgroundOnClose,
  onChangeKeepInBackgroundOnClose,
  autoDownloadUpdates,
  onChangeAutoDownloadUpdates,
  tab: controlledTab,
  onTabChange,
}: SettingsProps) {
  const copy = useCopy();
  const [uncontrolledTab, setUncontrolledTab] =
    useState<SettingsTab>(defaultTab);
  const tab = controlledTab ?? uncontrolledTab;
  const setTab = onTabChange ?? setUncontrolledTab;
  const showImTab = activeRuntimeKind === "managed";

  useEffect(() => {
    if (!showImTab && tab === "im") setTab("runtime");
  }, [setTab, showImTab, tab]);

  const showBrowserTab = activeRuntimeKind === "managed";

  useEffect(() => {
    if (!showBrowserTab && tab === "browser") setTab("runtime");
  }, [setTab, showBrowserTab, tab]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          aria-describedby={undefined}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-50 flex h-[680px] w-[1040px] -translate-x-1/2 -translate-y-1/2",
            "overflow-hidden rounded-lg border border-line bg-elevated shadow-elevated",
            "max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)]",
          )}
        >
          <Dialog.Title className="sr-only">{copy.settings.title}</Dialog.Title>

          <Dialog.Close asChild>
            <IconButton
              ariaLabel={copy.settings.close}
              tooltip={false}
              variant="secondary"
              className="absolute right-3 top-3 z-20 bg-elevated/95"
            >
              <XIcon size={14} weight="thin" />
            </IconButton>
          </Dialog.Close>

          <SettingsSidebar
            tab={tab}
            onChange={setTab}
            resolvedLanguage={resolvedLanguage}
            showImTab={showImTab}
            showBrowserTab={showBrowserTab}
          />

          <div className="scrollbar-stable min-w-0 flex-1 overflow-y-auto bg-app">
            <div className="px-8 py-7">
              {tab === "general" && (
                <SettingsGeneral
                  languagePreference={languagePreference}
                  resolvedLanguage={resolvedLanguage}
                  onChangeLanguagePreference={onChangeLanguagePreference}
                  themePreference={themePreference}
                  resolvedTheme={resolvedTheme}
                  onChangeThemePreference={onChangeThemePreference}
                  conversationFontSize={conversationFontSize}
                  onChangeConversationFontSize={onChangeConversationFontSize}
                  notifyOnGoalEnd={notifyOnGoalEnd}
                  onChangeNotifyOnGoalEnd={onChangeNotifyOnGoalEnd}
                  notifyOnApproval={notifyOnApproval}
                  onChangeNotifyOnApproval={onChangeNotifyOnApproval}
                  notifyOnReplyDone={notifyOnReplyDone}
                  onChangeNotifyOnReplyDone={onChangeNotifyOnReplyDone}
                  keepInBackgroundOnClose={keepInBackgroundOnClose}
                  onChangeKeepInBackgroundOnClose={
                    onChangeKeepInBackgroundOnClose
                  }
                  autoDownloadUpdates={autoDownloadUpdates}
                  onChangeAutoDownloadUpdates={onChangeAutoDownloadUpdates}
                />
              )}
              {tab === "runtime" && (
                <SettingsRuntime
                  info={runtimeInfo}
                  hasRunningSessions={hasRunningSessions}
                  activeRuntimeKind={activeRuntimeKind}
                  hasManagedRuntimeConfigured={hasManagedRuntimeConfigured}
                  hasExternalRuntimeConfigured={hasExternalRuntimeConfigured}
                  onChangeRuntimeKind={onChangeRuntimeKind}
                  useExternalPython={useExternalPython}
                  onChangeGAPath={onChangeGAPath}
                  onChangeBridgePython={onChangeBridgePython}
                  onReRunHealthCheck={onReRunHealthCheck}
                  onOpenSetupAssistant={onOpenSetupAssistant}
                  onToggleExternalPython={onToggleExternalPython}
                  onCommitGAPath={onCommitGAPath}
                  onOpenModels={() => setTab("models")}
                />
              )}
              {tab === "models" && (
                <SettingsModels activeRuntimeKind={activeRuntimeKind} />
              )}
              {tab === "approval" && (
                <SettingsApproval
                  config={approval}
                  yoloMode={yoloMode}
                  projectCount={projectCount}
                  onChangeYoloMode={onChangeYoloMode}
                  onChangeRequiredTools={onChangeRequiredTools}
                  onRemoveAlwaysAllow={onRemoveAlwaysAllow}
                />
              )}
              {tab === "integration" && <SettingsIntegration />}
              {showImTab && tab === "im" && (
                <SettingsIM
                  hasManagedRuntimeConfigured={hasManagedRuntimeConfigured}
                  onOpenModels={() => setTab("models")}
                />
              )}
              {showBrowserTab && tab === "browser" && (
                <SettingsBrowserControl onRunDemo={onRunBrowserControlDemo} />
              )}
              {tab === "shortcuts" && <SettingsShortcuts />}
              {tab === "about" && (
                <SettingsAbout
                  workbenchVersion={runtimeInfo.workbenchVersion}
                  gaBaseline={runtimeInfo.gaBaseline}
                  managedRuntime={runtimeInfo.managedRuntime}
                  hasRunningSessions={hasRunningSessions}
                />
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
