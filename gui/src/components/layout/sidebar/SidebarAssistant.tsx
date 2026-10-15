import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  AssistantAvatar,
  AssistantAvatarBadge,
} from "@/components/layout/assistant/AssistantAvatar";
import {
  useAssistantLastMessage,
  useAssistantState,
  useComposerDraft,
  usePendingQuestion,
} from "@/hooks/useAssistantState";
import { useDayStamp } from "@/hooks/useDayStamp";
import {
  type AssistantCardLine,
  type AssistantStateKind,
  assistantCardLine,
} from "@/lib/assistant";
import { useCopy, useLanguage } from "@/lib/i18n";
import { formatListTime } from "@/lib/message-time";
import { syncTruncatedTitle } from "@/lib/truncated-title";
import { truncationFadeRef } from "@/lib/truncation-fade";
import { cn } from "@/lib/utils";
import type { Session } from "@/types/session";

import {
  ASSISTANT_NEW_CHAT_HINT_DISPLAY,
  ASSISTANT_NEW_CHAT_LABEL_HIDDEN,
  ASSISTANT_ROW_NAV_ICONS_DISPLAY,
} from "./sidebar-width";
import { SidebarNavIcons } from "./SidebarNavIcons";
import { NewChatButton } from "./SidebarQuickActions";

/**
 * The managed runtime's sidebar top, with a main chat (main chat PRD
 * rulings 60–65, ticket 18). Under the masthead (SidebarHeader
 * without its wordmark) the assistant, Galley, is one row of an IM chat
 * list — SidebarAssistantCard, on the chrome above the strong line —
 * and the conversations below open on SidebarNewChatRow, the scrolling
 * list's sticky first row on the app ground (Sidebar.tsx).
 */

/** The card's fill, and the ground its avatar badge is ringed in. A
 * selected card does not answer hover, as a selected session row does
 * not. */
function cardFill(open: boolean): string {
  return open
    ? "bg-selected shadow-[var(--shadow-selected)] [--assistant-ground:var(--color-selected)]"
    : "[--assistant-ground:var(--color-chrome)] hover:bg-hover hover:[--assistant-ground:var(--color-hover)]";
}

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

/** The second line's prefix, in its state's colour: the amber of 「等你
 * 回复：」, the brand of 「草稿：」 (red is for errors), the line's own
 * muted ink for 「你：」. */
function prefixTone(line: AssistantCardLine): string {
  return line.kind === "ask"
    ? "font-medium text-warning"
    : line.kind === "draft"
      ? "font-medium text-brand-strong"
      : "";
}

/** A line without a prefix takes its state's colour whole — a session
 * row subline's tones; a quoted question, a draft or a message reads in
 * the line's muted ink. */
function lineTone(line: AssistantCardLine): string {
  switch (line.kind) {
    case "error":
      return "font-medium text-error";
    case "running":
      return "sidebar-step-tick text-brand-strong/85";
    case "ask":
      return line.prefix ? "text-ink-muted" : "font-medium text-warning";
    default:
      return "text-ink-muted";
  }
}

function lineText(line: AssistantCardLine): string {
  return "prefix" in line && line.prefix
    ? `${line.prefix}${line.text}`
    : line.text;
}

/**
 * The assistant's card: one row of an IM chat list (ruling 65). A 40px
 * avatar on the rows' 18px line (the app icon in a circle, ruling 70); 「Galley」
 * at 14px with the time of the last message on the right, 11px muted
 * like the list's counts; under them one line —
 *
 *   error > a question (「等你回复：」 + the question itself) > running >
 *   an unsent draft (「草稿：」, only while the assistant is not open) >
 *   the last message (「你：」 for the user's own)
 *
 * (lib/assistant.ts). The avatar wears a session row's status glyph in
 * its corner for running, a question, an error and a new reply, and the
 * name goes semibold for those; a draft and the resting card stay
 * medium. A new reply shows only while the assistant is not open.
 *
 * The time is the last message's (lib/message-time.ts `formatListTime`:
 * 11:50 / 昨天 / 周一 / 10月7日 / 2025年10月7日), the session's last
 * activity when no message is at hand, re-dated at midnight
 * (`useDayStamp`).
 *
 * Fixed 58px, so a line that changes or goes never moves the list.
 * No border, and no fill or lift at rest — fill and lift are selection's
 * channels in the sidebar; `bg-hover` under the pointer; the three
 * selected channels while the assistant or one of its subtasks is open;
 * the 12px card radius where rows have 6px. It opens on pointerdown
 * like a session row (the click that follows is swallowed); Enter and
 * Space open it as any button.
 */
