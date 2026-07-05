import {
  Folder,
  FolderOpen,
  MagnifyingGlass,
  Plus,
} from "@phosphor-icons/react";

import { IconTooltip } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { formatShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";


export function SidebarQuickActions({
  onNewChat,
  onSearch,
  projectViewOpen,
  onToggleProjectView,
  onNewProject,
  activeProjectName,
}: {
  onNewChat?: () => void;
  onSearch?: () => void;
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
        "mx-1.5 flex w-[calc(100%-12px)] items-center rounded-sm transition-[background-color,box-shadow,color] motion-reduce:transition-none",
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
            "flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 py-2 text-left outline-none",
            "transition-transform duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] active:translate-y-px active:duration-[45ms]",
            "focus-visible:ring-2 focus-visible:ring-brand/30",
          )}
        >
          <ProjectIcon
            size={14}
            weight="thin"
            className={cn(
              "shrink-0 transition-colors",
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
            "text-ink-soft transition-[background-color,color,transform] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]",
            "hover:bg-hover hover:text-ink active:translate-y-px active:bg-selected/60 active:duration-[45ms]",
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
  onClick,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
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
        "mx-1.5 flex w-[calc(100%-12px)] cursor-pointer items-center gap-2.5 rounded-sm px-3 py-2 text-left text-[13px] text-ink",
        "transition-[background-color,color,transform] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:bg-hover",
        "active:translate-y-px active:duration-[45ms]",
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
    </button>
  );
}
