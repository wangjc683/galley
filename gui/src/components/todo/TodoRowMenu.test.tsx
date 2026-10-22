import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { enCopy } from "@/i18n/locales/en";
import { zhCopy } from "@/i18n/locales/zh";
import { CopyProvider } from "@/lib/i18n";

import { TodoRowMenuButton, type TodoRowMenuModel } from "./TodoRowMenu";

/**
 * Your to-do's menu as drawn (main chat ticket 88, PRD ruling 132 point
 * 3): 说说这件, 取消提醒 only with a reminder still to go off, a
 * separator, 删除 last in the message menu's destructive style. A closed
 * Radix menu renders nothing statically and its content is portalled,
 * so the dropdown and the sidebar seam's rows stand in as plain markup
 * (MessageMenu.test.tsx's way); the right-click menu draws the same rows
 * (`TodoRowMenuRows`), opened for real in TodoPanel.click.test.tsx.
 */

vi.mock("@radix-ui/react-dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const Content = ({
    children,
    align,
    className,
  }: {
    children?: ReactNode;
    align?: string;
    className?: string;
  }) => (
    <div data-align={align} data-class={className}>
      {children}
    </div>
  );
  return { Root: Pass, Trigger: Pass, Portal: Pass, Content };
});

vi.mock("@/components/layout/sidebar/SidebarRowMenu", () => ({
  SidebarRowMenuItem: ({
    children,
    className,
  }: {
    children?: ReactNode;
    className?: string;
  }) => (
    <div data-row="item" data-class={className}>
      {children}
    </div>
  ),
  SidebarRowMenuSeparator: () => <div data-row="separator" />,
}));

const MODEL: TodoRowMenuModel = {
  canCancelReminder: true,
  onTalkAbout: () => {},
  onCancelReminder: () => {},
  onDelete: () => {},
};

function render(
  model: TodoRowMenuModel,
  language: "zh-CN" | "en-US" = "zh-CN",
): string {
  return renderToStaticMarkup(
    <CopyProvider language={language}>
      <Tooltip.Provider>
        <TodoRowMenuButton model={model} open onOpenChange={() => {}} />
      </Tooltip.Provider>
    </CopyProvider>,
  );
}

/** The rows: `item:…` and `separator`, in order. */
function rows(markup: string): string[] {
  return [
    ...markup.matchAll(
      /<div data-row="item"[^>]*>(.*?)<\/div>|<div data-row="separator"><\/div>/g,
    ),
  ].map(([, inner]) =>
    inner === undefined ? "separator" : `item:${inner.replace(/<[^>]+>/g, "")}`,
  );
}

describe("your to-do's menu", () => {
  const words = zhCopy.todo;

  it("holds 说说这件, 取消提醒, then 删除 after a separator", () => {
    expect(rows(render(MODEL))).toEqual([
      `item:${words.talkAbout}`,
      `item:${words.cancelReminder}`,
      "separator",
      `item:${words.deleteTodo.menuItem}`,
    ]);
    expect(rows(render(MODEL, "en-US"))).toEqual([
      `item:${enCopy.todo.talkAbout}`,
      `item:${enCopy.todo.cancelReminder}`,
      "separator",
      "item:Delete",
    ]);
  });

  it("has no 取消提醒 without a reminder still to go off", () => {
    expect(rows(render({ ...MODEL, canCancelReminder: false }))).toEqual([
      `item:${words.talkAbout}`,
      "separator",
      `item:${words.deleteTodo.menuItem}`,
    ]);
  });

  it("draws 删除 in the message menu's destructive style, opening from the ⋯'s right edge", () => {
    const markup = render(MODEL);
    const styles = new Map(
      [
        ...markup.matchAll(
          /<div data-row="item" data-class="([^"]*)">(.*?)<\/div>/g,
        ),
      ].map(([, style, inner]) => [inner.replace(/<[^>]+>/g, ""), style]),
    );
    expect(styles.get(words.deleteTodo.menuItem)).toContain("text-error");
    for (const other of [words.talkAbout, words.cancelReminder]) {
      expect(styles.get(other)).toContain("text-ink-soft");
      expect(styles.get(other)).not.toContain("text-error");
    }
    expect(markup).toContain('data-align="end"');
    expect(markup).toContain("w-[200px]");
    // The trigger: the panel's button, named 更多, pressed while open.
    expect(markup).toContain(`aria-label="${zhCopy.common.more}"`);
  });
});
