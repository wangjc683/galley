import { describe, expect, it, vi } from "vitest";

import {
  CUSTOM_ENDPOINT_PRESET_ID,
  getManagedModelProviderPreset,
  managedModelProtocolAdvancedDefaults,
} from "@/lib/managed-model-presets";
import {
  canCommitProviderSetup,
  effectiveProviderAuthKind,
  formToProbeInput,
  isProviderFormDirty,
  newProviderForm,
  planAutoPick,
  providerConnectionFingerprint,
  providerFormFromPreset,
  providerFormFromRecord,
  providerFormModelTestInput,
  providerHostFallback,
  providerHostnameFallback,
  providerListFingerprint,
  runCodexComplete,
  runProviderCommit,
  shouldAutoOpenNewProviderForm,
  type ProviderFormState,
} from "@/lib/provider-setup";

function form(patch: Partial<ProviderFormState> = {}): ProviderFormState {
  return {
    providerPresetId: "anthropic" as ProviderFormState["providerPresetId"],
    protocol: "anthropic",
    authKind: "api_key",
    apiKey: "sk-test",
    apiBase: "https://api.anthropic.com",
    model: "claude-sonnet-5",
    displayName: "",
    ...patch,
  };
}

describe("canCommitProviderSetup", () => {
  const base = {
    saving: false,
    probeLoading: false,
    providerHasSavedKey: false,
    isCreating: true,
  };

  it("without verified gating, reproduces the settings canSaveProvider table", () => {
    const unverified = {
      requireVerifiedConnection: false,
      verifiedFingerprint: null,
      currentFingerprint: "",
    };
    expect(canCommitProviderSetup({ ...base, ...unverified, form: form() })).toBe(
      true,
    );
    expect(
      canCommitProviderSetup({ ...base, ...unverified, form: null }),
    ).toBe(false);
    expect(
      canCommitProviderSetup({
        ...base,
        ...unverified,
        form: form({ authKind: "chatgpt_codex_oauth" }),
      }),
    ).toBe(false);
    expect(
      canCommitProviderSetup({
        ...base,
        ...unverified,
        form: form({ protocol: null }),
      }),
    ).toBe(false);
    expect(
      canCommitProviderSetup({
        ...base,
        ...unverified,
        form: form({ apiBase: "  " }),
      }),
    ).toBe(false);
    // A blank key on create is a valid save: it resolves to a no-auth
    // provider (the confirm dialog is the guardrail, not this gate).
    expect(
      canCommitProviderSetup({
        ...base,
        ...unverified,
        form: form({ apiKey: "" }),
      }),
    ).toBe(true);
    // Edit flow with a saved key: blank apiKey is allowed.
    expect(
      canCommitProviderSetup({
        ...base,
        ...unverified,
        form: form({ id: "prov-1", apiKey: "", model: "" }),
        providerHasSavedKey: true,
        isCreating: false,
      }),
    ).toBe(true);
    // Creating requires a model; editing does not.
    expect(
      canCommitProviderSetup({
        ...base,
        ...unverified,
        form: form({ model: "" }),
      }),
    ).toBe(false);
    expect(
      canCommitProviderSetup({ ...base, ...unverified, form: form(), saving: true }),
    ).toBe(false);
    // Probe loading does NOT block the un-gated (settings) save.
    expect(
      canCommitProviderSetup({
        ...base,
        ...unverified,
        form: form(),
        probeLoading: true,
      }),
    ).toBe(true);
  });

  it("with verified gating, blocks until the current fingerprint passed a test", () => {
    const f = form();
    const fp = providerConnectionFingerprint(f);
    const gated = { ...base, form: f, requireVerifiedConnection: true };
    expect(
      canCommitProviderSetup({
        ...gated,
        verifiedFingerprint: null,
        currentFingerprint: fp,
      }),
    ).toBe(false);
    expect(
      canCommitProviderSetup({
        ...gated,
        verifiedFingerprint: "stale",
        currentFingerprint: fp,
      }),
    ).toBe(false);
    expect(
      canCommitProviderSetup({
        ...gated,
        verifiedFingerprint: fp,
        currentFingerprint: fp,
      }),
    ).toBe(true);
    // A probe in flight blocks the gated Start CTA.
    expect(
      canCommitProviderSetup({
        ...gated,
        probeLoading: true,
        verifiedFingerprint: fp,
        currentFingerprint: fp,
      }),
    ).toBe(false);
    // No preset selected → onboarding cannot commit.
    expect(
      canCommitProviderSetup({
        ...gated,
        form: form({ providerPresetId: null }),
        verifiedFingerprint: fp,
        currentFingerprint: fp,
      }),
    ).toBe(false);
  });
});

