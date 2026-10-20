import { invoke } from "@tauri-apps/api/core";

import type {
  ManagedModelConnectionResult,
  ManagedModelListResult,
  ManagedModelProbeInput,
  ManagedModelProviderRecord,
  ManagedModelRecord,
  ReorderManagedModelsInput,
  SaveManagedModelInput,
  SaveManagedProviderInput,
} from "@/types/managed-models";

/** Tauri event (empty payload) Core emits after something other than
 * this page changed the managed model store — the CLI's
 * `galley llm set-default` (`core/src/api/model.rs`
 * `MANAGED_MODELS_CHANGED_EVENT`). Re-list, as after a save here. */
export const MANAGED_MODELS_CHANGED_EVENT = "managed-models:changed";

export async function listManagedModelProviders(): Promise<
  ManagedModelProviderRecord[]
> {
  return invoke<ManagedModelProviderRecord[]>("list_managed_model_providers");
}

export async function saveManagedModelProvider(
  input: SaveManagedProviderInput,
): Promise<ManagedModelProviderRecord> {
  return invoke<ManagedModelProviderRecord>("save_managed_model_provider", {
    input,
  });
}

export async function deleteManagedModelProvider(id: string): Promise<void> {
  await invoke("delete_managed_model_provider", { id });
}

export async function listManagedModels(): Promise<ManagedModelRecord[]> {
  return invoke<ManagedModelRecord[]>("list_managed_models");
}

export async function saveManagedModel(
  input: SaveManagedModelInput,
): Promise<ManagedModelRecord> {
  return invoke<ManagedModelRecord>("save_managed_model", { input });
}

/** The global defaults layer — only the user's deviations from the
 * factory recommended values, filtered by Core to the six layered
 * keys. An empty object means "all recommended". */
export async function getManagedModelDefaults(): Promise<
  Record<string, unknown>
> {
  return invoke<Record<string, unknown>>("get_managed_model_defaults");
}

/** Store the defaults layer and return Core's normalised version of it.
 * Every model's effective `advancedOptions` changes with it, so the
 * caller must re-list models afterwards. */
export async function setManagedModelDefaults(
  defaults: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("set_managed_model_defaults", {
    input: { defaults },
  });
}

export async function deleteManagedModel(id: string): Promise<void> {
  await invoke("delete_managed_model", { id });
}

export async function reorderManagedModels(
  input: ReorderManagedModelsInput,
): Promise<void> {
  await invoke("reorder_managed_models", { input });
}

export async function listManagedModelOptions(
  input: ManagedModelProbeInput,
): Promise<ManagedModelListResult> {
  return invoke<ManagedModelListResult>("list_managed_model_options", {
    input,
  });
}

export async function testManagedModelConnection(
  input: ManagedModelProbeInput,
): Promise<ManagedModelConnectionResult> {
  return invoke<ManagedModelConnectionResult>(
    "test_managed_model_connection",
    { input },
  );
}

// Sign in with ChatGPT (.scratch/chatgpt-siwc ticket 02;
// `core/src/chatgpt_siwc/`). Errors reject with the JSON string
// `{"error": <code>, "message": ...}`; see `chatGptPlanErrorCode`.

export interface ChatGptPlanLoginStart {
  loginId: string;
  /** Open in the browser. May carry `id_token_hint`: never log it. */
  authUrl: string;
  /** RFC 3339; the loopback listener closes then (10 minutes). */
  expiresAt: string;
}

export interface ChatGptPlanModel {
  slug: string;
  displayName: string;
  contextWindow: number | null;
  supportedReasoningLevels: string[];
  defaultReasoningLevel: string | null;
}

export interface ChatGptPlanModelList {
  models: ChatGptPlanModel[];
  endpoint: string;
}

export interface ChatGptPlanStatus {
  /** `"siwc"` when a Sign in with ChatGPT credential is stored; `null`
   * when none (a leftover Codex CLI login credential counts as none). */
  flow: "siwc" | null;
  signedIn: boolean;
  /** SIWC tokens were cleared after a dead refresh or a revocation. */
  needsReauth: boolean;
  /** This installation has a SIWC client registration (kept on sign-out). */
  registered: boolean;
  scopes: string[];
  /** Unix seconds. */
  expiresAt: number | null;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
}

/** A completed sign-in: the ChatGPT provider Core created or took over,
 * its model, and the connection test Core ran right after. */
export interface ChatGptPlanSignInResult {
  provider: ManagedModelProviderRecord;
  model: ManagedModelRecord;
  status: ManagedModelConnectionResult;
}

export interface ChatGptPlanLogoutResult {
  remoteRevokeConfirmed: boolean;
}

export type ChatGptPlanErrorCode =
  | "chatgpt_plan_access_denied"
  | "chatgpt_plan_usage_not_granted"
  | "chatgpt_plan_login_cancelled"
  | "chatgpt_plan_login_timed_out"
  | "chatgpt_plan_login_not_found"
  | "chatgpt_plan_reauth_required"
  | "chatgpt_plan_temporary"
  | "chatgpt_plan_failed";

const CHATGPT_PLAN_ERROR_CODES: readonly string[] = [
  "chatgpt_plan_access_denied",
  "chatgpt_plan_usage_not_granted",
  "chatgpt_plan_login_cancelled",
  "chatgpt_plan_login_timed_out",
  "chatgpt_plan_login_not_found",
  "chatgpt_plan_reauth_required",
  "chatgpt_plan_temporary",
  "chatgpt_plan_failed",
];

/** The plan error code of a rejected Sign in with ChatGPT command, or
 * `null` for any other error (e.g. a plain Core `invalid_args`). */
