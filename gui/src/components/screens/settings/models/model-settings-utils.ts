import { managedModelProtocolLabel } from "@/lib/managed-model-presets";
import type {
  ManagedModelRecord,
  ManagedModelProtocol,
} from "@/types/managed-models";

import type { ModelDraftState, ModelMoveFeedbackState } from "./types";

// Form builders + the connection success message moved to the shared
// provider-setup core (lib/provider-setup.ts); re-exported so the
// settings-local imports keep working unchanged.
export {
  connectionSuccessMessage,
  newProviderForm,
  providerFormFromPreset,
} from "@/lib/provider-setup";

export function modelDisplayParts(model: ManagedModelRecord): {
  title: string;
  subtitle?: string;
} {
  const modelName = model.model.trim();
  const displayName = model.displayName.trim();
  if (displayName !== "" && displayName !== modelName) {
    return { title: displayName, subtitle: modelName };
  }
  return { title: modelName || model.displayName };
}

const REASONING_EFFORT_TIERS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ReasoningEffortTier = (typeof REASONING_EFFORT_TIERS)[number];

/**
 * The model's explicitly-set reasoning tier, read from the stored
 * advanced-options snapshot — i.e. what the runtime actually sends,
 * never the preset-recommended overlay (old records haven't absorbed
 * it, and a badge showing an effort that isn't in effect would lie).
 * Null when unset: the provider decides, and the row shows no badge.
 * Mirrors the runner/GA coercion: the Codex backend has no minimal
 * tier and runs medium instead.
 */
export function modelReasoningEffortTier(
  model: ManagedModelRecord,
): ReasoningEffortTier | null {
  const raw = String(model.advancedOptions.reasoning_effort ?? "")
    .trim()
    .toLowerCase();
  if (!(REASONING_EFFORT_TIERS as readonly string[]).includes(raw)) {
    return null;
  }
  if (raw === "minimal" && model.advancedOptions.codex_backend === true) {
    return "medium";
  }
  return raw as ReasoningEffortTier;
}

export function normalizedModelDisplayName(draft: ModelDraftState): string {
  const displayName = draft.displayName.trim();
  if (displayName === "" || displayName === draft.model.trim()) {
    return "";
  }
  return displayName;
}

export function applyModelOrder(
  models: ManagedModelRecord[],
  orderedIds: string[] | null,
): ManagedModelRecord[] {
  if (!orderedIds) return models;
  const modelById = new Map(models.map((model) => [model.id, model]));
  const ordered = orderedIds
    .map((id) => modelById.get(id))
    .filter((model): model is ManagedModelRecord => Boolean(model));
  const orderedIdSet = new Set(orderedIds);
  const remaining = models.filter((model) => !orderedIdSet.has(model.id));
  if (ordered.length === 0) return models;
  return [...ordered, ...remaining];
}

export function modelSwapAnimationClass(
  modelId: string,
  feedback: ModelMoveFeedbackState | null,
): string | undefined {
  if (!feedback) return undefined;
  if (modelId === feedback.movedId) {
    return feedback.direction === "up"
      ? "model-row-swap-up"
      : "model-row-swap-down";
  }
  if (modelId === feedback.swappedId) {
    return feedback.direction === "up"
      ? "model-row-swap-down"
      : "model-row-swap-up";
  }
  return undefined;
}

export function protocolLabel(protocol: ManagedModelProtocol): string {
  return managedModelProtocolLabel(protocol);
}
