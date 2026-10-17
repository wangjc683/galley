import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitReviewContext } from "@/lib/git-review";

import { MainHeaderHost } from "./MainHeaderHost";

/**
 * Galley's 待办 in the main header (main chat ticket 45, PRD ruling 93):
 * the first button of the tool cluster (视图与设置), before Changes,
 * only on the managed runtime and only when App hands it the toggle —
 * which it does while the main chat itself is open (lib/todo-open.ts
 * `mainChatOnScreen`, tested there). The header is otherwise the same
 * with and without it. The runtime is seeded per test.
 */

const seed = vi.hoisted(() => ({
  runtime: "managed" as "managed" | "external",
}));
vi.mock("@/stores/prefs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/prefs")>();
  const get = () => ({
    ...actual.usePrefsStore.getState(),
    activeRuntimeKind: seed.runtime,
  });
  return {
    ...actual,
    usePrefsStore: Object.assign(
      <R,>(select: (s: ReturnType<typeof get>) => R) => select(get()),
      { getState: get },
    ),
  };
});

afterEach(() => {
  seed.runtime = "managed";
});

function header(
  opts: { todo?: boolean; open?: boolean; changes?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <GitReviewContext.Provider
      value={
        opts.changes
          ? { isOpen: false, repositoryKnown: true, toggle: () => {} }
          : null
      }
    >
      <Tooltip.Provider>
        <MainHeaderHost
          channelStatuses={[]}
          channelsLoadError={null}
          onRestartChannels={() => {}}
          runtimeIndicator="hidden"
          openSettings={() => {}}
          onOpenSettings={() => {}}
          resolvedTheme="light"
          sessionTitle="Galley"
          isMainChat
          todoOpen={opts.open ?? false}
          onToggleTodo={opts.todo === false ? undefined : () => {}}
        />
      </Tooltip.Provider>
    </GitReviewContext.Provider>,
  );
}

const TODO = 'data-role="topbar-todo"';
const TOOLS = 'aria-label="视图与设置"';

describe("the main header's 待办", () => {
  it("is the tool cluster's first button, before Changes", () => {
    const html = header({ changes: true });
    const tools = html.slice(html.indexOf(TOOLS));
    const changes = tools.indexOf('aria-label="工作区改动"');
    expect(changes).toBeGreaterThan(-1);
    // The cluster's first button is it, and Changes comes after.
    const first = tools.slice(tools.indexOf("<button"));
    expect(first.slice(0, first.indexOf(">"))).toContain(TODO);
    expect(tools.indexOf(TODO)).toBeLessThan(changes);
    // In the tool cluster, not the status cluster before it.
    expect(html.indexOf(TODO)).toBeGreaterThan(html.indexOf(TOOLS));
  });

  it("is pressed while the panel is open", () => {
    const tag = (html: string) => {
      const i = html.indexOf(TODO);
      return html.slice(html.lastIndexOf("<", i), html.indexOf(">", i) + 1);
    };
    expect(tag(header())).toContain('aria-pressed="false"');
    expect(tag(header({ open: true }))).toContain('aria-pressed="true"');
  });

  it("is not there without the toggle (a subtask, the workbench) nor on the external runtime", () => {
    const without = header({ todo: false });
    expect(without).not.toContain(TODO);
    seed.runtime = "external";
    const external = header();
    expect(external).not.toContain(TODO);
    // The header is otherwise the same with and without it.
    seed.runtime = "managed";
    expect(header({ todo: false })).toBe(without);
  });
});