export function SidebarAssistantCard({
  mainChat,
  subtasks,
  open,
  onOpen,
}: {
  mainChat: Session;
  /** Its unpromoted subtasks. */
  subtasks: Session[];
  /** The main chat, or one of its subtasks, is open. */
  open: boolean;
  onOpen: () => void;
}) {
  const copy = useCopy();
  const language = useLanguage();
  const dayStamp = useDayStamp();
  const state = useAssistantState({ mainChat, subtasks, open });
  const question = usePendingQuestion(mainChat.id);
  // No key while it is open: its draft is in the composer right there,
  // and typing there then never re-renders the card.
  const draft = useComposerDraft(open ? undefined : mainChat.id);
  const lastMessage = useAssistantLastMessage(mainChat);
  const line = assistantCardLine(
    state,
    { question, draft, lastMessage, open },
    copy,
  );
  const time = formatListTime(
    lastMessage?.sentAt ?? mainChat.lastActivityAt,
    dayStamp,
    language,
    { yesterday: copy.assistant.timeYesterday },
  );
  const pop = useBadgePop(state.kind);
  const fullLine = line ? lineText(line) : null;
  const label = [
    copy.assistant.name,
    state.kind === "unread" ? copy.sidebar.newReplyTitle : null,
    fullLine,
  ]
    .filter(Boolean)
    .join(" · ");
  // Opens on pointerdown, as a session row does; the click that press
  // produces is swallowed. A plain flag: every click follows a
  // pointerdown that re-arms it (SidebarSessionRow).
  const ignoreNextClickRef = useRef(false);
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    // macOS Ctrl-click is the context-menu gesture.
    if (event.button !== 0 || event.ctrlKey) return;
    ignoreNextClickRef.current = true;
    onOpen();
  };
  const handleClick = () => {
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      return;
    }
    onOpen();
  };
  return (
    <button
      type="button"
      data-role="assistant-card"
      data-state={state.kind}
      aria-label={label}
      aria-current={open ? "page" : undefined}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className={cn(
        "mx-1.5 flex h-[58px] w-[calc(100%-12px)] items-center gap-2.5 rounded-md px-3 text-left text-ink",
        "transition-none active:translate-y-px active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
        "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        cardFill(open),
      )}
    >
      <span className="relative inline-flex shrink-0">
        <AssistantAvatar size={40} />
        <AssistantAvatarBadge
          key={state.kind}
          kind={state.kind}
          size={40}
          pop={pop}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        {/* The time yields whole: when one line cannot hold the name and
            the time, the time wraps onto a second row this 20px box
            clips, so 「Galley」 is never cut for it, nor the time in
            half. The line is the sidebar less 86px (mx-1.5, px-3, the
            avatar, gap-2.5): 「11:50」 shows from a 167px sidebar, an
            English 「11:50 AM」 from 188px (Chrome). */}
        <span className="flex h-5 min-w-0 flex-wrap items-baseline justify-between gap-x-2 overflow-hidden">
          <span
            className={cn(
              "min-w-0 truncate text-[14px] leading-5",
              state.kind === "idle" ? "font-medium" : "font-semibold",
            )}
          >
            {copy.assistant.name}
          </span>
          {time && (
            <span
              data-role="assistant-time"
              className="shrink-0 text-[11px] leading-5 tabular-nums text-ink-muted"
            >
              {time}
            </span>
          )}
        </span>
        {line && (
          <span
            key={`${line.kind}:${fullLine}`}
            data-role="assistant-card-line"
            data-kind={line.kind}
            // Cut lines fade like a row's subline and get their full
            // text as a native title, only while actually cut.
            ref={truncationFadeRef}
            onPointerEnter={(e) =>
              syncTruncatedTitle(e.currentTarget, fullLine ?? "")
            }
            className={cn(
              "truncate-fade mt-0.5 text-[12px] leading-[1.4] tabular-nums",
              lineTone(line),
            )}
          >
            {"prefix" in line && line.prefix && (
              <span className={prefixTone(line)}>{line.prefix}</span>
            )}
            {line.text}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * The list's first row with a main chat: the external runtime's 「＋ 新
 * 对话 ⌘N」 button alone (NewChatButton), the conversations' one way in
 * (ruling 64). `lit` while the empty new-chat composer is up — a
 * project's too — until the first send's row takes over: the selected
 * row's channels, the sidebar's one "you are here". On macOS below the
 * masthead's 184px the masthead's three icons come down into this row,
 * the external runtime's one-row layout; the row is there either way,
 * so the list never moves (sidebar-width.ts).
 */
export function SidebarNewChatRow({
  lit,
  onNewChat,
  onSearch,
  onOpenScheduled,
  scheduledActionCount = 0,
  onNewProject,
}: {
  lit: boolean;
  onNewChat?: () => void;
  onSearch?: () => void;
  onOpenScheduled?: () => void;
  scheduledActionCount?: number;
  onNewProject?: () => void;
}) {
  const language = useLanguage();
  return (
    <div
      data-role="sidebar-new-chat-row"
      className="mx-1.5 flex items-center gap-0.5"
    >
      <NewChatButton
        active={lit}
        onClick={onNewChat}
        display={{
          label: ASSISTANT_NEW_CHAT_LABEL_HIDDEN,
          hint: ASSISTANT_NEW_CHAT_HINT_DISPLAY[
            language === "en-US" ? "en" : "zh"
          ],
        }}
      />
      <SidebarNavIcons
        placement="row"
        display={ASSISTANT_ROW_NAV_ICONS_DISPLAY}
        onSearch={onSearch}
        onOpenScheduled={onOpenScheduled}
        scheduledActionCount={scheduledActionCount}
        onNewProject={onNewProject}
      />
    </div>
  );
}

/** The list's line while nobody has started a conversation: the old
 * sidebar's words (「你的对话会出现在这里。」); agent-started sessions
 * in 「其他来源」 do not count. */
export function SidebarAssistantEmptyHint() {
  const copy = useCopy();
  return (
    <p className="mx-1.5 px-3 py-2 text-[12.5px] italic text-ink-muted">
      {copy.sidebar.emptySessions}
    </p>
  );
}
