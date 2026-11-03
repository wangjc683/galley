import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/layout/AppShell";
import { makeSession } from "@/test/factories";
import type { Session } from "@/types/session";

import { SidebarCollapseToggle } from "./SidebarCollapseToggle";

// useCopy falls back to the zh copy without a CopyProvider.

// The persisted split reads localStorage, which node has none of.
vi.mock("react-resizable-panels", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-resizable-panels")>()),
  useDefaultLayout: () => ({
    defaultLayout: undefined,
    onLayoutChanged: () => {},
  }),
}));
// A session's erroring bridge or pending ask can't be seeded in a store
// under static rendering; mark ids as needing the user on top of the
// real hook.
const needsYou = vi.hoisted(() => new Set<string>());
const erroring = vi.hoisted(() => ({ on: false }));
// Ids erroring, one by one (a subtask's error, ruling 177 point 3).
const failing = vi.hoisted(() => new Set<string>());
vi.mock("@/hooks/useSessionsAttention", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/useSessionsAttention")>();
  return {
    ...actual,
    useSessionsAttention: (
      ...args: Parameters<typeof actual.useSessionsAttention>
    ) => {
      const [sessions] = args;
      const view = actual.useSessionsAttention(...args);
      const ids = sessions.filter((s) => needsYou.has(s.id)).map((s) => s.id);
      const failed = sessions.filter((s) => failing.has(s.id)).map((s) => s.id);
      return {
        ...view,
        kind:
          erroring.on || failed.length > 0
            ? "error"
            : ids.length > 0
              ? "ask"
              : view.kind,
        needsYouIds: new Set([...view.needsYouIds, ...ids, ...failed]),
        askCount: view.askCount + ids.length,
      };
    },
  };
});

const managed = (id: string, extra: Partial<Session> = {}) =>
  makeSession({
    id,
    gaRuntimeKind: "managed",
    runtimeKind: "managed",
    ...extra,
  });
const sessions = [
  managed("s-main", { mainChat: true }),
  managed("a"),
  managed("b"),
  managed("c"),
];

function renderToggle(collapsed: boolean, activeId?: string) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <SidebarCollapseToggle
        collapsed={collapsed}
        onToggle={() => {}}
        sessions={sessions}
        activeId={activeId}
      />
    </Tooltip.Provider>,
  );
}

afterEach(() => {
  needsYou.clear();
  erroring.on = false;
  failing.clear();
});

describe("SidebarCollapseToggle", () => {
  it("counts the conversations that need you on the expand button", () => {
    needsYou.add("a");
    needsYou.add("b");
    // The open one is in front of you: never counted.
    needsYou.add("s-main");
    const html = renderToggle(true, "s-main");
    expect(html).toContain('aria-label="展开侧栏 · 2 个对话在等你"');
    expect(html).toMatch(/data-role="sidebar-needs-you-badge"[^>]*>2</);
    // Waiting only: the warning tint, not a dot.
    expect(html).toContain("text-warning");
    expect(html).not.toContain("rounded-full bg-warning");
  });

  it("counts the main chat too while another conversation is open", () => {
    needsYou.add("s-main");
    const html = renderToggle(true, "a");
    expect(html).toContain('aria-label="展开侧栏 · 1 个对话在等你"');
  });

  it("leaves out the open session and turns red when one has errored", () => {
    needsYou.add("a");
    needsYou.add("b");
    erroring.on = true;
    const html = renderToggle(true, "a");
    expect(html).toMatch(/data-role="sidebar-needs-you-badge"[^>]*>1</);
    expect(html).toContain("text-error");
  });

  // An unpromoted subtask counts as the main chat (ticket 06a) when it
  // asks; its error is Galley's business, not yours (ruling 177 point 3).
  describe("Galley's subtasks", () => {
    const subtask = managed("s-sub", {
      parentSessionId: "s-main",
      origin: { via: "subtask" },
    });
    const withSubtask = (activeId?: string) =>
      renderToStaticMarkup(
        <Tooltip.Provider>
          <SidebarCollapseToggle
            collapsed
            onToggle={() => {}}
            sessions={[...sessions, subtask]}
            activeId={activeId}
          />
        </Tooltip.Provider>,
      );

    it("counts one asking as the main chat, in amber", () => {
      needsYou.add("s-sub");
      const html = withSubtask("a");
      expect(html).toContain('aria-label="展开侧栏 · 1 个对话在等你"');
      expect(html).toContain("text-warning");
      // Not while the main chat, or the subtask itself, is open.
      expect(withSubtask("s-main")).not.toContain("sidebar-needs-you-badge");
      expect(withSubtask("s-sub")).not.toContain("sidebar-needs-you-badge");
    });

    it("does not count one that failed, nor turn the badge red", () => {
      failing.add("s-sub");
      expect(withSubtask("a")).not.toContain("sidebar-needs-you-badge");
      needsYou.add("b");
      const html = withSubtask("a");
      expect(html).toContain('aria-label="展开侧栏 · 1 个对话在等你"');
      expect(html).toContain("text-warning");
      expect(html).not.toContain("text-error");
    });
  });

  it("shows no badge with nothing waiting, or while the sidebar is open", () => {
    expect(renderToggle(true)).not.toContain("sidebar-needs-you-badge");
    expect(renderToggle(true)).toContain('aria-label="展开侧栏"');
    needsYou.add("a");
    const html = renderToggle(false);
    expect(html).not.toContain("sidebar-needs-you-badge");
    expect(html).toContain('aria-label="收起侧栏"');
  });
});

describe("AppShell's collapse", () => {
  const shell = (collapsed: boolean) =>
    renderToStaticMarkup(
      <Tooltip.Provider>
        <AppShell
          sidebarCollapsed={collapsed}
          sidebar={<div>SIDEBAR</div>}
          main={<div>MAIN</div>}
        />
      </Tooltip.Provider>,
    );
  const tagOf = (html: string, needle: string) => {
    const at = html.indexOf(needle);
    return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at));
  };

  it("hides the sidebar panel and the separator but keeps them mounted", () => {
    const html = shell(true);
    expect(html).toContain("SIDEBAR");
    expect(html).toContain("MAIN");
    expect(tagOf(html, 'id="sidebar"')).toContain("hidden");
    expect(tagOf(html, 'role="separator"')).toContain("hidden");
    expect(tagOf(html, 'id="main"')).not.toContain("hidden");
  });

  it("is today's shell when not collapsed", () => {
    const html = shell(false);
    expect(tagOf(html, 'id="sidebar"')).not.toContain("hidden");
    expect(tagOf(html, 'role="separator"')).not.toContain("hidden");
  });
});
