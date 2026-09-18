import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  CaretDown,
  CaretUp,
  Check,
  Copy,
  PlugsConnected,
} from "@phosphor-icons/react";
import { useEffect, memo, useMemo, useRef, useState } from "react";

import { ActionChip } from "@/components/conversation/ActionChip";
import {
  ImagePreviewDialog,
  type ImagePreviewItem,
} from "@/components/conversation/ImagePreviewDialog";
import { IconTooltip } from "@/components/ui/tooltip";
import { useCopy, type AppCopy } from "@/lib/i18n";
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
 *   - LEFT-aligned, flush with the column, `w-fit max-w-full`. The
 *     conversation is one document with one reading edge; right
 *     alignment is the one IM ingredient that breaks it (and would
 *     crowd the Question Rail). Text indents by the padding like a
 *     callout — the text edge no longer lines up with the agent prose
 *     column (that was a highlighter-era property).
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
 * GoalCommissionMarker does NOT follow: the crowned objective keeps
 * the 4px bar + sharp-cornered tint slab as its formal dress. Plain
 * rounded bubble vs barred sharp slab is what marks a Goal commission
 * apart from an ordinary message (see GoalRunMarkers).
 *
 * Long-content collapse (≥7 lines or >500 chars):
 *   Collapsed by default to 6 lines via `line-clamp` — a clean
 *   line-boundary truncation, no fade-out gradient mask. Toggle
 *   button below the bubble switches between "展开（共 N 行）"
 *   and "收起". Saves screen real-estate in conversations where
 *   the user pasted a long prompt / stack trace / document.
 *
 * Message actions:
 *   Supervisor provenance renders as a small icon above the block.
 *   Copy is a transient chip that fades in on hover just outside the
 *   bubble's BOTTOM-right corner, centred on the last line of text
 *   (2026-09-18; top-right until then) — the reading end of a
 *   multi-line message, so the eye finishes the last line and the
 *   chip is right there, on the same band as the expand / collapse
 *   toggle. Anchored on the bubble's corner, not the last line's
 *   text end, so it never jumps with content. It sat inside the
 *   block until 2026-08-05, when shrink-to-fit made the `pr-10` it
 *   needed show up as dead fill on short messages. It never touches
 *   the inter-turn gap, and shares the block's hover region. The model: persistent
 *   actions live in the assistant reply bar; transient copy surfaces
 *   on a user action (hover / select). It wears the BARE chip skin,
 *   not the bordered one — see the render site. Mouse leave delays
 *   hiding briefly so the user can move from the message body to the
 *   action without chasing it.
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
 * Compose the supervisor provenance tooltip for the small icon pinned
 * beside supervisor-originated user messages. We intentionally omit the
 * declared supervisor id and reason here: the icon is a lightweight
 * provenance marker, not a full audit panel.
 */
function formatSupervisorTooltip(
  createdAt: string | undefined,
  copy: AppCopy,
): string {
  const relative = formatRelativeTime(createdAt, copy);
  return relative ? `Supervisor · ${relative}` : "Supervisor";
}

/**
 * Lightweight Chinese-leaning relative-time formatter for the
 * supervisor tooltip. Sufficient precision for "this annotation is
 * recent / a while ago" — falls through to YYYY-MM-DD for old rows.
 * Inlined here (rather than a /lib helper) because this is the only
 * caller; if a second site needs relative time, extract it.
 */
