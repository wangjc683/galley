/**
 * ChatGPT plan errors in the conversation (.scratch/chatgpt-siwc PRD
 * rulings 7 and 8, ticket 04). The engine reports a failed plan request
 * as the turn's text, English, with the error code in it (patch 0007,
 * `managed-ga/code/llmcore.py` `_chatgpt_plan_error`), usually after
 * `!!!Error: ` and sometimes `HTTP <status>: `:
 *
 *   ChatGPT plan usage limit reached (subscription_sharing_usage_limit_exceeded): …
 *   This ChatGPT account cannot use its plan in Galley (subscription_sharing_user_not_eligible); …
 *   ChatGPT sign-in was revoked or disconnected (token_revoked); …
 *   Galley Codex credential refresh failed: … chatgpt_plan_reauth_required …
 *
 * Three of them get Galley's own words and a way on (OpenAI's guideline:
 * on a usage limit, "Manage usage" leads); the engine text stays one
 * click away. Other plan codes keep the engine text as it is.
 */
import type { AppCopy } from "@/lib/i18n";
import type {
  ManagedModelProbeInput,
  ManagedModelProviderRecord,
  ManagedModelRecord,
} from "@/types/managed-models";

export type ChatGptPlanErrorKind =
  | "usage_limit"
  | "revoked"
  | "reauth_required"
  | "not_eligible";

export interface ChatGptPlanErrorMatch {
  kind: ChatGptPlanErrorKind;
  /** The engine's error text, from its `!!!Error:` on. */
  raw: string;
  /** Whatever the turn said before the error (usually nothing). */
  before: string;
}

const ERROR_MARK = "!!!Error:";

/** Without the engine's mark, only a text that is the engine's sentence
 * itself counts — not a reply that happens to quote a code. */
const ENGINE_HEADS = [
  "HTTP ",
  "ChatGPT plan ",
  "ChatGPT sign-in ",
  "This ChatGPT account ",
  "Galley Codex credential refresh failed",
  "RuntimeError: Galley Codex credential refresh failed",
];

export function chatGptPlanErrorKind(
  text: string,
): ChatGptPlanErrorKind | null {
  if (text.includes("subscription_sharing_usage_limit_exceeded")) {
    return "usage_limit";
  }
  if (text.includes("subscription_sharing_user_not_eligible")) {
    return "not_eligible";
  }
  if (text.includes("chatgpt_plan_reauth_required")) return "reauth_required";
  if (/\btoken_revoked\b/.test(text)) return "revoked";
  return null;
}

export function findChatGptPlanError(
  text: string,
): ChatGptPlanErrorMatch | null {
  const mark = text.lastIndexOf(ERROR_MARK);
  const raw = (mark >= 0 ? text.slice(mark) : text).trim();
  if (mark < 0 && !ENGINE_HEADS.some((head) => raw.startsWith(head))) {
    return null;
  }
  const kind = chatGptPlanErrorKind(raw);
  if (!kind) return null;
  return { kind, raw, before: mark > 0 ? text.slice(0, mark).trim() : "" };
}

export type ChatGptPlanErrorAction =
  | "manage_usage"
  | "sign_in_settings"
  | "open_settings";

export interface ChatGptPlanErrorView {
  title: string | null;
  body: string;
  action: ChatGptPlanErrorAction;
  actionLabel: string;
}

export function chatGptPlanErrorView(
  kind: ChatGptPlanErrorKind,
  copy: AppCopy["chatgptPlan"],
): ChatGptPlanErrorView {
  switch (kind) {
    case "usage_limit":
      return {
        title: copy.usageLimitTitle,
        body: copy.usageLimitBody,
        action: "manage_usage",
        actionLabel: copy.manageUsage,
      };
    case "revoked":
    case "reauth_required":
      return {
        title: null,
        body: copy.signInExpired,
        action: "sign_in_settings",
        actionLabel: copy.signInInSettings,
      };
    case "not_eligible":
      return {
        title: null,
        body: copy.accountNotEligible,
        action: "open_settings",
        actionLabel: copy.openSettings,
      };
  }
}

/**
 * Ruling 8: a conversation that shows `token_revoked` makes Core find out
 * now, not at its next refresh (up to an hour later). Core learns of a
 * revocation only on its own calls, and a 401 `token_revoked` on its
 * connection test clears the tokens (ticket 02); so: one connection test
 * of the ChatGPT provider per error, then the model store and the plan
 * status are read again and the Settings card says 「需要登录」.
 * `reauth_required` needs none of this — Core said it itself.
 *
 * Returns whether this call ran the test: false for an error already
 * handled, or with no signed-in ChatGPT provider to test.
 */
export function createRevocationCheck(deps: {
  getModels: () => {
    providers: ManagedModelProviderRecord[];
    models: ManagedModelRecord[];
  };
  test: (input: ManagedModelProbeInput) => Promise<unknown>;
  reload: () => Promise<unknown>;
  refreshStatus: (providerId: string) => unknown;
}): (errorKey: string) => Promise<boolean> {
  const handled = new Set<string>();
  return async (errorKey) => {
    if (handled.has(errorKey)) return false;
    handled.add(errorKey);
    const { providers, models } = deps.getModels();
    const provider = providers.find(
      (item) =>
        item.authKind === "chatgpt_codex_oauth" &&
        item.credentialStatus !== "missing",
    );
    const model = provider
      ? models.find((item) => item.providerId === provider.id)
      : undefined;
    if (!provider || !model) return false;
    try {
      await deps.test({
        id: provider.id,
        providerId: provider.id,
        protocol: provider.protocol,
        authKind: provider.authKind,
        apiBase: provider.apiBase,
        model: model.model,
        advancedOptions: model.advancedOptions,
      });
    } catch {
      // Expected when the sign-in is gone: the failing test is what made
      // Core clear the tokens. Nothing to report here.
    }
    await deps.reload();
    void deps.refreshStatus(provider.id);
    return true;
  };
}
