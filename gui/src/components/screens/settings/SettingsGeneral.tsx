import { useCallback, useEffect, useState, type ReactNode } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

import {
  SettingsPanelHeader,
  SettingsSectionLabel,
} from "@/components/screens/settings/settings-ui";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import type { ConversationFontSize } from "@/lib/conversation-font-size";
import { useCopy } from "@/lib/i18n";
import {
  ensureNotificationPermission,
  queryNotificationPermission,
} from "@/lib/notify";
import type { LanguagePreference, ResolvedLanguage } from "@/lib/language";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme";

import { ErrorLine } from "./models/ModelPrimitives";

/**
 * General — desktop-app preferences: appearance, language, launch at
 * login. Engine configuration stays in Runtime; this tab is for how
 * the app itself behaves on this machine.
 *
 * One row grammar for every preference: title + one-line description
 * on the left, the control on the right. Theme and language use the
 * shared SegmentedControl (same interaction as the topbar theme
 * control) so all three choices are visible and switching is one
 * click — no popover state. When "follow system" is selected the
 * description line carries the currently resolved value.
 *
 * Launch at login: the OS is the single source of truth. The toggle
 * reads `isEnabled()` from the autostart plugin on mount and after
 * every change — nothing is mirrored into Galley prefs, so removing
 * the login item from system settings shows up here as "off" without
 * drift. Default is off (the plugin writes nothing until enabled).
 *
 * Notifications / app behavior: pref-driven (SQLite is the source of
 * truth), unlike launch-at-login. OS notification *permission* is a
 * second, independent layer: flipping a notification toggle ON asks
 * for permission, but a denial never flips the toggle back — the pref
 * records intent, and granting permission later in system settings
 * makes it effective without revisiting this tab. The hint line below
 * the section surfaces that mismatch.
 */
