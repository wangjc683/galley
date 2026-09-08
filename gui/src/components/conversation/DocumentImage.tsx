import { useContext, useEffect, useRef, useState } from "react";
import {
  accessLocalFile,
  fileOperation,
  InsideLinkContext,
} from "@/lib/local-files";
import { useCopy } from "@/lib/i18n";

/** Raster images read through Core, including documents on external drives.
 * No HTML/SVG execution and no global asset-scope expansion. */
export function DocumentImage({
  path,
  alt,
}: {
  path: string;
  alt?: string | null;
}) {
  const copy = useCopy();
  const insideLink = useContext(InsideLinkContext);
  const container = useRef<HTMLSpanElement>(null);
  const [result, setResult] = useState<{
    path: string;
    src: string | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        void accessLocalFile(path, "read_image").then(
          (file) => {
            if (active) setResult({ path, src: file.content });
          },
          () => {
            if (active) setResult({ path, src: null });
          },
        );
      },
      { rootMargin: "200px" },
    );
    if (container.current) observer.observe(container.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [path]);
  const src = result?.path === path ? result.src : null;
  return (
    <span ref={container} className="my-3 block max-w-full">
      {src ? (
        <img
          src={src}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          className="block max-h-[420px] max-w-full rounded-sm border border-line bg-surface object-contain"
          onError={() => setResult({ path, src: null })}
        />
      ) : (
        <span className="text-sm text-ink-muted">
          {alt || copy.conversation.image} ·{" "}
          {result?.path === path
            ? copy.localFiles.imageUnavailable
            : copy.localFiles.loading}
        </span>
      )}
      {!insideLink && (
        <button
          type="button"
          className="mt-1 text-xs text-ink-muted underline underline-offset-2"
          onClick={() => void fileOperation(path, "reveal", copy)}
        >
          {copy.localFiles.locate}
        </button>
      )}
    </span>
  );
}
