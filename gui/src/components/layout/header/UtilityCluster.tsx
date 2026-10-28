import { Gear, PlugsConnected } from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { formatShortcutReadable } from "@/lib/shortcuts";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme";
import type { ConversationFontSize } from "@/lib/conversation-font-size";

import { TopBarIconButton } from "../TopBarIconButton";
import { ChangesToggleButton } from "./ChangesToggleButton";
import { DisplayMenu } from "./DisplayMenu";

/**
 * Last of the MainHeader right group: global tools — Changes (only
 * while a repository is known or the review is open; the host
 * omits `onToggleChanges` otherwise), 显示 (width / font size / theme),
 * Supervisor SOP (the external runtime only: the host omits
 * `onOpenSupervisorSop` on the managed one, where the assistant is the
 * supervisor; main chat ruling 106, ticket 54), and Settings. 显示 and
 * Settings never gate on state, so the cluster and its ARIA landmark
 * render unconditionally. 待办 was its first from main chat ticket 45 to
 * ticket 104, which gave it a group of its own in front (MainHeader).
 */
export function TopBarUtilityCluster({
  changesOpen = false,
  onToggleChanges,
  conversationWidth,
  onChangeConversationWidth,
  conversationFontSize,
  onChangeConversationFontSize,
  themePreference,
  resolvedTheme,
  onChangeThemePreference,
  onOpenSupervisorSop,
  onOpenSettings,
}: {
  changesOpen?: boolean;
  onToggleChanges?: (source: HTMLElement) => void;
  conversationWidth: "compact" | "wide";
  onChangeConversationWidth?: (width: "compact" | "wide") => void;
  conversationFontSize: ConversationFontSize;
  onChangeConversationFontSize?: (size: ConversationFontSize) => void;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  onChangeThemePreference?: (preference: ThemePreference) => void;
  /** Opens Settings → Agent, where the Supervisor SOP is copied.
   * Omitted (no button) on the managed runtime (ruling 106). */
  onOpenSupervisorSop?: () => void;
  onOpenSettings?: () => void;
}) {
  const copy = useCopy().topbar;

  return (
    <div
      role="group"
      aria-label={copy.utilityGroupLabel}
      className="flex items-center gap-1"
    >
      {/* No Search button here — the Sidebar has its own search
          icon, and ⌘K opens the palette from anywhere. Two click
          affordances for the same thing was chrome clutter without
          payoff. */}
      {onToggleChanges && (
        <ChangesToggleButton open={changesOpen} onToggle={onToggleChanges} />
      )}
      <DisplayMenu
        conversationWidth={conversationWidth}
        onChangeConversationWidth={onChangeConversationWidth}
        conversationFontSize={conversationFontSize}
        onChangeConversationFontSize={onChangeConversationFontSize}
        themePreference={themePreference}
        resolvedTheme={resolvedTheme}
        onChangeThemePreference={onChangeThemePreference}
      />
      {onOpenSupervisorSop && (
        <TooltipLabel text={copy.supervisorSopTooltip}>
          <TopBarIconButton
            onClick={onOpenSupervisorSop}
            aria-label={copy.openSupervisorSop}
          >
            <PlugsConnected size={16} weight="thin" />
          </TopBarIconButton>
        </TooltipLabel>
      )}
      <TooltipLabel
        text={copy.settingsShortcut(formatShortcutReadable("Mod+,"))}
      >
        <TopBarIconButton
          onClick={onOpenSettings}
          aria-label={copy.openSettings}
        >
          <Gear size={16} weight="thin" />
        </TopBarIconButton>
      </TooltipLabel>
    </div>
  );
}
