import type { AppCopy } from "@/i18n/types";
import {
  CUSTOM_ENDPOINT_PRESET_ID,
  managedModelProviderPresetForRecord,
  type ManagedModelProviderPreset,
  type ManagedModelProviderPresetId,
} from "@/lib/managed-model-presets";
import type { ManagedModelProviderRecord } from "@/types/managed-models";

/** The cards whose canonical address is the vendor's own API. */
const OFFICIAL_API_PRESET_IDS: ReadonlySet<ManagedModelProviderPresetId> =
  new Set(["custom-openai", "custom-anthropic"]);

/** The small text after a provider's name: how it is reached, not just
 * its protocol (SIWC decision 15, 2026-10-20). 「ChatGPT 订阅」 for the
 * ChatGPT provider; 「官方 API」 when the address is the OpenAI or
 * Anthropic card's own (the record-to-card match the edit form and the
 * new-model preset layer use, on the trimmed address, so an official
 * card pointed at a relay drops back); otherwise the protocol, in the
 * Custom card's protocol-control words 「OpenAI 兼容」 /
 * 「Anthropic 兼容」. One function for the provider card, the create
 * form's picker and the forms' read-only card line. */
export function providerConnectionLabel(
  copy: AppCopy["settings"]["models"],
  provider: Pick<
    ManagedModelProviderRecord,
    "protocol" | "authKind" | "apiBase"
  >,
): string {
  if (provider.authKind === "chatgpt_codex_oauth") {
    return copy.chatgptPlanConnection;
  }
  const preset = managedModelProviderPresetForRecord({
    ...provider,
    apiBase: provider.apiBase.trim(),
  });
  if (preset && OFFICIAL_API_PRESET_IDS.has(preset.id)) {
    return copy.officialApiConnection;
  }
  return provider.protocol === "openai"
    ? copy.openaiCompatibleProtocol
    : copy.anthropicCompatibleProtocol;
}

/** Display label for a provider preset. Named presets show their brand
 * name verbatim; only the neutral Custom card is localized. */
export function providerPresetLabel(
  copy: AppCopy["settings"]["models"],
  preset: ManagedModelProviderPreset,
): string {
  return preset.id === CUSTOM_ENDPOINT_PRESET_ID
    ? copy.customPresetLabel
    : preset.label;
}

/** Localized one-line description for a provider preset — shared by
 * Settings' 「添加」 menu, the zero-provider form's picker and the
 * Onboarding card grid. */
export function providerPresetDescription(
  copy: AppCopy["settings"]["models"],
  presetId: ManagedModelProviderPresetId,
): string | null {
  switch (presetId) {
    case "custom-openai":
      return copy.openaiPresetDescription;
    case "custom-anthropic":
      return copy.anthropicPresetDescription;
    case CUSTOM_ENDPOINT_PRESET_ID:
      return copy.customPresetDescription;
    case "chatgpt-codex":
      return copy.chatgptCodexPresetDescription;
    case "deepseek":
      return copy.deepseekPresetDescription;
    case "kimi-coding":
      return copy.kimiCodingPresetDescription;
    case "minimax":
      return copy.minimaxPresetDescription;
    case "openrouter":
      return copy.openrouterPresetDescription;
    case "siliconflow":
      return copy.siliconflowPresetDescription;
    case "xiaomi-mimo":
      return copy.xiaomiMimoPresetDescription;
    case "zhipu-glm":
      return copy.zhipuGlmPresetDescription;
    default:
      return null;
  }
}
