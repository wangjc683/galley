import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  CaretDown,
  CaretUp,
  Check,
  Copy,
  PlugsConnected,
} from "@phosphor-icons/react";
import { Fragment, useEffect, memo, useMemo, useRef, useState } from "react";

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
 * User message — a highlighter-marked passage in the document, NOT a
 * chat bubble.
 *
 * Per DESIGN.md §4.3 (highlighter redesign 2026-08-06; supersedes the
 * 2026-05-14 callout slab and its 2026-08-05 shrink-to-fit /
 * hard-corner iterations):
 *   - The user's words render as per-line apricot strokes
 *     (`bg-brand-tint` + `box-decoration-clone`), fused into one
 *     ragged-right block — a passage marked with a highlighter pen.
 *     The old solid slab read as UI machinery (heavier and
 *     harder-cornered than the rounded ToolCallout boxes — the human
 *     voice dressed as apparatus). The strokes keep the same color
 *     area, which live A/B testing (2026-08-06, vs typography-only
 *     variants) showed is the signal scroll-back scanning actually
 *     runs on, while the ragged right edge kills the slab register.
 *   - No brand bar: the highlight itself is the color anchor now, and
 *     a bar next to it would be a redundant double anchor.
 *   - font-sans 15px medium — unchanged. The 2026-06-20 size/weight
 *     unification with the agent answer body still holds: color still
 *     carries the turn distinction, only its shape changed.
 *   - 2px stroke rounding. The 2026-08-05 anti-rounding argument
 *     (0.04% of a 17:1 slab's pixels, border-l wedge taper) was slab
 *     geometry and does not transfer: on a per-line stroke the radius
 *     is visible and reads as pen work.
 *   - `w-fit max-w-full` block + per-line strokes — fill weight
 *     tracks the text line by line, so the 2026-08-05 "short message
 *     as near-empty band" concern dissolves entirely.
 *   - `whitespace-pre-wrap break-words` — preserves the `\n`s in
 *     pasted content (otherwise they'd collapse to spaces under
 *     CSS default whitespace:normal) and lets long Chinese / URL /
 *     token strings break inside words rather than overflowing.
 *
 * GoalCommissionMarker intentionally does NOT follow this redesign:
 * the crowned objective keeps the old bar + tint slab as its formal
 * dress. Plain strokes vs slab is now part of what marks a Goal
 * commission apart from an ordinary message (see GoalRunMarkers).
 *
 * Long-content collapse (≥7 lines or >500 chars):
 *   Collapsed by default to 6 lines via `line-clamp` — a clean
 *   line-boundary truncation, no fade-out gradient mask. Toggle
 *   button below the callout switches between "展开（共 N 行）"
 *   and "收起". Saves screen real-estate in conversations where
 *   the user pasted a long prompt / stack trace / document.
 *
 * Message actions:
 *   Supervisor provenance renders as a small icon above the block.
 *   Copy is a transient floating chip (the same design as the
 *   assistant selection-copy chip) that fades in on hover just
 *   outside the block's top-right corner — it sat inside the block
 *   until 2026-08-05, when shrink-to-fit made the `pr-10` it needed
 *   show up as dead fill on short messages. It never touches the
 *   inter-turn gap, and shares the block's hover region. The model:
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
 * Per-line highlight strokes. Hard newlines split the content into
 * runs; each non-whitespace run gets its own stroke span, and
 * soft-wrapped long lines still stroke per visual line via
 * `box-decoration-clone`. Whitespace-only lines pass through
 * unhighlighted so pasted blank lines don't render as empty apricot
 * blobs. The 5px vertical padding overshoots the natural inter-line
 * gap at all three conversation font-size steps (leading 1.65–1.75),
 * fusing adjacent strokes into one ragged block — the fused texture
 * won over thin per-stroke gaps in the 2026-08-06 dev test.
 *
 * The 4px horizontal stroke overhang is painted with a pair of
 * offset box-shadows, NOT `px-1 -mx-1` padding/margin: WKWebView
 * leaves inline horizontal padding out of the `w-fit` block's
 * intrinsic width while still spending it at layout time, so the
 * padding version came up 8px short and `break-words` folded short
 * messages mid-word ("hey" → "he/y", dogfood 2026-08-06). The
 * shadows don't participate in layout at all — the line box is pure
 * text, which also keeps the text's left edge aligned with the agent
 * prose column — and they follow each cloned fragment with the
 * span's own radius, so the painted result is identical.
 */
function HighlightedLines({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && "\n"}
          {line.trim().length > 0 ? (
            <span className="box-decoration-clone rounded-[2px] bg-brand-tint py-[5px] shadow-[-4px_0_0_var(--color-brand-tint),4px_0_0_var(--color-brand-tint)]">
              {line}
            </span>
          ) : (
            line
          )}
        </Fragment>
      ))}
    </>
  );
}


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
          "relative w-fit max-w-full py-0.5 [font-size:var(--conversation-body-size)] font-medium [line-height:var(--conversation-body-leading)] text-ink",
          "select-text",
        )}
      >
        <span
          className={cn(
            "block whitespace-pre-wrap break-words",
            isLong && collapsed && "line-clamp-6",
          )}
        >
          <HighlightedLines content={content} />
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
