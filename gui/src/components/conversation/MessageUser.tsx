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
 * User message — document-style callout, NOT a chat bubble.
 *
 * Per DESIGN.md §4.3 (as amended 2026-05-14; size/weight unified 2026-06-20):
 *   - font-sans 15px medium — same size & weight as the agent answer body
 *     (MarkdownView PROSE_AGENT). Speaking turns are peers; the apricot
 *     fill + left bar distinguish the user turn, not typography.
 *   - left border 4px brand-strong (apricot) — primary visual anchor
 *     for scroll-back. In long conversations users navigate by their
 *     own questions; the brand bar makes each user turn a strong
 *     "checkpoint" in the scroll.
 *   - bg-brand-tint (solid) — apricot band a step deeper than
 *     brand-soft so it stays scannable while scrolling a long
 *     conversation. Sibling of the Sidebar active-row / ApprovalDock
 *     apricot family. Still a document callout (left-anchored), not
 *     an IM bubble.
 *   - `w-fit max-w-full` — shrink-to-fit (2026-08-05; was full-width).
 *     Long messages still fill the column, so nothing changes for the
 *     content users actually scroll back to; short ones no longer
 *     render as a near-empty band ("你好" was ~4% of a 760px block).
 *     Fill weight now tracks content length, which loosely tracks
 *     "worth finding again" — the anchor is weighted, not weakened.
 *     Vertical position/height of the brand bar is untouched, and that
 *     bar is what carries scroll position. NOT a step toward a bubble:
 *     bubbles are right-aligned, rounded and raised; this stays
 *     left-anchored with a hard edge.
 *   - sharp right edge (no radius) — a crisp editorial "quoted
 *     input" rectangle anchored by the apricot left bar. Swiss
 *     geometry: structure via a hard edge + the brand rule, not a
 *     softened corner. The warmth stays in the apricot fill + bar;
 *     only the geometry is hardened. Rounding was reconsidered and
 *     rejected on 2026-08-05: at this aspect ratio a 4px radius moves
 *     ~0.04% of the block's pixels, and `rounded-*` on a `border-l-4`
 *     box tapers the brand bar into a wedge at both ends.
 *   - `whitespace-pre-wrap break-words` — preserves the `\n`s in
 *     pasted content (otherwise they'd collapse to spaces under
 *     CSS default whitespace:normal) and lets long Chinese / URL /
 *     token strings break inside words rather than overflowing.
 *
 * Long-content collapse (≥7 lines or >500 chars):
 *   Collapsed by default to 6 lines via `line-clamp` — a clean
 *   line-boundary truncation, no fade-out gradient mask. Toggle
 *   button below the callout switches between "展开（共 N 行）"
 *   and "收起". Saves screen real-estate in conversations where
 *   the user pasted a long prompt / stack trace / document.
 *
 * Message actions:
 *   Supervisor provenance stays pinned to the left brand bar. Copy is
 *   a transient floating chip (the same design as the assistant
 *   selection-copy chip) that fades in on hover just outside the
 *   block's top-right corner — it sat inside the block until
 *   2026-08-05, when shrink-to-fit made the `pr-10` it needed show up
 *   as dead fill on short messages. It never touches the inter-turn
 *   gap, and shares the block's hover region. The model:
 *   persistent actions live in the assistant reply bar; transient copy
 *   surfaces as a floating chip on a user action (hover / select).
 *   Mouse leave delays hiding briefly so the user can move from the
 *   message body to the action without chasing it.
 *
 * `data-role="user-msg"` is a stable anchor that MainView's scroll
 * effect uses to find the just-submitted user message and snap its
 * top edge to ~32px below the viewport top. Don't rename without
 * updating MainView's selector + UserQuestionRail's selector.
 */
const COLLAPSE_LINE_THRESHOLD = 6;
const COLLAPSE_CHAR_THRESHOLD = 500;
const ACTION_HIDE_DELAY_MS = 1800;
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
}

export const MessageUser = memo(function MessageUser({
  content,
  attachments = [],
  origin,
  createdAt,
  askUserReply = false,
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
      variant="floating"
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
        className={cn(
          "relative w-fit max-w-full border-l-4 border-brand-strong bg-brand-tint py-2.5 pl-4 pr-4 [font-size:var(--conversation-body-size)] font-medium [line-height:var(--conversation-body-leading)] text-ink",
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
        {/* Transient copy — a floating chip (same design as the
            selection-copy chip) that fades in on hover, pinned just
            outside the block's top-right corner.
            Sat *inside* the block until 2026-08-05, which is why the
            block reserved `pr-10`. Shrink-to-fit made that reservation
            visible: a two-character message would have rendered as a
            small block trailing 40px of empty fill. Moving the chip out
            lets the box track its content exactly; it still rides the
            block's own hover region, so ownership survives. */}
        <div className="absolute left-full top-1.5 z-10 ml-1.5">{copyChip}</div>
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
