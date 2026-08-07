import * as Dialog from "@radix-ui/react-dialog";
import { ArrowSquareOut, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { useMemo } from "react";

import { IconButton } from "@/components/ui/button";
import { DialogCloseButton } from "@/components/ui/dialog-close-button";
import { useCopy } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface ImagePreviewItem {
  id: string;
  src: string;
  alt: string;
  openOriginalPath?: string;
}

export interface ImagePreviewDialogProps {
  images: ImagePreviewItem[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
  onOpenOriginal?: (item: ImagePreviewItem) => void;
}

export function ImagePreviewDialog({
  images,
  index,
  onIndexChange,
  onOpenOriginal,
}: ImagePreviewDialogProps) {
  const copy = useCopy();
  const current = index == null ? null : images[index] ?? null;
  const open = current !== null;
  const canGoPrev = index != null && index > 0;
  const canGoNext = index != null && index < images.length - 1;
  const title = useMemo(() => {
    if (index == null || images.length <= 1) return copy.conversation.previewImage;
    return `${copy.conversation.previewImage} ${index + 1}/${images.length}`;
  }, [copy.conversation.previewImage, images.length, index]);

  const goPrev = () => {
    if (canGoPrev && index != null) onIndexChange(index - 1);
  };
  const goNext = () => {
    if (canGoNext && index != null) onIndexChange(index + 1);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onIndexChange(null);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-overlay" />
        <Dialog.Content
          className="fixed inset-0 z-[80] flex items-center justify-center p-5 focus:outline-none sm:p-8"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onIndexChange(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              goPrev();
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              goNext();
            }
          }}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {current && (
            <>
              <div className="absolute right-4 top-4 flex items-center gap-2">
                {current.openOriginalPath && onOpenOriginal && (
                  <IconButton
                    ariaLabel={copy.conversation.openOriginalImageFile}
                    tooltip={copy.conversation.openOriginalImageFile}
                    variant="secondary"
                    size="md"
                    onClick={() => onOpenOriginal(current)}
                    className="bg-elevated/95"
                  >
                    <ArrowSquareOut size={17} weight="thin" />
                  </IconButton>
                )}
                {/* size="md" is the documented exception: immersive
                    full-bleed surface, 28px is too small a target. */}
                <DialogCloseButton variant="floating" size="md" />
              </div>

              {images.length > 1 && (
                <>
                  <IconButton
                    ariaLabel={copy.conversation.previousImage}
                    tooltip={copy.conversation.previousImage}
                    tooltipSide="right"
                    variant="secondary"
                    size="md"
                    disabled={!canGoPrev}
                    onClick={goPrev}
                    className="absolute left-4 top-1/2 size-10 -translate-y-1/2 bg-elevated/95 hover:-translate-y-1/2 active:-translate-y-1/2 active:scale-100"
                  >
                    <CaretLeft size={20} weight="bold" />
                  </IconButton>
                  <IconButton
                    ariaLabel={copy.conversation.nextImage}
                    tooltip={copy.conversation.nextImage}
                    tooltipSide="left"
                    variant="secondary"
                    size="md"
                    disabled={!canGoNext}
                    onClick={goNext}
                    className="absolute right-4 top-1/2 size-10 -translate-y-1/2 bg-elevated/95 hover:-translate-y-1/2 active:-translate-y-1/2 active:scale-100"
                  >
                    <CaretRight size={20} weight="bold" />
                  </IconButton>
                </>
              )}

              <div className="flex max-h-full max-w-full items-center justify-center">
                <img
                  src={current.src}
                  alt={current.alt}
                  className={cn(
                    "max-h-[calc(100vh-7rem)] max-w-[calc(100vw-4rem)] object-contain",
                    "select-none rounded-sm shadow-elevated",
                  )}
                  draggable={false}
                />
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