export function chatGptPlanErrorCode(
  error: unknown,
): ChatGptPlanErrorCode | null {
  if (typeof error !== "string") return null;
  try {
    const parsed = JSON.parse(error) as { error?: unknown };
    return typeof parsed.error === "string" &&
      CHATGPT_PLAN_ERROR_CODES.includes(parsed.error)
      ? (parsed.error as ChatGptPlanErrorCode)
      : null;
  } catch {
    return null;
  }
}

/** Opens a one-shot loopback listener and returns the URL to open. A
 * newer start cancels the pending one. */
export async function startChatGptPlanLogin(): Promise<ChatGptPlanLoginStart> {
  return invoke<ChatGptPlanLoginStart>("start_chatgpt_plan_login");
}

/** Waits for the browser callback, then signs in, takes over the ChatGPT
 * provider and runs one connection test. */
export async function completeChatGptPlanLogin(
  loginId: string,
): Promise<ChatGptPlanSignInResult> {
  return invoke<ChatGptPlanSignInResult>("complete_chatgpt_plan_login", {
    input: { loginId },
  });
}

/** Closes the pending sign-in (only `loginId`'s, when given). */
export async function cancelChatGptPlanLogin(loginId?: string): Promise<void> {
  await invoke("cancel_chatgpt_plan_login", { input: { loginId } });
}

export async function listChatGptPlanModels(
  providerId?: string,
): Promise<ChatGptPlanModelList> {
  return invoke<ChatGptPlanModelList>("list_chatgpt_plan_models", {
    input: { providerId },
  });
}

export async function getChatGptPlanStatus(
  providerId?: string,
): Promise<ChatGptPlanStatus> {
  return invoke<ChatGptPlanStatus>("get_chatgpt_plan_status", {
    input: { providerId },
  });
}

/** Signs out: revokes, then clears the tokens (keeps the registration). */
export async function logoutChatGptPlan(
  providerId?: string,
): Promise<ChatGptPlanLogoutResult> {
  return invoke<ChatGptPlanLogoutResult>("logout_chatgpt_plan", {
    input: { providerId },
  });
}

export interface TimedManagedModelConnectionResult
  extends ManagedModelConnectionResult {
  latencyMs: number;
}

export async function testManagedModelConnectionWithLatency(
  input: ManagedModelProbeInput,
): Promise<TimedManagedModelConnectionResult> {
  const start = nowMs();
  const result = await testManagedModelConnection(input);
  return {
    ...result,
    latencyMs: Math.max(0, Math.round(nowMs() - start)),
  };
}

type ManagedModelProbeErrorCopy = {
  actionFailed: string;
  errorUnauthorized: string;
  errorForbidden: string;
  errorRateLimited: string;
  errorNotFound: string;
  errorServer: (status: number) => string;
  errorTimeout: string;
  errorNetwork: string;
  errorUnknownWithDetail: (detail: string) => string;
};

/**
 * Probe state for a failed model-list fetch. A "soft" failure — the
 * endpoint answered, but has no usable listing (Anthropic-compatible
 * endpoints without /models, HTML gateways) — is not an error: the
 * flow is designed to continue via manual entry, and the earlier
 * error-kind state made the UI wear the reassuring fallback copy in
 * an error frame AND duplicate it in the InfoLine right below. Soft
 * failures land in the same success/no-list state as a genuinely
 * empty listing; auth / rate-limit / server failures stay errors.
 * Structural return type (not ProbeState) because provider-setup.ts
 * imports from this module.
 */
export function modelListProbeFailureState(
  error: unknown,
  copy: ManagedModelProbeErrorCopy & { connectedNoModels: string },
): { kind: "success" | "error"; action: "model-list"; message: string } {
  const detail = extractErrorMessage(error);
  if (isSoftModelListFailure(detail, extractHttpStatus(detail))) {
    return {
      kind: "success",
      action: "model-list",
      message: copy.connectedNoModels,
    };
  }
  return {
    kind: "error",
    action: "model-list",
    message: managedModelProbeErrorMessage(error, copy),
  };
}

export function managedModelProbeErrorMessage(
  error: unknown,
  copy: ManagedModelProbeErrorCopy,
): string {
  const detail = extractErrorMessage(error);
  const status = extractHttpStatus(detail);
  if (status === 401) return copy.errorUnauthorized;
  if (status === 403) return copy.errorForbidden;
  if (status === 404) return copy.errorNotFound;
  if (status === 429) return copy.errorRateLimited;
  if (status && status >= 500) return copy.errorServer(status);

  const normalized = detail.toLowerCase();
  if (
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("deadline")
  ) {
    return copy.errorTimeout;
  }
  if (
    normalized.includes("network") ||
    normalized.includes("dns") ||
    normalized.includes("failed to lookup") ||
    normalized.includes("connection refused") ||
    normalized.includes("connection reset") ||
    normalized.includes("error sending request") ||
    normalized.includes("request failed")
  ) {
    return copy.errorNetwork;
  }

  return detail ? copy.errorUnknownWithDetail(detail) : copy.actionFailed;
}

function isSoftModelListFailure(
  detail: string,
  status: number | undefined,
): boolean {
  const normalized = detail.toLowerCase();
  const isModelListFailure =
    detail.includes("无法获取模型列表") ||
    normalized.includes("model list response is not json");
  if (!isModelListFailure) return false;
  if (status === 401 || status === 403 || status === 429) return false;
  if (status && status >= 500) return false;
  return true;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error) as { message?: unknown };
      return typeof parsed.message === "string" ? parsed.message : error;
    } catch {
      return error;
    }
  }
  if (error instanceof Error) return error.message;
  return "";
}

function extractHttpStatus(message: string): number | undefined {
  const match = message.match(/\bHTTP\s+(\d{3})\b/i);
  if (!match) return undefined;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : undefined;
}
