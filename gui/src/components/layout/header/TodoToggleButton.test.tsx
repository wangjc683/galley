import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EMPTY_TODO } from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";

import { TodoToggleButton } from "./TodoToggleButton";

/**
 * Galley's 待办 in its top bar (main chat ticket 45): the list icon, N
 * beside it only when N > 0 (Core's `todayCount`, plain text, never a
 * badge), pressed and `bg-selected` while the panel is open, and the
 * temporary D1 / D2 forms. Static rendering reads a store's initial
 * state, so today's count and the variant are handed in by mocking the
 * hooks.
 */

const todo = vi.hoisted(() => ({ todayCount: 0 }));
vi.mock("@/stores/assistant-todo", () => ({
  useAssistantTodoStore: (select: (state: unknown) => unknown) =>
    select({ todo: { ...EMPTY_TODO, todayCount: todo.todayCount } }),
}));
const variant = vi.hoisted(() => ({ value: "D1" }));
vi.mock(
  "@/components/todo/todo-button-variant/todo-button-variant",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/todo/todo-button-variant/todo-button-variant")
      >();
    return {
      ...actual,
      useTodoButtonVariant: (select: (state: unknown) => unknown) =>
        select({ variant: variant.value, set: () => {} }),
    };
  },
);

afterEach(() => {
  todo.todayCount = 0;
  variant.value = "D1";
});

function render(
  opts: { open?: boolean; language?: "zh-CN" | "en-US" } = {},
): string {
  return renderToStaticMarkup(
    <CopyProvider language={opts.language ?? "zh-CN"}>
      <Tooltip.Provider>
        <TodoToggleButton open={opts.open ?? false} onToggle={() => {}} />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

describe("the top bar's 待办 button", () => {
  it("is the list icon alone at 0: a 28px square, named 待办", () => {
    const html = render();
    expect(html).toContain('data-role="topbar-todo"');
    expect(html).toContain('aria-label="待办"');
    expect(html).toContain("size-7");
    expect(html).not.toContain("w-auto");
    expect(html).not.toContain("tabular-nums");
  });

  it("writes today's count beside the icon, as text and not a badge", () => {
    todo.todayCount = 3;
    const html = render();
    expect(html).toContain('aria-label="待办 · 今天 3"');
    expect(html).toMatch(/text-\[12px\] leading-none tabular-nums">3</);
    // Widened from the square's left edge, the icon where it was.
    expect(html).toContain("w-auto gap-1 px-[5px]");
    // Not a badge: no pill, no fill, no status colour.
    expect(html).not.toContain("rounded-full");
    expect(html).not.toMatch(/bg-(warning|error|brand)/);
    expect(html).not.toMatch(/text-(warning|error|brand)/);
    expect(render({ language: "en-US" })).toContain(
      'aria-label="To-do · Today 3"',
    );
  });

  it("is a pressed toggle, selected while the panel is open (the Changes button's grammar)", () => {
    const closed = render();
    expect(closed).toContain('aria-pressed="false"');
    // The selected material only answers aria-pressed; at rest the hover.
    expect(closed).toContain("aria-pressed:bg-selected");
    expect(closed).toContain("hover:bg-hover");
    // Not a popover trigger: no aria-expanded press state.
    expect(closed).not.toContain('aria-expanded="');
    expect(render({ open: true })).toContain('aria-pressed="true"');
  });

  it("D1 has no word; D2 adds 「待办」, which gives way on a narrow header (TEMP, main-chat 45)", () => {
    todo.todayCount = 2;
    const d1 = render();
    expect(d1).toContain('data-variant="D1"');
    expect(d1).not.toContain(">待办<");
    variant.value = "D2";
    const d2 = render();
    expect(d2).toContain('data-variant="D2"');
    expect(d2).toContain(">待办<");
    // Tests run as neither macOS nor Windows: the Windows / Linux
    // thresholds, per language. The word is hidden below them.
    expect(d2).toContain("hidden @min-[780px]/main-header:inline");
    expect(render({ language: "en-US" })).toContain(
      "hidden @min-[890px]/main-header:inline",
    );
    expect(render({ language: "en-US" })).toContain(">To-do<");
    // The count stays in both.
    expect(d2).toContain(">2<");
    // With the word and no count the button still widens for the word.
    todo.todayCount = 0;
    expect(render()).toContain("w-auto gap-1 px-[5px]");
  });
});