export function SettingsGeneral({
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
  notifySound,
  onChangeNotifySound,
  keepInBackgroundOnClose,
  onChangeKeepInBackgroundOnClose,
  autoDownloadUpdates,
  onChangeAutoDownloadUpdates,
}: {
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
  notifySound: boolean;
  onChangeNotifySound: (enabled: boolean) => void;
  keepInBackgroundOnClose: boolean;
  onChangeKeepInBackgroundOnClose: (enabled: boolean) => void;
  autoDownloadUpdates: boolean;
  onChangeAutoDownloadUpdates: (enabled: boolean) => void;
}) {
  const copy = useCopy();
  const generalCopy = copy.settings.general;
  // null = unknown: still loading, or the plugin is unreachable
  // (Vite-only browser). The toggle stays disabled in that state.
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(
    null,
  );
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);

  const refreshAutostart = useCallback(async () => {
    try {
      setAutostartEnabled(await isEnabled());
    } catch (e) {
      console.warn("[settings] autostart isEnabled failed.", e);
      setAutostartEnabled(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    isEnabled()
      .then((enabled) => {
        if (!cancelled) setAutostartEnabled(enabled);
      })
      .catch((e: unknown) => {
        console.warn("[settings] autostart isEnabled failed.", e);
        if (!cancelled) setAutostartEnabled(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleAutostart = async (next: boolean) => {
    if (autostartBusy) return;
    setAutostartBusy(true);
    setAutostartError(null);
    try {
      if (next) {
        await enable();
      } else {
        await disable();
      }
      setAutostartEnabled(await isEnabled());
    } catch (e) {
      setAutostartError(
        generalCopy.launchAtLoginError(
          e instanceof Error ? e.message : String(e),
        ),
      );
      await refreshAutostart();
    } finally {
      setAutostartBusy(false);
    }
  };

  // OS notification permission is missing while at least one
  // notification pref is on. Pre-filled on mount with a query-only
  // check (never prompts); refreshed after each toggle-ON, which does
  // prompt when the OS has never asked.
  const [notifyPermissionMissing, setNotifyPermissionMissing] =
    useState(false);
  const anyNotifyEnabled =
    notifyOnGoalEnd || notifyOnApproval || notifyOnReplyDone;
  useEffect(() => {
    // No sync state reset here: the hint's render condition already
    // carries `anyNotifyEnabled`, so a stale `true` stays invisible
    // while all toggles are off (and toggling back on re-queries).
    if (!anyNotifyEnabled) return;
    let cancelled = false;
    void queryNotificationPermission().then((granted) => {
      if (!cancelled) setNotifyPermissionMissing(!granted);
    });
    return () => {
      cancelled = true;
    };
  }, [anyNotifyEnabled]);

  const handleToggleNotify = (
    onChange: (enabled: boolean) => void,
    next: boolean,
  ) => {
    onChange(next);
    if (next) {
      // Ask for permission on intent. A denial keeps the pref as set —
      // see the component docstring for the two-layer rationale.
      void ensureNotificationPermission().then((granted) =>
        setNotifyPermissionMissing(!granted),
      );
    }
  };

  const resolvedThemeHint =
    resolvedTheme === "dark" ? copy.theme.currentDark : copy.theme.currentLight;
  const resolvedLanguageLabel =
    resolvedLanguage === "zh-CN" ? copy.language.zh : copy.language.en;

  return (
    <div className="space-y-6">
      <SettingsPanelHeader
        title={copy.settings.tabs.general.label}
        subtitle={generalCopy.subtitle}
      />

      <div>
        <SettingsSectionLabel>
          {generalCopy.appearanceSectionTitle}
        </SettingsSectionLabel>
        <div className="mt-2 divide-y divide-line rounded-sm border border-line bg-surface">
          <PreferenceRow
            title={generalCopy.themeRowTitle}
            description={
              themePreference === "system"
                ? generalCopy.systemPreferenceHint(resolvedThemeHint)
                : generalCopy.themeRowDescription
            }
          >
            <SegmentedControl<ThemePreference>
              value={themePreference}
              ariaLabel={copy.theme.aria}
              onValueChange={onChangeThemePreference}
              options={[
                { value: "system", label: copy.theme.system },
                { value: "light", label: copy.theme.light },
                { value: "dark", label: copy.theme.dark },
              ]}
            />
          </PreferenceRow>
          <PreferenceRow
            title={generalCopy.fontSizeRowTitle}
            description={generalCopy.fontSizeRowDescription}
          >
            <SegmentedControl<ConversationFontSize>
              value={conversationFontSize}
              ariaLabel={copy.topbar.conversationFontSize.aria}
              onValueChange={onChangeConversationFontSize}
              options={[
                {
                  value: "small",
                  label: copy.topbar.conversationFontSize.smallShort,
                },
                {
                  value: "standard",
                  label: copy.topbar.conversationFontSize.standardShort,
                },
                {
                  value: "large",
                  label: copy.topbar.conversationFontSize.largeShort,
                },
              ]}
            />
          </PreferenceRow>
          <PreferenceRow
            title={generalCopy.languageRowTitle}
            description={
              languagePreference === "system"
                ? generalCopy.systemPreferenceHint(
                    copy.language.current(resolvedLanguageLabel),
                  )
                : generalCopy.languageRowDescription
            }
          >
            <SegmentedControl<LanguagePreference>
              value={languagePreference}
              ariaLabel={copy.language.aria}
              onValueChange={onChangeLanguagePreference}
              options={[
                { value: "system", label: copy.language.system },
                { value: "zh-CN", label: copy.language.zh },
                { value: "en-US", label: copy.language.en },
              ]}
            />
          </PreferenceRow>
        </div>
      </div>

      <div>
        <SettingsSectionLabel>
          {generalCopy.launchSectionTitle}
        </SettingsSectionLabel>
        <div className="mt-2 rounded-sm border border-line bg-surface">
          <PreferenceRow
            title={generalCopy.launchAtLogin}
            description={generalCopy.launchAtLoginDescription}
          >
            <Switch
              checked={autostartEnabled === true}
              disabled={autostartEnabled === null || autostartBusy}
              onCheckedChange={(next) => void handleToggleAutostart(next)}
              ariaLabel={generalCopy.launchAtLogin}
            />
          </PreferenceRow>
          {autostartError && (
            <div className="px-3 pb-2.5">
              <ErrorLine message={autostartError} />
            </div>
          )}
        </div>
      </div>

      <div>
        <SettingsSectionLabel>
          {generalCopy.notificationsSectionTitle}
        </SettingsSectionLabel>
        <div className="mt-2 divide-y divide-line rounded-sm border border-line bg-surface">
          <PreferenceRow
            title={generalCopy.notifyReplyDoneTitle}
            description={generalCopy.notifyReplyDoneDescription}
          >
            <Switch
              checked={notifyOnReplyDone}
              onCheckedChange={(next) =>
                handleToggleNotify(onChangeNotifyOnReplyDone, next)
              }
              ariaLabel={generalCopy.notifyReplyDoneTitle}
            />
          </PreferenceRow>
          <PreferenceRow
            title={generalCopy.notifyGoalEndTitle}
            description={generalCopy.notifyGoalEndDescription}
          >
            <Switch
              checked={notifyOnGoalEnd}
              onCheckedChange={(next) =>
                handleToggleNotify(onChangeNotifyOnGoalEnd, next)
              }
              ariaLabel={generalCopy.notifyGoalEndTitle}
            />
          </PreferenceRow>
          <PreferenceRow
            title={generalCopy.notifyApprovalTitle}
            description={generalCopy.notifyApprovalDescription}
          >
            <Switch
              checked={notifyOnApproval}
              onCheckedChange={(next) =>
                handleToggleNotify(onChangeNotifyOnApproval, next)
              }
              ariaLabel={generalCopy.notifyApprovalTitle}
            />
          </PreferenceRow>
          {/* Sound is a modifier on the kinds above, not a fourth
              kind — plain onChange, no permission round-trip. */}
          <PreferenceRow
            title={generalCopy.notifySoundTitle}
            description={generalCopy.notifySoundDescription}
          >
            <Switch
              checked={notifySound}
              disabled={!anyNotifyEnabled}
              onCheckedChange={onChangeNotifySound}
              ariaLabel={generalCopy.notifySoundTitle}
            />
          </PreferenceRow>
          {anyNotifyEnabled && notifyPermissionMissing && (
            <div className="px-3 py-2.5">
              <ErrorLine message={generalCopy.notificationsPermissionHint} />
            </div>
          )}
        </div>
      </div>

      <div>
        <SettingsSectionLabel>
          {generalCopy.behaviorSectionTitle}
        </SettingsSectionLabel>
        <div className="mt-2 divide-y divide-line rounded-sm border border-line bg-surface">
          <PreferenceRow
            title={generalCopy.keepInBackgroundTitle}
            description={generalCopy.keepInBackgroundDescription}
          >
            <Switch
              checked={keepInBackgroundOnClose}
              onCheckedChange={onChangeKeepInBackgroundOnClose}
              ariaLabel={generalCopy.keepInBackgroundTitle}
            />
          </PreferenceRow>
          <PreferenceRow
            title={generalCopy.autoDownloadUpdatesTitle}
            description={generalCopy.autoDownloadUpdatesDescription}
          >
            <Switch
              checked={autoDownloadUpdates}
              onCheckedChange={onChangeAutoDownloadUpdates}
              ariaLabel={generalCopy.autoDownloadUpdatesTitle}
            />
          </PreferenceRow>
        </div>
      </div>
    </div>
  );
}

/** Shared row grammar for this tab: title + one-line description on
 * the left, the control on the right. */
function PreferenceRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-ui-compact font-medium text-ink">{title}</div>
        <div className="mt-0.5 max-w-[460px] text-ui-meta leading-snug text-ink-muted">
          {description}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
