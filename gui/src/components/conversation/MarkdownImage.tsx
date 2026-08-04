import { ArrowSquareOut, DownloadSimple } from "@phosphor-icons/react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useState } from "react";

import { useCopy, type AppCopy } from "@/lib/i18n";
import {
  decodeMarkdownLocalPath,
  localPathFromMarkdownImageSrc,
  localPathToAssetSrc,
} from "@/lib/markdown-image-src";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { makeAppError } from "@/types/app-error";

// Natural dimensions of agent-output images, learned at first decode
// and keyed by preview src. The <img> carries no width/height (the
// markdown only has a path), so its first appearance reserves zero
// space and pushes content down when the decode lands — tolerable at
// the bottom of a live stream where sticky-scroll absorbs it, but on
// every transcript remount (session revisit) the same pop-in replays
// mid-viewport. With cached dimensions the browser derives the aspect
// ratio from the width/height attributes and reserves the final box
// before decode. Entries are two numbers per unique image — no
// eviction needed.
const _imageDimsCache = new Map<string, { width: number; height: number }>();

export function MarkdownImage({
  src,
  alt,
}: {
  src?: string | null;
  alt?: string | null;
}) {
  const copy = useCopy();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const rawSrc = src?.trim() ?? "";
  const preview = failedSrc === rawSrc ? null : markdownImagePreview(src);
  const label = alt?.trim() || "";

  if (!preview) return <MarkdownImageLink src={src} alt={alt} />;

  const openLabel =
    preview.kind === "remote"
      ? copy.conversation.openImageInBrowser
      : copy.conversation.openOriginalImageFile;
  // rounded-callout (8px) = the menu surface's rounded-md (12px) minus
  // its p-1 (4px) — concentric nested corners (polish-checklist P1).
  const itemClass = cn(
    "flex cursor-default items-center gap-2 rounded-callout px-2.5 py-1.5 text-[12.5px] text-ink-soft outline-none",
    "data-[highlighted]:bg-hover data-[highlighted]:text-ink",
  );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <span
          data-galley-context-menu-trigger=""
          className="my-3 block max-w-full"
        >
          <a
            href={preview.openHref}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-block max-w-full no-underline"
          >
            <img
              src={preview.previewSrc}
              alt={label}
              loading="lazy"
              decoding="async"
              width={_imageDimsCache.get(preview.previewSrc)?.width}
              height={_imageDimsCache.get(preview.previewSrc)?.height}
              onLoad={(event) => {
                const el = event.currentTarget;
                if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                  _imageDimsCache.set(preview.previewSrc, {
                    width: el.naturalWidth,
                    height: el.naturalHeight,
                  });
                }
              }}
              onError={() => setFailedSrc(rawSrc)}
              className="block max-h-[420px] max-w-full rounded-sm border border-line bg-surface object-contain"
            />
          </a>
        </span>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="galley-pop-in z-50 min-w-[160px] rounded-md border border-line bg-elevated p-1 shadow-elevated">
          <ContextMenu.Item
            onSelect={() => void saveMarkdownImage(preview, copy)}
            className={itemClass}
          >
            <DownloadSimple size={13} weight="thin" />
            {copy.conversation.saveImage}
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={() => void openMarkdownImage(preview, copy)}
            className={itemClass}
          >
            <ArrowSquareOut size={13} weight="thin" />
            {openLabel}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function MarkdownImageLink({
  src,
  alt,
}: {
  src?: string | null;
  alt?: string | null;
}) {
  const copy = useCopy();
  const href = safeMarkdownHref(src);
  const label = alt?.trim() || copy.conversation.imageLink;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-sm border border-line bg-surface px-2 py-1 align-baseline text-[12.5px] text-ink-soft">
      <span className="shrink-0 text-ink-muted">{copy.conversation.image}</span>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {label}
        </a>
      ) : (
        <span className="truncate">{label}</span>
      )}
    </span>
  );
}

interface MarkdownImagePreview {
  previewSrc: string;
  openHref: string;
  kind: "remote" | "local";
  source: string;
  filename: string;
  extension: string;
}

