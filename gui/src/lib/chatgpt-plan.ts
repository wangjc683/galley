/**
 * Sign in with ChatGPT on the GUI side (.scratch/chatgpt-siwc ticket 04):
 * the pure parts the provider-setup controller, the provider card and the
 * composer share — the sign-in state, what a failed sign-in says, the
 * one-call guard on `complete_chatgpt_plan_login`, what a sign-in whose
 * connection test failed says, the one-time notice's mark, and which
 * models spend the ChatGPT plan.
 *
 * The flow and the token never come here: Core owns both
 * (`core/src/chatgpt_siwc/`). Never log the authorize URL (it may carry
 * `id_token_hint`).
 */
import type { AppCopy } from "@/lib/i18n";
import {
  chatGptPlanErrorCode,
  completeChatGptPlanLogin,
  managedModelProbeErrorMessage,
  type ChatGptPlanStatus,
  type CodexAuthSetupResult,
} from "@/lib/managed-models";
import type {
  ManagedModelConnectionResult,
  ManagedModelProviderRecord,
  ManagedModelRecord,
} from "@/types/managed-models";

/** Where OpenAI's guidelines send "Manage usage". */
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/** One sign-in at a time per surface: the button, the wait for the
 * browser (with a cancel), or what went wrong. */
export type ChatGptPlanLoginState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "waiting"; loginId: string }
  | { phase: "error"; message: string };

export const CHATGPT_PLAN_LOGIN_IDLE: ChatGptPlanLoginState = { phase: "idle" };

/** A failed sign-in either goes back to the button without a word (the
 * user cancelled, or the ten minutes ran out) or says what happened. */
export type ChatGptPlanLoginFailure =
  | { kind: "reset" }
  | { kind: "error"; message: string };

export function chatGptPlanLoginFailure(
  error: unknown,
  copy: {
    plan: AppCopy["chatgptPlan"];
    models: AppCopy["settings"]["models"];
  },
): ChatGptPlanLoginFailure {
  switch (chatGptPlanErrorCode(error)) {
    case "chatgpt_plan_access_denied":
      return { kind: "error", message: copy.plan.accessDenied };
    case "chatgpt_plan_usage_not_granted":
      return { kind: "error", message: copy.plan.usageNotGranted };
    // Cancelled, timed out, or the pending sign-in is gone (a newer one
    // replaced it): nothing to report, back to the button.
    case "chatgpt_plan_login_timed_out":
    case "chatgpt_plan_login_cancelled":
    case "chatgpt_plan_login_not_found":
      return { kind: "reset" };
    case "chatgpt_plan_temporary":
      return { kind: "error", message: copy.plan.temporary };
    case "chatgpt_plan_failed":
    case "chatgpt_plan_reauth_required": {
      const detail = planErrorMessage(error);
      return {
        kind: "error",
        message: detail ? copy.plan.failed(detail) : copy.models.actionFailed,
      };
    }
    default:
      // Not a plan error (a plain Core error, the browser not opening):
      // the generic probe wording.
      return {
        kind: "error",
        message: managedModelProbeErrorMessage(error, copy.models),
      };
  }
}

function planErrorMessage(error: unknown): string {
  if (typeof error !== "string") return "";
  try {
    const parsed = JSON.parse(error) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message.trim() : "";
  } catch {
    return "";
  }
}

/**
 * `complete_chatgpt_plan_login` may run once per `loginId` (Core's
 * contract): a second call for the same id answers `login_not_found`
 * while the first is still waiting for the browser. The guard hands any
 * repeat — a double click, React StrictMode running an effect twice —
 * the first call's promise instead of a second call.
 */
export function createCompleteOnce(
  complete: (loginId: string) => Promise<CodexAuthSetupResult>,
): (loginId: string) => Promise<CodexAuthSetupResult> {
  const calls = new Map<string, Promise<CodexAuthSetupResult>>();
  return (loginId) => {
    const existing = calls.get(loginId);
    if (existing) return existing;
    const call = complete(loginId);
    calls.set(loginId, call);
    return call;
  };
}

export const completeChatGptPlanLoginOnce = createCompleteOnce(
  completeChatGptPlanLogin,
);

