import { Clock, FolderPlus, MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { TopBarIconButton } from "@/components/layout/TopBarIconButton";
import { ShortcutGlyphs } from "@/components/ui/shortcut-glyphs";
import { IconTooltip } from "@/components/ui/tooltip";
import { type AppCopy, useCopy } from "@/lib/i18n";
import { formatShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

import {
  HEADER_NAV_ICONS_DISPLAY,
  ROW_NAV_ICONS_DISPLAY,
} from "./sidebar-width";

/** Mono, muted shortcut text — the tooltip's "⌘K" and the new-chat
 * row's ⌘N hint. Render the text through `ShortcutGlyphs` so the
 * modifier glyph takes the system font (lib/shortcuts.ts). */
export const SHORTCUT_TEXT_CLASS =
  "font-mono text-[10.5px] tracking-wide text-ink-muted";

type NavIconsPlacement = "header" | "row";

/**
 * 搜索 / 定时 / 新建项目 as icons, name and shortcut in their tooltips. The
 * group renders twice — once in SidebarHeader, once in the new-chat row
 * — and the sidebar width decides which copy is displayed (see
 * sidebar-width.ts). The other copy is display:none, so it is neither
 * focusable nor in the accessibility tree.
 *
 * - header: the shared 28px TopBarIconButton with 16px icons, gap-1,
 *   like MainHeader's utility cluster.
 * - row: the 32px QuickIconButton with 14px icons, gap-0.5 — the
 *   2026-09-28 one-row layout, unchanged.
 *
 * The 定时 badge rides along in both. The third icon creates a project
 * (2026-10-09; it was the 项目 menu): the projects themselves are all in
 * the 项目 section, the quiet ones behind its 「其他项目」 row.
 */
export function SidebarNavIcons({
  placement,
  onSearch,
  onOpenScheduled,
  scheduledActionCount = 0,
  onNewProject,
}: {
  placement: NavIconsPlacement;
  onSearch?: () => void;
  onOpenScheduled?: () => void;
  /** Scheduled items needing the user's action — tasks whose last
   * fire failed — rendered as a badge
   * on the 定时 icon so an overnight problem is visible at a glance.
   * Action-only by design: no idle total-count, so the position stays
   * meaningful (a number here always means "handle something"). */
  scheduledActionCount?: number;
  onNewProject?: () => void;
}) {
  const copy = useCopy();
  const inHeader = placement === "header";
  const NavButton = inHeader ? HeaderIconButton : QuickIconButton;
  const iconSize = inHeader ? 16 : 14;
  const scheduledLabel = scheduledTooltip(copy, scheduledActionCount);
  return (
    <div
      className={cn(
        "items-center",
        inHeader
          ? cn(HEADER_NAV_ICONS_DISPLAY, "shrink-0 gap-1")
          : // min-w-0: lets the row squeeze the icons at the narrowest
            // widths (their own 32px widths would otherwise pin this
            // wrapper's minimum at 100px and overflow the row).
            cn(ROW_NAV_ICONS_DISPLAY, "min-w-0 gap-0.5"),
      )}
    >
      <NavButton
        label={copy.sidebar.search}
        tooltip={
          <ShortcutTooltipText
            label={copy.sidebar.search}
            shortcut={formatShortcut("Mod+K")}
          />
        }
        onClick={onSearch}
      >
        <MagnifyingGlass size={iconSize} weight="thin" />
      </NavButton>
      <NavButton
        label={scheduledLabel}
        tooltip={scheduledLabel}
        onClick={onOpenScheduled}
      >
        <Clock size={iconSize} weight="thin" />
        <ScheduledBadge count={scheduledActionCount} placement={placement} />
      </NavButton>
      <NavButton
        label={copy.sidebar.newProject}
        tooltip={copy.sidebar.newProject}
        onClick={onNewProject}
      >
        <FolderPlus size={iconSize} weight="thin" />
      </NavButton>
    </div>
  );
}

/** Lifetime of the pop class: the 0.44s sidebar-state-pop plus margin. */
const BADGE_POP_CLEAR_MS = 600;

/**
 * Scheduled action-count badge on the 定时 icon's top-right corner.
 * Stays mounted (renders nothing at 0) so the pop latch below survives
 * 0 -> 1.
 */
function ScheduledBadge({
  count,
  placement,
}: {
  count: number;
  placement: NavIconsPlacement;
}) {
  // One-shot pop when the action count INCREASES — a new item needing
  // the user landed while they were looking elsewhere; the pop is the
  // entry beat, the badge itself carries the persistent state (same
  // philosophy as SidebarSessionRow's attention pop). Decreases stay
  // silent (the user just handled something — that's not news), and
  // the mount state is suppressed via prev-count initialization so app
  // launch doesn't fire a spurious "look here". Render-phase adjust,
  // same pattern as the session row's popEnabled latch.
  const [prevCount, setPrevCount] = useState(count);
  const [pop, setPop] = useState(false);
  if (count !== prevCount) {
    setPrevCount(count);
    setPop(count > prevCount);
  }
  // Drop the pop class once it has played. The badge renders in both
  // icon-group copies and one is display:none; a class left on the
  // hidden copy would replay the pop when a sidebar resize reveals it.
  useEffect(() => {
    if (!pop) return;
    const id = window.setTimeout(() => setPop(false), BADGE_POP_CLEAR_MS);
    return () => window.clearTimeout(id);
  }, [pop, count]);
  if (count <= 0) return null;
  // Keyed on the count so an increase remounts the span with the pop
  // class already present — the animation plays exactly on entry, never
  // mid-state (SidebarSessionRow's keyed-icon idiom).
  return (
    <span
      key={count}
      className={cn(
        // Same warning tint, mixed against chrome instead of transparent
        // so the badge covers the clock strokes under it. Anchored left
        // of centre (no translate) so the pop's scale is its only
        // transform. Both anchors put the badge's left edge 1px right
        // of the clock's centre and its middle at the clock face's top
        // edge: 14px icon in 32px (face top y≈10.75) -> top 3px; 16px
        // icon in 28px (face top y=8) -> top 1px.
        "pointer-events-none absolute left-1/2 ml-px inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-[3px]",
        placement === "header" ? "top-px" : "top-[3px]",
        "bg-[color-mix(in_oklab,var(--color-warning)_15%,var(--color-chrome))] text-[9.5px] font-semibold leading-none tabular-nums text-warning",
        pop && "sidebar-state-pop",
      )}
    >
      {count}
    </span>
  );
}

/** Tooltip body "名称 ⌘K". The shortcut keeps the mono, muted styling
 * the old row-end hints had. */
export function ShortcutTooltipText({
  label,
  shortcut,
}: {
  label: string;
  shortcut: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      <span className={SHORTCUT_TEXT_CLASS}>
        <ShortcutGlyphs text={shortcut} />
      </span>
    </span>
  );
}

// 定时's tooltip and aria-label. The badge carries no native title (it
// would double up with the tooltip), so the tooltip says what the
// number means.
function scheduledTooltip(copy: AppCopy, count: number): string {
  return count > 0
    ? copy.sidebar.scheduledNeedsAction(count)
    : copy.sidebar.scheduled;
}

type NavIconButtonProps = {
  label: string;
  tooltip: React.ReactNode;
  onClick?: () => void;
  children: React.ReactNode;
};

/** Header form: the shared TopBarIconButton. */
function HeaderIconButton({
  label,
  tooltip,
  onClick,
  children,
}: NavIconButtonProps) {
  return (
    <IconTooltip text={tooltip} side="bottom">
      <TopBarIconButton
        onClick={onClick}
        aria-label={label}
        // relative: anchors the 定时 badge.
        className="relative"
      >
        {children}
      </TopBarIconButton>
    </IconTooltip>
  );
}

/** Row form: 32px icon button, instant hover fill, translate-y key
 * travel. */
function QuickIconButton({
  label,
  tooltip,
  onClick,
  children,
}: NavIconButtonProps) {
  return (
    <IconTooltip text={tooltip} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          // Default flex-shrink stays on: at the 134px minimum sidebar
          // the row squeezes these to ~29px instead of overflowing.
          "relative inline-flex size-8 items-center justify-center rounded-sm",
          "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm active:translate-y-px",
          "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          "text-ink-soft hover:bg-hover hover:text-ink active:bg-selected/60",
        )}
      >
        {children}
      </button>
    </IconTooltip>
  );
}
