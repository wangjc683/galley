import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  CaretDown,
  CaretUp,
  Check,
  Copy,
  House,
  PlugsConnected,
} from "@phosphor-icons/react";
import { useEffect, memo, useMemo, useRef, useState } from "react";

import { ActionChip } from "@/components/conversation/ActionChip";
import { MessageQuotes } from "@/components/conversation/MessageQuotes";
import {
  ImagePreviewDialog,
  type ImagePreviewItem,
} from "@/components/conversation/ImagePreviewDialog";
import { IconTooltip } from "@/components/ui/tooltip";
import { splitQuotedMessage } from "@/lib/composer-quote";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";
import type { MessageAttachment, Origin } from "@/types/conversation";

/**
 * User message — a flat apricot bubble in the document column.
 *
 * Per DESIGN.md §4.3 (bubble decision 2026-09-17; supersedes the
 * 2026-08-06 highlighter strokes, which in turn replaced the
 * 2026-05-14 callout slab):
 *   - The user's words sit in a rounded (`rounded-md`, 12px), flat
 *     `bg-brand-tint` container — the "user in a container, assistant
 *     in prose" shape every chat product the user already knows uses.
 *     Three rounds of "still feels stiff / hard / flat" (08-05, 08-06,
 *     08-21) never settled the highlighter metaphor, and the bubble
 *     form itself had never been A/B'd. 2026-09-17 live test:
 *     highlighter vs left bubble vs right bubble, 12 vs 16px radius —
 *     left bubble at 12 won.
 *   - RIGHT-aligned, width by content up to `min(80%, 560px)` — about
 *     37 CJK characters a line, a phone-IM measure; in the 1200px wide
 *     mode it keeps the same 560px instead of stretching, and the 80%
 *     only bites in a column under 700px. The assistant's conversation
 *     put it there first (main chat PRD rulings 66, 67); the workbench
 *     follows since 2026-10-16 (workbench conversation PRD ruling 2:
 *     one grammar, density by relationship). Until then the workbench
 *     kept it left, flush with the column, for one reading edge and to
 *     stay off the question rail. Neither holds up: the user's words
 *     run 19 characters at the median, so the eye's trip across is
 *     short, and the bubble keeps off the rail by its own inset
 *     (RAIL_CLEARANCE). Text indents by the padding like a callout.
 *     The provenance row and the expand toggle follow it right.
 *   - NO border, NO shadow. Content is paper, chrome is material
 *     (2026-08-21): elevation is control vocabulary in Galley. Flat
 *     fill is what keeps this a callout, not a card.
 *   - 12px, not 16: a one-line message is ~45px tall, so 16 turns
 *     "好" / "继续" into a pill and slides into chip vocabulary. 12
 *     matches ToolCallout — machine and human boxes equally rounded,
 *     which retires the 08-06 "machine round, human square" inversion
 *     the other way.
 *   - font-sans 15px medium — unchanged. The 2026-06-20 size/weight
 *     unification with the agent answer body still holds: color
 *     carries the turn distinction. Whether the container makes the
 *     weight contrast redundant is a separate re-review, not bundled.
 *   - `whitespace-pre-wrap break-words` — preserves the `\n`s in
 *     pasted content and lets long Chinese / URL / token strings break
 *     inside words rather than overflowing. Blank lines now stay
 *     inside the container (the highlighter left them unpainted and
 *     split a pasted message into pieces — one of the concrete gaps
 *     the bubble closes).
 *
 * Quotes (telegram-details ticket 07): a message that opens with
 *   Markdown quotes (what the composer's quote strip sends) has them
 *   drawn at the top of the bubble, apart from your words, by
 *   MessageQuotes (ticket 08 settled it inside the bubble).
 *   Only your words count toward the collapse below; the hover copy
 *   copies the message whole, quotes and all.
 *
 * Long-content collapse (≥7 lines or >500 chars):
 *   Collapsed by default to 6 lines via `line-clamp` — a clean
 *   line-boundary truncation, no fade-out gradient mask. Toggle
 *   button below the bubble switches between "展开（共 N 行）"
 *   and "收起". Saves screen real-estate in conversations where
 *   the user pasted a long prompt / stack trace / document.
 *
 * Send time (2026-09-28, message-timestamps PRD):
 *   Always visible, and only at a break. A break is the session's
 *   first user message; more than 60 minutes since the previous user
 *   message (ask_user replies count as user messages); a change of
 *   local day (a backstop, so 「今天 / 昨天」 never goes missing — 0
 *   cases in the data); or a Supervisor-originated message, whose
 *   provenance row is there anyway. Dogfood data
 *   (workbench.db, 2026-05-15 → 09-23): 95% of sessions asked every
 *   question on one day, and 21 of 285 gaps between questions ran past
 *   an hour. Rules and label format live in lib/message-time.ts;
 *   Conversation computes them once and draws the time as a centred
 *   line of its own before the message (MessageTimeDivider): it
 *   belongs to the conversation, not to the bubble. Until 2026-10-16
 *   the workbench put it on a row above the bubble, left-aligned,
 *   shared with the Supervisor icon; the icon stays above the bubble,
 *   on the right.
 *   A time on hover for every other message, riding the copy chip,
 *   was cut in the first live test (2026-09-28) — JC:
 *   「有点吵，也没有必要」.
 *   Only user messages carry a time, not answers: the same rule
 *   applied to answers fires 0 times in 409 runs; the answer action
 *   bar was always visible when this was decided, so a time there
 *   would have meant a time on every answer (the bar went hover-only
 *   later the same day); and the gaps all come from the user leaving
 *   and coming back. The completion time of long unattended runs
 *   (overnight runs, scheduled tasks) is deferred.
 *
 * Message actions:
 *   Supervisor provenance renders as a small icon in the row above the
 *   block; its tooltip names the source only (the relative time it
 *   used to carry retired with the pinned send time, 2026-09-28).
 *   Copy is a transient chip that fades in on hover UNDER the bubble,
 *   its right edge on the bubble's right edge, 6px below it — the
 *   reply's action row geometry (2026-10-16; until then it hung just
 *   outside the bubble's bottom-right corner, and the top-right before
 *   2026-09-18). With the bubble on the right, that corner faced the
 *   question rail. Hidden, it keeps its place, and that row (6 + 24 =
 *   30px) is the gap to whatever comes next — see the render site. It
 *   copies the full text, a collapsed long message included: that is
 *   why the workbench keeps it (main chat ruling 73 item 4; the
 *   workbench is where long documents and prompts get pasted). The
 *   assistant's conversation has none (`selectionCopy`). It wears the
 *   BARE chip skin, not the bordered one. Mouse leave delays hiding
 *   briefly so the user can move from the message body to the action
 *   without chasing it.
 *
 * `data-role="user-msg"` is a stable anchor that MainView's scroll
 * effect uses to find the just-submitted user message and snap its
 * top edge to ~32px below the viewport top. Don't rename without
 * updating MainView's selector + UserQuestionRail's selector.
 */