describe("effectiveProviderAuthKind", () => {
  it("a typed key always means api_key", () => {
    expect(effectiveProviderAuthKind(form(), false)).toBe("api_key");
    expect(
      effectiveProviderAuthKind(form({ authKind: "none" }), false),
    ).toBe("api_key");
  });

  it("blank on create means no-auth; blank with a saved key means keep", () => {
    expect(effectiveProviderAuthKind(form({ apiKey: "" }), false)).toBe("none");
    expect(effectiveProviderAuthKind(form({ apiKey: "  " }), false)).toBe(
      "none",
    );
    expect(effectiveProviderAuthKind(form({ apiKey: "" }), true)).toBe(
      "api_key",
    );
  });

  it("an already no-auth provider stays no-auth on blank, saved key or not", () => {
    expect(
      effectiveProviderAuthKind(form({ authKind: "none", apiKey: "" }), true),
    ).toBe("none");
  });

  it("codex oauth is untouched", () => {
    expect(
      effectiveProviderAuthKind(
        form({ authKind: "chatgpt_codex_oauth", apiKey: "" }),
        false,
      ),
    ).toBe("chatgpt_codex_oauth");
  });
});

describe("fingerprints", () => {
  it("trims credential fields", () => {
    expect(providerConnectionFingerprint(form({ apiKey: " sk-test " }))).toBe(
      providerConnectionFingerprint(form({ apiKey: "sk-test" })),
    );
  });

  it("connection fingerprint changes with the model; list fingerprint does not", () => {
    const a = form({ model: "m1" });
    const b = form({ model: "m2" });
    expect(providerConnectionFingerprint(a)).not.toBe(
      providerConnectionFingerprint(b),
    );
    expect(providerListFingerprint(a)).toBe(providerListFingerprint(b));
  });
});

describe("planAutoPick", () => {
  it("prefers the recommended model when the list has it", () => {
    expect(
      planAutoPick({
        currentModel: "",
        models: ["m1", "rec", "m2"],
        recommended: "rec",
      }),
    ).toBe("rec");
  });

  it("falls back to the single option", () => {
    expect(
      planAutoPick({ currentModel: "", models: ["only"], recommended: "rec" }),
    ).toBe("only");
  });

  it("stays out of ambiguous lists and non-empty fields", () => {
    expect(
      planAutoPick({
        currentModel: "",
        models: ["m1", "m2"],
        recommended: "rec",
      }),
    ).toBeNull();
    expect(
      planAutoPick({
        currentModel: "typed",
        models: ["rec"],
        recommended: "rec",
      }),
    ).toBeNull();
    expect(
      planAutoPick({ currentModel: "", models: [], recommended: "rec" }),
    ).toBeNull();
  });
});

describe("providerHostnameFallback", () => {
  it("extracts the hostname and tolerates non-URLs", () => {
    expect(providerHostnameFallback("https://api.deepseek.com/v1")).toBe(
      "api.deepseek.com",
    );
    expect(providerHostnameFallback("not a url ")).toBe("not a url");
  });
});

describe("providerHostFallback", () => {
  it("keeps the port and tolerates non-URLs", () => {
    expect(providerHostFallback("https://api.x.ai/v1")).toBe("api.x.ai");
    expect(providerHostFallback(" http://localhost:11434/v1 ")).toBe(
      "localhost:11434",
    );
    expect(providerHostFallback("not a url ")).toBe("not a url");
    // Parses, but as a scheme with no host — fall back to the URL.
    expect(providerHostFallback("localhost:11434")).toBe("localhost:11434");
  });
});

