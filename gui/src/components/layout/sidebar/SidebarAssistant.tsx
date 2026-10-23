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
import {
  useAssistantRound,
  useAssistantRunMinutes,
} from "@/hooks/useAssistantProgress";
import { useAssistantTyping } from "@/hooks/useAssistantSentence";
import { useDayStamp } from "@/hooks/useDayStamp";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  type AssistantCardLine,
  type AssistantStateKind,
  assistantCardLine,
} from "@/lib/assistant";
import { useCopy, useLanguage } from "@/lib/i18n";
import { formatListTime } from "@/lib/message-time";
import { truncationFadeRef } from "@/lib/truncation-fade";
import { cn } from "@/lib/utils";
import { signalAssistantLook } from "@/stores/assistant-face";
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
 * without its wordmark) the assistant, Galley, stands on its stage —
 * SidebarAssistantCard, on the chrome above the strong line —
 * and the conversations below open on SidebarNewChatRow, the scrolling
 * list's sticky first row on the app ground (Sidebar.tsx).
 */

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

/** The card's edge and fill, and the ground its avatar badge is ringed
 * in (main chat PRD ruling 122). At rest a faint line inside its edge
 * (`line-strong` at 60%, an inset ring: the box keeps its size and the
 * focus ring its look) makes the card a thing, not a stretch of the
 * chrome; hover fills it with `bg-hover`. Selected it takes a selected
 * row's fill, without the lift, the line one step deeper in that hue,
 * and does not answer hover: selected must outweigh hover (globals.css
 * records the same fault on rows, 08-21), and the card opens on
 * pointerdown, so the fill comes in under the press instead of the
 * hover fill going out. Held down, the fill deepens a step. */
function stageFill(selected: boolean): string {
  return selected
    ? "bg-selected [--assistant-ground:var(--color-selected)] inset-ring inset-ring-(--color-selected-hover) active:bg-(--color-selected-hover) active:[--assistant-ground:var(--color-selected-hover)]"
    : "[--assistant-ground:var(--color-chrome)] inset-ring inset-ring-line-strong/60 hover:bg-hover hover:[--assistant-ground:var(--color-hover)]";
}

/** Runs `fn` once the pending frame is painted: the next animation
 * frame, then a task after it. A hidden page runs no frames, so a
 * timeout runs it regardless; whichever comes first wins. */
function afterPaint(fn: () => void): void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  requestAnimationFrame(() => setTimeout(run, 0));
  setTimeout(run, 100);
}

/** The stage's avatar and badges, with the narrow sidebar's smaller
 * avatar by container query — one avatar box, its size switched; the
 * badge for each size, one shown. 72px from a 184px sidebar, 48px under
 * it (ticket 42's old masthead threshold): under 184 a 72px face takes
 * over two fifths of the card's width and the zone reads as a poster,
 * not the head of a list. The avatar's slot stays 72px high, so
 * crossing it never moves the list. */
const STAGE_AVATAR = {
  size: 72,
  narrow: 48,
  box: "size-12 @min-[184px]/sidebar:size-18",
  wide: "hidden @min-[184px]/sidebar:inline-flex",
  tight: "@min-[184px]/sidebar:hidden",
} as const;

function lineText(line: AssistantCardLine): string {
  return "prefix" in line && line.prefix
    ? `${line.prefix}${line.text}`
    : line.text;
}

