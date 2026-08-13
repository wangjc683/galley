import {
  Clock,
  Folder,
  FolderOpen,
  MagnifyingGlass,
  Plus,
} from "@phosphor-icons/react";
import { useState } from "react";

import { IconTooltip } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { formatShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";


export function SidebarQuickActions({
  onNewChat,
  onSearch,
  onOpenScheduled,
  scheduledActionCount = 0,
  projectViewOpen,
  onToggleProjectView,
  onNewProject,
  activeProjectName,
}: {
  onNewChat?: () => void;
  onSearch?: () => void;
  onOpenScheduled?: () => void;
  /** Scheduled items needing the user's action — approval-blocked
   * sessions plus tasks whose last fire failed — rendered as a badge
   * on the 定时 row so an overnight problem is visible at a glance.
   * Action-only by design: no idle total-count, so the position stays
   * meaningful (a number here always means "handle something"). */
  scheduledActionCount?: number;
  projectViewOpen: boolean;
  onToggleProjectView?: () => void;
  onNewProject?: () => void;
  /** When set, the "+ New Chat" label appends project context so the
   * user knows the first message will be filed into that project.
   * Without this hint the action was technically correct but
   * invisibly so. */
  activeProjectName?: string;
}) {
  const copy = useCopy();
  const newChatLabel = activeProjectName
    ? copy.sidebar.newConversationInProject(activeProjectName)
    : copy.sidebar.newConversation;
  // One-shot pop when the action count INCREASES — a new item needing
  // the user landed while they were looking elsewhere; the pop is the
  // entry beat, the badge itself carries the persistent state (same
  // philosophy as SidebarSessionRow's attention pop). Decreases stay
  // silent (the user just handled something — that's not news), and
  // the mount state is suppressed via prev-count initialization so app
  // launch doesn't fire a spurious "look here". Render-phase adjust,
  // same pattern as the session row's popEnabled latch.
  const [prevScheduledCount, setPrevScheduledCount] = useState(
    scheduledActionCount,
  );
  const [popScheduledBadge, setPopScheduledBadge] = useState(false);
  if (scheduledActionCount !== prevScheduledCount) {
    setPrevScheduledCount(scheduledActionCount);
    setPopScheduledBadge(scheduledActionCount > prevScheduledCount);
  }
  return (
    <div className="border-b border-line/70 py-1">
      <QuickAction
        icon={<Plus size={15} weight="bold" />}
        label={newChatLabel}
        hint={formatShortcut("Mod+N")}
        onClick={onNewChat}
        accent
      />
      <QuickAction
        icon={<MagnifyingGlass size={14} weight="thin" />}
        label={copy.sidebar.search}
        hint={formatShortcut("Mod+K")}
        onClick={onSearch}
      />
      <QuickAction
        icon={<Clock size={14} weight="thin" />}
        label={copy.sidebar.scheduled}
        onClick={onOpenScheduled}
        badge={
          scheduledActionCount > 0 ? (
            // Keyed on the count so an increase remounts the span with
            // the pop class already present — the animation plays
            // exactly on entry, never mid-state (SidebarSessionRow's
            // keyed-icon idiom).
            <span
              key={scheduledActionCount}
              title={copy.sidebar.scheduledNeedsAction(scheduledActionCount)}
              className={cn(
                "inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-warning/15 px-1 text-[10px] font-semibold tabular-nums text-warning",
                popScheduledBadge && "sidebar-state-pop",
              )}
            >
              {scheduledActionCount}
            </span>
          ) : undefined
        }
      />
      <ProjectQuickAction
        active={projectViewOpen}
        onClick={onToggleProjectView}
        onNewProject={onNewProject}
      />
    </div>
  );
}


function ProjectQuickAction({
  active,
  onClick,
  onNewProject,
}: {
  active: boolean;
  onClick?: () => void;
  onNewProject?: () => void;
}) {
  const copy = useCopy();
  const ProjectIcon = active ? FolderOpen : Folder;
  const projectActionLabel = active
    ? copy.sidebar.exitProjects
    : copy.sidebar.showProjects;
  return (
    <div
      className={cn(
        "mx-1.5 flex w-[calc(100%-12px)] items-center rounded-sm",
        // 激活态用 shadow-inner + 底色压暗 + FolderOpen 翻面,读出
        // "被按住/陷进去"的物理按压感;标签保持「项目」不换字
        // (换字会让行宽跳动),"再按一次 = 退出"由 tooltip / aria
        // 承担 —— 与 layout-and-chrome.md §4.2 的约定一致。
        active
          ? "bg-selected/85 text-ink shadow-inner"
          : "text-ink hover:bg-hover",
      )}
    >
      <IconTooltip text={projectActionLabel} side="bottom">
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          aria-label={projectActionLabel}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-left outline-none",
            "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm active:translate-y-px",
            "focus-visible:ring-2 focus-visible:ring-brand/30",
          )}
        >
          <ProjectIcon
            size={14}
            weight="thin"
            className={cn(
              "shrink-0",
              active ? "text-brand-strong" : "text-ink-soft",
            )}
          />
          <span className="min-w-0 flex-1 truncate text-[13px]">
            {copy.sidebar.projects}
          </span>
        </button>
      </IconTooltip>
      <IconTooltip text={copy.sidebar.newProject}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNewProject?.();
          }}
          aria-label={copy.sidebar.newProject}
          className={cn(
            "mr-0.5 inline-flex size-[32px] shrink-0 items-center justify-center rounded-sm",
            // 只调图标本身权重,不加任何底色,保持 quick actions 那一排
            // 通透无背景的语言一致。size 提到 14 与 Folder 图标对齐,
            // weight 从 thin→regular 让笔画更扎实,色从 muted→soft 提一档。
            "text-ink-soft transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
            "hover:bg-hover hover:text-ink active:translate-y-px active:bg-selected/60",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          )}
        >
          <Plus size={14} weight="regular" />
        </button>
      </IconTooltip>
    </div>
  );
}


function QuickAction({
  icon,
  label,
  hint,
  badge,
  onClick,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  /** Trailing status badge (e.g. the 定时 row's waiting-approval
   * count). Rendered in the hint slot position. */
  badge?: React.ReactNode;
  onClick?: () => void;
  /** Primary/creative action (New Chat): tint the icon brand-strong so
   * the eye lands on it first. New session = creation = a brand moment,
   * the same brand language as the active-session row — a quiet
   * hierarchy cue, not a CTA block. */
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mx-1.5 flex w-[calc(100%-12px)] items-center gap-2.5 rounded-sm px-3 py-2 text-left text-[13px] text-ink",
        "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm hover:bg-hover",
        "active:translate-y-px",
        "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
      )}
    >
      <span className={cn("shrink-0", accent ? "text-brand-strong" : "text-ink-soft")}>
        {icon}
      </span>
      <span
        className={cn("min-w-0 flex-1 truncate", accent && "font-medium")}
      >
        {label}
      </span>
      {hint && (
        <span className="shrink-0 font-mono text-[10.5px] tracking-wide text-ink-muted">
          {hint}
        </span>
      )}
      {badge && <span className="shrink-0">{badge}</span>}
    </button>
  );
}
