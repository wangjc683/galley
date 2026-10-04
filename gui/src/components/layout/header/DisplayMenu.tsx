import * as Popover from "@radix-ui/react-popover";
import { TextAa } from "@phosphor-icons/react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { TooltipLabel } from "@/components/ui/tooltip";
import type { ConversationFontSize } from "@/lib/conversation-font-size";
import { useCopy } from "@/lib/i18n";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme";

import { TopBarIconButton } from "../TopBarIconButton";

/**
 * 显示 — reading width, conversation font size and theme behind one
 * topbar button (2026-10-04; they were three buttons until then, see
 * devlog 2026-10-04-topbar-display-popover).
 *
 * Trigger: fixed TextAa icon, no state on the button face. A settled
 * preference is not actionable information, so no "non-default" tint;
 * the current values live inside the popover.
 *
 * Panel: a Popover (not DropdownMenu) on purpose — it stays open after
 * a pick so the user can flip options and watch the conversation
 * re-render live behind it, then dismiss. Each row is a short muted
 * label plus the shared SegmentedControl, the same three-way choice
 * grammar as everywhere else in the app. Labels sit in their own grid
 * column so the three controls start on one vertical line.
 */
export function DisplayMenu({
  conversationWidth,
  onChangeConversationWidth,
  conversationFontSize,
  onChangeConversationFontSize,
  themePreference,
  resolvedTheme,
  onChangeThemePreference,
}: {
  conversationWidth: "compact" | "wide";
  onChangeConversationWidth?: (width: "compact" | "wide") => void;
  conversationFontSize: ConversationFontSize;
  onChangeConversationFontSize?: (size: ConversationFontSize) => void;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  onChangeThemePreference?: (preference: ThemePreference) => void;
}) {
  const copy = useCopy();
  const labels = copy.topbar.display;
  const width = copy.topbar.conversationWidth;
  const fontSize = copy.topbar.conversationFontSize;
  const labelClass = "pl-1 text-ui-tertiary text-ink-muted";

  return (
    <Popover.Root>
      <TooltipLabel text={labels.tooltip}>
        <Popover.Trigger asChild>
          <TopBarIconButton aria-label={labels.aria}>
            <TextAa size={16} weight="thin" />
          </TopBarIconButton>
        </Popover.Trigger>
      </TooltipLabel>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={6}
          onOpenAutoFocus={(event) => {
            // Radix autofocuses the first segment on open, painting a
            // focus ring on 紧凑 even when another option is selected —
            // a false highlight that fights the real selection (the
            // raised thumb) and clips against the tight track. Pointer
            // opens need no ring; the thumbs already show the current
            // values. Keyboard users can still Tab / arrow into them.
            event.preventDefault();
          }}
          className="galley-pop-in z-[70] rounded-md border border-line bg-elevated p-1.5 shadow-elevated"
        >
          <div className="grid grid-cols-[auto_auto] items-center justify-items-start gap-x-3 gap-y-1.5">
            <span className={labelClass}>{labels.width}</span>
            <SegmentedControl<"compact" | "wide">
              value={conversationWidth}
              ariaLabel={width.aria}
              onValueChange={(next) => onChangeConversationWidth?.(next)}
              options={[
                { value: "compact", label: width.compact },
                { value: "wide", label: width.wide },
              ]}
            />
            <span className={labelClass}>{labels.fontSize}</span>
            <SegmentedControl<ConversationFontSize>
              value={conversationFontSize}
              ariaLabel={fontSize.aria}
              onValueChange={(next) => onChangeConversationFontSize?.(next)}
              options={[
                // No per-segment tooltips: the labels are self-evident.
                { value: "small", label: fontSize.smallShort },
                { value: "standard", label: fontSize.standardShort },
                { value: "large", label: fontSize.largeShort },
              ]}
            />
            <span className={labelClass}>{labels.theme}</span>
            <SegmentedControl<ThemePreference>
              value={themePreference}
              ariaLabel={copy.theme.aria}
              onValueChange={(next) => onChangeThemePreference?.(next)}
              options={[
                { value: "system", label: copy.theme.system },
                { value: "light", label: copy.theme.light },
                { value: "dark", label: copy.theme.dark },
              ]}
            />
            {/* 跟随系统 says what it follows, not what it is: the
                resolved theme ("当前浅色") rides as a caption under the
                theme segments, only while that option is selected —
                the sub-label has no room inside a segment (07-05). */}
            {themePreference === "system" && (
              <div className="col-start-2 px-1 pb-0.5 text-[11px] text-ink-muted">
                {resolvedTheme === "dark"
                  ? copy.theme.currentDark
                  : copy.theme.currentLight}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
