import { beforeEach, describe, expect, it } from "vitest";

import { useMessagesStore } from "@/stores/messages";
import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";

/**
 * activateSession's atomic conversation swap: a first-visit activation
 * defers the activeSessionId flip until the SQLite restore resolves, so
 * the previous transcript stays on screen instead of a blank frame —
 * and a restore that loses a race (newer click, direct pointer write)
 * must never flip the pointer back to a stale target.
 *
 * `restoreSessionTurns` is stubbed with hand-resolved promises so each
 * test controls exactly when "SQLite" answers.
 */

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function stubBridge(): void {
  useRuntimeStore.setState({
    spawnBridge: async () => {},
    hasBridgeClient: () => false,
  });
}

function activeId(): string | undefined {
  return useSessionsStore.getState().activeSessionId;
}

describe("sessions store · activateSession atomic swap", () => {
  beforeEach(() => {
    resetStores();
    stubBridge();
  });

  it("keeps the previous session active until the restore resolves, then flips", async () => {
    const restore = deferred();
    useSessionsStore.setState({
      sessions: [
        makeSession({ id: "s-a", turnCount: 3 }),
        makeSession({ id: "s-b", turnCount: 5 }),
      ],
      activeSessionId: "s-a",
    });
    useMessagesStore.setState({
      restoreSessionTurns: () => restore.promise,
    });

    const done = useSessionsStore.getState().activateSession("s-b");
    // activateSession runs synchronously up to the restore await — the
    // pointer must still be on the old session here (no blank frame).
    expect(activeId()).toBe("s-a");

    restore.resolve();
    await done;
    expect(activeId()).toBe("s-b");
  });

  it("flips immediately on cold start (nothing on screen to keep)", async () => {
    const restore = deferred();
    useSessionsStore.setState({
      sessions: [makeSession({ id: "s-b", turnCount: 5 })],
      activeSessionId: undefined,
    });
    useMessagesStore.setState({
      restoreSessionTurns: () => restore.promise,
    });

    const done = useSessionsStore.getState().activateSession("s-b");
    // Deferring would buy nothing over the blank empty state — the
    // pointer flips before the restore resolves.
    expect(activeId()).toBe("s-b");

    restore.resolve();
    await done;
  });

  it("flips immediately when no restore is needed (no history)", async () => {
    useSessionsStore.setState({
      sessions: [
        makeSession({ id: "s-a", turnCount: 3 }),
        makeSession({ id: "s-b", turnCount: 0 }),
      ],
      activeSessionId: "s-a",
    });
    useMessagesStore.setState({
      restoreSessionTurns: () => {
        throw new Error("restore must not run for a session without history");
      },
    });

    const done = useSessionsStore.getState().activateSession("s-b");
    expect(activeId()).toBe("s-b");
    await done;
  });

  it("a superseded activation never flips the pointer back", async () => {
    const restoreB = deferred();
    const restoreC = deferred();
    useSessionsStore.setState({
      sessions: [
        makeSession({ id: "s-a", turnCount: 1 }),
        makeSession({ id: "s-b", turnCount: 2 }),
        makeSession({ id: "s-c", turnCount: 3 }),
      ],
      activeSessionId: "s-a",
    });
    useMessagesStore.setState({
      restoreSessionTurns: (sid: string) =>
        sid === "s-b" ? restoreB.promise : restoreC.promise,
    });

    const clickB = useSessionsStore.getState().activateSession("s-b");
    const clickC = useSessionsStore.getState().activateSession("s-c");

    // The later click's restore lands first and wins the pointer.
    restoreC.resolve();
    await clickC;
    expect(activeId()).toBe("s-c");

    // The stale click's restore lands afterwards — it must not yank
    // the view back to s-b.
    restoreB.resolve();
    await clickB;
    expect(activeId()).toBe("s-c");
  });

  it("skips the deferred flip when a non-activation path moved the pointer", async () => {
    const restore = deferred();
    useSessionsStore.setState({
      sessions: [
        makeSession({ id: "s-a", turnCount: 1 }),
        makeSession({ id: "s-b", turnCount: 2 }),
      ],
      activeSessionId: "s-a",
    });
    useMessagesStore.setState({
      restoreSessionTurns: () => restore.promise,
    });

    const clickB = useSessionsStore.getState().activateSession("s-b");
    // Simulate createSession / delete flows writing activeSessionId
    // directly while the restore is in flight.
    useSessionsStore.setState({ activeSessionId: "s-new" });

    restore.resolve();
    await clickB;
    expect(activeId()).toBe("s-new");
  });
});
