import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyProvider } from "@/lib/i18n";
import { MANAGED_MODEL_PROVIDER_PRESETS } from "@/lib/managed-model-presets";

import { ManagedModelProviderAddMenu } from "./ManagedModelProviderAddMenu";

/**
 * Settings → 模型's 「添加」 is the card list itself (SIWC decision 16):
 * the button opens the presets as a menu, choosing one hands its id up
 * (Settings opens that card's create form), and closing the menu any
 * other way (Esc, a click outside) chooses nothing. A closed Radix menu
 * renders nothing statically and portals its content, so the menu's
 * parts stand in as plain markup here and its handlers are kept to be
 * called the way Radix would: `onOpenChange(true)` when the button is
 * pressed (pointer, Enter, Space, ↓), `onOpenChange(false)` on Esc or
 * a click outside, an item's `onSelect` on click or Enter.
 */

const radix = vi.hoisted(() => ({
  onOpenChange: null as ((open: boolean) => void) | null,
  onSelect: new Map<string, () => void>(),
}));

vi.mock("@radix-ui/react-dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Root = ({
    children,
    onOpenChange,
  }: {
    children?: ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => {
    radix.onOpenChange = onOpenChange ?? null;
    return <>{children}</>;
  };
  const Content = ({
    children,
    align,
  }: {
    children?: ReactNode;
    align?: string;
  }) => (
    <div data-part="content" data-align={align}>
      {children}
    </div>
  );
  const Item = ({
    children,
    textValue,
    onSelect,
  }: {
    children?: ReactNode;
    textValue?: string;
    onSelect?: () => void;
  }) => {
    if (textValue && onSelect) radix.onSelect.set(textValue, onSelect);
    return (
      <div data-part="item" data-text-value={textValue}>
        {children}
      </div>
    );
  };
  return { Root, Trigger: Pass, Portal: Pass, Content, Item };
});

afterEach(() => {
  radix.onOpenChange = null;
  radix.onSelect.clear();
});

function render(
  props: {
    onOpenRequest?: () => boolean;
    onPick?: (id: string) => void;
    language?: "zh-CN" | "en-US";
  } = {},
): string {
  return renderToStaticMarkup(
    <CopyProvider language={props.language ?? "zh-CN"}>
      <ManagedModelProviderAddMenu
        variant="secondary"
        onOpenRequest={props.onOpenRequest ?? (() => true)}
        onPick={props.onPick ?? (() => {})}
      />
    </CopyProvider>,
  );
}

/** Each item's visible text, `name / description`. */
function rows(markup: string): string[] {
  return [...markup.matchAll(/<div data-part="item"[^>]*>(.*?)<\/div>/g)].map(
    (match) =>
      [...match[1].matchAll(/<span class="[^"]*block[^"]*">(.*?)<\/span>/g)]
        .map((span) => span[1])
        .join(" / "),
  );
}

describe("Settings' 「添加」 menu", () => {
  it("is the 「添加」 button, named for what it adds", () => {
    const html = render();
    expect(html).toContain('aria-label="添加模型服务商"');
    expect(html).toMatch(/>添加<\/button>/);
    // Opens from the button's right edge, the section header's end.
    expect(html).toContain('data-align="end"');
    expect(render({ language: "en-US" })).toContain(
      'aria-label="Add model provider"',
    );
  });

  it("lists every card in the picker's order, name over description", () => {
    expect(rows(render())).toEqual([
      "ChatGPT / 用 ChatGPT 订阅（Plus / Pro）的额度",
      "OpenAI / 官方 API",
      "Anthropic / 官方 API",
      "DeepSeek / DeepSeek 官方接口",
      "Kimi for Coding / Kimi for Coding 套餐",
      "MiniMax / MiniMax 官方接口",
      "OpenRouter / 一个密钥调用多家模型",
      "SiliconFlow / 聚合国产与开源模型",
      "Xiaomi MiMo / 小米 MiMo Token 套餐",
      "Zhipu GLM / 智谱 GLM 官方接口",
      "自定义 / 任意 OpenAI 或 Anthropic 兼容接口",
    ]);
    expect(rows(render()).length).toBe(MANAGED_MODEL_PROVIDER_PRESETS.length);
    // Typeahead matches the card's name, not name + description.
    expect(render()).toContain('data-text-value="自定义"');
  });

  it("hands the chosen card up", () => {
    const onPick = vi.fn();
    render({ onPick });
    radix.onSelect.get("Anthropic")?.();
    expect(onPick).toHaveBeenCalledExactlyOnceWith("custom-anthropic");
    radix.onSelect.get("ChatGPT")?.();
    expect(onPick).toHaveBeenLastCalledWith("chatgpt-codex");
  });

  it("asks before opening, and chooses nothing when closed", () => {
    const onOpenRequest = vi.fn(() => true);
    const onPick = vi.fn();
    render({ onOpenRequest, onPick });
    radix.onOpenChange?.(true);
    expect(onOpenRequest).toHaveBeenCalledOnce();
    // Esc or a click outside.
    radix.onOpenChange?.(false);
    expect(onOpenRequest).toHaveBeenCalledOnce();
    expect(onPick).not.toHaveBeenCalled();
  });
});
