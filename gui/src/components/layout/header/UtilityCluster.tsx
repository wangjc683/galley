import { Gear } from "@phosphor-icons/react";

import { ThemePreferenceMenu } from "@/components/theme/ThemePreferenceMenu";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { formatShortcutReadable } from "@/lib/shortcuts";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme";
import type { ConversationFontSize } from "@/lib/conversation-font-size";

import { TopBarIconButton } from "../TopBarIconButton";
import { ConversationFontSizeMenu } from "./ConversationFontSizeMenu";
import { WidthToggleButton } from "./WidthToggleButton";

/**
 * Right half of the MainHeader right group: global view tools that
 * always apply, regardless of session state — width toggle, font size,
 * theme, and Settings. Unlike the status cluster these never gate on
 * state, so the cluster and its ARIA landmark render unconditionally.
 */
export function TopBarUtilityCluster({
  conversationWidth,
  onToggleConversationWidth,
  conversationFontSize,
  onChangeConversationFontSize,
  themePreference,
  resolvedTheme,
  onChangeThemePreference,
  onOpenSettings,
}: {
  conversationWidth: "compact" | "wide";
  onToggleConversationWidth?: () => void;
  conversationFontSize: ConversationFontSize;
  onChangeConversationFontSize?: (size: ConversationFontSize) => void;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  onChangeThemePreference?: (preference: ThemePreference) => void;
  onOpenSettings?: () => void;
}) {
  const copy = useCopy().topbar;

  return (
    <div
      role="group"
      aria-label={copy.utilityGroupLabel}
      className="flex items-center gap-1"
    >
      {/* No Search button here — the Sidebar's Quick Actions has
          its own search affordance, and ⌘K opens the palette from
          anywhere. Two click affordances for the same thing was
          chrome clutter without payoff. */}
      <WidthToggleButton
        mode={conversationWidth}
        onToggle={onToggleConversationWidth}
      />
      <ConversationFontSizeMenu
        value={conversationFontSize}
        onChange={onChangeConversationFontSize}
      />
      {onChangeThemePreference && (
        <ThemePreferenceMenu
          preference={themePreference}
          resolvedTheme={resolvedTheme}
          onChange={onChangeThemePreference}
          variant="topbar"
        />
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
