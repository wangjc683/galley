import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ImagePreviewItem } from "@/components/conversation/ImagePreviewDialog";
import {
  type ImageBlockReason,
  ImageError,
  MAX_PENDING_IMAGES,
  readImageFile,
  SUPPORTED_PASTE_IMAGE_TYPES,
} from "@/lib/composer-images";
import type { PendingImageAttachment } from "@/types/conversation";

/**
 * Owns the Composer's image-attachment concern: pending tiles, the hidden
 * file input, the preview-dialog index, and the three intake paths (paste
 * / drop / file picker) that all funnel through `acceptImageFiles`. Pulled
 * out of Composer so the textarea / paste-fold / goal logic isn't tangled
 * with object-URL lifetime bookkeeping.
 *
 * Object-URL ownership: every `previewUrl` minted by `readImageFile` is
 * revoked exactly once — on remove (tile X), on clear (submit / prefill),
 * or on unmount (last-resort sweep). The `pendingImagesRef` mirror exists
 * only so the unmount cleanup sees the latest list without re-subscribing.
 */
export function useImageAttachments({
  imagesEnabled,
  onImageBlocked,
  pastedImageAlt,
  initialImages,
  retainImagesOnUnmount = false,
}: {
  /** When false, all intake (paste / drop / picker) is refused and routed
   * to `onImageBlocked("external")` — the runtime can't deliver images. */
  imagesEnabled: boolean;
  onImageBlocked?: (reason: ImageBlockReason) => void;
  /** Alt text for the preview tiles / dialog (localized by the caller). */
  pastedImageAlt: string;
  /** Seed attachments restored from a parked draft (mount-time only —
   * later identity changes are ignored, like any useState initializer). */
  initialImages?: PendingImageAttachment[];
  /** When true, skip the unmount object-URL sweep: a draft registry has
   * taken ownership of the attachments and their previews must survive
   * the unmount (see lib/composer-draft.ts ownership notes). Remove /
   * clear still revoke as usual. */
  retainImagesOnUnmount?: boolean;
}) {
  const [pendingImages, setPendingImages] = useState<PendingImageAttachment[]>(
    () => initialImages ?? [],
  );
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag-over affordance: `isDropActive` drives the Composer's drop
  // overlay; `dragDepthRef` is an enter/leave counter so the overlay
  // doesn't flicker as the drag crosses child elements (the classic
  // dragenter/dragleave bubbling trap).
  const [isDropActive, setIsDropActive] = useState(false);
  const dragDepthRef = useRef(0);

  // Mirror of pendingImages for the unmount cleanup below. Render-time
  // paths (remove / clear) already revoke their own URLs; this is the
  // last-resort sweep if the Composer unmounts mid-draft (e.g. the
  // session view switches away).
  const pendingImagesRef = useRef<PendingImageAttachment[]>([]);

  // Keep the mirror current, then revoke everything on unmount. The empty
  // dep array on the cleanup means it only fires when the Composer leaves
  // the tree, not on every pendingImages change.
  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);
  const retainOnUnmountRef = useRef(retainImagesOnUnmount);
  useEffect(() => {
    retainOnUnmountRef.current = retainImagesOnUnmount;
  }, [retainImagesOnUnmount]);
  useEffect(() => {
    return () => {
      if (retainOnUnmountRef.current) return;
      for (const image of pendingImagesRef.current) {
        URL.revokeObjectURL(image.previewUrl);
      }
    };
  }, []);

  const hasPendingImages = pendingImages.length > 0;
  const previewImages: ImagePreviewItem[] = useMemo(
    () =>
      pendingImages.map((image) => ({
        id: image.id,
        src: image.previewUrl,
        alt: pastedImageAlt,
      })),
    [pastedImageAlt, pendingImages],
  );

  // Shared image intake for paste / drop / file picker. Centralizing the
  // limit check + error routing here means the three entry points can't
  // drift apart on behavior. Each file is read concurrently; results land
  // in `pendingImages` as they resolve, gated by the max-attachments cap
  // to avoid racing past it when several land in the same tick.
  const acceptImageFiles = (files: File[]) => {
    if (files.length === 0) return;
    const remaining = MAX_PENDING_IMAGES - pendingImages.length;
    // At cap, or this batch would overflow it: take what fits and tell the
    // user the rest were dropped (otherwise the extra images vanish with no
    // feedback — the silent-failure bug this gate fixes).
    if (files.length > remaining) {
      onImageBlocked?.("too-many");
    }
    if (remaining <= 0) return;
    for (const file of files.slice(0, remaining)) {
      void readImageFile(file)
        .then((image) => {
          setPendingImages((current) =>
            current.length >= MAX_PENDING_IMAGES
              ? current
              : [...current, image],
          );
        })
        .catch((err) => {
          if (err instanceof ImageError) {
            onImageBlocked?.(err.reason);
          } else {
            console.warn("[Composer] failed to read image", err);
          }
        });
    }
  };

  // A file drag (vs a text / URI drag, which should fall through to the
  // browser default so dropping a URL still inserts it as text).
  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).includes("Files");

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return;
    dragDepthRef.current += 1;
    setIsDropActive(true);
  };

  // preventDefault marks the Composer a valid drop target (and gives the
  // OS its copy cursor). No setState here — the overlay's visibility is
  // owned by the enter/leave counter, so we don't re-render on every
  // dragover tick.
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!isFileDrag(e)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDropActive(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    // Any drop ends the drag, so clear the overlay first thing.
    dragDepthRef.current = 0;
    setIsDropActive(false);
    if (!isFileDrag(e)) return;
    e.preventDefault();
    if (!imagesEnabled) {
      onImageBlocked?.("external");
      return;
    }
    const files = Array.from(e.dataTransfer.files).filter((file) =>
      SUPPORTED_PASTE_IMAGE_TYPES.has(file.type),
    );
    if (files.length === 0) {
      onImageBlocked?.("unsupported");
      return;
    }
    void acceptImageFiles(files);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Reset so picking the same file twice in a row still fires onChange
    // (the value is otherwise "already selected").
    e.target.value = "";
    if (files.length === 0) return;
    void acceptImageFiles(files);
  };

  /**
   * Intercept a paste that carries image items. Returns `true` when the
   * paste was image-bearing (and thus consumed — caller should stop), or
   * `false` to let the caller fall through to its text / paste-fold path.
   */
  const tryAcceptPastedImages = (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
  ): boolean => {
    const imageItems = Array.from(e.clipboardData.items).filter((item) =>
      SUPPORTED_PASTE_IMAGE_TYPES.has(item.type),
    );
    if (imageItems.length === 0) return false;
    e.preventDefault();
    if (!imagesEnabled) {
      onImageBlocked?.("external");
      return true;
    }
    const files = imageItems
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    void acceptImageFiles(files);
    return true;
  };

  const removeImage = (image: PendingImageAttachment, imageIndex: number) => {
    setPendingImages((current) => {
      const next = current.filter((item) => item.id !== image.id);
      if (next.length !== current.length) {
        // Release the object URL we minted in readImageFile so it doesn't
        // outlive the tile. Safe to revoke immediately — the <img> is
        // unmounting with this state update.
        URL.revokeObjectURL(image.previewUrl);
      }
      return next;
    });
    setPreviewIndex((current) => {
      if (current == null) return null;
      if (current === imageIndex) return null;
      return current > imageIndex ? current - 1 : current;
    });
  };

  /** Revoke every pending previewUrl and clear the tray + open preview.
   * Used on submit (blobs are persisted to disk by Rust Core and re-served
   * via convertFileSrc, so the in-memory object URLs are dead weight) and
   * on programmatic prefill. Stable identity (only touches setState) so it
   * can sit in the Composer's `useImperativeHandle` deps without churn. */
  const clearImages = useCallback(() => {
    setPendingImages((current) => {
      for (const image of current) URL.revokeObjectURL(image.previewUrl);
      return [];
    });
    setPreviewIndex(null);
  }, []);

  return {
    pendingImages,
    hasPendingImages,
    previewImages,
    previewIndex,
    setPreviewIndex,
    fileInputRef,
    isDropActive,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileInputChange,
    tryAcceptPastedImages,
    removeImage,
    clearImages,
  };
}
