import { createContext } from "react";

/**
 * Whether the chips in a message's hover row mount their Radix roots:
 * the tooltip every chip wears (ActionChip) and the ⋯'s dropdown menu
 * (MessageMenuButton). Main chat ticket 72.
 *
 * A Radix root sets its own state the moment it mounts — the trigger's
 * ref hands the root its node during the commit, the popper anchor
 * hands it again in an effect — and Radix's `asChild` hands a fresh ref
 * on every render after that, so each root draws itself again right
 * after any render of its row. The assistant's conversation has seven or
 * eight such roots per round (your copy · quote · ⋯, the reply's copy ·
 * quote · save · the process · ⋯), and opening the main chat drew every
 * one of them two more times before the first frame; most are never
 * pointed at.
 *
 * So the assistant's rows (MessageUser, MessageAgent with `bubble`)
 * mount them on the first hover of the row and keep them from then on:
 * the chips are hidden and click-through until that hover anyway (the
 * row under your bubble shows them in the same render; a reply's bar
 * shows them through CSS, a render ahead). Until then each chip is its
 * bare button, with its own name (`aria-label`). Everywhere else — the
 * workbench, the selection toolbar — nothing provides this, and the
 * roots mount with the chip, as before.
 */
export const ChipRootsContext = createContext(true);