const COLLAPSE_LINE_THRESHOLD = 6;
const COLLAPSE_CHAR_THRESHOLD = 500;
// The chip sits a few pixels off the block, so the pointer never has to
// travel to reach it. 1800ms was sized for a longer trip and left a
// visible tail hanging after the mouse had already moved on.
const ACTION_HIDE_DELAY_MS = 600;
const COPY_FEEDBACK_MS = 1500;

/**
 * The bubble keeps 8px off the question rail's hit area (12–32px from
 * the main area's right edge, the scroll container's `px-8` gutter):
 * when the column fills the area — a small window, or the wide reading
 * width in one not wide enough — its right edge would otherwise land
 * on the rail's edge. `100cqw` is the scroll container's content width
 * (MainView makes it the `conversation` container in the workbench) and
 * `--conversation-column` the column's cap, so `(100cqw − cap) / 2` is
 * the column's own margin: the inset makes up whatever of 8px it lacks
 * and is 0 once the window is 16px wider than the column needs. The
 * reply prose keeps the full column. On Windows the scrollbar lane
 * already sits between the content edge and the rail, so there the
 * bubble keeps 18px. Only where there is a rail: the assistant's
 * conversation has none and takes its row from `rowClassName`.
 */
const RAIL_CLEARANCE =
  "mr-[clamp(0px,calc(8px-(100cqw-var(--conversation-column,100cqw))/2),8px)]";

export interface MessageUserProps {
  content: string;
  attachments?: MessageAttachment[];
  /**
   * Audit origin for this user message (B4 M7). When `origin.via ===
   * "supervisor"`, a small provenance icon renders above the bubble;
   * `subtask` (a subtask's instructions, written by the main chat —
   * ticket 06a) gets the main chat's house there. Other via
   * values (gui / cli / system) render no annotation — the default
   * Galley-driven origin shouldn't interrupt the reading flow.
   */
  origin?: Origin;
  /**
   * True for a mid-run reply to an agent ask_user question
   * (conversation-run-fold). Switches the DOM anchor to
   * `data-role="user-msg-reply"`: the question rail and ⌥↑/⌥↓ index
   * run-opening `user-msg` nodes only, and a reply's node coming and
   * going with the fold must not shift their data↔DOM alignment. The
   * submit-snap selector matches both roles so replying still snaps.
   */
  askUserReply?: boolean;
  /** Persisted `messages.id`; rendered as `data-message-id` on the
   * anchor block so a palette full-text hit can scroll to it. */
  messageId?: string;
  /** The assistant's conversation: no hover copy (main chat PRD ruling
   * 73): a chip floating in the empty gutter beside the bubble belonged
   * to nothing, and under it a chip would cover the next message of a
   * burst, 4px below. Selecting the bubble's text brings up the
   * floating copy instead (SelectionCopyToolbar, scope `user-message`),
   * which copies exactly this plain text. The workbench keeps the hover
   * copy: long pastes collapse there, and a selection cannot reach the
   * collapsed text. */
  selectionCopy?: boolean;
  /** The row's vertical margin in place of the workbench's `mt-5` and
   * copy row (the assistant's IM grouping,
   * lib/assistant-conversation.ts `assistantRowGap`). */
  rowClassName?: string;
}

