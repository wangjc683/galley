import type { AppCopy } from "@/i18n/types";
import {
  CUSTOM_ENDPOINT_PRESET_ID,
  type ManagedModelProviderPreset,
  type ManagedModelProviderPresetId,
} from "@/lib/managed-model-presets";
import type { ManagedModelProtocol } from "@/types/managed-models";

/** Localized protocol name — the same words as the Custom card's
 * protocol control, so the picker badge and the Provider card's
 * protocol chip read 「OpenAI 兼容」 / "OpenAI-compatible" alike. */
export function managedModelProtocolLabel(
  copy: AppCopy["settings"]["models"],
  protocol: ManagedModelProtocol,
): string {
  return protocol === "openai"
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

/** Localized one-line description for a provider preset — shared by the
 * Settings popover picker and the Onboarding card grid. */
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
