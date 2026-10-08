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
  /** Preset-layer seed. Sent to Core only when creating the model;
   * an edit draft carries the stored one for baseline maths. */
  presetOptions: Record<string, unknown>;
  /** Only this model's deviations from `presetOptions` ⊕ the global
   * defaults. `null` values are "unset this key" tombstones. */
  advancedOverrides: Record<string, unknown>;
};

/** An editor that just refused to be replaced because it holds unsaved
 * input: `flash` = the one-shot highlight (on for a moment, then off —
 * a transition, not a keyframe loop); `hint` = the 「先保存或关闭当前编辑」
 * line, kept until the next edit / save / close of that editor. */
export type EditorBlockedState = {
  flash: boolean;
  hint: boolean;
};

export type ModelMoveDirection = "up" | "down";

export type ModelMoveFeedbackState = {
  movedId: string;
  swappedId: string;
  direction: ModelMoveDirection;
  nonce: number;
};
