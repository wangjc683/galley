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
  advancedOptions?: Record<string, unknown>;
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
