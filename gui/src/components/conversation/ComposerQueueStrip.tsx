import { ArrowLineUp, X } from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import {
  queueJumpMessage,
  queueRemoveMessage,
  type QueuedMessage,
} from "@/lib/session-queue";
import { cn } from "@/lib/utils";

/**
 * Queued-message chips above the Composer (galley#19, PRD 定案 3).
 * Order is execution order (front first). Each chip: click the text to
 * take it back for editing (remove + refill the composer), ArrowLineUp
 * to jump the queue (abort current run, run this first — on an idle
 * crashed-bridge session the same button just runs it), X to remove.
 * No drag reordering in v1.
 */
export function ComposerQueueStrip({
  sessionId,
  items,
  onRefill,
}: {
  sessionId: string;
  items: QueuedMessage[];
  /** Put removed text back into the composer draft (edit flow). */
  onRefill: (text: string) => void;
}) {
  const copy = useCopy();
  if (items.length === 0) return null;

  const handleEdit = async (item: QueuedMessage) => {
    const removed = await queueRemoveMessage(sessionId, item.queueId).catch(
      (e) => {
        console.warn("[queue] remove-for-edit failed", e);
        return null;
      },
    );
    // Fall back to the snapshot text if Core already dropped the item
    // (e.g. it dispatched a heartbeat ago) — the draft is still the
    // least surprising place for the user's words to land.
    onRefill((removed ?? item).text);
  };

  return (
    <div className="mb-1.5 flex flex-col gap-1" data-role="composer-queue">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {copy.composer.queueStripLabel(items.length)}
      </div>
      {items.map((item, i) => (
        <div
          key={item.queueId}
          className={cn(
            "group/queue flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5",
          )}
        >
          <span className="shrink-0 text-[10px] tabular-nums text-ink-muted">
            {i + 1}
          </span>
          <TooltipLabel text={copy.composer.queueEditTooltip}>
            <button
              type="button"
              onClick={() => void handleEdit(item)}
              className="min-w-0 flex-1 cursor-pointer truncate text-left text-[12.5px] text-ink-soft hover:text-ink"
            >
              {item.text}
            </button>
          </TooltipLabel>
          <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-(--motion-fast) focus-within:opacity-100 group-hover/queue:opacity-100">
            <TooltipLabel text={copy.composer.queueJumpTooltip}>
              <button
                type="button"
                aria-label={copy.composer.queueJump}
                onClick={() =>
                  void queueJumpMessage(sessionId, item.queueId).catch((e) =>
                    console.warn("[queue] jump failed", e),
                  )
                }
                className="inline-flex size-6 items-center justify-center rounded-sm text-ink-muted hover:bg-hover hover:text-ink"
              >
                <ArrowLineUp size={13} weight="bold" />
              </button>
            </TooltipLabel>
            <TooltipLabel text={copy.composer.queueRemove}>
              <button
                type="button"
                aria-label={copy.composer.queueRemove}
                onClick={() =>
                  void queueRemoveMessage(sessionId, item.queueId).catch((e) =>
                    console.warn("[queue] remove failed", e),
                  )
                }
                className="inline-flex size-6 items-center justify-center rounded-sm text-ink-muted hover:bg-hover hover:text-ink"
              >
                <X size={13} weight="bold" />
              </button>
            </TooltipLabel>
          </span>
        </div>
      ))}
    </div>
  );
}
