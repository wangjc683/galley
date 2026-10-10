import { beforeEach, describe, expect, it } from "vitest";

import { useRuntimeStore, type LLMOption } from "@/stores/runtime";
import { useSessionsStore } from "@/stores/sessions";
import { makeSession } from "@/test/factories";
import { resetStores } from "@/test/store-reset";
import { getTauriMocks } from "@/test/setup";

const tauriMocks = getTauriMocks();

const cachedLLMs: LLMOption[] = [
  { index: 0, key: "alpha", name: "Native/alpha", displayName: "Alpha", isCurrent: true },
  { index: 1, key: "beta", name: "Native/beta", displayName: "Beta", isCurrent: false },
];

describe("runtime store", () => {
  beforeEach(() => {
    resetStores();
    useSessionsStore.setState({
      sessions: [makeSession({ id: "s-test", gaRuntimeKind: "external" })],
      activeSessionId: "s-test",
    });
  });

  it("ensureRuntime seeds by persisted key and preserves existing entries", () => {
    const store = useRuntimeStore.getState();

    store.ensureRuntime("s-test", {
      cachedLLMs,
      persistedKey: "beta",
      persistedDisplayName: "Beta from DB",
    });
    const first = useRuntimeStore.getState().byId["s-test"];

    expect(first.llmDisplayName).toBe("Beta from DB");
    expect(first.llms.map((llm) => [llm.key, llm.isCurrent])).toEqual([
      ["alpha", false],
      ["beta", true],
    ]);

    store.ensureRuntime("s-test", {
      cachedLLMs,
      persistedKey: "alpha",
      persistedDisplayName: "Should not replace",
    });

    expect(useRuntimeStore.getState().byId["s-test"]).toBe(first);
  });

  it("ensureRuntime can seed by legacy persisted index", () => {
    useRuntimeStore.getState().ensureRuntime("s-test", {
      cachedLLMs,
      persistedIndex: 1,
    });

    expect(
      useRuntimeStore
        .getState()
        .byId["s-test"].llms.find((llm) => llm.isCurrent)?.key,
    ).toBe("beta");
  });

  it("replaceLLMs updates current model, external cache, and session mirror", async () => {
    const incoming: LLMOption[] = [
      { index: 0, key: "alpha", name: "Native/alpha", displayName: "Alpha", isCurrent: false },
      { index: 1, key: "beta", name: "Native/beta", displayName: "Beta", isCurrent: true },
    ];

    useRuntimeStore.getState().replaceLLMs("s-test", incoming);
    await Promise.resolve();

    const state = useRuntimeStore.getState();
    expect(state.byId["s-test"]).toMatchObject({
      llmDisplayName: "Beta",
    });
    expect(state.cachedLLMs).toEqual(incoming);
    expect(state.cachedLLMDisplayName).toBe("Beta");
    expect(useSessionsStore.getState().sessions[0]).toMatchObject({
      selectedLlmIndex: 1,
      selectedLlmKey: "beta",
      selectedLlmDisplayName: "Beta",
    });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("set_pref_json", {
      key: "llm_list",
      value: incoming,
    });
    // The runner reported this model: persisted, not forwarded back to it
    // (ticket 02d).
    expect(tauriMocks.invoke).toHaveBeenCalledWith("set_session_llm", {
      id: "s-test",
      index: 1,
      key: "beta",
      displayName: "Beta",
      runnerReported: true,
    });
  });

  it("setBridgeStatus preserves LLM fields", () => {
    const store = useRuntimeStore.getState();
    store.ensureRuntime("s-test", {
      cachedLLMs,
      persistedKey: "beta",
    });

    store.setBridgeStatus("s-test", "connected");

    expect(useRuntimeStore.getState().byId["s-test"]).toMatchObject({
      llmDisplayName: "Beta",
      bridgeStatus: "connected",
      bridgeError: null,
      bridgePid: null,
    });
  });
});
