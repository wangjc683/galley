import { describe, expect, it, vi } from "vitest";

import {
  chatGptPlanErrorView,
  createRevocationCheck,
  findChatGptPlanError,
} from "@/lib/chatgpt-plan-errors";
import { copyForLanguage } from "@/lib/i18n";
import type {
  ManagedModelProviderRecord,
  ManagedModelRecord,
} from "@/types/managed-models";

const zh = copyForLanguage("zh-CN").chatgptPlan;
const en = copyForLanguage("en-US").chatgptPlan;

// The engine's shapes (patch 0007, managed-ga/code/llmcore.py
// `_chatgpt_plan_error`, and the credential IPC failure).
const USAGE_LIMIT =
  "!!!Error: HTTP 429: ChatGPT plan usage limit reached (subscription_sharing_usage_limit_exceeded): this is your plan's limit or the limit you set for Galley; manage usage at https://chatgpt.com/settings/usage";
const NOT_ELIGIBLE =
  "!!!Error: HTTP 403: This ChatGPT account cannot use its plan in Galley (subscription_sharing_user_not_eligible); use an API key provider instead";
const REVOKED =
  "!!!Error: HTTP 401: ChatGPT sign-in was revoked or disconnected (token_revoked); sign in again in Settings → Models";
const REAUTH =
  "!!!Error: RuntimeError: Galley Codex credential refresh failed: invalid_args: chatgpt_plan_reauth_required: sign in with ChatGPT again";
const UNSUPPORTED =
  "!!!Error: HTTP 400: ChatGPT plan does not support this request (subscription_sharing_unsupported_capability, param: tools)";
const UNAVAILABLE =
  "!!!Error: ChatGPT plan temporarily unavailable (subscription_sharing_usage_unavailable); try again later";
const REJECTED =
  "!!!Error: HTTP 403: ChatGPT plan request rejected (subscription_sharing_route_rejected)";

describe("findChatGptPlanError → words and the way on", () => {
  it("usage limit: its heading, body and Manage usage as the action", () => {
    const match = findChatGptPlanError(USAGE_LIMIT);
    expect(match).toEqual({
      kind: "usage_limit",
      raw: USAGE_LIMIT,
      before: "",
    });
    expect(chatGptPlanErrorView("usage_limit", zh)).toEqual({
      title: "已达到用量上限",
      body: "检查你的 ChatGPT 套餐，或你给 Galley 设的上限。",
      action: "manage_usage",
      actionLabel: "管理用量",
    });
    expect(chatGptPlanErrorView("usage_limit", en)).toEqual({
      title: "Usage limit reached",
      body: "Review your plan or this app's limit in ChatGPT settings.",
      action: "manage_usage",
      actionLabel: "Manage usage",
    });
  });

  it("revoked and reauth_required: sign in again, from Settings", () => {
    expect(findChatGptPlanError(REVOKED)?.kind).toBe("revoked");
    expect(findChatGptPlanError(REAUTH)?.kind).toBe("reauth_required");
    for (const kind of ["revoked", "reauth_required"] as const) {
      expect(chatGptPlanErrorView(kind, zh)).toEqual({
        title: null,
        body: "ChatGPT 登录已失效，需要重新登录。",
        action: "sign_in_settings",
        actionLabel: "去设置登录",
      });
    }
  });

  it("not eligible: Plus / Pro, or an API key provider, from Settings", () => {
    expect(findChatGptPlanError(NOT_ELIGIBLE)?.kind).toBe("not_eligible");
    expect(chatGptPlanErrorView("not_eligible", zh)).toEqual({
      title: null,
      body: "这个 ChatGPT 账号的套餐不能在 Galley 里使用（支持 Plus / Pro），可以改选一个用密钥的服务商。",
      action: "open_settings",
      actionLabel: "去设置",
    });
  });

  it("leaves the other plan codes as the engine wrote them", () => {
    for (const text of [UNSUPPORTED, UNAVAILABLE, REJECTED]) {
      expect(findChatGptPlanError(text), text).toBeNull();
    }
  });

  it("leaves an unrelated error and an ordinary reply alone", () => {
    expect(
      findChatGptPlanError("!!!Error: HTTP 401: invalid api key"),
    ).toBeNull();
    // A reply that explains a code is not the engine's error.
    expect(
      findChatGptPlanError(
        "The error token_revoked means the OAuth token was revoked.",
      ),
    ).toBeNull();
  });

  it("finds the engine's sentence without its mark, and keeps text before the mark", () => {
    const bare = USAGE_LIMIT.replace("!!!Error: ", "");
    expect(findChatGptPlanError(bare)?.kind).toBe("usage_limit");
    const after = findChatGptPlanError(`Let me check that.\n\n${REVOKED}`);
    expect(after).toEqual({
      kind: "revoked",
      raw: REVOKED,
      before: "Let me check that.",
    });
  });
});

