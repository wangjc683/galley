import type { PendingImageAttachment } from "@/types/conversation";

export const SUPPORTED_PASTE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
export const MAX_PENDING_IMAGES = 4;
// Client-side pre-validation, kept in lock-step with Rust Core limits in
// `core/src/commands/session.rs` (MAX_IMAGE_BYTES = 10 MB). Validating
// here means oversized / unsupported images never reach the send button —
// the user sees the error at paste time, not after typing a message.
export const MAX_IMAGE_BYTES_CLIENT = 10 * 1024 * 1024;
// Anthropic recommends capping the long edge at 1568px; larger images are
// server-side downsampled anyway but the user still pays the upload
// bandwidth and the token cost. Downsampling here avoids both.
export const IMAGE_MAX_LONG_EDGE = 1568;
// Quality for JPEG re-encode (only reached when the source is JPEG and
// needs resampling). PNG resampling stays lossless.
export const IMAGE_RESAMPLE_QUALITY = 0.92;

export type ImageBlockReason =
  | "goal"
  | "external"
  | "too-large"
  | "unsupported"
  | "too-many";

/** Thrown by {@link readImageFile} for failures the caller can surface to
 * the user as a toast (rather than a silent `console.warn`). The `reason`
 * maps 1:1 onto {@link ImageBlockReason} minus the intake-time gates
 * (`"goal"`, `"external"`, `"too-many"`) handled before `readImageFile`
 * runs — so it narrows to the per-file decode failures. */
export class ImageError extends Error {
  reason: Exclude<ImageBlockReason, "goal" | "external" | "too-many">;
  constructor(
    reason: Exclude<ImageBlockReason, "goal" | "external" | "too-many">,
    message: string,
  ) {
    super(message);
    this.name = "ImageError";
    this.reason = reason;
  }
}

/**
 * Read a user-supplied image File into a {@link PendingImageAttachment}.
 *
 * Pipeline:
 *   1. Validate mime + size up front (throws {@link ImageError} so the
 *      caller can toast a specific reason instead of silently dropping).
 *   2. Decode via an object URL (streamed by the browser, cheaper than
 *      holding a full base64 string while we only need dimensions).
 *   3. If the long edge exceeds {@link IMAGE_MAX_LONG_EDGE}, downsample
 *      via canvas. PNG stays lossless (only resampled, not re-quantized)
 *      so code/UI screenshots keep crisp character edges — JPEG uses
 *      {@link IMAGE_RESAMPLE_QUALITY}. Images already within the cap
 *      skip the canvas entirely (zero re-encode loss).
 *   4. Produce a compact `dataUrl` (for the IPC round-trip into
 *      `persist_user_message`) and a `previewUrl` object URL (for the
 *      thumbnail tile + dialog, so the 16×16 preview no longer decodes
 *      a full-resolution image). Caller owns the `previewUrl` lifetime.
 */
export function readImageFile(file: File): Promise<PendingImageAttachment> {
  if (!SUPPORTED_PASTE_IMAGE_TYPES.has(file.type)) {
    // HEIC / GIF / AVIF / anything-weird lands here. We deliberately do
    // not transcode: HEIC decode is only reliable on macOS WKWebView,
    // and Galley runs on Windows/Linux Chromium too — a silent
    // half-working path is worse than a clear "unsupported" toast.
    return Promise.reject(
      new ImageError("unsupported", `unsupported image type: ${file.type}`),
    );
  }
  if (file.size > MAX_IMAGE_BYTES_CLIENT) {
    return Promise.reject(
      new ImageError(
        "too-large",
        `image too large: ${file.size} > ${MAX_IMAGE_BYTES_CLIENT}`,
      ),
    );
  }

  const decodeUrl = URL.createObjectURL(file);
  const mimeType = file.type as PendingImageAttachment["mimeType"];

  return new Promise<PendingImageAttachment>((resolve, reject) => {
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(decodeUrl);
      reject(new Error("image failed to decode"));
    };
    img.onload = () => {
      const naturalWidth = img.naturalWidth || 0;
      const naturalHeight = img.naturalHeight || 0;
      const longEdge = Math.max(naturalWidth, naturalHeight);
      const needsResample =
        longEdge > IMAGE_MAX_LONG_EDGE &&
        naturalWidth > 0 &&
        naturalHeight > 0;

      const finalize = (blob: Blob, width: number, height: number) => {
        // Two outputs from the same blob: a data URL for IPC, and an
        // object URL for preview. readAsDataURL is the bridge into the
        // Tauri invoke payload; the object URL lets <img> stream-decode.
        const reader = new FileReader();
        reader.onerror = () => {
          URL.revokeObjectURL(decodeUrl);
          URL.revokeObjectURL(URL.createObjectURL(blob));
          reject(reader.error ?? new Error("image read failed"));
        };
        reader.onload = () => {
          URL.revokeObjectURL(decodeUrl);
          const dataUrl = typeof reader.result === "string" ? reader.result : "";
          if (!dataUrl) {
            reject(new Error("empty image data URL"));
            return;
          }
          resolve({
            id: randomImageId(),
            dataUrl,
            previewUrl: URL.createObjectURL(blob),
            mimeType,
            byteSize: blob.size,
            width: width || undefined,
            height: height || undefined,
          });
        };
        reader.readAsDataURL(blob);
      };

      if (!needsResample) {
        finalize(file, naturalWidth, naturalHeight);
        return;
      }

      const scale = IMAGE_MAX_LONG_EDGE / longEdge;
      const targetWidth = Math.round(naturalWidth * scale);
      const targetHeight = Math.round(naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        // No 2D context (rare headless / GPU-loss case): fall back to
        // the original bytes rather than failing the whole paste.
        finalize(file, naturalWidth, naturalHeight);
        return;
      }
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            finalize(file, naturalWidth, naturalHeight);
            return;
          }
          finalize(blob, targetWidth, targetHeight);
        },
        mimeType,
        IMAGE_RESAMPLE_QUALITY,
      );
    };
    img.src = decodeUrl;
  });
}

export function randomImageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `img-${crypto.randomUUID()}`;
  }
  return `img-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
