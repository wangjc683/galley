import { describe, expect, it } from "vitest";

import {
  TIME_LINE_ANCHOR_TOP_PX,
  USER_MSG_ANCHOR_TOP_PX,
  timeLineAbove,
  userMsgParkOffset,
} from "@/lib/conversation-anchor";

// Just enough of the DOM for the rule: a bubble whose row may have a
// sibling right before it, each with a top in viewport coordinates.
function node(top: number, role?: string) {
  return {
    getAttribute: (name: string) =>
      name === "data-role" ? (role ?? null) : null,
    getBoundingClientRect: () => ({ top }),
  };
}
function bubble(top: number, before?: ReturnType<typeof node>): Element {
  return {
    ...node(top, "user-msg"),
    parentElement: { previousElementSibling: before ?? null },
  } as unknown as Element;
}

const CONTAINER_TOP = 100;

describe("userMsgParkOffset (workbench ticket 01 follow-up)", () => {
  it("parks a bubble with no time line above it on the anchor line, as before", () => {
    const b = bubble(500);
    expect(timeLineAbove(b)).toBeNull();
    expect(userMsgParkOffset(b, CONTAINER_TOP)).toBe(
      500 - CONTAINER_TOP - USER_MSG_ANCHOR_TOP_PX,
    );
  });

  it("parks the time line right above a bubble instead, at its own line", () => {
    // The line 10.5px tall, 20px over the bubble.
    const line = node(469.5, "message-time-divider");
    const b = bubble(500, line);
    expect(timeLineAbove(b)).toBe(line);
    const offset = userMsgParkOffset(b, CONTAINER_TOP);
    expect(offset).toBe(469.5 - CONTAINER_TOP - TIME_LINE_ANCHOR_TOP_PX);
    // Scrolled by it: the line at 16px, the bubble 30.5px lower.
    expect(469.5 - offset - CONTAINER_TOP).toBe(16);
    expect(500 - offset - CONTAINER_TOP).toBe(46.5);
  });

  it("reads a parked message as parked, whichever of the two it measures", () => {
    const parkedPlain = bubble(CONTAINER_TOP + USER_MSG_ANCHOR_TOP_PX);
    const parkedTimed = bubble(
      CONTAINER_TOP + 46.5,
      node(CONTAINER_TOP + 16, "message-time-divider"),
    );
    expect(userMsgParkOffset(parkedPlain, CONTAINER_TOP)).toBe(0);
    expect(userMsgParkOffset(parkedTimed, CONTAINER_TOP)).toBe(0);
  });

  it("ignores anything else right above the row", () => {
    const b = bubble(500, node(400, "user-msg"));
    expect(timeLineAbove(b)).toBeNull();
    expect(userMsgParkOffset(b, CONTAINER_TOP)).toBe(
      500 - CONTAINER_TOP - USER_MSG_ANCHOR_TOP_PX,
    );
    const orphan = { ...node(500), parentElement: null } as unknown as Element;
    expect(timeLineAbove(orphan)).toBeNull();
  });
});
