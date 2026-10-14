import { getCurrentWindow } from "@tauri-apps/api/window";
import { type ReactNode, useState } from "react";

import {
  AssistantAvatar,
  AssistantAvatarBadge,
} from "@/components/layout/assistant/AssistantAvatar";
import { IconTooltip } from "@/components/ui/tooltip";
import { useAssistantState } from "@/hooks/useAssistantState";
import {
  type AssistantState,
  type AssistantStateKind,
  assistantLabel,
} from "@/lib/assistant";
import { useCopy, useLanguage } from "@/lib/i18n";
import { isMac, isWindowActionTarget } from "@/lib/platform";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { truncationFadeRef } from "@/lib/truncation-fade";
import { cn } from "@/lib/utils";
import type { Session } from "@/types/session";

import { SidebarNavIcons, type SidebarNavItem } from "./SidebarNavIcons";
import { NewChatButton } from "./SidebarQuickActions";
import { SIDEBAR_HEADER_PR } from "./sidebar-width";
import { ASSISTANT_TOP_WIDTHS, type SidebarTopDemo } from "./sidebar-top-trial";

/**
 * The sidebar's top half in ticket 17's variants 2 / 3 / 3′ (TEMPORARY
 * until the ruling; sidebar-top-trial.ts has the variants and removal
 * steps). With a main chat, the assistant — Galley — is the entry on
 * top, and the conversations below open on 「＋ 新对话」:
 *
 *   2   SidebarAssistantMasthead with SidebarAssistantButton in it
 *   3   SidebarAssistantMasthead, then SidebarAssistantCard
 *   3′  the same with the card's big form
 *   all SidebarNewChatRow as the list's sticky first row (Sidebar.tsx)
 *
 * The entry obeys the sidebar's selection language and nothing else:
 * no fill, lift or line at rest; `bg-hover` under the pointer; the three
 * channels of a selected row while the assistant (or one of its
 * subtasks) is open — the selected fill, the lift, full ink (its name
 * is full ink always, like the main chat row's: it is the home).
 * Selection never takes the weight, which a state owns. A selected entry
 * does not answer hover, as a selected session row does not.
 */

const SEARCH_ONLY: readonly SidebarNavItem[] = ["search"];
const ROW_ITEMS: readonly SidebarNavItem[] = ["scheduled", "newProject"];

/** The entry's fill, and the ground its avatar badge is ringed in. */
function entryFill(open: boolean): string {
  return open
    ? "bg-selected shadow-[var(--shadow-selected)] [--assistant-ground:var(--color-selected)]"
    : "[--assistant-ground:var(--color-chrome)] hover:bg-hover hover:[--assistant-ground:var(--color-hover)]";
}

const ENTRY_PRESS =
  "transition-none active:translate-y-px active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm";

/** The badge pops when the state becomes news — a question, an error, a
 * new reply — never on mount (SidebarSessionRow's latch). */
function useBadgePop(kind: AssistantStateKind): boolean {
  const [prevKind, setPrevKind] = useState(kind);
  const [popEnabled, setPopEnabled] = useState(false);
  if (kind !== prevKind) {
    setPrevKind(kind);
    setPopEnabled(true);
  }
  return (
    popEnabled && (kind === "ask" || kind === "error" || kind === "unread")
  );
}

/** The name: full ink always; semibold while it has something to say,
 * as a row's title is for running, unread and the blocking states. */
function nameWeight(state: AssistantState): string {
  return state.kind === "idle" ? "font-medium" : "font-semibold";
}

/** The line under the name: the row subline's register and tones. */
function lineTone(state: AssistantState): string {
  return state.line?.tone === "error"
    ? "font-medium text-error"
    : state.line?.tone === "warning"
      ? "font-medium text-warning"
      : "sidebar-step-tick text-brand-strong/85";
}

interface EntryProps {
  mainChat: Session;
  /** Its unpromoted subtasks. */
  subtasks: Session[];
  /** The main chat, or one of its subtasks, is open. */
  open: boolean;
  demo?: SidebarTopDemo;
  onOpen: () => void;
}

