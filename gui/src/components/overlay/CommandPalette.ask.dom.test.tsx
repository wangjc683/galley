// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { zhCopy } from "@/i18n/locales/zh";
import { CopyProvider } from "@/lib/i18n";
import type { PaletteScope } from "@/lib/palette-scope";
import { makeSession } from "@/test/factories";

import { CommandPalette } from "./CommandPalette";

/**
 * ⌘K's 「没找到。Enter 直接发问？」 (2026-11-10 audit, ruling A6), with
 * the real cmdk: when the typed text matches nothing, Enter and a click
 * on that row both hand the text on and close the palette; blank text
 * offers nothing; a search in one conversation (⌘F) has no such row and
 * its Enter starts nothing. Core's message search answers no hits.
 */

vi.mock("@/lib/palette-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/palette-scope")>()),
  paletteSearch: vi.fn(async () => []),
}));

const NO_MATCH = "量子纠缠的晚饭菜谱";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // cmdk measures its list and scrolls the selected item into view;
  // jsdom has no layout.
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

async function mount(scope: PaletteScope | null = null) {
  const onSubmitFreeText = vi.fn<(text: string) => void>();
  const onOpenChange = vi.fn<(open: boolean) => void>();
  act(() =>
    root.render(
      <CopyProvider language="zh-CN">
        <CommandPalette
          open
          onOpenChange={onOpenChange}
          sessions={[makeSession({ id: "s-a", title: "整理发版说明" })]}
          runtimeKind="managed"
          scope={scope}
          onSubmitFreeText={onSubmitFreeText}
        />
      </CopyProvider>,
    ),
  );
  // The open-reset runs on the next tick.
  await settle();
  return { onSubmitFreeText, onOpenChange };
}

function paletteInput(): HTMLInputElement {
  return document.body.querySelector<HTMLInputElement>("[cmdk-input]")!;
}

/** Past the search's 180 ms debounce, and its answer in. */
async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(300);
  });
}

/** Type into the palette's input the way React hears it, then let the
 * debounced search answer. */
async function type(value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setValue.call(paletteInput(), value);
    paletteInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

function pressEnter() {
  act(() => {
    paletteInput().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
}

function askRow(): HTMLButtonElement | null {
  return document.body.querySelector<HTMLButtonElement>(
    '[data-role="palette-ask-directly"]',
  );
}

describe("Enter 直接发问", () => {
  it("Enter on no match hands the text on and closes the palette", async () => {
    const { onSubmitFreeText, onOpenChange } = await mount();
    await type(NO_MATCH);
    expect(askRow()?.textContent).toContain(zhCopy.command.askDirectly);

    pressEnter();

    expect(onSubmitFreeText).toHaveBeenCalledTimes(1);
    expect(onSubmitFreeText).toHaveBeenCalledWith(NO_MATCH);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a click on the row does the same", async () => {
    const { onSubmitFreeText, onOpenChange } = await mount();
    await type(NO_MATCH);

    act(() => askRow()!.click());

    expect(onSubmitFreeText).toHaveBeenCalledTimes(1);
    expect(onSubmitFreeText).toHaveBeenCalledWith(NO_MATCH);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Enter while something matches opens that, not a new chat", async () => {
    const { onSubmitFreeText } = await mount();
    await type("发版");
    expect(askRow()).toBeNull();

    pressEnter();

    expect(onSubmitFreeText).not.toHaveBeenCalled();
  });

  it("blank text offers no row and Enter sends nothing", async () => {
    const { onSubmitFreeText } = await mount();
    await type("   ");
    expect(askRow()).toBeNull();

    pressEnter();

    expect(onSubmitFreeText).not.toHaveBeenCalled();
  });

  it("searching one conversation: 没找到。 alone, and Enter starts nothing", async () => {
    const { onSubmitFreeText } = await mount({ sessionId: "s-a" });
    await type(NO_MATCH);
    expect(
      document.body.querySelector('[data-role="palette-scoped-note"]')
        ?.textContent,
    ).toBe(zhCopy.command.notFound);
    expect(askRow()).toBeNull();

    pressEnter();

    expect(onSubmitFreeText).not.toHaveBeenCalled();
  });
});
