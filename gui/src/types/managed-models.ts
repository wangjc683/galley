export type ManagedModelProtocol = "anthropic" | "openai";

export type ManagedModelAuthKind = "api_key" | "chatgpt_codex_oauth" | "none";

export type ManagedModelCredentialStatus = "present" | "missing" | "unknown";

export interface ManagedModelProviderRecord {
  id: string;
  displayName: string;
  protocol: ManagedModelProtocol;
  authKind: ManagedModelAuthKind;
  apiBase: string;
  apiKeyRef: string;
  credentialStatus: ManagedModelCredentialStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SaveManagedProviderInput {
  id?: string;
  displayName?: string;
  protocol: ManagedModelProtocol;
  authKind?: ManagedModelAuthKind;
  apiBase: string;
  apiKey?: string;
}

export interface ManagedModelRecord {
  id: string;
  providerId: string;
  providerDisplayName: string;
  displayName: string;
  protocol: ManagedModelProtocol;
  authKind: ManagedModelAuthKind;
  apiBase: string;
  model: string;
  apiKeyRef: string;
  /**
   * The preset-layer snapshot written at creation from the provider
   * preset. Holds the protocol-dialect keys (`api_mode`,
   * `thinking_type`, `fake_cc_system_prompt`, `codex_backend`), the
   * non-UI keys (`context_win`, `temperature`, `connect_timeout`) and
   * the preset's own values for the layered keys. The user never edits
   * it directly.
   */
  presetOptions: Record<string, unknown>;
  /**
   * Only the keys where this model deviates from its baseline
   * (`presetOptions` ⊕ the global defaults). A JSON `null` value is a
   * tombstone: "unset this key entirely (do not send it)".
   */
  advancedOverrides: Record<string, unknown>;
  /**
   * The EFFECTIVE merged object Core computed
   * (`presetOptions` ⊕ defaults ⊕ `advancedOverrides`) — what the
   * runtime actually uses. Everything that asks "what does this model
   * really do?" (composer effort pill, saved-model connection tests)
   * reads this.
   */
  advancedOptions: Record<string, unknown>;
  isDefault: boolean;
  sortOrder: number;
  credentialStatus: ManagedModelCredentialStatus;
  lastValidatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveManagedModelInput {
  id?: string;
  providerId: string;
  displayName?: string;
  model: string;
  /** Preset-layer seed. Pass when creating a model; omit on an edit
   * and Core keeps the stored one. */
  presetOptions?: Record<string, unknown>;
  /** Replaces the stored overrides wholesale — `{}` clears them. */
  advancedOverrides?: Record<string, unknown>;
  makeDefault?: boolean;
}

export interface ReorderManagedModelsInput {
  modelIds: string[];
}

export interface ManagedModelProbeInput {
  id?: string;
  providerId?: string;
  protocol: ManagedModelProtocol;
  authKind?: ManagedModelAuthKind;
  apiBase: string;
  apiKey?: string;
  model?: string;
  advancedOptions?: Record<string, unknown>;
}

export interface ManagedModelListResult {
  models: string[];
  endpoint: string;
}

export interface ManagedModelConnectionResult {
  ok: boolean;
  endpoint: string;
  modelFound?: boolean | null;
  message: string;
}
