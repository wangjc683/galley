import { X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// The choice opens with the focus on a button (Enter answers it), and
// Button itself draws no focus ring.
const FOCUS_RING = "focus-visible:ring-2 focus-visible:ring-brand/30";

/**
 * The two-way choice above the Composer when a message goes to the main
 * chat (主聊天; 「主对话」 in the UI) while it is working (ticket 02, PRD
 * ruling 12):
 *
 *   排队     — Core's queue, the ordinary mid-run send: it runs when the
 *              current task ends. A follow-up for that task (「要靠窗的座
 *              位」) belongs here, which is why sends are not simply
 *              turned into side chats.
 *   开新对话 — a new ordinary session (a side chat) with this message,
 *              started now. The UI says 新对话, not 旁聊 (ruling 35).
 *
 * 排队 has the focus, so Enter twice queues. The draft stays in the box
 * until a choice is made; Esc or × only closes the choice. A message
 * with images cannot queue (Core's queue is text-only): 排队 is then
 * disabled and the focus starts on 开新对话.
 */
export function MainChatBusyChoice({
  imagesAttached,
  onQueue,
  onOpenSideChat,
  onDismiss,
}: {
  imagesAttached: boolean;
  onQueue: () => void;
  onOpenSideChat: () => void;
  onDismiss: () => void;
}) {
  const copy = useCopy();
  return (
    <div
      role="group"
      aria-label={copy.composer.mainChatBusyLabel}
      data-role="main-chat-busy-choice"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }}
      className="mb-1.5 flex items-center gap-2 rounded-md border border-line bg-surface py-1.5 pl-2.5 pr-1.5"
    >
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">
        {copy.composer.mainChatBusyLabel}
      </span>
      <TooltipLabel
        text={
          imagesAttached
            ? copy.composer.mainChatBusyQueueImages
            : copy.composer.mainChatBusyQueueTooltip
        }
      >
        {/* The wrapper carries the tooltip for the disabled state: a
            disabled button gets no pointer events. */}
        <span className="inline-flex shrink-0">
          <Button
            variant="secondary"
            size="sm"
            autoFocus={!imagesAttached}
            disabled={imagesAttached}
            onClick={onQueue}
            className={FOCUS_RING}
          >
            {copy.composer.mainChatBusyQueue}
          </Button>
        </span>
      </TooltipLabel>
      <TooltipLabel text={copy.composer.mainChatBusySideChatTooltip}>
        <Button
          variant="secondary"
          size="sm"
          autoFocus={imagesAttached}
          onClick={onOpenSideChat}
          className={cn("shrink-0", FOCUS_RING)}
        >
          {copy.composer.mainChatBusySideChat}
        </Button>
      </TooltipLabel>
      <TooltipLabel text={copy.composer.mainChatBusyKeepEditing}>
        <button
          type="button"
          aria-label={copy.composer.mainChatBusyKeepEditing}
          onClick={onDismiss}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-muted hover:bg-hover hover:text-ink"
        >
          <X size={13} weight="bold" />
        </button>
      </TooltipLabel>
    </div>
  );
}
