import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  TodoButtonDemo,
  TodoButtonLook,
} from "@/components/todo/todo-button-variants/todo-button-variants";
import { EMPTY_TODO } from "@/lib/assistant-todo";
import { CopyProvider } from "@/lib/i18n";

import { TodoToggleButton } from "./TodoToggleButton";

/**
 * Galley's 待办 in its top bar (main chat ticket 45): the list icon, N
 * beside it only when N > 0 (Core's `todayCount`, plain text, never a
 * badge), pressed and `bg-selected` while the panel is open; named
 * 「待办与备忘」 since ticket 103 (PRD ruling 148 point 4). On ticket 103's
 * trial pill, 乙 and 丙 write 「待办」 after the icon — giving way first on
 * a narrow header — and 丙 adds a hairline; the demo replaces the count.
 * Static rendering reads a store's initial state, so today's count and
 * the demo are handed in by mocking the hooks.
 */

const todo = vi.hoisted(() => ({ todayCount: 0 }));
vi.mock("@/stores/assistant-todo", () => ({
  useAssistantTodoStore: (select: (state: unknown) => unknown) =>
    select({ todo: { ...EMPTY_TODO, todayCount: todo.todayCount } }),
}));
// TEMP variant switcher (main chat 103): the demo count.
const demo = vi.hoisted(() => ({ value: "real" as TodoButtonDemo }));
vi.mock(
  "@/components/todo/todo-button-variants/todo-button-variants",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/todo/todo-button-variants/todo-button-variants")
      >();
    return {
      ...actual,
      useTodoButtonVariants: (select: (state: unknown) => unknown) =>
        select({ look: "now", demo: demo.value }),
    };
  },
);
afterEach(() => {
  todo.todayCount = 0;
  demo.value = "real";
});

function render(
  opts: {
    open?: boolean;
    language?: "zh-CN" | "en-US";
    look?: TodoButtonLook;
  } = {},
): string {
  return renderToStaticMarkup(
    <CopyProvider language={opts.language ?? "zh-CN"}>
      <Tooltip.Provider>
        <TodoToggleButton
          open={opts.open ?? false}
          onToggle={() => {}}
          look={opts.look}
        />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

describe("the top bar's 待办 button", () => {
  it("is the list icon alone at 0: a 28px square, named 待办与备忘", () => {
    const html = render();
    expect(html).toContain('data-role="topbar-todo"');
    expect(html).toContain('aria-label="待办与备忘"');
    expect(html).toContain("size-7");
    expect(html).not.toContain("w-auto");
    expect(html).not.toContain("tabular-nums");
    expect(render({ language: "en-US" })).toContain(
      'aria-label="To-do and memos"',
    );
  });

  it("writes today's count beside the icon, as text and not a badge", () => {
    todo.todayCount = 3;
    const html = render();
    expect(html).toContain('aria-label="待办与备忘 · 今天 3"');
    expect(html).toMatch(/text-\[12px\] leading-none tabular-nums">3</);
    // Widened from the square's left edge, the icon where it was.
    expect(html).toContain("w-auto gap-1 px-[5px]");
    // Not a badge: no pill, no fill, no status colour.
    expect(html).not.toContain("rounded-full");
    expect(html).not.toMatch(/bg-(warning|error|brand)/);
    expect(html).not.toMatch(/text-(warning|error|brand)/);
    expect(render({ language: "en-US" })).toContain(
      'aria-label="To-do and memos · Today 3"',
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

  it("has no word beside the icon at 现状 and 甲", () => {
    todo.todayCount = 2;
    for (const look of ["now", "A"] as const) {
      expect(render({ look }), look).not.toContain(">待办<");
      expect(render({ look, language: "en-US" }), look).not.toContain(
        ">To-do<",
      );
    }
    todo.todayCount = 0;
    expect(render({ look: "A" })).not.toContain("w-auto");
  });
});

describe("乙 and 丙 on ticket 103's pill (PRD ruling 148 point 3)", () => {
  it("乙 writes 待办 after the icon, 13px in the button's ink, the count after it", () => {
    todo.todayCount = 2;
    const html = render({ look: "B" });
    const icon = html.indexOf("<svg");
    const word = html.indexOf(">待办<");
    const count = html.indexOf(">2<");
    expect(icon).toBeGreaterThan(-1);
    expect(word).toBeGreaterThan(icon);
    expect(count).toBeGreaterThan(word);
    expect(html).toMatch(/class="text-\[13px\] leading-none [^"]*">待办</);
    // 4px between each, the icon where the square has it.
    expect(html).toContain("w-auto gap-1 px-[5px]");
    // No colour of its own: the button's ink.
    expect(html).not.toMatch(/text-(ink|warning|brand)[^-]*">待办</);
    expect(render({ look: "B", language: "en-US" })).toContain(">To-do<");
  });

  it("gives the word way first on a narrow header, by the header's width", () => {
    const html = render({ look: "B" });
    // jsdom-free: the classes say it — hidden, inline from the header's
    // threshold, 7px on the right only with the word.
    expect(html).toMatch(
      /class="text-\[13px\] leading-none hidden @min-\[\d+px\]\/main-header:inline"/,
    );
    expect(html).toMatch(/@min-\[\d+px\]\/main-header:pr-\[7px\]/);
    // Chinese and English have their own threshold.
    const zh = /@min-\[(\d+)px\]\/main-header:inline/.exec(html)![1];
    const en = /@min-\[(\d+)px\]\/main-header:inline/.exec(
      render({ look: "B", language: "en-US" }),
    )![1];
    expect(Number(en)).toBeGreaterThan(Number(zh));
  });

  it("丙 adds a hairline at rest; 乙 and 甲 do not", () => {
    const tag = (html: string) =>
      html.slice(
        html.indexOf("<button"),
        html.indexOf(">", html.indexOf("<button")),
      );
    // A bare `border-line`, not the hover's or the pressed state's.
    expect(tag(render({ look: "C" }))).toMatch(/(\s|")border-line(\s|")/);
    expect(render({ look: "C" })).toContain(">待办<");
    for (const look of ["B", "A", "now"] as const) {
      // Only the hover and the pressed state draw the line.
      expect(tag(render({ look })), look).not.toMatch(
        /(\s|")border-line(\s|")/,
      );
    }
  });
});

describe("the demo count (TEMP variant switcher, main chat 103)", () => {
  it("今天 2 shows and says 2, 没有今天 nothing, 真实 the real count", () => {
    todo.todayCount = 5;
    demo.value = "two";
    const two = render({ look: "B" });
    expect(two).toContain(">2<");
    expect(two).toContain('aria-label="待办与备忘 · 今天 2"');
    demo.value = "none";
    const none = render({ look: "B" });
    expect(none).not.toContain("tabular-nums");
    expect(none).toContain('aria-label="待办与备忘"');
    demo.value = "real";
    expect(render({ look: "B" })).toContain(">5<");
  });
});
