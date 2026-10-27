import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  CaretDown,
  CaretUp,
  Check,
  Clock,
  Copy,
  House,
  PlugsConnected,
} from "@phosphor-icons/react";
import { useEffect, memo, useId, useMemo, useRef, useState } from "react";

import { ActionChip } from "@/components/conversation/ActionChip";
import {
  MessageMenuButton,
  MessageQuoteButton,
} from "@/components/conversation/MessageMenu";
import { MessageQuotes } from "@/components/conversation/MessageQuotes";
import {
  ImagePreviewDialog,
  type ImagePreviewItem,
} from "@/components/conversation/ImagePreviewDialog";
import { IconTooltip } from "@/components/ui/tooltip";
import { ChipRootsContext } from "@/lib/chip-roots";
import { splitQuotedMessage } from "@/lib/composer-quote";
import { useCopy } from "@/lib/i18n";
import { userMessageCopyText } from "@/lib/message-menu";
import { originMarker } from "@/lib/origin-marker";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { useYieldsToSelection } from "@/lib/selection-copy";
import { pointerInRegion, userRowChipsShown } from "@/lib/user-row-hover";
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
 *   cases in the data); or a message that came in through Galley CLI
 *   (`via` supervisor or cli), whose provenance row is there anyway.
 *   Dogfood data
 *   (workbench.db, 2026-05-15 → 09-23): 95% of sessions asked every
 *   question on one day, and 21 of 285 gaps between questions ran past
 *   an hour. Rules and label format live in lib/message-time.ts;
 *   Conversation computes them once and draws the time as a centred
 *   line of its own before the message (MessageTimeDivider): it
 *   belongs to the conversation, not to the bubble. Until 2026-10-16
 *   the workbench put it on a row above the bubble, left-aligned,
 *   shared with the provenance icon; the icon stays above the bubble,
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
 *   Provenance renders as a small icon in the row above the block
 *   (lib/origin-marker); its tooltip names the source only, never the
 *   raw label (the relative time it used to carry retired with the
 *   pinned send time, 2026-09-28).
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
 *   assistant's conversation (`assistant`) puts three chips in the same
 *   row since ruling 105 (ticket 53, overturning ruling 73 items 1–2,
 *   which had none there): copy · quote · ⋯, the bubble's message menu
 *   one hover away. Each wears the bare chip skin, as on a reply's bar.
 *   The hover region is the row plus the 30px band under it, so the
 *   pointer stays in it from the bubble to a chip, and leaving hides
 *   the row at once, as a reply's bar (main chat PRD ruling 109; until
 *   then the margin was outside it and the row waited 600ms). While a
 *   selection in the bubble has the selection toolbar up, the row
 *   yields to it (ruling 108; below).
 *
 * `data-role="user-msg"` is a stable anchor that MainView's scroll
 * effect uses to find the just-submitted user message and snap its
 * top edge to ~32px below the viewport top. Don't rename without
 * updating MainView's selector + UserQuestionRail's selector.
 */
const COLLAPSE_LINE_THRESHOLD = 6;
const COLLAPSE_CHAR_THRESHOLD = 500;
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
   * Audit origin for this user message (B4 M7). A message that came in
   * through Galley CLI gets a small provenance icon above the bubble,
   * one of two kinds (lib/origin-marker, workbench conversation PRD
   * ruling 8): Galley's house when Galley itself wrote it, the plug
   * for anything else. `subtask` (a subtask's instructions, written by
   * the main chat — ticket 06a) gets the house too, with its own
   * tooltip; a scheduled task's first message the clock. `gui` and
   * `system` render none.
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
  /** The assistant's conversation (main chat PRD ruling 105, ticket 53;
   * it overturns ruling 73 items 1–2, which left this bubble with no
   * hover button): the row under the bubble holds copy · quote · ⋯,
   * the bubble's message menu in its order with ⋯ last (ruling 99) —
   * copy only where the menu has 复制 (not under an image alone), quote
   * and ⋯ only where the bubble has a menu (MessageQuoteButton,
   * MessageMenuButton run its own). Ruling 73 had refused this place
   * because a chip there would cover the next message of a burst, 4px
   * below; your row now keeps its 30px at every change of side and
   * between two of yours, and bursts hardly happen in the main chat.
   * Selecting the bubble's text still brings up the floating copy and
   * quote (SelectionCopyToolbar, scope `user-message`), and while it
   * shows the row is down (ruling 108); the right-click menu stays.
   * Off: the workbench's single hover copy, which has no selection
   * toolbar to yield to. */
  assistant?: boolean;
  /** The assistant's conversation: the row's top margin in place of the
   * workbench's `mt-5` (the IM gaps, lib/assistant-conversation.ts
   * `assistantRowGap`); the bottom one is the chip row's 30px in both. */
  rowClassName?: string;
}

