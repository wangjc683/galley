import type { ProbeState } from "@/lib/provider-setup";

// The provider-form vocabulary moved to the shared provider-setup core
// (lib/provider-setup.ts) when onboarding and settings converged on
// one controller; re-exported here so the settings-local imports keep
// working unchanged.
export type {
  ProbeAction,
  ProbeState,
  ProviderFormState,
  SettingsModelsCopy,
} from "@/lib/provider-setup";

export type ProbeStateMap = Record<string, ProbeState>;

export type ModelDraftState = {
  providerId: string;
  id?: string;
  model: string;
  displayName: string;
  advancedOptions: Record<string, unknown>;
  recommendedAdvancedOptions: Record<string, unknown>;
};

export type ModelMoveDirection = "up" | "down";

export type ModelMoveFeedbackState = {
  movedId: string;
  swappedId: string;
  direction: ModelMoveDirection;
  nonce: number;
};
