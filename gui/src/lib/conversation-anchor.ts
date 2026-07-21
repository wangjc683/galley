/**
 * The conversation's shared user-message anchor geometry.
 *
 * Every "park a user message at the top" behavior — submit-time
 * stick-to-top, ⌥↑/⌥↓ keyboard jumps, advance-to-approval, and the
 * question rail's click-jump + active-dot tracking — must aim at the
 * SAME anchor line, or the boundary between "current" and "next"
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
