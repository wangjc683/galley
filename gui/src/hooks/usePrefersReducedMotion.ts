import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query = globalThis.matchMedia?.(QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return globalThis.matchMedia?.(QUERY).matches ?? false;
}

/**
 * The system's 「减少动态效果」, live: read from `matchMedia` and followed
 * as it changes, never cached at launch (foundations.md §2.7, as
 * lib/animate-scroll.ts reads it).
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
