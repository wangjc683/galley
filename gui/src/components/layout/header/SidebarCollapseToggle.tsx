import { SidebarSimple } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { TopBarIconButton } from "@/components/layout/TopBarIconButton";
import { ShortcutTooltipText } from "@/components/layout/sidebar/SidebarNavIcons";
import { IconTooltip } from "@/components/ui/tooltip";
import { useSessionsAttention } from "@/hooks/useSessionsAttention";
import { useCopy } from "@/lib/i18n";
import { findMainChat } from "@/lib/main-chat";
import { isMac } from "@/lib/platform";
import { formatShortcut } from "@/lib/shortcuts";
import { isUnpromotedSubtask, unpromotedSubtasksOf } from "@/lib/subtasks";
import { cn } from "@/lib/utils";
import type { GoalBrief } from "@/types/goal";
import type { Session } from "@/types/session";

/** ⌘\ on macOS, Ctrl+\ elsewhere — free in Galley (useGlobalShortcuts,
 * the native menu) and Notion's sidebar key. ⌃⌘S (Finder / Mail) has
 * no Windows / Linux form. */
const TOGGLE_SHORTCUT = "Mod+\\";

/**
 * The sidebar toggle (main chat ticket 08, PRD rulings 30 / 34): the
 * leftmost thing in the main header, one button for both directions,
 * with ⌘\. App renders it only while there is a main chat (the managed
 * runtime), so the external runtime has neither the button nor the key
 * and its sidebar never collapses.
 *
 * Collapsed, the main header is the window's top-left: on macOS the
 * button clears the traffic lights the way SidebarHeader's wordmark
 * does (lights end ~68px; the button starts at 80px), and the space
 * around it stays the header's drag region (a button is never one).
 * Windows / Linux: the same button at the header's normal left gutter.
 *
 * While collapsed, conversations waiting for a reply or erroring count
 * on a badge at the icon's corner — the 定时 icon's badge recipe
 * (warning tint; error when any has errored), a number, never a status
 * dot (layout-and-chrome.md bans those). The session open in the main
 * area is not counted: it is in front of you. The main chat counts
 * like any other when it is not the one open (its subtasks' asks reach
 * its row).
 */
export function SidebarCollapseToggle({
  collapsed,
  onToggle,
  sessions,
  activeId,
  sessionGoalStatus,
}: {
  collapsed: boolean;
  onToggle: () => void;
  sessions: Session[];
  activeId?: string;
  sessionGoalStatus?: Map<string, GoalBrief>;
}) {
  const copy = useCopy();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(isMac ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.code !== "Backslash" && e.key !== "\\") return;
      e.preventDefault();
      onToggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggle]);

  // Counted the way the sidebar shows them: an unpromoted subtask has no
  // row of its own, its ask / error lights the main chat's (ticket 06a),
  // so it counts as the main chat — unless the main chat, or the
  // subtask itself, is the one open.
  const mainChat = findMainChat(sessions);
  const subtasks = unpromotedSubtasksOf(sessions, mainChat?.id).filter(
    (s) => s.status !== "archived",
  );
  const mainChatOpen =
    !!mainChat &&
    (activeId === mainChat.id || subtasks.some((s) => s.id === activeId));
  const others = sessions.filter(
    (s) =>
      s.id !== activeId && s.status !== "archived" && !isUnpromotedSubtask(s),
  );
  const attention = useSessionsAttention(others, activeId, sessionGoalStatus);
  const subtaskAttention = useSessionsAttention(
    mainChatOpen ? [] : subtasks,
    activeId,
    sessionGoalStatus,
  );
  const subtasksNeedYou =
    !!mainChat &&
    subtaskAttention.needsYouIds.size > 0 &&
    !attention.needsYouIds.has(mainChat.id);
  const needsYou = attention.needsYouIds.size + (subtasksNeedYou ? 1 : 0);
  const count = collapsed ? needsYou : 0;
  const label = collapsed
    ? copy.topbar.expandSidebar
    : copy.topbar.collapseSidebar;
  const fullLabel =
    count > 0 ? `${label} · ${copy.topbar.sidebarNeedsYou(count)}` : label;
  return (
    <span
      className={cn("inline-flex shrink-0", isMac && collapsed && "ml-[70px]")}
    >
      <IconTooltip
        text={
          <ShortcutTooltipText
            label={fullLabel}
            shortcut={formatShortcut(TOGGLE_SHORTCUT)}
          />
        }
        side="bottom"
      >
        <TopBarIconButton
          onClick={onToggle}
          aria-label={fullLabel}
          // relative: anchors the badge.
          className="relative"
        >
          <SidebarSimple size={16} weight="thin" />
          <NeedsYouBadge
            count={needsYou}
            visible={collapsed}
            tone={
              attention.kind === "error" ||
              (subtasksNeedYou && subtaskAttention.kind === "error")
                ? "error"
                : "warning"
            }
          />
        </TopBarIconButton>
      </IconTooltip>
    </span>
  );
}

/**
 * SidebarNavIcons' ScheduledBadge on the main header's ground: the
 * same 14px pill at the glyph's top-right, the tint mixed against
 * `--color-app` so it covers the strokes under it. Pops once when the
 * count rises (latched on the count itself, so collapsing the sidebar
 * over already-waiting chats is not news).
 */
function NeedsYouBadge({
  count,
  visible,
  tone,
}: {
  count: number;
  visible: boolean;
  tone: "warning" | "error";
}) {
  const [prevCount, setPrevCount] = useState(count);
  const [prevVisible, setPrevVisible] = useState(visible);
  const [pop, setPop] = useState(false);
  if (count !== prevCount) {
    setPrevCount(count);
    setPop(count > prevCount);
  }
  // Showing the badge again (collapsing) must not replay an old pop.
  if (visible !== prevVisible) {
    setPrevVisible(visible);
    setPop(false);
  }
  if (!visible || count <= 0) return null;
  return (
    <span
      key={count}
      data-role="sidebar-needs-you-badge"
      className={cn(
        "pointer-events-none absolute left-1/2 top-px ml-px inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-[3px]",
        "text-[9.5px] font-semibold leading-none tabular-nums",
        tone === "error"
          ? "bg-[color-mix(in_oklab,var(--color-error)_15%,var(--color-app))] text-error"
          : "bg-[color-mix(in_oklab,var(--color-warning)_15%,var(--color-app))] text-warning",
        pop && "sidebar-state-pop",
      )}
    >
      {count}
    </span>
  );
}
