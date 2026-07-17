import type {
  ManagedModelAuthKind,
  ManagedModelProtocol,
  ManagedModelProviderRecord,
} from "@/types/managed-models";

const DEFAULT_MODEL_PLACEHOLDER = "model-name";

// GA trims conversation history to `context_win × 3` chars before each LLM
// call (GA llmcore.py trim_messages_history). GA's own default is only 30000,
// so older turns get dropped after a few heavy rounds and the model "forgets"
// recent context. Raise it to a value that stays safe for the 128K+ windows
// all named presets target, while leaving headroom for system prompt + tools
// schema + response. Surfaced as an advanced option, so users on a smaller
// custom-endpoint model can lower it in Settings.
const DEFAULT_CONTEXT_WIN = 90000;

export type ManagedModelProviderPresetId =
  | "chatgpt-codex"
  | "deepseek"
  | "kimi-coding"
  | "minimax"
  | "openrouter"
  | "siliconflow"
  | "xiaomi-mimo"
  | "zhipu-glm"
  | "custom-anthropic"
  | "custom-openai";

export interface ManagedModelProviderPreset {
  id: ManagedModelProviderPresetId;
  label: string;
  protocol: ManagedModelProtocol;
  authKind?: ManagedModelAuthKind;
  apiBase: string;
  model: string;
  displayName: string;
  apiKeyPlaceholder?: string;
  modelPlaceholder?: string;
  advancedOptions?: Record<string, unknown>;
}

export interface ManagedModelProviderPresetDraft {
  providerPresetId: ManagedModelProviderPresetId;
  protocol: ManagedModelProtocol;
  authKind?: ManagedModelAuthKind;
  apiBase: string;
  model: string;
  displayName: string;
  advancedOptions?: Record<string, unknown>;
}

export function managedModelProtocolAdvancedDefaults(
  protocol: ManagedModelProtocol,
): Record<string, unknown> {
  if (protocol === "openai") {
    return {
      context_win: DEFAULT_CONTEXT_WIN,
      api_mode: "chat_completions",
      temperature: 1,
      max_retries: 3,
      connect_timeout: 10,
      read_timeout: 180,
      stream: true,
    };
  }
  return {
    context_win: DEFAULT_CONTEXT_WIN,
    thinking_type: "adaptive",
    temperature: 1,
    max_retries: 3,
    connect_timeout: 10,
    read_timeout: 180,
    stream: true,
  };
}

export const MANAGED_MODEL_PROVIDER_PRESETS: ManagedModelProviderPreset[] = [
  {
    id: "chatgpt-codex",
    label: "ChatGPT / Codex",
    protocol: "openai",
    authKind: "chatgpt_codex_oauth",
    apiBase: "https://chatgpt.com/backend-api/codex",
    model: "gpt-5.6-sol",
    displayName: "ChatGPT / Codex",
    modelPlaceholder: "gpt-5.6-sol",
    advancedOptions: {
      context_win: DEFAULT_CONTEXT_WIN,
      api_mode: "responses",
      reasoning_effort: "medium",
      temperature: 1,
      max_retries: 3,
      connect_timeout: 10,
      read_timeout: 180,
      stream: true,
      codex_backend: true,
    },
  },
  {
    id: "custom-openai",
    label: "OpenAI",
    protocol: "openai",
    apiBase: "https://api.openai.com/v1",
    model: "",
    displayName: "OpenAI",
    modelPlaceholder: "gpt-5.6-sol",
    advancedOptions: managedModelProtocolAdvancedDefaults("openai"),
  },
  {
    id: "custom-anthropic",
    label: "Anthropic",
    protocol: "anthropic",
    apiBase: "https://api.anthropic.com",
    model: "",
    displayName: "Anthropic",
    modelPlaceholder: "claude-opus-4-8",
    advancedOptions: managedModelProtocolAdvancedDefaults("anthropic"),
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "anthropic",
    apiBase: "https://api.deepseek.com/anthropic",
    model: "deepseek-v4-pro",
    displayName: "DeepSeek",
    modelPlaceholder: "deepseek-v4-pro",
    advancedOptions: {
      context_win: DEFAULT_CONTEXT_WIN,
      thinking_type: "adaptive",
      max_retries: 3,
      read_timeout: 180,
      stream: true,
    },
  },
  {
    id: "kimi-coding",
    label: "Kimi for Coding",
    protocol: "anthropic",
    apiBase: "https://api.kimi.com/coding",
    model: "k3",
    displayName: "Kimi",
    modelPlaceholder: "k3",
    advancedOptions: {
      context_win: DEFAULT_CONTEXT_WIN,
      fake_cc_system_prompt: true,
      thinking_type: "adaptive",
      max_retries: 3,
      read_timeout: 180,
      stream: true,
    },
  },
  {
    id: "minimax",
    label: "MiniMax",
    protocol: "anthropic",
    apiBase: "https://api.minimaxi.com/anthropic",
    model: "MiniMax-M3",
    displayName: "MiniMax",
    modelPlaceholder: "MiniMax-M3",
    advancedOptions: {
      context_win: DEFAULT_CONTEXT_WIN,
      max_retries: 3,
      read_timeout: 180,
      stream: true,
    },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai",
    apiBase: "https://openrouter.ai/api/v1",
    model: "",
    displayName: "OpenRouter",
    modelPlaceholder: "anthropic/claude-sonnet-4.5",
    advancedOptions: {
      context_win: DEFAULT_CONTEXT_WIN,
      api_mode: "chat_completions",
      max_retries: 3,
      read_timeout: 180,
      stream: true,
    },
  },
  {
    id: "siliconflow",
    label: "SiliconFlow",
    protocol: "openai",
    apiBase: "https://api.siliconflow.cn/v1",
    model: "",
    displayName: "SiliconFlow",
    advancedOptions: {
      context_win: DEFAULT_CONTEXT_WIN,
      api_mode: "chat_completions",
      max_retries: 3,
      read_timeout: 180,
      stream: true,
    },
  },
  {
    id: "xiaomi-mimo",
    label: "Xiaomi MiMo",
    protocol: "anthropic",
    apiBase: "https://token-plan-cn.xiaomimimo.com/anthropic",
    model: "mimo-v2.5-pro",
    displayName: "Xiaomi MiMo",
    apiKeyPlaceholder: "tp-xxxxx",
    modelPlaceholder: "mimo-v2.5-pro",
    advancedOptions: {
      context_win: DEFAULT_CONTEXT_WIN,
      max_retries: 3,
      read_timeout: 180,
      stream: true,
    },
  },
  {
    id: "zhipu-glm",
    label: "Zhipu GLM",
    protocol: "anthropic",
    apiBase: "https://open.bigmodel.cn/api/anthropic",
    model: "glm-5.2",
    displayName: "ZAI",
    modelPlaceholder: "glm-5.2",
    advancedOptions: {
      context_win: DEFAULT_CONTEXT_WIN,
      max_retries: 3,
      read_timeout: 180,
      stream: true,
    },
  },
];

