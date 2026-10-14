import type { ReactNode } from "react";

import { ShortcutTooltipText } from "@/components/layout/sidebar/SidebarNavIcons";
import { IconTooltip } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { isMac } from "@/lib/platform";
import { formatShortcut } from "@/lib/shortcuts";
import { showsBadge, type Space, type SpaceBadges } from "@/lib/spaces-trial";
import { cn } from "@/lib/utils";

import {
  AssistantBadge,
  type BadgeGround,
  WorkbenchBadge,
} from "./SpaceBadges";

/**
 * TEMPORARY (ticket 16) — the 乙 trial's two-segment switch
 * 「助手｜工作台」, right of the traffic lights in both spaces: in the
 * workbench it stands in the sidebar masthead's wordmark place, in the
 * assistant at the head of the full-width header, at the same x and y
 * (88px on macOS, the 16px gutter elsewhere; both headers are 44px).
 *
 * The shared SegmentedControl's geometry (28px, a 2px-padded bordered
 * track), not its selected style: its white thumb and brand-strong text
 * are the preference pickers' "which option is set", and the header's
 * colour rule keeps brand for invitations (layout-and-chrome.md §4.1).
 * A space is where you are, so the selected segment takes the sidebar's
 * "you are here": the selected fill, its lift and full ink against the
 * other's muted ink, never weight (weight is running's and unread's) —
 * chrome's fill in the masthead and app's in the header, each
 * calibrated for its ground, as the selected row's is. Its labels also
 * need room for a badge, which SegmentedControl's string labels don't
 * give.
 *
 * Badges sit on the outer corner of the space you are not in. ⌘1 / ⌘2
 * in the tooltips (the handler is App's).
 */
export function SpaceSwitch({
  placement,
  space,
  badges,
  assistantWords,
  workbenchWords,
  onSwitch,
}: {
  /** The workbench's sidebar masthead, whose padding places it, or the
   * assistant's header, which starts 10px in (MainHeader's `leading`
   * slot): from there 78px more on macOS, 6px elsewhere. */
  placement: "masthead" | "header";
  space: Space;
  badges: SpaceBadges;
  /** The assistant badge's words, for its tooltip and accessible name. */
  assistantWords?: string;
  /** The workbench badge's words. */
  workbenchWords?: string;
  onSwitch: (space: Space) => void;
}) {
  const copy = useCopy();
  // The masthead is chrome, the header app.
  const ground: BadgeGround = placement === "masthead" ? "chrome" : "app";
  const showAssistant =
    showsBadge("assistant", space) && badges.assistant !== null;
  const showWorkbench =
    showsBadge("workbench", space) && badges.workbench !== null;
  return (
    <div
      role="group"
      aria-label={copy.spaces.switchLabel}
      data-role="space-switch"
      className={cn(
        "inline-flex h-7 shrink-0 items-stretch gap-0.5 rounded-sm border border-line p-0.5",
        placement === "header" &&
          (isMac ? "ml-[78px] mr-2.5" : "ml-1.5 mr-2.5"),
      )}
    >
      <Segment
        label={copy.spaces.assistant}
        words={showAssistant ? assistantWords : undefined}
        shortcut={formatShortcut("Mod+1")}
        active={space === "assistant"}
        onClick={() => onSwitch("assistant")}
        badgeCorner="left"
        badge={
          <AssistantBadge
            kind={badges.assistant}
            visible={showsBadge("assistant", space)}
            ground={ground}
          />
        }
      />
      <Segment
        label={copy.spaces.workbench}
        words={showWorkbench ? workbenchWords : undefined}
        shortcut={formatShortcut("Mod+2")}
        active={space === "workbench"}
        onClick={() => onSwitch("workbench")}
        badgeCorner="right"
        badge={
          <WorkbenchBadge
            badge={badges.workbench}
            visible={showsBadge("workbench", space)}
            ground={ground}
          />
        }
      />
    </div>
  );
}

function Segment({
  label,
  words,
  shortcut,
  active,
  onClick,
  badge,
  badgeCorner,
}: {
  label: string;
  words?: string;
  shortcut: string;
  active: boolean;
  onClick: () => void;
  badge: ReactNode;
  /** Each badge hangs on the switch's outer corner at its own end: the
   * left segment's top-right corner is the middle of the switch, where
   * a badge reads as the right segment's. */
  badgeCorner: "left" | "right";
}) {
  const fullLabel = words ? `${label} · ${words}` : label;
  return (
    <IconTooltip
      text={<ShortcutTooltipText label={fullLabel} shortcut={shortcut} />}
      side="bottom"
    >
      <button
        type="button"
        aria-label={fullLabel}
        aria-current={active ? "page" : undefined}
        data-space-segment=""
        onClick={() => {
          if (!active) onClick();
        }}
        className={cn(
          "relative inline-flex select-none items-center rounded-[4px] px-2 text-[12px] leading-none",
          "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30",
          active
            ? "bg-selected text-ink shadow-[var(--shadow-selected)]"
            : cn(
                "text-ink-muted hover:bg-hover hover:text-ink",
                "transition-none active:translate-y-px active:transition-[transform] active:duration-(--motion-press) active:ease-firm",
              ),
        )}
      >
        {label}
        {/* The corner, half off the segment, over the track's border. */}
        <span
          className={cn(
            "pointer-events-none absolute -top-1.5 flex",
            badgeCorner === "left" ? "-left-1.5" : "-right-1.5",
          )}
        >
          {badge}
        </span>
      </button>
    </IconTooltip>
  );
}
