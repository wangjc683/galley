import { describe, expect, it } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import { providerConnectionLabel } from "@/lib/managed-model-preset-copy";
import {
  getManagedModelProviderPreset,
  type ManagedModelProviderPresetId,
} from "@/lib/managed-model-presets";
import type { ManagedModelProviderRecord } from "@/types/managed-models";

/**
 * The small text after a provider's name says how it is reached (SIWC
 * decision 15, 2026-10-20): the ChatGPT plan, the official API, or else
 * the protocol. The provider card, the create form's picker and the
 * forms' read-only card line all ask this one function.
 */

type Connection = Pick<
  ManagedModelProviderRecord,
  "protocol" | "authKind" | "apiBase"
>;

const zh = zhCopy.settings.models;
const en = enCopy.settings.models;

/** A provider saved straight from a card, its address untouched. */
function fromCard(id: ManagedModelProviderPresetId): Connection {
  const preset = getManagedModelProviderPreset(id);
  return {
    protocol: preset.protocol,
    authKind: preset.authKind ?? "api_key",
    apiBase: preset.apiBase,
  };
}

describe("providerConnectionLabel", () => {
  it("names the ChatGPT provider by its plan, not its protocol", () => {
    expect(providerConnectionLabel(zh, fromCard("chatgpt-codex"))).toBe(
      "ChatGPT 订阅",
    );
    expect(providerConnectionLabel(en, fromCard("chatgpt-codex"))).toBe(
      "ChatGPT plan",
    );
  });

  it("calls the OpenAI and Anthropic cards' own addresses the official API", () => {
    expect(providerConnectionLabel(zh, fromCard("custom-openai"))).toBe(
      "官方 API",
    );
    expect(providerConnectionLabel(zh, fromCard("custom-anthropic"))).toBe(
      "官方 API",
    );
    expect(providerConnectionLabel(en, fromCard("custom-openai"))).toBe(
      "Official API",
    );
    // A stray space around the address is the same address (the form
    // and the save both trim it).
    expect(
      providerConnectionLabel(zh, {
        ...fromCard("custom-openai"),
        apiBase: " https://api.openai.com/v1 ",
      }),
    ).toBe("官方 API");
  });

  it("keeps the protocol for everything else", () => {
    // Named cards on a compatible endpoint, including vendors' own
    // Anthropic-compatible ones.
    expect(providerConnectionLabel(zh, fromCard("deepseek"))).toBe(
      "Anthropic 兼容",
    );
    expect(providerConnectionLabel(zh, fromCard("openrouter"))).toBe(
      "OpenAI 兼容",
    );
    expect(providerConnectionLabel(en, fromCard("siliconflow"))).toBe(
      "OpenAI-compatible",
    );
    // A Custom provider: a relay, a local server.
    expect(
      providerConnectionLabel(zh, {
        protocol: "openai",
        authKind: "none",
        apiBase: "http://localhost:11434/v1",
      }),
    ).toBe("OpenAI 兼容");
    expect(
      providerConnectionLabel(zh, {
        protocol: "anthropic",
        authKind: "api_key",
        apiBase: "https://relay.example.com/anthropic",
      }),
    ).toBe("Anthropic 兼容");
  });

  it("drops an OpenAI card pointed at a relay back to the protocol", () => {
    expect(
      providerConnectionLabel(zh, {
        ...fromCard("custom-openai"),
        apiBase: "https://relay.example.com/v1",
      }),
    ).toBe("OpenAI 兼容");
  });
});
