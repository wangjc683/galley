import { beforeEach, describe, expect, it } from "vitest";

import { turnOrdinals } from "@/lib/turn-ordinals";
import { useMessagesStore } from "@/stores/messages";
import { resetStores } from "@/test/store-reset";
import type { AgentTurn, Turn, UserTurn } from "@/types/conversation";

/**
 * Dropping the turns of a deleted main chat message (ticket 32,
 * `applyMessagesDeleted`): exactly the rows Core named, the rest keeping
 * their places; the latest reply's ghost suggestion and step-limit tail
 * go with it.
 */

const SID = "s-main";

function user(id: string): UserTurn {
  return { role: "user", content: id, messageId: id };
}
function answer(id: string): AgentTurn {
  return { role: "agent", tools: [], finalAnswer: id, messageId: id };
}

function seed(turns: Turn[], prependedTurns = 0) {
  useMessagesStore.getState().ensureMessages(SID);
  useMessagesStore.setState((s) => ({
    byId: {
      ...s.byId,
      [SID]: {
        ...s.byId[SID],
        turns,
        prependedTurns,
        nextSuggestion: "接着查",
        pausedAtStepLimit: true,
      },
    },
  }));
}

const slice = () => useMessagesStore.getState().byId[SID];
const ids = () =>
  slice().turns.map((t) => (t.role === "system" ? "" : t.messageId));
/** Each turn's place, by its id. */
const places = () => {
  const s = slice();
  const ordinals = turnOrdinals(
    s.turns.length,
    s.prependedTurns,
    s.removedOrdinals,
  );
  return Object.fromEntries(ids().map((id, i) => [id, ordinals[i]]));
};

beforeEach(() => {
  resetStores();
});

describe("applyMessagesDeleted", () => {
  it("drops the named rows; every other turn keeps its place", () => {
    seed([user("u0"), answer("a0"), user("u1"), answer("a1"), user("u2")], 2);
    const before = places();
    useMessagesStore.getState().applyMessagesDeleted(SID, ["a0", "u1"]);
    expect(ids()).toEqual(["u0", "a1", "u2"]);
    expect(places()).toEqual({ u0: before.u0, a1: before.a1, u2: before.u2 });
    // An earlier reply went: the latest one's suggestion and tail stay.
    expect(slice().nextSuggestion).toBe("接着查");
    expect(slice().pausedAtStepLimit).toBe(true);
  });

  it("the latest reply takes its ghost suggestion and step-limit tail along", () => {
    seed([user("u0"), answer("a0")]);
    useMessagesStore.getState().applyMessagesDeleted(SID, ["a0"]);
    expect(ids()).toEqual(["u0"]);
    expect(slice().nextSuggestion).toBeNull();
    expect(slice().pausedAtStepLimit).toBe(false);
  });

  it("a second call, or rows not loaded, change nothing", () => {
    seed([user("u0"), answer("a0")]);
    useMessagesStore.getState().applyMessagesDeleted(SID, ["u0"]);
    const after = slice();
    useMessagesStore.getState().applyMessagesDeleted(SID, ["u0", "not-loaded"]);
    expect(slice()).toBe(after);
    useMessagesStore.getState().applyMessagesDeleted("s-unknown", ["u0"]);
    expect(slice()).toBe(after);
  });

  it("replacing the turns forgets the holes", () => {
    seed([user("u0"), answer("a0")]);
    useMessagesStore.getState().applyMessagesDeleted(SID, ["u0"]);
    expect(slice().removedOrdinals).toEqual([0]);
    useMessagesStore.getState().clearConversation(SID);
    expect(slice().removedOrdinals).toEqual([]);
  });
});