describe("custom endpoint form", () => {
  function customForm(patch: Partial<ProviderFormState> = {}) {
    return {
      ...providerFormFromPreset(CUSTOM_ENDPOINT_PRESET_ID),
      apiKey: "sk-relay",
      apiBase: "https://relay.example/v1",
      model: "grok-5",
      ...patch,
    };
  }

  it("starts empty, OpenAI-compatible, with protocol defaults and no reasoning_effort", () => {
    const fresh = providerFormFromPreset(CUSTOM_ENDPOINT_PRESET_ID);
    expect(fresh).toMatchObject({
      providerPresetId: CUSTOM_ENDPOINT_PRESET_ID,
      protocol: "openai",
      authKind: "api_key",
      apiBase: "",
      model: "",
      displayName: "",
    });
    const options = formToProbeInput(customForm())?.advancedOptions;
    expect(options).toEqual(managedModelProtocolAdvancedDefaults("openai"));
    expect(options).not.toHaveProperty("reasoning_effort");
  });

  it("a protocol switch keeps URL / key / model and resets options to that protocol's defaults", () => {
    const before = customForm();
    // What the segmented control does: updateProviderForm({ protocol }).
    const after: ProviderFormState = { ...before, protocol: "anthropic" };
    expect(after).toMatchObject({
      apiKey: "sk-relay",
      apiBase: "https://relay.example/v1",
      model: "grok-5",
    });
    expect(formToProbeInput(before)?.advancedOptions).toEqual(
      managedModelProtocolAdvancedDefaults("openai"),
    );
    expect(formToProbeInput(after)?.advancedOptions).toEqual(
      managedModelProtocolAdvancedDefaults("anthropic"),
    );
  });

  it("an unmatched saved endpoint edits as the Custom card with the record's protocol", () => {
    const record = {
      id: "prov-relay",
      protocol: "anthropic" as const,
      authKind: "api_key" as const,
      apiBase: "https://relay.example/anthropic",
      displayName: "relay.example",
    };
    expect(providerFormFromRecord(record)).toEqual({
      id: "prov-relay",
      providerPresetId: CUSTOM_ENDPOINT_PRESET_ID,
      protocol: "anthropic",
      authKind: "api_key",
      apiKey: "",
      apiBase: "https://relay.example/anthropic",
      model: "",
      displayName: "relay.example",
    });
    // No-auth local endpoints land on the Custom card too.
    expect(
      providerFormFromRecord({
        ...record,
        protocol: "openai",
        authKind: "none",
        apiBase: "http://localhost:11434/v1",
      }).providerPresetId,
    ).toBe(CUSTOM_ENDPOINT_PRESET_ID);
    // Matched presets and Codex OAuth keep their own cards.
    expect(
      providerFormFromRecord({
        ...record,
        apiBase: "https://api.deepseek.com/anthropic",
      }).providerPresetId,
    ).toBe("deepseek");
    expect(
      providerFormFromRecord({
        ...record,
        protocol: "openai",
        authKind: "chatgpt_codex_oauth",
        apiBase: "https://chatgpt.example/codex",
      }).providerPresetId,
    ).toBe("chatgpt-codex");
  });
});

describe("first-model preset options", () => {
  function deps() {
    return {
      saveProvider: vi.fn().mockResolvedValue({ id: "prov-new" }),
      saveModel: vi.fn().mockResolvedValue(undefined),
    };
  }

  async function savedPresetOptions(form: ProviderFormState) {
    const d = deps();
    await runProviderCommit(d as never, {
      form,
      makeDefault: "always",
      modelsCount: 0,
    });
    return (d.saveModel.mock.calls[0][0] as { presetOptions: unknown })
      .presetOptions;
  }

  const openaiCard = () => ({
    ...providerFormFromPreset("custom-openai"),
    apiKey: "sk-test",
  });

  it("an OpenAI card left on the official URL keeps reasoning_effort high", async () => {
    expect(await savedPresetOptions(openaiCard())).toEqual(
      getManagedModelProviderPreset("custom-openai").advancedOptions,
    );
    expect(await savedPresetOptions(openaiCard())).toHaveProperty(
      "reasoning_effort",
      "high",
    );
  });

  it("an OpenAI card repointed at a relay gets protocol defaults", async () => {
    const repointed = { ...openaiCard(), apiBase: "https://relay.example/v1" };
    expect(await savedPresetOptions(repointed)).toEqual(
      managedModelProtocolAdvancedDefaults("openai"),
    );
    // The probe exercises the same options Save writes.
    expect(formToProbeInput(repointed)?.advancedOptions).not.toHaveProperty(
      "reasoning_effort",
    );
  });

  it("the Custom card gets the chosen protocol's defaults", async () => {
    const custom = {
      ...providerFormFromPreset(CUSTOM_ENDPOINT_PRESET_ID),
      apiKey: "sk-test",
      apiBase: "https://relay.example/anthropic",
      model: "claude-x",
      protocol: "anthropic" as const,
    };
    expect(await savedPresetOptions(custom)).toEqual(
      managedModelProtocolAdvancedDefaults("anthropic"),
    );
  });

  it("a URL that matches a shipped preset gets that preset's options, whatever the card", async () => {
    const custom = {
      ...providerFormFromPreset(CUSTOM_ENDPOINT_PRESET_ID),
      apiKey: "sk-test",
      apiBase: "https://api.deepseek.com/anthropic",
      model: "deepseek-v4-pro",
      protocol: "anthropic" as const,
    };
    expect(await savedPresetOptions(custom)).toEqual(
      getManagedModelProviderPreset("deepseek").advancedOptions,
    );
  });
});

