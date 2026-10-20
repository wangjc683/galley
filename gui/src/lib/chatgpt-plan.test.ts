import { describe, expect, it, vi } from "vitest";

import {
  CHATGPT_PLAN_NOTICE_KEY,
  chatGptPlanLoginFailure,
  chatGptPlanModelIds,
  chatGptProviderIds,
  chatGptSignInNeeded,
  chatGptPlanTestFailure,
  claimChatGptPlanNotice,
  createCompleteOnce,
  finishChatGptPlanSignIn,
} from "@/lib/chatgpt-plan";
import { copyForLanguage } from "@/lib/i18n";
import type { ChatGptPlanStatus } from "@/lib/managed-models";
import type { ManagedModelRecord } from "@/types/managed-models";

const zh = copyForLanguage("zh-CN");
const en = copyForLanguage("en-US");
const zhCopy = { plan: zh.chatgptPlan, models: zh.settings.models };
const enCopy = { plan: en.chatgptPlan, models: en.settings.models };

function planError(code: string, message = "detail from Core"): string {
  return JSON.stringify({ error: code, message });
}

describe("chatGptPlanLoginFailure", () => {
  it("says the user cancelled the authorization on access_denied", () => {
    expect(
      chatGptPlanLoginFailure(planError("chatgpt_plan_access_denied"), zhCopy),
    ).toEqual({ kind: "error", message: "你在浏览器里取消了授权。" });
    expect(
      chatGptPlanLoginFailure(planError("chatgpt_plan_access_denied"), enCopy),
    ).toEqual({ kind: "error", message: en.chatgptPlan.accessDenied });
  });

  it("asks to check plan usage next time on usage_not_granted", () => {
    expect(
      chatGptPlanLoginFailure(
        planError("chatgpt_plan_usage_not_granted"),
        zhCopy,
      ),
    ).toEqual({
      kind: "error",
      message: "授权时没有同意使用 ChatGPT 订阅的额度，再试一次时记得勾上。",
    });
  });

  it("goes back to the button without a word on timeout, cancel, or a gone login", () => {
    for (const code of [
      "chatgpt_plan_login_timed_out",
      "chatgpt_plan_login_cancelled",
      "chatgpt_plan_login_not_found",
    ]) {
      expect(chatGptPlanLoginFailure(planError(code), zhCopy), code).toEqual({
        kind: "reset",
      });
    }
  });

  it("says try again later on temporary", () => {
    expect(
      chatGptPlanLoginFailure(planError("chatgpt_plan_temporary"), zhCopy),
    ).toEqual({ kind: "error", message: zh.chatgptPlan.temporary });
  });

  it("shows Core's message on failed", () => {
    expect(
      chatGptPlanLoginFailure(
        planError("chatgpt_plan_failed", "token exchange failed: HTTP 400"),
        zhCopy,
      ),
    ).toEqual({
      kind: "error",
      message: "没能用 ChatGPT 登录：token exchange failed: HTTP 400",
    });
    // No message at all: the generic failure, not an empty colon.
    expect(
      chatGptPlanLoginFailure(planError("chatgpt_plan_failed", ""), zhCopy),
    ).toEqual({ kind: "error", message: zh.settings.models.actionFailed });
  });

  it("falls back to the probe wording for errors that are not plan errors", () => {
    const failure = chatGptPlanLoginFailure(
      JSON.stringify({ error: "invalid_args", message: "HTTP 401 nope" }),
      zhCopy,
    );
    expect(failure).toEqual({
      kind: "error",
      message: zh.settings.models.errorUnauthorized,
    });
  });
});

