import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CopyProvider } from "@/lib/i18n";
import type { ManagedModelProviderPresetId } from "@/lib/managed-model-presets";
import {
  newProviderForm,
  providerFormFromPreset,
  providerFormFromRecord,
} from "@/lib/provider-setup";

import { ProviderEditor } from "./ProviderEditor";
import type { ProviderFormState } from "./types";

/**
 * The provider form's card line (SIWC decisions 15–16, 2026-10-20). A
 * create form opened from 「添加」's menu shows its card as read-only
 * text, as the edit form does, with the close button at the row's end;
 * the zero-provider page's form keeps its picker. Either way the small
 * text after the card says how it connects.
 */

const PICKER_TRIGGER = 'aria-haspopup="dialog"';

function render(
  form: ProviderFormState,
  opts: { presetPicker?: boolean; canCancel?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <CopyProvider language="zh-CN">
      <Tooltip.Provider>
        <ProviderEditor
          form={form}
          saving={false}
          canSave={false}
          canTest={false}
          canFetchModels={false}
          canCancel={opts.canCancel ?? true}
          presetPicker={opts.presetPicker}
          providerHasSavedKey={false}
          probeState={{ kind: "idle" }}
          modelOptions={[]}
          onChange={() => {}}
          onSelectProviderPreset={() => {}}
          onTest={() => {}}
          onFetchModels={() => {}}
          onChatGptPlanSignIn={() => {}}
          onChatGptPlanSignOut={() => {}}
          onChatGptPlanCancel={() => {}}
          onSave={() => {}}
          onCancel={() => {}}
        />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

/** The card line: the card's name and the small text after it. */
function cardLine(html: string): string[] {
  const match = html.match(
    /<div class="flex min-w-0 items-baseline gap-2">(.*?)<\/div>/,
  );
  if (!match) return [];
  return [...match[1].matchAll(/<span[^>]*>(.*?)<\/span>/g)].map(
    (span) => span[1],
  );
}

const fromCard = (id: ManagedModelProviderPresetId) =>
  providerFormFromPreset(id);

describe("a create form opened from 「添加」's menu", () => {
  it("shows its card as text, no picker, the close button kept", () => {
    const html = render(fromCard("custom-openai"));
    expect(cardLine(html)).toEqual(["OpenAI", "官方 API"]);
    expect(html).not.toContain(PICKER_TRIGGER);
    expect(html).not.toContain("选择服务商");
    expect(html).toContain('aria-label="关闭模型服务商编辑"');
    // No title: the create form leads with the card line.
    expect(html).not.toContain("编辑服务商");
  });

  it("says how each card connects", () => {
    expect(cardLine(render(fromCard("chatgpt-codex")))).toEqual([
      "ChatGPT",
      "ChatGPT 订阅",
    ]);
    expect(cardLine(render(fromCard("custom-anthropic")))).toEqual([
      "Anthropic",
      "官方 API",
    ]);
    expect(cardLine(render(fromCard("deepseek")))).toEqual([
      "DeepSeek",
      "Anthropic 兼容",
    ]);
    // An official card whose address was changed to a relay.
    expect(
      cardLine(
        render({
          ...fromCard("custom-openai"),
          apiBase: "https://relay.example.com/v1",
        }),
      ),
    ).toEqual(["OpenAI", "OpenAI 兼容"]);
  });

  it("leaves the Custom card's protocol to its own switch", () => {
    const html = render(fromCard("custom-endpoint"));
    expect(cardLine(html)).toEqual(["自定义"]);
    // The protocol control still says the protocol itself.
    expect(html).toContain('aria-label="接口协议"');
    expect(html).toContain("OpenAI 兼容");
    expect(html).toContain("Anthropic 兼容");
  });
});

describe("the zero-provider page's create form", () => {
  it("keeps its picker, with no close button", () => {
    const html = render(newProviderForm(), {
      presetPicker: true,
      canCancel: false,
    });
    expect(html).toContain(PICKER_TRIGGER);
    expect(html).toContain("选择服务商");
    expect(html).not.toContain('aria-label="关闭模型服务商编辑"');
  });

  it("puts the connection under the chosen card in the picker", () => {
    const html = render(fromCard("custom-anthropic"), { presetPicker: true });
    expect(html).toContain(PICKER_TRIGGER);
    expect(html).toMatch(/text-ink-muted">官方 API<\/span>/);
  });

  it("is the only way a create form without a card gets one", () => {
    expect(render(newProviderForm())).toContain(PICKER_TRIGGER);
  });
});

describe("the edit form", () => {
  it("reads its saved card and connection, as before", () => {
    const html = render(
      providerFormFromRecord({
        id: "p1",
        protocol: "anthropic",
        authKind: "api_key",
        apiBase: "https://api.anthropic.com",
        displayName: "Anthropic",
      }),
    );
    expect(html).toContain("编辑服务商");
    expect(cardLine(html)).toEqual(["Anthropic", "官方 API"]);
    expect(html).not.toContain(PICKER_TRIGGER);
  });
});
