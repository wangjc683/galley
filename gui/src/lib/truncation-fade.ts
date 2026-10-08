/**
 * Fade-out truncation for single-line sidebar text (`.truncate-fade` in
 * globals.css), in place of the `…` ellipsis.
 *
 * The browser can only cut a line at a whole glyph before appending
 * `…`, and a CJK glyph is a full 13px em, so truncated sidebar titles
 * ended anywhere in a ~10px band and a cut after a full-width comma
 * read as a floating `，…`. Clipping at the box edge and fading the
 * last 22px gives every cut line the same right edge.
 *
 * The fade must only show on lines that are actually cut: a title whose
 * last glyph merely lands in the fade zone would otherwise look cut.
 * So the fade is keyed on `data-truncated`, kept in sync here — on box
 * resize (sidebar drag, a hovered row's `pr-7` for the ⋯ button), on
 * text change (live sublines, rename) and when web fonts finish
 * loading. One shared observer of each kind serves every row.
 *
 * Use as a stable callback ref: `ref={truncationFadeRef}`.
 */

const observed = new Set<HTMLElement>();
let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;
let fontsListening = false;

function sync(el: HTMLElement): void {
  if (el.scrollWidth > el.clientWidth) el.dataset.truncated = "";
  else delete el.dataset.truncated;
}

function syncTarget(node: Node | null): void {
  let el: Node | null = node;
  while (el && !(el instanceof HTMLElement && observed.has(el))) {
    el = el.parentNode;
  }
  if (el) sync(el as HTMLElement);
}

function observe(el: HTMLElement): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  resizeObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) sync(entry.target as HTMLElement);
  });
  if (typeof MutationObserver !== "undefined") {
    mutationObserver ??= new MutationObserver((records) => {
      for (const record of records) syncTarget(record.target);
    });
  }
  if (!fontsListening && typeof document !== "undefined" && document.fonts) {
    fontsListening = true;
    document.fonts.addEventListener("loadingdone", () => {
      observed.forEach(sync);
    });
  }
  observed.add(el);
  // The initial observe() callback does the first sync.
  resizeObserver.observe(el);
  mutationObserver?.observe(el, {
    characterData: true,
    childList: true,
    subtree: true,
  });
  return () => {
    observed.delete(el);
    resizeObserver?.unobserve(el);
    // MutationObserver has no per-target unobserve; mutations on a
    // detached node are ignored by syncTarget (no longer in `observed`).
  };
}

/** Stable callback ref (React 19 ref cleanup) for `.truncate-fade`. */
export function truncationFadeRef(el: HTMLElement | null): (() => void) | void {
  if (el) return observe(el);
}
