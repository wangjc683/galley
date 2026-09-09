import { useState } from "react";

import { useCopy } from "@/lib/i18n";

/**
 * A raster image opened directly from a chat reference (not embedded in
 * a document). The data URL comes from Core's bounded `read_image`, so
 * external-drive paths work without widening the WebView asset scope.
 * Shown at natural size up to the panel width; the caption carries the
 * pixel dimensions once known, the one fact a chart or screenshot
 * reviewer keeps asking.
 */
export function ImagePreview({ src, alt }: { src: string; alt: string }) {
  const copy = useCopy().localFiles;
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  return (
    <figure className="flex flex-col items-center gap-2 px-6 py-5">
      <img
        src={src}
        alt={alt}
        decoding="async"
        className="max-w-full rounded-sm border border-line bg-surface object-contain"
        onLoad={(event) =>
          setSize({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
      />
      {size && (
        <figcaption className="text-ui-tertiary tabular-nums text-ink-muted">
          {copy.imageSize(size.width, size.height)}
        </figcaption>
      )}
    </figure>
  );
}