describe("createRevocationCheck: one connection test per error", () => {
  const provider = {
    id: "mp_chatgpt_codex",
    displayName: "ChatGPT",
    protocol: "openai",
    authKind: "chatgpt_codex_oauth",
    apiBase: "https://api.openai.com/v1",
    apiKeyRef: "ref",
    credentialStatus: "present",
    createdAt: "",
    updatedAt: "",
  } satisfies ManagedModelProviderRecord;
  const model = {
    id: "mm_chatgpt_codex_gpt_55",
    providerId: "mp_chatgpt_codex",
    providerDisplayName: "ChatGPT",
    displayName: "gpt-5.6-sol",
    protocol: "openai",
    authKind: "chatgpt_codex_oauth",
    apiBase: "https://api.openai.com/v1",
    model: "gpt-5.6-sol",
    apiKeyRef: "ref",
    presetOptions: {},
    advancedOverrides: {},
    advancedOptions: { reasoning_effort: "high" },
    isDefault: true,
    sortOrder: 0,
    credentialStatus: "present",
    createdAt: "",
    updatedAt: "",
  } satisfies ManagedModelRecord;

  function setup(
    providers: ManagedModelProviderRecord[] = [provider],
    models: ManagedModelRecord[] = [model],
  ) {
    const order: string[] = [];
    const test = vi.fn(async () => {
      order.push("test");
      // The revoked token: Core's test fails, and clears the tokens.
      throw new Error("chatgpt_plan_reauth_required");
    });
    const reload = vi.fn(async () => {
      order.push("reload");
    });
    const refreshStatus = vi.fn((providerId: string) => {
      order.push(`status ${providerId}`);
    });
    const check = createRevocationCheck({
      getModels: () => ({ providers, models }),
      test,
      reload,
      refreshStatus,
    });
    return { check, test, order };
  }

  it("tests the ChatGPT provider once, then reads the store and the status", async () => {
    const { check, test, order } = setup();
    await expect(check("msg_s1_4_assistant")).resolves.toBe(true);
    expect(test).toHaveBeenCalledWith({
      id: "mp_chatgpt_codex",
      providerId: "mp_chatgpt_codex",
      protocol: "openai",
      authKind: "chatgpt_codex_oauth",
      apiBase: "https://api.openai.com/v1",
      model: "gpt-5.6-sol",
      advancedOptions: { reasoning_effort: "high" },
    });
    expect(order).toEqual(["test", "reload", "status mp_chatgpt_codex"]);
  });

  it("does not test again for the same error, however often it is seen", async () => {
    const { check, test } = setup();
    await check("msg_s1_4_assistant");
    await expect(check("msg_s1_4_assistant")).resolves.toBe(false);
    await expect(check("msg_s1_4_assistant")).resolves.toBe(false);
    expect(test).toHaveBeenCalledTimes(1);
    // A new error is a new test.
    await check("msg_s1_9_assistant");
    expect(test).toHaveBeenCalledTimes(2);
  });

  it("tests nothing without a signed-in ChatGPT provider with a model", async () => {
    const signedOut = setup([{ ...provider, credentialStatus: "missing" }]);
    await expect(signedOut.check("msg_a")).resolves.toBe(false);
    expect(signedOut.test).not.toHaveBeenCalled();
    const noModel = setup([provider], []);
    await expect(noModel.check("msg_b")).resolves.toBe(false);
    expect(noModel.test).not.toHaveBeenCalled();
  });
});
