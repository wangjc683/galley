import {
  Clock,
  Folder,
  FolderOpen,
  MagnifyingGlass,
  Plus,
} from "@phosphor-icons/react";
import { useState } from "react";

import { IconTooltip } from "@/components/ui/tooltip";
import { type AppCopy, useCopy, useLanguage } from "@/lib/i18n";
import { formatShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";


/**
 * One row: 新对话 on the left, 搜索 / 定时 / 项目 as 32px icons on the
 * right with name and shortcut in their tooltips. Only 新对话 is
 * high-frequency here, and four full rows took about three session
 * rows of height (2026-09-28). The other three are demoted, not hidden
 * (community usage is unknown): the 定时 badge and the 项目 pressed
 * state stay on the icons. 新建项目 lives on Project Review's first
 * group header; the command palette has it too.
 */
export function SidebarQuickActions({
  onNewChat,
  onSearch,
  onOpenScheduled,
  scheduledActionCount = 0,
  projectViewOpen,
  onToggleProjectView,
  activeProjectName,
}: {
  onNewChat?: () => void;
  onSearch?: () => void;
  onOpenScheduled?: () => void;
  /** Scheduled items needing the user's action — approval-blocked
   * sessions plus tasks whose last fire failed — rendered as a badge
   * on the 定时 icon so an overnight problem is visible at a glance.
   * Action-only by design: no idle total-count, so the position stays
   * meaningful (a number here always means "handle something"). */
  scheduledActionCount?: number;
  projectViewOpen: boolean;
  onToggleProjectView?: () => void;
  /** When set, the "+ New Chat" label appends project context so the
   * user knows the first message will be filed into that project.
   * Without this hint the action was technically correct but
   * invisibly so. */
  activeProjectName?: string;
}) {
  const copy = useCopy();
  const ProjectIcon = projectViewOpen ? FolderOpen : Folder;
  const projectActionLabel = projectViewOpen
    ? copy.sidebar.exitProjects
    : copy.sidebar.projects;
  const scheduledLabel = scheduledTooltip(copy, scheduledActionCount);
  return (
    <div className="@container border-b border-line/70 py-1">
      <div className="mx-1.5 flex items-center gap-0.5">
        <NewChatButton projectName={activeProjectName} onClick={onNewChat} />
        <QuickIconButton
          label={copy.sidebar.search}
          tooltip={
            <ShortcutTooltipText
              label={copy.sidebar.search}
              shortcut={formatShortcut("Mod+K")}
            />
          }
          onClick={onSearch}
        >
          <MagnifyingGlass size={14} weight="thin" />
        </QuickIconButton>
        <QuickIconButton
          label={scheduledLabel}
          tooltip={scheduledLabel}
          onClick={onOpenScheduled}
        >
          <Clock size={14} weight="thin" />
          <ScheduledBadge count={scheduledActionCount} />
        </QuickIconButton>
        <QuickIconButton
          label={projectActionLabel}
          tooltip={projectActionLabel}
          pressed={projectViewOpen}
          onClick={onToggleProjectView}
        >
          <ProjectIcon size={14} weight="thin" />
        </QuickIconButton>
      </div>
    </div>
  );
}


/**
 * Scheduled action-count badge on the 定时 icon's top-right corner.
 * Stays mounted (renders nothing at 0) so the pop latch below survives
 * 0 -> 1.
 */
function ScheduledBadge({ count }: { count: number }) {
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
        // transform.
        "pointer-events-none absolute left-1/2 top-[3px] ml-px inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-[3px]",
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
function ShortcutTooltipText({
  label,
  shortcut,
}: {
  label: string;
  shortcut: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      <span className="font-mono text-[10.5px] tracking-wide text-ink-muted">
        {shortcut}
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


/**
 * 32px icon button: instant hover fill, translate-y key travel.
 * `pressed` is the 项目 toggle's on state — shadow-inner + darker fill +
 * FolderOpen flip (from the caller) read as a button held down, so
 * Project Review stays visibly on; "press again = exit" is carried by
 * the tooltip / aria (layout-and-chrome.md §4.2).
 */
function QuickIconButton({
  label,
  tooltip,
  pressed,
  onClick,
  children,
}: {
  label: string;
  tooltip: React.ReactNode;
  /** Toggle buttons only; leave undefined for plain actions. */
  pressed?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <IconTooltip text={tooltip} side="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        className={cn(
          // Default flex-shrink stays on: at the 134px minimum sidebar
          // the row squeezes these to ~29px instead of overflowing.
          "relative inline-flex size-8 items-center justify-center rounded-sm",
          "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm active:translate-y-px",
          "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          pressed
            ? "bg-selected/85 text-brand-strong shadow-inner"
            : "text-ink-soft hover:bg-hover hover:text-ink active:bg-selected/60",
        )}
      >
        {children}
      </button>
    </IconTooltip>
  );
}


/**
 * 新对话 with its text. Fills the space left of the icons; ⌘N lives in
 * the tooltip. The plus is brand-strong so the eye lands on it first:
 * new session = creation = a brand moment, the same brand language as
 * the active-session row — a quiet hierarchy cue, not a CTA block.
 */
function NewChatButton({
  projectName,
  onClick,
}: {
  projectName?: string;
  onClick?: () => void;
}) {
  const copy = useCopy();
  const language = useLanguage();
  const label = projectName
    ? copy.sidebar.newConversationInProject(projectName)
    : copy.sidebar.newConversation;
  return (
    <IconTooltip
      text={
        <ShortcutTooltipText label={label} shortcut={formatShortcut("Mod+N")} />
      }
      side="bottom"
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          // min-w: pl-3 + the 15px plus. Not min-w-0 — at the narrowest
          // widths the row must squeeze the icons, not clip the plus.
          "flex h-8 min-w-[27px] flex-1 items-center gap-2.5 rounded-sm pl-3 text-left text-[13px] text-ink",
          "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm hover:bg-hover",
          "active:translate-y-px",
          "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        )}
      >
        <Plus size={15} weight="bold" className="shrink-0 text-brand-strong" />
        {/* The action text shows whole or not at all — never cut in
            half. Thresholds are the quick-actions container width
            (= sidebar width minus its 1px border): row mx-1.5 12 +
            [pl-3 12 + plus 15 + gap-2.5 10 + text + pr-2 8] + 3 gaps
            × 2 + 3 icons × 32 = 159px + text. 新对话 is 3 × 13 = 39px
            -> 198px; New chat is 58.8px (Inter 500 13px, measured)
            -> 217.8, rounded up to 220px. Below that the whole label
            goes and only the plus stays, its tooltip carrying the full
            label. Both classes are written out so Tailwind emits them.
            In a project only " · 项目名" truncates. pr-2 sits on the
            label so it vanishes with it: at the 134px minimum the plus
            needs 27px and the icons squeeze to ~29px each. */}
        <span
          className={cn(
            "flex min-w-0 flex-1 pr-2 font-medium",
            language === "en-US"
              ? "@max-[220px]:hidden"
              : "@max-[198px]:hidden",
          )}
        >
          <span className="shrink-0">{copy.sidebar.newConversation}</span>
          {projectName && (
            // Same "action · name" shape as newConversationInProject in
            // both locales. NBSP: a plain leading space would collapse
            // at the start of this flex item.
            <span className="min-w-0 truncate">
              {"\u00a0· "}
              {projectName}
            </span>
          )}
        </span>
      </button>
    </IconTooltip>
  );
}
