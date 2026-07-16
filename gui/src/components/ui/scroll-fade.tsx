import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

/**
 * A bordered scroll region that fades its top / bottom edges to signal
 * there's more content above / below. The bottom fade only appears
 * when the list actually overflows and isn't scrolled to the end, so a
 * short list shows no fade — addressing the "is that all?" problem of a
 * cleanly-clipped internal scroll area (e.g. the detected-models list).
 *
 * Owns the border / rounded / surface background so the fades (which
 * blend to `--color-surface`) sit cleanly inside the rounded frame.
 * Pass row content as a single child (with its own `divide-y` wrapper
 * if rows need dividers).
 */
export function ScrollFade({
  maxHeightClass,
  className,
  children,
}: {
  /** Tailwind max-height class for the scroll viewport, e.g. "max-h-[260px]". */
  maxHeightClass: string;
  className?: string;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);
  const [atBottom, setAtBottom] = useState(true);

  const recompute = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const scrollable = scrollHeight - clientHeight > 1;
    setAtTop(!scrollable || scrollTop <= 1);
    setAtBottom(!scrollable || scrollTop + clientHeight >= scrollHeight - 1);
  }, []);

  // Recompute on viewport resize (window / layout changes).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(el);
    return () => observer.disconnect();
  }, [recompute]);

  // Recompute when content changes (filter / fetch grows or shrinks the
  // list). recompute bails out via React's setState equality when the
  // edge flags don't actually change.
  useEffect(() => {
    recompute();
  }, [recompute, children]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-sm border border-line bg-surface",
        className,
      )}
    >
      <div
        ref={viewportRef}
        onScroll={recompute}
        className={cn("overflow-auto", maxHeightClass)}
      >
        {children}
      </div>
      <div
        aria-hidden
        style={{
          background:
            "linear-gradient(to bottom, var(--color-surface), transparent)",
        }}
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-10 transition-opacity duration-(--motion-fast)",
          atTop ? "opacity-0" : "opacity-100",
        )}
      />
      <div
        aria-hidden
        style={{
          background:
            "linear-gradient(to top, var(--color-surface), transparent)",
        }}
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-14 transition-opacity duration-(--motion-fast)",
          atBottom ? "opacity-0" : "opacity-100",
        )}
      />
    </div>
  );
}
