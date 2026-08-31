import { describe, expect, it, vi } from "vitest";

import {
  canCommitProviderSetup,
  effectiveProviderAuthKind,
  planAutoPick,
  providerConnectionFingerprint,
  providerHostnameFallback,
  providerListFingerprint,
  runCodexComplete,
  runProviderCommit,
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