export const MessageUser = memo(function MessageUser({
  content,
  attachments = [],
  origin,
  askUserReply = false,
  messageId,
  selectionCopy = false,
  rowClassName,
}: MessageUserProps) {
  const copy = useCopy();
  const { quotes, body } = useMemo(
    () => splitQuotedMessage(content),
    [content],
  );
  const lineCount = useMemo(() => body.split("\n").length, [body]);
  const isLong =
    lineCount > COLLAPSE_LINE_THRESHOLD ||
    body.length > COLLAPSE_CHAR_THRESHOLD;
  const expandLabel =
    lineCount > COLLAPSE_LINE_THRESHOLD
      ? copy.conversation.expandLines(lineCount)
      : copy.conversation.expandFull;
  const [collapsed, setCollapsed] = useState(true);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const copyTimer = useRef<number | null>(null);

  const isSupervisor = origin?.via === "supervisor";
  // A subtask's first message is the instructions the main chat wrote
  // (ticket 06a), not something the user typed: the main chat's house
  // marks it, in the row the Supervisor icon uses.
  const fromMainChat = origin?.via === "subtask";

  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const showActions = () => {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setActionsVisible(true);
  };

  const scheduleHideActions = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setActionsVisible(false);
      hideTimer.current = null;
    }, ACTION_HIDE_DELAY_MS);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      showActions();
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => {
        setCopied(false);
        copyTimer.current = null;
      }, COPY_FEEDBACK_MS);
    } catch (e) {
      console.warn("[MessageUser] copy failed", e);
    }
  };

  const copyVisible = actionsVisible || copied;

  const toggle = isLong ? (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={preventMouseFocus}
      onClick={() => setCollapsed((c) => !c)}
      aria-expanded={!collapsed}
      className="inline-flex h-6 items-center gap-1 rounded-sm px-1 text-[11.5px] text-ink-muted underline-offset-2 transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm hover:bg-hover hover:text-ink hover:underline active:translate-y-px"
    >
      {collapsed ? (
        <>
          {expandLabel}
          <CaretDown size={10} weight="thin" />
        </>
      ) : (
        <>
          {copy.conversation.collapse}
          <CaretUp size={10} weight="thin" />
        </>
      )}
    </button>
  ) : null;

  return (
    <div
      className={cn(
        "group relative",
        rowClassName ?? cn("mt-5 mb-7.5", RAIL_CLEARANCE),
      )}
      onMouseEnter={selectionCopy ? undefined : showActions}
      onMouseLeave={selectionCopy ? undefined : scheduleHideActions}
    >
      {/* Provenance above the bubble, on its side: Supervisor, or the
          main chat for a subtask's instructions. In flow — it takes its
          real height. The send time is no longer here: it is a centred
          line before the message (MessageTimeDivider). */}
      {(isSupervisor || fromMainChat) && (
        <div className="mb-1 flex items-center gap-1.5 justify-end">
          {fromMainChat && (
            <IconTooltip text={copy.subtask.fromMainChat} side="top">
              <span
                role="img"
                tabIndex={-1}
                aria-label={copy.subtask.fromMainChat}
                className={cn(
                  "inline-flex items-center rounded-sm text-ink-muted",
                  "hover:text-ink-soft",
                )}
              >
                <House size={12} weight="thin" />
              </span>
            </IconTooltip>
          )}
          {isSupervisor && (
            <IconTooltip text="Supervisor" side="top">
              <span
                role="img"
                tabIndex={-1}
                aria-label={copy.conversation.supervisorMessage}
                className={cn(
                  "inline-flex items-center rounded-sm text-ink-muted",
                  "hover:text-ink-soft",
                )}
              >
                <PlugsConnected size={12} weight="thin" />
              </span>
            </IconTooltip>
          )}
        </div>
      )}
      <div
        data-role={askUserReply ? "user-msg-reply" : "user-msg"}
        data-message-id={messageId}
        data-selection-copy-scope={selectionCopy ? "user-message" : undefined}
        className={cn(
          "relative w-fit rounded-md bg-brand-tint px-3.5 py-2.5 [font-size:var(--conversation-body-size)] font-medium [line-height:var(--conversation-body-leading)] text-ink",
          "select-text",
          "ml-auto max-w-[min(80%,560px)]",
        )}
      >
        {quotes.length > 0 && <MessageQuotes quotes={quotes} />}
        {/* Quotes only (a hand-typed `>` message): no empty line. */}
        {body !== "" && (
          <span
            className={cn(
              "block whitespace-pre-wrap break-words",
              isLong && collapsed && "line-clamp-6",
            )}
          >
            {body}
          </span>
        )}
        {attachments.length > 0 && (
          <UserImageAttachments attachments={attachments} />
        )}
      </div>
      {selectionCopy ? (
        toggle && <div className="mt-1 flex justify-end">{toggle}</div>
      ) : (
        /* Under the bubble, right edges flush, 6px down: the reply's
            action row (mt-1.5, 24px chips), mirrored. It sits in the
            row's bottom margin (mb-7.5, 30px) rather than in flow, so
            that row IS the gap to whatever comes next — a fold header,
            the live row, a reply, a question — whose own top margin
            (mt-6 at most) collapses into it; in flow it would stack on
            top of theirs. The idea of the assistant's 「它 → 你 30px
            由行动条占着」 (assistantRowGap), here on the user's side.
            The chip hides with opacity and keeps its box, so nothing
            moves when it shows.

            A long message's 「展开 / 收起」 shares the row, outermost
            on the right where the assistant puts it: always there, so
            it keeps the bubble's edge, and the chip comes in to its
            left on hover. Two rows would make a long message's gap
            58px; the chip outermost would leave the toggle hanging 28px
            short of the edge at rest.

            `inline`, not `floating`: the bordered, solid-background chip
            exists so the selection toolbar can portal itself on top of
            arbitrary text. This one sits in clean canvas margin and
            needs no such armour — and a bordered control box pressed
            against the user's own words inverts the register (machine
            parts crisp, the human voice plain). */
        <div className="absolute top-full right-0 z-10 mt-1.5 flex h-6 items-center gap-1">
          <ActionChip
            variant="inline"
            active={copied}
            idleIcon={<Copy size={14} weight="thin" />}
            activeIcon={<Check size={14} weight="bold" />}
            idleLabel={copy.conversation.copy}
            activeLabel={copy.conversation.copied}
            onClick={() => void handleCopy()}
            revealed={copyVisible}
          />
          {toggle}
        </div>
      )}
    </div>
  );
});