describe("runProviderCommit", () => {
  const savedProvider = { id: "prov-9" };
  function deps() {
    return {
      saveProvider: vi.fn().mockResolvedValue(savedProvider),
      saveModel: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("edit path saves the provider only", async () => {
    const d = deps();
    const result = await runProviderCommit(
      d as never,
      {
        form: form({ id: "prov-9", model: "" }),
        makeDefault: "whenEmpty",
        modelsCount: 3,
      },
    );
    expect(result).toEqual({ providerId: "prov-9", isNewProvider: false });
    expect(d.saveProvider).toHaveBeenCalledOnce();
    expect(d.saveModel).not.toHaveBeenCalled();
  });

  it("create path saves the model with the resolved makeDefault", async () => {
    for (const [makeDefault, modelsCount, expected] of [
      ["always", 5, true],
      ["whenEmpty", 0, true],
      ["whenEmpty", 2, false],
    ] as const) {
      const d = deps();
      await runProviderCommit(d as never, {
        form: form(),
        makeDefault,
        modelsCount,
      });
      expect(d.saveModel).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: "prov-9",
          model: "claude-sonnet-5",
          makeDefault: expected,
        }),
      );
    }
  });

  it("a blank key on create commits a no-auth provider", async () => {
    const d = deps();
    await runProviderCommit(d as never, {
      form: form({ apiKey: "" }),
      makeDefault: "always",
      modelsCount: 0,
    });
    expect(d.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ authKind: "none", apiKey: undefined }),
    );
  });

  it("a blank key on edit with a saved key keeps api_key semantics", async () => {
    const d = deps();
    await runProviderCommit(d as never, {
      form: form({ id: "prov-9", apiKey: "", model: "" }),
      makeDefault: "whenEmpty",
      modelsCount: 1,
      providerHasSavedKey: true,
    });
    expect(d.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ authKind: "api_key", apiKey: undefined }),
    );
  });

  it("applies the display-name fallback only when the name is blank", async () => {
    const d = deps();
    await runProviderCommit(d as never, {
      form: form({ displayName: "  " }),
      makeDefault: "always",
      modelsCount: 0,
      displayNameFallback: providerHostnameFallback,
    });
    expect(d.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "api.anthropic.com" }),
    );
    const d2 = deps();
    await runProviderCommit(d2 as never, {
      form: form({ displayName: "My Provider" }),
      makeDefault: "always",
      modelsCount: 0,
      displayNameFallback: providerHostnameFallback,
    });
    expect(d2.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "My Provider" }),
    );
  });

  it("a blank Custom-card name falls back to the endpoint host on both surfaces", async () => {
    const custom = {
      ...providerFormFromPreset(CUSTOM_ENDPOINT_PRESET_ID),
      apiKey: "sk-x",
      apiBase: "http://localhost:11434/v1",
      model: "qwen4",
    };
    // Settings: no caller fallback.
    const d = deps();
    await runProviderCommit(d as never, {
      form: custom,
      makeDefault: "always",
      modelsCount: 0,
    });
    expect(d.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "localhost:11434" }),
    );
    // Onboarding: the custom-card fallback wins over the hostname one.
    const d2 = deps();
    await runProviderCommit(d2 as never, {
      form: custom,
      makeDefault: "always",
      modelsCount: 0,
      displayNameFallback: providerHostnameFallback,
    });
    expect(d2.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "localhost:11434" }),
    );
    // A typed name is kept.
    const d3 = deps();
    await runProviderCommit(d3 as never, {
      form: { ...custom, displayName: "Home GPU" },
      makeDefault: "always",
      modelsCount: 0,
    });
    expect(d3.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Home GPU" }),
    );
    // Other cards in Settings keep sending the name verbatim.
    const d4 = deps();
    await runProviderCommit(d4 as never, {
      form: form({ displayName: "" }),
      makeDefault: "always",
      modelsCount: 0,
    });
    expect(d4.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "" }),
    );
  });

  it("trims credentials only when asked (onboarding save shape)", async () => {
    const d = deps();
    await runProviderCommit(d as never, {
      form: form({ apiKey: " sk-x ", apiBase: " https://a.example " }),
      makeDefault: "always",
      modelsCount: 0,
      trimCredentials: true,
    });
    expect(d.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-x",
        apiBase: "https://a.example",
      }),
    );
    const d2 = deps();
    await runProviderCommit(d2 as never, {
      form: form({ apiKey: " sk-x ", apiBase: " https://a.example " }),
      makeDefault: "always",
      modelsCount: 0,
    });
    expect(d2.saveProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: " sk-x ",
        apiBase: " https://a.example ",
      }),
    );
  });
});