export function getManagedModelProviderPreset(
  providerPresetId: ManagedModelProviderPresetId,
): ManagedModelProviderPreset {
  return (
    MANAGED_MODEL_PROVIDER_PRESETS.find(
      (preset) => preset.id === providerPresetId,
    ) ?? MANAGED_MODEL_PROVIDER_PRESETS[0]
  );
}

export function managedModelProviderPresetDraft(
  providerPresetId: ManagedModelProviderPresetId,
): ManagedModelProviderPresetDraft {
  const preset = getManagedModelProviderPreset(providerPresetId);
  return {
    providerPresetId,
    protocol: preset.protocol,
    authKind: preset.authKind,
    apiBase: preset.apiBase,
    model: preset.model,
    displayName: preset.displayName,
    advancedOptions:
      preset.advancedOptions ??
      managedModelProtocolAdvancedDefaults(preset.protocol),
  };
}

export function modelPlaceholderForManagedModelProviderPreset(
  preset: ManagedModelProviderPreset,
): string {
  return preset.modelPlaceholder ?? DEFAULT_MODEL_PLACEHOLDER;
}

export function customManagedModelProviderPresetId(
  protocol: ManagedModelProtocol,
  authKind: ManagedModelAuthKind = "api_key",
): ManagedModelProviderPresetId {
  if (authKind === "chatgpt_codex_oauth") return "chatgpt-codex";
  return protocol === "anthropic" ? "custom-anthropic" : "custom-openai";
}

export function advancedOptionsForManagedModelProvider(
  provider: ManagedModelProviderRecord,
): Record<string, unknown> | undefined {
  const preset = MANAGED_MODEL_PROVIDER_PRESETS.find(
    (item) =>
      item.advancedOptions &&
      item.protocol === provider.protocol &&
      (item.authKind ?? "api_key") === provider.authKind &&
      item.apiBase !== "" &&
      item.apiBase === provider.apiBase,
  );
  return preset?.advancedOptions;
}

export function recommendedAdvancedOptionsForManagedModelProvider(
  provider: ManagedModelProviderRecord,
): Record<string, unknown> {
  return (
    advancedOptionsForManagedModelProvider(provider) ??
    managedModelProtocolAdvancedDefaults(provider.protocol)
  );
}

export function managedModelProtocolLabel(
  protocol: ManagedModelProtocol,
): string {
  return protocol === "openai" ? "OpenAI-compatible" : "Anthropic-compatible";
}
