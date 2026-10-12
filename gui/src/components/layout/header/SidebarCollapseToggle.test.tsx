import * as Tooltip from "@radix-ui/react-tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/layout/AppShell";
import { makeSession } from "@/test/factories";
import type { Session } from "@/types/session";

import { SidebarCollapseToggle } from "./SidebarCollapseToggle";

// Main chat layout B′ (on trial, ticket 07). Static rendering reads a
// store's initial state, so the collapse is fed through the module.
const trial = vi.hoisted(() => ({ collapsed: true }));
vi.mock(
  "@/components/layout/sidebar/main-chat-layout",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/layout/sidebar/main-chat-layout")
      >();
    const { zhCopy } = await import("@/i18n/locales/zh");
    return {
      ...actual,
      useMainChatLayoutStore: <T,>(
        selector: (state: {
          sidebarCollapsed: boolean;
          toggleSidebarCollapsed: () => void;
          demo: boolean;
          demoAnchor: string;
        }) => T,
      ) =>
        selector({
          sidebarCollapsed: trial.collapsed,
          toggleSidebarCollapsed: () => {},
          demo: false,
          demoAnchor: "2026-10-12T00:00:00.000Z",
        }),
      useMainChatTrialCopy: () =>
        actual.mainChatTrialCopy(zhCopy, "zh-CN", "旁聊"),
    };
  },
);
// The persisted split reads localStorage, which node has none of.
vi.mock("react-resizable-panels", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-resizable-panels")>()),
  useDefaultLayout: () => ({
    defaultLayout: undefined,
    onLayoutChanged: () => {},
  }),
}));
const needsYou = vi.hoisted(() => new Set<string>());
const erroring = vi.hoisted(() => ({ on: false }));
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
      return {
        ...view,
        kind: erroring.on ? "error" : ids.length > 0 ? "ask" : view.kind,
        needsYouIds: new Set([...view.needsYouIds, ...ids]),
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

function renderToggle(activeId?: string) {
  return renderToStaticMarkup(
    <Tooltip.Provider>
      <SidebarCollapseToggle sessions={sessions} activeId={activeId} />
    </Tooltip.Provider>,
  );
}

afterEach(() => {
  needsYou.clear();
  erroring.on = false;
  trial.collapsed = true;
});

describe("SidebarCollapseToggle", () => {
  it("counts the side chats that need you on the expand button", () => {
    needsYou.add("a");
    needsYou.add("b");
    // The main chat is in front of you when collapsed: never counted.
    needsYou.add("s-main");
    const html = renderToggle();
    expect(html).toContain('aria-label="展开侧栏 · 2 个旁聊在等你"');
    expect(html).toMatch(/data-role="sidebar-needs-you-badge"[^>]*>2</);
    // Waiting only: the warning tint, not a dot.
    expect(html).toContain("text-warning");
    expect(html).not.toContain("rounded-full bg-warning");
  });

  it("leaves out the open session and turns red when one has errored", () => {
    needsYou.add("a");
    needsYou.add("b");
    erroring.on = true;
    const html = renderToggle("a");
    expect(html).toMatch(/data-role="sidebar-needs-you-badge"[^>]*>1</);
    expect(html).toContain("text-error");
  });

  it("shows no badge with nothing waiting, or while the sidebar is open", () => {
    expect(renderToggle()).not.toContain("sidebar-needs-you-badge");
    needsYou.add("a");
    trial.collapsed = false;
    const html = renderToggle();
    expect(html).not.toContain("sidebar-needs-you-badge");
    expect(html).toContain('aria-label="收起侧栏"');
  });
});

describe("AppShell's B′ collapse", () => {
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