function UserImageAttachments({
  attachments,
}: {
  attachments: MessageAttachment[];
}) {
  const copy = useCopy();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const previewImages: ImagePreviewItem[] = useMemo(
    () =>
      attachments
        .filter((item) => item.kind === "image")
        .map((attachment) => {
          const isDataUrl = attachment.path.startsWith("data:");
          return {
            id: attachment.id,
            src: isDataUrl ? attachment.path : convertFileSrc(attachment.path),
            alt: copy.conversation.image,
            openOriginalPath: isDataUrl ? undefined : attachment.path,
          };
        }),
    [attachments, copy.conversation.image],
  );
  const openOriginal = (item: ImagePreviewItem) => {
    if (!item.openOriginalPath) return;
    void invoke("open_conversation_image", {
      kind: "local",
      source: item.openOriginalPath,
    }).catch((e) => {
      console.warn("[MessageUser] open image failed", e);
    });
  };

  if (previewImages.length === 0) return null;
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {previewImages.map((image, imageIndex) => (
          <button
            key={image.id}
            type="button"
            tabIndex={-1}
            onMouseDown={preventMouseFocus}
            onClick={() => setPreviewIndex(imageIndex)}
            className={cn(
              "h-24 w-24 overflow-hidden rounded-md border border-brand-strong/25 bg-surface shadow-[var(--shadow-neutral-control)]",
              "hover:-translate-y-px hover:border-brand-strong/50 hover:shadow-[var(--shadow-neutral-control-hover)] outline-none",
              // A control that lifts on hover must also sink on press —
              // lift without travel breaks the §2.5 physics contract.
              "transition-none active:transition-[transform,box-shadow] active:duration-(--motion-press) active:ease-firm",
              "active:translate-y-px active:shadow-[var(--shadow-neutral-control)]",
            )}
            aria-label={copy.conversation.previewImage}
          >
            <img
              src={image.src}
              alt={image.alt}
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>
      <ImagePreviewDialog
        images={previewImages}
        index={previewIndex}
        onIndexChange={setPreviewIndex}
        onOpenOriginal={openOriginal}
      />
    </>
  );
}
