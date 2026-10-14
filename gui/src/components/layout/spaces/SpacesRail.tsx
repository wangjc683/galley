import { Gear, SquaresFour } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent, ReactNode } from "react";

import { ShortcutTooltipText } from "@/components/layout/sidebar/SidebarNavIcons";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { isMac, isWindowActionTarget } from "@/lib/platform";
import { formatShortcut, formatShortcutReadable } from "@/lib/shortcuts";
import { showsBadge, type Space, type SpaceBadges } from "@/lib/spaces-trial";
import { cn } from "@/lib/utils";

import { AssistantAvatar } from "./AssistantIdentity";
import { AssistantBadge, WorkbenchBadge } from "./SpaceBadges";

/**
 * TEMPORARY (ticket 16) — the 甲 trial's icon rail: the window's
 * leftmost column in both spaces, as in Feishu or WeCom. 80px wide,
 * enough to carry the macOS traffic lights on top: they sit at
 * {16, 22} with the cluster's right edge at ~68px, so the rail leaves
 * them 12px to its border (centred within 2px), and fits the widest
 * label (「Workbench」, Inter 500 11px, 60.9px measured from the font
 * file) in its 68px tile. Off macOS the top 44px is the same empty
 * band, a window drag handle like the headers (double-click maximizes),
 * so the items sit at the same height everywhere and start under the
 * header strip.
 *
 * Two items, an icon over a small label: the assistant (its avatar) and
 * the workbench (the four-squares glyph Feishu and WeCom use for 工作台).
 * The space you are in takes the sidebar's "you are here" — selected
 * fill, lift, full ink (never weight); chrome's values, the rail
 * standing on chrome like the sidebar beside it. Badges on the other
 * item's corner. At the foot the settings gear, moved here from the
 * header's utility cluster.
 */
export function SpacesRail({
  space,
  badges,
  assistantWords,
  workbenchWords,
  onSwitch,
  onOpenSettings,
}: {
  space: Space;
  badges: SpaceBadges;
  assistantWords?: string;
  workbenchWords?: string;
  onSwitch: (space: Space) => void;
  onOpenSettings: () => void;
}) {
  const copy = useCopy();
  const showAssistant =
    showsBadge("assistant", space) && badges.assistant !== null;
  const showWorkbench =
    showsBadge("workbench", space) && badges.workbench !== null;
  // Windows / Linux custom chrome: double-clicking the drag band
  // maximizes, as on the headers; macOS hands it to the OS.
  const onDoubleClick = (e: MouseEvent) => {
    if (isMac) return;
    if (!isWindowActionTarget(e.target)) return;
    try {
      void getCurrentWindow().toggleMaximize();
    } catch {
      // No Tauri host (plain Vite browser dev) — ignore.
    }
  };
  return (
    <nav
      aria-label={copy.spaces.switchLabel}
      data-role="spaces-rail"
      data-tauri-drag-region
      onDoubleClick={onDoubleClick}
      className="chrome-hover-scope flex h-full w-20 shrink-0 flex-col items-center border-r border-line/70 bg-chrome pb-3"
    >
      {/* The traffic lights' band (macOS), a drag handle everywhere. */}
      <div data-tauri-drag-region className="h-11 w-full shrink-0" />
      <div className="flex flex-col items-center gap-1 pt-2">
        <RailItem
          label={copy.spaces.assistant}
          words={showAssistant ? assistantWords : undefined}
          shortcut={formatShortcut("Mod+1")}
          active={space === "assistant"}
          onClick={() => onSwitch("assistant")}
          icon={<AssistantAvatar />}
          badge={
            <AssistantBadge
              kind={badges.assistant}
              visible={showsBadge("assistant", space)}
              ground="chrome"
            />
          }
        />
        <RailItem
          label={copy.spaces.workbench}
          words={showWorkbench ? workbenchWords : undefined}
          shortcut={formatShortcut("Mod+2")}
          active={space === "workbench"}
          onClick={() => onSwitch("workbench")}
          icon={
            <span className="inline-flex size-7 items-center justify-center">
              <SquaresFour size={22} weight="light" />
            </span>
          }
          badge={
            <WorkbenchBadge
              badge={badges.workbench}
              visible={showsBadge("workbench", space)}
              ground="chrome"
            />
          }
        />
      </div>
      <div data-tauri-drag-region className="w-full flex-1" />
      <TooltipLabel
        text={copy.topbar.settingsShortcut(formatShortcutReadable("Mod+,"))}
        side="right"
      >
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={copy.topbar.openSettings}
          className={cn(
            "inline-flex size-9 items-center justify-center rounded-sm text-ink-muted",
            "transition-none active:translate-y-px active:transition-[transform] active:duration-(--motion-press) active:ease-firm",
            "hover:bg-hover hover:text-ink",
            "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          )}
        >
          <Gear size={20} weight="light" />
        </button>
      </TooltipLabel>
    </nav>
  );
}

function RailItem({
  label,
  words,
  shortcut,
  active,
  onClick,
  icon,
  badge,
}: {
  label: string;
  words?: string;
  shortcut: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  badge: ReactNode;
}) {
  const fullLabel = words ? `${label} · ${words}` : label;
  return (
    <TooltipLabel
      text={<ShortcutTooltipText label={fullLabel} shortcut={shortcut} />}
      side="right"
    >
      <button
        type="button"
        aria-label={fullLabel}
        aria-current={active ? "page" : undefined}
        data-space-item=""
        onClick={() => {
          if (!active) onClick();
        }}
        className={cn(
          "flex w-[68px] flex-col items-center gap-1 rounded-sm pb-1.5 pt-2",
          "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          active
            ? "bg-selected text-ink shadow-[var(--shadow-selected)]"
            : cn(
                "text-ink-muted hover:bg-hover hover:text-ink",
                "transition-none active:translate-y-px active:transition-[transform] active:duration-(--motion-press) active:ease-firm",
              ),
        )}
      >
        <span className="relative inline-flex">
          {icon}
          <span className="pointer-events-none absolute -right-1.5 -top-1 flex">
            {badge}
          </span>
        </span>
        <span className="text-[11px] leading-[14px]">{label}</span>
      </button>
    </TooltipLabel>
  );
}