/**
 * 2 and 3 / 3′'s masthead. 2: the entry where the wordmark stood, its
 * box from 80px under the macOS traffic lights so the avatar sits on
 * the wordmark's 88px line (8px box / 16px avatar elsewhere), and 搜索
 * alone on the right, over the rows' `⋯` column; only below 168px under
 * the macOS lights does 搜索 step down into the new-chat row. 3 / 3′:
 * only 搜索. Everything but the buttons drags the window; double-click
 * maximizes off macOS, as on SidebarHeader.
 */
export function SidebarAssistantMasthead({
  entry,
  searchDisplay = "flex",
  onSearch,
}: {
  entry?: ReactNode;
  searchDisplay?: string;
  onSearch?: () => void;
}) {
  return (
    <div
      data-tauri-drag-region
      data-role="assistant-masthead"
      onDoubleClick={(e) => {
        if (isMac) return;
        if (!isWindowActionTarget(e.target)) return;
        try {
          void getCurrentWindow().toggleMaximize();
        } catch {
          // No Tauri host (plain Vite browser dev) — ignore.
        }
      }}
      className={cn(
        "flex h-11 shrink-0 items-center gap-3 border-b border-line/60",
        SIDEBAR_HEADER_PR,
        isMac ? "pl-20" : "pl-2",
      )}
    >
      {entry}
      <SidebarNavIcons
        placement="header"
        items={SEARCH_ONLY}
        display={cn(searchDisplay, "ml-auto")}
        onSearch={onSearch}
      />
    </div>
  );
}

/**
 * 2's entry: avatar and 「Galley」 on one line, one button, 28px tall
 * like the header's other controls. No room for words: every state
 * hangs on the avatar, and the tooltip and the accessible name say it.
 * When the masthead gets too narrow (mac 214px) the name goes first and
 * the avatar stays (sidebar-top-trial.ts).
 */
export function SidebarAssistantButton({
  mainChat,
  subtasks,
  open,
  demo,
  onOpen,
}: EntryProps) {
  const copy = useCopy();
  const state = useAssistantState({ mainChat, subtasks, open, demo });
  const pop = useBadgePop(state.kind);
  const label = assistantLabel(copy.assistant.name, state);
  return (
    <IconTooltip text={label} side="bottom">
      <button
        type="button"
        data-role="assistant-entry"
        data-variant="2"
        data-state={state.kind}
        aria-label={label}
        aria-current={open ? "page" : undefined}
        onClick={onOpen}
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] leading-4 text-ink",
          ENTRY_PRESS,
          "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
          entryFill(open),
        )}
      >
        <span className="relative inline-flex">
          <AssistantAvatar size={20} />
          <AssistantAvatarBadge
            key={state.kind}
            kind={state.kind}
            size={20}
            pop={pop}
          />
        </span>
        <span className={cn(ASSISTANT_TOP_WIDTHS.entryName, nameWeight(state))}>
          {copy.assistant.name}
        </span>
      </button>
    </IconTooltip>
  );
}

/**
 * 3 / 3′'s card, the one thing in the sidebar with an avatar. 3: a
 * 32px avatar on the rows' 18px line, 「Galley」 (14px, a step over a
 * row's 13px) and the line under it; at rest the name alone, centred
 * on the avatar. 3′: a 48px avatar centred, the name under it, the line
 * under that. Fixed heights (58px, 112px) so the list below never moves
 * as the line comes and goes; the contents re-centre instead, as the
 * main chat row's title does.
 *
 * What keeps it from reading as a session row is its own anatomy — an
 * avatar where rows have a 14px status glyph, a bigger name, more
 * height, the 12px card radius where rows have 6px — and its place:
 * on the chrome above the strong line, the list below on the app
 * ground. Not a border or a resting fill / shadow: fill and lift are
 * selection's channels in the sidebar, so a card that wore them at rest
 * would read as selected, and a border is one more line between the
 * masthead's and the strong one.
 */
