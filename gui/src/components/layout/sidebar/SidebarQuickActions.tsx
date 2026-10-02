import { Plus } from "@phosphor-icons/react";

import { IconTooltip } from "@/components/ui/tooltip";
import { useCopy, useLanguage } from "@/lib/i18n";
import { formatShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

import { NEW_CHAT_HINT_DISPLAY, NEW_CHAT_LABEL_HIDDEN } from "./sidebar-width";
import {
  SHORTCUT_TEXT_CLASS,
  ShortcutTooltipText,
  SidebarNavIcons,
} from "./SidebarNavIcons";

/**
 * The new-chat row under SidebarHeader. Wide sidebars: 新对话 spans the
 * row with a ⌘N hint at its end, while 搜索 / 定时 / 项目 sit in the
 * header. Narrow sidebars: the header can't fit them, so the icons
 * come down into this row as 32px icons right of 新对话 — the
 * 2026-09-28 one-row layout. The width switch is in sidebar-width.ts;
 * this row exists in both states, so the session list never jumps.
 * Only 新对话 is high-frequency here; the other three are demoted, not
 * hidden (community usage is unknown). 新建项目 lives on Project
 * Review's first group header; the command palette has it too.
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
  /** Badge count on the 定时 icon; see SidebarNavIcons. */
  scheduledActionCount?: number;
  projectViewOpen: boolean;
  onToggleProjectView?: () => void;
  /** When set, the "+ New Chat" label appends project context so the
   * user knows the first message will be filed into that project.
   * Without this hint the action was technically correct but
   * invisibly so. */
  activeProjectName?: string;
}) {
  return (
    <div className="border-b border-line/70 py-1">
      <div className="mx-1.5 flex items-center gap-0.5">
        <NewChatButton projectName={activeProjectName} onClick={onNewChat} />
        <SidebarNavIcons
          placement="row"
          onSearch={onSearch}
          onOpenScheduled={onOpenScheduled}
          scheduledActionCount={scheduledActionCount}
          projectViewOpen={projectViewOpen}
          onToggleProjectView={onToggleProjectView}
        />
      </div>
    </div>
  );
}

/**
 * 新对话 with its text. Spans the row, or the space left of the icons
 * in the narrow state. The plus is brand-strong so the eye lands on it
 * first: new session = creation = a brand moment, the same brand
 * language as the active-session row — a quiet hierarchy cue, not a
 * CTA block.
 *
 * ⌘N is shown only without project context. ⌘N always opens a plain
 * new chat (useGlobalShortcuts clears the project filter) while this
 * button lands in the project, so in a project the tooltip is the
 * label alone and the row-end hint is gone — the shortcut would be a
 * false promise there.
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
  const shortcut = projectName ? null : formatShortcut("Mod+N");
  return (
    <IconTooltip
      text={
        shortcut ? (
          <ShortcutTooltipText label={label} shortcut={shortcut} />
        ) : (
          label
        )
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
            half. It can only run out of room in the narrow state, with
            the icons beside it; the thresholds and their arithmetic
            are in sidebar-width.ts (NEW_CHAT_LABEL_HIDDEN). Below them
            the whole label goes and only the plus stays, its tooltip
            carrying the full label. In a project only " · 项目名"
            truncates. pr-2 sits on the label so it vanishes with it:
            at the 134px minimum the plus needs 27px and the icons
            squeeze to ~29px each. */}
        <span
          className={cn(
            "flex min-w-0 flex-1 pr-2 font-medium",
            language === "en-US"
              ? NEW_CHAT_LABEL_HIDDEN.en
              : NEW_CHAT_LABEL_HIDDEN.zh,
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
        {/* Row-end ⌘N, only while the row is alone (wide state). pr-3
            ends it 18px from the sidebar edge, on the session rows'
            px-3 text edge. aria-hidden: the button's aria-label is
            the name; the shortcut is a visual hint. */}
        {shortcut && (
          <span
            aria-hidden="true"
            className={cn(
              NEW_CHAT_HINT_DISPLAY,
              "shrink-0 pr-3",
              SHORTCUT_TEXT_CLASS,
            )}
          >
            {shortcut}
          </span>
        )}
      </button>
    </IconTooltip>
  );
}
