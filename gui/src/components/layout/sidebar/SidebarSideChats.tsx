import { Plus, Tray } from "@phosphor-icons/react";

import { IconTooltip } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { formatShortcut } from "@/lib/shortcuts";
import { PROJECT_GROUP_RECENT_COUNT } from "@/lib/sidebar-timeline";
import { cn } from "@/lib/utils";
import type { Project, Session } from "@/types/session";

import { SidebarProjectGroup } from "./SidebarProjectGroup";
import { ShortcutTooltipText } from "./SidebarNavIcons";
import type { SidebarTimelineRowWiring } from "./SidebarTimelineRow";

/**
 * The sectioned sidebar's pieces (main chat tickets 07 / 08, PRD rulings
 * 30–36): with a main chat, its row is the home, and every other
 * conversation sits in one section under it —
 *
 *   ⌂ 主对话
 *   其他对话              +   ← SidebarSideChatHeader; the + stays
 *                               pressed while the empty new-chat
 *                               composer it opened is up
 *     置顶 / 项目 / 今天 …
 *     其他来源 N             ← SidebarOtherSources
 *     更早 N
 *
 * 「旁聊」 (side chat) is the PRD's and the code's word for these; the
 * UI says 其他对话 / 新对话 (ruling 35).
 */

/**
 * The section header. A step above the 10px time-bucket labels so the
 * two never read as one family: 12px semibold `ink-soft`, no tracking
 * (the buckets are 10px semibold `ink-muted` with 0.08em) — the
 * section is a container, the buckets are its scale. The label sits on
 * the rows' 18px edge; the + is the rows' 28px `⋯` button in the `⋯`
 * column (and the masthead's 新建项目 column above it). The header itself
 * does nothing: no click, no fold. It is the scrolling list's first
 * element and sticks to its top (Sidebar.tsx, ticket 09: it went from
 * the main chat's pinned block to its children), so the new-chat +
 * never scrolls away.
 *
 * While the empty new-chat composer it opened is up, the + is the
 * sidebar's one "you are here" (ticket 13, PRD ruling 56): pressed in
 * the selected row's fill and lift, until the first send's row takes
 * over. No row stands in for the conversation before it exists — the
 * main pane already says where it will go. Pressing it again
 * refocuses the composer.
 */
export function SidebarSideChatHeader({
  onNewChat,
  plusPressed = false,
}: {
  onNewChat?: () => void;
  /** The empty new-chat composer is up and this + opened it (not a
   * project's +): it stays pressed. */
  plusPressed?: boolean;
}) {
  const copy = useCopy();
  const newChatLabel = copy.sidebar.newConversation;
  return (
    <div className="mx-1.5 flex h-8 items-center gap-1.5 pl-3 pr-1.5">
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-soft">
        {copy.sidebar.otherChats}
      </span>
      <IconTooltip
        text={
          <ShortcutTooltipText
            label={newChatLabel}
            shortcut={formatShortcut("Mod+N")}
          />
        }
        side="right"
      >
        <button
          type="button"
          onClick={onNewChat}
          aria-label={newChatLabel}
          aria-current={plusPressed ? "page" : undefined}
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-sm",
            "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
            plusPressed
              ? "bg-selected text-ink shadow-[var(--shadow-selected)] hover:bg-(--color-selected-hover)"
              : "text-ink-soft hover:bg-hover hover:text-ink active:bg-selected/60",
            "active:translate-y-px",
            "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          )}
        >
          <Plus size={14} weight="regular" />
        </button>
      </IconTooltip>
    </div>
  );
}

/** The section's one line while it holds no conversation a person
 * started — the empty sidebar's 「你的对话会出现在这里。」 register. Gone
 * with the first one; agent-started sessions don't count. */
export function SidebarSideChatEmptyHint() {
  const copy = useCopy();
  return (
    <p className="mx-1.5 px-3 py-2 text-[12.5px] italic text-ink-muted">
      {copy.sidebar.otherChatsHint}
    </p>
  );
}

const OTHER_SOURCES_ID = "galley:other-sources";
const OTHER_SOURCES_ICON = { closed: Tray, open: Tray };

/**
 * 「其他来源 N」 (PRD ruling 32): the agent-started sessions outside
 * projects — CLI, supervisor, scheduled tasks — as one project-group
 * row, with the group's behaviour as is: collapsed by default (this
 * run only), a click opens it, the newest five then 显示更多, and while
 * collapsed the sessions erroring / waiting for a reply and the
 * selected one hang under the row. No + and no menu: it is not a
 * project. A tray, not a folder: things handed in from elsewhere.
 */
export function SidebarOtherSources({
  sessions,
  expanded,
  onToggleExpanded,
  ...rowWiring
}: {
  sessions: Session[];
  expanded: boolean;
  onToggleExpanded: () => void;
} & SidebarTimelineRowWiring) {
  const copy = useCopy();
  if (sessions.length === 0) return null;
  const newest = sessions[0].lastActivityAt;
  const group: Project = {
    id: OTHER_SOURCES_ID,
    name: copy.sidebar.otherSources,
    workspaceEnabled: false,
    pinned: false,
    lastActivityAt: newest,
    createdAt: newest,
    updatedAt: newest,
  };
  // pt-2: the 更早 entry's gap — the row closes the time buckets, it
  // is not the last bucket's last session. First under the header
  // (nothing a person started is listed above it) it drops to pt-1,
  // the small gap that says whose it is (ticket 09).
  return (
    <div className="pt-2 [[data-sidebar-section-body]>&:first-child]:pt-1">
      <SidebarProjectGroup
        project={group}
        groupIcon={OTHER_SOURCES_ICON}
        sessions={sessions.slice(0, PROJECT_GROUP_RECENT_COUNT)}
        olderSessions={sessions.slice(PROJECT_GROUP_RECENT_COUNT)}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        {...rowWiring}
      />
    </div>
  );
}