/**
 * The assistant's card, a stage (main chat PRD rulings 118, 119; ticket
 * 67): its face, 72px, centred — the avatar that moves (AssistantFace:
 * the app icon in a circle, ruling 70, alive by foundations.md §2.7's
 * exemption) — and under it 「Galley」 at 14px with the time of the
 * last message small after it, then one line, as an IM chat list's
 * second line (ruling 65) —
 *
 *   error > a question (「等你回复：」 + the question itself) > running
 *   (「正在工作…」) > an unsent draft (「草稿：」) > the last message
 *   (「你：」 for the user's own)
 *
 * (lib/assistant.ts). Running, it says only what the screen does not
 * (main chat PRD rulings 134, 135): in a round you started 「正在工作…」
 * with the main chat on screen (the dots and the line under them are
 * right there); away from it 「正在输入…」 while it writes, else
 * 「正在工作…」, from a minute on 「正在工作 · N 分钟」. In a round Core
 * woke it for 「正在输入…」 only while the conversation shows its dots,
 * else the last message (rulings 107, 110). With the main chat itself on
 * screen the card is the sidebar's selected place and otherwise says
 * only the last message, whatever the state — the question when it asks
 * (ruling 104, overturning ruling 87's 「等你回复」 there); the badge and
 * the name's weight carry the state, the header and the conversation the
 * words. One of its subtasks open is not the main chat on screen. The
 * avatar wears a session row's status glyph in its corner for a
 * question, an error and a new reply — and for running only under
 * reduced motion, where the face holds still (ruling 117 point 8); the
 * name goes semibold for those; a draft and the resting card stay
 * medium. A new reply shows only while the main chat is not on screen.
 *
 * The time is the last message's (lib/message-time.ts `formatListTime`:
 * 11:50 / 昨天 / 周一 / 10月7日 / 2025年10月7日), the session's last
 * activity when no message is at hand, re-dated at midnight
 * (`useDayStamp`).
 *
 * The face's slot is a fixed 72px high and the name's line 20px, so a
 * second line that changes never moves the list (128.8px with it; with
 * none, before any message, 110px). A faint line inside its edge at
 * rest, `bg-hover` under the pointer; selected, a selected row's fill
 * and the name in full ink (`stageFill`, ruling 122). The pointer coming
 * onto it is a look for the face (`signalAssistantLook`). It opens on
 * pointerdown like a session row (the click that follows is swallowed);
 * Enter and Space open it as any button. Pressed it goes 1px down and to
 * 98%, eased over `--motion-press`: a row's 1px alone is lost on a card
 * three rows high. Tailwind v4 writes both as the `translate` and
 * `scale` properties, which a `transform` transition does not reach.
 */