// ---- After the callback: the connection test ------------------------------

/** The plan error code a plan Galley can't use answers with (expected
 * as HTTP 403 on the connection test; Core puts the code in its
 * message, `core/src/chatgpt_siwc/probe.rs` `http_error`). */
const NOT_ELIGIBLE_PATTERN =
  /subscription_sharing_user_not_eligible|\bnot[_ ]eligible\b/i;

/**
 * What a completed sign-in's own connection test (`status`, run by Core
 * right after storing the credential) says: nothing when it passed; else
 * the words to stay on the sign-in with. The provider and credential
 * Core saved stay either way — signing in again or signing out are the
 * ways on. A plan that is not eligible gets its own words: Plus / Pro
 * work, an API key provider is the way round.
 */
export function chatGptPlanTestFailure(
  status: ManagedModelConnectionResult,
  plan: AppCopy["chatgptPlan"],
): string | null {
  if (status.ok) return null;
  const detail = status.message.trim();
  if (NOT_ELIGIBLE_PATTERN.test(detail)) return plan.notEligible;
  return plan.testFailed(detail || status.endpoint);
}

/**
 * The tail of a sign-in once the browser called back: complete it (once
 * for this login id), bring the model store and the plan status up to
 * date — the provider is saved even when the test failed — and say
 * whether the sign-in can be used (`failure: null`) or what is wrong.
 */
export async function finishChatGptPlanSignIn(
  deps: {
    complete: (loginId: string) => Promise<CodexAuthSetupResult>;
    loadManagedModels: () => Promise<unknown>;
    refreshStatus: (providerId: string) => unknown;
  },
  loginId: string,
  plan: AppCopy["chatgptPlan"],
): Promise<{ providerId: string; failure: string | null }> {
  const result = await deps.complete(loginId);
  await deps.loadManagedModels();
  void deps.refreshStatus(result.provider.id);
  return {
    providerId: result.provider.id,
    failure: chatGptPlanTestFailure(result.status, plan),
  };
}

// ---- The one-time notice -------------------------------------------------

export const CHATGPT_PLAN_NOTICE_KEY = "galley.chatgptPlanNoticeShown";

type NoticeStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): NoticeStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * OpenAI asks for the notice after the first sign-in on this machine
 * only. True when this call takes that one showing: the mark was not
 * there and is now written. Storage that cannot be read or written means
 * no notice and no error — showing it on every sign-in would be worse
 * than missing it once.
 */
export function claimChatGptPlanNotice(
  storage: NoticeStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(CHATGPT_PLAN_NOTICE_KEY) === "1") return false;
    storage.setItem(CHATGPT_PLAN_NOTICE_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

// ---- Which providers and models are on the plan ---------------------------

/** The ChatGPT providers among these models (the auth kind Sign in with
 * ChatGPT shares with the Codex CLI login until ticket 05). */
export function chatGptProviderIds(models: ManagedModelRecord[]): string[] {
  return [
    ...new Set(
      models
        .filter((model) => model.authKind === "chatgpt_codex_oauth")
        .map((model) => model.providerId),
    ),
  ].sort();
}

/** The models that spend the ChatGPT plan: on a ChatGPT provider whose
 * stored credential came from Sign in with ChatGPT. */
export function chatGptPlanModelIds(
  models: ManagedModelRecord[],
  statusByProvider: Readonly<Record<string, ChatGptPlanStatus | undefined>>,
): Set<string> {
  return new Set(
    models
      .filter(
        (model) =>
          model.authKind === "chatgpt_codex_oauth" &&
          statusByProvider[model.providerId]?.flow === "siwc",
      )
      .map((model) => model.id),
  );
}

/** A ChatGPT provider that has to be signed in to again: no credential,
 * or a Sign in with ChatGPT one whose tokens Core cleared (the row stays
 * `present` then, so only the plan status knows). */
export function chatGptSignInNeeded(
  provider: Pick<ManagedModelProviderRecord, "authKind" | "credentialStatus">,
  status: ChatGptPlanStatus | undefined,
): boolean {
  return (
    provider.authKind === "chatgpt_codex_oauth" &&
    (provider.credentialStatus === "missing" || status?.needsReauth === true)
  );
}
