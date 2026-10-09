import { Plus } from "@phosphor-icons/react";

import { ShortcutGlyphs } from "@/components/ui/shortcut-glyphs";
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
 * row with a ⌘N hint at its end, while 搜索 / 定时 / 新建项目 sit in the
 * header. Narrow sidebars: the header can't fit them, so the icons
 * come down into this row as 32px icons right of 新对话 — the
 * 2026-09-28 one-row layout. The width switch is in sidebar-width.ts;
 * this row exists in both states, so the session list never jumps.
 * Only 新对话 is high-frequency here; the other three are demoted, not
 * hidden (community usage is unknown). The command palette has
 * 新建项目 too.
 */
export function SidebarQuickActions({
  onNewChat,
  onSearch,
  onOpenScheduled,
  scheduledActionCount = 0,
  onNewProject,
  newChatActive = false,
  listScrolled = false,
}: {
  onNewChat?: () => void;
  onSearch?: () => void;
  onOpenScheduled?: () => void;
  /** Badge count on the 定时 icon; see SidebarNavIcons. */
  scheduledActionCount?: number;
  onNewProject?: () => void;
  /** The main area shows the empty new-chat composer: 新对话 takes the
   * selected-row style (see NewChatButton). */
  newChatActive?: boolean;
  /** The session list below is scrolled away from its top. */
  listScrolled?: boolean;
}) {
  // No divider at rest (2026-10-08): with the list at its top nothing is
  // clipped, and a line there only fenced 新对话 off from the list it
  // heads. Once the list scrolls, rows slide under this row and the line
  // marks the clip edge — the macOS toolbar's scroll-linked separator.
  // The 1px border is always there (transparent at rest), so nothing
  // shifts when it appears.
  return (
    <div
      className={cn(
        "border-b py-1",
        listScrolled ? "border-line/70" : "border-transparent",
      )}
    >
      <div className="mx-1.5 flex items-center gap-0.5">
        <NewChatButton active={newChatActive} onClick={onNewChat} />
        <SidebarNavIcons
          placement="row"
          onSearch={onSearch}
          onOpenScheduled={onOpenScheduled}
          scheduledActionCount={scheduledActionCount}
          onNewProject={onNewProject}
        />
      </div>
    </div>
  );
}

/**
 * 新对话 with its text. Spans the row, or the space left of the icons
 * in the narrow state.
 *
 * It heads the session list as "the next session" (2026-10-08): while
 * the main area shows the empty new-chat composer it carries the same
 * selected style as an open session's row, so the sidebar always has
 * exactly one "you are here" row. After the first message the new
 * session's row takes the selection over and this one returns to rest. The plus is brand-strong so the eye lands on it
 * first: new session = creation = a brand moment, the same brand
 * language as the active-session row — a quiet hierarchy cue, not a
 * CTA block.
 *
 * It is always a plain new chat, like ⌘N (2026-10-09): the escape
 * hatch keeps one destination whatever session is open. From 06-18 it
 * read 「新对话 · 项目名」 and landed in the last entered project — a
 * rule built for the project view, which 10-08 removed — so leaving a
 * project took this row plus the composer hint's ×. A project's new
 * chat is its group row's + (and its menu).
 */
function NewChatButton({
  active = false,
  onClick,
}: {
  active?: boolean;
  onClick?: () => void;
}) {
  const copy = useCopy();
  const language = useLanguage();
  const label = copy.sidebar.newConversation;
  const shortcut = formatShortcut("Mod+N");
  return (
    <IconTooltip
      text={<ShortcutTooltipText label={label} shortcut={shortcut} />}
      side="bottom"
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(
          // min-w: pl-3 + the 16px plus column. Not min-w-0 — at the
          // narrowest widths the row must squeeze the icons, not clip
          // the plus.
          "flex h-8 min-w-[28px] flex-1 items-center gap-2 rounded-sm pl-3 text-left text-[13px] text-ink",
          "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
          // Selected or not, the row answers the pointer: it is an
          // action (clicking it while selected refocuses the composer),
          // unlike a selected session row. Selected hover deepens the
          // fill one hover step (--color-selected-hover, globals.css).
          active
            ? "bg-selected shadow-[var(--shadow-selected)] hover:bg-(--color-selected-hover)"
            : "hover:bg-hover",
          "active:translate-y-px",
          "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        )}
      >
        {/* The session rows' grid (2026-10-08): the 15px plus centred
            in a 16px column like their status icons (centre 26px), gap-2,
            so the label starts on their 42px title edge (it sat at 43). */}
        <span className="flex w-4 shrink-0 justify-center">
          <Plus size={15} weight="bold" className="text-brand-strong" />
        </span>
        {/* The action text shows whole or not at all — never cut in
            half. It can only run out of room in the narrow state, with
            the icons beside it; the thresholds and their arithmetic
            are in sidebar-width.ts (NEW_CHAT_LABEL_HIDDEN). Below them
            the whole label goes and only the plus stays, its tooltip
            carrying the full label. pr-2 sits on the label so it vanishes with it:
            at the 134px minimum the plus needs 28px and the icons
            squeeze to ~29px each. */}
        <span
          className={cn(
            "flex min-w-0 flex-1 pr-2 font-medium",
            language === "en-US"
              ? NEW_CHAT_LABEL_HIDDEN.en
              : NEW_CHAT_LABEL_HIDDEN.zh,
          )}
        >
          <span className="shrink-0">{label}</span>
        </span>
        {/* Row-end ⌘N, only while the row is alone (wide state). pr-3
            ends it 18px from the sidebar edge, on the session rows'
            px-3 text edge. aria-hidden: the button's aria-label is
            the name; the shortcut is a visual hint. */}
        <span
          aria-hidden="true"
          className={cn(
            NEW_CHAT_HINT_DISPLAY,
            "shrink-0 pr-3",
            SHORTCUT_TEXT_CLASS,
          )}
        >
          <ShortcutGlyphs text={shortcut} />
        </span>
      </button>
    </IconTooltip>
  );
}
