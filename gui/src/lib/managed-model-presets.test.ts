import { describe, expect, it } from "vitest";

import {
  apiBasePlaceholderForManagedModelProviderPreset,
  CUSTOM_ENDPOINT_PRESET_ID,
  customManagedModelProviderPresetId,
  getManagedModelProviderPreset,
  MANAGED_MODEL_PROVIDER_PRESETS,
  managedModelProtocolAdvancedDefaults,
  managedModelProviderPresetDraft,
  managedModelProviderPresetForRecord,
  recommendedAdvancedOptionsForManagedModelProvider,
} from "@/lib/managed-model-presets";
import type { ManagedModelProviderRecord } from "@/types/managed-models";

describe("managed model presets", () => {
  it("official OpenAI / Anthropic presets are protocol defaults plus first-party reasoning_effort", () => {
    expect(
      getManagedModelProviderPreset("custom-openai").advancedOptions,
    ).toEqual({
      ...managedModelProtocolAdvancedDefaults("openai"),
      reasoning_effort: "high",
    });
    expect(
      getManagedModelProviderPreset("custom-anthropic").advancedOptions,
    ).toEqual({
      ...managedModelProtocolAdvancedDefaults("anthropic"),
      reasoning_effort: "high",
    });
  });

  it("protocol defaults never carry the first-party-only reasoning_effort", () => {
    for (const protocol of ["openai", "anthropic"] as const) {
      expect(managedModelProtocolAdvancedDefaults(protocol)).not.toHaveProperty(
        "reasoning_effort",
      );
    }
  });

  it("recommends protocol defaults for arbitrary custom OpenAI-compatible providers", () => {
    const advancedOptions = recommendedAdvancedOptionsForManagedModelProvider(
      providerRecord({
        protocol: "openai",
        apiBase: "https://windows-test.example/v1",
      }),
    );

    expect(advancedOptions).toEqual(
      managedModelProtocolAdvancedDefaults("openai"),
    );
  });
});

describe("custom endpoint card", () => {
  it("is the last card in the shared preset list", () => {
    const presets = MANAGED_MODEL_PROVIDER_PRESETS;
    expect(presets[presets.length - 1].id).toBe(CUSTOM_ENDPOINT_PRESET_ID);
  });

  it("drafts with an empty endpoint, model and name, OpenAI-compatible by default", () => {
    expect(managedModelProviderPresetDraft(CUSTOM_ENDPOINT_PRESET_ID)).toEqual({
      providerPresetId: CUSTOM_ENDPOINT_PRESET_ID,
      protocol: "openai",
      authKind: undefined,
      apiBase: "",
      model: "",
      displayName: "",
    });
    const preset = getManagedModelProviderPreset(CUSTOM_ENDPOINT_PRESET_ID);
    // No first-party option bag and no key console to link to.
    expect(preset.advancedOptions).toBeUndefined();
    expect(preset.apiKeyUrl).toBeUndefined();
  });

  it("never matches a saved record (empty apiBase)", () => {
    expect(
      managedModelProviderPresetForRecord({
        protocol: "openai",
        authKind: "api_key",
        apiBase: "",
      }),
    ).toBeUndefined();
  });

  it("gets a neutral example URL placeholder per protocol", () => {
    const preset = getManagedModelProviderPreset(CUSTOM_ENDPOINT_PRESET_ID);
    expect(
      apiBasePlaceholderForManagedModelProviderPreset(preset, "openai"),
    ).toBe("https://api.example.com/v1");
    expect(
      apiBasePlaceholderForManagedModelProviderPreset(preset, "anthropic"),
    ).toBe("https://api.example.com/anthropic");
    // Named presets keep their own endpoint as the placeholder.
    expect(
      apiBasePlaceholderForManagedModelProviderPreset(
        getManagedModelProviderPreset("deepseek"),
        "anthropic",
      ),
    ).toBe("https://api.deepseek.com/anthropic");
  });

  it("is the edit card for unmatched api_key / no-auth endpoints; Codex OAuth keeps its own", () => {
    expect(customManagedModelProviderPresetId("api_key")).toBe(
      CUSTOM_ENDPOINT_PRESET_ID,
    );
    expect(customManagedModelProviderPresetId("none")).toBe(
      CUSTOM_ENDPOINT_PRESET_ID,
    );
    expect(customManagedModelProviderPresetId("chatgpt_codex_oauth")).toBe(
      "chatgpt-codex",
    );
  });
});

function providerRecord(
  overrides: Partial<ManagedModelProviderRecord>,
): ManagedModelProviderRecord {
  return {
    id: "mp_custom",
    displayName: "Custom Provider",
    protocol: "openai",
    authKind: "api_key",
    apiBase: "https://example.test/v1",
    apiKeyRef: "managed-provider:mp_custom",
    credentialStatus: "present",
    createdAt: "2026-06-29T00:00:00Z",
    updatedAt: "2026-06-29T00:00:00Z",
    ...overrides,
  };
}