describe("createCompleteOnce", () => {
  it("calls complete once per login id, however often it is asked", async () => {
    const result = { provider: { id: "mp_chatgpt_codex" } };
    const complete = vi.fn().mockResolvedValue(result);
    const completeOnce = createCompleteOnce(complete as never);

    // A double click / React StrictMode's second effect run.
    const first = completeOnce("login-1");
    const second = completeOnce("login-1");
    expect(second).toBe(first);
    await expect(first).resolves.toBe(result);
    await expect(completeOnce("login-1")).resolves.toBe(result);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith("login-1");

    // A new sign-in has a new id and gets its own call.
    await completeOnce("login-2");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenLastCalledWith("login-2");
  });

  it("does not call again after the first call failed", async () => {
    const complete = vi
      .fn()
      .mockRejectedValue(planError("chatgpt_plan_access_denied"));
    const completeOnce = createCompleteOnce(complete as never);
    await expect(completeOnce("login-3")).rejects.toBeDefined();
    await expect(completeOnce("login-3")).rejects.toBeDefined();
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe("claimChatGptPlanNotice", () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
  }

  it("claims the notice once, then never again", () => {
    const storage = memoryStorage();
    expect(claimChatGptPlanNotice(storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(CHATGPT_PLAN_NOTICE_KEY, "1");
    expect(claimChatGptPlanNotice(storage)).toBe(false);
  });

  it("does not show it when it was shown before", () => {
    expect(
      claimChatGptPlanNotice(memoryStorage({ [CHATGPT_PLAN_NOTICE_KEY]: "1" })),
    ).toBe(false);
  });

  it("shows nothing and throws nothing when storage is unavailable", () => {
    expect(claimChatGptPlanNotice(null)).toBe(false);
    const unreadable = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: vi.fn(),
    };
    expect(claimChatGptPlanNotice(unreadable)).toBe(false);
    expect(unreadable.setItem).not.toHaveBeenCalled();
    const unwritable = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(claimChatGptPlanNotice(unwritable)).toBe(false);
  });
});

function model(patch: Partial<ManagedModelRecord>): ManagedModelRecord {
  return {
    id: "mm_1",
    providerId: "mp_1",
    providerDisplayName: "Provider",
    displayName: "",
    protocol: "openai",
    authKind: "api_key",
    apiBase: "https://api.openai.com/v1",
    model: "gpt-5.6-sol",
    apiKeyRef: "ref",
    presetOptions: {},
    advancedOverrides: {},
    advancedOptions: {},
    isDefault: false,
    sortOrder: 0,
    credentialStatus: "present",
    createdAt: "",
    updatedAt: "",
    ...patch,
  };
}

function status(patch: Partial<ChatGptPlanStatus>): ChatGptPlanStatus {
  return {
    flow: "siwc",
    signedIn: true,
    needsReauth: false,
    registered: true,
    scopes: [],
    expiresAt: null,
    lastRefreshAt: null,
    lastRefreshError: null,
    ...patch,
  };
}

describe("which models spend the ChatGPT plan", () => {
  const models = [
    model({ id: "mm_api", providerId: "mp_openai" }),
    model({
      id: "mm_plan_a",
      providerId: "mp_chatgpt_codex",
      authKind: "chatgpt_codex_oauth",
    }),
    model({
      id: "mm_plan_b",
      providerId: "mp_chatgpt_codex",
      authKind: "chatgpt_codex_oauth",
    }),
  ];

  it("lists the ChatGPT providers once each", () => {
    expect(chatGptProviderIds(models)).toEqual(["mp_chatgpt_codex"]);
  });

  it("counts a ChatGPT provider's models only when it signed in with ChatGPT", () => {
    expect(
      chatGptPlanModelIds(models, { mp_chatgpt_codex: status({}) }),
    ).toEqual(new Set(["mm_plan_a", "mm_plan_b"]));
    // Its tokens cleared after a dead refresh: still the plan's models.
    expect(
      chatGptPlanModelIds(models, {
        mp_chatgpt_codex: status({ signedIn: false, needsReauth: true }),
      }),
    ).toEqual(new Set(["mm_plan_a", "mm_plan_b"]));
    // No credential (signed out, or a Codex CLI login cleared at start).
    expect(
      chatGptPlanModelIds(models, {
        mp_chatgpt_codex: status({ flow: null, signedIn: false }),
      }).size,
    ).toBe(0);
    // Not read yet: nothing claimed.
    expect(chatGptPlanModelIds(models, {}).size).toBe(0);
  });
});

describe("chatGptSignInNeeded", () => {
  const provider = {
    authKind: "chatgpt_codex_oauth" as const,
    credentialStatus: "present" as const,
  };

  it("is needed when the plan status says the tokens are gone, though the row is present", () => {
    expect(
      chatGptSignInNeeded(
        provider,
        status({ signedIn: false, needsReauth: true }),
      ),
    ).toBe(true);
    expect(chatGptSignInNeeded(provider, status({}))).toBe(false);
    expect(chatGptSignInNeeded(provider, undefined)).toBe(false);
  });

  it("is needed with no credential at all, and never for a key provider", () => {
    expect(
      chatGptSignInNeeded(
        { ...provider, credentialStatus: "missing" },
        undefined,
      ),
    ).toBe(true);
    expect(
      chatGptSignInNeeded(
        { authKind: "api_key", credentialStatus: "missing" },
        status({ needsReauth: true }),
      ),
    ).toBe(false);
  });
});

describe("finishChatGptPlanSignIn: the connection test after the callback", () => {
  function setup(status: { ok: boolean; message: string; endpoint?: string }) {
    const order: string[] = [];
    const complete = vi.fn(async (loginId: string) => {
      order.push(`complete ${loginId}`);
      return {
        provider: { id: "mp_chatgpt_codex" },
        model: { id: "mm_chatgpt_codex_gpt_55" },
        status: {
          endpoint: "https://api.openai.com/v1/responses",
          ...status,
        },
      };
    });
    const loadManagedModels = vi.fn(async () => {
      order.push("load");
    });
    const refreshStatus = vi.fn((providerId: string) => {
      order.push(`status ${providerId}`);
    });
    return {
      order,
      complete,
      deps: { complete: complete as never, loadManagedModels, refreshStatus },
    };
  }

  it("goes on when the test passed: no failure, store and status read again", async () => {
    const { order, deps } = setup({ ok: true, message: "ChatGPT plan ready" });
    await expect(
      finishChatGptPlanSignIn(deps, "login-ok", zh.chatgptPlan),
    ).resolves.toEqual({ providerId: "mp_chatgpt_codex", failure: null });
    expect(order).toEqual([
      "complete login-ok",
      "load",
      "status mp_chatgpt_codex",
    ]);
  });

  it("stays when the plan is not eligible, says so, and still reloads what Core saved", async () => {
    const { order, deps } = setup({
      ok: false,
      message:
        'ChatGPT model test failed (HTTP 403 subscription_sharing_user_not_eligible: {"error":{}})',
    });
    const finished = await finishChatGptPlanSignIn(
      deps,
      "login-403",
      zh.chatgptPlan,
    );
    expect(finished).toEqual({
      providerId: "mp_chatgpt_codex",
      failure:
        "已用 ChatGPT 登录，但这个 ChatGPT 订阅不能在 Galley 里使用（支持 Plus / Pro）。可以改选一个用密钥的服务商。",
    });
    // The provider and credential stay: the store follows anyway.
    expect(order).toEqual([
      "complete login-403",
      "load",
      "status mp_chatgpt_codex",
    ]);
  });

  it("stays on any other failed test with Core's message", async () => {
    const { deps } = setup({
      ok: false,
      message: "ChatGPT model test failed (HTTP 400 bad_request: nope)",
    });
    const finished = await finishChatGptPlanSignIn(
      deps,
      "login-400",
      en.chatgptPlan,
    );
    expect(finished.failure).toBe(
      "Signed in with ChatGPT, but the connection test failed: ChatGPT model test failed (HTTP 400 bad_request: nope)",
    );
  });

  it("completes each login once even when finished twice", async () => {
    const { complete, deps } = setup({ ok: true, message: "ready" });
    const once = createCompleteOnce(complete as never);
    const guarded = { ...deps, complete: once };
    await Promise.all([
      finishChatGptPlanSignIn(guarded, "login-twice", zh.chatgptPlan),
      finishChatGptPlanSignIn(guarded, "login-twice", zh.chatgptPlan),
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe("chatGptPlanTestFailure", () => {
  const base = { endpoint: "https://api.openai.com/v1/responses" };

  it("is nothing when the test passed", () => {
    expect(
      chatGptPlanTestFailure(
        { ...base, ok: true, message: "ready" },
        zh.chatgptPlan,
      ),
    ).toBeNull();
  });

  it("knows a plan that is not eligible in either wording", () => {
    expect(
      chatGptPlanTestFailure(
        { ...base, ok: false, message: "Plan not eligible for this app" },
        en.chatgptPlan,
      ),
    ).toBe(en.chatgptPlan.notEligible);
  });
});