export function SidebarAssistantCard({
  mainChat,
  subtasks,
  selected,
  open,
  onOpen,
}: {
  mainChat: Session;
  /** Its unpromoted subtasks. */
  subtasks: Session[];
  /** The main chat, or one of its subtasks, is open: the card is the
   * selected place in the sidebar. */
  selected: boolean;
  /** The main chat itself is open: its conversation is on screen. */
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
  // Running, a round Core woke it for says 「正在输入…」 only while the
  // conversation shows its dots, else the last message, the live round's
  // steps skipped (rulings 107, 110).
  const typing = useAssistantTyping(mainChat.id, state.kind === "running");
  // A round you started says 「正在工作…」; away from the main chat
  // 「正在输入…」 while it writes and the whole minutes from one on
  // (rulings 134, 135). The minutes re-render the card only when one
  // turns.
  const round = useAssistantRound(mainChat.id, state.kind === "running");
  const ownRound = round === "own" || round === "own-writing";
  const minutes = useAssistantRunMinutes(mainChat.id, ownRound);
  const working = ownRound
    ? { writing: round === "own-writing", minutes }
    : undefined;
  const lastMessage = useAssistantLastMessage(mainChat);
  const line = assistantCardLine(
    state,
    { question, draft, lastMessage, open, typing, working },
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
  // Opens on pointerdown, as a session row does, but once the press is
  // on screen (`afterPaint`): mounting the main chat holds the main
  // thread for a fifth of a second, and opened in the same task the
  // press would show only after it (main chat PRD ruling 123). The
  // click that press produces is swallowed. A plain flag: every click
  // follows a pointerdown that re-arms it (SidebarSessionRow).
  const ignoreNextClickRef = useRef(false);
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    // macOS Ctrl-click is the context-menu gesture.
    if (event.button !== 0 || event.ctrlKey) return;
    ignoreNextClickRef.current = true;
    afterPaint(onOpen);
  };
  const handleClick = () => {
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      return;
    }
    onOpen();
  };
  // Under reduced motion the face holds still, so the spinner comes back
  // while it runs (ruling 117 point 8): a woken round says the last
  // message on the second line, and the spinner is then its one sign.
  const reducedMotion = usePrefersReducedMotion();
  return (
    <button
      type="button"
      data-role="assistant-card"
      data-state={state.kind}
      aria-label={label}
      aria-current={selected ? "page" : undefined}
      onPointerDown={handlePointerDown}
      onPointerEnter={signalAssistantLook}
      onClick={handleClick}
      className={cn(
        "mx-1.5 flex w-[calc(100%-12px)] flex-col items-center rounded-md px-3 pb-1.5 pt-1.5 text-center text-ink",
        "transition-none active:translate-y-px active:scale-[0.98] active:transition-[translate,scale,box-shadow] active:duration-(--motion-press) active:ease-firm",
        "outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        stageFill(selected),
      )}
    >
      <span className="flex h-18 items-center justify-center">
        <span className="relative inline-flex shrink-0">
          <AssistantAvatar
            size={STAGE_AVATAR.size}
            animated
            className={STAGE_AVATAR.box}
          />
          {[STAGE_AVATAR.narrow, STAGE_AVATAR.size].map((size) => (
            <AssistantAvatarBadge
              key={`${size}:${state.kind}`}
              kind={state.kind}
              size={size}
              pop={pop}
              faceRuns={!reducedMotion}
              className={
                size === STAGE_AVATAR.size
                  ? STAGE_AVATAR.wide
                  : STAGE_AVATAR.tight
              }
            />
          ))}
        </span>
      </span>
      {/* The name, the time small after it, the pair centred. The time
          yields whole: when one line cannot hold the name and the time,
          the time wraps onto a second row this 20px box clips, so
          「Galley」 is never cut for it, nor the time in half.
          Unselected the name steps back to ink-soft, selected it takes
          the full ink. */}
      <span
        className={cn(
          "mt-1.5 flex h-5 min-w-0 max-w-full flex-wrap items-baseline justify-center gap-x-1.5 overflow-hidden",
          selected ? "text-ink" : "text-ink-soft",
        )}
      >
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
          // Cut lines fade like a row's subline. No title with the full
          // text (main chat PRD ruling 75): it is the last message, often
          // hundreds of characters, and the card opens it in full one
          // click away; IM chat lists don't preview on hover. The card's
          // aria-label still carries the whole line.
          ref={truncationFadeRef}
          className={cn(
            "truncate-fade mt-0.5 max-w-full text-[12px] leading-[1.4] tabular-nums",
            lineTone(line),
          )}
        >
          {"prefix" in line && line.prefix && (
            <span className={prefixTone(line)}>{line.prefix}</span>
          )}
          {line.text}
        </span>
      )}
    </button>
  );
}

/**
 * The list's first row with a main chat: the external runtime's 「＋ 新
 * 对话 ⌘N」 button alone (NewChatButton), the conversations' one way in
 * (ruling 64). `lit` while the empty new-chat composer is up — a
 * project's too — until the first send's row takes over: the selected
 * row's channels, the sidebar's one "you are here". On macOS below the
 * masthead's 152px the masthead's two icons (搜索, 新建项目) come down
 * into this row, the external runtime's one-row layout; the row is there
 * either way, so the list never moves (sidebar-width.ts).
 */
export function SidebarNewChatRow({
  lit,
  onNewChat,
  onSearch,
  onNewProject,
}: {
  lit: boolean;
  onNewChat?: () => void;
  onSearch?: () => void;
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
        onNewProject={onNewProject}
        scheduled={false}
      />
    </div>
  );
}

/** The list's line while nobody has started a conversation (agent-started
 * sessions in 「其他来源」 do not count):
 * 「工作台：你另开的对话会出现在这里。」, the old sidebar's line and
 * style with the workbench's name in front.
 * It is the one place the name is said (ruling 121): the line under the
 * card carries none, and the word explains the list only while there is
 * nothing in it yet; it goes with the line when the first conversation
 * comes. The external runtime's empty list keeps the old words
 * (emptySessions, Sidebar). */
export function SidebarAssistantEmptyHint() {
  const copy = useCopy();
  return (
    <p className="mx-1.5 px-3 py-2 text-[12.5px] italic text-ink-muted">
      {copy.sidebar.emptyWorkbench}
    </p>
  );
}
