/**
 * A turn's place in the conversation that survives the turns around it
 * coming and going: the conversation keys its rows, and the state it
 * keeps per run (an open process card), by it.
 *
 * Without deletions it is `index - prependedTurns`: loading an earlier
 * page (main-chat ticket 12) puts turns in front with places below the
 * first one's, so no row is re-keyed. Deleting a message of the main
 * chat (ticket 32) takes turns out of the middle; their places are
 * remembered (`removedOrdinals`, messages store) and skipped, so every
 * turn after them keeps its place too, and a turn appended later never
 * takes a removed one. Removed places never lie before the first place
 * of their time, so a later prepend still fills in below them.
 */
export function turnOrdinals(
  count: number,
  prependedTurns: number,
  removedOrdinals: readonly number[],
): number[] {
  const out = new Array<number>(count);
  if (removedOrdinals.length === 0) {
    for (let i = 0; i < count; i++) out[i] = i - prependedTurns;
    return out;
  }
  const skip = new Set(removedOrdinals);
  // `0 - n`, not `-n`: no `-0` for a list that was never prepended to.
  let next = 0 - prependedTurns;
  for (let i = 0; i < count; i++) {
    while (skip.has(next)) next++;
    out[i] = next++;
  }
  return out;
}
