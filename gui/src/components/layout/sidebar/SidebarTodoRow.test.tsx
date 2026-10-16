import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EMPTY_TODO } from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";

import { SidebarTodoRow } from "./SidebarTodoRow";

/**
 * 「待办」 under Galley's card (main chat ticket 42): 「今天 N」 on the
 * right only when N > 0, selected while the panel shows, and the three
 * forms on the temporary pill. Static rendering reads a store's initial
 * state, so today's count and the variant are handed in by mocking the
 * hooks.
 */

const todo = vi.hoisted(() => ({ todayCount: 0 }));
vi.mock("@/stores/assistant-todo", () => ({
  useAssistantTodoStore: (select: (state: unknown) => unknown) =>
    select({ todo: { ...EMPTY_TODO, todayCount: todo.todayCount } }),
}));
const variants = vi.hoisted(() => ({ row: "A1" }));
vi.mock(
  "@/components/todo/todo-variants/todo-variants",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/todo/todo-variants/todo-variants")
      >();
    return {
      ...actual,
      useTodoVariants: (select: (state: unknown) => unknown) =>
        select({ ...actual.DEFAULT_VARIANTS, ...variants, set: () => {} }),
    };
  },
);

afterEach(() => {
  todo.todayCount = 0;
  variants.row = "A1";
});

function render(
  opts: { selected?: boolean; language?: "zh-CN" | "en-US" } = {},
): string {
  return renderToStaticMarkup(
    <CopyProvider language={opts.language ?? "zh-CN"}>
      <SidebarTodoRow selected={opts.selected ?? false} onToggle={() => {}} />
    </CopyProvider>,
  );
}

describe("the 「待办」 row", () => {
  it("writes 「今天 N」 for today's and overdue, nothing at 0", () => {
    const none = render();
    expect(none).toContain('aria-label="待办"');
    expect(none).not.toContain("今天");
    todo.todayCount = 2;
    const two = render();
    expect(two).toContain('aria-label="待办 · 今天 2"');
    expect(two).toMatch(/text-\[11px\] tabular-nums text-ink-muted">今天 2</);
    // A count, never a badge.
    expect(two).not.toContain("rounded-full");
    expect(render({ language: "en-US" })).toContain(">Today 2<");
  });

  it("is selected while the panel shows (the sidebar's selected channels)", () => {
    const rest = render();
    expect(rest).toContain('aria-expanded="false"');
    expect(rest).not.toContain("bg-selected");
    expect(rest).toContain("hover:bg-hover");
    const shown = render({ selected: true });
    expect(shown).toContain('aria-expanded="true"');
    expect(shown).toContain("bg-selected");
    expect(shown).toContain("shadow-[var(--shadow-selected)]");
  });

  it("takes the three forms (TEMP variant switcher, main chat 42)", () => {
    todo.todayCount = 1;
    // A1, the default: a 32px row on the list's grid.
    const a1 = render();
    expect(a1).toContain('data-variant="A1"');
    expect(a1).toContain("mx-1.5 mt-0.5 flex h-8");
    expect(a1).toContain('class="flex w-4 shrink-0 justify-center"');
    // A2: small text from the card's text column.
    variants.row = "A2";
    const a2 = render();
    expect(a2).toContain("ml-[62px]");
    expect(a2).toContain("h-6");
    expect(a2).toContain("text-[12px]");
    expect(a2).toContain(" · 今天 1");
    // A3: the card's grid.
    variants.row = "A3";
    const a3 = render();
    expect(a3).toContain('class="flex w-10 shrink-0 justify-center"');
    expect(a3).toContain("rounded-md");
  });
});
