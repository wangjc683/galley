import { X } from "@phosphor-icons/react";

import { TooltipLabel } from "@/components/ui/tooltip";
import { useCopy } from "@/lib/i18n";
import { preventMouseFocus } from "@/lib/pointer-focus";
import { cn } from "@/lib/utils";
import type { PendingImageAttachment } from "@/types/conversation";

interface ComposerImageStripProps {
  images: PendingImageAttachment[];
  onPreview: (index: number) => void;
  onRemove: (image: PendingImageAttachment, index: number) => void;
}

/**
 * Pending-attachment tiles between the textarea and the button row.
 * The container renders this only when there is at least one image.
 */
export function ComposerImageStrip({
  images,
  onPreview,
  onRemove,
}: ComposerImageStripProps) {
  const copy = useCopy();
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {images.map((image, imageIndex) => (
        <div
          key={image.id}
          // :active propagates up from the inner buttons, so the tile
          // itself carries the quiet press — translating the full-bleed
          // preview button alone would slide the image inside its frame.
          className={cn(
            "group/image relative h-16 w-16 overflow-hidden rounded-md border border-line bg-surface shadow-[var(--shadow-neutral-control)]",
            "transition-none active:transition-transform active:duration-(--motion-press) active:ease-firm active:translate-y-px",
          )}
        >
          <button
            type="button"
            aria-label={copy.conversation.previewImage}
            tabIndex={-1}
            onMouseDown={preventMouseFocus}
            onClick={() => onPreview(imageIndex)}
            className="block h-full w-full outline-none"
          >
            <img
              src={image.previewUrl}
              alt={copy.composer.pastedImage}
              className="h-full w-full object-cover"
            />
          </button>
          <TooltipLabel text={copy.composer.removeImage}>
            <button
              type="button"
              aria-label={copy.composer.removeImage}
              tabIndex={-1}
              onMouseDown={preventMouseFocus}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(image, imageIndex);
              }}
              className={cn(
                "absolute right-1 top-1 flex size-5 items-center justify-center rounded-full",
                "bg-elevated/95 text-ink shadow-[var(--shadow-neutral-control)]",
                "opacity-0 hover:bg-hover active:bg-selected/70 outline-none group-hover/image:opacity-100",
              )}
            >
              <X size={12} weight="bold" />
            </button>
          </TooltipLabel>
        </div>
      ))}
    </div>
  );
}
