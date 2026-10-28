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
  if (!doc) return null;
  // Typed apart from `Document`: an engine may lack either.
  const hits = doc as unknown as CaretHitTests;
  let node: Node | null = null;
  let offset = 0;
  if (typeof hits.caretPositionFromPoint === "function") {
    const position = hits.caretPositionFromPoint.call(doc, x, y);
    if (position) {
      node = position.offsetNode;
      offset = position.offset;
    }
  } else if (typeof hits.caretRangeFromPoint === "function") {
    const range = hits.caretRangeFromPoint.call(doc, x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }
  if (!node || !within.contains(node)) return null;
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
