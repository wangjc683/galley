import { beforeEach, describe, expect, it } from "vitest";

import { useRuntimeStore } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { makeSession } from "@/test/factories";
import { getTauriMocks } from "@/test/setup";
import { resetStores } from "@/test/store-reset";

/**
 * `setSessionReasoningEffort` has two jobs the composer row depends on:
 * deviation normalisation against the *runner-reported* configured tier,
 * and staying out of the bridge (Galley Core owns the write and the
 * push to a live runner — PRD 裁决 3 / Rule 5).
 */

function seed(configured: string | null, overrides = {}) {
  useSessionsStore.setState({
    sessions: [makeSession({ id: "s-test", ...overrides })],
    activeSessionId: "s-test",
  });
  useRuntimeStore.getState().ensureRuntime("s-test", {});
  useRuntimeStore.getState().setReasoningEffortReport("s-test", {
    reasoningEffort: configured,
    configuredReasoningEffort: configured,
  });
}

function activeSession() {
  return useSessionsStore.getState().sessions[0];
}

function effortInvokes() {
  return getTauriMocks().invoke.mock.calls.filter(
    (call) => call[0] === "set_session_reasoning_effort",
  );
}

describe("sessionsStore · setSessionReasoningEffort", () => {
  beforeEach(() => {
    resetStores();
  });

  it("writes a deviating pick and persists it through Core", () => {
    seed("medium");

    useSessionsStore.getState().setSessionReasoningEffort("s-test", "xhigh");

    expect(activeSession().reasoningEffort).toBe("xhigh");
    expect(effortInvokes()).toHaveLength(1);
    expect(effortInvokes()[0][1]).toMatchObject({
      id: "s-test",
      value: "xhigh",
    });
  });

  it("clears the override when the pick equals the configured tier", () => {
    seed("medium", { reasoningEffort: "xhigh" });

    useSessionsStore.getState().setSessionReasoningEffort("s-test", "medium");

    expect(activeSession().reasoningEffort).toBeNull();
    expect(effortInvokes()[0][1]).toMatchObject({ value: null });
  });

  it("keeps the pick when the model configures no tier", () => {
    seed(null);

    useSessionsStore.getState().setSessionReasoningEffort("s-test", "low");

    expect(activeSession().reasoningEffort).toBe("low");
  });

  it("sends no bridge command — Core forwards to the live runner", () => {
    let bridgeCommands = 0;
    seed("medium");
    useRuntimeStore.setState({
      sendIPCCommand: async () => {
        bridgeCommands += 1;
      },
    });

    useSessionsStore.getState().setSessionReasoningEffort("s-test", "high");

    expect(bridgeCommands).toBe(0);
  });

  it("skips an archived session", () => {
    seed("medium", { status: "archived" });

    useSessionsStore.getState().setSessionReasoningEffort("s-test", "high");

    expect(activeSession().reasoningEffort).toBeUndefined();
    expect(effortInvokes()).toHaveLength(0);
  });
});

/**
 * EmptyState's pill has no session row to write onto, so it stashes
 * `pendingReasoningEffort` and `createSession` consumes it — same
 * lifecycle as `pendingApprovalMode` / `pendingLLMIndex`: seeded onto
 * the new session, ALWAYS cleared, and persisted through Core (which
 * forwards to the runner / next spawn).
 */
async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("sessionsStore · createSession consumes the effort pre-pick", () => {
  beforeEach(() => {
    resetStores();
  });

  it("seeds the override, clears the stash and persists it via Core", async () => {
    useRuntimeStore.setState({ pendingReasoningEffort: "high" });

    const id = useSessionsStore.getState().createSession();

    expect(useSessionsStore.getState().sessions[0].reasoningEffort).toBe(
      "high",
    );
    expect(useRuntimeStore.getState().pendingReasoningEffort).toBeUndefined();
    await flushPromises();
    expect(effortInvokes()).toHaveLength(1);
    expect(effortInvokes()[0][1]).toMatchObject({ id, value: "high" });
  });

  it("sends no command when the pre-pick follows the model configuration", async () => {
    useRuntimeStore.setState({ pendingReasoningEffort: null });

    useSessionsStore.getState().createSession();

    expect(useSessionsStore.getState().sessions[0].reasoningEffort).toBeNull();
    expect(useRuntimeStore.getState().pendingReasoningEffort).toBeUndefined();
    await flushPromises();
    expect(effortInvokes()).toHaveLength(0);
  });

  it("leaves an untouched pill alone", async () => {
    useSessionsStore.getState().createSession();

    expect(useSessionsStore.getState().sessions[0].reasoningEffort).toBeNull();
    await flushPromises();
    expect(effortInvokes()).toHaveLength(0);
  });
});
