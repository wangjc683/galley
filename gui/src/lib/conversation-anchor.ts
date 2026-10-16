/**
 * The conversation's shared user-message anchor geometry.
 *
 * Every "park a user message at the top" behavior — submit-time
 * stick-to-top, ⌥↑/⌥↓ keyboard jumps, the palette's locate, and the
 * question rail's click-jump + active-dot tracking — must aim at the
 * SAME anchor line (`userMsgParkOffset` below), or the boundary between "current" and "next"
 * question feels different depending on which affordance got you
 * there. These constants used to be re-declared locally at every call
 * site (four copies of `32`); a single divergent edit would silently
 * misalign the rail's active dot from the keyboard nav's landing
 * position.
 */

/** Distance from the scroll container's top edge to the anchor line
 * a user message is parked at (px). */
export const USER_MSG_ANCHOR_TOP_PX = 32;

/** ± tolerance when testing whether a message sits at the anchor —
 * absorbs sub-pixel rounding so the message parked at the line does
 * not count as both "above" and "below" it. */
export const USER_MSG_ANCHOR_TOLERANCE_PX = 8;

/**
 * Where a send-time line sitting right above a parked user message
 * parks instead (px from the scroll container's top edge). Since the
 * time became a centred line before the message (workbench ticket 01),
 * parking the bubble itself on the anchor line left the time line 1.5px
 * under the top edge, half out of sight; the old time row above the
 * bubble sat at 17.5px. One rule for every way of parking a user
 * message (submit, ⌥↑ / ⌥↓, the question rail, the palette's locate)
 * and in both conversations: with a time line right above it, the
 * line's top parks here (on the 4px grid next to the old 17.5px), and
 * the bubble lands 30.5px lower (the 10.5px label and its 20px gap);
 * without one, the bubble's top parks on the anchor line as before.
 * Which node is the anchor does not change: the bubble's
 * `data-role="user-msg"`.
 */
export const TIME_LINE_ANCHOR_TOP_PX = 16;

/** The send-time line right above a user message's row, if one sits
 * there (MessageTimeDivider renders it as the row's previous sibling):
 * `message` is the bubble (`user-msg` / `user-msg-reply`), its parent
 * the row. */
export function timeLineAbove(message: Element): Element | null {
  const previous = message.parentElement?.previousElementSibling ?? null;
  return previous?.getAttribute("data-role") === "message-time-divider"
    ? previous
    : null;
}

/** The quotes drawn right above a user message's bubble (MessageQuotes
 * outside the bubble, telegram-details ticket 07), if any: the bubble's
 * previous sibling in its row. */
export function quotesAbove(message: Element): Element | null {
  const previous = message.previousElementSibling;
  return previous?.getAttribute("data-role") === "message-quotes"
    ? previous
    : null;
}

/**
 * Signed distance from where a user message is to where it parks, for
 * a scroll container whose top edge is at `containerTop` (viewport
 * coordinates): scroll by it to park the message; within ±
 * USER_MSG_ANCHOR_TOLERANCE_PX it counts as parked, above that as
 * below the anchor, under it as above. Measures the time line right
 * above the message when there is one (TIME_LINE_ANCHOR_TOP_PX), the
 * bubble otherwise (USER_MSG_ANCHOR_TOP_PX) — from the top of its quotes
 * when they are drawn above it, so a parked message shows them.
 */
export function userMsgParkOffset(
  message: Element,
  containerTop: number,
): number {
  const line = timeLineAbove(message);
  return line
    ? line.getBoundingClientRect().top - containerTop - TIME_LINE_ANCHOR_TOP_PX
    : (quotesAbove(message) ?? message).getBoundingClientRect().top -
        containerTop -
        USER_MSG_ANCHOR_TOP_PX;
}
