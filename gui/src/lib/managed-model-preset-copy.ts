import type { AppCopy } from "@/i18n/types";
import type { ManagedModelProviderPresetId } from "@/lib/managed-model-presets";

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
