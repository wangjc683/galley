import { beforeEach, describe, expect, it } from "vitest";

import type { SubtaskDispatch } from "@/lib/subtasks";
import { useSubtasksStore } from "@/stores/subtasks";
import { getTauriMocks } from "@/test/setup";

const tauriMocks = getTauriMocks();

function dispatch(extra: Partial<SubtaskDispatch> = {}): SubtaskDispatch {
  return {
    parentSessionId: "s-main",
    turnIndex: 4,
    ordinal: 0,
    messageId: "msg_s-main_4_assistant",
    sessionId: "s-a",
    title: "查三家报价",
    failure: null,
    failureDetail: null,
    createdAt: "2026-10-13T08:00:00.000Z",
    ...extra,
  };
}

beforeEach(() => {
  useSubtasksStore.setState(useSubtasksStore.getInitialState(), true);
});

describe("the subtasks store (ticket 06a)", () => {
  it("reads a parent's records from Core once", async () => {
    tauriMocks.invoke.mockResolvedValue([dispatch()]);
    await useSubtasksStore.getState().loadFor("s-main");
    await useSubtasksStore.getState().loadFor("s-main");
    expect(tauriMocks.invoke.mock.calls).toEqual([
      ["list_subtask_dispatches", { parentSessionId: "s-main" }],
    ]);
    expect(useSubtasksStore.getState().byParent["s-main"]).toEqual([
      dispatch(),
    ]);
  });

  it("tries again after a failed read", async () => {
    tauriMocks.invoke.mockRejectedValueOnce(new Error("no Core"));
    await useSubtasksStore.getState().loadFor("s-main");
    tauriMocks.invoke.mockResolvedValueOnce([dispatch()]);
    await useSubtasksStore.getState().loadFor("s-main");
    expect(useSubtasksStore.getState().byParent["s-main"]).toHaveLength(1);
  });

  it("applies Core's announcement next to what it read, once per tag", () => {
    const store = useSubtasksStore.getState();
    store.applyDispatched({
      parentSessionId: "s-main",
      dispatches: [dispatch()],
    });
    const first = useSubtasksStore.getState().byParent["s-main"];
    store.applyDispatched({
      parentSessionId: "s-main",
      dispatches: [dispatch()],
    });
    // A repeat changes nothing — not even the array.
    expect(useSubtasksStore.getState().byParent["s-main"]).toBe(first);
    store.applyDispatched({
      parentSessionId: "s-main",
      dispatches: [dispatch({ ordinal: 1, sessionId: "s-b", title: "订机票" })],
    });
    expect(
      useSubtasksStore.getState().byParent["s-main"].map((d) => d.title),
    ).toEqual(["查三家报价", "订机票"]);
  });

  it("keeps a run's error until it is cleared", () => {
    const store = useSubtasksStore.getState();
    store.setRunError("s-a", "quota exceeded");
    expect(useSubtasksStore.getState().runErrors).toEqual({
      "s-a": "quota exceeded",
    });
    store.setRunError("s-a", null);
    expect(useSubtasksStore.getState().runErrors).toEqual({});
  });

  // Ruling 101: a question left to the card while Core could not wake
  // the main chat for it.
  it("keeps a question left to the card until it is cleared or forgotten", () => {
    const store = useSubtasksStore.getState();
    const asked = { question: "靠窗还是靠过道？", candidates: ["靠窗"] };
    store.markAskInCard({ "s-a": asked, "s-b": null });
    expect(useSubtasksStore.getState().askInCard).toEqual({
      "s-a": asked,
      "s-b": null,
    });
    const before = useSubtasksStore.getState().askInCard;
    store.clearAskInCard(["s-x"]);
    // Nothing of its: the same object.
    expect(useSubtasksStore.getState().askInCard).toBe(before);
    store.clearAskInCard(["s-b"]);
    expect(useSubtasksStore.getState().askInCard).toEqual({ "s-a": asked });
    store.forgetSessions(["s-a"]);
    expect(useSubtasksStore.getState().askInCard).toEqual({});
  });
});
