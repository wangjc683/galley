import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitReviewContext } from "@/lib/git-review";

import { MainHeaderHost } from "./MainHeaderHost";

/**
 * 待办 in the main header (main chat ticket 45, PRD ruling 93): the
 * first button of the tool cluster (视图与设置), before Changes, only on
 * the managed runtime and only when App hands it the toggle — which it
 * does in every conversation's header while there is a main chat
 * (ticket 46, ruling 95; lib/todo-open.ts `todoView`, tested there):
 * Galley's, a workbench conversation's, a subtask's, the empty
 * composer's. The header is otherwise the same with and without it. The
 * runtime is seeded per test.
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
  opts: {
    todo?: boolean;
    open?: boolean;
    changes?: boolean;
    /** Whose header: Galley's (default), a workbench conversation's, a
     * subtask's (「Galley ›」 before its title), the empty composer's. */
    of?: "galley" | "workbench" | "subtask" | "empty";
  } = {},
): string {
  const of = opts.of ?? "galley";
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
          sessionTitle={
            of === "galley" ? "Galley" : of === "empty" ? undefined : "整理发票"
          }
          isMainChat={of === "galley"}
          canRenameSession={of !== "galley"}
          breadcrumb={
            of === "subtask"
              ? { label: "Galley", ariaLabel: "回到 Galley", onClick: () => {} }
              : undefined
          }
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

  it("is in a workbench conversation's, a subtask's and the empty composer's header too (ticket 46)", () => {
    for (const of of ["workbench", "subtask", "empty"] as const) {
      const html = header({ of, changes: true });
      const tools = html.slice(html.indexOf(TOOLS));
      const first = tools.slice(tools.indexOf("<button"));
      expect(first.slice(0, first.indexOf(">")), of).toContain(TODO);
    }
    expect(header({ of: "subtask" })).toContain('aria-label="回到 Galley"');
  });

  it("is not there without the toggle (no main chat) nor on the external runtime", () => {
    const without = header({ todo: false });
    expect(without).not.toContain(TODO);
    seed.runtime = "external";
    for (const of of ["galley", "workbench", "subtask", "empty"] as const) {
      expect(header({ of }), of).not.toContain(TODO);
    }
    // The header is otherwise the same with and without it.
    seed.runtime = "managed";
    expect(header({ todo: false })).toBe(without);
  });
});