export const MessageUser = memo(function MessageUser({
  content,
  attachments = [],
  origin,
  askUserReply = false,
  messageId,
  assistant = false,
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
  // The pointer in the row's hover region (lib/user-row-hover).
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  // The assistant's ⋯ menu open: the row stays up, as a reply's bar does.
  const [menuOpen, setMenuOpen] = useState(false);
  // The assistant's row mounts its chips' tooltips and ⋯ menu on its
  // first hover, the render that shows them, and keeps them
  // (lib/chip-roots.ts, ticket 72).
  const [chipRoots, setChipRoots] = useState(!assistant);
  const rowRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<number | null>(null);
  // The bubble's key for the selection toolbar (lib/selection-copy): in
  // the assistant's conversation, where its text can get the toolbar.
  const selectionYieldKey = useId();
  const yielded = useYieldsToSelection(
    assistant ? selectionYieldKey : undefined,
  );

  // Who it came from when not you at the desktop (workbench
  // conversation PRD ruling 8), one icon at most. A subtask's first
  // message is the instructions the main chat wrote (ticket 06a), not
  // something the user typed: Galley's house, 「Galley 创建」.
  // Through Galley CLI (lib/origin-marker): the house again when Galley
  // itself wrote it, the plug for anyone else. A scheduled task's first
  // message gets the sidebar row's clock.
  const marker = originMarker(origin);
  const provenance =
    origin?.via === "subtask"
      ? {
          icon: "house",
          text: copy.subtask.galleyCreated,
          label: copy.subtask.galleyCreated,
        }
      : marker === "scheduled"
        ? {
            icon: "clock",
            text: copy.conversation.scheduledCreated,
            label: copy.conversation.scheduledCreated,
          }
        : marker === "galley"
          ? {
              icon: "house",
              text: copy.conversation.galleyCreated,
              label: copy.conversation.galleyCreatedAria,
            }
          : marker === "cli"
            ? {
                icon: "plug",
                text: copy.conversation.cliCreated,
                label: copy.conversation.cliCreatedAria,
              }
            : null;

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => {
        setCopied(false);
        copyTimer.current = null;
      }, COPY_FEEDBACK_MS);
    } catch (e) {
      console.warn("[MessageUser] copy failed", e);
    }
  };

  // Up while hovered, and pinned while its copy flashes or (the
  // assistant's row) its menu is open, as a reply's bar is.
  const chipsVisible = userRowChipsShown({ hovered, copied, menuOpen });
  // 复制 where the menu has it (lib/message-menu): not under an image
  // alone.
  const canCopy = userMessageCopyText(content) !== null;
  const onMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    // The menu is portalled: React saw no leave while the pointer was
    // in it, so closed, the row goes at once unless the pointer is in
    // its region; if the browser only catches up on the next move, the
    // row's enter brings it back.
    if (!open) setHovered(pointerInRegion(rowRef.current));
  };

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
      ref={rowRef}
      className={cn(
        "group relative",
        assistant
          ? cn(rowClassName ?? "mt-5", "mb-7.5")
          : cn("mt-5 mb-7.5", RAIL_CLEARANCE),
      )}
      onMouseEnter={() => {
        setHovered(true);
        setChipRoots(true);
      }}
      onMouseLeave={() => setHovered(false)}
      data-selection-yield={assistant ? selectionYieldKey : undefined}
    >
      {/* Provenance above the bubble, on its side: Galley, Galley CLI
          or a scheduled task. In flow — it takes its real height. The
          send time is no longer here: it is a centred line before the
          message (MessageTimeDivider). */}
      {provenance && (
        <div className="mb-1 flex items-center gap-1.5 justify-end">
          <IconTooltip text={provenance.text} side="top">
            <span
              role="img"
              tabIndex={-1}
              aria-label={provenance.label}
              className={cn(
                "inline-flex items-center rounded-sm text-ink-muted",
                "hover:text-ink-soft",
              )}
            >
              {provenance.icon === "house" ? (
                <House size={12} weight="thin" />
              ) : provenance.icon === "clock" ? (
                <Clock size={12} weight="thin" />
              ) : (
                <PlugsConnected size={12} weight="thin" />
              )}
            </span>
          </IconTooltip>
        </div>
      )}
      <div
        data-role={askUserReply ? "user-msg-reply" : "user-msg"}
        data-message-id={messageId}
        data-selection-copy-scope={assistant ? "user-message" : undefined}
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
      {/* Under the bubble, right edges flush, 6px down: the reply's
          action row (mt-1.5, 24px chips), mirrored. It sits in the
          row's bottom margin (mb-7.5, 30px) rather than in flow, so
          that row IS the gap to whatever comes next — a fold header,
          the live row, a reply, a question — whose own top margin
          (mt-6 at most) collapses into it; in flow it would stack on
          top of theirs. The idea of the assistant's 「它 → 你 30px
          由行动条占着」 (assistantRowGap), here on the user's side; in
          the assistant's conversation that rule now reads both ways
          (ruling 105: `user-bar`), and its typing bubble, which has
          no top margin, stands right under these 30px. The chips hide
          with opacity and keep their boxes, so nothing moves when
          they show.

          A long message's 「展开 / 收起」 shares the row, outermost
          on the right where the assistant puts it: always there, so
          it keeps the bubble's edge, and the chips come in to its
          left on hover. Two rows would make a long message's gap
          58px; the chips outermost would leave the toggle hanging
          short of the edge at rest.

          The assistant's three (ruling 105): copy · quote · ⋯, in the
          menu's order with ⋯ last, 2px apart as on a reply's bar. Copy
          copies as the workbench chip does (the menu's 复制 takes the
          same text, lib/message-menu) and flashes the check; quote and
          ⋯ are the menu's own (MessageMenu).

          While the selection toolbar serves this bubble the three are
          down (ruling 108; MessageActions has the rule): hover, the ⋯
          open or the copied flash alike, kept in their place as when
          hidden; when it goes they are as they were. Not the 「展开 /
          收起」, which is no hover action.

          Bare chips: the armour (border, solid ground, shadow) is the
          selection toolbar's shell's, which portals itself on top of
          arbitrary text. This row sits in clean canvas margin and needs
          none — and a bordered control box pressed against the user's
          own words inverts the register (machine parts crisp, the
          human voice plain). */}
      {/* The hit band (ruling 109): the row's 30px bottom margin, where
          the chips hang, inside the hover region, so the pointer does
          not leave it crossing the 6px under the bubble and the row
          can hide at once on leaving, as a reply's bar does. Out of
          flow and empty: no layout, nothing to see; only in the
          margin, so it covers no neighbour; under the chips (z-10). */}
      <span aria-hidden="true" className="absolute inset-x-0 top-full h-7.5" />
      <div className="absolute top-full right-0 z-10 mt-1.5 flex h-6 items-center gap-1">
        {assistant ? (
          <div
            // A deleted message's leaving copy hides it (lib/bubble-motion-play).
            data-hover-row=""
            className={cn(
              "flex items-center gap-0.5",
              yielded && "pointer-events-none opacity-0",
            )}
          >
            <ChipRootsContext.Provider value={chipRoots || menuOpen}>
              {canCopy && (
                <ActionChip
                  active={copied}
                  idleIcon={<Copy size={14} weight="thin" />}
                  activeIcon={<Check size={14} weight="bold" />}
                  idleLabel={copy.conversation.copy}
                  activeLabel={copy.conversation.copied}
                  onClick={() => void handleCopy()}
                  revealed={chipsVisible}
                />
              )}
              {messageId && (
                <>
                  <MessageQuoteButton
                    messageId={messageId}
                    revealed={chipsVisible}
                  />
                  <MessageMenuButton
                    messageId={messageId}
                    open={menuOpen}
                    onOpenChange={onMenuOpenChange}
                    revealed={chipsVisible}
                    align="end"
                  />
                </>
              )}
            </ChipRootsContext.Provider>
          </div>
        ) : (
          <ActionChip
            active={copied}
            idleIcon={<Copy size={14} weight="thin" />}
            activeIcon={<Check size={14} weight="bold" />}
            idleLabel={copy.conversation.copy}
            activeLabel={copy.conversation.copied}
            onClick={() => void handleCopy()}
            revealed={chipsVisible}
          />
        )}
        {toggle}
      </div>
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
              "transition-none active:transition-[translate,scale,box-shadow] active:duration-(--motion-press) active:ease-firm",
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
