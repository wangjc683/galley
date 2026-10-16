import { describe, expect, it } from "vitest";

import { turnOrdinals } from "@/lib/turn-ordinals";

/** A turn's place survives what happens around it (main chat ticket 32;
 * earlier pages, ticket 12). */
describe("turnOrdinals", () => {
  it("is the index past the prepended turns while nothing was deleted", () => {
    expect(turnOrdinals(3, 0, [])).toEqual([0, 1, 2]);
    expect(turnOrdinals(4, 2, [])).toEqual([-2, -1, 0, 1]);
  });

  it("skips the places deleted turns had, so the rest keep theirs", () => {
    // Five turns, the second and third deleted: the last two keep 3 and 4.
    expect(turnOrdinals(3, 0, [1, 2])).toEqual([0, 3, 4]);
  });

  it("an earlier page still fills in below, around the holes", () => {
    // Turn at place 0 deleted, then a page of two prepended.
    expect(turnOrdinals(4, 2, [0])).toEqual([-2, -1, 1, 2]);
  });

  it("a turn appended after the latest was deleted takes a new place", () => {
    // Three turns, the last one deleted, then one appended.
    expect(turnOrdinals(3, 0, [2])).toEqual([0, 1, 3]);
  });
});