describe("runCodexComplete", () => {
  const start = {
    deviceAuthId: "auth-1",
    userCode: "ABCD-1234",
    intervalSeconds: 5,
    verificationUrl: "https://example.com/verify",
  };

  it("completes, reloads the store, and returns the provider id", async () => {
    const order: string[] = [];
    const complete = vi.fn().mockImplementation(async () => {
      order.push("complete");
      return { provider: { id: "prov-c" } };
    });
    const loadManagedModels = vi.fn().mockImplementation(async () => {
      order.push("load");
    });
    const providerId = await runCodexComplete(
      { complete: complete as never, loadManagedModels },
      start as never,
    );
    expect(providerId).toBe("prov-c");
    expect(order).toEqual(["complete", "load"]);
    expect(complete).toHaveBeenCalledWith({
      deviceAuthId: "auth-1",
      userCode: "ABCD-1234",
      intervalSeconds: 5,
    });
  });

  it("propagates a failed poll without reloading", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("expired"));
    const loadManagedModels = vi.fn();
    await expect(
      runCodexComplete(
        { complete: complete as never, loadManagedModels },
        start as never,
      ),
    ).rejects.toThrow("expired");
    expect(loadManagedModels).not.toHaveBeenCalled();
  });
});

describe("isProviderFormDirty", () => {
  const record = {
    id: "prov-1",
    protocol: "anthropic" as const,
    authKind: "api_key" as const,
    apiBase: "https://api.deepseek.com/anthropic",
    displayName: "DeepSeek",
  };

  it("treats no form (and the untouched auto-opened one) as clean", () => {
    expect(isProviderFormDirty(null)).toBe(false);
    expect(isProviderFormDirty(newProviderForm())).toBe(false);
  });

  it("create form: picking a card is not an edit, typing into it is", () => {
    const picked = providerFormFromPreset("deepseek");
    expect(isProviderFormDirty(picked)).toBe(false);
    expect(isProviderFormDirty({ ...picked, apiKey: "sk-new" })).toBe(true);
    expect(isProviderFormDirty({ ...picked, apiKey: "   " })).toBe(false);
    expect(
      isProviderFormDirty({ ...picked, apiBase: "https://relay.example" }),
    ).toBe(true);
    expect(isProviderFormDirty({ ...picked, model: "deepseek-v4-flash" })).toBe(
      true,
    );
    expect(isProviderFormDirty({ ...picked, displayName: "Mine" })).toBe(true);
    // Whitespace-only differences don't count.
    expect(
      isProviderFormDirty({ ...picked, apiBase: `${picked.apiBase} ` }),
    ).toBe(false);
  });

  it("create form on the Custom card: the protocol switch counts", () => {
    const custom = providerFormFromPreset(CUSTOM_ENDPOINT_PRESET_ID);
    expect(isProviderFormDirty(custom)).toBe(false);
    expect(isProviderFormDirty({ ...custom, protocol: "anthropic" })).toBe(
      true,
    );
  });

  it("edit form compares against the record it was opened from", () => {
    const opened = providerFormFromRecord(record);
    expect(isProviderFormDirty(opened, record)).toBe(false);
    // The key field starts blank: any typed key is an edit.
    expect(
      isProviderFormDirty({ ...opened, apiKey: "sk-rotated" }, record),
    ).toBe(true);
    expect(
      isProviderFormDirty({ ...opened, displayName: "DeepSeek 2" }, record),
    ).toBe(true);
    expect(
      isProviderFormDirty(
        { ...opened, apiBase: "https://relay.example/anthropic" },
        record,
      ),
    ).toBe(true);
  });

  it("edit form whose record is gone has nothing to protect", () => {
    const opened = providerFormFromRecord(record);
    expect(isProviderFormDirty({ ...opened, apiKey: "sk-x" })).toBe(false);
    expect(
      isProviderFormDirty(
        { ...opened, apiKey: "sk-x" },
        { ...record, id: "other" },
      ),
    ).toBe(false);
  });
});

