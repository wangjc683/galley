import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitReviewContext } from "@/lib/git-review";

import { MainHeader } from "./MainHeader";
import { MainHeaderHost } from "./MainHeaderHost";

/**
 * 待办 in the main header (main chat ticket 45, PRD ruling 93): since
 * ticket 104 (ruling 149 point 2, ticket 103's 甲) the right side's
 * first, a group of its own, a divider after it — then the status
 * cluster, then the tools (视图与设置), where it was the first until
 * then. Only on the managed runtime and only when App hands it the
 * toggle — which it does in every conversation's header while there is
 * a main chat (ticket 46, ruling 95; lib/todo-open.ts `todoView`, tested
 * there): Galley's, a workbench conversation's, a subtask's, the empty
 * composer's. The runtime is seeded per test.
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
    /** Something in the status cluster (the engine's 配置 badge). */
    status?: boolean;
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
          runtimeIndicator={opts.status ? "configure-models" : "hidden"}
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

const GROUP = 'role="group" aria-label="待办与备忘"';
const STATUS = 'aria-label="运行状态"';
const DIVIDER = 'class="h-5 w-px bg-line/80"';
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the main header's 待办", () => {
  it("is the right side's first, a group of its own, then the status cluster, then the tools", () => {
    const html = header({ changes: true, status: true });
    const group = html.indexOf(GROUP);
    const status = html.indexOf(STATUS);
    const tools = html.indexOf(TOOLS);
    expect(group).toBeGreaterThan(-1);
    expect(group).toBeLessThan(html.indexOf(TODO));
    expect(html.indexOf(TODO)).toBeLessThan(status);
    expect(status).toBeLessThan(tools);
    // Not one of 「视图与设置」: the tools start with Changes.
    expect(html.slice(tools)).not.toContain(TODO);
    const first = html.slice(tools).slice(html.slice(tools).indexOf("<button"));
    expect(first.slice(0, first.indexOf(">"))).toContain(
      'aria-label="工作区改动"',
    );
    // A divider between each two groups.
    expect(count(html, DIVIDER)).toBe(2);
    expect(html.slice(group, status)).toContain(DIVIDER);
    expect(html.slice(status, tools)).toContain(DIVIDER);
  });

  it("keeps a divider before the tools when the status cluster is empty", () => {
    // The host always has the Channels lamp on the managed runtime; the
    // header alone can go without any status.
    const bare = (todo: boolean) =>
      renderToStaticMarkup(
        <Tooltip.Provider>
          <MainHeader
            sessionTitle="Galley"
            onToggleTodo={todo ? () => {} : undefined}
          />
        </Tooltip.Provider>,
      );
    expect(bare(false)).not.toContain(STATUS);
    expect(count(bare(false), DIVIDER)).toBe(0);
    const html = bare(true);
    expect(count(html, DIVIDER)).toBe(1);
    expect(html.slice(html.indexOf(GROUP), html.indexOf(TOOLS))).toContain(
      DIVIDER,
    );
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
      expect(html.indexOf(GROUP), of).toBeGreaterThan(-1);
      expect(html.indexOf(TODO), of).toBeLessThan(html.indexOf(TOOLS));
    }
    expect(header({ of: "subtask" })).toContain('aria-label="回到 Galley"');
  });

  it("makes the header a size container while it is there: its word and capsule give way by the header's width (ticket 106)", () => {
    expect(header()).toContain("@container/main-header");
    for (const of of ["workbench", "subtask", "empty"] as const) {
      expect(header({ of }), of).toContain("@container/main-header");
    }
  });

  it("is not there without the toggle (no main chat) nor on the external runtime, and the header is no size container then", () => {
    const without = header({ todo: false, status: true });
    expect(without).not.toContain(TODO);
    expect(without).not.toContain(GROUP);
    expect(without).not.toContain("@container/main-header");
    seed.runtime = "external";
    for (const of of ["galley", "workbench", "subtask", "empty"] as const) {
      const html = header({ of });
      expect(html, of).not.toContain(TODO);
      expect(html, of).not.toContain("@container/main-header");
    }
  });
});
