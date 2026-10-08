import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";

import { SettingsAbout } from "@/components/screens/settings/SettingsAbout";
import { SettingsGeneral } from "@/components/screens/settings/SettingsGeneral";
import { SettingsBrowserControl } from "@/components/screens/settings/SettingsBrowserControl";
import { SettingsIM } from "@/components/screens/settings/SettingsIM";
import { SettingsIntegration } from "@/components/screens/settings/SettingsIntegration";
import { SettingsModels } from "@/components/screens/settings/SettingsModels";
import { SettingsRuntime } from "@/components/screens/settings/SettingsRuntime";
import { SettingsFeedback } from "@/components/screens/settings/SettingsFeedback";
import { SettingsSidebar } from "@/components/screens/settings/SettingsSidebar";
import { SettingsShortcuts } from "@/components/screens/settings/SettingsShortcuts";
import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import type { ConversationFontSize } from "@/lib/conversation-font-size";
import { useCopy } from "@/lib/i18n";
import type { LanguagePreference, ResolvedLanguage } from "@/lib/language";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { RuntimeInfo } from "@/types/inspector";
import type { RuntimeKind } from "@/types/session";
import type { SettingsTab } from "./settings-types";

export interface SettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  runtimeInfo: RuntimeInfo;
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
  conversationWidth: "compact" | "wide";
  onChangeConversationWidth: (width: "compact" | "wide") => void;
  notifyOnGoalEnd: boolean;
  onChangeNotifyOnGoalEnd: (enabled: boolean) => void;
  notifyOnReplyDone: boolean;
  onChangeNotifyOnReplyDone: (enabled: boolean) => void;
  notifySound: boolean;
  onChangeNotifySound: (enabled: boolean) => void;
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
 *   - close button top-right (Esc also works via Radix Dialog; while a
 *     text field has focus the first Esc only leaves the field — see
 *     `handleEscapeKeyDown`)
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
  hasRunningSessions,
  activeRuntimeKind,
  hasManagedRuntimeConfigured,
  hasExternalRuntimeConfigured,
  defaultTab = "general",
  useExternalPython,
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
  conversationWidth,
  onChangeConversationWidth,
  notifyOnGoalEnd,
  onChangeNotifyOnGoalEnd,
  notifyOnReplyDone,
  onChangeNotifyOnReplyDone,
  notifySound,
  onChangeNotifySound,
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

  const contentRef = useRef<HTMLDivElement>(null);
  // Radix handles Esc on `document` in the capture phase, so without
  // this a field's own Esc handling (the GA path field reverts its
  // draft) never runs — the whole dialog closes first. While focus is in
  // an editable text field inside Settings, keep the dialog open and let
  // the key reach the field; if the field did not leave focus on its
  // own, blur it here. First Esc leaves the field (a number field
  // commits its draft on blur, which is fine), the second closes
  // Settings. Menus / dropdowns / nested dialogs are separate Radix
  // layers: while one is open it is the top layer and gets Esc instead
  // of this handler.
  const handleEscapeKeyDown = (event: KeyboardEvent) => {
    const field = editableTextField(contentRef.current, event.target);
    if (!field) return;
    event.preventDefault();
    // Esc during IME composition belongs to the IME (cancels it).
    if (event.isComposing) return;
    // A macrotask, not a microtask: the field's own keydown handler
    // runs later in this same dispatch.
    window.setTimeout(() => {
      if (document.activeElement === field) field.blur();
    }, 0);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          ref={contentRef}
          aria-describedby={undefined}
          onEscapeKeyDown={handleEscapeKeyDown}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            "galley-pop-in fixed left-1/2 top-1/2 z-50 flex h-[680px] w-[1040px] -translate-x-1/2 -translate-y-1/2",
            "overflow-hidden rounded-lg border border-line bg-elevated shadow-elevated",
            "max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)]",
          )}
        >
          <Dialog.Title className="sr-only">{copy.settings.title}</Dialog.Title>

          <DialogCloseButton
            variant="floating"
            className="absolute right-3 top-3 z-20"
          />

          <SettingsSidebar
            tab={tab}
            onChange={setTab}
            resolvedLanguage={resolvedLanguage}
            showImTab={showImTab}
            showBrowserTab={showBrowserTab}
          />

          {/* The pane owns X legibility, not the button's backdrop: the
              top safe zone (pt-12 vs the X ending at 40px) keeps first-row
              controls out of the corner, and the fade below dissolves
              scrolled content before it passes under the X. */}
          <div className="relative min-w-0 flex-1">
            <div className="scrollbar-stable h-full overflow-y-auto bg-app">
              <div className="px-8 pb-7 pt-12">
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
                  conversationWidth={conversationWidth}
                  onChangeConversationWidth={onChangeConversationWidth}
                  notifyOnGoalEnd={notifyOnGoalEnd}
                  onChangeNotifyOnGoalEnd={onChangeNotifyOnGoalEnd}
                  notifyOnReplyDone={notifyOnReplyDone}
                  onChangeNotifyOnReplyDone={onChangeNotifyOnReplyDone}
                  notifySound={notifySound}
                  onChangeNotifySound={onChangeNotifySound}
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
              {tab === "feedback" && (
                <SettingsFeedback
                  workbenchVersion={runtimeInfo.workbenchVersion}
                  managedRuntime={runtimeInfo.managedRuntime}
                  externalGaCommit={
                    runtimeInfo.gaCommitRuntimeKind === "external"
                      ? runtimeInfo.gaCommit
                      : undefined
                  }
                />
              )}
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
            {/* Same color as the pane, so it's invisible at rest and only
                "appears" as scrolled text fades out beneath it — no scroll
                listener needed. */}
            <div
              aria-hidden
              style={{
                background:
                  "linear-gradient(to bottom, var(--color-app), transparent)",
              }}
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-12"
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Input types that take no typing — Esc on them closes Settings. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * `target` when it is a focused, editable text field inside `container`
 * (text-like `<input>`, `<textarea>`, contenteditable); otherwise null.
 */
function editableTextField(
  container: HTMLElement | null,
  target: EventTarget | null,
): HTMLElement | null {
  if (!container || !(target instanceof HTMLElement)) return null;
  if (!container.contains(target)) return null;
  if (target instanceof HTMLInputElement) {
    return NON_TEXT_INPUT_TYPES.has(target.type) ||
      target.readOnly ||
      target.disabled
      ? null
      : target;
  }
  if (target instanceof HTMLTextAreaElement) {
    return target.readOnly || target.disabled ? null : target;
  }
  return target.isContentEditable ? target : null;
}