const RASTER_IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|gif)(?:[?#].*)?$/i;
const IMAGE_FILENAME_UNSAFE_RE = /[<>:"/\\|?*]/g;

function markdownImagePreview(
  value?: string | null,
): MarkdownImagePreview | null {
  const src = value?.trim();
  if (!src || !RASTER_IMAGE_EXT_RE.test(src)) return null;
  const extension = rasterImageExtension(src);
  if (!extension) return null;

  if (/^https:\/\//i.test(src)) {
    try {
      const url = new URL(src);
      return {
        previewSrc: src,
        openHref: src,
        kind: "remote",
        source: url.toString(),
        filename: imageFilename(url.pathname, extension),
        extension,
      };
    } catch {
      return null;
    }
  }

  const localPath = localPathFromMarkdownImageSrc(src);
  if (localPath) {
    const previewSrc = localPathToAssetSrc(localPath);
    const localExtension = rasterImageExtension(localPath) ?? extension;
    return previewSrc
      ? {
          previewSrc,
          openHref: previewSrc,
          kind: "local",
          source: localPath,
          filename: imageFilename(localPath, localExtension),
          extension: localExtension,
        }
      : null;
  }

  return null;
}

async function saveMarkdownImage(
  preview: MarkdownImagePreview,
  copy: AppCopy,
): Promise<void> {
  try {
    const destinationPath = await save({
      defaultPath: preview.filename,
      filters: [{ name: "Image", extensions: [preview.extension] }],
    });
    if (!destinationPath) return;

    await invoke("save_conversation_image", {
      kind: preview.kind,
      source: preview.source,
      destinationPath,
    });
    pushImageToast({
      title: copy.toasts.imageSaved,
      message: copy.toasts.imageSavedMessage,
      severity: "info",
      context: "save_conversation_image",
    });
  } catch (e) {
    console.warn("[MarkdownView] save image failed", e);
    pushImageToast({
      title: copy.toasts.imageSaveFailed,
      message: copy.toasts.imageSaveFailedMessage,
      severity: "error",
      context: "save_conversation_image",
      traceback: errorMessage(e),
    });
  }
}

async function openMarkdownImage(
  preview: MarkdownImagePreview,
  copy: AppCopy,
): Promise<void> {
  try {
    await invoke("open_conversation_image", {
      kind: preview.kind,
      source: preview.source,
    });
  } catch (e) {
    console.warn("[MarkdownView] open image failed", e);
    pushImageToast({
      title: copy.toasts.imageOpenFailed,
      message: copy.toasts.imageOpenFailedMessage,
      severity: "error",
      context: "open_conversation_image",
      traceback: errorMessage(e),
    });
  }
}

function pushImageToast({
  title,
  message,
  severity,
  context,
  traceback = null,
}: {
  title: string;
  message: string;
  severity: "info" | "error";
  context: string;
  traceback?: string | null;
}): void {
  useUiStore.getState().pushToast(
    makeAppError({
      category: "business",
      severity,
      title,
      message,
      hint: null,
      retryable: false,
      context,
      traceback,
      autoDismissMs: severity === "info" ? 2600 : undefined,
    }),
  );
}

function rasterImageExtension(value: string): string | null {
  const match = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(value);
  const ext = match?.[1]?.toLowerCase();
  if (!ext || !["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    return null;
  }
  return ext;
}

function imageFilename(pathOrUrlPath: string, extension: string): string {
  const raw = pathOrUrlPath.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const decoded = decodeMarkdownLocalPath(raw);
  const sanitized = stripFilenameControlChars(decoded)
    .replace(IMAGE_FILENAME_UNSAFE_RE, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized && rasterImageExtension(sanitized)) return sanitized;
  return fallbackImageFilename(extension);
}

function stripFilenameControlChars(value: string): string {
  return Array.from(value)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
}

function fallbackImageFilename(extension: string): string {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[-:T]/g, "")
    .replace(/^(\d{8})(\d{6})$/, "$1-$2");
  return `galley-image-${stamp}.${extension}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function safeMarkdownHref(value?: string | null): string | undefined {
  const href = value?.trim();
  if (!href) return undefined;
  const localPath = localPathFromMarkdownImageSrc(href);
  if (localPath) return localPathToAssetSrc(localPath) ?? href;
  if (/^(https?:|file:|\/|\.\/|\.\.\/|#)/i.test(href)) return href;
  return undefined;
}