describe("shouldAutoOpenNewProviderForm", () => {
  it("opens the create form only for a loaded, readable, empty list", () => {
    expect(
      shouldAutoOpenNewProviderForm({
        loading: false,
        loadFailed: false,
        providerCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldAutoOpenNewProviderForm({
        loading: true,
        loadFailed: false,
        providerCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldAutoOpenNewProviderForm({
        loading: false,
        loadFailed: false,
        providerCount: 2,
      }),
    ).toBe(false);
  });

  it("a failed load's empty list does not invite a fresh setup", () => {
    expect(
      shouldAutoOpenNewProviderForm({
        loading: false,
        loadFailed: true,
        providerCount: 0,
      }),
    ).toBe(false);
  });
});

describe("providerFormModelTestInput", () => {
  it("create form: tests its own model with fresh-model options", () => {
    const create = form({ model: "  claude-sonnet-5  ", apiKey: "sk-a" });
    const input = providerFormModelTestInput(create, {
      authKind: "api_key",
      defaults: { max_retries: 7 },
    });
    expect(input).toMatchObject({
      id: undefined,
      providerId: undefined,
      protocol: "anthropic",
      authKind: "api_key",
      apiKey: "sk-a",
      apiBase: "https://api.anthropic.com",
      model: "claude-sonnet-5",
    });
    expect(input?.advancedOptions).toMatchObject({ max_retries: 7 });
  });

  it("no model to test → null (the caller lists models instead)", () => {
    expect(
      providerFormModelTestInput(form({ model: " " }), {
        authKind: "api_key",
        defaults: {},
      }),
    ).toBeNull();
    expect(
      providerFormModelTestInput(form({ protocol: null }), {
        authKind: "api_key",
        defaults: {},
      }),
    ).toBeNull();
  });

  it("edit form: tests the named saved model with its stored options, saved key on blank", () => {
    const edit = form({ id: "prov-3", model: "", apiKey: "" });
    const stored = { reasoning_effort: "medium", stream: false };
    const input = providerFormModelTestInput(edit, {
      authKind: "api_key",
      defaults: { max_retries: 7 },
      target: { model: "glm-5.3", advancedOptions: stored },
    });
    expect(input).toEqual({
      id: "prov-3",
      providerId: "prov-3",
      protocol: "anthropic",
      authKind: "api_key",
      // Blank key → omitted, so Core resolves the saved one by id.
      apiKey: undefined,
      apiBase: "https://api.anthropic.com",
      model: "glm-5.3",
      advancedOptions: stored,
    });
  });

  it("edit form: a typed key is what gets tested", () => {
    const input = providerFormModelTestInput(
      form({ id: "prov-3", model: "", apiKey: "sk-rotated" }),
      {
        authKind: "api_key",
        defaults: {},
        target: { model: "glm-5.3" },
      },
    );
    expect(input?.apiKey).toBe("sk-rotated");
    // No stored options passed → fresh-model options for the endpoint.
    expect(input?.advancedOptions).toEqual(
      formToProbeInput(form())?.advancedOptions,
    );
  });
});