export function SidebarAssistantCard({
  variant,
  mainChat,
  subtasks,
  open,
  demo,
  onOpen,
}: EntryProps & { variant: "3" | "3′" }) {
  const copy = useCopy();
  const state = useAssistantState({ mainChat, subtasks, open, demo });
  const pop = useBadgePop(state.kind);
  const label = assistantLabel(copy.assistant.name, state);
  const big = variant === "3′";
  const avatarSize = big ? 48 : 32;
  return (
    <button
      type="button"
      data-role="assistant-entry"
      data-variant={variant}
      data-state={state.kind}
      aria-label={label}
      aria-current={open ? "page" : undefined}
      onClick={onOpen}
      className={cn(
        "mx-1.5 flex w-[calc(100%-12px)] rounded-md px-3 text-left text-ink",
        big
          ? "h-[112px] flex-col items-center justify-center"
          : "h-[58px] items-center gap-2.5",
        ENTRY_PRESS,
        "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        entryFill(open),
      )}
    >
      <span className="relative inline-flex shrink-0">
        <AssistantAvatar size={avatarSize} />
        <AssistantAvatarBadge
          key={state.kind}
          kind={state.kind}
          size={avatarSize}
          pop={pop}
        />
      </span>
      <span
        className={cn(
          "flex min-w-0 flex-col",
          big ? "mt-1.5 max-w-full items-center" : "flex-1",
        )}
      >
        <span
          className={cn(
            "max-w-full truncate text-[14px] leading-5",
            nameWeight(state),
          )}
        >
          {copy.assistant.name}
        </span>
        {state.line && (
          <span
            key={`${state.kind}:${state.line.text}`}
            data-role="assistant-status-line"
            ref={truncationFadeRef}
            // A cut line gets its full text as a native title, as a row's
            // subline does (only while it is actually cut).
            onPointerEnter={(e) =>
              syncTruncatedTitle(e.currentTarget, state.line?.text ?? "")
            }
            className={cn(
              "truncate-fade mt-0.5 max-w-full text-[11px] leading-[1.4] tabular-nums",
              lineTone(state),
            )}
          >
            {state.line.text}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * The list's first row in 2 / 3 / 3′: the external runtime's 「＋ 新对话
 * ⌘N」 button (NewChatButton) with 定时 and 新建项目 at the row's end —
 * 2 adds 搜索 before them once its masthead cannot hold it (mac under
 * 168px). pr-1 puts the last icon's centre over the rows' `⋯` column
 * (26px from the edge), under the masthead's 搜索. `lit` while the empty
 * new-chat composer is up: the sidebar's one "you are here", until the
 * first send's row takes over. The label and the ⌘N hide whole on their
 * own widths (sidebar-top-trial.ts).
 */
export function SidebarNewChatRow({
  variant,
  lit,
  onNewChat,
  onSearch,
  onOpenScheduled,
  scheduledActionCount = 0,
  onNewProject,
}: {
  variant: "2" | "3" | "3′";
  lit: boolean;
  onNewChat?: () => void;
  onSearch?: () => void;
  onOpenScheduled?: () => void;
  scheduledActionCount?: number;
  onNewProject?: () => void;
}) {
  const language = useLanguage();
  const widths = ASSISTANT_TOP_WIDTHS;
  return (
    <div
      data-role="sidebar-new-chat-row"
      className="mx-1.5 flex items-center gap-0.5 pr-1"
    >
      <NewChatButton
        active={lit}
        onClick={onNewChat}
        display={{ label: widths.label, hint: widths.hint[language] }}
      />
      {variant === "2" && widths.rowSearch !== "hidden" && (
        <SidebarNavIcons
          placement="row"
          items={SEARCH_ONLY}
          display={widths.rowSearch}
          onSearch={onSearch}
        />
      )}
      <SidebarNavIcons
        placement="row"
        items={ROW_ITEMS}
        display="flex"
        onOpenScheduled={onOpenScheduled}
        scheduledActionCount={scheduledActionCount}
        onNewProject={onNewProject}
      />
    </div>
  );
}

/** The list's line while nobody has started a conversation: the old
 * sidebar's words (「你的对话会出现在这里。」) in the section hint's
 * place — 2 / 3 / 3′ no longer say 主对话 anywhere in the sidebar. */
export function SidebarAssistantEmptyHint() {
  const copy = useCopy();
  return (
    <p className="mx-1.5 px-3 py-2 text-[12.5px] italic text-ink-muted">
      {copy.sidebar.emptySessions}
    </p>
  );
}
