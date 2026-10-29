/**
 * Where in `within`'s text a click at (`x`, `y`) falls, as a character
 * offset into its text content — for a box that takes the words' place
 * on a click, to put the caret where the pointer was (main chat ticket
 * 107: a to-do's title and notes, edited in place). The engine's own
 * hit test: `caretPositionFromPoint` (the standard; Chromium, Firefox,
 * Safari 18.4+), else `caretRangeFromPoint` (WebKit before it). Null
 * when neither is there (jsdom), or the point is not in `within`: the
 * caller puts the caret at the end.
 */
export function caretOffsetAt(
  within: Node,
  x: number,
  y: number,
): number | null {
  const doc = within.ownerDocument;
  const hit = doc ? caretHit(doc, x, y) : null;
  if (!doc || !hit || !within.contains(hit.node)) return null;
  return textBefore(doc, within, hit.node, hit.offset);
}

/**
 * Where in some source text a click at (`x`, `y`) falls, when the text
 * is drawn in pieces that are not all as written (main chat ticket 112:
 * a to-do's notes, a file's path in backticks drawn as its name, blank
 * lines drawn as gaps). Each piece is an element inside `within` with
 * either `data-caret-from` (its text is the source's, as written, from
 * that offset) or `data-caret-at` (one place for the whole piece). The
 * engine's hit test as `caretOffsetAt`; null when there is none, or the
 * point is in no piece: the caller puts the caret at the end.
 */
export function caretSourceOffsetAt(
  within: Element,
  x: number,
  y: number,
): number | null {
  const doc = within.ownerDocument;
  const hit = caretHit(doc, x, y);
  if (!hit || !within.contains(hit.node)) return null;
  const element =
    hit.node.nodeType === 1
      ? (hit.node as Element)
      : (hit.node.parentElement as Element | null);
  const piece = element?.closest<HTMLElement>(
    "[data-caret-from], [data-caret-at]",
  );
  if (!piece || !within.contains(piece)) return null;
  if (piece.dataset.caretAt !== undefined) return Number(piece.dataset.caretAt);
  const into = textBefore(doc, piece, hit.node, hit.offset);
  return into === null ? null : Number(piece.dataset.caretFrom) + into;
}

/** The engine's hit test at a point, whichever of the two it has. */
function caretHit(
  doc: Document,
  x: number,
  y: number,
): { node: Node; offset: number } | null {
  // Typed apart from `Document`: an engine may lack either.
  const hits = doc as unknown as CaretHitTests;
  if (typeof hits.caretPositionFromPoint === "function") {
    const position = hits.caretPositionFromPoint.call(doc, x, y);
    return position
      ? { node: position.offsetNode, offset: position.offset }
      : null;
  }
  if (typeof hits.caretRangeFromPoint === "function") {
    const range = hits.caretRangeFromPoint.call(doc, x, y);
    return range
      ? { node: range.startContainer, offset: range.startOffset }
      : null;
  }
  return null;
}

/** How much of `within`'s text comes before (`node`, `offset`). */
function textBefore(
  doc: Document,
  within: Node,
  node: Node,
  offset: number,
): number | null {
  const before = doc.createRange();
  before.selectNodeContents(within);
  try {
    before.setEnd(node, offset);
  } catch {
    return null;
  }
  return before.toString().length;
}

/** The two hit tests, either of which an engine may lack. */
interface CaretHitTests {
  caretPositionFromPoint?: (
    x: number,
    y: number,
  ) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
}