function formatRelativeTime(
  iso: string | undefined,
  copy: AppCopy,
): string | undefined {
  if (!iso) return undefined;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return undefined;
  const delta = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return copy.conversation.justNow;
  if (minutes < 60) return copy.conversation.minutesAgo(minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return copy.conversation.hoursAgo(hours);
  const days = Math.floor(hours / 24);
  if (days < 7) return copy.conversation.daysAgo(days);
  // Older: show absolute date so audit reads cleanly.
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface MessageUserProps {
  content: string;
  attachments?: MessageAttachment[];
  /**
   * Audit origin for this user message (B4 M7). When `origin.via ===
   * "supervisor"`, a small robot provenance icon renders by the left
   * identity bar. Other via values (gui / cli / system) render no
   * annotation — the default Galley-driven origin shouldn't interrupt
   * the reading flow.
   */
  origin?: Origin;
  /**
   * ISO timestamp from `messages.created_at`. Drives the relative-time
   * tail of the supervisor tooltip. Optional so tests / demo
   * data don't have to plumb it; the tooltip omits time when absent.
   */
  createdAt?: string;
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
}

export const MessageUser = memo(function MessageUser({
  content,
  attachments = [],
  origin,
  createdAt,
  askUserReply = false,
  messageId,
}: MessageUserProps) {
  const copy = useCopy();
  const lineCount = useMemo(() => content.split("\n").length, [content]);
  const isLong =
    lineCount > COLLAPSE_LINE_THRESHOLD ||
    content.length > COLLAPSE_CHAR_THRESHOLD;
  const expandLabel =
    lineCount > COLLAPSE_LINE_THRESHOLD
      ? copy.conversation.expandLines(lineCount)
      : copy.conversation.expandFull;
  const [collapsed, setCollapsed] = useState(true);
  const [actionsVisible, setActionsVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const copyTimer = useRef<number | null>(null);

  const supervisorTooltip =
    origin?.via === "supervisor"
      ? formatSupervisorTooltip(createdAt, copy)
      : null;

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

  const copyChip = (
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
  );

  return (
    <div
      className="group relative my-5"
      onMouseEnter={showActions}
      onMouseLeave={scheduleHideActions}
    >
      {supervisorTooltip && (
        <div className="mb-1 flex items-center">
          <IconTooltip text={supervisorTooltip} side="top">
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
        </div>
      )}
      <div
        data-role={askUserReply ? "user-msg-reply" : "user-msg"}
        data-message-id={messageId}
        className={cn(
          "relative w-fit max-w-full rounded-md bg-brand-tint px-3.5 py-2.5 [font-size:var(--conversation-body-size)] font-medium [line-height:var(--conversation-body-leading)] text-ink",
          "select-text",
        )}
      >
        <span
          className={cn(
            "block whitespace-pre-wrap break-words",
            isLong && collapsed && "line-clamp-6",
          )}
        >
          {content}
        </span>
        {attachments.length > 0 && (
          <UserImageAttachments attachments={attachments} />
        )}
        {/* Transient copy — fades in on hover just outside the bubble's
            bottom-right corner, centred on the last line of text.
            Sat *inside* the block until 2026-08-05, which is why the
            block reserved `pr-10`. Shrink-to-fit made that reservation
            visible: a two-character message would have rendered as a
            small block trailing 40px of empty fill. Moving the chip out
            lets the box track its content exactly; it still rides the
            block's own hover region, so ownership survives.

            `ml-1.5`: the bubble's painted edge IS its layout edge (the
            highlighter era needed `ml-3` to clear a box-shadow overhang
            that didn't take layout space), so 6px is a real 6px gap.

            `inline`, not `floating`: the bordered, solid-background chip
            exists so the selection toolbar can portal itself on top of
            arbitrary text. This one sits in clean canvas margin and needs
            no such armour — and a bordered control box pressed against
            the user's own words inverts the register (machine parts
            crisp, the human voice plain).

            Vertical anchor: the bubble's `py-2.5` (10px) plus half the
            difference between one line box (body size × leading) and
            the 24px chip puts the chip's centre on the last line's
            centre at every font tier. The old `top-1.5` (6px) left
            the chip ~5px above the first line's centre, riding high
            (2026-09-18). */}
        <div className="absolute left-full bottom-[calc(10px+(var(--conversation-body-size)*var(--conversation-body-leading)-24px)/2)] z-10 ml-1.5">
          {copyChip}
        </div>
      </div>
      {isLong && (
        <div className="mt-1">
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
