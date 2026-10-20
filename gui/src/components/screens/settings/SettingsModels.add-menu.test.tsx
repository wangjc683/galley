import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyProvider } from "@/lib/i18n";
import type { ManagedModelsStore } from "@/stores/managed-models";
import type { ManagedModelProviderRecord } from "@/types/managed-models";

import { SettingsModels } from "./SettingsModels";

/**
 * Settings → 模型's 服务商 section around 「添加」 (SIWC decisions 15–16,
 * 2026-10-20). With providers, 「添加」 is a menu button and no form is
 * open until a card is chosen; each card's small text says how it
 * connects. With none, nothing changes: the create form opens by itself
 * with its picker and no close button, and 「添加」 is hidden. Static
 * rendering reads a store's initial state, so the providers are handed
 * in by mocking the store hook over its real initial state.
 */

const store = vi.hoisted(() => ({
  providers: [] as ManagedModelProviderRecord[],
}));

vi.mock("@/stores/managed-models", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/stores/managed-models")>();
  const state = (): ManagedModelsStore => ({
    ...actual.useManagedModelsStore.getState(),
    providers: store.providers,
  });
  const useManagedModelsStore = Object.assign(
    <T,>(select: (s: ManagedModelsStore) => T): T => select(state()),
    { getState: state },
  );
  return { ...actual, useManagedModelsStore };
});

afterEach(() => {
  store.providers = [];
});

function provider(
  id: string,
  displayName: string,
  fields: Pick<ManagedModelProviderRecord, "protocol" | "authKind" | "apiBase">,
): ManagedModelProviderRecord {
  return {
    id,
    displayName,
    ...fields,
    apiKeyRef: "",
    credentialStatus: "present",
    createdAt: "2026-10-20T00:00:00Z",
    updatedAt: "2026-10-20T00:00:00Z",
  };
}

function render(): string {
  return renderToStaticMarkup(
    <CopyProvider language="zh-CN">
      <Tooltip.Provider>
        <SettingsModels />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

const ADD_BUTTON = /<button[^>]*aria-label="添加模型服务商"[^>]*>/;

describe("the 服务商 section", () => {
  it("with no providers: the form opens by itself with its picker, no 「添加」", () => {
    const html = render();
    expect(html).not.toMatch(ADD_BUTTON);
    expect(html).toContain("选择服务商");
    expect(html).toContain('aria-haspopup="dialog"');
    // Can't be closed: it is the page's one next step.
    expect(html).not.toContain('aria-label="关闭模型服务商编辑"');
    expect(html).not.toContain("还没有模型服务商。");
  });

  it("with providers: 「添加」 is a closed menu button and no form is open", () => {
    store.providers = [
      provider("p-chatgpt", "ChatGPT", {
        protocol: "openai",
        authKind: "chatgpt_codex_oauth",
        apiBase: "https://api.openai.com/v1",
      }),
    ];
    const html = render();
    const button = html.match(ADD_BUTTON)?.[0] ?? "";
    expect(button).toContain('aria-haspopup="menu"');
    expect(button).toContain('aria-expanded="false"');
    // A routine maintenance action once something is configured.
    expect(button).not.toContain("bg-ink ");
    expect(html).not.toContain("选择服务商");
    expect(html).not.toContain('aria-label="关闭模型服务商编辑"');
  });

  it("writes how each provider connects after its name", () => {
    store.providers = [
      provider("p-chatgpt", "ChatGPT", {
        protocol: "openai",
        authKind: "chatgpt_codex_oauth",
        apiBase: "https://api.openai.com/v1",
      }),
      provider("p-openai", "OpenAI", {
        protocol: "openai",
        authKind: "api_key",
        apiBase: "https://api.openai.com/v1",
      }),
      provider("p-relay", "OpenAI relay", {
        protocol: "openai",
        authKind: "api_key",
        apiBase: "https://relay.example.com/v1",
      }),
      provider("p-local", "localhost:11434", {
        protocol: "openai",
        authKind: "none",
        apiBase: "http://localhost:11434/v1",
      }),
      provider("p-anthropic", "Anthropic", {
        protocol: "anthropic",
        authKind: "api_key",
        apiBase: "https://api.anthropic.com",
      }),
    ];
    const chips = [
      ...render().matchAll(
        /<span class="[^"]*text-ink-muted\/55" title="([^"]*)">/g,
      ),
    ].map((match) => match[1]);
    expect(chips).toEqual([
      "ChatGPT 订阅 · https://api.openai.com/v1",
      "官方 API · https://api.openai.com/v1",
      "OpenAI 兼容 · https://relay.example.com/v1",
      "OpenAI 兼容 · http://localhost:11434/v1",
      "官方 API · https://api.anthropic.com",
    ]);
  });
});
