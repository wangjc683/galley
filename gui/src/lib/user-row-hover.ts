/**
 * The row under your bubble (MessageUser): when its chips show (main
 * chat PRD ruling 109, ticket 57).
 *
 * The hover region is the bubble's row plus the 30px band under it,
 * where the row hangs (an invisible hit band over the row's bottom
 * margin), so the pointer never leaves it on the way from the bubble to
 * a chip. Leaving it hides the chips at once, as a reply's action bar
 * hides on leaving `group/answer`: no delay, no timer. Until 2026-10-19
 * the margin was outside the region and the row waited 600ms before it
 * went, so the pointer could cross the 6px gap.
 *
 * Pinned up whatever the pointer does (rulings 105, 108): the copied
 * check for its 1.5s, and the ⋯ menu while it is open. Yielding to the
 * selection toolbar is the row's own wrapper (`useYieldsToSelection`)
 * and beats both.
 */
export interface UserRowState {
  /** The pointer is in the hover region. */
  hovered: boolean;
  /** The copy chip's check is flashing. */
  copied: boolean;
  /** The ⋯ menu is open (the assistant's conversation only). */
  menuOpen: boolean;
}

export function userRowChipsShown({
  hovered,
  copied,
  menuOpen,
}: UserRowState): boolean {
  return hovered || copied || menuOpen;
}

/**
 * Whether the pointer is in the hover region right now, by the browser's
 * own `:hover`. For the ⋯ menu closing: the menu is portalled, and React
 * counts a pointer inside it as inside the row, so its enter / leave
 * cannot say where the pointer is once the menu goes. Not there (or not
 * known), the row hides at once; there, it stays, and if the browser
 * only catches up on the next move, the row's enter brings it back.
 */
export function pointerInRegion(
  region: Pick<Element, "matches"> | null,
): boolean {
  return region?.matches(":hover") ?? false;
}
